import assert from 'node:assert/strict';
import { responseEtag, slimSessionList, slimSkillList } from './perf-projections';

const session = { id: 'web_fixture', title: 'Sample', channel: 'web', createdAt: 1, lastActiveAt: 2,
  pinnedAt: 3, sidebarOrder: 4, activeRun: false, settled: false, preview: 'hello', mobileUnread: true,
  history: [{ content: 'private'.repeat(2000) }], mainChatGoal: { status: 'running', large: 'x'.repeat(10000) } };
const full = { sessions: [session], total: 1 };
const compact = slimSessionList(full);
assert.deepEqual(compact.sessions[0].id, session.id);
for (const field of ['title', 'channel', 'createdAt', 'lastActiveAt', 'pinnedAt', 'sidebarOrder', 'activeRun', 'settled', 'preview', 'mobileUnread'] as const)
  assert.equal(compact.sessions[0][field], (session as Record<string, unknown>)[field], field);
assert.equal(compact.sessions[0].history, undefined);
assert.ok(Buffer.byteLength(JSON.stringify(compact)) < 700);
assert.equal(full.sessions[0].history[0].content.length, 14000, '?full=1 must retain original data');
assert.equal(responseEtag(compact), responseEtag(slimSessionList(full)));
assert.notEqual(responseEtag(compact), responseEtag(full));
const skill = { id: 'test', name: 'Test', description: 'brief', categories: ['test'], version: '1',
  status: 'active', triggers: ['x'.repeat(5000)], promptSignals: ['secret'], resources: ['large'] };
const list = slimSkillList([skill]);
assert.equal(list[0].id, skill.id);
assert.deepEqual(list[0].categories, skill.categories);
assert.equal(list[0].status, skill.status);
assert.equal(list[0].triggers, undefined);
assert.ok(Buffer.byteLength(JSON.stringify(list)) < 350);
assert.ok(skill.triggers.length, '?full=1 must retain full fields');
console.log('[perf-projections] summary fields, bounds, full projection and ETags passed');
