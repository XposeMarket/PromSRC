import { inferProviderForBareModel, parseProviderModelRef } from '../../agents/model-routing.js';

/** Provider/model a task card shows as its avatar logo. */
export interface TaskModelRef { providerId: string; model: string; source: string }

export interface TaskModelRefDeps {
  /** Model a session last answered with (index lookup); planned runs + task sessions. */
  sessionModel?: (sessionId: string) => { providerId?: string; model?: string } | null | undefined;
  /** Per-job model override of a schedule. */
  scheduleModel?: (scheduleId: string) => string | undefined;
  /** Configured route of a subagent / team member. */
  agentModel?: (agentId: string) => string | undefined;
  /** Global main-chat route, "provider/model". */
  primaryModel?: () => string | undefined;
  /** Active provider used for bare model ids that cannot be inferred. */
  defaultProvider?: () => string | undefined;
}

function refFrom(raw: unknown, source: string, deps: TaskModelRefDeps): TaskModelRef | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  const parsed = parseProviderModelRef(text);
  if (parsed) return { providerId: parsed.providerId, model: parsed.model, source };
  if (text.includes('/')) {
    const [providerId, ...rest] = text.split('/');
    return providerId.trim() ? { providerId: providerId.trim(), model: rest.join('/').trim(), source } : null;
  }
  const providerId = inferProviderForBareModel(text) || String(deps.defaultProvider?.() || '').trim();
  return providerId ? { providerId, model: text, source } : null;
}

/**
 * Best-known model for a task card, most specific evidence first:
 * actual (session that ran it) > explicit executor route > schedule override >
 * configured agent route > global main-chat route. null = genuinely unknown.
 */
export function resolveTaskModelRef(task: any, deps: TaskModelRefDeps = {}): TaskModelRef | null {
  if (!task || typeof task !== 'object') return null;
  const sessionId = String(task.sessionId || '').trim();
  const fromSession = (source: string) => {
    if (!sessionId || !deps.sessionModel) return null;
    try {
      const ref = deps.sessionModel(sessionId);
      const providerId = String(ref?.providerId || '').trim();
      return providerId ? { providerId, model: String(ref?.model || '').trim(), source } : null;
    } catch { return null; }
  };
  const safe = (fn: (() => string | undefined) | undefined) => { try { return fn?.(); } catch { return undefined; } };
  if (task.sourceKind === 'planned_chat') {
    return fromSession('session') || refFrom(safe(deps.primaryModel), 'primary', deps);
  }
  const agentId = String(task.teamSubagent?.agentId || task.subagentProfile || '').trim();
  const scheduleId = String(task.scheduleId || '').trim();
  return fromSession('session')
    || refFrom(task.executorProvider, 'executor', deps)
    || (scheduleId ? refFrom(safe(() => deps.scheduleModel?.(scheduleId)), 'schedule', deps) : null)
    || (agentId ? refFrom(safe(() => deps.agentModel?.(agentId)), 'agent', deps) : null)
    || refFrom(safe(deps.primaryModel), 'primary', deps);
}
