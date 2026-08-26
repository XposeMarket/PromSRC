import { isQuestionTerminal, normalizeQuestionRecord } from './question-model.js';

function clean(value) {
  return String(value ?? '').trim();
}

function escHtml(value) {
  if (!value) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function encodeInlineJsString(value) {
  return JSON.stringify(String(value ?? ''))
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function cssEscapeValue(value, documentRef = globalThis.document) {
  const raw = String(value || '');
  const css = documentRef?.defaultView?.CSS || globalThis.CSS;
  if (css && typeof css.escape === 'function') return css.escape(raw);
  return raw.replace(/["\\\]\[]/g, '\\$&');
}

export function renderDesktopQuestionCard(item) {
  if (!item || !item.id) return '';
  const question = normalizeQuestionRecord(item);
  if (!question.id) return '';
  const pending = question.status === 'pending' || question.status === 'submitting';
  const idAttr = escHtml(question.id);
  const idArg = encodeInlineJsString(question.id);
  const statusLabel = question.status === 'answered' ? 'answered' : question.status;
  const answerMap = new Map((question.answers || []).map((answer) => [String(answer?.id || ''), answer || {}]));
  const questionBlocks = question.questions.map((q, index) => {
    const answer = answerMap.get(q.id) || {};
    const qName = `${question.id}__${q.id}`;
    const qIdArg = encodeInlineJsString(q.id);
    const selected = Array.isArray(answer.selected) ? answer.selected : [];
    const other = String(answer.other || '').trim();
    const text = String(answer.text || '').trim();
    if (!pending) {
      const selectedText = selected.length ? selected.join(', ') : '';
      const answerText = [selectedText, text, other ? `Other: ${other}` : ''].filter(Boolean).join('\n') || 'No answer';
      return `<div class="chat-approval-scope"><span>${escHtml(q.label)}</span>${escHtml(answerText).replace(/\n/g, '<br>')}</div>`;
    }
    const options = (q.options || []).map((option, optIndex) => {
      const inputId = `${qName}__${optIndex}`;
      const type = q.mode === 'multi_select' ? 'checkbox' : 'radio';
      // For single_select radios, allow re-clicking a checked option to deselect it.
      const deselect = type === 'radio' ? ` onmousedown="toggleQuestionRadio(${encodeInlineJsString(inputId)})"` : '';
      return `<label for="${escHtml(inputId)}" class="pq-option">
        <input id="${escHtml(inputId)}" type="${type}" name="${escHtml(qName)}" value="${escHtml(option)}" data-question-id="${escHtml(q.id)}"${deselect} />
        <span>${escHtml(option)}</span>
      </label>`;
    }).join('');
    const otherInput = q.allowOther && q.mode !== 'text'
      ? `<div class="pq-other-row"><button type="button" class="pq-other-toggle" onclick="toggleQuestionOther(${idArg}, ${qIdArg})">Other</button></div>`
      : '';
    return `<div class="pq-block" data-question-compose-id="${escHtml(q.id)}" data-question-compose-mode="${escHtml(q.mode)}" data-question-compose-other="${q.allowOther ? 'true' : 'false'}" style="margin-top:${index ? 10 : 0}px">
      <div class="pq-q-label">${escHtml(q.label)}${q.required ? '' : ' <span class="pq-optional">(optional)</span>'}</div>
      ${q.helpText ? `<div class="chat-approval-subdetail">${escHtml(q.helpText)}</div>` : ''}
      ${options ? `<div class="pq-options">${options}</div>` : ''}
      ${otherInput}
    </div>`;
  }).join('');
  return `<div class="chat-approval-card chat-approval-card-low chat-question-card chat-question-card-${escHtml(statusLabel)}" data-question-id="${idAttr}">
    <div class="chat-approval-head">
      <div>
        <div class="chat-approval-kicker">${pending ? (question.questions.length > 1 ? 'Prometheus has a few questions' : 'Prometheus has a question') : 'Question result'}</div>
        <div class="chat-approval-title">${escHtml(question.title || 'Prometheus question')}</div>
      </div>
      <div class="chat-approval-badges">
        <span class="chat-approval-status chat-approval-status-${escHtml(statusLabel)}">${escHtml(statusLabel)}</span>
      </div>
    </div>
    ${question.prompt ? `<div class="chat-approval-detail">${escHtml(question.prompt)}</div>` : ''}
    ${question.context ? `<div class="chat-approval-subdetail">${escHtml(question.context)}</div>` : ''}
    ${questionBlocks}
    ${!pending && question.generalOther ? `<div class="chat-approval-scope"><span>Anything else</span>${escHtml(question.generalOther).replace(/\n/g, '<br>')}</div>` : ''}
    ${pending
      ? `<div class="chat-approval-actions">
          <button class="chat-approval-btn chat-approval-deny" type="button" onclick="cancelInlinePrometheusQuestion(${idArg})">Cancel</button>
        </div>`
      : `<div class="chat-approval-resolved">This question was ${escHtml(statusLabel)}.</div>`}
  </div>`;
}

export function toggleDesktopQuestionOther(questionId, itemId, options = {}) {
  const documentRef = options.document || globalThis.document;
  const card = documentRef?.querySelector?.(`[data-question-id="${cssEscapeValue(questionId, documentRef)}"]`);
  const block = card?.querySelector?.(`[data-question-compose-id="${cssEscapeValue(itemId, documentRef)}"]`);
  if (!card || !block) return;
  card.setAttribute('data-question-compose-target', `${String(itemId)}::other`);
  documentRef.getElementById(options.inputId || 'chat-input')?.focus?.();
}

export function toggleDesktopQuestionRadio(inputId, options = {}) {
  const documentRef = options.document || globalThis.document;
  try {
    const el = documentRef?.getElementById?.(inputId);
    if (!el || el.type !== 'radio') return;
    if (el.checked) {
      // Defer until after the native click would have re-checked it.
      (options.setTimeout || globalThis.setTimeout)(() => {
        el.checked = false;
        el.dispatchEvent(new (documentRef.defaultView?.Event || globalThis.Event)('change', { bubbles: true }));
      }, 0);
    }
  } catch {}
}

export function collectDesktopQuestionAnswers(question, options = {}) {
  const documentRef = options.document || globalThis.document;
  const card = documentRef?.querySelector?.(`[data-question-id="${cssEscapeValue(question?.id, documentRef)}"]`);
  if (!card) return { answers: [], generalOther: '' };
  const answers = (question.questions || []).map((q) => {
    const checked = Array.from(card.querySelectorAll(`[data-question-id="${cssEscapeValue(q.id, documentRef)}"]:checked`))
      .map((input) => String(input.value || '').trim())
      .filter(Boolean);
    const text = String(card.querySelector(`[data-question-text="${cssEscapeValue(q.id, documentRef)}"]`)?.value || '').trim();
    const other = String(card.querySelector(`[data-question-other="${cssEscapeValue(q.id, documentRef)}"]`)?.value || '').trim();
    return { id: q.id, label: q.label, mode: q.mode, selected: q.mode === 'single_select' ? checked.slice(0, 1) : checked, text, other };
  });
  const generalOther = String(card.querySelector('[data-question-general-other="1"]')?.value || '').trim();
  return { answers, generalOther };
}

export function focusDesktopQuestionComposer(options = {}) {
  const documentRef = options.document || globalThis.document;
  const input = documentRef?.getElementById?.(options.inputId || 'chat-input');
  if (!input) return;
  try { input.focus({ preventScroll: true }); } catch { try { input.focus(); } catch {} }
}

export function questionPlacement(questionOrStatus) {
  const status = clean(typeof questionOrStatus === 'object' ? questionOrStatus?.status : questionOrStatus).toLowerCase() || 'pending';
  return status === 'pending' || status === 'submitting' ? 'composer' : 'history';
}

export function shouldRenderQuestionInComposer(question) {
  return questionPlacement(question) === 'composer';
}

export function shouldRenderQuestionInHistory(question) {
  return isQuestionTerminal(question?.status) || questionPlacement(question) === 'history';
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
  const actionable = shouldRenderQuestionInComposer(question);
  if (!actionable) {
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

export function captureDesktopQuestionDraftState(documentRef = globalThis.document) {
  const out = {};
  try {
    documentRef?.querySelectorAll?.('[data-question-id]')?.forEach?.((card) => {
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
      try {
        const active = documentRef.activeElement;
        if (active && card.contains(active) && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
          let kind = '', key = '';
          if (active.hasAttribute('data-question-general-other')) kind = 'general';
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

export function restoreDesktopQuestionDraftState(map, documentRef = globalThis.document) {
  if (!map) return;
  try {
    Object.keys(map).forEach((qid) => {
      const sel = cssEscapeValue(qid, documentRef);
      const card = documentRef?.querySelector?.(`.chat-question-card[data-question-id="${sel}"]`);
      if (!card) return;
      const state = map[qid] || {};
      if (state.composeTarget) card.setAttribute('data-question-compose-target', state.composeTarget);
      const want = new Set(state.checked || []);
      card.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach((el) => {
        if (want.has(`${el.getAttribute('data-question-id') || ''}::${el.value}`)) el.checked = true;
      });
      Object.entries(state.texts || {}).forEach(([id, val]) => {
        const el = card.querySelector(`[data-question-text="${cssEscapeValue(id, documentRef)}"]`);
        if (el) el.value = val;
      });
      Object.entries(state.others || {}).forEach(([id, info]) => {
        const el = card.querySelector(`[data-question-other="${cssEscapeValue(id, documentRef)}"]`);
        if (el) { el.value = info.value || ''; if (!info.hidden) el.removeAttribute('hidden'); }
      });
      const gen = card.querySelector('[data-question-general-other="1"]');
      if (gen) gen.value = state.general || '';
      try {
        if (state.focus && state.focus.kind) {
          let el = null;
          if (state.focus.kind === 'general') el = gen;
          else if (state.focus.kind === 'text') el = card.querySelector(`[data-question-text="${cssEscapeValue(state.focus.key, documentRef)}"]`);
          else if (state.focus.kind === 'other') el = card.querySelector(`[data-question-other="${cssEscapeValue(state.focus.key, documentRef)}"]`);
          if (el && !el.hasAttribute('hidden') && documentRef.activeElement !== el) {
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

export const desktopQuestionView = Object.freeze({
  render: renderDesktopQuestionCard,
  toggleOther: toggleDesktopQuestionOther,
  toggleRadio: toggleDesktopQuestionRadio,
  collectAnswers: collectDesktopQuestionAnswers,
  focusComposer: focusDesktopQuestionComposer,
  questionPlacement,
  shouldRenderQuestionInComposer,
  shouldRenderQuestionInHistory,
  questionForComposer,
  syncQuestionComposerHost,
  captureDraftState: captureDesktopQuestionDraftState,
  restoreDraftState: restoreDesktopQuestionDraftState,
});
