function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

export function createAdaptiveStreamScheduler(options = {}) {
  const floorMs = Math.max(8, Number(options.floorMs || 33));
  const ceilingMs = Math.max(floorMs, Number(options.ceilingMs || 240));
  const hiddenMs = clamp(options.hiddenMs || 180, floorMs, ceilingMs);
  const multiplier = Math.max(1, Number(options.costMultiplier || 2.6));
  const documentRef = options.documentRef === undefined ? globalThis.document : options.documentRef;
  const now = typeof options.now === 'function' ? options.now : (() => globalThis.performance?.now?.() ?? Date.now());
  const setTimer = typeof options.setTimer === 'function' ? options.setTimer : globalThis.setTimeout.bind(globalThis);
  const clearTimer = typeof options.clearTimer === 'function' ? options.clearTimer : globalThis.clearTimeout.bind(globalThis);
  const requestFrame = typeof options.requestFrame === 'function'
    ? options.requestFrame
    : (globalThis.requestAnimationFrame?.bind(globalThis) || ((callback) => setTimer(() => callback(now()), 0)));
  const states = new Map();
  let lastInputAt = -Infinity;
  let destroyed = false;

  const diagnostics = globalThis.__PROM_CHAT_STREAM_DIAGNOSTICS || (globalThis.__PROM_CHAT_STREAM_DIAGNOSTICS = {
    flushes: 0, scheduled: 0, structuralFlushes: 0, hiddenFlushes: 0, last: null,
  });

  function stateFor(key) {
    const id = String(key || 'chat');
    if (!states.has(id)) states.set(id, {
      key: id,
      timer: null,
      pending: null,
      queuedAt: 0,
      lastRunAt: -Infinity,
      intervalMs: floorMs,
      costEmaMs: floorMs / multiplier,
      running: false,
      samples: 0,
      lastCostMs: 0,
      lastLatencyMs: 0,
    });
    return states.get(id);
  }

  function isHidden() { return documentRef?.visibilityState === 'hidden' || documentRef?.hidden === true; }
  function inputPressure() {
    let pending = false;
    try { pending = globalThis.navigator?.scheduling?.isInputPending?.({ includeContinuous: true }) === true; } catch {}
    return pending || (now() - lastInputAt) < 120;
  }

  function finishSample(state, startedAt, queuedAt) {
    const costMs = Math.max(0, now() - startedAt);
    state.samples += 1;
    state.lastCostMs = costMs;
    state.lastLatencyMs = Math.max(0, now() - queuedAt);
    state.costEmaMs = state.samples === 1 ? costMs : (state.costEmaMs * 0.72) + (costMs * 0.28);
    const pressurePenalty = inputPressure() ? 24 : 0;
    state.intervalMs = clamp((state.costEmaMs * multiplier) + pressurePenalty, floorMs, ceilingMs);
    state.running = false;
    diagnostics.last = Object.freeze({
      key: state.key,
      costMs: Number(costMs.toFixed(2)),
      latencyMs: Number(state.lastLatencyMs.toFixed(2)),
      nextIntervalMs: Number(state.intervalMs.toFixed(2)),
      hidden: isHidden(),
    });
    if (state.pending) arm(state, 0);
  }

  function run(state) {
    if (destroyed || state.running || typeof state.pending !== 'function') return;
    if (state.timer != null) { clearTimer(state.timer); state.timer = null; }
    const task = state.pending;
    const queuedAt = state.queuedAt || now();
    state.pending = null;
    state.queuedAt = 0;
    state.running = true;
    state.lastRunAt = now();
    const startedAt = state.lastRunAt;
    diagnostics.flushes += 1;
    if (isHidden()) diagnostics.hiddenFlushes += 1;
    try { task(); } catch (error) { diagnostics.last = Object.freeze({ key: state.key, error: String(error?.message || error) }); }
    if (isHidden()) {
      setTimer(() => finishSample(state, startedAt, queuedAt), 0);
    } else {
      let sampled = false;
      let watchdog = null;
      const complete = () => {
        if (sampled) return;
        sampled = true;
        if (watchdog != null) clearTimer(watchdog);
        finishSample(state, startedAt, queuedAt);
      };
      requestFrame(complete);
      watchdog = setTimer(complete, ceilingMs);
      if (watchdog && typeof watchdog.unref === 'function') watchdog.unref();
    }
  }

  function arm(state, minimumDelay = 0) {
    if (destroyed || state.timer != null || state.running || typeof state.pending !== 'function') return;
    const interval = isHidden() ? hiddenMs : state.intervalMs;
    const dueAt = Math.max(state.lastRunAt + interval, now() + Math.max(0, Number(minimumDelay) || 0));
    state.timer = setTimer(() => {
      state.timer = null;
      run(state);
    }, Math.max(0, dueAt - now()));
    if (state.timer && typeof state.timer.unref === 'function') state.timer.unref();
  }

  function schedule(key, task, scheduleOptions = {}) {
    if (typeof task !== 'function') return false;
    const state = stateFor(key);
    state.pending = task;
    if (!state.queuedAt) state.queuedAt = now();
    diagnostics.scheduled += 1;
    if (scheduleOptions.structural === true) {
      diagnostics.structuralFlushes += 1;
      flush(key, task);
      return true;
    }
    arm(state, scheduleOptions.minimumDelay);
    return true;
  }

  function flush(key, task) {
    const state = stateFor(key);
    if (state.timer != null) { clearTimer(state.timer); state.timer = null; }
    if (typeof task === 'function') {
      state.pending = task;
      state.queuedAt ||= now();
    }
    if (state.running && state.pending) {
      const pending = state.pending;
      state.pending = null;
      state.queuedAt = 0;
      try { pending(); } catch (error) { diagnostics.last = Object.freeze({ key: state.key, error: String(error?.message || error) }); }
      diagnostics.flushes += 1;
      diagnostics.structuralFlushes += 1;
      return true;
    }
    run(state);
    return true;
  }

  function cancel(key) {
    const state = states.get(String(key || 'chat'));
    if (!state) return false;
    if (state.timer != null) clearTimer(state.timer);
    state.timer = null;
    state.pending = null;
    state.queuedAt = 0;
    return true;
  }

  function noteInput(at = now()) { lastInputAt = Number(at) || now(); }

  function snapshot(key) {
    const state = states.get(String(key || 'chat'));
    if (!state) return null;
    return Object.freeze({
      key: state.key,
      pending: !!state.pending,
      running: state.running,
      intervalMs: state.intervalMs,
      costEmaMs: state.costEmaMs,
      samples: state.samples,
      lastCostMs: state.lastCostMs,
      lastLatencyMs: state.lastLatencyMs,
    });
  }

  const onInput = () => noteInput();
  const onVisibility = () => {
    if (isHidden()) return;
    for (const state of states.values()) {
      if (!state.pending) continue;
      if (state.timer != null) { clearTimer(state.timer); state.timer = null; }
      run(state);
    }
  };
  documentRef?.addEventListener?.('input', onInput, true);
  documentRef?.addEventListener?.('keydown', onInput, true);
  documentRef?.addEventListener?.('visibilitychange', onVisibility);

  function destroy() {
    destroyed = true;
    for (const state of states.values()) if (state.timer != null) clearTimer(state.timer);
    states.clear();
    documentRef?.removeEventListener?.('input', onInput, true);
    documentRef?.removeEventListener?.('keydown', onInput, true);
    documentRef?.removeEventListener?.('visibilitychange', onVisibility);
  }

  return Object.freeze({ schedule, flush, cancel, noteInput, snapshot, destroy });
}
