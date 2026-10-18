// Replay reconciliation must never replace a newer turn's declared plan.
export function finalizeMobileMainPlan(chat, sid, loadReplay, apply, render) {
  const key = String(sid || '');
  const latestUser = () => [...(chat.threads?.[key] || [])].reverse().find((row) => row?.role === 'user');
  const user = latestUser();
  const requestId = String(chat.activeRuns?.[key]?.clientRequestId || user?._clientRequestId || '');
  const items = Array.isArray(chat.mainPlanProgress?.[key]?.items) ? chat.mainPlanProgress[key].items : [];
  if (items.length) {
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
