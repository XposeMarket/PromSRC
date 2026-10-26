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
  const append = (entry, recovered = false) => {
    const key = traceIdentity(entry);
    if (seen.has(key)) return;
    seen.add(key);
    const stream = String(entry?.streamId || entry?.extra?.streamId || entry?.activity?.streamId || '').trim();
    const seq = Number(entry?.seq || entry?.extra?.seq || entry?.activity?.seq || 0);
    // Only recovered rows move. A global partial comparator is not transitive
    // across unsequenced/other-stream rows and can leave earlier prose at the tail.
    const before = recovered && stream && seq > 0 ? merged.findIndex(candidate => {
      const candidateStream = String(candidate?.streamId || candidate?.extra?.streamId || candidate?.activity?.streamId || '').trim();
      const candidateSeq = Number(candidate?.seq || candidate?.extra?.seq || candidate?.activity?.seq || 0);
      return candidateStream === stream && candidateSeq > seq;
    }) : -1;
    if (before < 0) merged.push(entry);
    else merged.splice(before, 0, entry);
  };
  (Array.isArray(currentEntries) ? currentEntries : []).forEach(entry => append(entry));
  (Array.isArray(recoveredEntries) ? recoveredEntries : []).forEach(entry => append(entry, true));
  return merged.slice(-Math.max(1, Number(limit) || 500));
}
