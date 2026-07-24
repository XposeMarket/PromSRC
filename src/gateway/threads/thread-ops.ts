import crypto from 'crypto';
import {
  flushSession,
  getChatModelRoute,
  getHistory,
  getSession,
  getSessionDisplayTitle,
  getWorkspace,
  listSessionSummaries,
  renameSession,
  searchSessionSummaries,
  sessionExists,
  setChatModelRoute,
  setSessionPinned,
  setWorkspace,
  touchSession,
} from '../session';
import { resolveChatModelRouteSource, resolveConfiguredMainChatRouteSource, validateChatModelRoute } from '../chat/chat-model-route';
import type { ResolvedTurnRouteSource } from '../chat/turn-route-snapshot';
import { handleMainChatGoalCommand } from '../main-chat-goals';
import { abortLiveRuntime, addPendingRuntimeSteerForSession, listLiveRuntimes } from '../live-runtime-registry';
import {
  cancelThreadSupervision,
  assertThreadSupervisionFollowUpAllowed,
  commitThreadSupervisionFollowUp,
  createThreadSupervision,
  getThreadSupervision,
  isThreadSupervisionFollowUpDuplicate,
  listThreadSupervisions,
  pauseThreadSupervision,
  resumeThreadSupervision,
  reviseThreadSupervision,
  resolveThreadSupervisionReview,
  updateThreadSupervision,
} from './thread-supervision';

export interface PrometheusThreadOpsDeps {
  runInteractiveTurn?: (...args: any[]) => Promise<any>;
  broadcastWS?: (data: any) => void;
}

type ManagedThreadRoute = {
  providerId: string;
  model: string;
  reasoningEffort?: string;
  accountId?: string;
};

function requestedRouteValue(input: any, defaults: any, keys: string[]): { present: boolean; value: any } {
  for (const source of [input, defaults]) {
    if (!source || typeof source !== 'object') continue;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(source, key)) return { present: true, value: source[key] };
    }
  }
  return { present: false, value: undefined };
}

function requestedRouteString(input: any, defaults: any, keys: string[]): { present: boolean; value?: string } {
  const requested = requestedRouteValue(input, defaults, keys);
  const value = String(requested.value ?? '').trim();
  return { present: requested.present, ...(value ? { value } : {}) };
}

/**
 * Turn a thread-creation request into a sticky chat route. No route fields
 * means no override: the chat continues to inherit Main Chat on every turn.
 */
export function resolveManagedThreadModelRoute(
  input: any,
  defaults: any,
  inherited: ResolvedTurnRouteSource = resolveConfiguredMainChatRouteSource(),
): ManagedThreadRoute | undefined {
  const provider = requestedRouteString(input, defaults, ['provider_id', 'providerId', 'provider']);
  const model = requestedRouteString(input, defaults, ['model']);
  const reasoning = requestedRouteString(input, defaults, ['reasoning_effort', 'reasoningEffort']);
  const account = requestedRouteString(input, defaults, ['account_id', 'accountId']);
  if (!provider.present && !model.present && !reasoning.present && !account.present) return undefined;

  const providerId = provider.value || String(inherited.providerId || '').trim();
  const providerConfig = inherited.config?.llm?.providers?.[providerId] || {};
  const modelName = model.value || (provider.present ? String(providerConfig.model || '').trim() : String(inherited.model || '').trim());
  if (!providerId || !modelName) {
    throw new Error('An explicit thread model route requires a provider and model. Supply provider_id and model, or configure a saved model for that provider.');
  }

  // Never carry Main Chat's account into a route for another provider.
  const sourceProvider = String(inherited.providerId || '').trim();
  const sourceAccount = sourceProvider === providerId ? String(inherited.accountId || '').trim() : '';
  return {
    providerId,
    model: modelName,
    ...(reasoning.present
      ? (reasoning.value ? { reasoningEffort: reasoning.value } : {})
      : (provider.present
        ? (providerConfig.reasoning_effort ? { reasoningEffort: String(providerConfig.reasoning_effort).trim() } : {})
        : (inherited.reasoningEffort ? { reasoningEffort: String(inherited.reasoningEffort).trim() } : {}))),
    ...((account.present ? account.value : sourceAccount)
      ? { accountId: account.present ? account.value! : sourceAccount }
      : {}),
  };
}

function activeRuntimeForSession(sessionId: string): any | null {
  return listLiveRuntimes()
    .filter((runtime) => String(runtime.sessionId || '') === sessionId)
    .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0))[0] || null;
}

function sessionRouteState(sessionId: string): Record<string, any> {
  try { return resolveChatModelRouteSource(sessionId).state; }
  catch { return { mode: getChatModelRoute(sessionId) ? 'explicit' : 'inherited', availability: 'unavailable' }; }
}

function sessionSummaryWithRuntime(session: any): Record<string, any> {
  return { ...session, runtime: activeRuntimeForSession(session.id), chatModelRoute: sessionRouteState(session.id) };
}

function sessionSnapshot(sessionId: string, includeHistory = false, historyLimit = 40): Record<string, any> {
  const session = getSession(sessionId);
  const runtime = activeRuntimeForSession(sessionId);
  const history = includeHistory
    ? getHistory(sessionId).slice(-Math.max(1, Math.min(200, historyLimit))).map((message: any) => ({
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
        messageKind: message.messageKind,
        fileChanges: message.fileChanges,
        canvasFiles: message.canvasFiles,
        artifacts: message.artifacts,
        generatedImages: message.generatedImages,
        generatedVideos: message.generatedVideos,
        processEntries: message.processEntries,
        toolLog: message.toolLog,
      }))
    : undefined;
  return {
    id: session.id,
    title: getSessionDisplayTitle(session),
    channel: session.channel,
    workspace: session.workspace,
    createdAt: session.createdAt,
    lastActiveAt: session.lastActiveAt,
    pinnedAt: session.pinnedAt || null,
    chatModelRoute: sessionRouteState(sessionId),
    messageCount: session.history.length,
    runtime,
    mainChatGoal: session.mainChatGoal || null,
    ...(history ? { history } : {}),
  };
}

function managedPrompt(prompt: string, objective: string, follow: boolean): string {
  const work = String(objective || prompt || '').trim();
  if (!work) return '';
  if (!follow || /^\/goal(?:\s|$)/i.test(work)) return work;
  return `/goal ${work}`;
}

function followUpFingerprint(targetSessionId: string, message: string): string {
  return crypto.createHash('sha256')
    .update(`${String(targetSessionId || '').trim()}\n${String(message || '').replace(/\s+/g, ' ').trim()}`)
    .digest('hex');
}

function runDetached(
  deps: PrometheusThreadOpsDeps,
  ownerSessionId: string,
  targetSessionId: string,
  prompt: string,
  supervisionId?: string,
): void {
  if (!deps.runInteractiveTurn) throw new Error('Interactive turn runtime is unavailable.');
  const origin = {
    channel: 'system',
    surface: 'automation',
    device: 'server',
    source: 'peer_session',
    chatId: ownerSessionId,
    label: 'Prometheus managed thread',
  };
  void deps.runInteractiveTurn(
    prompt,
    targetSessionId,
    () => undefined,
    undefined,
    undefined,
    `[PEER SESSION CONTEXT]\nThis turn was started by Prometheus session ${ownerSessionId}. Work only on the target thread's stated objective. Report durable progress in this target thread.`,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    origin,
  ).then((result: any) => {
    deps.broadcastWS?.({
      type: 'managed_thread_turn_complete',
      ownerSessionId,
      targetSessionId,
      supervisionId,
      summary: String(result?.text || '').slice(0, 2000),
    });
  }).catch((err: any) => {
    if (supervisionId) {
      updateThreadSupervision(supervisionId, {
        status: 'failed',
        finalSummary: `Failed to start target thread: ${String(err?.message || err)}`,
      });
    }
    deps.broadcastWS?.({
      type: 'managed_thread_update',
      ownerSessionId,
      targetSessionId,
      supervisionId,
      error: String(err?.message || err),
    });
  });
}

function createManagedThread(
  ownerSessionId: string,
  input: any,
  defaults: any,
  deps: PrometheusThreadOpsDeps,
): Record<string, any> {
  const title = String(input?.title || defaults?.title || 'New Prometheus thread').replace(/\s+/g, ' ').trim().slice(0, 80);
  const prompt = String(input?.prompt || input?.instruction || defaults?.prompt || '').trim();
  const objective = String(input?.objective || defaults?.objective || prompt).trim();
  const acceptanceCriteria = String(input?.acceptance_criteria || input?.acceptanceCriteria || defaults?.acceptance_criteria || defaults?.acceptanceCriteria || objective).trim();
  const follow = input?.follow !== undefined ? input.follow !== false : defaults?.follow !== false;
  const requestedId = String(input?.session_id || input?.sessionId || '').trim();
  const targetSessionId = requestedId || `prom_${crypto.randomUUID()}`;
  if (targetSessionId === ownerSessionId) throw new Error('Cannot create work in the owner session itself.');
  const requestedRoute = resolveManagedThreadModelRoute(input, defaults);
  const routeState = requestedRoute ? validateChatModelRoute(requestedRoute) : null;
  if (routeState && routeState.availability !== 'ready') {
    throw new Error(`Requested thread model route is unavailable: ${routeState.error || 'Choose a configured provider, model, and account.'}`);
  }
  const session = touchSession(targetSessionId, { channel: 'web', title });
  const chatModelRoute = requestedRoute
    ? setChatModelRoute(targetSessionId, {
        providerId: routeState!.effective.providerId,
        model: routeState!.effective.model,
        ...(routeState!.effective.reasoningEffort ? { reasoningEffort: routeState!.effective.reasoningEffort } : {}),
        ...(routeState!.effective.accountId ? { accountId: routeState!.effective.accountId } : {}),
      })
    : undefined;
  const workspace = String(input?.workspace || defaults?.workspace || getWorkspace(ownerSessionId)).trim();
  if (workspace) setWorkspace(targetSessionId, workspace);
  flushSession(targetSessionId);

  const supervision = follow && (objective || prompt)
    ? createThreadSupervision({
        ownerSessionId,
        targetSessionId,
        targetTitle: title,
        objective: objective || prompt,
        acceptanceCriteria: acceptanceCriteria || objective || prompt,
        maxReviews: input?.max_reviews ?? defaults?.max_reviews,
        maxFollowUps: input?.max_follow_ups ?? defaults?.max_follow_ups,
        maxElapsedMs: input?.max_elapsed_ms ?? defaults?.max_elapsed_ms,
        minReviewIntervalMs: input?.min_review_interval_ms ?? defaults?.min_review_interval_ms,
        maxConsecutiveNoProgress: input?.max_consecutive_no_progress ?? defaults?.max_consecutive_no_progress,
      })
    : null;
  const turnPrompt = managedPrompt(prompt, objective, follow);
  if (turnPrompt) runDetached(deps, ownerSessionId, targetSessionId, turnPrompt, supervision?.id);

  return {
    id: session.id,
    title,
    workspace,
    started: !!turnPrompt,
    follow,
    chatModelRoute: chatModelRoute
      ? { mode: 'explicit', override: chatModelRoute, effective: routeState!.effective, availability: 'ready' }
      : resolveChatModelRouteSource(targetSessionId).state,
    supervision,
  };
}

const THREAD_LINK_ACTION_LABELS: Record<string, string> = {
  create: 'Thread created',
  start: 'Thread created',
  create_many: 'Thread created',
  start_many: 'Thread created',
  send: 'Thread messaged',
  chat: 'Thread messaged',
  steer: 'Thread steered',
  interrupt: 'Thread paused',
  stop: 'Thread paused',
  rename: 'Thread renamed',
  pin: 'Thread pinned',
  unpin: 'Thread unpinned',
  follow: 'Thread followed',
  revise_supervision: 'Supervision updated',
  pause_supervision: 'Supervision paused',
  resume_supervision: 'Supervision resumed',
  unfollow: 'Thread unfollowed',
};

export function buildPrometheusThreadLinksArtifact(args: any, output: any): Record<string, any> | null {
  const action = String(args?.action || '').trim().toLowerCase();
  const label = THREAD_LINK_ACTION_LABELS[action];
  if (!label) return null;

  const candidates: any[] = [
    output?.session,
    ...(Array.isArray(output?.created) ? output.created : []),
    output?.supervision,
    ...(Array.isArray(output?.cancelled) ? output.cancelled : []),
    ...(Array.isArray(output?.supervisions) ? output.supervisions : []),
    output?.runtime,
  ].filter(Boolean);
  const requestedTarget = String(args?.session_id || args?.sessionId || args?.target_session_id || '').trim();
  if (requestedTarget) candidates.push({ id: requestedTarget, sessionId: requestedTarget });

  const seen = new Set<string>();
  const items: Array<Record<string, any>> = [];
  for (const candidate of candidates) {
    const sessionId = String(
      candidate?.targetSessionId
      || candidate?.sessionId
      || candidate?.id
      || candidate?.runtime?.sessionId
      || '',
    ).trim();
    if (!sessionId || seen.has(sessionId) || !sessionExists(sessionId)) continue;
    seen.add(sessionId);
    const session = getSession(sessionId);
    const goalStatus = String(session.mainChatGoal?.status || '').trim();
    items.push({
      sessionId,
      title: getSessionDisplayTitle(session) || String(candidate?.title || sessionId),
      label,
      subtitle: goalStatus === 'active' || goalStatus === 'restarting'
        ? 'Working autonomously'
        : action === 'unfollow'
          ? 'Thread remains available'
          : 'Prometheus chat session',
      status: goalStatus || String(candidate?.status || ''),
    });
  }
  if (!items.length) return null;
  return {
    id: `thread-links:${action}:${items.map((item) => item.sessionId).sort().join(',')}`,
    type: 'thread_links',
    title: items.length === 1 ? label : `${items.length} threads touched`,
    items,
    createdAt: new Date().toISOString(),
  };
}

export async function executePrometheusThreadOps(
  ownerSessionId: string,
  args: any,
  deps: PrometheusThreadOpsDeps,
): Promise<Record<string, any>> {
  const action = String(args?.action || '').trim().toLowerCase();
  if (!action) throw new Error('action is required.');

  if (action === 'list') {
    const page: any = listSessionSummaries({
      channel: args?.channel || undefined,
      includeAutomated: args?.include_automated === true,
      limit: Math.max(1, Math.min(200, Number(args?.limit) || 50)),
      offset: Math.max(0, Number(args?.offset) || 0),
    });
    return {
      ...page,
      sessions: page.sessions.map(sessionSummaryWithRuntime),
    };
  }

  if (action === 'find' || action === 'search') {
    const query = String(args?.query || args?.q || '').trim();
    if (!query) throw new Error('query is required.');
    return {
      query,
      sessions: searchSessionSummaries(query, {
        channel: args?.channel || undefined,
        limit: Math.max(1, Math.min(200, Number(args?.limit) || 50)),
      }).map(sessionSummaryWithRuntime),
    };
  }

  if (action === 'create' || action === 'start') {
    return { session: createManagedThread(ownerSessionId, args, args, deps) };
  }

  if (action === 'create_many' || action === 'start_many') {
    const inputs = Array.isArray(args?.threads) ? args.threads.slice(0, 24) : [];
    if (!inputs.length) throw new Error('threads must contain at least one thread specification.');
    const created = inputs.map((input: any) => createManagedThread(ownerSessionId, input, args, deps));
    return { created, count: created.length };
  }

  if (action === 'supervisions' || action === 'followed') {
    return {
      supervisions: listThreadSupervisions({
        ownerSessionId: args?.all_owners === true ? undefined : ownerSessionId,
        status: args?.status || undefined,
        includeTerminal: args?.include_terminal !== false,
        limit: args?.limit,
      }),
    };
  }

  if (action === 'review_decision') {
    return {
      supervision: resolveThreadSupervisionReview({
        ownerSessionId,
        supervisionId: String(args?.supervision_id || '').trim(),
        reviewEventId: String(args?.review_event_id || '').trim(),
        decision: args?.decision,
        progressMade: args?.progress_made,
        reason: String(args?.reason || '').trim(),
        evidence: Array.isArray(args?.evidence) ? args.evidence : [],
        broadcast: deps.broadcastWS,
      }),
    };
  }

  if (action === 'revise_supervision') {
    const supervisionId = String(args?.supervision_id || '').trim();
    if (!supervisionId) throw new Error('supervision_id is required.');
    return { supervision: reviseThreadSupervision({
      ownerSessionId,
      supervisionId,
      objective: args?.objective,
      acceptanceCriteria: args?.acceptance_criteria || args?.acceptanceCriteria,
    }) };
  }

  if (action === 'pause_supervision') {
    const supervisionId = String(args?.supervision_id || '').trim();
    const current = getThreadSupervision(supervisionId);
    if (!current || current.ownerSessionId !== ownerSessionId) throw new Error('Supervision not found.');
    return { supervision: pauseThreadSupervision(supervisionId, String(args?.reason || 'Paused by supervising user.')) };
  }

  if (action === 'resume_supervision') {
    const supervisionId = String(args?.supervision_id || '').trim();
    return { supervision: resumeThreadSupervision(supervisionId, ownerSessionId) };
  }

  const targetSessionId = String(args?.session_id || args?.sessionId || args?.target_session_id || '').trim();
  if (!targetSessionId && action !== 'unfollow') throw new Error('session_id is required.');
  if (targetSessionId === ownerSessionId) throw new Error('Peer-thread operations cannot target the current owner session.');
  if (targetSessionId && !sessionExists(targetSessionId)) throw new Error(`Session not found: ${targetSessionId}`);

  if (action === 'read' || action === 'status') {
    return {
      session: sessionSnapshot(targetSessionId, action === 'read' || args?.include_history === true, Number(args?.history_limit) || 60),
      supervisions: listThreadSupervisions({ targetSessionId, includeTerminal: true }),
    };
  }

  if (action === 'rename') {
    const title = String(args?.title || '').trim();
    if (!title) throw new Error('title is required.');
    return { session: renameSession(targetSessionId, title) };
  }

  if (action === 'pin' || action === 'unpin') {
    return { session: setSessionPinned(targetSessionId, action === 'pin') };
  }

  if (action === 'steer') {
    const message = String(args?.message || args?.prompt || '').trim();
    if (!message) throw new Error('message is required.');
    const supervision = assertThreadSupervisionFollowUpAllowed({
      ownerSessionId,
      targetSessionId,
      supervisionId: args?.supervision_id,
      broadcast: deps.broadcastWS,
    });
    const fingerprint = followUpFingerprint(targetSessionId, message);
    if (supervision && isThreadSupervisionFollowUpDuplicate(supervision.id, fingerprint)) {
      return { ok: true, deduped: true, supervision: getThreadSupervision(supervision.id) };
    }
    const result = addPendingRuntimeSteerForSession(targetSessionId, {
      message,
      source: `peer_session:${ownerSessionId}`,
      kind: args?.kind || 'correction',
      requiresWorkerResponse: args?.requires_response !== false,
      responseMode: args?.requires_response === false ? 'silent' : 'worker_reply',
    });
    if (!result.ok) throw new Error(result.error || 'Could not steer target thread.');
    if (supervision) commitThreadSupervisionFollowUp(supervision.id, fingerprint);
    return result as any;
  }

  if (action === 'send' || action === 'chat') {
    const message = String(args?.message || args?.prompt || '').trim();
    if (!message) throw new Error('message is required.');
    if (activeRuntimeForSession(targetSessionId)) {
      throw new Error('Target thread is currently running. Use action="steer" to message it live.');
    }
    if (!deps.runInteractiveTurn) throw new Error('Interactive turn runtime is unavailable.');
    const supervision = assertThreadSupervisionFollowUpAllowed({
      ownerSessionId,
      targetSessionId,
      supervisionId: args?.supervision_id,
      broadcast: deps.broadcastWS,
    });
    const fingerprint = followUpFingerprint(targetSessionId, message);
    if (supervision && isThreadSupervisionFollowUpDuplicate(supervision.id, fingerprint)) {
      return { queued: false, deduped: true, supervision: getThreadSupervision(supervision.id) };
    }
    if (args?.wait === true) {
      const result = await deps.runInteractiveTurn(
        message,
        targetSessionId,
        () => undefined,
        undefined,
        undefined,
        `[PEER SESSION CONTEXT]\nMessage sent by Prometheus session ${ownerSessionId}. Reply and act in this target thread.`,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { channel: 'system', surface: 'automation', device: 'server', source: 'peer_session', chatId: ownerSessionId, label: 'Prometheus peer thread' },
      );
      if (supervision) commitThreadSupervisionFollowUp(supervision.id, fingerprint);
      return { queued: false, completed: true, result };
    }
    runDetached(deps, ownerSessionId, targetSessionId, message);
    if (supervision) commitThreadSupervisionFollowUp(supervision.id, fingerprint);
    return { queued: true, sessionId: targetSessionId };
  }

  if (action === 'follow') {
    const objective = String(args?.objective || args?.prompt || '').trim();
    if (!objective) throw new Error('objective is required.');
    const target = getSession(targetSessionId);
    const supervision = createThreadSupervision({
      ownerSessionId,
      targetSessionId,
      targetTitle: getSessionDisplayTitle(target),
      objective,
      acceptanceCriteria: String(args?.acceptance_criteria || args?.acceptanceCriteria || objective).trim(),
      maxReviews: args?.max_reviews,
      maxFollowUps: args?.max_follow_ups,
      maxElapsedMs: args?.max_elapsed_ms,
      minReviewIntervalMs: args?.min_review_interval_ms,
      maxConsecutiveNoProgress: args?.max_consecutive_no_progress,
    });
    if (!target.mainChatGoal || !['active', 'restarting'].includes(target.mainChatGoal.status)) {
      if (activeRuntimeForSession(targetSessionId)) {
        const steer = addPendingRuntimeSteerForSession(targetSessionId, {
          message: `After the current turn, continue autonomously until this objective is complete: ${objective}`,
          source: `peer_session:${ownerSessionId}`,
          kind: 'constraint',
          requiresWorkerResponse: true,
          responseMode: 'worker_reply',
        });
        return { supervision, activation: steer };
      }
      runDetached(deps, ownerSessionId, targetSessionId, `/goal ${objective}`, supervision.id);
    }
    return { supervision, activation: { queued: true } };
  }

  if (action === 'unfollow') {
    const supervisionId = String(args?.supervision_id || '').trim();
    if (supervisionId) {
      const current = getThreadSupervision(supervisionId);
      if (!current || (current.ownerSessionId !== ownerSessionId && args?.all_owners !== true)) {
        throw new Error('Supervision not found.');
      }
      return { supervision: cancelThreadSupervision(supervisionId) };
    }
    const target = String(args?.session_id || args?.target_session_id || '').trim();
    const records = listThreadSupervisions({ ownerSessionId, targetSessionId: target, status: 'active' });
    return { cancelled: records.map((record) => cancelThreadSupervision(record.id)).filter(Boolean) };
  }

  if (action === 'interrupt' || action === 'stop') {
    const runtimes = listLiveRuntimes().filter((runtime) => String(runtime.sessionId || '') === targetSessionId);
    const aborted = runtimes.map((runtime) => abortLiveRuntime(runtime.id));
    const goalResult = handleMainChatGoalCommand(targetSessionId, `/goal pause ${String(args?.reason || 'Paused by supervising Prometheus thread').trim()}`);
    const supervisions = listThreadSupervisions({ ownerSessionId, targetSessionId, status: 'active' })
      .map((record) => cancelThreadSupervision(record.id))
      .filter(Boolean);
    return { aborted, goal: goalResult.goal, supervisions };
  }

  throw new Error(`Unsupported prometheus_thread_ops action: ${action}`);
}
