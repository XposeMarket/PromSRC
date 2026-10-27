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
 * Terminal snapshots are pruned once durable delivery/merge/cancel happened,
 * when no spawner can ever consume them, or after a terminal age limit.
 */
export function shouldDeleteExecutionSnapshot(
  record: Record<string, any>,
  now: number,
  maxTerminalAgeMs = SEVEN_DAYS_MS,
): boolean {
  if (!TERMINAL_STATES.includes(record?.state)) return false;
  if (record.mergedAt || record.deliveredAt || record.operatorCancelled || !record.spawnerSessionId) return true;
  return typeof record.completedAt === 'number' && now - record.completedAt > maxTerminalAgeMs;
}
