import assert from 'node:assert/strict';
import { createQuestionController } from '../web-ui/src/features/chat/questions/question-controller.js';
import { ChatRuntime } from '../web-ui/src/features/chat/runtime/chat-runtime.js';

const sharedId = 'shared-question-id';
const sessions = ['session-a', 'session-b'];
const runtimes = new Map(sessions.map((sessionId) => [
  sessionId,
  new ChatRuntime({ gatewayId: 'question-submit-session-isolation', sessionId }),
]));

let firstSubmitStartedResolve;
const firstSubmitStarted = new Promise((resolve) => { firstSubmitStartedResolve = resolve; });
let releaseFirstSubmit;
const firstSubmitGate = new Promise((resolve) => { releaseFirstSubmit = resolve; });
let submitCalls = 0;

const controller = createQuestionController({
  runtimeFor: (sessionId) => runtimes.get(sessionId) || null,
  getSessionIds: () => sessions,
  getActiveSessionId: () => 'session-a',
  readAnswers: () => ({ answers: [{ id: 'choice', selected: ['yes'] }] }),
  transport: {
    submit: async () => {
      submitCalls += 1;
      if (submitCalls === 1) {
        firstSubmitStartedResolve();
        await firstSubmitGate;
      }
      return { question: { id: sharedId, status: 'answered' } };
    },
  },
});

for (const sessionId of sessions) {
  controller.upsert({
    id: sharedId,
    sessionId,
    status: 'pending',
    questions: [{
      id: 'choice',
      label: 'Continue?',
      mode: 'single_select',
      options: ['yes'],
    }],
  });
}

const first = controller.submit(sharedId, { sessionId: 'session-a' });
await firstSubmitStarted;

const sameSessionDuplicate = await controller.submit(sharedId, { sessionId: 'session-a' });
assert.deepEqual(
  sameSessionDuplicate,
  { ok: false, reason: 'in_flight' },
  'the same question in the same session must remain protected from duplicate submission',
);

const secondSession = await controller.submit(sharedId, { sessionId: 'session-b' });
assert.equal(secondSession.ok, true, 'the same question id in a different session must submit independently');
assert.equal(secondSession.sessionId, 'session-b');
assert.equal(submitCalls, 2, 'cross-session submission must reach the transport instead of being rejected as in_flight');

releaseFirstSubmit();
const firstSession = await first;
assert.equal(firstSession.ok, true);
assert.equal(firstSession.sessionId, 'session-a');
assert.equal(runtimes.get('session-a').getQuestion(sharedId).status, 'answered');
assert.equal(runtimes.get('session-b').getQuestion(sharedId).status, 'answered');

console.log('question submit session isolation: ok');
