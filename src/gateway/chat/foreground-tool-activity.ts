export type ForegroundToolActivity = {
  name: string;
  kind: 'terminal' | 'background' | 'tool';
  startedAt: number;
  lastUpdateAt: number;
  openCalls: number;
};

type OpenCall = {
  id: string;
  step: string;
  name: string;
  kind: ForegroundToolActivity['kind'];
  startedAt: number;
  lastUpdateAt: number;
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
        open.push({ ...call, kind: toolKind(call.name), startedAt: at, lastUpdateAt: at });
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
      };
    },
  };
}

export function foregroundConnectionMessage(activity: ForegroundToolActivity | null, idleMs: number, now = Date.now()): string {
  if (!activity) return idleMs >= 30_000
    ? `Still connected. No new model or tool update for ${Math.round(idleMs / 1000)}s.`
    : 'Still connected. Waiting for the next update.';
  const quietSince = Math.max(Number(activity.startedAt || 0), Number(activity.lastUpdateAt || 0));
  const quietSeconds = Math.max(0, Math.round((now - quietSince) / 1000));
  // An open tool call proves the gateway is still awaiting its result. It does
  // not prove a child process is making progress, so avoid saying "running".
  if (activity.kind === 'terminal') return `Still connected. Terminal command is open; waiting for output (${quietSeconds}s since last tool update).`;
  if (activity.kind === 'background') return `Still connected. Waiting for background operation result (${quietSeconds}s).`;
  return `Still connected. Waiting for ${activity.name.replace(/_/g, ' ')} result (${quietSeconds}s).`;
}
