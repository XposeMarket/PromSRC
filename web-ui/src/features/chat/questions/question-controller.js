import {
  applyQuestionComposerAnswer,
  buildQuestionAnswerPayload,
  getMissingQuestionAnswers,
  isQuestionTerminal,
  mergeQuestionRecords,
  normalizeQuestionRecord,
  questionFromEventPayload,
  questionRecordsEqual,
} from './question-model.js';

export { normalizeQuestionRecord } from './question-model.js';

function clean(value) {
  return String(value ?? '').trim();
}

function questionId(value) {
  if (value && typeof value === 'object') {
    return clean(value.questionId || value.question_id || value.id || value.question?.id || value.question?.questionId || value.question?.question_id);
  }
  return clean(value);
}

function sessionIdFromRecord(record) {
  return clean(record?.sessionId || record?.sourceSessionId || record?.session_id || record?.source_session_id);
}

function hasAnswerValue(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (clean(payload.generalOther)) return true;
  return (Array.isArray(payload.answers) ? payload.answers : []).some((answer) => (
    (Array.isArray(answer?.selected) && answer.selected.length > 0)
    || clean(answer?.text)
    || clean(answer?.other)
  ));
}

function normalizePayload(question, payload) {
  if (!payload || typeof payload !== 'object') return buildQuestionAnswerPayload(question);
  if (!Array.isArray(payload.answers)) return buildQuestionAnswerPayload(question, payload);
  return {
    ...payload,
    answers: payload.answers.map((answer) => ({ ...(answer || {}) })),
    generalOther: clean(payload.generalOther || payload.general_other),
  };
}

export function createQuestionController(options = {}) {
  const {
    runtimeFor = () => null,
    getActiveSessionId = () => '',
    getSessionIds = () => [],
    getLegacyQuestion = () => null,
    getLegacyQuestionSessionIds = () => [],
    projectToLegacy = () => {},
    transport = {},
    readAnswers = () => null,
    readDraftAnswers = () => null,
    getComposerTarget = () => '',
    focusComposer = () => {},
    onValidationMissing = () => {},
    onSubmitSuccess = () => {},
    onCancelSuccess = () => {},
    onError = () => {},
  } = options;

  function runtimeForSession(sessionId) {
    const sid = clean(sessionId);
    if (!sid) return null;
    try { return runtimeFor(sid) || null; } catch { return null; }
  }

  function runtimeQuestion(sessionId, id) {
    const target = runtimeForSession(sessionId);
    if (!target) return null;
    return (target.snapshot?.questions || []).find((record) => clean(record?.id) === clean(id)) || null;
  }

  function knownSessionIds() {
    const values = [
      ...(Array.isArray(getSessionIds()) ? getSessionIds() : []),
      ...(Array.isArray(getLegacyQuestionSessionIds()) ? getLegacyQuestionSessionIds() : []),
      getActiveSessionId(),
    ];
    return [...new Set(values.map(clean).filter(Boolean))];
  }

  function legacyQuestionForSession(id, sessionId = '') {
    try {
      const legacy = getLegacyQuestion(id, clean(sessionId)) || null;
      if (!legacy) return null;
      const record = legacy.record || legacy.question || legacy;
      const resolvedSessionId = clean(
        legacy.sessionId
        || legacy.sourceSessionId
        || legacy.session_id
        || legacy.source_session_id
        || sessionIdFromRecord(record)
        || sessionId,
      );
      return {
        sessionId: resolvedSessionId,
        record: normalizeQuestionRecord(record, { id, sessionId: resolvedSessionId }),
      };
    } catch {
      return null;
    }
  }

  function findLegacyQuestions(id, preferredSessionId = '') {
    const preferred = clean(preferredSessionId);
    const sessions = preferred ? [preferred] : knownSessionIds();
    const found = [];
    for (const sid of sessions) {
      const match = legacyQuestionForSession(id, sid);
      if (!match?.sessionId || found.some((entry) => entry.sessionId === match.sessionId)) continue;
      found.push(match);
    }
    return found;
  }

  function runtimeHistoryHydrated(sessionId) {
    const runtime = runtimeForSession(sessionId);
    return Number(runtime?.snapshot?.history?.revision || 0) > 0;
  }

  function findRuntimeQuestions(id, preferredSessionId = '') {
    const preferred = clean(preferredSessionId);
    const sessions = preferred
      ? [preferred]
      : knownSessionIds();
    const found = [];
    sessions.forEach((sid) => {
      const record = runtimeQuestion(sid, id);
      if (record) found.push({ sessionId: sid, record });
    });
    return found;
  }

  function findQuestion(id, preferredSessionId = '') {
    const targetId = questionId(id);
    if (!targetId) return null;
    const runtimeMatches = findRuntimeQuestions(targetId, preferredSessionId);
    if (runtimeMatches.length) return runtimeMatches[0];
    return findLegacyQuestions(targetId, preferredSessionId)
      .find((entry) => !entry.sessionId || !runtimeHistoryHydrated(entry.sessionId)) || null;
  }

  function resolveSessionId(record, fallback = '') {
    return clean(fallback || sessionIdFromRecord(record) || getActiveSessionId());
  }

  function upsert(questionInput, inputOptions = {}) {
    const input = questionInput && typeof questionInput === 'object' ? questionInput : {};
    const normalized = normalizeQuestionRecord(input, inputOptions.fallback || {});
    const sid = resolveSessionId(normalized, inputOptions.sessionId);
    if (!normalized.id || !sid) return { accepted: false, changed: false, record: null, sessionId: sid };

    const runtime = runtimeForSession(sid);
    if (!runtime) return { accepted: false, changed: false, record: null, sessionId: sid };
    const current = runtimeQuestion(sid, normalized.id);
    const incoming = { ...normalized, sessionId: sid };
    const next = mergeQuestionRecords(current, incoming, inputOptions);
    const changed = !questionRecordsEqual(current, next);
    const stored = runtime.upsertQuestion(next);

    // Runtime state is written first. This callback is an explicit one-way
    // compatibility projection for legacy pages and session caches; it must
    // never be used to choose or overwrite the runtime record.
    if (inputOptions.projectLegacy !== false && (changed || inputOptions.forceProject === true)) {
      try {
        projectToLegacy({
          sessionId: sid,
          question: stored || next,
          previous: current,
          options: inputOptions,
        });
      } catch (error) {
        try { onError(error, { phase: 'compatibility_projection', question: stored || next }); } catch {}
      }
    }
    return { accepted: true, changed, record: stored || next, previous: current, sessionId: sid };
  }

  function transition(eventOrId, status = '', inputOptions = {}) {
    const id = questionId(eventOrId);
    if (!id) return [];
    const event = eventOrId && typeof eventOrId === 'object' ? eventOrId : { id };
    const explicitSessionId = clean(
      inputOptions.sessionId
      || event.sessionId
      || event.sourceSessionId
      || event.session_id
      || event.source_session_id
      || event.question?.sessionId
      || event.question?.sourceSessionId
      || event.question?.session_id
      || event.question?.source_session_id,
    );
    const runtimeMatches = findRuntimeQuestions(id);
    const legacyMatches = explicitSessionId ? [] : findLegacyQuestions(id);
    const targets = explicitSessionId
      ? [explicitSessionId]
      : [...runtimeMatches, ...legacyMatches].map((entry) => entry.sessionId);
    const sessions = [...new Set(targets.filter(Boolean))];
    if (!sessions.length) {
      const fallbackSessionId = resolveSessionId(event, '');
      const nextStatus = clean(status || event.status || 'pending').toLowerCase();
      if (fallbackSessionId && !isQuestionTerminal(nextStatus)) sessions.push(fallbackSessionId);
    }
    return sessions.filter(Boolean).map((sid) => {
      const question = questionFromEventPayload(event, status, sid);
      return upsert({ ...question, sessionId: sid }, {
        ...inputOptions,
        sessionId: sid,
      });
    });
  }

  async function ingest(event = {}, status = 'pending', inputOptions = {}) {
    const source = event && typeof event === 'object' ? event : {};
    if (!source.question && typeof transport.fetchQuestion === 'function' && questionId(source)) {
      const fetched = await transport.fetchQuestion(questionId(source));
      if (fetched) {
        return upsert(
          status ? { ...fetched, status } : fetched,
          {
            ...inputOptions,
            sessionId: source.sessionId
              || source.sourceSessionId
              || source.session_id
              || source.source_session_id,
          },
        );
      }
    }
    const results = transition(source, status, inputOptions);
    return results[0] || { accepted: false, changed: false, record: null, sessionId: '' };
  }

  async function submit(id, inputOptions = {}) {
    const targetId = questionId(id);
    if (!targetId) return { ok: false, reason: 'missing_id' };
    let local = findQuestion(targetId, inputOptions.sessionId);
    let question = local?.record || null;
    if (!question && typeof transport.fetchQuestion === 'function') {
      question = await transport.fetchQuestion(targetId);
      if (question) {
        const hydrated = upsert(question, { ...inputOptions, projectLegacy: inputOptions.projectFetched !== false });
        local = hydrated.accepted ? hydrated : null;
        question = hydrated.record || question;
      }
    }
    if (!question) return { ok: false, reason: 'missing' };

    question = normalizeQuestionRecord(question, { id: targetId, sessionId: inputOptions.sessionId });
    const sid = resolveSessionId(question, local?.sessionId || inputOptions.sessionId);
    const livePayload = inputOptions.readAnswers
      ? await inputOptions.readAnswers(question)
      : await readAnswers(question);
    let payload = normalizePayload(question, livePayload);
    const draftPayload = inputOptions.readDraftAnswers
      ? await inputOptions.readDraftAnswers(question)
      : await readDraftAnswers(question);
    if (!hasAnswerValue(payload) && draftPayload) payload = normalizePayload(question, draftPayload);
    const target = inputOptions.composerTarget !== undefined
      ? inputOptions.composerTarget
      : getComposerTarget(question);
    applyQuestionComposerAnswer(question, payload, inputOptions.composerText, target);

    const missing = getMissingQuestionAnswers(question, payload);
    if (missing.length) {
      try { focusComposer(question, missing); } catch {}
      try { onValidationMissing(missing, question, payload); } catch {}
      return { ok: false, reason: 'missing_answers', missing, question, payload, sessionId: sid };
    }

    const submitStarted = upsert({ ...question, sessionId: sid, status: 'submitting' }, {
      ...inputOptions,
      sessionId: sid,
      allowStatusRegression: true,
      projectLegacy: inputOptions.projectSubmitting !== false,
    });
    const submittingQuestion = submitStarted.record || question;
    try {
      if (typeof transport.submit !== 'function') throw new Error('Question submit transport is not configured.');
      const result = await transport.submit(targetId, payload);
      const answeredQuestion = {
        ...submittingQuestion,
        ...(result?.question || {}),
        id: targetId,
        sessionId: sid,
        answers: payload.answers,
        generalOther: payload.generalOther,
      };
      const resolved = transition({
        questionId: targetId,
        sessionId: sid,
        question: answeredQuestion,
      }, 'answered', { ...inputOptions, allowStatusRegression: true, projectLegacy: true });
      try { await onSubmitSuccess({ result, question: resolved[0]?.record || answeredQuestion, payload, sessionId: sid }); } catch {}
      if (typeof transport.resume === 'function') await transport.resume(result, sid);
      return { ok: true, result, question: resolved[0]?.record || answeredQuestion, payload, sessionId: sid };
    } catch (error) {
      upsert({ ...submittingQuestion, sessionId: sid, status: 'pending' }, {
        ...inputOptions,
        sessionId: sid,
        allowStatusRegression: true,
        projectLegacy: inputOptions.projectFailure !== false,
      });
      try { onError(error, { phase: 'submit', question: submittingQuestion, sessionId: sid }); } catch {}
      return { ok: false, reason: 'submit_failed', error, question: submittingQuestion, payload, sessionId: sid };
    }
  }

  async function cancel(id, inputOptions = {}) {
    const targetId = questionId(id);
    if (!targetId) return { ok: false, reason: 'missing_id' };
    const local = findQuestion(targetId, inputOptions.sessionId);
    const question = local?.record || normalizeQuestionRecord({ id: targetId, sessionId: inputOptions.sessionId });
    const sid = resolveSessionId(question, local?.sessionId || inputOptions.sessionId);
    try {
      if (typeof transport.cancel !== 'function') throw new Error('Question cancel transport is not configured.');
      const result = await transport.cancel(targetId);
      const cancelled = {
        ...question,
        ...(result?.question || {}),
        id: targetId,
        sessionId: sid,
      };
      const resolved = transition({ questionId: targetId, sessionId: sid, question: cancelled }, 'cancelled', {
        ...inputOptions,
        allowStatusRegression: true,
        projectLegacy: true,
      });
      try { await onCancelSuccess({ result, question: resolved[0]?.record || cancelled, sessionId: sid }); } catch {}
      return { ok: true, result, question: resolved[0]?.record || cancelled, sessionId: sid };
    } catch (error) {
      try { onError(error, { phase: 'cancel', question, sessionId: sid }); } catch {}
      return { ok: false, reason: 'cancel_failed', error, question, sessionId: sid };
    }
  }

  return Object.freeze({
    findQuestion,
    runtimeQuestion,
    upsert,
    transition,
    ingest,
    submit,
    cancel,
    isTerminal: isQuestionTerminal,
  });
}
