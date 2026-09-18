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

store.hydrate('gw', 'restart-history', { history: [
  { id: 'restart-1', role: 'assistant', content: 'Restart landed cleanly. I’m back and ready to continue.' },
  { id: 'restart-duplicate', role: 'assistant', content: 'Restart landed cleanly. I’m back and ready to continue.' },
  { id: 'user-after-restart', role: 'user', content: 'Continue with the mobile app.' },
  { id: 'restart-after-user', role: 'assistant', content: 'Restart landed cleanly. I’m back and ready to continue.' },
  { id: 'checkpoint', role: 'assistant', messageKind: 'restart_checkpoint', content: '[Hot restart checkpoint: planned by this chat] internal details' },
  { id: 'internal-watch', role: 'assistant', channel: 'internal_watch', content: 'Internal review details' },
] });
assert.deepEqual(store.get('gw', 'restart-history').messages.map((message) => message.id), [
  'restart-1', 'user-after-restart', 'restart-after-user',
]);
store.upsertInteraction('gw', 'session', 'question', { id: 'question-1', prompt: 'Continue?' });
assert.equal(store.get('gw', 'session').messages.at(-1).questions[0].id, 'question-1');
store.upsertInteraction('gw', 'session', 'question', { id: 'question-1', status: 'answered' });
assert.equal(store.get('gw', 'session').messages.flatMap((message) => message.questions).length, 1);
assert.equal(store.get('gw', 'session').messages.at(-1).questions[0].status, 'answered');

const calls = [];
const api = {
  async request(path, options = {}) {
    calls.push({ path, options });
    if (path === '/api/bg-tasks?mobile=1') return { success: true, tasks: [{ id: 'task-1' }] };
    if (path.startsWith('/api/approvals?')) return { approvals: [{ id: 'approval-1' }] };
    if (path.startsWith('/api/questions?')) return { questions: [{ id: 'question-2' }] };
    if (path === '/api/realtime/status') return { configured: true };
    return { success: true };
  },
};
const featureClient = new FeatureClient({ get active() { return api; } });
assert.deepEqual(await featureClient.tasks(), [{ id: 'task-1' }]);
assert.deepEqual(await featureClient.tasks(), [{ id: 'task-1' }]);
assert.deepEqual(await featureClient.tasks({ force: true }), [{ id: 'task-1' }]);
assert.equal(calls.filter(({ path }) => path === '/api/bg-tasks?mobile=1').length, 2);
assert.equal(calls.find(({ path }) => path === '/api/bg-tasks?mobile=1').options.timeoutMs, 9000);
await featureClient.taskAction('task-1', 'retry');
await featureClient.taskAction('task-1', 'cancel');
await featureClient.toggleSchedule({ id: 'schedule-1', kind: 'cron' }, false);
await featureClient.createSchedule({ enabled: false });
await featureClient.updateSchedule({ id: 'schedule-1' }, { enabled: false, confirm: true });
await featureClient.saveTeamContext('team-1', 'Title', 'Body');
const mutations = calls.filter(({ path }) => path !== '/api/bg-tasks?mobile=1');
assert.deepEqual(mutations.slice(0, 5).map(({ path, options }) => [path, options.method]), [
  ['/api/bg-tasks/task-1/restart', 'POST'],
  ['/api/bg-tasks/task-1/cancel', 'POST'],
  ['/api/schedules/schedule-1', 'PATCH'],
  ['/api/schedules', 'POST'],
  ['/api/schedules/schedule-1', 'PUT'],
]);
assert.equal(JSON.parse(mutations[2].options.body).enabled, false);
assert.equal(JSON.parse(mutations[3].options.body).enabled, false);
assert.equal(JSON.parse(mutations[4].options.body).enabled, false);
assert.deepEqual(JSON.parse(mutations[5].options.body), { title: 'Title', content: 'Body' });
const voice = await featureClient.voiceStatus();
assert.equal(voice.realtime.configured, true);
assert.equal(calls.at(-1).path, '/api/realtime/status');
await featureClient.voiceStt({ audioBase64: 'YQ==' });
assert.equal(calls.at(-1).path, '/api/voice/transcribe');

const invalidTaskClient = new FeatureClient({ get active() { return { request: async () => ({ success: false, tasks: [] }) }; } });
await assert.rejects(invalidTaskClient.tasks(), /Invalid tasks response/);

const gateway = new GatewayClient({ id: 'gw', name: 'Gateway', origin: 'http://localhost', tokenProvider: () => '' });
gateway.request = async (path) => path.startsWith('/api/approvals?')
  ? { approvals: [{ id: 'approval-2' }] }
  : { questions: [{ id: 'question-3' }] };
const pending = await gateway.pendingInteractions('session-1');
assert.equal(pending.approvals[0].id, 'approval-2');
assert.equal(pending.questions[0].id, 'question-3');

const [taskRoutes, teamRoutes, approvalRoutes, routerSource, chatPage, interactionSource, taskPage, themeSource, settingsSurface, settingsPage] = await Promise.all([
  readFile(new URL('../src/gateway/routes/tasks.router.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/gateway/routes/teams.router.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/gateway/routes/settings.router.ts', import.meta.url), 'utf8'),
  readFile(new URL('../web-ui/src/mobile-v2/app/router.js', import.meta.url), 'utf8'),
  readFile(new URL('../web-ui/src/mobile-v2/features/chat/chat-page.js', import.meta.url), 'utf8'),
  readFile(new URL('../web-ui/src/mobile-v2/features/chat/chat-interactions.js', import.meta.url), 'utf8'),
  readFile(new URL('../web-ui/src/mobile-v2/features/tasks/tasks-page.js', import.meta.url), 'utf8'),
  readFile(new URL('../web-ui/src/mobile-v2/core/theme.js', import.meta.url), 'utf8'),
  readFile(new URL('../web-ui/src/mobile-v2/features/settings/settings-surface.js', import.meta.url), 'utf8'),
  readFile(new URL('../web-ui/src/mobile-v2/features/settings/settings-page.js', import.meta.url), 'utf8'),
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
assert.match(themeSource, /\{ id: 'dark', label: 'Prometheus One', base: 'dark' \}/);
for (const section of ['system', 'heartbeat', 'search', 'credentials', 'security', 'models', 'agents', 'channels', 'integrations']) {
  assert.match(settingsSurface, new RegExp(`id: '${section}'`), `Mobile V2 Settings must expose the canonical ${section} section.`);
}
assert.match(settingsSurface, /api\?\.request|activeSettingsApi\.request/, 'Settings actions must use an injected gateway client.');
assert.match(settingsPage, /const gateway = gateways\.active/, 'Settings must capture the active V2 gateway target.');
assert.match(settingsPage, /api: gateway/, 'Canonical settings controls must receive the target-aware V2 gateway client.');

console.log('mobile-v2 integration regression: ok');
