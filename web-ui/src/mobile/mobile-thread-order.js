/**
 * Pure mobile thread-ordering helpers (no DOM, no globals) so the ordering
 * contract is testable in node: scripts/test-mobile-thread-order.mjs.
 *
 * Delivery rows (delivery_send images/files/messages) are durable assistant
 * rows that the gateway appends to history WHILE a turn is still streaming.
 * Contract for one user-bounded turn segment:
 *   live:  [user] -> [assistant live trace] -> [delivery...]
 *   final: [user] -> [assistant trace + timer] -> [delivery...] -> [answer text]
 * The array order is fixed by orderMobileTurnDeliveries(); the final-answer
 * split is presentation-only (buildMobileDeliveryPaintPlan()).
 */

export function isMobileDeliveryRow(msg) {
  if (!msg || typeof msg !== 'object') return false;
  if (msg.role !== 'ai' && msg.role !== 'assistant') return false;
  return String(msg.messageKind || '').trim() === 'delivery'
    || String(msg.channelLabel || '').trim() === 'delivery';
}

function requestIdOf(msg) {
  return String(msg?._clientRequestId || msg?.clientRequestId || '').trim();
}

function isAssistantTurnRow(msg) {
  return !!msg && (msg.role === 'ai' || msg.role === 'assistant') && !isMobileDeliveryRow(msg);
}

function positiveNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Move delivery rows that landed between a turn's user prompt and its
 * assistant row (history refresh anchors server [user, delivery] next to the
 * painted prompt, before the still-streaming row) to directly after that
 * assistant row, preserving send order. Mutates and returns `list`.
 */
export function orderMobileTurnDeliveries(list) {
  if (!Array.isArray(list) || list.length < 2) return list;
  let segmentStart = 0;
  for (let index = 0; index <= list.length; index += 1) {
    if (index < list.length && list[index]?.role !== 'user') continue;
    // Segment = (segmentStart .. index-1); list[segmentStart-1] is its prompt.
    const owner = segmentStart > 0 ? list[segmentStart - 1] : null;
    const ownerAt = positiveNumber(owner?.timestamp);
    let turnIndex = -1;
    for (let i = segmentStart; i < index; i += 1) {
      if (isAssistantTurnRow(list[i])) { turnIndex = i; break; }
    }
    if (owner && turnIndex > segmentStart) {
      const moved = [];
      for (let i = segmentStart; i < turnIndex; i += 1) {
        const row = list[i];
        if (!isMobileDeliveryRow(row)) continue;
        const at = positiveNumber(row.timestamp);
        // A delivery older than this prompt belongs to an earlier turn.
        if (owner && ownerAt && at && at < ownerAt) continue;
        moved.push(row);
      }
      if (moved.length) {
        const kept = list.slice(segmentStart, index).filter((row) => !moved.includes(row));
        const turnAt = kept.indexOf(list[turnIndex]);
        kept.splice(turnAt + 1, 0, ...moved);
        list.splice(segmentStart, index - segmentStart, ...kept);
      }
    }
    segmentStart = index + 1;
  }
  return list;
}

/**
 * Keep a live/recovered assistant row after the prompt it answers. Recovery
 * can surface a streaming row with a missing/zero timestamp (or keep a stale
 * cached slot) at the head of the thread, ahead of older history. Such a row
 * is moved after its owning prompt (by request id), or after the last prompt
 * that started before it, or to the end when nothing is known. A misplaced
 * empty duplicate of a later row of the same request is folded into it.
 *
 * hooks.merge(target, source) merges turn details; hooks.hasVisibleAnswer(row).
 */
export function repairMobileLiveRowPlacement(list, hooks = {}) {
  if (!Array.isArray(list) || list.length < 2) return list;
  const merge = typeof hooks.merge === 'function' ? hooks.merge : () => {};
  const hasVisibleAnswer = typeof hooks.hasVisibleAnswer === 'function'
    ? hooks.hasVisibleAnswer
    : (row) => !!String(row?.body?.text || row?.content || '').trim();
  const candidates = list.filter((row) => isAssistantTurnRow(row)
    && row.streaming === true
    && row._steerFrozenTrace !== true
    && String(row.workflowPart || '') !== 'before_interruption');
  for (const row of candidates) {
    const index = list.indexOf(row);
    if (index < 0) continue;
    const requestId = requestIdOf(row);
    const owner = requestId
      ? list.find((item) => item?.role === 'user' && requestIdOf(item) === requestId)
      : null;
    const ownerIndex = owner ? list.indexOf(owner) : -1;
    const startedAt = positiveNumber(row.workStartedAt) || positiveNumber(row.timestamp);
    const laterUsers = list.slice(index + 1).filter((item) => item?.role === 'user');
    const hasEarlierUser = list.slice(0, index).some((item) => item?.role === 'user');
    let misplaced = false;
    if (ownerIndex > index) misplaced = true;
    else if (ownerIndex < 0 && laterUsers.length) {
      // A live row never precedes every prompt (the "Working for..." row at
      // the top of the thread), and a live row is never older than a prompt
      // painted below it (a stale cached slot). Steer/queued prompts below a
      // live row are newer than its start, so they never trigger this.
      misplaced = !hasEarlierUser
        || (startedAt > 0 && laterUsers.some((user) => {
          const at = positiveNumber(user.timestamp);
          return at > 0 && at < startedAt - 1000;
        }));
    }
    if (!misplaced) continue;
    list.splice(index, 1);
    // Owner known: directly after its prompt. Unknown: end of the thread.
    const insertAt = ownerIndex >= 0 ? list.indexOf(owner) + 1 : list.length;
    // Duplicate stale live row: the same request already has a row in the
    // segment we are moving into. Fold the stale copy instead of keeping two.
    if (requestId && !hasVisibleAnswer(row)) {
      let duplicate = null;
      for (let i = insertAt; i < list.length && list[i]?.role !== 'user'; i += 1) {
        if (isAssistantTurnRow(list[i]) && requestIdOf(list[i]) === requestId) { duplicate = list[i]; break; }
      }
      if (duplicate) {
        merge(duplicate, row);
        continue;
      }
    }
    list.splice(insertAt, 0, row);
  }
  return list;
}

/**
 * Presentation plan for the keyed renderer. An assistant row followed by
 * delivery rows in its segment that already has answer text is painted as
 * two DOM rows: its trace part in place and its answer part after the last
 * of those deliveries. Returns [{ entry, part: 'full'|'trace'|'answer' }].
 * `entries` are timeline entries ({ msg, key, ... }) in thread order.
 */
export function buildMobileDeliveryPaintPlan(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const plan = [];
  for (let index = 0; index < list.length; index += 1) {
    const entry = list[index];
    const msg = entry?.msg;
    const text = String(msg?.body?.text || '').trim();
    let lastDelivery = index;
    while (lastDelivery + 1 < list.length && isMobileDeliveryRow(list[lastDelivery + 1]?.msg)) lastDelivery += 1;
    if (!isAssistantTurnRow(msg) || !text || lastDelivery === index) {
      plan.push({ entry, part: 'full' });
      continue;
    }
    plan.push({ entry, part: 'trace' });
    for (let i = index + 1; i <= lastDelivery; i += 1) plan.push({ entry: list[i], part: 'full' });
    plan.push({ entry, part: 'answer' });
    index = lastDelivery;
  }
  return plan;
}

/** Message views for the split parts (shallow copies; never persisted). */
export function mobileDeliverySplitMessage(msg, part) {
  if (!msg || part === 'full') return msg;
  const body = msg.body && typeof msg.body === 'object' ? msg.body : {};
  if (part === 'trace') {
    return { ...msg, body: { ...body, text: '' }, content: '', finalResponseStarted: true, _pmHideActions: true };
  }
  return {
    role: 'ai',
    messageId: msg.messageId,
    timestamp: msg.timestamp,
    time: msg.time,
    body: { sender: body.sender || 'Prometheus', text: String(body.text || '') },
    content: String(body.text || ''),
    source: msg.source,
    streaming: msg.streaming,
    _pmFinalReceived: msg._pmFinalReceived,
    _done: msg._done,
    suppressWorkTimer: true,
    _pmDeliverySplitAnswer: true,
  };
}
