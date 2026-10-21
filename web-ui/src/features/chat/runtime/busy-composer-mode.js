// Shared rule for what the composer does when a message is sent while the chat run is busy.
// 'queue' (default): the message joins the queue and runs next (today's behavior).
// 'steer': the message is queued and then immediately steered into the active run.
// The server persists this as session.busyComposerMode (GET/POST /api/settings/session).

export const BUSY_COMPOSER_MODE_QUEUE = 'queue';
export const BUSY_COMPOSER_MODE_STEER = 'steer';

export function normalizeBusyComposerMode(value) {
  return value === BUSY_COMPOSER_MODE_STEER ? BUSY_COMPOSER_MODE_STEER : BUSY_COMPOSER_MODE_QUEUE;
}

export function shouldAutoSteerBusyTurn({ mode, isQueuedReplay = false, sessionBusy = false } = {}) {
  return normalizeBusyComposerMode(mode) === BUSY_COMPOSER_MODE_STEER
    && sessionBusy === true
    && isQueuedReplay !== true;
}

// Per-surface cache. Each surface loads it once at startup and refreshes it after a save.
let cachedMode = BUSY_COMPOSER_MODE_QUEUE;

export function getCachedBusyComposerMode() {
  return cachedMode;
}

export function setCachedBusyComposerMode(value) {
  cachedMode = normalizeBusyComposerMode(value);
  return cachedMode;
}

// fetchJson(url) must resolve to the parsed JSON body of GET /api/settings/session.
export async function loadBusyComposerModeFromServer(fetchJson) {
  try {
    const data = await fetchJson('/api/settings/session');
    return setCachedBusyComposerMode(data?.session?.busyComposerMode);
  } catch {
    return cachedMode;
  }
}
