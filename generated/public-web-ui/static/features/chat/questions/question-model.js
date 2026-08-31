const QUESTION_MODES = Object.freeze(['single_select', 'multi_select', 'text']);

const QUESTION_STATUS_ORDER = Object.freeze({
  pending: 0,
  submitting: 1,
  answered: 2,
  cancelled: 2,
  expired: 2,
  resolved: 2,
});

const TERMINAL_STATUS_PREFERENCE = Object.freeze({
  answered: 3,
  resolved: 2,
  cancelled: 1,
  expired: 0,
});

function clean(value) {
  return String(value ?? '').trim();
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function firstArray(...values) {
  return values.find(Array.isArray) || [];
}

function recordId(record = {}, fallback = {}) {
  return clean(firstValue(
    record.id,
    record.questionId,
    record.question_id,
    fallback.id,
    fallback.questionId,
    fallback.question_id,
  ));
}

function recordSessionId(record = {}, fallback = {}) {
  return clean(firstValue(
    record.sessionId,
    record.sourceSessionId,
    record.source_session_id,
    record.session_id,
    fallback.sessionId,
    fallback.sourceSessionId,
    fallback.source_session_id,
    fallback.session_id,
  ));
}

export function normalizeQuestionMode(value) {
  const mode = clean(value).toLowerCase();
  if (mode === 'multi_select' || mode === 'multiple' || mode === 'multi') return 'multi_select';
  if (mode === 'text' || mode === 'free_text') return 'text';
  return 'single_select';
}

export function normalizeQuestionItem(input = {}, index = 0) {
  const source = input && typeof input === 'object' ? input : {};
  const label = clean(firstValue(source.label, source.question, source.prompt));
  if (!label) return null;
  const mode = normalizeQuestionMode(firstValue(source.mode, source.type, source.selectionMode));
  const options = firstArray(source.options, source.choices)
    .map((option) => clean(option))
    .filter(Boolean)
    .slice(0, 8);
  return {
    id: clean(firstValue(source.id, source.questionId, source.question_id, `q${index + 1}`)) || `q${index + 1}`,
    label,
    mode,
    options: mode === 'text' ? [] : options,
    allowOther: source.allowOther !== false && source.allow_other !== false,
    required: source.required !== false,
    helpText: clean(firstValue(source.helpText, source.help_text)),
  };
}

export function normalizeQuestionStatus(value, fallback = 'pending') {
  return clean(firstValue(value, fallback)).toLowerCase() || 'pending';
}

export function normalizeQuestionRecord(record = {}, fallback = {}) {
  const source = record && typeof record === 'object' ? record : {};
  const backup = fallback && typeof fallback === 'object' ? fallback : {};
  const rawQuestions = Array.isArray(source.questions)
    ? source.questions
    : firstArray(backup.questions);
  const questions = rawQuestions
    .slice(0, 5)
    .map((question, index) => normalizeQuestionItem(question, index))
    .filter(Boolean);
  const answers = Array.isArray(source.answers)
    ? source.answers
    : (Array.isArray(backup.answers) ? backup.answers : []);
  const rawCurrentIndex = firstValue(source.currentIndex, backup.currentIndex);
  const currentIndex = Number.isFinite(Number(rawCurrentIndex)) ? Number(rawCurrentIndex) : 0;
  const metadata = {};
  for (const key of [
    'taskId', 'agentId', 'originType', 'originLabel', 'createdAt',
    'resolvedAt', 'resolvedBy', 'expiresAt', 'sourceSessionId',
  ]) {
    if (source[key] !== undefined) metadata[key] = source[key];
    else if (backup[key] !== undefined) metadata[key] = backup[key];
  }
  return {
    ...metadata,
    id: recordId(source, backup),
    sessionId: recordSessionId(source, backup),
    title: clean(firstValue(source.title, backup.title, 'Prometheus question')),
    prompt: clean(firstValue(source.prompt, backup.prompt, backup.summary)),
    context: clean(firstValue(source.context, backup.context)),
    currentIndex,
    questions,
    allowGeneralOther: source.allowGeneralOther !== false && backup.allowGeneralOther !== false,
    status: normalizeQuestionStatus(source.status, backup.status || 'pending'),
    answers,
    generalOther: clean(firstValue(source.generalOther, source.general_other, backup.generalOther, backup.general_other)),
  };
}

export function questionFromEventPayload(event = {}, status = '', defaultSessionId = '') {
  const source = event && typeof event === 'object' ? event : {};
  const base = source.question && typeof source.question === 'object' ? source.question : {};
  const id = clean(firstValue(source.questionId, source.question_id, source.id, base.id));
  const normalized = normalizeQuestionRecord(base, {
    ...source,
    id,
    sessionId: firstValue(
      source.sessionId,
      source.sourceSessionId,
      source.session_id,
      source.source_session_id,
      base.sessionId,
      base.sourceSessionId,
      base.session_id,
      base.source_session_id,
      defaultSessionId,
    ),
    status: status || base.status || source.status || 'pending',
  });
  if (!normalized.sessionId) normalized.sessionId = clean(defaultSessionId);
  if (status) normalized.status = normalizeQuestionStatus(status);
  return normalized;
}

export function questionStatusOrder(status) {
  return QUESTION_STATUS_ORDER[normalizeQuestionStatus(status)] ?? 0;
}

export function isQuestionTerminal(status) {
  return questionStatusOrder(status) >= QUESTION_STATUS_ORDER.answered;
}

function preferredTerminalStatus(left, right) {
  const leftStatus = normalizeQuestionStatus(left);
  const rightStatus = normalizeQuestionStatus(right);
  return (TERMINAL_STATUS_PREFERENCE[rightStatus] ?? -1) > (TERMINAL_STATUS_PREFERENCE[leftStatus] ?? -1)
    ? rightStatus
    : leftStatus;
}

export function mergeQuestionRecords(current, incoming, options = {}) {
  const previous = current && typeof current === 'object'
    ? normalizeQuestionRecord(current)
    : null;
  const next = normalizeQuestionRecord(incoming, previous || {});
  if (!previous) return next;

  const currentStatus = normalizeQuestionStatus(previous.status);
  const incomingStatus = normalizeQuestionStatus(next.status, currentStatus);
  let status = incomingStatus;
  if (options.allowStatusRegression !== true) {
    if (isQuestionTerminal(currentStatus) && !isQuestionTerminal(incomingStatus)) {
      status = currentStatus;
    } else if (isQuestionTerminal(currentStatus) && isQuestionTerminal(incomingStatus)) {
      status = preferredTerminalStatus(currentStatus, incomingStatus);
    } else if (questionStatusOrder(incomingStatus) < questionStatusOrder(currentStatus)) {
      status = currentStatus;
    }
  }

  return {
    ...previous,
    ...next,
    id: previous.id || next.id,
    sessionId: previous.sessionId || next.sessionId,
    title: next.title || previous.title,
    prompt: next.prompt || previous.prompt,
    context: next.context || previous.context,
    questions: next.questions.length ? next.questions : previous.questions,
    answers: next.answers.length ? next.answers : previous.answers,
    generalOther: next.generalOther || previous.generalOther,
    status,
  };
}

export function questionRecordsEqual(left, right) {
  if (left === right) return true;
  if (!left || !right) return false;
  try {
    return JSON.stringify(normalizeQuestionRecord(left)) === JSON.stringify(normalizeQuestionRecord(right));
  } catch {
    return false;
  }
}

export function buildQuestionAnswerPayload(question, source = {}) {
  const normalized = normalizeQuestionRecord(question);
  const input = source && typeof source === 'object' ? source : {};
  const sourceAnswers = Array.isArray(input.answers) ? input.answers : [];
  const answerById = new Map(sourceAnswers.map((answer) => [clean(answer?.id), answer || {}]));
  return {
    answers: normalized.questions.map((item) => {
      const answer = answerById.get(item.id) || {};
      const selected = Array.isArray(answer.selected)
        ? answer.selected.map((value) => clean(value)).filter(Boolean)
        : [];
      return {
        id: item.id,
        label: item.label,
        mode: item.mode,
        selected: item.mode === 'text' ? [] : (item.mode === 'single_select' ? selected.slice(0, 1) : selected),
        text: clean(answer.text),
        other: clean(answer.other),
      };
    }),
    generalOther: clean(firstValue(input.generalOther, input.general_other)),
  };
}

export function applyQuestionComposerAnswer(question, payload, composerText = '', target = '') {
  const text = clean(composerText);
  if (!text || !question || !payload) return payload;
  if (!Array.isArray(payload.answers)) payload.answers = [];
  const [targetId, targetKind] = clean(target).split('::');
  const items = Array.isArray(question.questions) ? question.questions : [];
  const targetQuestion = items.find((item) => clean(item?.id) === targetId)
    || items.find((item) => normalizeQuestionMode(item?.mode) === 'text')
    || items.find((item) => item?.allowOther)
    || null;
  const targetAnswer = targetQuestion
    ? payload.answers.find((answer) => clean(answer?.id) === clean(targetQuestion.id))
    : null;
  if (targetAnswer) {
    if (targetKind === 'other' || (!targetKind && normalizeQuestionMode(targetQuestion.mode) !== 'text')) {
      targetAnswer.other = text;
    } else {
      targetAnswer.text = text;
    }
  } else if (question.allowGeneralOther !== false) {
    payload.generalOther = text;
  } else if (payload.answers[0]) {
    payload.answers[0].text = text;
  }
  return payload;
}

export function getMissingQuestionAnswers(question, payload) {
  const answers = Array.isArray(payload?.answers) ? payload.answers : [];
  return (Array.isArray(question?.questions) ? question.questions : []).filter((item) => {
    if (item?.required === false) return false;
    const answer = answers.find((candidate) => clean(candidate?.id) === clean(item?.id));
    return !answer || (
      !(Array.isArray(answer.selected) && answer.selected.length)
      && !clean(answer.text)
      && !clean(answer.other)
    );
  });
}

export const QUESTION_MODEL_LIMITS = Object.freeze({
  maxQuestions: 5,
  maxOptions: 8,
});

export { QUESTION_MODES };
