export type ForegroundToolActivity = {
  name: string;
  kind: 'terminal' | 'background' | 'tool' | 'wait';
  startedAt: number;
  lastUpdateAt: number;
  openCalls: number;
  /** For kind 'wait': when the declared wait elapses (clients show a countdown). */
  waitUntil?: number;
};

/** The "Still connected" pill only appears after this much visible quiet. */
export const QUIET_CONNECTION_PILL_MS = 60_000;
const MAX_TOOL_WAIT_MS = 30 * 60 * 1000;
const WAIT_TOOL_NAMES = /^(?:background_wait|bg_wait|process_wait|wait_for_background|background_ops_wait)$/;

/** Mirrors web-ui/src/features/chat/tool-wait-countdown.js toolWaitDurationMs. */
export function toolWaitDurationMs(toolName: string, rawArgs: unknown): number {
  const name = String(toolName || '').trim().toLowerCase();
  if (!name || name === 'await_prometheus_question_response') return 0;
  let args: any = rawArgs;
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch { args = {}; }
  }
  if (!args || typeof args !== 'object') args = {};
  const action = String(args.action || '').trim().toLowerCase();
  if (!WAIT_TOOL_NAMES.test(name) && action !== 'wait') return 0;
  const ms = Number(args.wait_ms ?? args.waitMs ?? args.timeout_ms ?? args.timeoutMs);
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(Math.floor(ms), MAX_TOOL_WAIT_MS);
}

type OpenCall = {
  id: string;
  step: string;
  name: string;
  kind: ForegroundToolActivity['kind'];
  startedAt: number;
  lastUpdateAt: number;
  waitUntil?: number;
};

function toolKind(name: string): ForegroundToolActivity['kind'] {
  if (/^(?:run_command|workspace_run|terminal|execute_command|shell|command)$/i.test(name)) return 'terminal';
  if (/(?:background|bg_ops|subagent|agent_control|parallel_agents)/i.test(name)) return 'background';
  return 'tool';
}

export function createForegroundToolActivityTracker() {
  const open: OpenCall[] = [];
  const identity = (data: any) => ({
    id: String(data?.toolCallId || data?.tool_call_id || data?.callId || '').trim(),
    step: String(data?.stepNum ?? '').trim(),
    name: String(data?.action || data?.name || data?.toolName || '').trim(),
  });
  const matchingIndex = (data: any) => {
    const call = identity(data);
    if (call.id) {
      const byId = open.findIndex((item) => item.id === call.id);
      if (byId >= 0) return byId;
    }
    if (call.step) {
      const byStep = open.findIndex((item) => item.step === call.step && (!call.name || item.name === call.name));
      if (byStep >= 0) return byStep;
    }
    return call.name ? open.findIndex((item) => item.name === call.name) : -1;
  };
  return {
    record(event: string, data: any, at = Date.now()) {
      if (event === 'tool_call') {
        const call = identity(data);
        if (!call.name) return;
        const waitMs = toolWaitDurationMs(call.name, data?.args ?? data?.arguments ?? data?.params ?? data?.input);
        open.push(waitMs > 0
          ? { ...call, kind: 'wait', startedAt: at, lastUpdateAt: at, waitUntil: at + waitMs }
          : { ...call, kind: toolKind(call.name), startedAt: at, lastUpdateAt: at });
      } else if (event === 'tool_progress' || event === 'process_run_output') {
        const index = matchingIndex(data);
        if (index >= 0) open[index].lastUpdateAt = at;
        else if (open.length) open[open.length - 1].lastUpdateAt = at;
      } else if (event === 'tool_result') {
        const index = matchingIndex(data);
        if (index >= 0) open.splice(index, 1);
      } else if (event === 'final' || event === 'done' || event === 'error') {
        open.length = 0;
      }
    },
    current(): ForegroundToolActivity | null {
      if (!open.length) return null;
      const latest = open[open.length - 1];
      return {
        name: latest.name,
        kind: latest.kind,
        startedAt: latest.startedAt,
        lastUpdateAt: latest.lastUpdateAt,
        openCalls: open.length,
        ...(latest.waitUntil ? { waitUntil: latest.waitUntil } : {}),
      };
    },
  };
}

/**
 * Returns '' unless the turn has been visibly quiet for QUIET_CONNECTION_PILL_MS.
 * A known-duration wait never gets a pill (clients render a countdown on the
 * tool summary row) until it overruns its deadline by the quiet window.
 */
export function foregroundConnectionMessage(activity: ForegroundToolActivity | null, idleMs: number, now = Date.now()): string {
  if (!activity) return idleMs >= QUIET_CONNECTION_PILL_MS
    ? `Still connected. No new model or tool update for ${Math.round(idleMs / 1000)}s.`
    : '';
  const quietSince = Math.max(Number(activity.startedAt || 0), Number(activity.lastUpdateAt || 0));
  if (activity.kind === 'wait') {
    const waitUntil = Number(activity.waitUntil || 0);
    if (!waitUntil || now - waitUntil < QUIET_CONNECTION_PILL_MS) return '';
    return `Still connected. Wait passed its timeout; waiting for the result (${Math.max(0, Math.round((now - quietSince) / 1000))}s).`;
  }
  if (now - quietSince < QUIET_CONNECTION_PILL_MS) return '';
  const quietSeconds = Math.max(0, Math.round((now - quietSince) / 1000));
  // An open tool call proves the gateway is still awaiting its result. It does
  // not prove a child process is making progress, so avoid saying "running".
  if (activity.kind === 'terminal') return `Still connected. Terminal command is open; waiting for output (${quietSeconds}s since last tool update).`;
  if (activity.kind === 'background') return `Still connected. Waiting for background operation result (${quietSeconds}s).`;
  return `Still connected. Waiting for ${activity.name.replace(/_/g, ' ')} result (${quietSeconds}s).`;
}
