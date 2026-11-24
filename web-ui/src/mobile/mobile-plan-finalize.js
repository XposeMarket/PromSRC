// Replay reconciliation must never replace a newer turn's declared plan.
export function finalizeMobileMainPlan(chat, sid, loadReplay, apply, render) {
  const key = String(sid || '');
  const latestUser = () => [...(chat.threads?.[key] || [])].reverse().find((row) => row?.role === 'user');
  const user = latestUser();
  const requestId = String(chat.activeRuns?.[key]?.clientRequestId || user?._clientRequestId || '');
  const items = Array.isArray(chat.mainPlanProgress?.[key]?.items) ? chat.mainPlanProgress[key].items : [];
  if (items.length && !chat.mainPlanProgress[key].usageLimitPaused) {
    const finalized = items.map((item) => {
      const status = String(item?.status || '').trim().toLowerCase();
      if (/^(done|complete|completed|skipped|failed)$/.test(status)) return item;
      return { ...item, status: /^(in_progress|active|running)$/.test(status) ? 'done' : 'skipped' };
    });
    apply({ source: 'declared', reason: 'finalized_local', activeIndex: -1, total: finalized.length, items: finalized }, key);
    render(null, key);
  }
  // The renderer mutates the state object in place, replacing its items array.
  // Capture that generation AFTER local finalization, not the mutable state.
  const generation = chat.mainPlanProgress?.[key]?.items;
  return loadReplay(key, Number.MAX_SAFE_INTEGER).then((replay) => {
    const liveRequestId = String(chat.activeRuns?.[key]?.clientRequestId || '');
    if (latestUser() !== user || (liveRequestId && liveRequestId !== requestId)
      || chat.mainPlanProgress?.[key]?.items !== generation) return;
    const progress = replay?.stream?.progressState;
    if (progress?.source === 'declared' && Array.isArray(progress.items) && progress.items.length) {
      apply(progress, key);
      render(null, key);
    }
  }).catch(() => {});
}

// Keep declared-plan updates beside finalization, outside the legacy renderer.
export function applyMobileMainPlanProgress(state, evt, normalizeStatus) {
  state.usageLimitPaused = evt.reason === 'usage_limit_paused';
  const source = String(evt.source || '').trim().toLowerCase();
  const incoming = Array.isArray(evt.items) ? evt.items : [];
  // Only an explicit declare_plan owns this UI. Internal preflight and inferred
  // tool-sequence progress must never create or update the visible plan pill.
  if (source !== 'declared' || !incoming.length || Number(evt.total || incoming.length) <= 0) {
    state.items = [];
    state.activeIndex = -1;
    state.total = 0;
    state.open = false;
    return state;
  }
  state.items = incoming.map((item, index) => ({
    text: String(item?.text || item?.label || `Step ${index + 1}`).trim(),
    status: normalizeStatus(item?.status),
  }));
  state.total = Math.max(state.items.length, Number(evt.total || 0) || 0);
  state.activeIndex = Number.isFinite(Number(evt.activeIndex)) ? Number(evt.activeIndex) : state.items.findIndex((item) => item.status === 'in_progress');
  return state;
}
