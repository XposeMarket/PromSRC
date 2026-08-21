/**
 * Timeline DOM snapshot/restore helpers.
 *
 * These preserve interactive state across the legacy full-message DOM rebuild
 * while ChatPage is incrementally decomposed toward a windowed timeline.
 */

export function captureProcessPanelScroll() {
  const map = {};
  try {
    document.querySelectorAll('#current-turn-process, [id^="proc_msg_"], [id^="proc_"]').forEach((el) => {
      if (!el || !el.id) return;
      if (el.style && el.style.display === 'none') return;
      const atBottom = (el.scrollHeight - (el.scrollTop + el.clientHeight)) <= 24;
      map[el.id] = { scrollTop: el.scrollTop, atBottom };
    });
  } catch {}
  return map;
}

export function restoreProcessPanelScroll(map) {
  if (!map) return;
  try {
    Object.keys(map).forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.scrollTop = map[id].atBottom ? el.scrollHeight : map[id].scrollTop;
    });
  } catch {}
}

export function captureQuestionDraftState() {
  const out = {};
  try {
    document.querySelectorAll('[data-question-id]').forEach((card) => {
      // Only the card root carries data-question-id with a child input structure.
      const qid = card.getAttribute('data-question-id');
      if (!qid || !card.classList || !card.classList.contains('chat-question-card')) return;
      const state = { checked: [], texts: {}, others: {}, general: '', composeTarget: card.getAttribute('data-question-compose-target') || '', focus: null };
      card.querySelectorAll('input[type="radio"]:checked, input[type="checkbox"]:checked').forEach((el) => {
        state.checked.push(`${el.getAttribute('data-question-id') || ''}::${el.value}`);
      });
      card.querySelectorAll('[data-question-text]').forEach((el) => { state.texts[el.getAttribute('data-question-text')] = el.value || ''; });
      card.querySelectorAll('[data-question-other]').forEach((el) => { state.others[el.getAttribute('data-question-other')] = { value: el.value || '', hidden: el.hasAttribute('hidden') }; });
      const gen = card.querySelector('[data-question-general-other="1"]');
      if (gen) state.general = gen.value || '';
      // Preserve which textbox is focused + caret position, so streaming
      // re-renders don't steal focus / interrupt typing.
      try {
        const active = document.activeElement;
        if (active && card.contains(active) && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
          let kind = '', key = '';
          if (active.hasAttribute('data-question-general-other')) { kind = 'general'; }
          else if (active.hasAttribute('data-question-text')) { kind = 'text'; key = active.getAttribute('data-question-text') || ''; }
          else if (active.hasAttribute('data-question-other')) { kind = 'other'; key = active.getAttribute('data-question-other') || ''; }
          if (kind) {
            state.focus = {
              kind,
              key,
              selStart: typeof active.selectionStart === 'number' ? active.selectionStart : null,
              selEnd: typeof active.selectionEnd === 'number' ? active.selectionEnd : null,
            };
          }
        }
      } catch {}
      out[qid] = state;
    });
  } catch {}
  return out;
}

export function restoreQuestionDraftState(map) {
  if (!map) return;
  try {
    Object.keys(map).forEach((qid) => {
      const sel = (window.CSS && CSS.escape) ? CSS.escape(qid) : qid;
      const card = document.querySelector(`.chat-question-card[data-question-id="${sel}"]`);
      if (!card) return;
      const state = map[qid];
      if (state.composeTarget) card.setAttribute('data-question-compose-target', state.composeTarget);
      const want = new Set(state.checked || []);
      card.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach((el) => {
        if (want.has(`${el.getAttribute('data-question-id') || ''}::${el.value}`)) el.checked = true;
      });
      Object.entries(state.texts || {}).forEach(([id, val]) => {
        const el = card.querySelector(`[data-question-text="${(window.CSS && CSS.escape) ? CSS.escape(id) : id}"]`);
        if (el) el.value = val;
      });
      Object.entries(state.others || {}).forEach(([id, info]) => {
        const el = card.querySelector(`[data-question-other="${(window.CSS && CSS.escape) ? CSS.escape(id) : id}"]`);
        if (el) { el.value = info.value || ''; if (!info.hidden) el.removeAttribute('hidden'); }
      });
      const gen = card.querySelector('[data-question-general-other="1"]');
      if (gen) gen.value = state.general || '';
      // Re-focus the textbox the user was typing in and restore the caret,
      // so a streaming re-render mid-keystroke doesn't drop focus.
      try {
        if (state.focus && state.focus.kind) {
          let el = null;
          if (state.focus.kind === 'general') el = gen;
          else if (state.focus.kind === 'text') el = card.querySelector(`[data-question-text="${(window.CSS && CSS.escape) ? CSS.escape(state.focus.key) : state.focus.key}"]`);
          else if (state.focus.kind === 'other') el = card.querySelector(`[data-question-other="${(window.CSS && CSS.escape) ? CSS.escape(state.focus.key) : state.focus.key}"]`);
          if (el && !el.hasAttribute('hidden') && document.activeElement !== el) {
            el.focus({ preventScroll: true });
            const len = el.value ? el.value.length : 0;
            const s = state.focus.selStart == null ? len : Math.min(state.focus.selStart, len);
            const e = state.focus.selEnd == null ? len : Math.min(state.focus.selEnd, len);
            if (typeof el.setSelectionRange === 'function') el.setSelectionRange(s, e);
          }
        }
      } catch {}
    });
  } catch {}
}

export function captureApprovalDetailsState() {
  const out = {};
  try {
    document.querySelectorAll('.chat-approval-card[data-approval-id]').forEach((card) => {
      const approvalId = String(card.getAttribute('data-approval-id') || '').trim();
      if (!approvalId) return;
      card.querySelectorAll('details.chat-approval-technical').forEach((details) => {
        const label = String(details.querySelector('summary')?.textContent || '').trim();
        if (!label) return;
        out[`${approvalId}::${label}`] = details.open === true;
      });
    });
  } catch {}
  return out;
}

export function restoreApprovalDetailsState(map) {
  if (!map) return;
  try {
    document.querySelectorAll('.chat-approval-card[data-approval-id]').forEach((card) => {
      const approvalId = String(card.getAttribute('data-approval-id') || '').trim();
      if (!approvalId) return;
      card.querySelectorAll('details.chat-approval-technical').forEach((details) => {
        const label = String(details.querySelector('summary')?.textContent || '').trim();
        const key = `${approvalId}::${label}`;
        if (!Object.prototype.hasOwnProperty.call(map, key)) return;
        if (map[key]) details.setAttribute('open', '');
        else details.removeAttribute('open');
      });
    });
  } catch {}
}
