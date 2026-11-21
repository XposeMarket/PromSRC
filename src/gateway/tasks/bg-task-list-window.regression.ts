// Regression: /api/bg-tasks finished-history window (src/gateway/tasks/bg-task-list-window.ts)
// and its wiring in the route and both Tasks clients.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PlannedChatRunStore } from './planned-chat-runs';
import {
  MAX_FINISHED_BG_TASK_WINDOW,
  bgTaskMatchesQuery,
  isFinishedBgTaskStatus,
  parseBgTaskListWindow,
  windowBgTaskList,
} from './bg-task-list-window';

const root = path.resolve(__dirname, '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

// Parsing: opt-in only, clamped, query lowercased.
assert.equal(parseBgTaskListWindow({}), null, 'no ?finished keeps the legacy full list');
assert.equal(parseBgTaskListWindow({ finished: '' }), null);
assert.equal(parseBgTaskListWindow({ finished: 'abc' }), null);
assert.equal(parseBgTaskListWindow({ finished: '-3' }), null);
assert.deepEqual(parseBgTaskListWindow({ finished: '60' }), { finished: 60, query: '' });
assert.deepEqual(parseBgTaskListWindow({ finished: ['25', '99'], q: '  Deploy  ' }), { finished: 25, query: 'deploy' });
assert.equal(parseBgTaskListWindow({ finished: '999999' })!.finished, MAX_FINISHED_BG_TASK_WINDOW);
assert.equal(parseBgTaskListWindow({ finished: '0' })!.finished, 0);

for (const status of ['complete', 'completed', 'done', 'succeeded', 'failed', 'cancelled', ' Complete ']) {
  assert.equal(isFinishedBgTaskStatus(status), true, status);
}
for (const status of ['running', 'queued', 'paused', 'stalled', 'needs_assistance', 'awaiting_user_input', 'waiting_subagent', '']) {
  assert.equal(isFinishedBgTaskStatus(status), false, status);
}

// Newest-first fixture: 3 unfinished spread among 10 finished.
type Row = { id: string; status: string; title: string; plan?: any[]; runtimeProgress?: any };
const rows: Row[] = [
  { id: 'r1', status: 'running', title: 'Live job' },
  { id: 'f1', status: 'complete', title: 'Deploy site' },
  { id: 'f2', status: 'failed', title: 'Scrape prices' },
  { id: 'p1', status: 'paused', title: 'Paused job' },
  { id: 'f3', status: 'completed', title: 'Planned chat', runtimeProgress: { items: [{ text: 'deploy preview' }] } },
  { id: 'f4', status: 'cancelled', title: 'Stopped run' },
  { id: 'f5', status: 'complete', title: 'Brain dream' },
  { id: 'n1', status: 'needs_assistance', title: 'Needs Raul' },
  { id: 'f6', status: 'complete', title: 'Old thing', plan: [{ description: 'Deploy the old thing' }] },
  { id: 'f7', status: 'failed', title: 'Old failure' },
  { id: 'f8', status: 'complete', title: 'Older' },
  { id: 'f9', status: 'complete', title: 'Oldest' },
  { id: 'f10', status: 'done', title: 'Ancient' },
];
const ids = (items: Row[]) => items.map((row) => row.id);

{
  const { items, meta } = windowBgTaskList(rows, { finished: 3, query: '' }, (row) => row);
  assert.deepEqual(ids(items), ['r1', 'f1', 'f2', 'p1', 'f3', 'n1'], 'all unfinished + newest 3 finished, order kept');
  assert.equal(meta.finishedTotal, 10);
  assert.equal(meta.finishedMatched, 10);
  assert.equal(meta.finishedReturned, 3);
  assert.equal(meta.finishedWindow, 3);
  assert.equal(meta.hasMoreFinished, true);
  assert.deepEqual(meta.finishedCounts, { complete: 5, failed: 2, completed: 1, cancelled: 1, done: 1 });
  assert.equal('query' in meta, false);
}

{
  const { items, meta } = windowBgTaskList(rows, { finished: 50, query: '' }, (row) => row);
  assert.equal(items.length, rows.length, 'a window larger than history returns everything');
  assert.equal(meta.hasMoreFinished, false);
  assert.equal(meta.finishedReturned, 10);
}

{
  const { items, meta } = windowBgTaskList(rows, { finished: 0, query: '' }, (row) => row);
  assert.deepEqual(ids(items), ['r1', 'p1', 'n1'], 'finished=0 sends only unfinished work');
  assert.equal(meta.hasMoreFinished, true);
  assert.equal(meta.finishedTotal, 10);
}

{
  // Search covers every finished row (title, plan, progress), counts stay global.
  const { items, meta } = windowBgTaskList(rows, { finished: 500, query: 'deploy' }, (row) => row);
  assert.deepEqual(ids(items), ['r1', 'f1', 'p1', 'f3', 'n1', 'f6'], 'unfinished always kept; finished filtered by query');
  assert.equal(meta.finishedMatched, 3);
  assert.equal(meta.finishedTotal, 10);
  assert.equal(meta.query, 'deploy');
  assert.equal(meta.hasMoreFinished, false);
}

{
  const { meta } = windowBgTaskList(rows, { finished: 1, query: 'deploy' }, (row) => row);
  assert.equal(meta.finishedReturned, 1);
  assert.equal(meta.hasMoreFinished, true, 'more matches than the window');
}

// The view mapper is honored (the route windows {task, planned} entries).
{
  const entries = rows.map((task, index) => ({ task, planned: index % 2 === 0 }));
  const { items } = windowBgTaskList(entries, { finished: 2, query: '' }, (entry) => entry.task);
  assert.deepEqual(items.map((entry) => entry.task.id), ['r1', 'f1', 'f2', 'p1', 'n1']);
}

assert.equal(bgTaskMatchesQuery({ title: 'Hello', channel: 'telegram' }, 'tele'), true);
assert.equal(bgTaskMatchesQuery({ title: 'Hello', brainDate: '2026-11-21' }, '2026-11'), true);
assert.equal(bgTaskMatchesQuery({ title: 'Hello' }, 'nope'), false);
assert.equal(bgTaskMatchesQuery({ title: 'Hello' }, ''), true);

// Route: windows before projecting, keeps the legacy full list without ?finished.
{
  const route = read('src/gateway/routes/tasks.router.ts');
  const start = route.indexOf("router.get('/api/bg-tasks', ");
  const handler = route.slice(start, route.indexOf('\n});\n', start));
  assert.ok(start >= 0, 'route found');
  assert.match(handler, /parseBgTaskListWindow\(req\.query/);
  assert.ok(handler.indexOf('windowBgTaskList(') < handler.indexOf('projectBgTaskRow('), 'window before projection');
  assert.match(handler, /windowed \? windowed\.items : entries/);
  assert.match(handler, /\.\.\.\(windowed \? windowed\.meta : \{\}\)/);
}

// Clients opt in and read the totals.
{
  const desktop = read('web-ui/src/pages/TasksPage.js');
  assert.match(desktop, /\/api\/bg-tasks\?finished=\$\{finishedWindow\}/);
  assert.match(desktop, /&q=\$\{encodeURIComponent\(serverQuery\)\}/);
  assert.match(desktop, /bgtListMeta = typeof value\.finishedTotal === 'number'/);
  assert.match(desktop, /window\.bgtLoadOlderTasks = bgtLoadOlderTasks/);
  const mobileApi = read('web-ui/src/mobile/mobile-api.js');
  assert.match(mobileApi, /\/api\/bg-tasks\?mobile=1&finished=\$\{requested\}/);
  assert.match(mobileApi, /_saveMobilePageData\('tasks-meta'/);
  const mobilePage = read('web-ui/src/mobile/mobile-tasks-pages.js');
  assert.match(mobilePage, /loadBgTasks\(\{ force, finished: finishedWindow \}\)/);
  assert.match(mobilePage, /serverFinishedCounts && _pmIsFinishedStatus\(t\.status\)/);
  // The finished-status sets on both clients match the gateway's.
  const gatewaySet = read('src/gateway/tasks/bg-task-list-window.ts').match(/new Set\(\[\s*([^\]]+)\]\)/)![1].replace(/\s+/g, ' ').trim();
  for (const [name, source] of [['desktop', desktop], ['mobile', mobilePage]] as const) {
    const clientSet = source.match(/FINISHED(?:_TASK)?_STATUSES = new Set\(\[([^\]]+)\]\)/)![1].replace(/\s+/g, ' ').trim();
    assert.equal(clientSet.replace(/,\s*$/, ''), gatewaySet.replace(/,\s*$/, ''), `${name} finished statuses match the gateway`);
  }
}

// Planned-run list cache: no file re-reads while nothing changed; own writes, other processes'
// writes (a second store on the same folder) and the max age all refresh it.
async function plannedRunCacheChecks() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-window-planned-'));
  const runs = path.join(dir, 'runs');
  const progress = { source: 'declared', taskSummary: 'Plan', activeIndex: 0, items: [{ text: 'Build', status: 'in_progress' }, { text: 'Test', status: 'pending' }] };
  const fsModule = require('fs');
  const originalRead = fsModule.readFileSync;
  const realNow = Date.now;
  let reads = 0;
  fsModule.readFileSync = function patchedRead(this: unknown, ...args: any[]) {
    if (String(args[0]).startsWith(runs)) reads += 1;
    return originalRead.apply(this, args as any);
  };
  try {
    const owner = new PlannedChatRunStore(runs);
    const other = new PlannedChatRunStore(runs, 4242, () => true);
    const live = new Set(['one', 'two', 'three']);
    await owner.progress('one', 's1', progress, '');
    await owner.progress('two', 's2', progress, '');
    assert.equal(owner.list(live).length, 2);
    reads = 0;
    assert.equal(owner.list(live).length, 2);
    assert.equal(owner.list(live).length, 2);
    assert.equal(reads, 0, 'unchanged folder: planned runs are not re-read');

    await owner.progress('three', 's3', progress, '');
    assert.equal(owner.list(live).length, 3, 'own write refreshes the cache');

    assert.equal(other.list(new Set()).length, 3);
    await owner.finish('one', 'cancelled');
    assert.equal(other.list(new Set()).find((row: any) => row.runtimeId === 'one')?.status, 'cancelled', 'another process\'s write is seen');

    owner.list(live); // first read after its own write refreshes
    reads = 0;
    owner.list(live);
    assert.equal(reads, 0, 'warm again');
    Date.now = () => realNow() + 11_000;
    owner.list(live);
    assert.ok(reads > 0, 'max age forces a re-read');
  } finally {
    Date.now = realNow;
    fsModule.readFileSync = originalRead;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

plannedRunCacheChecks().then(() => {
  console.log('bg-task list window + planned-run cache: all checks passed');
}, (error) => {
  console.error(error);
  process.exit(1);
});
