import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PlannedChatRunStore, PLANNED_ACTIVITY_MAX, plannedActivityFromSse, applyPlannedItemTiming } from './planned-chat-runs';
import { buildScheduledTaskPlan, finalizeScheduledPlanSteps } from '../scheduling/scheduled-task-plan';

const SYNC_FS = ['readFileSync', 'writeFileSync', 'renameSync', 'mkdirSync', 'unlinkSync', 'readdirSync', 'existsSync', 'statSync'] as const;

/** Run fn while counting any synchronous fs call made through the shared fs module. */
function countSyncFsCalls(fn: () => void): number {
  let calls = 0;
  const originals: Record<string, any> = {};
  for (const name of SYNC_FS) {
    originals[name] = (fs as any)[name];
    (fs as any)[name] = (...args: any[]) => { calls++; return originals[name](...args); };
  }
  try { fn(); } finally { for (const name of SYNC_FS) (fs as any)[name] = originals[name]; }
  return calls;
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'planned-live-cards-'));
  const realNow = Date.now;
  let clock = 1_000_000;
  Date.now = () => clock;
  try {
    const store = new PlannedChatRunStore(path.join(dir, 'runs'));
    const progress = (statuses: string[]) => ({ source: 'declared', taskSummary: 'Ship it', activeIndex: 0, items: statuses.map((status, i) => ({ text: `Step ${i + 1}`, status })) });

    // originPrompt set once
    await store.progress('r1', 's1', progress(['in_progress', 'pending']), 'fallback', undefined, 'first user message');
    clock += 1000;
    await store.progress('r1', 's1', progress(['completed', 'in_progress']), 'fallback', undefined, 'later message must not win');
    let row = store.get('r1')!;
    assert.equal(row.originPrompt, 'first user message');
    const long = new PlannedChatRunStore(path.join(dir, 'long'));
    await long.progress('x', 's', progress(['pending', 'pending']), '', undefined, 'y'.repeat(9000));
    assert.equal(long.get('x')!.originPrompt!.length, 4000);
    console.log('PASS originPrompt set once and capped');

    // step timing transitions
    assert.equal(row.runtimeProgress.items[0].startedAt, 1_000_000);
    assert.equal(row.runtimeProgress.items[0].completedAt, 1_001_000);
    assert.equal(row.runtimeProgress.items[1].startedAt, 1_001_000);
    assert.equal(row.runtimeProgress.items[1].completedAt, undefined);
    clock += 5000;
    await store.progress('r1', 's1', progress(['completed', 'in_progress']), '');
    row = store.get('r1')!;
    assert.equal(row.runtimeProgress.items[0].completedAt, 1_001_000, 'timestamps preserved across updates');
    assert.equal(row.runtimeProgress.items[1].startedAt, 1_001_000);
    const timed = applyPlannedItemTiming([{ text: 'a', status: 'pending' }], [{ text: 'a', status: 'in_progress', startedAt: 5 }], 9);
    assert.equal(timed[0].completedAt, undefined);
    console.log('PASS per-step timing transitions');

    // inside the throttle window: hook is in-memory only; finish drains the queue
    store.setActivityFlushMs(1500);
    clock += 100;
    const insideSync = countSyncFsCalls(() => {
      for (let i = 0; i < 60; i++) store.activity('r1', { t: clock, kind: 'tool', name: `tool_${i}` });
    });
    assert.equal(insideSync, 0, 'activity hook performs no synchronous fs calls');
    assert.equal(store.get('r1')!.activity, undefined, 'queued activity is not persisted until flush/finish');
    await store.finish('r1', 'completed');
    row = store.get('r1')!;
    assert.equal(row.activity!.length, PLANNED_ACTIVITY_MAX, 'ring capped at 40');
    assert.equal(row.activity![row.activity!.length - 1].name, 'tool_59');
    assert.equal(row.status, 'completed');
    assert.ok(row.runtimeProgress.items[1].completedAt, 'finishing completed closes the active step');
    store.activity('r1', { t: clock, kind: 'tool', name: 'late' });
    await store.flushActivity('r1');
    assert.equal(store.get('r1')!.activity!.length, PLANNED_ACTIVITY_MAX, 'no writes after finish');
    store.activity('unknown-runtime', { t: clock, kind: 'tool', name: 'x' });
    await store.flushActivity('unknown-runtime');
    assert.equal(store.get('unknown-runtime'), undefined, 'unplanned chats never create records');
    console.log('PASS activity ring cap, in-memory hook, finish drains queue');

    // outside the throttle window: hook performs no sync fs; awaited flush persists
    clock += 10_000;
    await store.progress('r2', 's2', progress(['in_progress', 'pending']), '', undefined, 'hi');
    clock += 2000;
    const outsideSync = countSyncFsCalls(() => {
      store.activity('r2', { t: clock, kind: 'tool', name: 'immediate' });
    });
    assert.equal(outsideSync, 0, 'outside the throttle window the SSE hook performs no synchronous fs calls');
    await store.flushActivity('r2');
    assert.equal(store.get('r2')!.activity!.length, 1, 'awaited flush persists queued activity');
    console.log('PASS outside-window activity is nonblocking and persists after flush');

    // finish after queued (unflushed) activity: terminal state AND activity present
    clock += 100;
    store.activity('r2', { t: clock, kind: 'tool', name: 'queued_before_finish' });
    await store.finish('r2', 'failed');
    const failed = store.get('r2')!;
    assert.equal(failed.status, 'failed');
    assert.equal(failed.activity!.length, 2);
    assert.equal(failed.activity![1].name, 'queued_before_finish');
    console.log('PASS finish after queued activity keeps terminal state and activity');

    // finished-run guard: a resume held on its source read must not resurrect the run after finish
    {
      const gs = new PlannedChatRunStore(path.join(dir, 'guard'));
      await gs.progress('src', 'sg', progress(['in_progress', 'pending']), 'Guard', undefined, 'origin');
      const readThrough = (gs as any).readAsync.bind(gs);
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      (gs as any).readAsync = async (id: string) => { if (id === 'src') await gate; return readThrough(id); };
      const resumed = gs.resume('src', 'dst', 'sg');
      const finished = gs.finish('dst', 'completed'); // queued behind the held resume, not awaited before release
      release();
      await Promise.all([resumed, finished]);
      assert.equal(gs.get('dst')!.status, 'completed', 'held resume must not leave a running record after finish');
      await gs.progress('dst', 'sg', progress(['in_progress', 'pending']), 'late');
      await gs.resume('src', 'dst', 'sg');
      gs.activity('dst', { t: clock, kind: 'tool', name: 'late' });
      await gs.flushActivity('dst');
      assert.equal(gs.get('dst')!.status, 'completed', 'late progress/resume after finish is a no-op');
      assert.equal(gs.get('dst')!.activity, undefined, 'late activity after finish is ignored');
      console.log('PASS finished-run guard: held resume cannot resurrect a completed run');
    }


    // SSE mapping
    assert.deepEqual(plannedActivityFromSse('tool_call', { action: 'web_search', args: { q: 'x' } }, 5), { t: 5, kind: 'tool', name: 'web_search', detail: '{"q":"x"}' });
    assert.equal(plannedActivityFromSse('tool_result', { action: 'a', result: 'bad', error: true }, 5)!.kind, 'error');
    assert.equal(plannedActivityFromSse('token', { text: 'x' }), undefined);
    assert.ok((plannedActivityFromSse('tool_result', { action: 'a', result: 'z'.repeat(999) })!.detail || '').length <= 200);
    console.log('PASS SSE activity mapping');

    // resume carries origin/activity/timing
    await store.resume('r2', 'r3', 's2');
    const resumed = store.get('r3')!;
    assert.equal(resumed.originPrompt, 'hi'); assert.equal(resumed.activity!.length, 2);
    assert.equal(resumed.runtimeProgress.items[0].startedAt, store.get('r2')!.runtimeProgress.items[0].startedAt);
    console.log('PASS resume preserves origin, activity and timing');

    // list stays compact; old records without new fields still list
    const listed = store.list(new Set(['r3'])).find((r: any) => r.runtimeId === 'r3') as any;
    assert.equal(listed.activity, undefined); assert.equal(listed.originPrompt, undefined);
    assert.equal(listed.originalAssignment, 'hi'); assert.equal(listed.lastToolCall.name, 'queued_before_finish');
    const oldDir = path.join(dir, 'old');
    fs.mkdirSync(oldDir, { recursive: true });
    const oldStore = new PlannedChatRunStore(oldDir);
    await oldStore.progress('seed', 'so', progress(['pending', 'pending']), '');
    const seedFile = fs.readdirSync(oldDir).find(name => name.endsWith('.json'))!;
    const legacy = JSON.parse(fs.readFileSync(path.join(oldDir, seedFile), 'utf8'));
    delete legacy.originPrompt; delete legacy.activity;
    legacy.runtimeProgress.items = legacy.runtimeProgress.items.map((i: any) => ({ text: i.text, status: i.status }));
    fs.writeFileSync(path.join(oldDir, seedFile), JSON.stringify(legacy));
    const oldRows = new PlannedChatRunStore(oldDir).list(new Set()) as any[];
    assert.equal(oldRows.length, 1); assert.equal(oldRows[0].activityCount, 0); assert.equal(oldRows[0].originalAssignment, undefined);
    console.log('PASS old records without new fields');

    // scheduled plan ordering + completion
    const plan = buildScheduledTaskPlan({ prompt: 'Read first source-preferences.md, collect from browser, search targeted, save both output files, then verify completion.' });
    const names = plan.map(s => s.description);
    assert.match(names[0], /^Prepare/);
    assert.equal(names[names.length - 1], 'Deliver the final scheduled-task result');
    assert.equal(names[names.length - 2], 'Verify outputs and record completion or blockers');
    assert.equal(names[names.length - 3], 'Execute the scheduled prompt');
    assert.ok(names.indexOf('Write the required workspace output files') < names.indexOf('Execute the scheduled prompt'));
    assert.deepEqual(buildScheduledTaskPlan({ prompt: 'say hi' }).map(s => s.description), ['Prepare scheduled run context and activate required tools', 'Execute the scheduled prompt', 'Deliver the final scheduled-task result']);
    const started = plan.map((s, i) => ({ ...s, status: i === 0 ? 'done' as const : i === 1 ? 'running' as const : 'pending' as const }));
    const ok = finalizeScheduledPlanSteps(started, true, 'All good', 42);
    assert.ok(ok.every(s => s.status === 'done'), 'success completes every open step');
    assert.equal(ok[ok.length - 1].notes, 'All good');
    const bad = finalizeScheduledPlanSteps(started, false, 'ERROR: x', 42);
    assert.equal(bad[1].status, 'failed');
    assert.ok(bad.slice(2).every(s => s.status === 'pending'), 'failure leaves remaining steps pending');
    assert.equal(started[1].status, 'running', 'input not mutated');
    console.log('PASS scheduled plan ordering + finalize');
  } finally {
    Date.now = realNow;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exit(1); });
