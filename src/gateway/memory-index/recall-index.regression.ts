import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  closeRecallIndex,
  drainRecallIndex,
  extractIdeaText,
  listRecallIdeas,
  markRecallDirty,
  searchRecall,
  formatRecallResult,
} from './recall-index';

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-recall-'));
try {
  const tdir = path.join(ws, 'audit', 'chats', 'transcripts');
  fs.mkdirSync(tdir, { recursive: true });
  fs.mkdirSync(path.join(ws, 'memory'), { recursive: true });
  const line = (sessionId: string, role: string, content: string, ts: number, synthetic = false) =>
    JSON.stringify({ timestamp: ts, sessionId, role, content, synthetic }) + '\n';

  fs.writeFileSync(path.join(tdir, 'old_chat.jsonl'),
    line('old_chat', 'user', 'we should build a needs you card for blockers', 1_000)
    + line('old_chat', 'assistant', 'The Needs You card is a universal blocker card with one-tap actions.', 2_000)
    + line('old_chat', 'assistant', 'restart context packet needs you card', 2_500, true));
  fs.writeFileSync(path.join(tdir, 'current_chat.jsonl'),
    line('current_chat', 'user', 'do you remember that needs you card?', 5_000));
  fs.writeFileSync(path.join(ws, 'memory', '2026-09-23-intraday-notes.md'),
    '\n### [TASK] 2026-09-23T10:00:00.000Z\n_Source: Mobile; session: old_chat_\nBanked reset endpoint mapped for codex.\n');
  fs.writeFileSync(path.join(ws, 'MEMORY.md'), '# MEMORY\n\n## projects\n- Tailscale funnel timeouts cause the mobile white screen.\n');

  const stats = drainRecallIndex(ws);
  assert.equal(stats.available, true);
  assert.equal(stats.backfillComplete, true);

  const hit = searchRecall(ws, { query: 'needs you card', excludeSessionId: 'current_chat' });
  assert.equal(hit.best, 'strong');
  assert.ok(hit.hits.every((h) => h.sessionId !== 'current_chat'), 'current chat must be excluded');
  assert.ok(hit.hits.some((h) => h.sessionId === 'old_chat' && h.source === 'transcript'));
  assert.ok(!hit.hits.some((h) => /restart context packet/.test(h.snippet)), 'synthetic rows are not indexed');

  assert.equal(searchRecall(ws, { query: 'banked reset', sources: ['note'] }).hits[0]?.source, 'note');
  assert.equal(searchRecall(ws, { query: 'tailscale funnel', sources: ['memory'] }).hits[0]?.source, 'memory');

  const miss = searchRecall(ws, { query: 'quantum pizza oven' });
  assert.equal(miss.best, 'none');
  assert.match(formatRecallResult(miss), /NO STRONG MATCH/);

  const partial = searchRecall(ws, { query: 'card holographic zebra', excludeSessionId: 'current_chat' });
  assert.notEqual(partial.best, 'strong', 'hits missing most terms must not claim strong');

  // Ideas are captured once, from user messages only.
  const ideas = listRecallIdeas(ws);
  assert.equal(ideas.length, 1);
  assert.match(ideas[0].text, /needs you card/);
  assert.equal(extractIdeaText('ok thanks'), null);

  // Incremental append: only the new line is read, and it becomes searchable.
  fs.appendFileSync(path.join(tdir, 'old_chat.jsonl'), line('old_chat', 'user', 'lets add a zebra mode toggle', 9_000));
  markRecallDirty(ws, path.join(tdir, 'old_chat.jsonl'), 0);
  drainRecallIndex(ws);
  assert.equal(searchRecall(ws, { query: 'zebra mode toggle' }).best, 'strong');
  assert.equal(searchRecall(ws, { query: 'build needs you card blockers', sources: ['transcript'], limit: 20 }).hits.filter((h) => h.source === 'transcript' && h.role === 'user' && h.sessionId === 'old_chat').length, 1, 'append must not duplicate earlier lines');
  assert.equal(listRecallIdeas(ws).length, 2);

  console.log('recall index regression passed');
} finally {
  closeRecallIndex(ws);
  fs.rmSync(ws, { recursive: true, force: true });
}
