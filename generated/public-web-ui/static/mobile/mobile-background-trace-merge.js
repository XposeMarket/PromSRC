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
  const streamId = String(entry.streamId || extra.streamId || activity.streamId || '').trim();
  const seq = Number(entry.seq || extra.seq || activity.seq || 0);
  if (stableId) return `id:${type}:${stableId}`;
  if (streamId && seq > 0) return `stream:${type}:${streamId}:${seq}`;
  // Persistence adds an empty time field. It must not turn a live prose row
  // into a distinct recovered row on every status/tool packet.
  const canonical = { ...entry };
  if (!canonical.time) delete canonical.time;
  try { return `value:${JSON.stringify(canonical)}`; } catch { return `fallback:${type}:${String(entry.text || entry.content || '')}:${String(entry.time || entry.ts || '')}`; }
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
  // A checkpoint may restore earlier commentary after newer tool rows arrived.
  // Insert it at its stream position, not at the tail of the live journal.
  merged.sort((a, b) => {
    const aStream = String(a?.streamId || a?.extra?.streamId || a?.activity?.streamId || '');
    const bStream = String(b?.streamId || b?.extra?.streamId || b?.activity?.streamId || '');
    const aSeq = Number(a?.seq || a?.extra?.seq || a?.activity?.seq || 0);
    const bSeq = Number(b?.seq || b?.extra?.seq || b?.activity?.seq || 0);
    return aStream && aStream === bStream && aSeq > 0 && bSeq > 0 ? aSeq - bSeq : 0;
  });
  return merged.slice(-Math.max(1, Number(limit) || 500));
}
