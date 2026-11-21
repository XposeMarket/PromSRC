/** Tool results may carry the wrapper name or its normalized internal name. Only
 * an admitted execution participates in the requesting turn's synthesis. */
export function pendingReviewerRounds(rows: ReadonlyArray<{name: string; args?: {action?: unknown}; result: string; error?: boolean}>, included: ReadonlySet<string>) {
  const runs = new Map<string, {id: string; timeoutMs?: number}>();
  for (const row of rows) {
    if (row.error) continue;
    const action = row.name === 'background_ops' ? String(row.args?.action || '').toLowerCase() : row.name;
    if (!['background_spawn', 'spawn', 'start', 'background_follow_up', 'follow_up'].includes(action)) continue;
    try {
      const result = JSON.parse(row.result);
      if (action.endsWith('follow_up') && !(result.newExecution === true && result.queued === true)) continue;
      const id = String(result.id || '').trim(), timeout = Number(result.timeoutMs);
      if (id && !included.has(id)) runs.set(id, {id, timeoutMs: timeout > 0 && Number.isFinite(timeout) ? Math.floor(timeout) : undefined});
    } catch { /* malformed tool receipt is not a wait handle */ }
  }
  return [...runs.values()];
}
