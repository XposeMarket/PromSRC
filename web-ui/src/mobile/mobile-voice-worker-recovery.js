// Bounded recovery for events arriving before their voice workgroup snapshot.
export function createVoiceWorkerRecovery({ fetchGroup, onGroup, now = Date.now }) {
  const pending = new Map();
  const groups = new Map();
  const MAX_TASKS = 128, MAX_GROUPS = 128, TASK_TTL = 60000;
  function prune() {
    const time = now();
    for (const [id, item] of pending) if (time - item.touched >= TASK_TTL) pending.delete(id);
    for (const [id, entry] of groups) {
      if (!entry.promise && time >= entry.expires) groups.delete(id);
    }
  }
  function clearGroup(groupId) {
    for (const [id, item] of pending) if (item.groupId === groupId) pending.delete(id);
  }
  return {
    enqueue(taskId, groupId, item) {
      prune();
      const cached = groups.get(groupId);
      if (cached && !cached.promise && cached.settled && now() < cached.retryAt) return;
      const queued = pending.get(taskId)?.items || [];
      queued.push(item);
      pending.delete(taskId);
      pending.set(taskId, { groupId, items: queued.slice(-40), touched: now() });
      while (pending.size > MAX_TASKS) pending.delete(pending.keys().next().value);
    },
    take(taskId) {
      prune();
      const queued = pending.get(taskId)?.items || [];
      pending.delete(taskId);
      return queued;
    },
    clearGroup,
    invalidate(groupId) {
      const entry = groups.get(groupId);
      // Keep an in-flight slot until settlement: invalidation must not fork requests.
      if (entry?.promise) entry.invalidated = true;
      else groups.delete(groupId);
    },
    fetch(groupId, sessionId) {
      prune();
      let entry = groups.get(groupId);
      if (entry?.promise) return entry.promise;
      if (entry && now() < entry.retryAt) return Promise.resolve(null);
      if (!entry) {
        if (groups.size >= MAX_GROUPS) {
          const evict = [...groups].find(([, value]) => !value.promise);
          if (evict) groups.delete(evict[0]);
          else { clearGroup(groupId); return Promise.resolve(null); }
        }
        entry = { failures: 0 };
      }
      groups.delete(groupId);
      groups.set(groupId, entry);
      const request = Promise.resolve().then(() => fetchGroup(groupId)).then((group) => {
        if (entry.invalidated) return null;
        if (group) onGroup(group, sessionId);
        clearGroup(groupId); // Also discard queued tasks absent from the authoritative group.
        entry.failures = 0;
        entry.settled = true;
        entry.retryAt = now() + 30000;
        entry.expires = entry.retryAt;
        return group || null;
      }).catch((error) => {
        if (entry.invalidated) return null;
        entry.failures += 1;
        const permanent = [404, 410].includes(Number(error?.status));
        entry.settled = permanent;
        entry.retryAt = now() + (permanent ? 30000 : Math.min(30000, 1000 * 2 ** Math.min(entry.failures - 1, 5)));
        entry.expires = entry.retryAt + TASK_TTL;
        if (permanent) clearGroup(groupId);
        return null;
      }).finally(() => {
        entry.promise = null;
        if (entry.invalidated && groups.get(groupId) === entry) groups.delete(groupId);
      });
      entry.promise = request;
      return request;
    },
    get pendingSize() { prune(); return pending.size; },
    get groupSize() { prune(); return groups.size; },
  };
}
