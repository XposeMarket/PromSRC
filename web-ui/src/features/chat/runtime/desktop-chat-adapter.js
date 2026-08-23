import {
  acquireChatRuntime,
  chatRuntimeRegistryStats,
  getChatRuntime,
  installChatRuntimeEvictionLoop,
} from './chat-runtime.js';
import { createChatHistoryClient } from './history-client.js';

installChatRuntimeEvictionLoop();

export function createDesktopChatRuntimeAdapter({
  windowRef = globalThis.window,
  getSession,
  getBackgroundRecords = () => [],
  isInternalMessage = () => false,
  mergeHistory = (older, current) => [...older, ...current],
  render = () => {},
  persist = () => {},
  toast = () => {},
  encodeInline = (value) => JSON.stringify(String(value ?? '')),
  request,
  getStreamState = () => null,
  recordProcess = () => {},
} = {}) {
  if (!windowRef || typeof getSession !== 'function') {
    throw new TypeError('Desktop chat runtime adapter requires a window and getSession.');
  }
  const historyClient = createChatHistoryClient({ request: windowRef.fetch.bind(windowRef) });
  let activeLease = null;
  const secondaryLeases = new Map();

  function identity(sessionId = windowRef.activeChatSessionId) {
    const gatewayId = String(
      windowRef.__PROMETHEUS_GATEWAY_ID
      || windowRef.__prometheusGatewayId
      || `origin:${windowRef.location?.origin || 'local'}`,
    ).trim();
    return { gatewayId, sessionId: String(sessionId || '').trim() };
  }

  function runtimeFor(sessionId = windowRef.activeChatSessionId) {
    const sid = String(sessionId || '').trim();
    return sid ? getChatRuntime(identity(sid)) : null;
  }

  function bind(sessionId) {
    const resolved = identity(sessionId);
    if (!resolved.sessionId) return null;
    const key = `${resolved.gatewayId}::${resolved.sessionId}`;
    if (activeLease?.key === key) return activeLease.runtime;
    activeLease?.release?.();
    const lease = acquireChatRuntime(resolved, 'desktop-primary-view');
    activeLease = { ...lease, key };
    return lease.runtime;
  }

  function retainSecondary(sessionId, owner = 'desktop-secondary-view') {
    const resolved = identity(sessionId);
    if (!resolved.sessionId) return null;
    const key = `${resolved.gatewayId}::${resolved.sessionId}`;
    const existing = secondaryLeases.get(key);
    if (existing) return existing.runtime;
    const lease = acquireChatRuntime(resolved, owner);
    secondaryLeases.set(key, { ...lease, key, sessionId: resolved.sessionId });
    return lease.runtime;
  }

  function releaseSecondary(sessionId = '') {
    const sid = String(sessionId || '').trim();
    let released = false;
    for (const [key, lease] of secondaryLeases) {
      if (sid && lease.sessionId !== sid) continue;
      lease.release?.();
      secondaryLeases.delete(key);
      released = true;
    }
    return released;
  }

  function setSecondaryVisible(sessionId = '') {
    const sid = String(sessionId || '').trim();
    for (const lease of [...secondaryLeases.values()]) {
      if (!sid || lease.sessionId !== sid) releaseSecondary(lease.sessionId);
    }
    return sid ? retainSecondary(sid) : null;
  }

  function sync(session, options = {}) {
    if (!session?.id) return null;
    const runtime = runtimeFor(session.id);
    const history = Array.isArray(session.history) ? session.history : [];
    const streamState = windowRef._sessionStreamState?.[session.id] || {};
    runtime.transaction(() => {
      runtime.replaceHistory(history, {
        source: String(options.source || 'desktop-compatibility-bridge'),
        pageInfo: options.pageInfo || session.historyPage || runtime.snapshot.paging,
      });
      runtime.setLifecycle({
        phase: windowRef._sessionThinking?.[session.id] || session.activeRun === true ? 'streaming' : 'idle',
        settled: session.settled === true || Number(session.settledAt || 0) > 0,
        background: String(windowRef.activeChatSessionId || '') !== String(session.id) && session.activeRun === true,
        lastActivityAt: Number(session.updatedAt || session.lastActiveAt || Date.now()) || Date.now(),
      });
      for (const message of history) {
        if (message?.approvalRequest?.id) runtime.upsertApproval(message.approvalRequest);
        if (message?.questionRequest?.id) runtime.upsertQuestion(message.questionRequest);
      }
      for (const approval of Array.isArray(streamState.pendingApprovals) ? streamState.pendingApprovals : []) {
        try { runtime.upsertApproval(approval); } catch {}
      }
      for (const record of getBackgroundRecords(session.id)) {
        try { runtime.upsertBackground(record); } catch {}
      }
    });
    return runtime;
  }

  function queue(sessionId) {
    const sid = String(sessionId || '').trim();
    if (!sid) return [];
    if (!windowRef._sessionQueuedPrompts || typeof windowRef._sessionQueuedPrompts !== 'object') {
      windowRef._sessionQueuedPrompts = {};
    }
    const existing = Array.isArray(windowRef._sessionQueuedPrompts[sid]) ? windowRef._sessionQueuedPrompts[sid] : [];
    const runtime = runtimeFor(sid);
    const bridge = runtime.getQueueBridge();
    if (existing !== bridge && existing.length) runtime.replaceQueue(existing);
    windowRef._sessionQueuedPrompts[sid] = bridge;
    return bridge;
  }

  function activeQueue() {
    return queue(windowRef.activeChatSessionId);
  }

  function activate(session) {
    if (!session?.id) return null;
    bind(session.id);
    return sync(session, { source: 'desktop-session-switch' });
  }

  function applyInitialPage(session, payload = {}) {
    const loadedCount = Array.isArray(session?.history) ? session.history.length : 0;
    session.messageCount = Math.max(
      Array.isArray(payload.history) ? payload.history.length : 0,
      Number(payload.totalHistoryCount || payload.messageCount || 0) || 0,
    );
    session.historyPage = payload.historyPage && typeof payload.historyPage === 'object'
      ? {
          ...payload.historyPage,
          olderCursor: String(payload.historyPage.olderCursor || '').trim() || null,
          hasOlder: payload.historyPage.hasOlder === true,
          totalCount: Number(payload.historyPage.totalCount || payload.totalHistoryCount || loadedCount) || loadedCount,
          loadedCount,
        }
      : {
          olderCursor: null,
          hasOlder: payload.historyTruncated === true,
          totalCount: Number(payload.totalHistoryCount || loadedCount) || loadedCount,
          loadedCount,
        };
    return session.historyPage;
  }

  async function requestInterruption(sessionId = windowRef.activeChatSessionId, source = 'desktop') {
    const sid = String(sessionId || '').trim();
    runtimeFor(sid)?.requestInterruption(source);
    const streamState = getStreamState(sid);
    if (streamState) {
      streamState.abortRequested = true;
      streamState.abortRequestedAt = Date.now();
      streamState.abortRequestedSource = String(source || 'desktop');
    }
    try {
      const result = await request('/api/mobile/commands/stop-now', {
        method: 'POST',
        body: { sessionId: sid, source },
        timeoutMs: 15000,
      });
      if (result?.success) {
        recordProcess(sid, 'warn', 'Gateway abort requested for active main chat runtime.', {
          actor: 'Desktop Abort', source, target: result.target || null,
        });
        return true;
      }
      if (result?.message) recordProcess(sid, 'warn', result.message, { actor: 'Desktop Abort', source });
    } catch (error) {
      recordProcess(sid, 'error', `Gateway abort request failed: ${String(error?.message || error)}`, {
        actor: 'Desktop Abort', source,
      });
    }
    return false;
  }

  function renderHistoryPager(sessionId = windowRef.activeChatSessionId) {
    const page = getSession(sessionId)?.historyPage;
    if (!page?.hasOlder || !String(page.olderCursor || '').trim()) return '';
    const loading = page.loadingOlder === true;
    return `<div class="chat-history-pager" data-chat-row-key="history-pager:gateway" role="navigation" aria-label="Earlier messages">
      <button type="button" class="btn btn-sm" onclick="loadOlderDesktopChatHistory(${encodeInline(sessionId)})" ${loading ? 'disabled' : ''}>
        ${loading ? 'Loading earlier messages…' : 'Load earlier messages'}
      </button>
    </div>`;
  }

  async function loadOlder(sessionId = windowRef.activeChatSessionId) {
    const sid = String(sessionId || '').trim();
    const session = getSession(sid);
    const cursor = String(session?.historyPage?.olderCursor || '').trim();
    if (!session || !cursor || session.historyPage?.loadingOlder === true) return false;
    session.historyPage = { ...session.historyPage, loadingOlder: true, error: null };
    runtimeFor(sid)?.setPaging({ loadingOlder: true, error: null });
    if (sid === windowRef.activeChatSessionId) render();
    try {
      const result = await historyClient.loadOlder({ sessionId: sid, before: cursor, limit: 80 });
      const olderHistory = result.items
        .filter((message) => !isInternalMessage(message))
        .map((message) => ({ ...message, role: message.role, content: message.content || '', timestamp: message.timestamp }));
      session.history = mergeHistory(olderHistory, session.history || []);
      session.historyPage = { ...result.pageInfo, loadingOlder: false, error: null, loadedCount: session.history.length };
      sync(session, { source: 'desktop-older-page', pageInfo: session.historyPage });
      persist();
      if (sid === windowRef.activeChatSessionId) {
        windowRef.chatHistory = session.history;
        windowRef.chatMessagesUserScrolledUp = true;
        render();
      }
      return true;
    } catch (error) {
      const message = String(error?.message || error);
      session.historyPage = { ...session.historyPage, loadingOlder: false, error: message };
      runtimeFor(sid)?.setPaging({ loadingOlder: false, error: message });
      if (sid === windowRef.activeChatSessionId) render();
      toast('Could not load earlier messages', message, 'error');
      return false;
    }
  }

  windowRef.addEventListener('beforeunload', () => {
    activeLease?.release?.();
    activeLease = null;
    releaseSecondary();
  }, { once: true });
  windowRef.loadOlderDesktopChatHistory = loadOlder;

  const diagnostics = () => ({
    ...chatRuntimeRegistryStats(),
    primarySessionId: activeLease?.runtime?.sessionId || '',
    secondarySessionIds: [...secondaryLeases.values()].map((lease) => lease.sessionId).sort(),
  });

  return Object.freeze({
    identity,
    runtimeFor,
    bind,
    retainSecondary,
    releaseSecondary,
    setSecondaryVisible,
    sync,
    queue,
    activeQueue,
    activate,
    applyInitialPage,
    requestInterruption,
    renderHistoryPager,
    loadOlder,
    diagnostics,
  });
}
