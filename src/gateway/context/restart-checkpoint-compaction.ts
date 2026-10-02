/**
 * Model-facing compaction for gateway-restart checkpoint messages.
 *
 * Every mid-turn restart persists a checkpoint row that carries the session's
 * background-agent receipts plus up to 6k chars of durable commentary. A turn
 * that restarts N times therefore replays N near-identical copies, and every
 * later turn keeps paying for them (one 2026-10-02 session: 18 checkpoints =
 * 46k of 71k replayed history tokens, 56 duplicated receipt lines).
 *
 * Policy (model payload only; persisted history/UI are untouched):
 *  - The newest checkpoint of a turn that has NOT finished yet stays in full:
 *    it is the live recovery evidence for the in-flight turn.
 *  - Every other checkpoint becomes a stub: header lines only, receipts block
 *    removed, commentary capped. A finished turn's own answer and commentary
 *    already describe the outcome.
 */

export const RESTART_CHECKPOINT_STUB_COMMENTARY_CHARS = 700;

const CHECKPOINT_PREFIX = /^\s*\[(?:Hot restart checkpoint: planned by this chat|Interrupted by gateway restart)\]/i;
const RECEIPTS_HEADER = /^Background agents spawned by this session\b/i;

export function isRestartCheckpointMessage(message: any): boolean {
  if (!message || (message.role !== 'assistant' && message.role !== 'ai')) return false;
  if (String(message.messageKind || '').trim() === 'restart_checkpoint') return true;
  const content = typeof message.content === 'string' ? message.content : '';
  return CHECKPOINT_PREFIX.test(content);
}

/** Remove the "Background agents spawned..." block and its `- bg_...` lines. */
export function stripBackgroundReceipts(text: string): string {
  const lines = String(text || '').split('\n');
  const out: string[] = [];
  let inReceipts = false;
  for (const line of lines) {
    if (RECEIPTS_HEADER.test(line.trim())) { inReceipts = true; continue; }
    if (inReceipts) {
      if (/^\s*- bg_/.test(line)) continue;
      inReceipts = false;
    }
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export type RestartCheckpointTreatment = 'full' | 'stub';

/**
 * Decide, per message index, how each restart checkpoint should be replayed.
 * Non-checkpoint indexes are absent from the map.
 */
export function planRestartCheckpointTreatment(messages: any[]): Map<number, RestartCheckpointTreatment> {
  const plan = new Map<number, RestartCheckpointTreatment>();
  let segmentStart = 0;
  const flushSegment = (endExclusive: number) => {
    const checkpointIdx: number[] = [];
    let lastCheckpoint = -1;
    let lastAnswer = -1;
    for (let i = segmentStart; i < endExclusive; i++) {
      const msg = messages[i];
      if (isRestartCheckpointMessage(msg)) { checkpointIdx.push(i); lastCheckpoint = i; }
      else if (msg?.role === 'assistant' || msg?.role === 'ai') lastAnswer = i;
    }
    if (!checkpointIdx.length) return;
    // A turn is finished once a regular assistant answer follows its last checkpoint.
    const finished = lastAnswer > lastCheckpoint;
    for (const idx of checkpointIdx) {
      plan.set(idx, !finished && idx === lastCheckpoint ? 'full' : 'stub');
    }
  };
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === 'user') {
      flushSegment(i);
      segmentStart = i + 1;
    }
  }
  flushSegment(messages.length);
  return plan;
}
