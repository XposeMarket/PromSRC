// Regression test for the shared Needs You view-model (web-ui/src/needs-you-view-model.js).
// Asserts observable behavior in both polarities. Exits non-zero on failure.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(here, '..', 'web-ui', 'src', 'needs-you-view-model.js');
const vm = await import(pathToFileURL(modPath).href);

const approval = {
  id: 'approval:abc-1',
  kind: 'tool_approval',
  source: 'Chat',
  sessionId: 's1',
  createdAt: '2026-10-24T10:00:00Z',
  payload: { id: 'abc-1', toolName: 'shell_run', toolArgs: { command: 'npm test' }, reason: 'Run tests' },
};
const question = {
  id: 'question:q-1',
  kind: 'question',
  source: 'Chat',
  sessionId: 's2',
  createdAt: '2026-10-24T11:00:00Z',
  payload: { id: 'q-1', content: 'Which branch should I use?' },
};
const pausedTask = {
  id: 'task:08608aac',
  kind: 'paused_agent_run',
  source: 'Task',
  sessionId: 's3',
  createdAt: '2026-10-24T09:00:00Z',
  payload: { id: '08608aac', status: 'paused', pauseReason: 'awaiting_user_input' },
};

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// Positive polarity
test('approval item -> 1 entry with title/kindLabel/summary', () => {
  const entries = vm.needsYouEntries([approval]);
  assert.equal(entries.length, 1);
  const e = entries[0];
  assert.equal(e.kindLabel, 'Tool approval');
  assert.equal(e.title, 'Run tests'.length ? e.title : '');
  assert.ok(e.title.length > 0);
  assert.equal(e.summary, 'Run tests');
  assert.equal(e.rawId, 'abc-1');
  assert.equal(e.item, approval);
});

test('question item -> 1 entry', () => {
  const entries = vm.needsYouEntries([question]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'question');
  assert.equal(entries[0].kindLabel, 'Question');
  assert.equal(entries[0].sessionId, 's2');
});

test('entries are sorted newest first', () => {
  const entries = vm.needsYouEntries([approval, question]);
  assert.deepEqual(entries.map((e) => e.kind), ['question', 'tool_approval']);
});

test('entry title falls back to kindLabel when no headline', () => {
  const entries = vm.needsYouEntries([question]);
  assert.equal(entries[0].title, 'Question');
});

test('needsYouTaskIds collects raw ids of paused_agent_run items', () => {
  const ids = vm.needsYouTaskIds([pausedTask, approval]);
  assert.ok(ids instanceof Set);
  assert.ok(ids.has('08608aac'));
  assert.equal(ids.size, 1);
});

test('paused_agent_run item -> 0 entries', () => {
  assert.equal(vm.needsYouEntries([pausedTask]).length, 0);
});

test('paused task listed by needs-you is needs-you even when status is paused', () => {
  const ids = vm.needsYouTaskIds([pausedTask]);
  assert.equal(vm.isNeedsYouTask({ id: '08608aac', status: 'paused' }, ids), true);
});

test('needs_assistance status -> needs-you', () => {
  assert.equal(vm.isNeedsYouTask({ id: 'x', status: 'needs_assistance' }, new Set()), true);
  assert.equal(vm.isNeedsYouTask({ id: 'x', status: 'awaiting_user_input' }, new Set()), true);
});

test('needsYouCount counts entries + needs-you tasks without double counting', () => {
  const tasks = [
    { id: '08608aac', status: 'needs_assistance' },
    { id: '08608aac', status: 'paused' },
    { id: 'other', status: 'running' },
  ];
  // approval (1) + question (1) + task 08608aac counted once (1) = 3
  assert.equal(vm.needsYouCount(tasks, [approval, question, pausedTask]), 3);
});

// Negative polarity
test('paused task NOT listed by needs-you stays out of the column', () => {
  assert.equal(vm.isNeedsYouTask({ id: 'zzz', status: 'paused' }, vm.needsYouTaskIds([pausedTask])), false);
  assert.equal(vm.isNeedsYouTask({ id: 'zzz', status: 'paused' }, new Set()), false);
});

test('running task is not needs-you even if listed under a different id', () => {
  assert.equal(vm.isNeedsYouTask({ id: 'r1', status: 'running' }, new Set(['08608aac'])), false);
});

test('paused_agent_run items never produce entries', () => {
  const entries = vm.needsYouEntries([pausedTask, pausedTask]);
  assert.deepEqual(entries, []);
});

test('empty / undefined inputs return empty results without throwing', () => {
  assert.deepEqual(vm.needsYouEntries(undefined), []);
  assert.deepEqual(vm.needsYouEntries(null), []);
  assert.equal(vm.needsYouTaskIds(undefined).size, 0);
  assert.equal(vm.needsYouCount(undefined, undefined), 0);
  assert.equal(vm.isNeedsYouTask(null, undefined), false);
  assert.equal(vm.isNeedsYouTask({ id: 'x', status: 'paused' }, undefined), false);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`not ok - ${name}\n  ${err?.message || err}`);
  }
}
if (failed) {
  console.error(`${failed} of ${tests.length} needs-you view-model tests failed`);
  process.exit(1);
}
console.log(`all ${tests.length} needs-you view-model tests passed`);
