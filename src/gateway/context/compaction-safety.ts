import { estimateTextTokensForModel, type TokenizerFamily } from './model-context';

/** @deprecated Compatibility only: summaries are bounded by model capacity, not characters. */
export const MAX_COMPACTION_SUMMARY_CHARS = Number.POSITIVE_INFINITY;

export interface CompactionSummaryBudget {
  sourceTokens?: number;
  outputBudgetTokens?: number;
  tokenizer?: TokenizerFamily;
}

/** Guidance scales with the material retained; it is not a validation ceiling. */
export function adaptiveCompactionTargetTokens(sourceTokens: number, previousSummaryTokens: number, outputCapacity: number): number {
  return Math.max(1, Math.floor(Math.min(outputCapacity * 0.85, Math.max(256, (sourceTokens + previousSummaryTokens) * 0.45))));
}

function summaryBudgetRejection(text: string, budget: CompactionSummaryBudget): string {
  const tokens = estimateTextTokensForModel(text, budget.tokenizer);
  if (budget.outputBudgetTokens !== undefined && tokens > budget.outputBudgetTokens) return 'output_budget';
  if (budget.sourceTokens !== undefined) {
    // Small batches need room for the resume schema; substantial batches must
    // actually shrink, including the full previous handoff in the comparison.
    const limit = budget.sourceTokens < 512 ? budget.sourceTokens + 256 : Math.floor(budget.sourceTokens * 0.95);
    if (tokens > limit) return 'no_meaningful_shortening';
  }
  return '';
}

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
  // Models decorate headings unpredictably ("## 1) Pending tasks", "**1. X**",
  // "1. X" without a colon). Canonicalize recognizable headings so valid
  // handoffs are not rejected for formatting alone.
  const canonical = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return String(value || '').trim().split(/\r?\n/).map((line) => {
    const plain = line.trim().replace(/^#{1,6}\s*/, '').replace(/\*\*|__/g, '').trim();
    const match = plain.match(/^(\d{1,2})\s*[.):-]?\s*(.+?)\s*:?\s*$/);
    if (!match) return line;
    const index = Number(match[1]) - 1;
    const section = REQUIRED_SECTIONS[index];
    return section && canonical(match[2]) === canonical(section) ? `${index + 1}. ${section}:` : line;
  }).join('\n');
}

export function isUsableCompactionSummary(value: unknown, _maxWords = 0, budget: CompactionSummaryBudget = {}): value is string {
  const text = String(value || '').trim();
  if (!text || summaryBudgetRejection(text, budget)) return false;
  if (/\[\.\.\.truncated(?:[^\]]*)\]|\bCOMPACTION_(?:INCOMPLETE|FAILED)\b/i.test(text)) return false;
  const lines = text.split(/\r?\n/);
  const headings = REQUIRED_SECTIONS.map((section, index) => {
    const heading = `${index + 1}. ${section}:`;
    const matches = lines.flatMap((line, position) => line.trim() === heading ? [position] : []);
    return matches.length === 1 ? matches[0] : -1;
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

export function compactionSummaryRejection(value: string, _maxWords: number, unchanged: boolean, budget: CompactionSummaryBudget = {}): string {
  if (!value.trim()) return 'empty';
  if (unchanged) return 'unchanged';
  const budgetReason = summaryBudgetRejection(value, budget);
  if (budgetReason) return budgetReason;
  if (/\[\.\.\.truncated(?:[^\]]*)\]|\bCOMPACTION_(?:INCOMPLETE|FAILED)\b/i.test(value)) return 'truncated';
  return isUsableCompactionSummary(value) ? '' : 'sections_or_content';
}

export interface CompactionTransactionInput<T> {
  messages: T[];
  previousSummary: string;
  maxWords: number;
  numCtx: number;
  numPredict: number;
  tokenizer?: TokenizerFamily;
  renderPrompt: (messages: T[], previousSummary: string, includeMetadata: boolean) => string;
  renderSource?: (messages: T[], includeMetadata: boolean) => string;
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
  const sourceFor = (end: number, includeMetadata: boolean) => input.renderSource?.(input.messages.slice(nextMessage, end), includeMetadata) ?? JSON.stringify(input.messages.slice(nextMessage, end));
  const promptFor = (end: number, includeMetadata: boolean) => {
    const target = adaptiveCompactionTargetTokens(estimateTextTokensForModel(sourceFor(end, includeMetadata), input.tokenizer), estimateTextTokensForModel(previousSummary, input.tokenizer), input.numPredict);
    return input.renderPrompt(input.messages.slice(nextMessage, end), previousSummary, includeMetadata) + `\n\n[ADAPTIVE_LENGTH]\nAim for about ${target} tokens; this is guidance, not a hard limit. Preserve pending tasks, decisions, constraints and recovery artifacts from the full prior handoff and new material. Output capacity: ${input.numPredict} tokens. Shorten meaningfully without dropping continuity.`;
  };

  while (nextMessage < input.messages.length || !metadataIncluded) {
    if (input.isAborted?.()) return { compacted: false, reason: 'aborted' };
    const selected = nextMessage < input.messages.length
      ? selectCompactionBatch(nextMessage, input.messages.length, (end, includeMetadata) =>
        compactionPromptFits(promptFor(end, includeMetadata), tokenBudget, input.tokenizer))
      : null;
    const end = selected?.end ?? nextMessage;
    const includeMetadata = selected ? selected.includeFinalMetadata : nextMessage === input.messages.length;
    if (nextMessage < input.messages.length && !selected) return { compacted: false, reason: 'input_budget' };
    const batch = input.messages.slice(nextMessage, end);
    const sourceTokens = estimateTextTokensForModel(input.renderSource?.(batch, includeMetadata) ?? JSON.stringify(batch), input.tokenizer);
    const previousTokens = estimateTextTokensForModel(previousSummary, input.tokenizer);
    const prompt = promptFor(end, includeMetadata);
    if (!compactionPromptFits(prompt, tokenBudget, input.tokenizer)) return { compacted: false, reason: 'input_budget' };

    let summary = normalizeCompactionSummary(await input.summarize(prompt));
    if (input.isAborted?.()) return { compacted: false, reason: 'aborted' };
    const summaryBudget = { sourceTokens: sourceTokens + previousTokens, outputBudgetTokens: input.numPredict, tokenizer: input.tokenizer };
    const valid = (text: string) => isUsableCompactionSummary(text, input.maxWords, summaryBudget)
      && text !== previousSummary;
    const reportInvalid = (attempt: number) => input.onInvalidSummary?.({
      reason: compactionSummaryRejection(summary, input.maxWords, summary === previousSummary, summaryBudget),
      words: (summary.match(/\S+/g) || []).length,
      chars: summary.length,
      attempt,
    });
    if (!valid(summary)) {
      reportInvalid(1);
      // One bounded repair attempt. Never truncate a handoff or advance the
      // checkpoint after an invalid response. Provider errors still propagate.
      const repairPrompt = `${prompt}\n\n[FORMAT_REPAIR]\nThe prior attempt was rejected. Return all 10 required numbered headings, plain text, with meaningful request/current-work/continuation details. Meaningfully shorten the combined source and previous summary. The adaptive target is guidance; stay within ${input.numPredict} output tokens. Do not omit constraints or output a truncated summary.`;
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

  if (input.isAborted?.()) return { compacted: false, reason: 'aborted' };
  await input.commit(previousSummary, passCount);
  return { compacted: true, summaryText: previousSummary, passCount };
}
