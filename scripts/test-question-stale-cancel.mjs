import assert from 'node:assert/strict';
import { createQuestionController } from '../web-ui/src/features/chat/questions/question-controller.js';
import { createMobileQuestionTransport } from '../web-ui/src/features/chat/questions/mobile-question-transport.js';
import { createDesktopQuestionTransport } from '../web-ui/src/features/chat/questions/desktop-question-transport.js';
import { ChatRuntime } from '../web-ui/src/features/chat/runtime/chat-runtime.js';

for (const factory of [createMobileQuestionTransport, createDesktopQuestionTransport]) {
  for (const phase of ['cancel', 'submit']) {
    for (const scenario of ['cancelled', 'answered', 'expired', 'absent', 'pending', 'offline', 'lookup-failed', 'invalid-response', 'wrong-session', 'live']) {
      const sessionId = 'test-chat';
      const id = 'login-handoff';
      const runtime = new ChatRuntime({ gatewayId: 'gateway', sessionId });
      const card = { id, sessionId, status: 'pending', questions: [{ id: 'login', label: 'Logged in?', mode: 'single_select', options: ['Yes'] }] };
      let errors = 0, success = 0, mutations = 0, reads = 0, resumes = 0;
      const transport = factory({ request: async (url, opts) => {
        if (opts?.method === 'POST') {
          mutations++;
          if (scenario === 'live') return { question: { ...card, status: phase === 'submit' ? 'answered' : 'cancelled' } };
          if (scenario === 'offline') throw Error('Network unavailable');
          throw Error(phase === 'cancel' ? 'API 404: Pending question not found' : scenario === 'absent' ? 'API 404: Question not found' : 'API 409: Question already cancelled');
        }
        reads++;
        if (scenario === 'lookup-failed') throw Error('Disconnected');
        if (scenario === 'invalid-response') return {};
        return { questions: scenario === 'absent' ? [] : [{ ...card, status: scenario === 'wrong-session' ? 'answered' : scenario, sessionId: scenario === 'wrong-session' ? 'another' : sessionId }] };
      } });
      const controller = createQuestionController({ runtimeFor: sid => sid === sessionId ? runtime : null, getActiveSessionId: () => sessionId, getSessionIds: () => [sessionId], transport: { ...transport, resume: () => { resumes++; } }, readAnswers: () => ({answers:[{id:'login', selected:['Yes']}]}), onError: () => { errors++; }, onSubmitSuccess: () => { success++; }, onCancelSuccess: () => { success++; } });
      controller.upsert(card);
      const result = await controller[phase](id);
      const terminal = ['cancelled','answered','expired','absent'].includes(scenario);
      const expected = scenario === 'live' ? (phase === 'submit' ? 'answered' : 'cancelled') : terminal ? (scenario === 'absent' ? 'resolved' : scenario) : 'pending';
      assert.equal(runtime.getQuestion(id).status, expected, `${factory.name} ${phase} ${scenario}`);
      assert.equal(mutations, 1);
      assert.equal(errors, Number(!terminal && scenario !== 'live'));
      assert.equal(success, Number(scenario === 'live'));
      assert.equal(resumes, Number(phase === 'submit' && scenario === 'live'));
      if (phase === 'submit' && terminal) assert.equal(result.ok, false, 'stale answer was not accepted');
      assert.equal(reads, Number(!['live','offline'].includes(scenario)));
    }
  }
}
console.log('PASS: 40 mobile/desktop stale, retryable, and live question cases');
