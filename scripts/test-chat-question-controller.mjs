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
]);
const legacy = { 'session-one': [], 'session-two': [] };
let projectionCount = 0;
let fetchCount = 0;
let submitCount = 0;
let resumeCount = 0;
let cancelCount = 0;
let submitSuccessCount = 0;
let cancelSuccessCount = 0;
const transport = {
  fetchQuestion: async () => {
    fetchCount += 1;
    return null;
  },
  submit: async (id, body) => {
    submitCount += 1;
    assert.equal(id, 'question-one');
    assert.equal(body.answers[0].selected[0], 'web');
    return {
      question: { id, sessionId: 'session-one', status: 'answered' },
      resumePrompt: 'Continue the interrupted turn.',
    };
  },
  cancel: async (id) => {
    cancelCount += 1;
    assert.equal(id, 'question-three');
    return { question: { id, sessionId: 'session-two', status: 'cancelled' } };
  },
  resume: async (result, sessionId) => {
    resumeCount += 1;
    assert.equal(result.resumePrompt, 'Continue the interrupted turn.');
    assert.equal(sessionId, 'session-one');
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
});

const pendingOne = controller.upsert({
  ...question,
  id: 'question-one',
  sessionId: 'session-one',
  questions: [{ id: 'single', label: 'Which channel?', mode: 'single_select', options: ['web', 'desktop'] }],
  status: 'pending',
});
assert.equal(pendingOne.accepted, true);
assert.equal(pendingOne.changed, true);
assert.equal(controller.upsert(pendingOne.record).changed, false, 'duplicate create events must be idempotent');
assert.equal(runtimes.get('session-one').snapshot.questions.length, 1);
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

const cancelled = await controller.cancel('question-three', { sessionId: 'session-two' });
assert.equal(cancelled.ok, true);
assert.equal(cancelCount, 1);
assert.equal(cancelSuccessCount, 1);
assert.equal(runtimes.get('session-two').getQuestion('question-three').status, 'cancelled');

console.log('Chat question model/controller contract passed.');
