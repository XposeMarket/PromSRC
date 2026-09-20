import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-question-wait-'));
process.env.PROMETHEUS_DATA_DIR = tempRoot;

try {
  const questionModuleUrl = pathToFileURL(path.resolve('dist/gateway/prometheus-questions.js')).href;
  const {
    createPrometheusQuestionPayload,
    getPrometheusQuestionQueue,
    submitPrometheusQuestionResponse,
  } = await import(`${questionModuleUrl}?test=${Date.now()}`);

  const queue = getPrometheusQuestionQueue();
  const createQuestion = (sessionId) => queue.create(createPrometheusQuestionPayload({
    sessionId,
    questions: [{ id: 'path', label: 'Which path?', mode: 'single_select', options: ['A', 'B'] }],
  }));

  const answeredQuestion = createQuestion('answer-session');
  let answerSettled = false;
  const answerWait = new Promise((resolve) => {
    queue.onResolve(answeredQuestion.id, (payload) => {
      answerSettled = true;
      resolve(payload);
    });
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(answerSettled, false, 'a pending question must not resolve before the user answers');

  const submitResult = submitPrometheusQuestionResponse({
    questionId: answeredQuestion.id,
    answers: [{ id: 'path', selected: ['A'] }],
  });
  assert.equal(submitResult.success, true);
  assert.equal(submitResult.requiresChatResume, false, 'a live suspended turn must resume through its waiter');
  const answerPayload = await answerWait;
  assert.deepEqual(answerPayload.answers[0].selected, ['A']);

  const cancelledQuestion = createQuestion('cancel-session');
  let cancelSettled = false;
  const cancelWait = new Promise((resolve) => {
    queue.onCancel(cancelledQuestion.id, () => {
      cancelSettled = true;
      resolve();
    });
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelSettled, false, 'a pending question must not resolve before cancellation');
  assert.ok(queue.cancel(cancelledQuestion.id));
  await cancelWait;
  assert.equal(cancelSettled, true, 'cancelling a card must release the suspended turn');

  const runtimeModuleUrl = pathToFileURL(path.resolve('dist/gateway/live-runtime-registry.js')).href;
  const { registerLiveRuntime, finishLiveRuntime } = await import(runtimeModuleUrl);
  const runtimeId = registerLiveRuntime({ kind: 'main_chat', label: 'Original chat turn', sessionId: 'racing-session' });
  try {
    const racingQuestion = createQuestion('racing-session');
    const racingResult = submitPrometheusQuestionResponse({
      questionId: racingQuestion.id,
      answers: [{ id: 'path', selected: ['A'] }],
    });
    assert.equal(racingResult.success, true);
    assert.equal(racingResult.requiresChatResume, false,
      'a fast answer without a registered waiter must not queue a second turn while the original runtime is live');
  } finally {
    finishLiveRuntime(runtimeId);
  }

  const interruptedQuestion = createQuestion('interrupted-session');
  const interruptedResult = submitPrometheusQuestionResponse({
    questionId: interruptedQuestion.id,
    answers: [{ id: 'path', selected: ['B'] }],
  });
  assert.equal(interruptedResult.requiresChatResume, true,
    'an answered question with no waiter or live owner still needs restart recovery');

  const oldQuestion = createQuestion('reused-session');
  oldQuestion.createdAt = new Date(Date.now() - 10_000).toISOString();
  const newerRuntimeId = registerLiveRuntime({ kind: 'main_chat', label: 'Newer chat turn', sessionId: oldQuestion.sessionId });
  try {
    const oldQuestionResult = submitPrometheusQuestionResponse({
      questionId: oldQuestion.id,
      answers: [{ id: 'path', selected: ['A'] }],
    });
    assert.equal(oldQuestionResult.requiresChatResume, true,
      'a newer turn in the same session must not be mistaken for the question’s original owner');
  } finally {
    finishLiveRuntime(newerRuntimeId);
  }

  const executorSource = fs.readFileSync(path.resolve('src/gateway/agents-runtime/subagent-executor.ts'), 'utf8');
  const createStart = executorSource.indexOf('const question = questionQueue.create(payload);');
  const registerWaiter = executorSource.indexOf('const waitForAnswer = new Promise<', createStart);
  const broadcastCard = executorSource.indexOf("type: 'question_created'", createStart);
  const telegramDelivery = executorSource.indexOf('await deps.telegramChannel.sendPrometheusQuestion(question)', createStart);
  const hardWaitStart = executorSource.indexOf('const waitResult = await waitForAnswer;', createStart);
  const answeredResult = executorSource.indexOf("status: 'answered'", hardWaitStart);
  assert.ok(createStart >= 0 && registerWaiter > createStart && broadcastCard > registerWaiter
    && telegramDelivery > broadcastCard && hardWaitStart > telegramDelivery && answeredResult > hardWaitStart,
  'ask_prometheus_questions must register its waiter before exposing the card, then await the answer before returning');
  assert.equal(executorSource.includes('End this turn now; the submitted answer will resume'), false, 'the old advisory-only yield must not return');

  console.log('Prometheus question suspension regression checks passed.');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
