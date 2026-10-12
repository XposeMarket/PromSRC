import { estimateTextTokensForModel, type TokenizerFamily } from './model-context';

export const MAX_COMPACTION_SUMMARY_CHARS = 12_000;

const REQUIRED_SECTIONS = [
  'Primary Request and Intent',
  'Key Technical Concepts',
  'Files and Code Sections',
  'Errors, Fixes, and Test Results',
  'Problem Solving and Decisions',
  'Recent User Messages',
  'Pending Tasks',
  'Current Work',
  'Recovery Artifacts',
  'Continue From Here',
];

/** A rejected summary must never become the checkpoint for discarded messages. */
export function normalizeCompactionSummary(value: unknown): string {
  return String(value || '').trim().split(/\r?\n/).map((line) => {
    const plain = line.trim().replace(/^#{1,6}\s+/, '').replace(/\*\*/g, '');
    return REQUIRED_SECTIONS.some((section, index) => plain === `${index + 1}. ${section}:`) ? plain : line;
  }).join('\n');
}

export function isUsableCompactionSummary(value: unknown, maxWords: number): value is string {
  const text = String(value || '').trim();
  if (!text || text.length > MAX_COMPACTION_SUMMARY_CHARS) return false;
  if ((text.match(/\S+/g) || []).length > maxWords) return false;
  if (/\[\.\.\.truncated(?: to compaction word limit)?\]/i.test(text)) return false;
  const lines = text.split(/\r?\n/);
  const headings = REQUIRED_SECTIONS.map((section, index) => {
    const heading = `${index + 1}. ${section}:`;
    return lines.findIndex((line) => line.trim() === heading);
  });
  if (headings.some((position, index) => position < 0 || (index > 0 && position <= headings[index - 1]))) return false;
  // A formal outline with no actual handoff would still drop the active task.
  return [0, 5, 7, 9].every((index) => {
    const body = lines.slice(headings[index] + 1, headings[index + 1] ?? lines.length).join(' ').trim();
    const meaningfulBody = body.replace(/^(?:[-*]\s*|\d+\.\s*)+/, '');
    return !!meaningfulBody && !/^(?:unknown|none yet\.?)(?:\s|$)/i.test(meaningfulBody);
  });
}

/** Reserve output tokens and headroom before sending a compactor request. */
export function compactionInputBudgetTokens(numCtx: number, numPredict: number): number {
  return Math.max(0, Math.floor(numCtx * 0.9) - numPredict - 256);
}

export function compactionPromptFits(
  prompt: string,
  tokenBudget: number,
  tokenizer: TokenizerFamily = 'heuristic',
): boolean {
  return tokenBudget > 0 && estimateTextTokensForModel(prompt, tokenizer) + 16 <= tokenBudget;
}

/** Select the largest next batch; final metadata may need its own pass. */
export function selectCompactionBatch(
  start: number,
  messageCount: number,
  fits: (end: number, includeFinalMetadata: boolean) => boolean,
): { end: number; includeFinalMetadata: boolean } | null {
  for (let end = messageCount; end > start; end--) {
    const includeFinalMetadata = end === messageCount;
    if (fits(end, includeFinalMetadata)) return { end, includeFinalMetadata };
  }
  for (let end = messageCount; end > start; end--) {
    if (fits(end, false)) return { end, includeFinalMetadata: false };
  }
  return null;
}

export function compactionSummaryRejection(value: string, maxWords: number, unchanged: boolean): string {
  if (!value.trim()) return 'empty';
  if (unchanged) return 'unchanged';
  if (value.length > MAX_COMPACTION_SUMMARY_CHARS) return 'character_limit';
  if ((value.match(/\S+/g) || []).length > maxWords) return 'word_limit';
  if (/\[\.\.\.truncated(?: to compaction word limit)?\]/i.test(value)) return 'truncated';
  return 'sections_or_content';
}

export interface CompactionTransactionInput<T> {
  messages: T[];
  previousSummary: string;
  maxWords: number;
  numCtx: number;
  numPredict: number;
  tokenizer?: TokenizerFamily;
  renderPrompt: (messages: T[], previousSummary: string, includeMetadata: boolean) => string;
  summarize: (prompt: string) => Promise<string>;
  commit: (summary: string, passCount: number) => void | Promise<void>;
  isAborted?: () => boolean;
  onInvalidSummary?: (details: { reason: string; words: number; chars: number; attempt: number }) => void;
}

export type CompactionTransactionResult =
  | { compacted: true; summaryText: string; passCount: number }
  | { compacted: false; reason: 'aborted' | 'input_budget' | 'invalid_summary' };

/** The session checkpoint is written only after every input batch succeeds. */
export async function runCompactionTransaction<T>(
  input: CompactionTransactionInput<T>,
): Promise<CompactionTransactionResult> {
  const tokenBudget = compactionInputBudgetTokens(input.numCtx, input.numPredict);
  let previousSummary = input.previousSummary;
  let nextMessage = 0;
  let metadataIncluded = false;
  let passCount = 0;
  const promptFor = (end: number, includeMetadata: boolean) => input.renderPrompt(
    input.messages.slice(nextMessage, end), previousSummary, includeMetadata,
  );

  while (nextMessage < input.messages.length || !metadataIncluded) {
    if (input.isAborted?.()) return { compacted: false, reason: 'aborted' };
    const selected = nextMessage < input.messages.length
      ? selectCompactionBatch(nextMessage, input.messages.length, (end, includeMetadata) =>
        compactionPromptFits(promptFor(end, includeMetadata), tokenBudget, input.tokenizer))
      : null;
    const end = selected?.end ?? nextMessage;
    const includeMetadata = selected ? selected.includeFinalMetadata : nextMessage === input.messages.length;
    if (nextMessage < input.messages.length && !selected) return { compacted: false, reason: 'input_budget' };
    const prompt = promptFor(end, includeMetadata);
    if (!compactionPromptFits(prompt, tokenBudget, input.tokenizer)) return { compacted: false, reason: 'input_budget' };

    let summary = normalizeCompactionSummary(await input.summarize(prompt));
    if (input.isAborted?.()) return { compacted: false, reason: 'aborted' };
    const valid = (text: string) => isUsableCompactionSummary(text, input.maxWords)
      && !(end > nextMessage && text === previousSummary);
    const reportInvalid = (attempt: number) => input.onInvalidSummary?.({
      reason: compactionSummaryRejection(summary, input.maxWords, end > nextMessage && summary === previousSummary),
      words: (summary.match(/\S+/g) || []).length,
      chars: summary.length,
      attempt,
    });
    if (!valid(summary)) {
      reportInvalid(1);
      // One bounded repair attempt. Never truncate a handoff or advance the
      // checkpoint after an invalid response. Provider errors still propagate.
      const repairPrompt = `${prompt}\n\n[FORMAT_REPAIR]\nThe prior attempt was rejected. Return all 10 required numbered headings, plain text, with meaningful request/current-work/continuation details. Hard limit: ${input.maxWords} words and ${MAX_COMPACTION_SUMMARY_CHARS} characters, including headings. Do not omit constraints or output a truncated summary.`;
      if (compactionPromptFits(repairPrompt, tokenBudget, input.tokenizer)) {
        summary = normalizeCompactionSummary(await input.summarize(repairPrompt));
        if (input.isAborted?.()) return { compacted: false, reason: 'aborted' };
        if (!valid(summary)) reportInvalid(2);
      }
      if (!valid(summary)) return { compacted: false, reason: 'invalid_summary' };
    }
    previousSummary = summary;
    nextMessage = end;
    metadataIncluded = includeMetadata;
    passCount++;
  }

  await input.commit(previousSummary, passCount);
  return { compacted: true, summaryText: previousSummary, passCount };
}
