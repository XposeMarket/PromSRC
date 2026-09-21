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

    const summary = String(await input.summarize(prompt) || '').trim();
    if (input.isAborted?.()) return { compacted: false, reason: 'aborted' };
    if (!isUsableCompactionSummary(summary, input.maxWords)
      || (end > nextMessage && summary === previousSummary)) {
      return { compacted: false, reason: 'invalid_summary' };
    }
    previousSummary = summary;
    nextMessage = end;
    metadataIncluded = includeMetadata;
    passCount++;
  }

  await input.commit(previousSummary, passCount);
  return { compacted: true, summaryText: previousSummary, passCount };
}
