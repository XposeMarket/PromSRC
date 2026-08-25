/**
 * Small, dependency-free policy helpers for the foreground Chat execution
 * owner.  Transport activity is intentionally not treated as semantic work:
 * an SSE heartbeat proves only that the connection is writable.
 */

export const MAIN_CHAT_ORPHAN_GRACE_MS = 2 * 60 * 1000;
export const MAIN_CHAT_SEMANTIC_STALL_MS = Math.max(
  30_000,
  Math.min(60 * 60 * 1000, Number(process.env.PROMETHEUS_MAIN_CHAT_SEMANTIC_STALL_MS || 10 * 60 * 1000)),
);
export const MAIN_CHAT_MAX_AGE_MS = Math.max(
  10 * 60 * 1000,
  Math.min(48 * 60 * 60 * 1000, Number(process.env.PROMETHEUS_MAIN_CHAT_MAX_AGE_MS || 6 * 60 * 60 * 1000)),
);

const NON_SEMANTIC_EVENTS = new Set([
  'heartbeat',
  'keepalive',
  'keep_alive',
  'ping',
  'runtime_heartbeat',
  'runtime_registered',
  'ui_preflight',
  'info',
  'warn',
  'progress_state',
  'tool_progress',
  'session_title',
]);

export function isMainChatSemanticProgressEvent(event: unknown): boolean {
  const normalized = String(event || '').trim().toLowerCase();
  return !!normalized && !NON_SEMANTIC_EVENTS.has(normalized);
}

export function isMainChatStreamOwnerOrphaned(input: {
  now?: number;
  startedAt: number;
  lastSemanticProgressAt?: number;
  streamActive: boolean;
  runtimePresent: boolean;
  leaseAcquiredAt?: number;
}): boolean {
  if (!input.streamActive || input.runtimePresent) return false;
  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
  const activityAt = Math.max(
    Number(input.lastSemanticProgressAt || 0),
    Number(input.leaseAcquiredAt || 0),
    Number(input.startedAt || 0),
  );
  return activityAt > 0 && now - activityAt > MAIN_CHAT_ORPHAN_GRACE_MS;
}

export function isMainChatSemanticProgressStalled(input: {
  now?: number;
  lastSemanticProgressAt?: number;
  streamActive: boolean;
  runtimePresent: boolean;
  runtimeStatus?: string;
  abortRequestedAt?: number;
  stallMs?: number;
}): boolean {
  if (!input.streamActive || !input.runtimePresent) return false;
  if (String(input.runtimeStatus || 'running') !== 'running' || input.abortRequestedAt) return false;
  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
  const lastProgressAt = Number(input.lastSemanticProgressAt || 0);
  const stallMs = Math.max(30_000, Number(input.stallMs || MAIN_CHAT_SEMANTIC_STALL_MS));
  return lastProgressAt > 0 && now - lastProgressAt > stallMs;
}

export function isMainChatExecutionAgeExceeded(input: {
  now?: number;
  startedAt: number;
  maxAgeMs?: number;
  streamActive: boolean;
}): boolean {
  if (!input.streamActive) return false;
  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
  const maxAgeMs = Math.max(10 * 60 * 1000, Number(input.maxAgeMs || MAIN_CHAT_MAX_AGE_MS));
  return Number(input.startedAt || 0) > 0 && now - Number(input.startedAt) > maxAgeMs;
}
