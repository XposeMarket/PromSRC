// Resolve the tool name for a call id from entries the turn already holds.
//
// A reconnect can deliver a tool result whose call frame was never seen
// (replay gap, reduced checkpoint/cache rows). The result payload then has a
// call id but no action, and the row degraded to "Tool completed". The call
// usually still exists somewhere in the turn: a live activity entry, a cached
// process entry or a checkpoint process entry. Pure: safe to import anywhere.
//
// Call ids are only unique within a stream. The index is scoped by stream id:
// a result resolves against candidates from its own stream first, and when
// the remaining candidates disagree on the action the lookup reports
// "ambiguous" and returns no name rather than guessing.

const CONFLICT = '\u0000conflict';

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

function entryScope(entry) {
  const extra = entry?.extra && typeof entry.extra === 'object' ? entry.extra : {};
  const nested = extra.extra && typeof extra.extra === 'object' ? extra.extra : {};
  return String(entry?.streamId || entry?.stream_id || entry?.activity?.streamId
    || extra.streamId || extra.stream_id || nested.streamId || '').trim();
}

function mergeAction(previous, action) {
  return previous === undefined || previous === action ? action : CONFLICT;
}

/** Call id carried by a tool event payload (never the generic `id`). */
export function toolPayloadCallId(payload = {}) {
  const extra = payload?.extra && typeof payload.extra === 'object' ? payload.extra : {};
  return String(payload?.callId || payload?.call_id || payload?.toolCallId || payload?.tool_call_id
    || extra.callId || extra.toolCallId || extra.tool_call_id || '').trim();
}

/** Stream id carried by a tool event payload, '' when it has none. */
export function toolPayloadStreamId(payload = {}) {
  const extra = payload?.extra && typeof payload.extra === 'object' ? payload.extra : {};
  return String(payload?.streamId || payload?.stream_id || payload?.activity?.streamId
    || extra.streamId || extra.stream_id || '').trim();
}

/** Empty index for call id -> action, scoped by stream. */
export function createToolCallActionIndex() {
  return new Map();
}

/**
 * Add the named entries of `lists` to `index` (mutates and returns it). Each
 * call id maps to { any, scopes } where `any` is the action across all streams
 * and `scopes` maps stream id ('' = no stream) to the action in that stream.
 * A value becomes CONFLICT when its candidates disagree.
 */
export function indexToolCallActions(index, ...lists) {
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue;
      const action = entryAction(entry);
      if (!action) continue;
      const scope = entryScope(entry);
      for (const id of entryCallIds(entry)) {
        let slot = index.get(id);
        if (!slot) {
          slot = { any: action, scopes: new Map() };
          index.set(id, slot);
        } else {
          slot.any = mergeAction(slot.any, action);
        }
        slot.scopes.set(scope, mergeAction(slot.scopes.get(scope), action));
      }
    }
  }
  return index;
}

/**
 * Action for `callId` from `index`. A result with a stream id only sees that
 * stream's candidates (or stream-less ones); without a stream id every
 * candidate counts. `ambiguous` is true when candidates disagree on the action.
 */
export function lookupToolCallAction(index, callId, scope = '') {
  const id = String(callId || '').trim();
  const slot = id && index instanceof Map ? index.get(id) : null;
  if (!slot) return { action: '', ambiguous: false };
  const stream = String(scope || '').trim();
  let value;
  if (!stream) value = slot.any;
  else if (slot.scopes.has(stream)) value = slot.scopes.get(stream);
  else value = slot.scopes.get('');
  if (value === undefined) return { action: '', ambiguous: false };
  if (value === CONFLICT) return { action: '', ambiguous: true };
  return { action: value, ambiguous: false };
}

/** First unambiguous action for `callId` across the given entry lists, or ''. */
export function resolveToolActionByCallId(callId, ...lists) {
  return lookupToolCallAction(indexToolCallActions(createToolCallActionIndex(), ...lists), callId).action;
}

/**
 * `payload` with its action filled in when the payload lacks one. Accepts a
 * prebuilt index (one Map argument) or entry lists to index on the fly.
 */
export function withResolvedToolAction(payload = {}, ...lists) {
  if (!payload || typeof payload !== 'object') return payload;
  const extra = payload.extra && typeof payload.extra === 'object' ? payload.extra : {};
  if (String(payload.action || payload.toolName || payload.name || payload.activity?.action
    || extra.action || extra.toolName || '').trim()) return payload;
  const index = lists.length === 1 && lists[0] instanceof Map
    ? lists[0]
    : indexToolCallActions(createToolCallActionIndex(), ...lists);
  const { action } = lookupToolCallAction(index, toolPayloadCallId(payload), toolPayloadStreamId(payload));
  return action ? { ...payload, action } : payload;
}
