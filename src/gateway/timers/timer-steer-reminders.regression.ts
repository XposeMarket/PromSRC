import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolated data dir: never touch the real timers.json or chat sessions.
delete process.env.PROMETHEUS_RUNTIME_DIR;
delete process.env.PROMETHEUS_STORAGE_LAYOUT;
delete process.env.PROMETHEUS_APP_DATA_DIR;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-timer-steer-'));
process.env.PROMETHEUS_DATA_DIR = tempRoot;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(tempRoot, 'workspace');
fs.mkdirSync(process.env.PROMETHEUS_WORKSPACE_DIR, { recursive: true });

async function waitFor(test: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!test()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function main(): Promise<void> {
  const store = await import('./timer-store');
  const { MainChatTimerRunner } = await import('./timer-runner');
  const registry = await import('../live-runtime-registry');
  const { buildChatSteerContextBlock } = await import('../routes/chat/voice/narrator');

  const past = () => new Date(Date.now() - 1000);
  const statusOf = (id: string) => store.listMainChatTimers({ includeDone: true }).find((t) => t.id === id)?.status;

  type Harness = {
    runner: InstanceType<typeof MainChatTimerRunner>;
    turns: string[];
    steers: any[];
    reminders: Array<{ sessionId: string; message: any }>;
    pushes: string[];
    events: any[];
    consume: (ids: string[]) => void;
    runtimeActive: { value: boolean };
  };

  function harness(opts: { steerable?: boolean; steerOk?: boolean } = {}): Harness {
    const h: any = { turns: [], steers: [], reminders: [], pushes: [], events: [], runtimeActive: { value: true } };
    let listener: ((ids: string[]) => void) | null = null;
    let steerCount = 0;
    h.runner = new MainChatTimerRunner({
      runInteractiveTurn: async (message: string) => { h.turns.push(message); return { type: 'final', text: 'did it' }; },
      hasSteerableTurn: () => opts.steerable === true,
      steerActiveTurn: (request) => {
        h.steers.push(request);
        steerCount += 1;
        return opts.steerOk === false
          ? { ok: false, error: 'No active steerable chat turn for this session.' }
          : { ok: true, eventId: `ev_${steerCount}`, runtimeId: 'rt_1' };
      },
      isRuntimeActive: () => h.runtimeActive.value,
      onSteersDelivered: (fn) => { listener = fn; return () => { listener = null; }; },
      postReminder: (sessionId, message) => { h.reminders.push({ sessionId, message }); },
      pushReminder: (_timer, text) => { h.pushes.push(text); },
      broadcast: (payload) => { h.events.push(payload); },
    });
    h.runner.subscribeSteerReads();
    h.consume = (ids: string[]) => listener?.(ids);
    return h as Harness;
  }

  // 1. Mode parsing and storage stay inside the existing `delivery` record.
  assert.equal(store.parseMainChatTimerModeArg(undefined), undefined);
  assert.equal(store.parseMainChatTimerModeArg('notify'), 'notify');
  assert.equal(store.parseMainChatTimerModeArg('Reminder'), 'notify');
  assert.equal(store.parseMainChatTimerModeArg('run'), 'run');
  assert.equal(store.parseMainChatTimerModeArg('bogus'), null);
  assert.deepEqual(store.withMainChatTimerMode({ telegram: true }, 'notify'), { telegram: true, mode: 'notify' });
  assert.deepEqual(store.withMainChatTimerMode({ telegram: true, mode: 'notify' }, 'run'), { telegram: true });
  assert.equal(store.withMainChatTimerMode({ mode: 'notify' }, 'run'), undefined);
  assert.equal(store.getMainChatTimerMode({ delivery: undefined }), 'run');

  // 2. notify: posts + pushes, never calls the model, even while a turn is running.
  {
    const h = harness({ steerable: true });
    const t = store.createMainChatTimer({ sessionId: 'chat_notify', instruction: 'Call mom', dueAt: past(), delivery: { mode: 'notify' } });
    await h.runner.tick();
    assert.equal(statusOf(t.id), 'completed');
    assert.equal(h.turns.length, 0, 'a reminder must not start a model turn');
    assert.equal(h.steers.length, 0, 'a reminder must not steer the running turn');
    assert.equal(h.reminders.length, 1);
    assert.equal(h.reminders[0].message.content, '⏰ Reminder: Call mom');
    assert.equal(h.reminders[0].message.messageId, `timer-reminder:${t.id}`);
    await waitFor(() => h.pushes.length === 1, 'reminder push');
    assert.ok(h.events.some((e) => e.type === 'timer_done' && e.delivery === 'notify' && e.timerId === t.id));
    h.runner.dispose();
  }

  // 3. run + turn running: steered, stays `running` until read, then completed. No second turn.
  {
    const h = harness({ steerable: true });
    const t = store.createMainChatTimer({ sessionId: 'chat_steer', instruction: 'Check the build', dueAt: past() });
    await h.runner.tick();
    assert.equal(h.steers.length, 1);
    assert.match(h.steers[0].message, /Check the build/);
    assert.match(h.steers[0].displayMessage, /^⏰ Timer: Check the build/);
    assert.equal(statusOf(t.id), 'running', 'queued is not delivered: stay running until the turn reads it');
    assert.deepEqual(h.runner.listSteeredTimerIds(), [t.id]);
    await h.runner.tick();
    assert.equal(h.steers.length, 1, 'a steered timer is not steered again');
    h.consume(['ev_1']);
    assert.equal(statusOf(t.id), 'completed');
    assert.equal(h.turns.length, 0, 'a steered timer must not also run its own turn');
    assert.ok(h.events.some((e) => e.type === 'timer_done' && e.delivery === 'live_steer'));
    h.runner.dispose();
  }

  // 4. Steered but the turn ended before reading it: falls back to its own turn.
  {
    const h = harness({ steerable: true });
    const t = store.createMainChatTimer({ sessionId: 'chat_unread', instruction: 'Ping me', dueAt: past() });
    await h.runner.tick();
    assert.equal(statusOf(t.id), 'running');
    h.runtimeActive.value = false;
    await h.runner.tick();
    await waitFor(() => statusOf(t.id) === 'completed', 'fallback turn to finish');
    assert.equal(h.turns.length, 1);
    assert.match(h.turns[0], /^\[Timer fired\]/);
    assert.ok(h.events.some((e) => e.type === 'timer_waiting' && e.reason === 'turn_ended_before_reading_timer'));
    h.runner.dispose();
  }

  // 5. Steer refused after the check (turn just ended): claim released, runs as its own turn.
  {
    const h = harness({ steerable: true, steerOk: false });
    const t = store.createMainChatTimer({ sessionId: 'chat_refused', instruction: 'Look again', dueAt: past() });
    await h.runner.tick();
    await waitFor(() => statusOf(t.id) === 'completed', 'separate turn after refused steer');
    assert.equal(h.steers.length, 1);
    assert.equal(h.turns.length, 1);
    h.runner.dispose();
  }

  // 6. No turn running: unchanged separate-turn behavior. Telegram timers never steer.
  {
    const idle = harness({ steerable: false });
    const t = store.createMainChatTimer({ sessionId: 'chat_idle', instruction: 'Summarize', dueAt: past() });
    await idle.runner.tick();
    await waitFor(() => statusOf(t.id) === 'completed', 'idle separate turn');
    assert.equal(idle.steers.length, 0);
    assert.equal(idle.turns.length, 1);
    idle.runner.dispose();

    const busy = harness({ steerable: true });
    const tg = store.createMainChatTimer({ sessionId: 'chat_tg', instruction: 'Report', dueAt: past(), delivery: { telegram: true } });
    await busy.runner.tick();
    await waitFor(() => statusOf(tg.id) === 'completed', 'telegram timer turn');
    assert.equal(busy.steers.length, 0, 'telegram delivery needs the timer\'s own reply text');
    assert.equal(busy.turns.length, 1);
    busy.runner.dispose();
  }

  // 7. Without a steer dependency every run timer keeps the separate-turn path.
  {
    const turns: string[] = [];
    const runner = new MainChatTimerRunner({
      runInteractiveTurn: async (message: string) => { turns.push(message); return { type: 'final', text: 'ok' }; },
      hasSteerableTurn: () => true,
      broadcast: () => {},
    });
    const t = store.createMainChatTimer({ sessionId: 'chat_nowire', instruction: 'Do it', dueAt: past() });
    await runner.tick();
    await waitFor(() => statusOf(t.id) === 'completed', 'unwired separate turn');
    assert.equal(turns.length, 1);
  }

  // 7b. Warm handoff: stop() halts scheduling but a draining gateway still
  //     records delivery of timers already folded into its running turn.
  {
    const h = harness({ steerable: true });
    const t = store.createMainChatTimer({ sessionId: 'chat_drain', instruction: 'Finish up', dueAt: past() });
    await h.runner.tick();
    assert.equal(statusOf(t.id), 'running');
    h.runner.stop();
    h.consume(['ev_1']);
    assert.equal(statusOf(t.id), 'completed', 'stop() must keep the delivery listener');
    h.runner.dispose();
  }

  // 8. Dequeuing is not delivery: observers hear only markRuntimeSteersDelivered.
  {
    const runtimeId = registry.registerLiveRuntime({ kind: 'main_chat', sessionId: 'chat_registry', label: 'test turn' } as any);
    const seen: string[] = [];
    const unsubscribe = registry.onRuntimeSteersDelivered((events) => { for (const e of events) seen.push(`${e.id}:${e.kind}`); });
    const queued = registry.addPendingRuntimeSteerForSession('chat_registry', { message: 'User asked earlier: x', source: 'timer', kind: 'timer_fired' });
    assert.ok(queued.ok && queued.event, 'steer queued on the running main-chat runtime');
    const consumed = registry.consumePendingRuntimeSteersForSession('chat_registry', 16);
    assert.equal(consumed.length, 1);
    assert.deepEqual(seen, [], 'taking a steer from the inbox must not count as delivery');
    registry.markRuntimeSteersDelivered(consumed);
    assert.deepEqual(seen, [`${queued.event!.id}:timer_fired`]);
    unsubscribe();
    registry.markRuntimeSteersDelivered(consumed);
    assert.equal(seen.length, 1);
    // The chat turn acknowledges only after a provider call returns, never on Stop.
    const handleChatSource = fs.readFileSync(path.join(process.cwd(), 'src/gateway/routes/chat/pipeline/handle-chat.ts'), 'utf8');
    assert.match(handleChatSource, /undeliveredChatSteers\.push\(\.\.\.steers\)/);
    assert.match(handleChatSource, /if \(!abortSignal\?\.aborted && undeliveredChatSteers\.length\) \{\s*markRuntimeSteersDelivered\(undeliveredChatSteers\.splice\(0\)\);/);
    assert.ok(
      handleChatSource.indexOf('markRuntimeSteersDelivered(undeliveredChatSteers') > handleChatSource.indexOf('const result = await generationPromise;'),
      'delivery is acknowledged after the provider call returns',
    );
    try { registry.finishLiveRuntime(runtimeId); } catch { /* best effort */ }
  }

  // 9. The model sees a timer framing, not a user course-correction.
  {
    const block = buildChatSteerContextBlock({
      id: 'ev', sessionId: 's', message: 'User asked earlier: Check the build', createdAt: Date.now(),
      kind: 'timer_fired', contextSummary: 'Timer "build" (timer_x), scheduled for now.',
    });
    assert.match(block, /^\[TIMER FIRED\]/);
    assert.match(block, /Check the build/);
    assert.doesNotMatch(block, /LIVE CHAT STEER/);
  }

  console.log('timer-steer-reminders regression: ok');
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
