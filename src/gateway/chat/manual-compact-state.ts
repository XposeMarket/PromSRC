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
