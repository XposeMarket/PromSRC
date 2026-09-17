import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ChatStore } from '../web-ui/src/mobile-v2/core/chat-store.js';
import { FeatureClient } from '../web-ui/src/mobile-v2/core/feature-client.js';
import { GatewayClient } from '../web-ui/src/mobile-v2/core/gateway-client.js';

const store = new ChatStore();
store.hydrate('gw', 'session', {
  session: {
    history: [{ id: 'assistant-1', role: 'assistant', content: 'Hello' }],
    historyPage: { olderCursor: 'cursor-1', hasOlder: true },
  },
});
assert.equal(store.get('gw', 'session').olderCursor, 'cursor-1');
assert.equal(store.get('gw', 'session').hasOlder, true);
store.prependHistory('gw', 'session', {
  items: [{ id: 'user-0', role: 'user', content: 'Earlier' }],
  olderCursor: null,
  hasOlder: false,
});
assert.deepEqual(store.get('gw', 'session').messages.map((message) => message.id), ['user-0', 'assistant-1']);
assert.equal(store.get('gw', 'session').hasOlder, false);
store.upsertInteraction('gw', 'session', 'question', { id: 'question-1', prompt: 'Continue?' });
assert.equal(store.get('gw', 'session').messages.at(-1).questions[0].id, 'question-1');
store.upsertInteraction('gw', 'session', 'question', { id: 'question-1', status: 'answered' });
assert.equal(store.get('gw', 'session').messages.flatMap((message) => message.questions).length, 1);
assert.equal(store.get('gw', 'session').messages.at(-1).questions[0].status, 'answered');

const calls = [];
const api = {
  async request(path, options = {}) {
    calls.push({ path, options });
    if (path.startsWith('/api/approvals?')) return { approvals: [{ id: 'approval-1' }] };
    if (path.startsWith('/api/questions?')) return { questions: [{ id: 'question-2' }] };
    if (path === '/api/realtime/status') return { configured: true };
    return { success: true };
  },
};
const featureClient = new FeatureClient({ get active() { return api; } });
await featureClient.taskAction('task-1', 'retry');
await featureClient.taskAction('task-1', 'cancel');
await featureClient.toggleSchedule({ id: 'schedule-1', kind: 'cron' }, false);
await featureClient.createSchedule({ enabled: false });
await featureClient.updateSchedule({ id: 'schedule-1' }, { enabled: false, confirm: true });
await featureClient.saveTeamContext('team-1', 'Title', 'Body');
assert.deepEqual(calls.slice(0, 5).map(({ path, options }) => [path, options.method]), [
  ['/api/bg-tasks/task-1/restart', 'POST'],
  ['/api/bg-tasks/task-1/cancel', 'POST'],
  ['/api/schedules/schedule-1', 'PATCH'],
  ['/api/schedules', 'POST'],
  ['/api/schedules/schedule-1', 'PUT'],
]);
assert.equal(JSON.parse(calls[2].options.body).enabled, false);
assert.equal(JSON.parse(calls[3].options.body).enabled, false);
assert.equal(JSON.parse(calls[4].options.body).enabled, false);
assert.deepEqual(JSON.parse(calls[5].options.body), { title: 'Title', content: 'Body' });
const voice = await featureClient.voiceStatus();
assert.equal(voice.realtime.configured, true);
assert.equal(calls.at(-1).path, '/api/realtime/status');
await featureClient.voiceStt({ audioBase64: 'YQ==' });
assert.equal(calls.at(-1).path, '/api/voice/transcribe');

const gateway = new GatewayClient({ id: 'gw', name: 'Gateway', origin: 'http://localhost', tokenProvider: () => '' });
gateway.request = async (path) => path.startsWith('/api/approvals?')
  ? { approvals: [{ id: 'approval-2' }] }
  : { questions: [{ id: 'question-3' }] };
const pending = await gateway.pendingInteractions('session-1');
assert.equal(pending.approvals[0].id, 'approval-2');
assert.equal(pending.questions[0].id, 'question-3');

const [taskRoutes, teamRoutes, approvalRoutes, routerSource, chatPage, interactionSource, taskPage] = await Promise.all([
  readFile(new URL('../src/gateway/routes/tasks.router.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/gateway/routes/teams.router.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/gateway/routes/settings.router.ts', import.meta.url), 'utf8'),
  readFile(new URL('../web-ui/src/mobile-v2/app/router.js', import.meta.url), 'utf8'),
  readFile(new URL('../web-ui/src/mobile-v2/features/chat/chat-page.js', import.meta.url), 'utf8'),
  readFile(new URL('../web-ui/src/mobile-v2/features/chat/chat-interactions.js', import.meta.url), 'utf8'),
  readFile(new URL('../web-ui/src/mobile-v2/features/tasks/tasks-page.js', import.meta.url), 'utf8'),
]);
assert.match(taskRoutes, /router\.post\('\/api\/bg-tasks\/:id\/restart'/);
assert.match(taskRoutes, /router\.post\('\/api\/bg-tasks\/:id\/cancel'/);
assert.match(teamRoutes, /enabled: req\.body\?\.enabled !== false/);
assert.match(teamRoutes, /updates\.enabled = req\.body\.enabled === true/);
assert.match(approvalRoutes, /String\(record\.sessionId \|\| ''\) === sessionId/);
assert.match(routerSource, /escapeHtml\(error\?\.message/);
assert.match(chatPage, /new WebSocket\(gateway\.wsUrl\('\/ws'\)\)/);
assert.match(chatPage, /approval_created/);
assert.match(chatPage, /question_created/);
assert.match(interactionSource, /executed', 'failed/);
assert.match(taskRoutes, /'complete', 'completed', 'succeeded', 'failed', 'cancelled'/);
assert.match(taskPage, /complete\|succeeded\|cancelled\|failed/);

console.log('mobile-v2 integration regression: ok');
