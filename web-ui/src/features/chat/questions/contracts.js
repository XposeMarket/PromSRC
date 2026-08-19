import { normalizePrometheusQuestionRecord } from './model.js';

/** Pure validation and event adaptation for Prometheus Question requests. */
export function getMissingPrometheusQuestionAnswers(question, payload) {
  const answers = Array.isArray(payload?.answers) ? payload.answers : [];
  return (question?.questions || []).filter((item) => {
    if (item?.required === false) return false;
    const answer = answers.find((candidate) => String(candidate?.id || '') === String(item?.id || ''));
    return !answer || (
      !(Array.isArray(answer.selected) && answer.selected.length)
      && !String(answer.text || '').trim()
      && !String(answer.other || '').trim()
    );
  });
}

export function questionFromEventPayload(event = {}, status = '', defaultSessionId = '') {
  const id = String(event.questionId || event.id || event.question?.id || '').trim();
  const base = event.question && typeof event.question === 'object' ? event.question : {};
  const question = normalizePrometheusQuestionRecord(base, { ...event, id, status: status || base.status || event.status || 'pending' });
  if (!question.sessionId) question.sessionId = String(event.sessionId || defaultSessionId || '').trim();
  if (status) question.status = status;
  return question;
}
