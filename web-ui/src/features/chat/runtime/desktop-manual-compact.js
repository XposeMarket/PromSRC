import {
  classifyManualCompactInput,
  createManualCompactController,
  isManualCompactExternalSession,
  manualCompactRowStatus,
  manualCompactTraceEntry,
} from '../core/manual-compact.js';
import { cachedSessionBinding, isDotSessionId } from '../../../chat/external-agent-ui.js';

/**
 * Desktop wiring for manual /compact. ChatPage supplies a lazy context so
 * late-initialized page helpers stay live; the shared controller owns the
 * lifecycle and never sends, queues, steers or resumes a turn.
 */
export function createDesktopManualCompact(resolveContext = () => ({})) {
  let controller = null;
  const ctx = () => resolveContext() || {};

  function get() {
    if (controller) return controller;
    controller = createManualCompactController({
      request: (path, opts) => ctx().api(path, opts),
      getThread: (sessionId) => ctx().getChatSessionById(sessionId)?.history || null,
      commit: (sessionId) => {
        const c = ctx();
        c.persistSession(sessionId);
        if (window.activeChatSessionId === sessionId) c.renderChatMessages();
      },
      toast: (message, tone) => ctx().showToast('/compact', message, tone === 'warn' ? 'info' : tone),
      restoreDraft: (sessionId, text) => ctx().restoreDesktopComposerAfterFailedSend(sessionId, text),
      refresh: async (sessionId) => {
        const c = ctx();
        await c.loadSessionFromServer(sessionId, { force: true });
        if (window.activeChatSessionId === sessionId) {
          c.renderChatMessages();
          c.scheduleChatContextWindowRefresh?.(250);
        }
      },
    });
    return controller;
  }

  function busyReason(sessionId) {
    const c = ctx();
    const sess = c.getChatSessionById(sessionId);
    if (c.isSessionThinking(sessionId)) return 'Prometheus is still working. Send /compact again when this chat is idle.';
    if (c.isActiveMainGoalRunning(sessionId) || String(sess?.mainChatGoal?.status || '') === 'active') {
      return 'An active goal would resume afterwards. Pause or finish the goal before compacting.';
    }
    if (c.getSessionQueuedPrompts(sessionId).length) return 'Queued messages would run afterwards. Send /compact when the queue is empty.';
    if (c.hasPendingPrometheusQuestion(sessionId)) return 'Answer the pending question before compacting.';
    return '';
  }

  /** Returns true when the composer text was a /compact command (handled here). */
  function handleCommand(raw, input) {
    const c = ctx();
    const sessionId = String(window.activeChatSessionId || '').trim();
    if (!sessionId && classifyManualCompactInput(raw).kind !== 'none') {
      c.showToast('/compact', 'Open a chat before compacting its context.', 'info');
      return true;
    }
    const sess = c.getChatSessionById(sessionId);
    const options = {
      attachmentCount: Array.isArray(c.pendingChatFiles) ? c.pendingChatFiles.length : 0,
      external: isManualCompactExternalSession({ sessionId, session: sess, binding: cachedSessionBinding(sessionId), isDot: isDotSessionId(sessionId) }),
      busyReason: busyReason(sessionId),
    };
    const verdict = classifyManualCompactInput(raw, options);
    if (verdict.kind === 'none') return false;
    // Empty/no-new-material is the gateway's decision (skipped, zero provider calls).
    const result = get().handleComposerSend(sessionId, raw, options);
    if (result.handled && !result.keepDraft) c.clearChatComposerAfterSend(input, sessionId);
    return result.handled;
  }

  /** The status row is not an answer: only the existing compaction break. */
  function renderStatusRow(msg, originalIndex, key, signature) {
    const c = ctx();
    const esc = c.escHtml;
    const status = manualCompactRowStatus(msg);
    const rowSignature = `${String(signature || c.desktopTimelineRowSignature(msg))}:compact:${status}:${String(msg?.content || '')}`;
    return `<div class="msg-shell assistant manual-compact-status" data-manual-compact-status="${esc(status)}" data-chat-message-index="${originalIndex}" data-chat-row-key="${esc(String(key || `message:${originalIndex}`))}" data-chat-row-signature="${esc(rowSignature)}">
      <div class="msg assistant"><div class="msg-bubble-stack"><div class="msg-body">${c.renderLiveTraceCompactionBreak(manualCompactTraceEntry(msg))}</div></div></div>
    </div>`;
  }

  return {
    handleCommand,
    renderStatusRow,
    sendBlockReason: (sessionId) => get().sendBlockReason(sessionId),
    resumeFromTranscript: (sessionId) => get().resumeFromTranscript(sessionId),
  };
}
