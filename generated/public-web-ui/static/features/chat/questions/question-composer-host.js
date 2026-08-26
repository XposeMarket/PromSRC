const TERMINAL_STATUSES = new Set(['answered', 'cancelled', 'expired', 'resolved']);

function cssEscapeValue(value, documentRef = globalThis.document) {
  const raw = String(value || '');
  const css = documentRef?.defaultView?.CSS || globalThis.CSS;
  if (css && typeof css.escape === 'function') return css.escape(raw);
  return raw.replace(/["\\\]\[]/g, '\\$&');
}

export function questionPlacement(questionOrStatus) {
  const status = String(typeof questionOrStatus === 'object' ? questionOrStatus?.status : questionOrStatus ?? '').trim().toLowerCase() || 'pending';
  return status === 'pending' || status === 'submitting' ? 'composer' : 'history';
}

export function shouldRenderQuestionInComposer(question) {
  return questionPlacement(question) === 'composer';
}

export function shouldRenderQuestionInHistory(question) {
  return TERMINAL_STATUSES.has(String(question?.status || '').trim().toLowerCase()) || questionPlacement(question) === 'history';
}

export function questionForComposer(question) {
  if (!question || typeof question !== 'object') return question;
  return String(question.status || '').toLowerCase() === 'submitting'
    ? { ...question, status: 'pending' }
    : question;
}

export function syncQuestionComposerHost({
  host,
  question,
  render,
  mode = 'desktop',
  composer,
  questionChanged,
  preserveSubmitting = true,
} = {}) {
  if (!host) return;
  if (!shouldRenderQuestionInComposer(question)) {
    if (mode === 'mobile') host.hidden = true;
    else host.style.display = 'none';
    host.innerHTML = '';
    host.removeAttribute('data-question-id');
    composer?.classList?.remove('has-pending-question');
    questionChanged?.();
    return;
  }
  const renderQuestion = preserveSubmitting ? questionForComposer(question) : question;
  host.innerHTML = typeof render === 'function' ? render(renderQuestion) : '';
  if (mode === 'mobile') host.hidden = false;
  else host.style.display = 'block';
  host.setAttribute('data-question-id', String(question.id || ''));
  composer?.classList?.add('has-pending-question');
  questionChanged?.();
}

// Mobile cards use data-pm-q-* attributes and keep a small feature-owned draft
// cache so the page adapter does not have to own question presentation state.
export function captureMobileQuestionDraftState(root, options = {}) {
  const out = {};
  const documentRef = options.document || globalThis.document;
  try {
    root?.querySelectorAll?.('[data-pm-q-card]')?.forEach?.((card) => {
      if (!card.classList || !card.classList.contains('pm-question-card')) return;
      const qid = card.getAttribute('data-pm-q-card');
      if (!qid) return;
      const state = { selected: {}, texts: {}, others: {}, general: '', composeTarget: card.getAttribute('data-pm-q-compose-target') || '', focus: null };
      card.querySelectorAll('[data-pm-q]').forEach((block) => {
        const bid = block.getAttribute('data-pm-q') || '';
        state.selected[bid] = Array.from(block.querySelectorAll('.pm-q-opt.selected'))
          .map((el) => el.getAttribute('data-pm-q-opt') || '').filter(Boolean);
        const textEl = block.querySelector('[data-pm-q-text]');
        if (textEl) state.texts[bid] = textEl.value || '';
        const otherEl = block.querySelector('[data-pm-q-other]');
        if (otherEl) state.others[bid] = { value: otherEl.value || '', hidden: otherEl.hasAttribute('hidden') };
      });
      const gen = card.querySelector('[data-pm-q-general]');
      if (gen) state.general = gen.value || '';
      try {
        const active = documentRef?.activeElement;
        if (active && card.contains(active) && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
          let kind = '', key = '';
          if (active.hasAttribute('data-pm-q-general')) kind = 'general';
          else {
            const block = active.closest('[data-pm-q]');
            key = block ? (block.getAttribute('data-pm-q') || '') : '';
            if (active.hasAttribute('data-pm-q-text')) kind = 'text';
            else if (active.hasAttribute('data-pm-q-other')) kind = 'other';
          }
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
      options.onCapture?.(qid, state);
    });
  } catch {}
  return out;
}

export function restoreMobileQuestionDraftState(root, map, options = {}) {
  if (!root) return;
  const documentRef = options.document || globalThis.document;
  try {
    const combined = { ...(options.drafts || {}), ...(map || {}) };
    Object.keys(combined).forEach((qid) => {
      const card = root.querySelector?.(`[data-pm-q-card="${cssEscapeValue(qid, documentRef)}"]`);
      if (!card || !card.classList || !card.classList.contains('pm-question-card')) return;
      const state = combined[qid] || {};
      if (state.composeTarget) card.setAttribute('data-pm-q-compose-target', state.composeTarget);
      Object.entries(state.selected || {}).forEach(([bid, vals]) => {
        const block = card.querySelector(`[data-pm-q="${cssEscapeValue(bid, documentRef)}"]`);
        if (!block || !Array.isArray(vals) || !vals.length) return;
        const want = new Set(vals);
        block.querySelectorAll('.pm-q-opt').forEach((el) => {
          if (want.has(el.getAttribute('data-pm-q-opt') || '')) el.classList.add('selected');
        });
      });
      Object.entries(state.texts || {}).forEach(([bid, val]) => {
        const block = card.querySelector(`[data-pm-q="${cssEscapeValue(bid, documentRef)}"]`);
        const el = block?.querySelector('[data-pm-q-text]');
        if (el) el.value = val;
      });
      Object.entries(state.others || {}).forEach(([bid, info]) => {
        const block = card.querySelector(`[data-pm-q="${cssEscapeValue(bid, documentRef)}"]`);
        const el = block?.querySelector('[data-pm-q-other]');
        if (el) { el.value = info.value || ''; if (!info.hidden) el.removeAttribute('hidden'); }
      });
      const gen = card.querySelector('[data-pm-q-general]');
      if (gen) gen.value = state.general || '';
      try {
        if (state.focus && state.focus.kind) {
          let el = null;
          if (state.focus.kind === 'general') el = gen;
          else {
            const block = card.querySelector(`[data-pm-q="${cssEscapeValue(state.focus.key, documentRef)}"]`);
            el = state.focus.kind === 'text'
              ? block?.querySelector('[data-pm-q-text]')
              : block?.querySelector('[data-pm-q-other]');
          }
          if (el && !el.hasAttribute('hidden') && documentRef?.activeElement !== el) {
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

export function mobileQuestionPayloadFromDraft(question, state) {
  if (!state) return null;
  return {
    answers: question.questions.map((qq) => ({
      id: qq.id,
      label: qq.label,
      mode: qq.mode,
      selected: qq.mode === 'text' ? [] : (Array.isArray(state.selected?.[qq.id]) ? state.selected[qq.id] : []),
      text: String(state.texts?.[qq.id] || '').trim(),
      other: String(state.others?.[qq.id]?.value || '').trim(),
    })),
    generalOther: String(state.general || '').trim(),
  };
}

export const questionComposerHost = Object.freeze({
  questionPlacement,
  shouldRenderQuestionInComposer,
  shouldRenderQuestionInHistory,
  questionForComposer,
  syncQuestionComposerHost,
  captureMobileQuestionDraftState,
  restoreMobileQuestionDraftState,
  mobileQuestionPayloadFromDraft,
});
