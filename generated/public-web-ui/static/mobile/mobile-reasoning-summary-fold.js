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

// Render-time fold over _mobileTraceGroups output. Data and caches keep every
// per-phase summary; only the presentation changes:
// - summaries waiting for a tool phase move into that tool group
//   (reasoningEntries: full text in the collapsible body, latest title in the
//   live header);
// - when a summary is the newest live activity it becomes one live label
//   with a stable id, so the next summary overwrites it in place;
// - a completed turn without any tool phase keeps its original groups (they
//   already sit inside the collapsed work drawer).
export function foldMobileReasoningSummaryGroups(groups, { streaming = false } = {}) {
  const list = Array.isArray(groups) ? groups.filter(Boolean) : [];
  if (!list.some((group) => group.kind === 'thought-summary'
    && (group.entries || []).some(isMobileReasoningSummaryEntry))) return list;
  if (!streaming && !list.some((group) => group.kind === 'tools')) return list;
  const lastGroup = list[list.length - 1];
  const lastEntries = Array.isArray(lastGroup?.entries) ? lastGroup.entries : [];
  const latestIsReasoning = Boolean(streaming
    && lastGroup?.kind === 'thought-summary'
    && isMobileReasoningSummaryEntry(lastEntries[lastEntries.length - 1]));
  const out = [];
  let pending = [];
  const attachToLatestToolGroup = (entries) => {
    for (let index = out.length - 1; index >= 0; index -= 1) {
      if (out[index].kind !== 'tools') continue;
      out[index] = { ...out[index], reasoningEntries: [...(out[index].reasoningEntries || []), ...entries] };
      return true;
    }
    return false;
  };
  list.forEach((group) => {
    if (group.kind === 'thought-summary') {
      const entries = Array.isArray(group.entries) ? group.entries : [];
      const reasoning = entries.filter(isMobileReasoningSummaryEntry);
      if (!reasoning.length) {
        out.push(group);
        return;
      }
      pending.push(...reasoning);
      const rest = entries.filter((entry) => !isMobileReasoningSummaryEntry(entry));
      if (rest.length) out.push({ ...group, entries: rest });
      return;
    }
    if (group.kind === 'tools' && pending.length) {
      out.push({ ...group, reasoningEntries: [...(group.reasoningEntries || []), ...pending] });
      pending = [];
      return;
    }
    out.push(group);
  });
  if (pending.length) {
    if (latestIsReasoning) {
      out.push({
        kind: 'reasoning-live',
        id: MOBILE_REASONING_LIVE_GROUP_ID,
        entries: pending,
        title: mobileReasoningSummaryTitle(pending),
      });
    } else {
      // Not the newest activity: keep the text with the latest tool phase.
      // A live turn without any tool phase yet simply hides it until one
      // exists; the completed drawer still shows it.
      attachToLatestToolGroup(pending);
    }
  }
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
