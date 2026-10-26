// Shared, dependency-free background stream presentation helpers.
export function backgroundSpawnCollapsedDetail(lane = {}, preview = String) {
  const events = Array.isArray(lane.events) ? lane.events : [];
  const latest = [...events].reverse().find((entry) => {
    const extra = entry?.extra && typeof entry.extra === 'object' ? entry.extra : {};
    const eventType = String(extra.eventType || extra.event || '').trim().toLowerCase();
    return !['reasoning_summary', 'reasoning_summary_delta', 'reasoning_delta'].includes(eventType)
      && String(extra.reasoningKind || '').trim().toLowerCase() !== 'summary';
  });
  return String(latest?.content || '').trim()
    || (lane.result ? preview(lane.result, 120) : 'Working in parallel...');
}

export function mergeBackgroundReasoningSummary(trace, text, extra, index, { delta = false } = {}) {
  const raw = String(text || '');
  const next = raw.trim();
  if (!next) return;
  const latest = trace.at(-1);
  const previous = latest
    && String(latest?.extra?.source || '').toLowerCase() === 'reasoning_summary'
    ? latest
    : null;
  const visibleExtra = {
    ...extra,
    source: 'reasoning_summary',
    visibility: 'summary',
    reasoningKind: 'summary',
    _trailingSpace: /\s$/.test(raw),
  };
  if (!previous) {
    trace.push({
      id: `background_trace_${index}`,
      type: 'think',
      text: next,
      ts: String(extra?.ts || ''),
      extra: visibleExtra,
    });
    return;
  }
  const current = String(previous.text || '').trim();
  const isSnapshot = next.length > current.length && next.startsWith(current);
  const canAppend = delta
    && current
    && !isSnapshot
    && !/[.!?:]\s*$/.test(current)
    && (/^\s/.test(text) || /^[a-z0-9,'"‘’“”\-—.;:!?)}\]]/.test(next));
  const needsSpace = /^\s/.test(raw) || Boolean(previous.extra?._trailingSpace);
  previous.text = canAppend ? `${current}${needsSpace ? ' ' : ''}${next}`.replace(/\s+/g, ' ').trim() : next;
  previous.extra = { ...(previous.extra || {}), ...visibleExtra };
}
