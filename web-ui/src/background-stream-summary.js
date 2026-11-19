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

function oneLine(value, max = 220) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function pendingApproval(lane) {
  const request = lane?.approvalRequest || lane?.pendingApproval || null;
  if (!request) return null;
  return String(request.status || 'pending').toLowerCase() === 'pending' ? request : null;
}

// Pill status shared by the desktop dock and the mobile dock.
export function backgroundSpawnStatusLabel(lane = {}) {
  if (pendingApproval(lane)) return 'approval';
  const status = String(lane?.status || 'running').toLowerCase();
  if (status === 'in_progress' || status === 'queued' || status === 'starting') return 'running';
  if (status === 'timed_out') return 'timed out';
  return status || 'running';
}

// One-line pill copy, same precedence as the mobile background-agent dock:
// pending approval -> final result -> error -> agent progress summary ->
// friendly current tool (running) / tool summary (finished) -> task.
// The formatters are injected so desktop and mobile keep their own trace
// presentation; nothing here ever surfaces the raw latest event payload.
export function backgroundSpawnLaneSummary(lane = {}, {
  entries = [],
  progressSummary = null,
  liveToolLabel = null,
  toolSummary = null,
} = {}) {
  const status = String(lane?.status || 'running').toLowerCase();
  const running = !['completed', 'failed', 'timed_out', 'cancelled', 'canceled', 'stopped'].includes(status);
  const approval = pendingApproval(lane);
  if (approval) {
    const title = oneLine(approval.title || approval.summary || approval.action || approval.toolName || '', 160);
    return title ? `Approval needed: ${title}` : 'Approval needed';
  }
  if (status === 'completed' && oneLine(lane?.result)) return oneLine(lane.result);
  if ((status === 'failed' || status === 'timed_out') && oneLine(lane?.error)) return oneLine(lane.error);
  const traceEntries = Array.isArray(entries) ? entries : [];
  if (traceEntries.length) {
    const call = (fn) => {
      if (typeof fn !== 'function') return '';
      try { return oneLine(fn(traceEntries)); } catch { return ''; }
    };
    const progress = call(progressSummary) || (running ? call(liveToolLabel) : call(toolSummary));
    if (progress) return progress;
  }
  return oneLine(lane?.task) || (running ? 'Working in parallel...' : (oneLine(lane?.result) || 'Finished'));
}
