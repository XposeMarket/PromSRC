import assert from 'assert';
import { buildNeedsYouItems } from './needs-you';

// Regression for the aggregator contract: every normalized item carries the fields the Tasks
// page and the mobile card rely on, and resolved/answered live records drop out of the list.
const now = new Date('2026-10-08T12:00:00.000Z').getTime();
const items = buildNeedsYouItems({
  questions: [
    { id: 'q-open', sessionId: 'chat-q', status: 'pending', createdAt: new Date(now).toISOString(), originLabel: 'Research agent' },
    { id: 'q-answered', sessionId: 'chat-q2', status: 'answered', createdAt: new Date(now).toISOString() },
  ],
  approvals: [
    { id: 'ap-open', sessionId: 'chat-ap', status: 'pending', createdAt: new Date(now - 1000).toISOString(), toolName: 'run_command' },
    { id: 'ap-done', sessionId: 'chat-ap2', status: 'approved', createdAt: new Date(now - 2000).toISOString() },
  ],
  tasks: [
    { id: 'task-paused', title: 'Paused run', originatingSessionId: 'chat-task', status: 'needs_assistance', pauseReason: 'awaiting_user_input', startedAt: now - 3000 },
    { id: 'task-running', title: 'Running run', originatingSessionId: 'chat-run', status: 'running', startedAt: now - 4000 },
  ],
});

for (const item of items) {
  assert.ok(item.id, 'id present');
  assert.ok(item.kind, 'kind present');
  assert.strictEqual(typeof item.sessionId, 'string', 'sessionId is a string for the thread link');
  assert.ok(!Number.isNaN(Date.parse(item.createdAt)), `createdAt is ISO: ${item.createdAt}`);
  assert.ok(item.payload && typeof item.payload === 'object', 'payload object');
}

const ids = new Set(items.map((item) => item.id));
assert.deepStrictEqual(ids, new Set(['question:q-open', 'approval:ap-open', 'task:task-paused']));
assert.ok(!ids.has('question:q-answered'), 'answered question removed');
assert.ok(!ids.has('approval:ap-done'), 'approved approval removed');
assert.ok(!ids.has('task:task-running'), 'running task is not waiting on the user');

// Newest first: the question (now) sorts ahead of older approval/task rows.
assert.strictEqual(items[0].id, 'question:q-open');

console.log('needs-you collector regression: normalized fields present, resolved records excluded, newest first');
