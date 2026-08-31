import assert from 'node:assert/strict';
import { createDesktopQuestionTransport } from '../web-ui/src/features/chat/questions/desktop-question-transport.js';
import { createMobileQuestionTransport } from '../web-ui/src/features/chat/questions/mobile-question-transport.js';

const immediateSchedule = (callback) => callback();
const request = async () => ({});

for (const failure of [
  () => { throw new Error('desktop sync resume failure'); },
  async () => { throw new Error('desktop async resume failure'); },
]) {
  const transport = createDesktopQuestionTransport({
    request,
    schedule: immediateSchedule,
    sendResume: failure,
    getActiveSessionId: () => 'session-one',
  });
  await assert.rejects(
    transport.resume({ resumePrompt: 'continue', question: { sessionId: 'session-one' } }),
    /desktop .* resume failure/,
    'desktop resume must reject when the delayed send fails',
  );
}

let queued = 0;
const mobileUndefined = createMobileQuestionTransport({
  request,
  schedule: immediateSchedule,
  sendResume: () => undefined,
  queueResume: () => { queued += 1; },
});
assert.equal(await mobileUndefined.resume({ resumePrompt: 'continue' }, 'session-one'), true);
assert.equal(queued, 0, 'undefined mobile send result must remain accepted');

const mobileRejected = createMobileQuestionTransport({
  request,
  schedule: immediateSchedule,
  sendResume: async () => { throw new Error('mobile async resume failure'); },
});
await assert.rejects(
  mobileRejected.resume({ resumePrompt: 'continue' }, 'session-one'),
  /mobile async resume failure/,
  'mobile resume must reject when the delayed send rejects',
);

const mobileQueued = createMobileQuestionTransport({
  request,
  schedule: immediateSchedule,
  sendResume: () => false,
  queueResume: async () => { queued += 1; },
});
assert.equal(await mobileQueued.resume({ resumePrompt: 'continue' }, 'session-one'), true);
assert.equal(queued, 1, 'explicit false must continue to queue the mobile resume');

console.log('question resume transport delayed-error regressions passed');
