import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMobileMainChatQueue, type MobileChatQueueRequest } from './mobile-main-chat-queue';

const dir = mkdtempSync(join(tmpdir(), 'prom-mobile-main-chat-queue-'));
const cases: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => cases.push([name, fn]);
const req = (id: string, sessionId = 'chat_a', message = id, deviceId = 'phone_a'): MobileChatQueueRequest =>
  ({ id, sessionId, deviceId, body: { message } });
const fileFor = (name: string) => join(dir, `${name}.json`);
const ids = (q: ReturnType<typeof createMobileMainChatQueue>, sid: string) => q.list(sid).items.map((item) => item.id);

// 1. FIFO survives a closed client (process restart) and per-chat isolation.
test('FIFO order is preserved across reopen and chats stay isolated', () => {
  const file = fileFor('fifo');
  const q1 = createMobileMainChatQueue(file);
  assert.equal(q1.enqueue(req('mq_a1')), 'queued');
  assert.equal(q1.enqueue(req('mq_a2')), 'queued');
  assert.equal(q1.enqueue(req('mq_a3')), 'queued');
  assert.equal(q1.enqueue(req('mq_b1', 'chat_b')), 'queued');

  const q2 = createMobileMainChatQueue(file);
  assert.deepEqual(ids(q2, 'chat_a'), ['mq_a1', 'mq_a2', 'mq_a3']);
  assert.deepEqual(ids(q2, 'chat_b'), ['mq_b1']);
  assert.equal(q2.claim('chat_a')?.id, 'mq_a1');
  // A claimed head blocks later items in the same chat: no reordering.
  assert.equal(q2.claim('chat_a'), null);
  q2.finish('chat_a', 'mq_a1', 'accepted');

  const q3 = createMobileMainChatQueue(file);
  assert.equal(q3.claim('chat_a')?.id, 'mq_a2');
  q3.finish('chat_a', 'mq_a2', 'accepted');
  assert.equal(createMobileMainChatQueue(file).claim('chat_a')?.id, 'mq_a3');
  assert.deepEqual(createMobileMainChatQueue(file).pendingSessions().sort(), ['chat_a', 'chat_b']);
});

// 2. Receipts and read snapshots survive restart.
test('accepted receipts dedupe after restart and drop message bodies from disk', () => {
  const file = fileFor('receipts');
  const q1 = createMobileMainChatQueue(file);
  q1.enqueue(req('mq_r1', 'chat_a', 'hello'));
  q1.claim('chat_a');
  q1.finish('chat_a', 'mq_r1', 'accepted');

  const q2 = createMobileMainChatQueue(file);
  assert.deepEqual(q2.list('chat_a').items, []);
  assert.equal(q2.enqueue(req('mq_r1', 'chat_a', 'hello')), 'duplicate');
  assert.equal(q2.enqueue(req('mq_r1', 'chat_a', 'changed')), 'conflict');
  assert.equal(q2.enqueue(req('mq_r1', 'chat_a', 'hello', 'phone_b')), 'conflict');
  const raw = readFileSync(file, 'utf8');
  assert.equal(raw.includes('"hello"'), false, 'accepted message body must not persist');
});

test('pending receipts and paused reason are readable after restart', () => {
  const file = fileFor('read-restart');
  const q1 = createMobileMainChatQueue(file);
  q1.enqueue(req('mq_p1'));
  q1.pause('chat_a', 'turn_failed');
  const q2 = createMobileMainChatQueue(file);
  const snap = q2.list('chat_a');
  assert.equal(snap.paused, 'turn_failed');
  assert.deepEqual(snap.items.map((item) => [item.id, item.state]), [['mq_p1', 'pending']]);
});

// 3. A lost response must not produce a duplicate send.
test('client retry after lost response returns duplicate, not a second queued item', () => {
  const file = fileFor('lost-response');
  const q1 = createMobileMainChatQueue(file);
  assert.equal(q1.enqueue(req('mq_l1')), 'queued');
  // Response lost; phone retries the same id after a gateway reload.
  const q2 = createMobileMainChatQueue(file);
  assert.equal(q2.enqueue(req('mq_l1')), 'duplicate');
  assert.deepEqual(ids(q2, 'chat_a'), ['mq_l1']);
});

test('crash after claim with durable user message recovers as accepted, not replayed', () => {
  const file = fileFor('crash-durable');
  const q1 = createMobileMainChatQueue(file);
  q1.enqueue(req('mq_d1'));
  q1.enqueue(req('mq_d2'));
  assert.equal(q1.claim('chat_a')?.id, 'mq_d1');
  // Simulated crash: no finish(). Transcript already has the user message.
  const q2 = createMobileMainChatQueue(file);
  q2.recoverClaims((sid, id) => sid === 'chat_a' && id === 'mq_d1');
  assert.equal(q2.list('chat_a').paused, null);
  assert.deepEqual(ids(q2, 'chat_a'), ['mq_d2']);
  assert.equal(q2.enqueue(req('mq_d1')), 'duplicate');
  assert.equal(q2.claim('chat_a')?.id, 'mq_d2');
});

test('crash after claim without durable message is uncertain, paused, and never replayed', () => {
  const file = fileFor('crash-uncertain');
  const q1 = createMobileMainChatQueue(file);
  q1.enqueue(req('mq_u1'));
  q1.enqueue(req('mq_u2'));
  assert.equal(q1.claim('chat_a')?.id, 'mq_u1');
  const q2 = createMobileMainChatQueue(file);
  q2.recoverClaims(() => false);
  const snap = q2.list('chat_a');
  assert.equal(snap.paused, 'delivery_uncertain');
  assert.deepEqual(snap.items.map((item) => [item.id, item.state]), [['mq_u1', 'uncertain'], ['mq_u2', 'pending']]);
  assert.equal(q2.claim('chat_a'), null);
  assert.equal(q2.resume('chat_a'), false, 'resume must not blind-replay an uncertain start');
  // Cancel is the only way forward; it keeps FIFO for the next item.
  assert.equal(q2.cancel('chat_a', 'mq_u1'), true);
  assert.equal(q2.resume('chat_a'), true);
  assert.equal(q2.claim('chat_a')?.id, 'mq_u2');
});

// 4. Failure pause / claim / cancel / resume.
test('finish not_started returns the head to pending, pauses, and resume retries the same item', () => {
  const file = fileFor('not-started');
  const q = createMobileMainChatQueue(file);
  q.enqueue(req('mq_n1'));
  q.enqueue(req('mq_n2'));
  assert.equal(q.claim('chat_a')?.id, 'mq_n1');
  q.finish('chat_a', 'mq_n1', 'not_started');
  assert.equal(q.list('chat_a').paused, 'not_started');
  assert.equal(q.claim('chat_a'), null, 'paused chat must not dispatch');
  assert.equal(q.resume('chat_a'), true);
  assert.equal(q.resume('chat_a'), false, 'resume is not idempotent once unpaused');
  assert.equal(q.claim('chat_a')?.id, 'mq_n1');
  q.finish('chat_a', 'mq_n1', 'accepted');
  assert.equal(q.claim('chat_a')?.id, 'mq_n2');
});

test('cancel is refused while claimed (in flight) and allowed while pending', () => {
  const file = fileFor('cancel');
  const q = createMobileMainChatQueue(file);
  q.enqueue(req('mq_c1'));
  q.enqueue(req('mq_c2'));
  q.claim('chat_a');
  assert.equal(q.cancel('chat_a', 'mq_c1'), false);
  assert.equal(q.cancel('chat_a', 'mq_c2'), true);
  assert.equal(q.cancel('chat_a', 'mq_c2'), false);
  assert.equal(q.cancel('chat_a', 'mq_missing'), false);
  assert.equal(q.enqueue(req('mq_c2')), 'duplicate', 'cancelled receipt still dedupes');
  q.finish('chat_a', 'mq_c1', 'accepted');
  assert.deepEqual(ids(q, 'chat_a'), []);
});

test('finish is a no-op for an item that is not claimed', () => {
  const file = fileFor('finish-noop');
  const q = createMobileMainChatQueue(file);
  q.enqueue(req('mq_f1'));
  q.finish('chat_a', 'mq_f1', 'accepted');
  q.finish('chat_a', 'mq_f1', 'not_started');
  assert.deepEqual(q.list('chat_a').items.map((item) => item.state), ['pending']);
  assert.equal(q.list('chat_a').paused, null);
});

test('external pause blocks claim until resume and survives reopen', () => {
  const file = fileFor('pause');
  const q1 = createMobileMainChatQueue(file);
  q1.enqueue(req('mq_x1'));
  q1.pause('chat_a', 'stopped');
  q1.pause('chat_a', 'stopped');
  const q2 = createMobileMainChatQueue(file);
  assert.equal(q2.claim('chat_a'), null);
  assert.equal(q2.resume('chat_a'), true);
  assert.equal(q2.claim('chat_a')?.id, 'mq_x1');
});

test('accepting the final active item does not carry its Stop pause into a later queue', () => {
  const file = fileFor('last-item-stop');
  const q = createMobileMainChatQueue(file);
  q.enqueue(req('mq_stop_1'));
  q.claim('chat_a');
  q.pause('chat_a', 'stopped');
  q.finish('chat_a', 'mq_stop_1', 'accepted');
  const reloaded = createMobileMainChatQueue(file);
  assert.equal(reloaded.list('chat_a').paused, null);
  assert.equal(reloaded.enqueue(req('mq_stop_2')), 'queued');
  assert.equal(reloaded.claim('chat_a')?.id, 'mq_stop_2');
});

test('pause on a chat with nothing active is a no-op and writes nothing', () => {
  const file = fileFor('pause-empty');
  const q = createMobileMainChatQueue(file);
  q.pause('chat_empty', 'stopped');
  assert.equal(q.list('chat_empty').paused, null);
  assert.equal(existsSync(file), false, 'no-op pause must not write');
});

// 5. Storage write failure keeps the previous state.
test('failed write leaves in-memory and on-disk state at the previous snapshot', () => {
  const file = fileFor('write-fail');
  const q = createMobileMainChatQueue(file);
  assert.equal(q.enqueue(req('mq_w1')), 'queued');
  // Make the target path a directory so the atomic rename fails.
  const persisted = readFileSync(file, 'utf8');
  rmSync(file);
  mkdirSync(file);
  try {
    assert.throws(() => q.enqueue(req('mq_w2')));
    assert.deepEqual(ids(q, 'chat_a'), ['mq_w1'], 'in-memory state must not show the failed item');
    assert.throws(() => q.claim('chat_a'));
    assert.equal(q.list('chat_a').items[0].state, 'pending', 'failed claim must not leave a claimed head');
    assert.throws(() => q.cancel('chat_a', 'mq_w1'));
    assert.equal(q.list('chat_a').items[0].state, 'pending');
    assert.equal(readdirSync(dir).filter((name) => name.startsWith('write-fail.json.') && name.endsWith('.tmp')).length, 0,
      'failed write must clean up its temporary file');
  } finally {
    rmSync(file, { recursive: true, force: true });
  }
  writeFileSync(file, persisted);
  const reopened = createMobileMainChatQueue(file);
  assert.deepEqual(ids(reopened, 'chat_a'), ['mq_w1']);
  assert.equal(reopened.list('chat_a').items[0].state, 'pending');
  assert.equal(reopened.enqueue(req('mq_w2')), 'queued');
});

// 6. Fail-closed loading and validation limits.
test('corrupt or wrong-version queue file fails closed instead of silently emptying', () => {
  const bad = fileFor('corrupt');
  writeFileSync(bad, '{not json');
  assert.throws(() => createMobileMainChatQueue(bad));
  const wrongVersion = fileFor('wrong-version');
  writeFileSync(wrongVersion, JSON.stringify({ version: 2, receipts: [], pauses: {} }));
  assert.throws(() => createMobileMainChatQueue(wrongVersion));
  const arrayPauses = fileFor('array-pauses');
  writeFileSync(arrayPauses, JSON.stringify({ version: 1, receipts: [], pauses: [] }));
  assert.throws(() => createMobileMainChatQueue(arrayPauses));
});

test('invalid ids, empty messages, oversized payloads and per-chat cap are rejected', () => {
  const q = createMobileMainChatQueue(fileFor('validation'));
  assert.equal(q.enqueue({ id: 'bad id', sessionId: 'chat_a', deviceId: 'phone_a', body: { message: 'x' } }), 'invalid');
  assert.equal(q.enqueue(req('mq_v1', 'chat_a', '   ')), 'invalid');
  assert.equal(q.enqueue(req('mq_big', 'chat_a', 'x'.repeat(49 * 1024))), 'invalid');
  for (let i = 0; i < 8; i += 1) assert.equal(q.enqueue(req(`mq_cap${i}`)), 'queued');
  assert.equal(q.enqueue(req('mq_cap8')), 'full');
  assert.equal(q.enqueue(req('mq_other', 'chat_b')), 'queued', 'cap is per chat');
});

let failed = 0;
try {
  for (const [name, fn] of cases) {
    try {
      fn();
      console.log(`ok - ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`not ok - ${name}`);
      console.error(error);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
if (failed) {
  console.error(`${failed} of ${cases.length} mobile queue regressions failed.`);
  process.exitCode = 1;
} else {
  console.log(`Mobile queue regressions passed (${cases.length}): FIFO, receipts, lost-response dedupe, crash recovery, pause/claim/cancel/resume, write-failure retention, fail-closed load, limits.`);
}
