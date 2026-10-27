import assert from 'node:assert/strict';
import { setImmediate as immediate, setTimeout as delay } from 'node:timers/promises';
import { EventBatcher, scheduleWorkerWarmup } from './worker-latency.js';
import { modelCallMessageBytes, type ModelCallWorkerChildMessage } from './model-call-worker-protocol.js';

async function testWarmup(): Promise<void> {
  const order: string[] = ['ready'];
  let rejectWarmup!: (error: Error) => void;
  let started = false;
  scheduleWorkerWarmup(async () => {
    started = true;
    order.push('warmup');
    await new Promise<void>((_resolve, reject) => { rejectWarmup = reject; });
  });
  assert.equal(started, false, 'warmup must not block readiness');
  order.push('request-admitted');
  await immediate();
  assert.deepEqual(order, ['ready', 'request-admitted', 'warmup']);
  // Pending warmup does not block subsequent event-loop work/requests.
  await immediate();
  order.push('request-completed');
  rejectWarmup(new Error('fake vault unavailable'));
  scheduleWorkerWarmup(() => { throw new Error('fake synchronous initialization failure'); });
  await immediate();
  await immediate();
  assert.equal(order.at(-1), 'request-completed');
}

async function testBatching(): Promise<void> {
  for (const kind of ['token', 'thinking', 'reasoning_summary'] as const) {
    const messages: ModelCallWorkerChildMessage[] = [];
    const batcher = new EventBatcher('first', (message) => messages.push(message), 16_384, 30);
    batcher.enqueue('model_event', { type: 'provider_event', nativeType: 'metadata' });
    assert.equal(messages.length, 1, 'first model event is immediate');
    batcher.enqueue('model_event', { type: 'provider_event', nativeType: 'more-metadata' });
    batcher.enqueue(kind, '');
    assert.equal(messages.length, 1, 'empty content must not consume fast path');
    batcher.enqueue(kind, 'first content');
    assert.equal(messages.length, 2, 'metadata must not delay first substantive content');
    batcher.enqueue(kind, 'later');
    batcher.enqueue(kind, 'later token');
    assert.equal(messages.length, 2, 'subsequent content stays batched');
    await delay(60);
    assert.equal(messages.length, 3, 'later content flushes on bounded timer');
    batcher.finish();
    const events = messages.flatMap((message) => message.type === 'events' ? message.events : []);
    assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(events.map((event) => event.value), [
      { type: 'provider_event', nativeType: 'metadata' },
      { type: 'provider_event', nativeType: 'more-metadata' }, '', 'first content', 'later', 'later token',
    ]);
  }
  const messages: ModelCallWorkerChildMessage[] = [];
  const batcher = new EventBatcher('limits', (message) => messages.push(message), 300, 30);
  batcher.enqueue('token', 'first');
  batcher.enqueue('token', 'x'.repeat(150));
  batcher.enqueue('token', 'y'.repeat(150));
  assert.equal(messages.length, 2, 'byte limit flushes preceding pending events');
  batcher.finish();
  assert.equal(messages.length, 3, 'finish drains pending events');
  for (const message of messages) {
    if (message.type === 'events') {
      assert.ok(message.events.reduce((sum, event) => sum + modelCallMessageBytes(event), 0) <= 300);
    }
  }
  assert.throws(() => batcher.enqueue('token', 'z'.repeat(301)), /bounded batch limit/);
  assert.throws(() => batcher.finish(), /bounded batch limit/);
  const thinkingFirst: ModelCallWorkerChildMessage[] = [];
  const mixed = new EventBatcher('thinking-first', (message) => thinkingFirst.push(message), 300, 30);
  mixed.enqueue('thinking', 'first thought');
  assert.equal(thinkingFirst.length, 1);
  mixed.enqueue('thinking', 'later thought');
  assert.equal(thinkingFirst.length, 1);
  mixed.enqueue('token', 'first real text');
  assert.equal(thinkingFirst.length, 2, 'thinking must not consume first token fast path');
  mixed.enqueue('token', 'later text');
  assert.equal(thinkingFirst.length, 2, 'later token deltas remain batched');
  mixed.finish();
  const alone: ModelCallWorkerChildMessage[] = [];
  const standalone = new EventBatcher('no-metadata', (message) => alone.push(message), 300, 30);
  standalone.enqueue('token', 'first');
  assert.equal(alone.length, 1, 'first token without metadata is also immediate');
  standalone.finish();
}

async function main(): Promise<void> {
  await testWarmup();
  await testBatching();
  console.log('PASS worker latency: deferred nonblocking/failure-safe warmup; first content, ordering, timer and byte limits');
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
