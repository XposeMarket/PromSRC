// A main-chat turn suspended on ask_prometheus_questions must not be replayed
// from its original request after a crash/handoff: that re-runs every tool and
// re-asks while the old card is still pending. Recovery keeps the card instead.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-question-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_WORKSPACE_DIR = root;

async function main() {
  const { getPrometheusQuestionQueue, createPrometheusQuestionPayload } = await import('./prometheus-questions');
  const { mainChatRuntimeAwaitingQuestion } = await import('./runtime-recovery');
  const queue = getPrometheusQuestionQueue();
  const card = queue.create(createPrometheusQuestionPayload({ sessionId: 's-wait', questions: [{ id: 'when', label: 'When?', options: ['Now', 'Later'] }] }));

  const waiting = { sessionId: 's-wait', checkpoint: { event: 'heartbeat', toolName: 'ask_prometheus_questions' } } as any;
  assert.equal(mainChatRuntimeAwaitingQuestion(waiting), true, 'a turn parked on a pending card is kept, not replayed');
  assert.equal(mainChatRuntimeAwaitingQuestion({ ...waiting, checkpoint: { toolName: 'run_command' } }), false, 'a turn mid-tool is still replayed');
  assert.equal(mainChatRuntimeAwaitingQuestion({ ...waiting, sessionId: 's-other' }), false, 'a card from another chat does not count');

  queue.cancel(card.id, 'test');
  assert.equal(mainChatRuntimeAwaitingQuestion(waiting), false, 'once the card is gone the turn is replayed normally');
  console.log('runtime recovery question regression passed');
}

main().then(() => fs.rmSync(root, { recursive: true, force: true })).catch((err) => { console.error(err); process.exit(1); });
