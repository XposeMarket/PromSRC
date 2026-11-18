// State for the floating mobile tool-progress pill, kept out of the chat
// renderer so it can be tested without a DOM.

// A pill with no update for this long belongs to a tool that already finished;
// progress events arrive at least every 15s while a tool is working.
export const MOBILE_TOOL_PROGRESS_STALE_MS = 45000;

const text = (value) => String(value || '').trim();
const numberOrNull = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

/** Store a pill for the session. Returns false when the event does not ask for one. */
export function setMobileToolProgressState(store, sessionId, evt = {}, now = Date.now()) {
  if (evt.show_pill !== true) return false;
  const sid = text(sessionId);
  const message = text(evt.message);
  if (!store || !sid || !message) return false;
  store[sid] = {
    action: text(evt.action || evt.name || evt.toolName || 'tool'),
    toolCallId: text(evt.toolCallId || evt.tool_call_id),
    message: message.slice(0, 180),
    phase: text(evt.phase || 'working'),
    current: numberOrNull(evt.current),
    total: numberOrNull(evt.total),
    updatedAt: now,
  };
  return true;
}

/**
 * Clear the session's pill. With no action and no call id it always clears.
 * Wrapper tools report progress under an inner name (process_wait) but finish
 * under the wrapper name (workspace_run), so a matching call id wins over a
 * mismatched action name.
 */
export function clearMobileToolProgressState(store, sessionId, action = '', toolCallId = '') {
  const sid = text(sessionId);
  const state = store?.[sid];
  if (!state) return false;
  const expected = text(action);
  const callId = text(toolCallId);
  const sameCall = !!callId && !!state.toolCallId && callId === state.toolCallId;
  if (!sameCall && expected && state.action && expected !== state.action) return false;
  delete store[sid];
  return true;
}

/**
 * The session's pill, or undefined. Some completion paths (history recovery
 * after a reconnect) never send a clearing event, so a stale pill is dropped here.
 */
export function readMobileToolProgressState(store, sessionId, now = Date.now()) {
  const sid = text(sessionId);
  const state = store?.[sid];
  if (!state) return undefined;
  if (now - Number(state.updatedAt || 0) > MOBILE_TOOL_PROGRESS_STALE_MS) {
    delete store[sid];
    return undefined;
  }
  return state;
}
