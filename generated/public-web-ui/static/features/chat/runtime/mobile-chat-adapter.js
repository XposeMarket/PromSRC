import {
  acquireChatRuntime,
  getChatRuntime,
  installChatRuntimeEvictionLoop,
} from './chat-runtime.js';
import { createQueuedPromptTools } from './queued-prompt.js';

installChatRuntimeEvictionLoop();

export function createMobileChatRuntimeAdapter({
  windowRef = globalThis.window,
  defaultSessionId,
  getState,
  getSessionTarget = () => null,
  getActiveGatewayId = () => '',
  loadHistoryPage,
  mergeHistory = (older, current) => [...older, ...current],
  mergeOlderHistory = (_sessionId, older, current) => [...older, ...current],
  normalizeSkillIds,
  normalizeSkillRefs,
} = {}) {
  if (!windowRef || typeof getState !== 'function') {
    throw new TypeError('Mobile chat runtime adapter requires a window and state reader.');
  }
  const promptTools = createQueuedPromptTools({
    normalizeSkillIds,
    normalizeSkillRefs,
    createId: () => `mq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
  });

  function identity(sessionId) {
    const sid = String(sessionId || getState().activeSessionId || defaultSessionId).trim() || defaultSessionId;
    const bound = getSessionTarget(sid);
    const gatewayId = String(
      bound?.gatewayId
      || windowRef.__pmMobileActiveSessionGateway
      || windowRef.__pmMobileActiveGatewayId
      || getActiveGatewayId()
      || 'gateway:current',
    ).trim();
    return { gatewayId, sessionId: sid };
  }

  function runtimeFor(sessionId) {
    return getChatRuntime(identity(sessionId));
  }

  function mobileRuntimeRole(message) {
    const role = String(message?.role || '').trim().toLowerCase();
    if (role === 'ai' || role === 'assistant') return 'assistant';
    if (role === 'user') return 'user';
    return role;
  }

  function mobileRuntimeRequestId(message, event = null) {
    return String(
      message?._clientRequestId
      || message?.clientRequestId
      || event?.clientRequestId
      || '',
    ).trim();
  }

  function mobileRuntimeTurnId(message, event = null, fallbackRole = '') {
    const explicit = String(message?.messageId || message?.turnId || message?.id || '').trim();
    if (explicit) return explicit;
    const requestId = mobileRuntimeRequestId(message, event);
    const role = mobileRuntimeRole(message) || String(fallbackRole || '').trim().toLowerCase();
    if (!requestId || !['user', 'assistant'].includes(role)) return '';
    // clientRequestId identifies one request, not one transcript row. Mobile
    // intentionally gives the optimistic user row and speculative assistant
    // row the same request id. Give the shared runtime role-scoped row ids so
    // stream begin/delta reconciliation can never replace the user row.
    return `mobile-request:${requestId}:${role}`;
  }

  function mobileRuntimeHistory(thread) {
    return (Array.isArray(thread) ? thread : []).map((message) => {
      if (!message || typeof message !== 'object') return message;
      if (message.messageId || message.turnId || message.id) return message;
      const turnId = mobileRuntimeTurnId(message);
      return turnId ? { ...message, messageId: turnId } : message;
    });
  }

  function setRunning(sessionId, running) {
    const sid = identity(sessionId).sessionId;
    const state = getState();
    if (!(state.drawerRunSessionIds instanceof Set)) state.drawerRunSessionIds = new Set();
    if (running) state.drawerRunSessionIds.add(sid);
    else state.drawerRunSessionIds.delete(sid);
    runtimeFor(sid).setLifecycle({
      phase: running ? 'streaming' : 'idle',
      background: String(state.activeSessionId || '') !== sid && running === true,
      lastActivityAt: Date.now(),
    });
  }

  function setPaging(sessionId, patch) {
    runtimeFor(sessionId).setPaging(patch);
  }

  function reconcileQuestion(sessionId, id, status, record) {
    const runtime = runtimeFor(sessionId);
    if (status && status !== 'pending' && status !== 'submitting') return runtime.resolveQuestion(id, status, record);
    return runtime.upsertQuestion(record);
  }

  function upsertApproval(sessionId, record) {
    try { return runtimeFor(sessionId).upsertApproval(record); } catch { return null; }
  }

  function upsertQuestion(sessionId, record) {
    try { return runtimeFor(sessionId).upsertQuestion(record); } catch { return null; }
  }

  function resolveQuestion(sessionId, id, status, record) {
    try { return runtimeFor(sessionId).resolveQuestion(id, status, record); } catch { return null; }
  }

  function completeStream(sessionId, text, turn) {
    return runtimeFor(sessionId).completeStream(String(text || ''), turn);
  }

  function requestInterruption(sessionId, source = 'mobile') {
    return runtimeFor(sessionId).requestInterruption(source);
  }

  function sync(sessionId, options = {}) {
    const state = getState();
    const sid = String(sessionId || state.activeSessionId || defaultSessionId).trim() || defaultSessionId;
    const runtime = runtimeFor(sid);
    const thread = Array.isArray(options.history)
      ? options.history
      : (Array.isArray(state.threads?.[sid]) ? state.threads[sid] : []);
    const activeRun = state.activeRuns?.[sid] || {};
    runtime.transaction(() => {
      runtime.replaceHistory(mobileRuntimeHistory(thread), {
        source: String(options.source || 'mobile-compatibility-bridge'),
        pageInfo: options.pageInfo || runtime.snapshot.paging,
      });
      runtime.setLifecycle({
        phase: activeRun.busy || activeRun.running ? 'streaming' : 'idle',
        settled: options.session?.settled === true || Number(options.session?.settledAt || 0) > 0,
        background: String(state.activeSessionId || '') !== sid && !!(activeRun.busy || activeRun.running),
        lastActivityAt: Number(options.session?.lastActiveAt || Date.now()) || Date.now(),
      });
      for (const message of thread) {
        if (message?.approvalRequest?.id) runtime.upsertApproval(message.approvalRequest);
        if (message?.questionRequest?.id) runtime.upsertQuestion(message.questionRequest);
      }
      const pending = Object.values(state.pendingApprovals || {})
        .flatMap((records) => (Array.isArray(records) ? records : [records]));
      for (const approval of pending) {
        const approvalSid = String(approval?.sessionId || approval?.sourceSessionId || '').trim();
        if (!approvalSid || approvalSid === sid) {
          try { runtime.upsertApproval(approval); } catch {}
        }
      }
      for (const record of Object.values(state.backgroundSpawnLanes || {})) {
        if (String(record?.sessionId || record?.spawnerSessionId || '').trim() !== sid) continue;
        try { runtime.upsertBackground(record); } catch {}
      }
    });
    return runtime;
  }

  function queue(sessionId) {
    const state = getState();
    const sid = identity(sessionId).sessionId;
    if (!state.queuedPrompts || typeof state.queuedPrompts !== 'object') state.queuedPrompts = {};
    const existing = Array.isArray(state.queuedPrompts[sid]) ? state.queuedPrompts[sid] : [];
    const runtime = runtimeFor(sid);
    const bridge = runtime.getQueueBridge();
    if (existing !== bridge && existing.length) runtime.replaceQueue(existing);
    state.queuedPrompts[sid] = bridge;
    return bridge;
  }

  function mount(sessionId) {
    const state = getState();
    const sid = identity(sessionId).sessionId;
    const owner = `mobile-primary:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
    const lease = acquireChatRuntime(identity(sid), owner);
    if (!state.attachments || typeof state.attachments !== 'object') state.attachments = {};
    lease.runtime.replaceAttachments(Array.isArray(state.attachments[sid]) ? state.attachments[sid] : []);
    state.attachments[sid] = lease.runtime.getAttachmentBridge();
    queue(sid);
    sync(sid, { source: 'mobile-view-mount' });
    return lease.release;
  }

  function syncInitial(sessionId, session, history) {
    return sync(sessionId, {
      history,
      session,
      source: 'mobile-initial-page',
      pageInfo: { ...(session?.historyPage || {}), loadedCount: history.length },
    });
  }

  function syncOlder(sessionId, pageResult, history) {
    return sync(sessionId, {
      history,
      source: 'mobile-older-page',
      pageInfo: { ...(pageResult?.pageInfo || {}), loadedCount: history.length, loadingOlder: false },
    });
  }

  async function loadOlderPage(sessionId, { before, limit } = {}) {
    if (typeof loadHistoryPage !== 'function') throw new Error('Mobile history paging is not configured.');
    const state = getState();
    const sid = identity(sessionId).sessionId;
    const pagination = state.historyPagination?.[sid] || {};
    try {
      const pageResult = await loadHistoryPage(sid, { before, limit });
      if (String(state.activeSessionId || '') !== sid) {
        pagination.loading = false;
        return { applied: false, pageResult };
      }
      const older = Array.isArray(pageResult?.items) ? pageResult.items : [];
      const current = Array.isArray(state.threads?.[sid]) ? state.threads[sid] : [];
      const loadedCount = Math.max(Number(pagination.loadedHistoryCount || current.length) || 0, current.length);
      // Hydration reconciliation may intentionally retain only optimistic or
      // live local artifacts. Older paging is different: it must prepend the
      // page without dropping already-loaded durable rows.
      const history = mergeOlderHistory(sid, older, current);
      state.threads[sid] = history;
      const totalCount = Number(pageResult?.pageInfo?.totalCount || loadedCount + older.length) || loadedCount + older.length;
      state.historyPagination[sid] = {
        loading: false,
        loadedHistoryCount: Math.min(totalCount, loadedCount + older.length),
        totalHistoryCount: totalCount,
        historyTruncated: pageResult?.pageInfo?.hasOlder === true,
        olderCursor: String(pageResult?.pageInfo?.olderCursor || '').trim() || null,
      };
      syncOlder(sid, pageResult, history);
      return { applied: true, pageResult, history };
    } catch (error) {
      pagination.loading = false;
      runtimeFor(sid).setPaging({ loadingOlder: false, error: String(error?.message || error) });
      throw error;
    }
  }

  function observeStreamEvent(sessionId, turn, event) {
    const runtime = runtimeFor(sessionId);
    if (!runtime.snapshot.stream.active && !['final', 'done', 'error'].includes(String(event?.type))) {
      runtime.beginStreaming({
        turnId: mobileRuntimeTurnId(turn, event, 'assistant'),
        clientRequestId: mobileRuntimeRequestId(turn, event),
        text: String(turn?.body?.text || turn?.content || ''),
        startedAt: turn?.workStartedAt || turn?.timestamp,
      });
    }
    return runtime;
  }

  function appendStreamEvent(runtime, turn, event, chunk) {
    runtime.appendStreamDelta(chunk, {
      turnId: mobileRuntimeTurnId(turn, event, 'assistant'),
      clientRequestId: mobileRuntimeRequestId(turn, event),
      startedAt: turn?.workStartedAt || turn?.timestamp,
      allowStart: true,
    });
  }

  return Object.freeze({
    identity,
    runtimeFor,
    setRunning,
    setPaging,
    reconcileQuestion,
    upsertApproval,
    upsertQuestion,
    resolveQuestion,
    completeStream,
    requestInterruption,
    createQueuedPrompt: promptTools.create,
    sync,
    queue,
    mount,
    syncInitial,
    syncOlder,
    loadOlderPage,
    observeStreamEvent,
    appendStreamEvent,
  });
}
