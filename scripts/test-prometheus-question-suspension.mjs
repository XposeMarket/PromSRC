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
    title: 'Choose a path',
    prompt: 'A decision is required before work continues.',
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

  const executorSource = fs.readFileSync(path.resolve('src/gateway/agents-runtime/subagent-executor.ts'), 'utf8');
  const hardWaitStart = executorSource.indexOf('const waitResult = await new Promise<{ answers: PrometheusQuestionAnswer[]; generalOther?: string } | { cancelled: true }>');
  const answeredResult = executorSource.indexOf('status: \'answered\'', hardWaitStart);
  assert.ok(hardWaitStart >= 0 && answeredResult > hardWaitStart, 'ask_prometheus_questions must await the card before returning an answered result');
  assert.equal(executorSource.includes('End this turn now; the submitted answer will resume'), false, 'the old advisory-only yield must not return');

  console.log('Prometheus question suspension regression checks passed.');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
