// Mobile turn lifecycle: pure, DOM-free decisions shared by the mobile chat
// stream reader (mobile-api.js), the chat page runtime and the drawer.
// Importable in Node so the regression test can drive it with fake timers.

// The gateway writes `: ping` + a `heartbeat` SSE event every 5s
// (src/gateway/routes/chat.router.ts main-chat heartbeat interval). 45s of
// zero bytes therefore means the transport (e.g. Tailscale Funnel) stalled.
export const MOBILE_STREAM_IDLE_TIMEOUT_MS = 45_000;
export const MOBILE_SILENCE_BACKSTOP_MS = 45_000;
export const MOBILE_SILENCE_CHECK_INTERVAL_MS = 10_000;
export const MOBILE_STALE_RUN_GRACE_MS = 10_000;
export const MOBILE_STALE_RUN_MISS_THRESHOLD = 2;
export const MOBILE_LIVE_EVENT_FRESH_MS = 15_000;

const STALL_ERROR_NAME = 'MobileStreamStallError';

export function createMobileStreamStallError(idleMs = MOBILE_STREAM_IDLE_TIMEOUT_MS) {
  const err = new Error('Connection stalled. Prometheus may still be working; reconnecting to recover the latest result.');
  err.name = STALL_ERROR_NAME;
  err.mobileStreamDisconnected = true;
  err.mobileStreamStalled = true;
  err.mobileStreamDisconnectReason = 'stalled';
  err.idleMs = idleMs;
  return err;
}

export function isMobileStreamStallError(err) {
  return !!err && (err.name === STALL_ERROR_NAME || err.mobileStreamStalled === true);
}

/**
 * Race one reader.read() against an idle timer. Any chunk (data, `: ping`
 * comments, heartbeat events) resolves the race, and every call starts a fresh
 * timer, so the limit is "time since the last received bytes".
 * Rejects with a stall error (never an AbortError) on expiry so callers can
 * tell a transport stall apart from a user Stop.
 */
export function readChunkWithIdleTimeout(reader, {
  idleMs = MOBILE_STREAM_IDLE_TIMEOUT_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const limit = Number(idleMs);
  if (!(limit > 0)) return reader.read();
  let handle = null;
  const stall = new Promise((_, reject) => {
    handle = setTimer(() => reject(createMobileStreamStallError(limit)), limit);
  });
  return Promise.race([reader.read(), stall]).finally(() => {
    if (handle != null) clearTimer(handle);
  });
}

/**
 * Classify how a POST stream reader loop ended.
 * - userAborted: our controller was aborted by the caller/Stop (not a stall)
 * - stalled: idle watchdog expired → disconnect recovery
 * - error: any other transport/protocol error
 */
export function classifyMobileStreamFailure(err, { userAborted = false } = {}) {
  if (userAborted) return 'user_abort';
  if (isMobileStreamStallError(err)) return 'stalled';
  if (err?.name === 'AbortError') return 'user_abort';
  return 'error';
}

/**
 * Finalize idempotency guard: a POST `final` and a WS terminal frame can both
 * reach finalize for the same row. Side effects (plan dock finalize,
 * completeStream, persist) run only for the first claim. A row that was
 * revived (streaming again) may be finalized again.
 */
export function claimMobileFinalize(aiTurn) {
  if (!aiTurn || typeof aiTurn !== 'object') return false;
  if (aiTurn._pmFinalized === true && aiTurn.streaming !== true) return false;
  return true;
}

/**
 * Rows of the latest turn (after the last user row) that must be closed after
 * a recovery merge that proved the answer is complete.
 * Returns { finalize: rows with an answer or trace, drop: empty live rows }.
 */
export function selectMobileTurnRowsToFinalize(thread, { hasVisibleAnswer = () => false } = {}) {
  const rows = Array.isArray(thread) ? thread : [];
  let start = 0;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i]?.role === 'user') { start = i + 1; break; }
  }
  const finalize = [];
  const drop = [];
  for (let i = start; i < rows.length; i += 1) {
    const row = rows[i];
    if (row?.role !== 'ai') continue;
    const hasTrace = (Array.isArray(row.liveTraceEntries) && row.liveTraceEntries.length > 0)
      || (Array.isArray(row.processEntries) && row.processEntries.length > 0);
    // Durable server rows are already complete; only rows that are still live
    // (streaming, or an unfinalized row whose live trace was never closed).
    const open = row.streaming === true
      || (row._pmFinalized !== true && row._pmLiveActivityCompleted !== true
        && Array.isArray(row.liveTraceEntries) && row.liveTraceEntries.length > 0);
    if (!open) continue;
    if (row.streaming === true && !hasVisibleAnswer(row) && !hasTrace) drop.push(row);
    else finalize.push(row);
  }
  return { finalize, drop };
}

/**
 * Reconcile local busy runs against an authoritative server run list.
 * - A run the server lists is never cleared (its miss counter resets).
 * - A local run younger than graceMs is never cleared.
 * - Otherwise it is cleared after `threshold` consecutive authoritative misses.
 * Unknown-age runs are aged from their first authoritative miss.
 * `misses` is a mutable { [sid]: { count, firstAt } } map owned by the caller.
 * Returns { keep: Set<sid>, clear: sid[] }.
 */
export function reconcileMobileStaleRuns({
  localRuns = {},
  serverIds = [],
  misses = {},
  now = Date.now(),
  graceMs = MOBILE_STALE_RUN_GRACE_MS,
  threshold = MOBILE_STALE_RUN_MISS_THRESHOLD,
} = {}) {
  const server = new Set((Array.isArray(serverIds) ? serverIds : []).map((id) => String(id || '').trim()).filter(Boolean));
  const keep = new Set();
  const clear = [];
  for (const sid of Object.keys(misses)) {
    if (server.has(sid) || !localRuns?.[sid]?.busy) delete misses[sid];
  }
  for (const [rawSid, run] of Object.entries(localRuns || {})) {
    const sid = String(rawSid || '').trim();
    if (!sid || !run?.busy) continue;
    if (server.has(sid)) { delete misses[sid]; keep.add(sid); continue; }
    const startedAt = Number(run.startedAt || run.busySince || 0) || 0;
    const lastEventAt = Number(run.lastEventAt || 0) || 0;
    const youngest = Math.max(startedAt, lastEventAt);
    if (youngest > 0 && now - youngest < graceMs) { delete misses[sid]; keep.add(sid); continue; }
    const entry = misses[sid] && typeof misses[sid] === 'object' ? misses[sid] : { count: 0, firstAt: now };
    entry.count += 1;
    misses[sid] = entry;
    const ageKnown = youngest > 0 || now - entry.firstAt >= graceMs;
    if (entry.count >= threshold && ageKnown) {
      delete misses[sid];
      clear.push(sid);
    } else {
      keep.add(sid);
    }
  }
  return { keep, clear };
}

/**
 * Drawer "Working" precedence. When the server answer is authoritative
 * (activeRunKnown) and says activeRun:false, only a foreground session whose
 * stream applied an event within freshMs may still show Working.
 */
export function resolveDrawerActiveRun({
  serverActiveRun = false,
  activeRunKnown = false,
  liveActiveRun = false,
  liveEventAt = 0,
  foreground = false,
  localRunFresh = false,
  cachedRunFresh = false,
  now = Date.now(),
  freshMs = MOBILE_LIVE_EVENT_FRESH_MS,
} = {}) {
  if (serverActiveRun === true) return true;
  if (activeRunKnown) {
    return !!(liveActiveRun && foreground && Number(liveEventAt) > 0 && now - Number(liveEventAt) < freshMs);
  }
  return !!(liveActiveRun || localRunFresh || cachedRunFresh);
}

/**
 * Page-runtime silence backstop. One interval checks the time since the last
 * applied stream event; after silenceMs it triggers recovery once per silence
 * window (a new event re-arms it). Skipped while not busy or while a question
 * card is pending (a run blocked on a question is legitimately silent).
 */
export function createMobileSilenceBackstop({
  isBusy = () => false,
  hasPendingQuestion = () => false,
  onSilence = () => {},
  now = () => Date.now(),
  silenceMs = MOBILE_SILENCE_BACKSTOP_MS,
  intervalMs = MOBILE_SILENCE_CHECK_INTERVAL_MS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  let lastEventAt = now();
  let firedForWindow = false;
  let handle = null;
  const check = () => {
    if (!isBusy()) { lastEventAt = now(); firedForWindow = false; return false; }
    if (hasPendingQuestion()) { lastEventAt = now(); return false; }
    if (firedForWindow) return false;
    if (now() - lastEventAt < silenceMs) return false;
    firedForWindow = true;
    try { onSilence(now() - lastEventAt); } catch {}
    return true;
  };
  return {
    noteEvent() { lastEventAt = now(); firedForWindow = false; },
    check,
    start() { if (handle == null) handle = setIntervalFn(check, intervalMs); },
    stop() { if (handle != null) { clearIntervalFn(handle); handle = null; } },
    get running() { return handle != null; },
    get lastEventAt() { return lastEventAt; },
  };
}
