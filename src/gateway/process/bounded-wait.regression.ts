import assert from 'node:assert/strict';
import { boundedProcessWait, processWaitBudget, type WaitClock } from './bounded-wait';
import { CompletionObservers } from './completion-observers';

class Clock implements WaitClock {
  time = 0;
  jobs = new Map<object, { fn: () => void; at: number; repeat: number }>();
  now = () => this.time;
  after = (fn: () => void, ms: number) => { const h = {}; this.jobs.set(h, { fn, at: this.time + ms, repeat: 0 }); return h; };
  every = (fn: () => void, ms: number) => { const h = {}; this.jobs.set(h, { fn, at: this.time + ms, repeat: ms }); return h; };
  clear = (h: unknown) => { this.jobs.delete(h as object); };
  async tick(ms: number) {
    const end = this.time + ms;
    for (;;) {
      const next = [...this.jobs].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      const [h, job] = next; this.time = job.at;
      if (job.repeat) job.at += job.repeat; else this.jobs.delete(h);
      job.fn(); await Promise.resolve(); await Promise.resolve();
    }
    this.time = end;
  }
}
async function main() {
  for (const [raw, expected] of [[undefined, 10000], [NaN, 10000], [Infinity, 10000], [0, 1000], [-1, 1000], [1000, 1000], [300000, 300000], [900000, 300000]]) assert.equal(processWaitBudget(raw), expected);
  let complete!: (value: string | null) => void;
  let detached = 0; let progress = 0;
  const clock = new Clock();
  const p = boundedProcessWait<string>({ timeoutMs: 300000, subscribe: (fn) => { complete = fn; return () => { detached++; }; }, onProgress: () => { progress++; } }, clock);
  await clock.tick(31000); assert.equal(detached, 0); assert.equal(progress, 2);
  complete('finalized output'); assert.deepEqual(await p, { kind: 'completed', value: 'finalized output' }); assert.equal(detached, 1); assert.equal(clock.jobs.size, 0);
  for (const native of [false, true]) {
    const c = new Clock(); const controller = new AbortController(); const token = { aborted: false, ...(native ? { signal: controller.signal } : {}) };
    let subscribed = 0;
    const wait = boundedProcessWait({ timeoutMs: 300000, cancellation: token, subscribe: () => { subscribed++; return () => { subscribed--; }; } }, c);
    if (native) controller.abort(); else token.aborted = true;
    await c.tick(100); assert.equal((await wait).kind, 'cancelled'); assert.equal(subscribed, 0); assert.equal(c.jobs.size, 0);
    const pre = await boundedProcessWait({ cancellation: token, subscribe: () => { throw Error('must not subscribe'); } }, c);
    assert.equal(pre.kind, 'cancelled');
  }
  const deadlineClock = new Clock();
  const timed = boundedProcessWait({ timeoutMs: 300000, subscribe: () => () => {}, onProgress: () => { throw Error('transport gone'); } }, deadlineClock);
  await deadlineClock.tick(300000); assert.equal((await timed).kind, 'deadline'); assert.equal(deadlineClock.jobs.size, 0);
  for (const failure of ['null', 'throw', 'reject']) {
    const c = new Clock();
    const wait = boundedProcessWait({ subscribe: (done, fail) => { if (failure === 'throw') throw Error('failure'); if (failure === 'reject') fail(Error('failure')); else done(null); return () => {}; } }, c);
    if (failure === 'null') assert.equal((await wait).kind, 'unavailable'); else await assert.rejects(wait, /failure/);
    assert.equal(c.jobs.size, 0);
  }
  // Repeated deadlines detach callbacks while only one run-lifetime promise is observed.
  const observers = new CompletionObservers<string>(); const key = {}; let resolve!: (v: string) => void;
  let waitCalls = 0; let staleCalls = 0;
  const completion = new Promise<string>((r) => { resolve = r; });
  for (let i = 0; i < 100; i++) { const off = observers.subscribe(key, () => { waitCalls++; return completion; }, () => { staleCalls++; }, () => {}); off(); }
  await Promise.resolve(); assert.equal(waitCalls, 1);
  const entry = (observers as any).entries.get(key); assert.equal(entry.observers.size, 0);
  let final = '';
  observers.subscribe(key, () => completion, (v) => { final = v; }, () => {});
  resolve('done'); await completion; await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(final, 'done'); assert.equal(staleCalls, 0); assert.equal(entry.observers.size, 0);
  // Cancel wins if completion arrives after the mutable token flips.
  const c = new Clock(); const token = { aborted: false };
  const race = boundedProcessWait({ cancellation: token, subscribe: (done) => { token.aborted = true; done('late'); return () => {}; } }, c);
  assert.equal((await race).kind, 'cancelled'); assert.equal(c.jobs.size, 0);
  console.log('PASS bounds, >30s early completion, native/flag/pre-abort, fixed deadline, transport failure, rejection, observer retention and races');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
