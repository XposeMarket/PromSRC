// Resolve the tool name for a call id from entries the turn already holds.
//
// A reconnect can deliver a tool result whose call frame was never seen
// (replay gap, reduced checkpoint/cache rows). The result payload then has a
// call id but no action, and the row degraded to "Tool completed". The call
// usually still exists somewhere in the turn: a live activity entry, a cached
// process entry or a checkpoint process entry. Pure: safe to import anywhere.

function entryCallIds(entry) {
  const extra = entry?.extra && typeof entry.extra === 'object' ? entry.extra : {};
  const nested = extra.extra && typeof extra.extra === 'object' ? extra.extra : {};
  return [
    entry?.activity?.callId, entry?.callId, entry?.toolCallId, entry?.tool_call_id,
    extra.callId, extra.toolCallId, extra.tool_call_id, nested.callId, nested.toolCallId,
  ].map((value) => String(value || '').trim()).filter(Boolean);
}

function entryAction(entry) {
  const extra = entry?.extra && typeof entry.extra === 'object' ? entry.extra : {};
  const nested = extra.extra && typeof extra.extra === 'object' ? extra.extra : {};
  return String(entry?.activity?.action || extra.action || extra.toolName || nested.action
    || nested.toolName || entry?.action || entry?.toolName || '').trim();
}

/** First known action for `callId` across the given entry lists, or ''. */
export function resolveToolActionByCallId(callId, ...lists) {
  const id = String(callId || '').trim();
  if (!id) return '';
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const entry = list[i];
      if (!entry || typeof entry !== 'object') continue;
      if (!entryCallIds(entry).includes(id)) continue;
      const action = entryAction(entry);
      if (action) return action;
    }
  }
  return '';
}

/** Call id carried by a tool event payload (never the generic `id`). */
export function toolPayloadCallId(payload = {}) {
  const extra = payload?.extra && typeof payload.extra === 'object' ? payload.extra : {};
  return String(payload?.callId || payload?.call_id || payload?.toolCallId || payload?.tool_call_id
    || extra.callId || extra.toolCallId || extra.tool_call_id || '').trim();
}

/** `payload` with its action filled in from `lists` when the payload lacks one. */
export function withResolvedToolAction(payload = {}, ...lists) {
  if (!payload || typeof payload !== 'object') return payload;
  const extra = payload.extra && typeof payload.extra === 'object' ? payload.extra : {};
  if (String(payload.action || payload.toolName || payload.name || payload.activity?.action
    || extra.action || extra.toolName || '').trim()) return payload;
  const action = resolveToolActionByCallId(toolPayloadCallId(payload), ...lists);
  return action ? { ...payload, action } : payload;
}
