import crypto from 'crypto';

export type LiveRuntimeKind =
  | 'main_chat'
  | 'team_manager'
  | 'team_member'
  | 'cron'
  | 'heartbeat'
  | 'brain_thought'
  | 'brain_dream';

export interface LiveRuntimeRegistration {
  kind: LiveRuntimeKind;
  label: string;
  sessionId?: string;
  taskId?: string;
  teamId?: string;
  agentId?: string;
  scheduleId?: string;
  source?: string;
  chatId?: number;
  detail?: string;
  abortSignal?: { aborted: boolean };
  onAbort?: () => void;
}

export interface LiveRuntimeSnapshot {
  id: string;
  kind: LiveRuntimeKind;
  label: string;
  sessionId?: string;
  taskId?: string;
  teamId?: string;
  agentId?: string;
  scheduleId?: string;
  source?: string;
  chatId?: number;
  detail?: string;
  startedAt: number;
  abortable: boolean;
  abortRequestedAt?: number;
}

interface LiveRuntimeRecord extends LiveRuntimeSnapshot {
  abortSignal?: { aborted: boolean };
  onAbort?: () => void;
}

const activeRuntimes = new Map<string, LiveRuntimeRecord>();

function toSnapshot(record: LiveRuntimeRecord): LiveRuntimeSnapshot {
  return {
    id: record.id,
    kind: record.kind,
    label: record.label,
    sessionId: record.sessionId,
    taskId: record.taskId,
    teamId: record.teamId,
    agentId: record.agentId,
    scheduleId: record.scheduleId,
    source: record.source,
    chatId: record.chatId,
    detail: record.detail,
    startedAt: record.startedAt,
    abortable: record.abortable,
    abortRequestedAt: record.abortRequestedAt,
  };
}

export function registerLiveRuntime(registration: LiveRuntimeRegistration): string {
  const id = crypto.randomUUID();
  const record: LiveRuntimeRecord = {
    id,
    kind: registration.kind,
    label: String(registration.label || registration.kind),
    sessionId: registration.sessionId ? String(registration.sessionId) : undefined,
    taskId: registration.taskId ? String(registration.taskId) : undefined,
    teamId: registration.teamId ? String(registration.teamId) : undefined,
    agentId: registration.agentId ? String(registration.agentId) : undefined,
    scheduleId: registration.scheduleId ? String(registration.scheduleId) : undefined,
    source: registration.source ? String(registration.source) : undefined,
    chatId: Number.isFinite(Number(registration.chatId)) ? Number(registration.chatId) : undefined,
    detail: registration.detail ? String(registration.detail) : undefined,
    startedAt: Date.now(),
    abortable: !!registration.abortSignal || typeof registration.onAbort === 'function',
    abortSignal: registration.abortSignal,
    onAbort: registration.onAbort,
  };
  activeRuntimes.set(id, record);
  return id;
}

export function finishLiveRuntime(id: string): void {
  activeRuntimes.delete(String(id || ''));
}

export function getLiveRuntime(id: string): LiveRuntimeSnapshot | null {
  const record = activeRuntimes.get(String(id || ''));
  return record ? toSnapshot(record) : null;
}

export function listLiveRuntimes(): LiveRuntimeSnapshot[] {
  return Array.from(activeRuntimes.values())
    .sort((a, b) => b.startedAt - a.startedAt)
    .map(toSnapshot);
}

export function findLiveRuntime(
  predicate: (runtime: LiveRuntimeSnapshot) => boolean,
): LiveRuntimeSnapshot | null {
  for (const runtime of listLiveRuntimes()) {
    if (predicate(runtime)) return runtime;
  }
  return null;
}

export function abortLiveRuntime(id: string): { ok: boolean; runtime?: LiveRuntimeSnapshot; error?: string } {
  const record = activeRuntimes.get(String(id || ''));
  if (!record) return { ok: false, error: 'Runtime not found.' };
  if (!record.abortable) return { ok: false, runtime: toSnapshot(record), error: 'Runtime is not abortable.' };

  record.abortRequestedAt = Date.now();
  if (record.abortSignal) {
    record.abortSignal.aborted = true;
  }

  try {
    record.onAbort?.();
  } catch (err: any) {
    return {
      ok: false,
      runtime: toSnapshot(record),
      error: String(err?.message || err || 'Abort hook failed.'),
    };
  }

  return { ok: true, runtime: toSnapshot(record) };
}
