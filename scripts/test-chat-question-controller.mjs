import assert from 'node:assert/strict';
import {
  applyQuestionComposerAnswer,
  buildQuestionAnswerPayload,
  getMissingQuestionAnswers,
  mergeQuestionRecords,
  normalizeQuestionMode,
  normalizeQuestionRecord,
} from '../web-ui/src/features/chat/questions/question-model.js';
import { createQuestionController } from '../web-ui/src/features/chat/questions/question-controller.js';
import { createMobileQuestionTransport } from '../web-ui/src/features/chat/questions/mobile-question-transport.js';
import { ChatRuntime } from '../web-ui/src/features/chat/runtime/chat-runtime.js';

const sourceQuestion = {
  questionId: 'question-model-1',
  sourceSessionId: 'session-model',
  title: 'Choose a release plan',
  prompt: 'Prometheus needs a decision.',
  allowGeneralOther: true,
  questions: [
    { id: 'single', question: 'Which channel?', mode: 'single_select', options: ['web', 'desktop'] },
    { id: 'multi', label: 'Which platforms?', mode: 'multiple', choices: ['macOS', 'Windows', 'Linux', 'Android', 'iOS', 'web', 'cli', 'api', 'extra'] },
    { id: 'text', label: 'Anything to add?', type: 'free_text' },
    { id: 'four', label: 'Fourth', options: ['one'] },
    { id: 'five', label: 'Fifth', options: ['one'] },
    { id: 'six', label: 'Truncated', options: ['one'] },
  ],
};

const question = normalizeQuestionRecord(sourceQuestion);
assert.equal(normalizeQuestionRecord({ ...sourceQuestion, currentIndex: '2' }).currentIndex, 2, 'question normalization must preserve the active mobile step');
assert.equal(normalizeQuestionRecord({ ...sourceQuestion, currentIndex: 'not-a-number' }).currentIndex, 0, 'invalid question steps must fall back to the first step');
assert.equal(normalizeQuestionMode('multiple'), 'multi_select');
assert.equal(normalizeQuestionMode('free_text'), 'text');
assert.equal(question.id, 'question-model-1');
assert.equal(question.sessionId, 'session-model');
assert.equal(question.questions.length, 5, 'question records must keep the five-question limit');
assert.equal(question.questions[1].options.length, 8, 'question items must keep the eight-option limit');
assert.equal(question.questions[1].mode, 'multi_select');
assert.equal(question.questions[2].mode, 'text');

const payload = buildQuestionAnswerPayload(question, {
  answers: [
    { id: 'single', selected: ['web', 'desktop'] },
    { id: 'multi', selected: ['macOS', 'Windows'], other: 'BSD' },
    { id: 'text', selected: ['ignored'], text: 'ship it' },
  ],
  generalOther: 'No further changes.',
});
assert.deepEqual(payload.answers[0], {
  id: 'single', label: 'Which channel?', mode: 'single_select', selected: ['web'], text: '', other: '',
});
assert.deepEqual(payload.answers[1], {
  id: 'multi', label: 'Which platforms?', mode: 'multi_select', selected: ['macOS', 'Windows'], text: '', other: 'BSD',
});
assert.deepEqual(payload.answers[2], {
  id: 'text', label: 'Anything to add?', mode: 'text', selected: [], text: 'ship it', other: '',
});
assert.equal(buildQuestionAnswerPayload({ ...question, generalOther: '' }, {
  answers: [], general_other: 'snake-case note',
}).generalOther, 'snake-case note');
assert.equal(getMissingQuestionAnswers(question, { answers: payload.answers }).some((item) => item.id === 'four'), true);
assert.equal(getMissingQuestionAnswers({ ...question, questions: [{ ...question.questions[0], required: false }] }, { answers: [] }).length, 0);

const composerPayload = buildQuestionAnswerPayload(question, { answers: [] });
applyQuestionComposerAnswer(question, composerPayload, 'custom platform', 'multi::other');
assert.equal(composerPayload.answers.find((answer) => answer.id === 'multi').other, 'custom platform');
const generalFallback = { answers: [] };
applyQuestionComposerAnswer({ allowGeneralOther: true, questions: [] }, generalFallback, 'a note');
assert.equal(generalFallback.generalOther, 'a note');

const answered = mergeQuestionRecords(
  { ...question, status: 'answered', answers: payload.answers },
  { ...question, status: 'pending', answers: [] },
);
assert.equal(answered.status, 'answered', 'late pending events must not regress a terminal question');
assert.equal(mergeQuestionRecords(answered, { ...question, status: 'pending' }, { allowStatusRegression: true }).status, 'pending');

const runtimes = new Map([
  ['session-one', new ChatRuntime({ gatewayId: 'question-test', sessionId: 'session-one' })],
  ['session-two', new ChatRuntime({ gatewayId: 'question-test', sessionId: 'session-two' })],
  ['session-three', new ChatRuntime({ gatewayId: 'question-test', sessionId: 'session-three' })],
]);
const legacy = { 'session-one': [], 'session-two': [], 'session-three': [] };
let projectionCount = 0;
let fetchCount = 0;
let submitCount = 0;
let resumeCount = 0;
let cancelCount = 0;
let submitSuccessCount = 0;
let cancelSuccessCount = 0;
const errorPhases = [];

const sessionOneRuntime = runtimes.get('session-one');
const originalSessionOneUpsertQuestion = sessionOneRuntime.upsertQuestion.bind(sessionOneRuntime);
let sessionOneQuestionWriteCount = 0;
sessionOneRuntime.upsertQuestion = (...args) => {
  sessionOneQuestionWriteCount += 1;
  return originalSessionOneUpsertQuestion(...args);
};
const transport = {
  fetchQuestion: async () => {
    fetchCount += 1;
    return null;
  },
  submit: async (id, body) => {
    submitCount += 1;
    assert.ok(['question-one', 'question-resume-failure'].includes(id));
    assert.equal(body.answers.length, 1, 'partial view answers must be expanded to the question model');
    assert.deepEqual(body.answers[0], {
      id: 'single',
      label: 'Which channel?',
      mode: 'single_select',
      selected: ['web'],
      text: '',
      other: '',
    }, 'submit payloads must be canonical and single-select answers truncated');
    return {
      question: { id, sessionId: 'session-one', status: 'answered' },
      resumePrompt: id === 'question-resume-failure'
        ? 'Resume failure'
        : 'Continue the interrupted turn.',
    };
  },
  cancel: async (id) => {
    cancelCount += 1;
    assert.equal(id, 'question-three');
    return { question: { id, sessionId: 'session-two', status: 'cancelled' } };
  },
  resume: async (result, sessionId) => {
    resumeCount += 1;
    assert.equal(sessionId, 'session-one');
    if (result.resumePrompt === 'Resume failure') throw new Error('resume transport unavailable');
    assert.equal(result.resumePrompt, 'Continue the interrupted turn.');
  },
};

function legacyQuestion(id, preferredSessionId = '') {
  const sessionIds = preferredSessionId ? [preferredSessionId] : Object.keys(legacy);
  for (const sessionId of sessionIds) {
    const item = legacy[sessionId]?.find((entry) => entry.questionRequest?.id === id);
    if (item?.questionRequest) return { sessionId, record: item.questionRequest };
  }
  return null;
}

const controller = createQuestionController({
  runtimeFor: (sessionId) => runtimes.get(sessionId),
  getSessionIds: () => [...runtimes.keys()],
  getActiveSessionId: () => 'session-one',
  getLegacyQuestion: legacyQuestion,
  getLegacyQuestionSessionIds: () => Object.keys(legacy),
  projectToLegacy: ({ sessionId, question: next }) => {
    projectionCount += 1;
    const entries = legacy[sessionId] || (legacy[sessionId] = []);
    const existing = entries.find((entry) => entry.questionRequest?.id === next.id);
    if (existing) existing.questionRequest = { ...next };
    else entries.push({ role: 'assistant', questionRequest: { ...next } });
  },
  transport,
  readAnswers: () => buildQuestionAnswerPayload(question, {
    answers: [{ id: 'single', selected: ['web'] }],
  }),
  getComposerTarget: () => '',
  onSubmitSuccess: () => { submitSuccessCount += 1; },
  onCancelSuccess: () => { cancelSuccessCount += 1; },
  onError: (_error, details) => { errorPhases.push(details?.phase || 'unknown'); },
});

const stepRuntime = new ChatRuntime({ gatewayId: 'question-test', sessionId: 'session-stepper' });
let stepSubmitCount = 0;
let stepAdvance;
const stepController = createQuestionController({
  runtimeFor: (sessionId) => sessionId === 'session-stepper' ? stepRuntime : null,
  getSessionIds: () => ['session-stepper'],
  getActiveSessionId: () => 'session-stepper',
  transport: {
    submit: async () => {
      stepSubmitCount += 1;
      return { question: { id: 'question-stepper', sessionId: 'session-stepper', status: 'answered' } };
    },
  },
});
const stepQuestion = {
  id: 'question-stepper',
  sessionId: 'session-stepper',
  status: 'pending',
  questions: [
    { id: 'first', label: 'First step', mode: 'single_select', options: ['yes'] },
    { id: 'second', label: 'Second step', mode: 'single_select', options: ['yes'] },
  ],
};
stepController.upsert(stepQuestion);
const firstStep = await stepController.submit('question-stepper', {
  stepIndex: 0,
  advanceStep: true,
  readAnswers: () => ({ answers: [
    { id: 'first', selected: [] },
    { id: 'second', selected: [] },
  ] }),
  composerText: 'custom first-step answer',
  getComposerTarget: () => 'first::other',
  onStepAdvance: (details) => { stepAdvance = details; },
});
assert.equal(firstStep.ok, true, 'the first question step must advance locally');
assert.equal(firstStep.advanced, true, 'the first question step must report a local advance');
assert.equal(stepSubmitCount, 0, 'intermediate question steps must not call the backend');
assert.equal(stepAdvance.nextIndex, 1, 'the question controller must advance to the next step');
assert.equal(stepAdvance.payload.answers[0].other, 'custom first-step answer', 'per-submit composer targets must reach the question model');
assert.equal(stepRuntime.getQuestion('question-stepper').status, 'pending');
const finalStep = await stepController.submit('question-stepper', {
  stepIndex: 1,
  advanceStep: true,
  readAnswers: () => ({ answers: [
    { id: 'first', selected: ['yes'] },
    { id: 'second', selected: ['yes'] },
  ] }),
});
assert.equal(finalStep.ok, true, 'the final question step must submit normally');
assert.equal(finalStep.advanced, undefined);
assert.equal(stepSubmitCount, 1, 'the final question step must call the backend once');
assert.equal(stepRuntime.getQuestion('question-stepper').status, 'answered');

const pendingOne = controller.upsert({
  ...question,
  id: 'question-one',
  sessionId: 'session-one',
  questions: [{ id: 'single', label: 'Which channel?', mode: 'single_select', options: ['web', 'desktop'] }],
  status: 'pending',
});
assert.equal(pendingOne.accepted, true);
assert.equal(pendingOne.changed, true);
const beforeDuplicateSnapshot = sessionOneRuntime.snapshot;
const beforeDuplicateActivityAt = beforeDuplicateSnapshot.lifecycle.lastActivityAt;
const beforeDuplicateWrites = sessionOneQuestionWriteCount;
const duplicateOne = controller.upsert(pendingOne.record);
assert.equal(duplicateOne.changed, false, 'duplicate create events must be idempotent');
assert.equal(sessionOneQuestionWriteCount, beforeDuplicateWrites, 'duplicate events must not call runtime.upsertQuestion');
assert.strictEqual(sessionOneRuntime.snapshot, beforeDuplicateSnapshot, 'duplicate events must not replace runtime state');
assert.equal(sessionOneRuntime.snapshot.lifecycle.lastActivityAt, beforeDuplicateActivityAt, 'duplicate events must not touch runtime activity');
assert.equal(sessionOneRuntime.snapshot.questions.length, 1);
assert.equal(projectionCount, 1, 'unchanged duplicate events must not repeat compatibility projection');

const answeredOne = controller.transition({
  questionId: 'question-one',
  sessionId: 'session-one',
  question: { ...pendingOne.record, status: 'answered' },
}, 'answered');
assert.equal(answeredOne[0].record.status, 'answered');
const stalePending = controller.transition({ questionId: 'question-one', sessionId: 'session-one' }, 'pending');
assert.equal(stalePending[0].record.status, 'answered', 'out-of-order pending events must not regress a terminal record');

const pendingTwo = controller.upsert({
  ...question,
  id: 'question-two',
  sessionId: 'session-two',
  questions: [{ id: 'single', label: 'Which channel?', mode: 'single_select', options: ['web', 'desktop'] }],
  status: 'pending',
});
assert.equal(pendingTwo.record.sessionId, 'session-two');
controller.transition({ questionId: 'question-two', sessionId: 'session-two' }, 'answered');
assert.equal(runtimes.get('session-one').getQuestion('question-two'), null, 'session targeting must not update another session');
assert.equal(runtimes.get('session-two').getQuestion('question-two').status, 'answered');
assert.equal(runtimes.get('session-three').getQuestion('question-two'), null, 'explicit session targeting must not create a third-session record');

// Without a sid, existing runtime records are the only fan-out targets.
for (const sessionId of ['session-one', 'session-two']) {
  controller.upsert({
    ...question,
    id: 'question-runtime-matches',
    sessionId,
    questions: [{ id: 'single', label: 'Which channel?', mode: 'single_select', options: ['web', 'desktop'] }],
    status: 'pending',
  });
}
const runtimeMatchesTransition = controller.transition({
  questionId: 'question-runtime-matches',
  question: { ...question, id: 'question-runtime-matches', sessionId: '', sourceSessionId: '' },
}, 'answered');
assert.equal(runtimeMatchesTransition.length, 2, 'all existing runtime matches may receive an unscoped event');
assert.equal(runtimes.get('session-one').getQuestion('question-runtime-matches').status, 'answered');
assert.equal(runtimes.get('session-two').getQuestion('question-runtime-matches').status, 'answered');
assert.equal(runtimes.get('session-three').getQuestion('question-runtime-matches'), null, 'unrelated sessions must not be created');

// If no runtime has the record, exactly one legacy-history match may hydrate
// it; multiple legacy matches are ambiguous and must not receive a terminal
// event or manufacture a record in the active session.
legacy['session-two'].push({
  role: 'assistant',
  questionRequest: {
    ...question,
    id: 'question-legacy-match',
    sessionId: 'session-two',
    questions: [{ id: 'single', label: 'Which channel?', mode: 'single_select', options: ['web', 'desktop'] }],
    status: 'pending',
  },
});
const legacyMatchTransition = controller.transition({
  questionId: 'question-legacy-match',
  question: { ...question, id: 'question-legacy-match', sessionId: '', sourceSessionId: '' },
}, 'answered');
assert.equal(legacyMatchTransition.length, 1);
assert.equal(legacyMatchTransition[0].sessionId, 'session-two');
assert.equal(runtimes.get('session-two').getQuestion('question-legacy-match').status, 'answered');
assert.equal(runtimes.get('session-one').getQuestion('question-legacy-match'), null);
assert.equal(runtimes.get('session-three').getQuestion('question-legacy-match'), null);

for (const sessionId of ['session-one', 'session-two']) {
  legacy[sessionId].push({
    role: 'assistant',
    questionRequest: {
      ...question,
      id: 'question-ambiguous-legacy',
      sessionId,
      status: 'pending',
    },
  });
}
const ambiguousTerminal = controller.transition({ questionId: 'question-ambiguous-legacy' }, 'answered');
assert.equal(ambiguousTerminal.length, 0, 'ambiguous legacy terminal events must not use the active fallback');
assert.equal(runtimes.get('session-one').getQuestion('question-ambiguous-legacy'), null);
assert.equal(runtimes.get('session-two').getQuestion('question-ambiguous-legacy'), null);
assert.equal(runtimes.get('session-three').getQuestion('question-ambiguous-legacy'), null);
const activeFallback = controller.transition({ questionId: 'question-active-fallback' }, 'pending');
assert.equal(activeFallback.length, 1);
assert.equal(activeFallback[0].sessionId, 'session-one');
assert.equal(runtimes.get('session-one').getQuestion('question-active-fallback').status, 'pending');
assert.equal(runtimes.get('session-two').getQuestion('question-active-fallback'), null);
assert.equal(runtimes.get('session-three').getQuestion('question-active-fallback'), null);

// Legacy history may bootstrap ChatRuntime.questions only when the adapter
// marks the first hydration explicitly. Subsequent compatibility refreshes
// cannot seed a new record or overwrite the renderer-owned one.
const historyBootstrapRuntime = new ChatRuntime({ gatewayId: 'question-test', sessionId: 'history-bootstrap' });
historyBootstrapRuntime.replaceHistory([{
  messageId: 'history-question-row',
  role: 'assistant',
  questionRequest: {
    ...question,
    id: 'history-question',
    sessionId: 'history-bootstrap',
    status: 'pending',
  },
}], { source: 'initial-hydration', initializeQuestionsFromHistory: true });
assert.equal(historyBootstrapRuntime.getQuestion('history-question').status, 'pending');
historyBootstrapRuntime.replaceHistory([{
  messageId: 'history-question-row',
  role: 'assistant',
  questionRequest: {
    ...question,
    id: 'history-question',
    sessionId: 'history-bootstrap',
    status: 'answered',
  },
}, {
  messageId: 'history-question-new-row',
  role: 'assistant',
  questionRequest: { ...question, id: 'history-question-new', status: 'pending' },
}], { source: 'compatibility-refresh', initializeQuestionsFromHistory: true });
assert.equal(historyBootstrapRuntime.getQuestion('history-question').status, 'pending', 'later history must not overwrite runtime questions');
assert.equal(historyBootstrapRuntime.getQuestion('history-question-new'), null, 'later history must not seed runtime questions');

const pendingThree = controller.upsert({
  ...question,
  id: 'question-three',
  sessionId: 'session-two',
  questions: [{ id: 'single', label: 'Which channel?', mode: 'single_select', options: ['web', 'desktop'] }],
  status: 'pending',
});
assert.equal(pendingThree.record.status, 'pending');
const submittingThree = controller.transition({ questionId: 'question-three', sessionId: 'session-two' }, 'submitting');
assert.equal(submittingThree[0].record.status, 'submitting');
const retriedThree = controller.transition({ questionId: 'question-three', sessionId: 'session-two' }, 'pending', { allowStatusRegression: true });
assert.equal(retriedThree[0].record.status, 'pending');

// A terminal event without a target must not manufacture a record in every
// known session when the original question was never hydrated locally.
assert.equal(controller.transition({ questionId: 'question-orphan' }, 'answered').length, 0);
assert.equal(runtimes.get('session-one').getQuestion('question-orphan'), null);
assert.equal(runtimes.get('session-two').getQuestion('question-orphan'), null);

// A compatibility history refresh may contain a stale pending copy, but it
// must not overwrite the runtime record after the controller has accepted the
// terminal transition.
runtimes.get('session-one').replaceHistory([{
  messageId: 'stale-question-row',
  role: 'assistant',
  questionRequest: { ...pendingOne.record, status: 'pending' },
}]);
assert.equal(runtimes.get('session-one').getQuestion('question-one').status, 'answered');

// Re-create a pending record for the submit path so local lookup can be proved
// without falling back to the endpoint.
const submitQuestion = {
  ...question,
  id: 'question-one',
  sessionId: 'session-one',
  questions: [{ id: 'single', label: 'Which channel?', mode: 'single_select', options: ['web', 'desktop'] }],
  status: 'pending',
};
runtimes.get('session-one').upsertQuestion(submitQuestion);
legacy['session-one'][0].questionRequest = { ...submitQuestion };
const submitted = await controller.submit('question-one');
assert.equal(submitted.ok, true);
assert.equal(fetchCount, 0, 'submit must prefer the local runtime question');
assert.equal(submitCount, 1);
assert.equal(resumeCount, 1, 'the transport owns resume coordination');
assert.equal(submitSuccessCount, 1);
assert.equal(runtimes.get('session-one').getQuestion('question-one').status, 'answered');

const resumeFailureQuestion = {
  ...question,
  id: 'question-resume-failure',
  sessionId: 'session-one',
  questions: [{ id: 'single', label: 'Which channel?', mode: 'single_select', options: ['web', 'desktop'] }],
  status: 'pending',
};
runtimes.get('session-one').upsertQuestion(resumeFailureQuestion);
const resumeFailure = await controller.submit('question-resume-failure');
assert.equal(resumeFailure.ok, true, 'a successful backend submit remains successful when resume fails');
assert.equal(resumeFailure.reason, undefined);
assert.equal(runtimes.get('session-one').getQuestion('question-resume-failure').status, 'answered');
assert.equal(errorPhases.includes('resume'), true, 'resume failures must be reported with phase resume');
assert.equal(errorPhases.includes('submit'), false, 'resume failures must not be reported as submit failures');

const cancelled = await controller.cancel('question-three', { sessionId: 'session-two' });
assert.equal(cancelled.ok, true);
assert.equal(cancelCount, 1);
assert.equal(cancelSuccessCount, 1);
assert.equal(runtimes.get('session-two').getQuestion('question-three').status, 'cancelled');

let mobileResumeSendCount = 0;
let mobileResumeQueueCount = 0;
const mobileTransport = createMobileQuestionTransport({
  request: async () => ({}),
  getActiveSessionId: () => 'session-one',
  sendResume: () => {
    mobileResumeSendCount += 1;
    // The real successful mobile send path has historically returned void.
  },
  queueResume: () => { mobileResumeQueueCount += 1; },
  schedule: (callback) => callback(),
});
assert.equal(await mobileTransport.resume({ resumePrompt: 'Continue on mobile.' }, 'session-one'), true);
assert.equal(mobileResumeSendCount, 1);
assert.equal(mobileResumeQueueCount, 0, 'a successful undefined send callback must not also queue resume');

let explicitFailureQueueCount = 0;
const explicitFailureTransport = createMobileQuestionTransport({
  request: async () => ({}),
  sendResume: () => false,
  queueResume: () => { explicitFailureQueueCount += 1; },
  schedule: (callback) => callback(),
});
assert.equal(await explicitFailureTransport.resume({ resumePrompt: 'Retry on mobile.' }, 'session-one'), true);
assert.equal(explicitFailureQueueCount, 1, 'only an explicit false send result should queue resume');

console.log('Chat question model/controller contract passed.');
