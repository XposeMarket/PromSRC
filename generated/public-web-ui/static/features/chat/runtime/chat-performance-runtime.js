import { createAdaptiveStreamScheduler } from '../timeline/adaptive-stream-scheduler.js';

const PROCESS_LOG_PERSIST_DEBOUNCE_MS = 750;

export function createChatPerformanceRuntime({
  windowRef = globalThis.window,
  documentRef = globalThis.document,
  persistSession = () => {},
  persistActiveChat = () => {},
  getChatSessionById = () => null,
  getSessionStreamState = () => null,
  renderProcessLog = () => {},
  maybeAutoScrollRightColumn = () => {},
  formatProcessLines = () => '',
} = {}) {
  const backgroundAgentRenderScheduler = createAdaptiveStreamScheduler({ floorMs: 120, ceilingMs: 360, hiddenMs: 500, documentRef });
  const processLogRenderScheduler = createAdaptiveStreamScheduler({ floorMs: 80, ceilingMs: 240, hiddenMs: 400, documentRef });
  const processLogPersistTimers = new Map();

  function cancelProcessLogPersistence(sessionId) {
    const sid = String(sessionId || '').trim();
    if (!sid) return;
    const timer = processLogPersistTimers.get(sid);
    if (timer !== undefined) {
      if (typeof clearTimeout === 'function') clearTimeout(timer);
      processLogPersistTimers.delete(sid);
    }
  }

  function scheduleProcessLogPersistence(sessionId, options = {}) {
    const sid = String(sessionId || '').trim();
    if (!sid) return;
    cancelProcessLogPersistence(sid);
    if (options.immediate === true || typeof setTimeout !== 'function') {
      persistSession(sid);
      return;
    }
    const timer = setTimeout(() => {
      processLogPersistTimers.delete(sid);
      persistSession(sid);
    }, PROCESS_LOG_PERSIST_DEBOUNCE_MS);
    timer?.unref?.();
    processLogPersistTimers.set(sid, timer);
  }

  function flushProcessLogPersistence() {
    for (const sid of [...processLogPersistTimers.keys()]) {
      cancelProcessLogPersistence(sid);
      persistSession(sid);
    }
  }

  function scheduleRender(scheduler, key, renderFn, options = {}) {
    if (typeof renderFn !== 'function') return;
    const task = () => renderFn();
    if (options.immediate === true) scheduler.flush(key, task);
    else scheduler.schedule(key, task);
  }

  function scheduleProcessLogRender(renderFn, options = {}) {
    scheduleRender(processLogRenderScheduler, 'process-log', renderFn, options);
  }

  function scheduleBackgroundAgentUiUpdate(renderFn, options = {}) {
    scheduleRender(backgroundAgentRenderScheduler, 'background-agent', renderFn, options);
  }

  function clearProcessLog() {
    cancelProcessLogPersistence(windowRef?.activeChatSessionId);
    processLogRenderScheduler.cancel('process-log');
    windowRef.processLogEntries.length = 0;
    const el = documentRef?.getElementById?.('process-log');
    if (el) el.innerHTML = '<div style="color:var(--muted);text-align:center;padding:20px 0;opacity:0.5">Waiting for activity...</div>';
    windowRef.processLogAutoFollow = true;
    windowRef.rightColumnAutoFollow = true;
    maybeAutoScrollRightColumn(true);
    persistActiveChat();
  }

  function addProcessEntry(type, content, extra) {
    const ts = new Date().toLocaleTimeString();
    const actor = (extra && typeof extra === 'object' && extra.actor) ? String(extra.actor) : undefined;
    const contentText = String(content || '');
    if (!actor && contentText.startsWith('Task "') && (contentText.includes('check sidebar') || contentText.includes('nothing to report'))) return;
    windowRef.processLogEntries.push({ ts, type, content, extra, actor });
    scheduleProcessLogRender(() => {
      renderProcessLog();
      maybeAutoScrollRightColumn(windowRef.isThinking || windowRef.rightColumnAutoFollow);
      if (windowRef.isThinking) {
        const panel = documentRef?.getElementById?.('current-turn-process');
        if (panel && panel.style.display !== 'none' && windowRef.currentTurnStartIndex >= 0) {
          panel.innerHTML = formatProcessLines(windowRef.processLogEntries.slice(windowRef.currentTurnStartIndex));
        }
      }
    });
    scheduleProcessLogPersistence(windowRef.activeChatSessionId);
  }

  function addSessionProcessEntry(sessionId, type, content, extra) {
    const sess = getChatSessionById(sessionId);
    if (!sess) {
      addProcessEntry(type, content, extra);
      return;
    }
    if (!Array.isArray(sess.processLog)) sess.processLog = [];
    const ts = new Date().toLocaleTimeString();
    const actor = (extra && typeof extra === 'object' && extra.actor) ? String(extra.actor) : undefined;
    sess.processLog.push({ ts, type, content, extra, actor });
    const st = getSessionStreamState(sessionId);
    const isViewing = windowRef.activeChatSessionId === sessionId;
    if (isViewing) {
      windowRef.processLogEntries = sess.processLog;
      scheduleProcessLogRender(() => {
        if (windowRef.activeChatSessionId !== sessionId) return;
        renderProcessLog();
        maybeAutoScrollRightColumn(!!windowRef._sessionThinking?.[sessionId] || windowRef.rightColumnAutoFollow);
        if (windowRef._sessionThinking?.[sessionId]) {
          const panel = documentRef?.getElementById?.('current-turn-process');
          const startIndex = Number.isFinite(Number(st?.currentTurnStartIndex)) ? Number(st.currentTurnStartIndex) : -1;
          if (panel && panel.style.display !== 'none' && startIndex >= 0) {
            panel.innerHTML = formatProcessLines(sess.processLog.slice(startIndex));
          }
        }
      });
    }
    scheduleProcessLogPersistence(sessionId);
  }

  windowRef?.addEventListener?.('pagehide', flushProcessLogPersistence);

  return Object.freeze({
    addProcessEntry,
    addSessionProcessEntry,
    cancelProcessLogPersistence,
    cancelProcessLogRender: () => processLogRenderScheduler.cancel('process-log'),
    clearProcessLog,
    flushProcessLogPersistence,
    scheduleBackgroundAgentUiUpdate,
    scheduleProcessLogPersistence,
    scheduleProcessLogRender,
  });
}
