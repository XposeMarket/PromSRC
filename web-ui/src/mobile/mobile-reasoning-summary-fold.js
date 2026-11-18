// OpenAI (Responses API) reasoning summaries in the mobile tool stream.
// Raul, 2026-11-05: summaries must overwrite ONE live label inside the tool
// stream instead of piling up as reply-like paragraphs between tool groups.
// Anthropic (Claude 4+) summarized thinking now arrives on the same
// reasoning_summary channel (Raul, 2026-11-11: unify providers), so it renders here too. Prom's own
// agent_progress narration, preambles and full thoughts are left untouched.
// No nested disclosure element is introduced (the turn already owns its "Working for"
// drawer; Raul, 2026-10-28). Pure module: the renderer passes its label
// renderer in, so Node regressions can import this file directly.

const TITLE_MAX = 900;
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

// Newest summary PARAGRAPH (not just its first line), so a full Anthropic
// thinking paragraph or an OpenAI "**Heading**" + body streams in the header
// until the next paragraph replaces it (Raul, 2026-11-11). A lone bold heading
// directly before the newest paragraph is kept as its first line.
const _isHeadingParagraph = (paragraph) => /^\s*(\*\*|__)[^\n]+(\*\*|__)\s*$/.test(paragraph) || /^\s*#{1,6}\s+\S[^\n]*$/.test(paragraph);
const _cleanSummaryLine = (line) => line.replace(/^[#*_>\s-]+|[*_\s]+$/g, '').replace(/\*\*|__/g, '').trim();

export function mobileReasoningSummaryTitle(entries) {
  const list = Array.isArray(entries) ? entries : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const text = String(list[index]?.text || list[index]?.content || '');
    const paragraphs = text.split(/\r?\n\s*\r?\n/).map((part) => part.trim()).filter(Boolean);
    if (!paragraphs.length) continue;
    const last = paragraphs[paragraphs.length - 1];
    const previous = paragraphs[paragraphs.length - 2];
    const block = !_isHeadingParagraph(last) && previous && _isHeadingParagraph(previous) ? `${previous}\n${last}` : last;
    const value = block.split(/\r?\n/).map(_cleanSummaryLine).filter(Boolean).join('\n');
    if (value) return value.length > TITLE_MAX ? `${value.slice(0, TITLE_MAX - 1).trimEnd()}…` : value;
  }
  return '';
}

// Stable header key: changes only when a NEW reasoning block or paragraph starts,
// not on every streamed delta. Keying on the full text re-ran the label swap
// animation per token and made long Anthropic thinking unusably laggy (2026-11-12).
export function mobileReasoningSummaryKey(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const last = list[list.length - 1];
  const text = String(last?.text || last?.content || '');
  const paragraphs = text.split(/\r?\n\s*\r?\n/).filter((part) => part.trim()).length;
  return `reasoning:${list.length}:${paragraphs}`;
}

const _isReasoningDeltaEntry = (entry) => String(entry?.extra?.event || entry?.event || '').toLowerCase() === 'reasoning_summary_delta';

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
        // Keep reasoning IN ORDER with the tool rows (reasoning, calls, reasoning, calls)
        // so the expanded tool section reads chronologically. Consecutive delta
        // fragments from older/other persistence paths merge into one block.
        const lastEntry = phase.entries[phase.entries.length - 1];
        const lastReasoning = phase.reasoningEntries[phase.reasoningEntries.length - 1];
        if (lastEntry && lastEntry === lastReasoning && _isReasoningDeltaEntry(lastEntry) && _isReasoningDeltaEntry(entry)) {
          const merged = { ...lastEntry, text: `${lastEntry.text || lastEntry.content || ''}${entry.text || entry.content || ''}` };
          if ('content' in lastEntry) merged.content = merged.text;
          phase.entries[phase.entries.length - 1] = merged;
          phase.reasoningEntries[phase.reasoningEntries.length - 1] = merged;
        } else {
          phase.reasoningEntries.push(entry);
          phase.entries.push(entry);
        }
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
          Object.assign(phase, toolFields, { kind: 'tools', entries: phase.entries });
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
  const key = mobileReasoningSummaryKey(group?.reasoningEntries || group?.entries);
  const label = typeof renderLabel === 'function' ? renderLabel(title) : _escape(title);
  return `<div class="pm-trace-thought-group pm-trace-reasoning-live" data-pm-trace-live-current="1" data-pm-trace-group="${_escape(group?.id || MOBILE_REASONING_LIVE_GROUP_ID)}">`
    + `<div class="pm-trace-thought-summary" aria-live="polite"><strong class="t-think is-reasoning" data-pm-trace-summary-key="${_escape(key)}">${label}</strong></div>`
    + '</div>';
}
