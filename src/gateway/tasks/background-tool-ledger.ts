/**
 * Pure helpers for background-agent tool ledgers (#786 follow-up).
 * No I/O: callers persist the returned arrays.
 */
import crypto from 'node:crypto';

export interface LedgerCall { id: string; name: string; args: any }
export interface LedgerEvidence { id: string; name: string; result: string }
export interface LedgerLimits { maxEvidence?: number; maxPreviewChars?: number }

const TRUNCATION_MARKER = '…[truncated]';
const DEFAULT_MAX_EVIDENCE = 40;
const DEFAULT_PREVIEW_CHARS = 600;
const MARKER_RESERVE_CHARS = 64;
const TERMINAL_STATES = ['completed', 'failed', 'timed_out'];
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const CONSUMED_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a background run executes inside a workspace scope. Only an explicit
 * work_dir (or a scope inherited from a scoped spawner) sets scopedWorkDir; an
 * unscoped run keeps the global workspace plus the user's allowed_paths. Legacy
 * snapshots (scopedWorkDir undefined) resume scoped only when they carry
 * allowedWorkPaths, i.e. when they were spawned with an explicit scope.
 */
export function shouldScopeBackgroundRun(record: {
  workDir?: string;
  scopedWorkDir?: boolean;
  resumed?: boolean;
  allowedWorkPaths?: string[];
}): boolean {
  if (!record?.workDir) return false;
  if (record.scopedWorkDir === true) return true;
  if (record.scopedWorkDir === false) return false;
  return !!record.resumed && Array.isArray(record.allowedWorkPaths) && record.allowedWorkPaths.length > 0;
}

/** Explicit id (toolCallId / step id) or an anonymous id; never dropped. */
export function recordToolCall(outstanding: LedgerCall[], data: { id?: string; name: string; args?: any }): LedgerCall[] {
  const id = String(data.id || '').trim() || `anon:${data.name}:${crypto.randomUUID()}`;
  return [...outstanding, { id, name: data.name, args: data.args }];
}

function previewOf(value: unknown, maxChars: number): string {
  let text: string;
  if (typeof value === 'string') text = value;
  else {
    try { text = JSON.stringify(value) ?? String(value); } catch { text = String(value); }
  }
  return text.length > maxChars ? `${text.slice(0, maxChars)}${TRUNCATION_MARKER}` : text;
}

/**
 * Pairs a result with its call: exact id first, else the oldest outstanding
 * call with the same name (covers id-less emitters and mismatched ids).
 * An unmatched result removes nothing and never creates an outstanding call.
 */
export function recordToolResult(
  outstanding: LedgerCall[],
  evidence: LedgerEvidence[],
  data: { id?: string; name: string; result?: any },
  limits: LedgerLimits = {},
): { outstanding: LedgerCall[]; evidence: LedgerEvidence[] } {
  const id = String(data.id || '').trim();
  const maxEvidence = limits.maxEvidence ?? DEFAULT_MAX_EVIDENCE;
  const maxPreview = limits.maxPreviewChars ?? DEFAULT_PREVIEW_CHARS;
  let index = id ? outstanding.findIndex((call) => call.id === id) : -1;
  if (index < 0) index = outstanding.findIndex((call) => call.name === data.name);
  const remaining = index < 0 ? outstanding : outstanding.filter((_, i) => i !== index);
  const entry: LedgerEvidence = {
    id: id || `anon:${data.name}:${crypto.randomUUID()}`,
    name: data.name,
    result: previewOf(data.result, maxPreview),
  };
  return { outstanding: remaining, evidence: [...evidence, entry].slice(-maxEvidence) };
}

/** Compact `- name: preview` lines, newest kept, total capped; oldest dropped with a count line. */
export function formatResumeEvidence(evidence: LedgerEvidence[], maxChars = 6000): string {
  if (!evidence.length) return '(none)';
  const budget = Math.max(0, maxChars - MARKER_RESERVE_CHARS);
  const kept: string[] = [];
  let used = 0;
  for (let i = evidence.length - 1; i >= 0; i--) {
    const line = `- ${evidence[i].name}: ${evidence[i].result}`;
    if (used + line.length + 1 > budget) break;
    kept.unshift(line);
    used += line.length + 1;
  }
  const omitted = evidence.length - kept.length;
  return omitted > 0 ? [`(${omitted} earlier results omitted)`, ...kept].join('\n') : kept.join('\n');
}

/**
 * Boot-time pruning of terminal snapshots. A consumed result (merged,
 * delivered, cancelled, or with no spawner to consume it) is kept for a grace
 * window so a join right after a restart still returns the full result and
 * stays non-mergeable; any terminal snapshot is dropped after the age limit.
 * Running/queued snapshots are never pruned.
 */
export function shouldDeleteExecutionSnapshot(
  record: Record<string, any>,
  now: number,
  options: { consumedGraceMs?: number; maxTerminalAgeMs?: number } = {},
): boolean {
  if (!TERMINAL_STATES.includes(record?.state)) return false;
  const grace = options.consumedGraceMs ?? CONSUMED_GRACE_MS;
  const maxAge = options.maxTerminalAgeMs ?? SEVEN_DAYS_MS;
  const finishedAt = [record.completedAt, record.startedAt].find((v) => typeof v === 'number' && Number.isFinite(v));
  const consumedAt = [record.mergedAt, record.deliveredAt].find((v) => typeof v === 'number' && Number.isFinite(v)) ?? finishedAt;
  const consumed = !!(record.mergedAt || record.deliveredAt || record.operatorCancelled || !record.spawnerSessionId);
  if (consumed && typeof consumedAt === 'number' && now - consumedAt > grace) return true;
  return typeof finishedAt === 'number' && now - finishedAt > maxAge;
}
