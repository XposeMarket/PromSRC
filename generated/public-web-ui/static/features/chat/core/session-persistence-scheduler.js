// Coalesce expensive full-session serialization without delaying lifecycle/terminal saves.
export function createSessionPersistenceScheduler({
  save,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = Date.now,
  delayMs = 750,
  backgroundDelayMs = 4000,
}) {
  let timer = null;
  let dueAt = 0;
  let dirty = false;
  function flush() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    dueAt = 0;
    if (!dirty) return;
    dirty = false;
    try { save(); } catch (err) { dirty = true; throw err; }
  }
  function schedule({ background = false } = {}) {
    dirty = true;
    // A fixed deadline prevents a continuous stream from starving persistence.
    const nextDue = now() + (background ? backgroundDelayMs : delayMs);
    if (timer !== null && dueAt <= nextDue) return;
    if (timer !== null) clearTimer(timer);
    dueAt = nextDue;
    timer = setTimer(flush, Math.max(0, nextDue - now()));
  }
  return { schedule, flush };
}

export function attachSessionPersistenceLifecycle(windowRef, documentRef, flush, beforeFlush = () => {}) {
  const onExit = () => { beforeFlush(); flush(); };
  windowRef.addEventListener('pagehide', onExit);
  windowRef.addEventListener('beforeunload', onExit);
  documentRef.addEventListener('visibilitychange', () => {
    if (documentRef.hidden) onExit();
  });
}
