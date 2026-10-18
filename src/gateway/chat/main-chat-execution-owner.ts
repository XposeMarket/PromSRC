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
export const MAIN_CHAT_ABORT_SETTLE_GRACE_MS = 30_000;

/**
 * An abort signal is advisory: a provider/request promise may ignore it or
 * take a long time to unwind.  Once this grace period expires, reconciliation
 * must settle the runtime even if the visible stream has already closed.
 */
export function isMainChatAbortSettleExpired(input: {
  now?: number;
  abortRequestedAt?: number;
  settleMs?: number;
}): boolean {
  const requestedAt = Number(input.abortRequestedAt || 0);
  if (!requestedAt) return false;
  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
  const settleMs = Math.max(1_000, Number(input.settleMs || MAIN_CHAT_ABORT_SETTLE_GRACE_MS));
  return now - requestedAt > settleMs;
}

export type MainChatAbortSettlement = 'wait' | 'recover' | 'finish';

/** Choose the terminal action independently of whether the delivery stream remains visible. */
export function resolveMainChatAbortSettlement(input: {
  now?: number;
  abortRequestedAt?: number;
  abortSource?: string;
  settleMs?: number;
}): MainChatAbortSettlement {
  if (!isMainChatAbortSettleExpired(input)) return 'wait';
  return input.abortSource === 'main_chat_owner_watchdog' ? 'recover' : 'finish';
}

const NON_SEMANTIC_EVENTS = new Set([
  'heartbeat',
  'background_wait',
  'keepalive',
  'keep_alive',
  'ping',
  'runtime_heartbeat',
  'runtime_registered',
  'ui_preflight',
  'info',
  'warn',
  'progress_state',
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

export function isLiveBackgroundJoin(input: {
  lastSemanticEvent?: string;
  lastSemanticProgressAt?: number;
  now?: number;
  activeBackgroundCount: number;
}): boolean {
  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
  return (input.lastSemanticEvent === 'background_wait' || input.lastSemanticEvent === 'active_tool_wait')
    && input.activeBackgroundCount > 0
    && Number(input.lastSemanticProgressAt || 0) > 0
    && now - Number(input.lastSemanticProgressAt) < 2 * 60_000;
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

export type BlockingWait = { name: string; args?: Record<string, any>; startedAt: number; id?: string };
export const BLOCKING_WAIT_DEFAULT_MS = 15 * 60_000;
export const BLOCKING_WAIT_CAP_MS = 30 * 60_000;
export const BLOCKING_WAIT_GRACE_MS = 2 * 60_000;

/** A transport heartbeat must never renew this fixed, tool-owned deadline. */
export function effectiveBlockingWaitDeadline(wait: BlockingWait): number {
  const action = String(wait.args?.action || '').toLowerCase();
  const unconditional = new Set(['process_wait', 'background_wait', 'background_join',
    'await_prometheus_question_response', 'ask_prometheus_questions', 'request_browser_login',
    'request_final_action_approval']);
  const blocking = unconditional.has(wait.name)
    || (wait.name === 'background_ops' && ['wait', 'join'].includes(action))
    || (['workspace_run', 'video_project'].includes(wait.name) && action === 'wait');
  if (!blocking || !Number.isFinite(wait.startedAt)) return 0;
  const declared = Number(wait.args?.timeout_ms ?? wait.args?.wait_ms ?? wait.args?.timeoutMs ?? BLOCKING_WAIT_DEFAULT_MS);
  const timeout = Number.isFinite(declared) && declared > 0 ? declared : BLOCKING_WAIT_DEFAULT_MS;
  return wait.startedAt + Math.min(timeout, BLOCKING_WAIT_CAP_MS) + BLOCKING_WAIT_GRACE_MS;
}

export function isBlockingWaitInFlight(waits: BlockingWait[], now = Date.now()): boolean {
  return waits.some((wait) => effectiveBlockingWaitDeadline(wait) > now);
}

/** Track all parallel calls by id, falling back to the runtime's name/step envelope. */
export function updateBlockingWaits(waits: BlockingWait[], event: string, data: any, at: number): BlockingWait[] {
  const name = String(data?.action || data?.name || data?.toolName || '');
  const id = String(data?.toolCallId || data?.tool_call_id || data?.callId || `${name}:${data?.stepNum ?? ''}`);
  const key = (wait: BlockingWait) => String((wait as BlockingWait & { id?: string }).id || '');
  if (['final', 'done', 'error'].includes(event)) return [];
  if (event === 'background_wait') {
    if (data?.finished || data?.pending === 0) return waits.filter((wait) => key(wait) !== 'finalization_join');
    if (waits.some((wait) => key(wait) === 'finalization_join')) return waits;
    return [...waits, { name: 'background_join', startedAt: at - Math.max(0, Number(data?.waitedMs || 0)), id: 'finalization_join', args: data } as BlockingWait];
  }
  if (event === 'tool_result') {
    const index = waits.findIndex((wait) => key(wait) === id);
    return index < 0 ? waits : waits.filter((_, i) => i !== index);
  }
  if (event !== 'tool_call') return waits;
  let args = data?.args || data?.arguments || data?.input || {};
  if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
  const wait = { name, args, startedAt: at, id };
  return effectiveBlockingWaitDeadline(wait) ? [...waits, wait] : waits;
}
