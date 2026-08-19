import { cssEscapeValue } from '../rendering/css-escape.js';

/** DOM-only Prometheus Question interaction helpers. */
export function toggleQuestionRadio(inputId) {
  try {
    const el = document.getElementById(inputId);
    if (!el || el.type !== 'radio') return;
    if (el.checked) {
      // Defer until after the native click would have re-checked it.
      setTimeout(() => { el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); }, 0);
    }
  } catch {}
}

export function toggleQuestionOther(questionId, itemId) {
  const card = document.querySelector(`[data-question-id="${cssEscapeValue(questionId)}"]`);
  const block = card?.querySelector?.(`[data-question-compose-id="${cssEscapeValue(itemId)}"]`);
  if (!card || !block) return;
  card.setAttribute('data-question-compose-target', `${String(itemId)}::other`);
  document.getElementById('chat-input')?.focus?.();
}

export function collectPrometheusQuestionAnswers(question) {
  const card = document.querySelector(`[data-question-id="${cssEscapeValue(question.id)}"]`);
  if (!card) return { answers: [], generalOther: '' };
  const answers = question.questions.map((q) => {
    const checked = Array.from(card.querySelectorAll(`[data-question-id="${cssEscapeValue(q.id)}"]:checked`))
      .map((input) => String(input.value || '').trim())
      .filter(Boolean);
    const text = String(card.querySelector(`[data-question-text="${cssEscapeValue(q.id)}"]`)?.value || '').trim();
    const other = String(card.querySelector(`[data-question-other="${cssEscapeValue(q.id)}"]`)?.value || '').trim();
    return { id: q.id, label: q.label, mode: q.mode, selected: q.mode === 'single_select' ? checked.slice(0, 1) : checked, text, other };
  });
  const generalOther = String(card.querySelector('[data-question-general-other="1"]')?.value || '').trim();
  return { answers, generalOther };
}

export function applyPrometheusQuestionComposerAnswer(question, payload, composerText = '') {
  const text = String(composerText || '').trim();
  if (!text || !question || !payload) return payload;
  const card = document.querySelector(`[data-question-id="${cssEscapeValue(question.id)}"]`);
  const rawTarget = String(card?.getAttribute('data-question-compose-target') || '').trim();
  const [targetId, targetKind] = rawTarget.split('::');
  const targetQuestion = question.questions.find((item) => String(item.id) === String(targetId || ''))
    || question.questions.find((item) => item.mode === 'text')
    || question.questions.find((item) => item.allowOther)
    || null;
  const targetAnswer = targetQuestion
    ? payload.answers.find((answer) => String(answer.id) === String(targetQuestion.id))
    : null;
  if (targetAnswer) {
    if (targetKind === 'other' || (!targetKind && targetQuestion.mode !== 'text')) targetAnswer.other = text;
    else targetAnswer.text = text;
  } else if (question.allowGeneralOther) {
    payload.generalOther = text;
  } else if (payload.answers[0]) {
    payload.answers[0].text = text;
  }
  return payload;
}
