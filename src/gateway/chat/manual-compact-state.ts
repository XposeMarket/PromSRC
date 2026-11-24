// Maintenance has an owner, but deliberately has no chat runtime, stream or restart job.
export const manualCompactions = new Map<string, { id: string; done: Promise<CompactReply> }>();
export type CompactStatus = 'running' | 'success' | 'failed' | 'skipped';
export type CompactReply = { status: Exclude<CompactStatus, 'running'>; message: string };
export const isCompactCommand = (value: unknown): boolean => typeof value === 'string' && /^\/compact(?:\s|$)/i.test(value.trim());
export const isCompactRow = (row: { messageKind?: string }): boolean => row.messageKind === 'manual_compact_command' || row.messageKind === 'manual_compact_status';
export const COMPACT_BUSY = 'This chat is busy. Send your message again when it is idle.';
export const compactLabels: Record<CompactStatus, string> = {
  running: 'Compacting context…', success: 'Context compacted. Send a message when you’re ready.',
  failed: 'Compaction did not finish. Your previous context is unchanged.', skipped: 'Nothing new to compact.',
};

// Type-only dependency keeps the maintenance helpers independent of session initialization.
import type { ChatMessage, Session } from '../session';

export function captureManualCompactionRollback(session: Session) {
  return {
    latestContextSummary: session.latestContextSummary, contextStartIndex: session.contextStartIndex,
    contextStartMessageId: session.contextStartMessageId, contextSummaryUpdatedAt: session.contextSummaryUpdatedAt,
    workingContextPackets: session.workingContextPackets, contextTokenEstimate: session.contextTokenEstimate,
    pendingCompaction: session.pendingCompaction,
  };
}

export function healOrphanedManualCompactions(sessionId: string, history: ChatMessage[], save: () => void): void {
  // A maintenance operation is never replayed after restart. Success is stored with its checkpoint.
  if (!manualCompactions.has(sessionId)) for (const row of history) {
    if (row.messageKind === 'manual_compact_status' && row.compactStatus === 'running') {
      row.compactStatus = 'failed'; row.content = compactLabels.failed; save();
    }
  }
}

export function getLastAssistantTimestamp(history: ChatMessage[]): number | undefined {
  if (!Array.isArray(history)) return undefined;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg?.role !== 'assistant' || isCompactRow(msg)) continue;
    const ts = Number(msg.timestamp || 0);
    return Number.isFinite(ts) && ts > 0 ? ts : Date.now();
  }
  return undefined;
}
