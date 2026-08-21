/** Canonical Prometheus Question normalization. */

export function normalizePrometheusQuestionRecord(record = {}, fallback = {}) {
  const id = String(record.id || record.questionId || fallback.id || fallback.questionId || '').trim();
  const sessionId = String(record.sourceSessionId || record.sessionId || fallback.sourceSessionId || fallback.sessionId || '').trim();
  const questions = Array.isArray(record.questions) ? record.questions : (Array.isArray(fallback.questions) ? fallback.questions : []);
  return {
    id,
    sessionId,
    title: String(record.title || fallback.title || 'Prometheus question').trim(),
    prompt: String(record.prompt || fallback.prompt || fallback.summary || '').trim(),
    context: String(record.context || fallback.context || '').trim(),
    questions: questions.slice(0, 5).map((q, index) => ({
      id: String(q?.id || `q${index + 1}`).trim() || `q${index + 1}`,
      label: String(q?.label || q?.question || '').trim(),
      mode: ['single_select', 'multi_select', 'text'].includes(String(q?.mode || '').trim()) ? String(q.mode).trim() : 'single_select',
      options: Array.isArray(q?.options) ? q.options.map((opt) => String(opt || '').trim()).filter(Boolean).slice(0, 8) : [],
      allowOther: q?.allowOther !== false && q?.allow_other !== false,
      required: q?.required !== false,
      helpText: String(q?.helpText || q?.help_text || '').trim(),
    })).filter((q) => q.label),
    allowGeneralOther: record.allowGeneralOther !== false && fallback.allowGeneralOther !== false,
    status: String(record.status || fallback.status || 'pending').trim().toLowerCase() || 'pending',
    answers: Array.isArray(record.answers) ? record.answers : [],
    generalOther: String(record.generalOther || fallback.generalOther || '').trim(),
  };
}
