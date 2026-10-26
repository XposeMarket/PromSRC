function traceIdentity(entry) {
  if (!entry || typeof entry !== 'object') return `primitive:${String(entry)}`;
  const activity = entry.activity && typeof entry.activity === 'object' ? entry.activity : {};
  const extra = entry.extra && typeof entry.extra === 'object' ? entry.extra : {};
  const type = String(entry.type || '').trim().toLowerCase();
  const stableId = String(
    entry.id || entry.eventKey || extra.eventKey
    || activity.callId || activity.call_id || activity.activityId
    || extra.callId || extra.call_id || extra.toolCallId || extra.tool_call_id
    || entry.callId || entry.call_id || entry.toolCallId || '',
  ).trim();
  if (stableId) return `id:${type}:${stableId}`;
  try { return `value:${JSON.stringify(entry)}`; } catch { return `fallback:${type}:${String(entry.text || entry.content || '')}:${String(entry.time || entry.ts || '')}`; }
}

export function mergeMobileBackgroundTraceEntries(currentEntries = [], recoveredEntries = [], limit = 500) {
  const seen = new Set();
  const merged = [];
  for (const entry of [...(Array.isArray(currentEntries) ? currentEntries : []), ...(Array.isArray(recoveredEntries) ? recoveredEntries : [])]) {
    const key = traceIdentity(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  return merged.slice(-Math.max(1, Number(limit) || 500));
}
