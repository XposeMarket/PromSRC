// OpenAI (Responses API) reasoning summaries in the mobile tool stream.
// Raul, 2026-11-05: summaries must overwrite ONE live label inside the tool
// stream instead of piling up as reply-like paragraphs between tool groups.
// Anthropic thinking is private and never reaches this path. Prom's own
// agent_progress narration, preambles and full thoughts are left untouched.
// No nested disclosure element is introduced (the turn already owns its "Working for"
// drawer; Raul, 2026-10-28). Pure module: the renderer passes its label
// renderer in, so Node regressions can import this file directly.

const TITLE_MAX = 160;
export const MOBILE_REASONING_LIVE_GROUP_ID = 'trace_group_reasoning_live';

function _escape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isMobileReasoningSummaryEntry(entry) {
  if (!entry || typeof entry !== 'object' || entry.activity) return false;
  const extra = entry.extra && typeof entry.extra === 'object' ? entry.extra : {};
  const kind = String(extra.reasoningKind || entry.reasoningKind || '').trim().toLowerCase();
  if (kind === 'full_thought') return false;
  return String(entry.type || '').trim().toLowerCase() === 'reasoning_summary'
    || String(extra.source || entry.source || '').trim().toLowerCase() === 'reasoning_summary';
}

// First meaningful line of the newest summary: OpenAI summaries open with a
// short bold heading ("**Inspecting the renderer**").
export function mobileReasoningSummaryTitle(entries) {
  const list = Array.isArray(entries) ? entries : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const text = String(list[index]?.text || list[index]?.content || '');
    const line = text.split(/\r?\n/)
      .map((part) => part.replace(/^[#*_>\s-]+|[*_\s]+$/g, '').trim())
      .find(Boolean) || '';
    if (line) return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1).trimEnd()}…` : line;
  }
  return '';
}

// Safe provider summaries are mutable headers, NOT narration boundaries.
// Keep one stable tool phase until actual commentary/vision/compaction arrives.
// This reducer is shared by desktop and mobile, including restored history.
export function foldMobileReasoningSummaryGroups(groups, { streaming = false } = {}) {
  const list = Array.isArray(groups) ? groups.filter(Boolean) : [];
  if (!list.some((group) => (group.entries || []).some(isMobileReasoningSummaryEntry))) return list;
  if (!streaming && !list.some((group) => group.kind === 'tools')) return list;
  const out = [];
  let phase = null;
  const appendBoundary = (group) => { phase = null; out.push(group); };
  for (const group of list) {
    if (group.kind === 'thought-summary') {
      for (const entry of group.entries || []) {
        if (!isMobileReasoningSummaryEntry(entry)) {
          appendBoundary({ ...group, entries: [entry] });
          continue;
        }
        if (!phase) {
          phase = { kind: 'reasoning-live', id: `reasoning_phase_${entry.id || group.id || out.length}`, entries: [], reasoningEntries: [] };
          out.push(phase);
        }
        phase.reasoningEntries.push(entry);
        if (phase.kind === 'reasoning-live') phase.entries.push(entry);
        phase.title = mobileReasoningSummaryTitle(phase.reasoningEntries);
      }
      continue;
    }
    if (group.kind === 'tools') {
      if (!phase) {
        phase = { ...group, entries: [...(group.entries || [])], reasoningEntries: [...(group.reasoningEntries || [])] };
        out.push(phase);
      } else {
        if (phase.kind === 'reasoning-live') {
          // Keep every tool-group field (status, live flags, metadata); keep the phase id,
          // header title and accumulated reasoning entries so the header stays stable.
          const { id: _id, kind: _kind, entries: _entries, reasoningEntries: _reasoning, title: _title, ...toolFields } = group;
          Object.assign(phase, toolFields, { kind: 'tools', entries: [] });
        }
        phase.entries.push(...(group.entries || []));
        phase.reasoningEntries.push(...(group.reasoningEntries || []));
      }
      continue;
    }
    appendBoundary(group);
  }
  // A non-streaming (restored/completed) trailing summary phase is static history, not a live thinking label.
  if (!streaming) for (const group of out) if (group.kind === 'reasoning-live') group.kind = 'thought-summary';
  return out;
}

export function renderMobileReasoningLiveGroup(group, { renderLabel = _escape } = {}) {
  const title = String(group?.title || mobileReasoningSummaryTitle(group?.entries) || '').trim();
  if (!title) return '';
  const key = title.replace(/\s+/g, ' ').trim().toLowerCase();
  const label = typeof renderLabel === 'function' ? renderLabel(title) : _escape(title);
  return `<div class="pm-trace-thought-group pm-trace-reasoning-live" data-pm-trace-live-current="1" data-pm-trace-group="${_escape(group?.id || MOBILE_REASONING_LIVE_GROUP_ID)}">`
    + `<div class="pm-trace-thought-summary" aria-live="polite"><strong class="t-think" data-pm-trace-summary-key="${_escape(key)}">${label}</strong></div>`
    + '</div>';
}
