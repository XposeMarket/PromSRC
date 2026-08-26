function clean(value) {
  return String(value ?? '').trim();
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function normalizeQuestionMode(value) {
  const mode = clean(value).toLowerCase();
  if (mode === 'multi_select' || mode === 'multiple' || mode === 'multi') return 'multi_select';
  if (mode === 'text' || mode === 'free_text') return 'text';
  return 'single_select';
}

function normalizeQuestionItem(input = {}, index = 0) {
  const source = input && typeof input === 'object' ? input : {};
  const label = clean(firstValue(source.label, source.question, source.prompt));
  if (!label) return null;
  const mode = normalizeQuestionMode(firstValue(source.mode, source.type, source.selectionMode));
  const rawOptions = Array.isArray(source.options) ? source.options : (Array.isArray(source.choices) ? source.choices : []);
  return {
    id: clean(firstValue(source.id, source.questionId, source.question_id, `q${index + 1}`)) || `q${index + 1}`,
    label,
    mode,
    options: mode === 'text' ? [] : rawOptions.map((option) => clean(option)).filter(Boolean).slice(0, 8),
    allowOther: source.allowOther !== false && source.allow_other !== false,
    required: source.required !== false,
    helpText: clean(firstValue(source.helpText, source.help_text)),
  };
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cssEscapeValue(value, documentRef = globalThis.document) {
  const raw = String(value || '');
  const css = documentRef?.defaultView?.CSS || globalThis.CSS;
  if (css && typeof css.escape === 'function') return css.escape(raw);
  return raw.replace(/["\\\]\[]/g, '\\$&');
}

export function normalizeMobileQuestion(input, extra = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const fallback = extra && typeof extra === 'object' ? extra : {};
  const rawQuestions = Array.isArray(source.questions) ? source.questions : (Array.isArray(fallback.questions) ? fallback.questions : []);
  return {
    ...source,
    id: clean(firstValue(source.id, source.questionId, source.question_id, fallback.id, fallback.questionId, fallback.question_id)),
    sessionId: clean(firstValue(source.sessionId, source.sourceSessionId, source.source_session_id, source.session_id, fallback.sessionId, fallback.sourceSessionId, fallback.source_session_id, fallback.session_id)),
    title: clean(firstValue(source.title, fallback.title, 'Prometheus question')),
    prompt: clean(firstValue(source.prompt, fallback.prompt, fallback.summary)),
    context: clean(firstValue(source.context, fallback.context)),
    questions: rawQuestions.slice(0, 5).map(normalizeQuestionItem).filter(Boolean),
    allowGeneralOther: source.allowGeneralOther !== false && fallback.allowGeneralOther !== false,
    status: clean(firstValue(extra.status, source.status, fallback.status, 'pending')).toLowerCase() || 'pending',
    answers: Array.isArray(source.answers) ? source.answers : (Array.isArray(fallback.answers) ? fallback.answers : []),
    generalOther: clean(firstValue(source.generalOther, source.general_other, fallback.generalOther, fallback.general_other)),
  };
}

export function renderMobileQuestionCard(item, options = {}) {
  const q = normalizeMobileQuestion(item, options);
  if (!q.id || !q.questions.length) return '';
  // Submission is optimistic: remove the card before the network round-trip so
  // the stream never leaves an answered card behind while the agent resumes.
  if (q.status === 'submitting' && options.hideSubmitting !== false) return '';
  const pending = q.status === 'pending' || q.status === 'submitting';
  // Escape the inline JS id arg for use inside a double-quoted onclick attribute.
  const idJson = escapeHtml(JSON.stringify(q.id));
  const answerMap = new Map((q.answers || []).map((a) => [String(a?.id || ''), a || {}]));
  const blocks = q.questions.map((qq) => {
    const ans = answerMap.get(qq.id) || {};
    if (!pending) {
      const sel = Array.isArray(ans.selected) ? ans.selected : [];
      const txt = [sel.join(', '), String(ans.text || ''), ans.other ? `Other: ${ans.other}` : ''].filter(Boolean).join(' · ') || 'No answer';
      return `<div class="pm-q-block"><div class="pm-q-label">${escapeHtml(qq.label)}</div><div class="pm-q-answered">${escapeHtml(txt)}</div></div>`;
    }
    const opts = (qq.options || []).map((opt) => `<button type="button" class="pm-q-opt" data-pm-q-opt="${escapeHtml(opt)}" onclick="_mobileQuestionToggleOption(this, '${escapeHtml(qq.mode)}')">${escapeHtml(opt)}</button>`).join('');
    const otherArea = qq.allowOther && qq.mode !== 'text'
      ? '<button type="button" class="pm-q-other-toggle" onclick="_mobileQuestionToggleOther(this)">Other…</button>'
      : '';
    return `<div class="pm-q-block" data-pm-q="${escapeHtml(qq.id)}" data-pm-q-mode="${escapeHtml(qq.mode)}">
      <div class="pm-q-label">${escapeHtml(qq.label)}${qq.required ? '' : ' <span class="pm-q-optional">(optional)</span>'}</div>
      ${qq.helpText ? `<div class="pm-q-help">${escapeHtml(qq.helpText)}</div>` : ''}
      ${opts ? `<div class="pm-q-opts">${opts}</div>` : ''}
      ${otherArea}
    </div>`;
  }).join('');
  return `<div class="pm-question-card pm-question-${escapeHtml(q.status)}" data-pm-q-card="${escapeHtml(q.id)}">
    <div class="pm-q-head"><span class="pm-q-kicker">${pending ? (q.questions.length > 1 ? 'Prometheus has a few questions' : 'Prometheus has a question') : 'Question result'}</span><span class="pm-q-status pm-q-status-${escapeHtml(q.status)}">${escapeHtml(q.status)}</span></div>
    <div class="pm-q-title">${escapeHtml(q.title)}</div>
    ${q.prompt ? `<div class="pm-q-prompt">${escapeHtml(q.prompt)}</div>` : ''}
    ${q.context ? `<div class="pm-q-context">${escapeHtml(q.context)}</div>` : ''}
    ${blocks}
    ${!pending && q.generalOther ? `<div class="pm-q-block"><div class="pm-q-label">Anything else</div><div class="pm-q-answered">${escapeHtml(q.generalOther)}</div></div>` : ''}
    ${pending
      ? `<div class="pm-q-actions"><button type="button" class="pm-q-cancel" onclick="_cancelMobileQuestion(${idJson})">Cancel</button></div>`
      : `<div class="pm-q-resolved">This question was ${escapeHtml(q.status)}.</div>`}
  </div>`;
}

export function toggleMobileQuestionOption(btn, mode, options = {}) {
  if (!btn) return;
  if (mode === 'single_select') {
    // Reclicking the already-selected option deselects it (so the user can
    // clear a single-select answer); otherwise select this one and clear siblings.
    const wasSelected = btn.classList.contains('selected');
    const wrap = btn.parentElement;
    if (wrap) wrap.querySelectorAll('.pm-q-opt.selected').forEach((el) => el.classList.remove('selected'));
    if (!wasSelected) btn.classList.add('selected');
  } else {
    btn.classList.toggle('selected');
  }
  options.rememberDraft?.(btn);
}

export function toggleMobileQuestionOther(btn, options = {}) {
  const card = btn?.closest?.('[data-pm-q-card]');
  const block = btn?.closest?.('[data-pm-q]');
  const itemId = String(block?.getAttribute('data-pm-q') || '').trim();
  if (!card || !itemId) return;
  card.setAttribute('data-pm-q-compose-target', `${itemId}::other`);
  const documentRef = options.document || globalThis.document;
  documentRef?.getElementById?.(options.inputId || 'pm-composer-input')?.focus?.();
  options.rememberDraft?.(btn);
}

export function collectMobileQuestionAnswers(question, options = {}) {
  const documentRef = options.document || globalThis.document;
  const card = documentRef?.querySelector?.(`[data-pm-q-card="${cssEscapeValue(question?.id, documentRef)}"]`);
  if (!card) return { answers: [], generalOther: '' };
  const answers = (question.questions || []).map((qq) => {
    const block = card.querySelector(`[data-pm-q="${cssEscapeValue(qq.id, documentRef)}"]`);
    const selected = block ? Array.from(block.querySelectorAll('.pm-q-opt.selected')).map((el) => el.getAttribute('data-pm-q-opt') || '').filter(Boolean) : [];
    const text = block ? String(block.querySelector('[data-pm-q-text]')?.value || '').trim() : '';
    const other = block ? String(block.querySelector('[data-pm-q-other]')?.value || '').trim() : '';
    return { id: qq.id, label: qq.label, mode: qq.mode, selected: qq.mode === 'single_select' ? selected.slice(0, 1) : selected, text, other };
  });
  const generalOther = String(card.querySelector('[data-pm-q-general]')?.value || '').trim();
  return { answers, generalOther };
}

export const mobileQuestionView = Object.freeze({
  normalize: normalizeMobileQuestion,
  render: renderMobileQuestionCard,
  toggleOption: toggleMobileQuestionOption,
  toggleOther: toggleMobileQuestionOther,
  collectAnswers: collectMobileQuestionAnswers,
});
