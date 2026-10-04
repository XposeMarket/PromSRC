// Two gateway processes share questions.json during a warm restart: the draining
// host owns the waiting turn and creates the card, the replacement serves the UI
// and Telegram. Each process is modelled by its own PrometheusQuestionQueue.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pq-cross-'));
process.env.PROMETHEUS_DATA_DIR = root;

async function main() {
  const { PrometheusQuestionQueue, createPrometheusQuestionPayload } = await import('./prometheus-questions');
  const storePath = path.join(root, '.prometheus', 'questions.json');
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const week = 8 * 24 * 60 * 60 * 1000;
  fs.writeFileSync(storePath, JSON.stringify({ questions: [{ id: 'stale', sessionId: 's-old', status: 'pending', createdAt: new Date(Date.now() - week).toISOString(), questions: [{ id: 'q', label: 'Old?' }] }] }));

  const replacement = new PrometheusQuestionQueue(); // booted first
  assert.equal(replacement.get('stale')?.status, 'expired', 'week-old pending cards are swept on boot');

  const host = new PrometheusQuestionQueue(); // draining gateway, still running the turn
  const card = host.create(createPrometheusQuestionPayload({ sessionId: 's1', questions: [{ id: 'when', label: 'When?', options: ['Now', 'Later'] }] }));

  // Bug 1: the replacement's boot snapshot never saw this card (mobile list empty, Telegram/web submit 404).
  assert.ok(replacement.listPending().some((q) => q.id === card.id), 'replacement lists a card the host created after it booted');
  assert.ok(replacement.get(card.id), 'replacement can look the card up by id');

  let answered: any = null;
  host.onResolve(card.id, (payload) => { answered = payload; });
  const submitted = replacement.submit(card.id, [{ id: 'when', selected: ['Now'] }], '', 'telegram');
  assert.equal(submitted?.status, 'answered');

  // Bug 2: the host's waiter must notice an answer written by the other process.
  host.syncFromDisk(true);
  assert.deepEqual(answered?.answers?.[0]?.selected, ['Now'], 'host waiter resolves from the replacement answer');

  // Bug 3: a write from either process must not drop the other's records.
  const other = host.create(createPrometheusQuestionPayload({ sessionId: 's2', questions: [{ id: 'x', label: 'X?' }] }));
  replacement.create(createPrometheusQuestionPayload({ sessionId: 's3', questions: [{ id: 'y', label: 'Y?' }] }));
  const onDisk = JSON.parse(fs.readFileSync(storePath, 'utf-8')).questions.map((q: any) => q.id);
  assert.ok(onDisk.includes(other.id), 'replacement write keeps the host card');
  assert.ok(onDisk.includes(card.id), 'answered card survives');
  console.log('prometheus questions cross-process regression passed');
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
