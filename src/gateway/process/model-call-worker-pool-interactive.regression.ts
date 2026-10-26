import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mock } from 'node:test';

process.env.PROMETHEUS_MODEL_CALL_WORKERS = '1';
process.env.PROMETHEUS_MODEL_WORKER_COUNT = process.argv.includes('--single') ? '1' : '3';
process.env.PROMETHEUS_MODEL_WORKER_MAX_QUEUE = '2';
process.env.PROMETHEUS_MODEL_WORKER_WARM_SLOTS = '0';
const single = process.argv.includes('--single');
const children: FakeChild[] = [];
const started: string[] = [];
class FakeChild extends EventEmitter {
  connected = true;
  pid = 100 + children.length;
  stdout = { resume() {} };
  stderr = new EventEmitter();
  current: any;
  constructor() { super(); children.push(this); queueMicrotask(() => this.emit('message', { protocolVersion: 1, type: 'ready', pid: this.pid })); }
  send(message: any) {
    if (message.type === 'shutdown') { this.kill(); return; }
    if (message.type === 'cancel') { this.finish(); return; }
    if (message.type !== 'run') return;
    this.current = message;
    started.push(message.request.model);
    this.emit('message', { protocolVersion: 1, type: 'started', requestId: message.requestId, pid: this.pid, at: Date.now() });
  }
  finish() {
    const current = this.current;
    this.current = undefined;
    if (current) this.emit('message', { protocolVersion: 1, type: 'result', requestId: current.requestId,
      result: { message: { role: 'assistant', content: 'ok' }, done: true }, rssBytes: 0, completedAt: Date.now() });
  }
  kill() { this.connected = false; setImmediate(() => this.emit('exit', 0, null)); return true; }
}
mock.method(childProcess, 'fork', () => new FakeChild());
const tick = async () => { for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve)); };

async function main() {
  const pool = await import('./model-call-worker-pool.js');
  const pending: Promise<unknown>[] = [];
  function enqueue(model: string, priority: 'interactive' | 'background') {
    const promise = pool.dispatchModelCallWorker({ operation: 'chat', providerId: 'test', model, messages: [{ role: 'user', content: 'test' }] }, { priority });
    pending.push(promise);
    void promise.catch(() => {}); // cleanup on a failed assertion must not mask it
    return promise;
  }
  const finish = (name: string) => { const child = children.find((c) => c.current?.request.model === name); assert.ok(child, `${name} running`); child.finish(); };
  try {
    enqueue('b1', 'background'); await tick();
    if (single) {
      enqueue('i1', 'interactive'); enqueue('b2', 'background'); await tick();
      assert.deepEqual(started, ['b1']);
      finish('b1'); await tick(); assert.ok(started.includes('i1'));
      finish('i1'); await tick(); assert.ok(started.includes('b2'));
      finish('b2'); await Promise.all(pending);
    } else {
      enqueue('b2', 'background'); await tick();
      enqueue('b3', 'background'); await tick();
      // Main fails here: all three workers are occupied by background calls.
      assert.equal(started.length, 2, 'third background must leave the interactive reservation free');
      enqueue('i1', 'interactive'); await tick();
      assert.ok(started.includes('i1'), 'interactive starts before any background release');
      assert.equal(pool.getModelCallWorkerPoolStatus().active, 3, 'total concurrency unchanged');
      enqueue('b4', 'background'); await tick();
      await assert.rejects(() => pool.dispatchModelCallWorker({ operation: 'chat', providerId: 'test', model: 'overflow', messages: [] }), /queue is full/);
      finish('i1'); await tick();
      assert.ok(!started.includes('b3'), 'idle reserved slot must not admit a third background');
      finish('b1'); await tick(); assert.ok(started.includes('b3'));
      finish('b2'); await tick(); assert.ok(started.includes('b4'));
      finish('b3'); finish('b4'); await tick();
      enqueue('i2', 'interactive'); enqueue('i3', 'interactive'); await tick(); enqueue('i4', 'interactive'); await tick();
      enqueue('b5', 'background'); enqueue('i5', 'interactive'); await tick();
      finish('i2'); await tick();
      assert.ok(started.includes('b5'), 'background gets a slot on interactive completion despite queued interactive demand');
      assert.ok(!started.includes('i5'), 'priority cannot starve background');
      finish('i3'); await tick(); assert.ok(started.includes('i5'));
      finish('i4'); finish('i5'); finish('b5'); await Promise.all(pending);
      enqueue('b6', 'background'); enqueue('b7', 'background'); await tick();
      const controller = new AbortController();
      const cancelled = pool.dispatchModelCallWorker({ operation: 'chat', providerId: 'test', model: 'cancelled', messages: [] }, { signal: controller.signal });
      const rejected = assert.rejects(cancelled, /cancelled/);
      controller.abort('cancelled'); await rejected; await tick();
      assert.ok(!started.includes('cancelled'), 'queued cancellation cannot consume reserved slot');
      const timedOut = pool.dispatchModelCallWorker({ operation: 'chat', providerId: 'test', model: 'timeout', messages: [] }, {}, 1000);
      const keepAlive = setInterval(() => {}, 100);
      try { await assert.rejects(timedOut, /while queued/); } finally { clearInterval(keepAlive); }
      assert.ok(!started.includes('timeout'), 'timeout is removed even with idle reserved worker');
      finish('b6'); finish('b7'); await Promise.all(pending);
    }
    console.log(`PASS deterministic reserved capacity, bounded queue, FIFO and fairness (${single ? 1 : 3} workers)`);
  } finally {
    await pool.shutdownModelCallWorkerPool();
    await Promise.allSettled(pending);
    mock.restoreAll();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
