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
  buildAutoRecallContext,
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

  // Idea capture: generic follow-ups and pasted material are not ideas.
  for (const noise of [
    'lets do all of these please',
    'Yup lets do thise 1-2-3 pls',
    'can we get it done tonight',
    'yea go ahead and fix up all those 3 problems please',
    'ok cool "we should build a totally different dashboard with charts and filters for everything" is what you said',
    'look at this\n[UPLOADED FILES]\n - we should add a shiny thing to the page.png',
    'we should do that',
  ]) assert.equal(extractIdeaText(noise), null, `not an idea: ${noise}`);
  for (const real of [
    'we should build a needs you card for blockers',
    'can we add a banked reset button to the context popover',
    'hey so\nI want a login handoff card that opens the browser',
  ]) assert.ok(extractIdeaText(real), `idea: ${real}`);

  // Scoring: all terms present but scattered is not strong; tight is.
  const t2 = path.join(tdir, 'scatter_chat.jsonl');
  fs.writeFileSync(t2,
    line('scatter_chat', 'assistant', 'I need to check the gift balance. ' + 'filler words go here and keep going for a while. '.repeat(12) + 'Then the card arrives by mail.', 10_000)
    + line('scatter_chat', 'user', 'remember the need-you card idea for approvals', 11_000));
  markRecallDirty(ws, t2, 0);
  drainRecallIndex(ws);
  const scattered = searchRecall(ws, { query: 'need card', sources: ['transcript'], limit: 20 });
  const loose = scattered.hits.find((h) => h.sessionId === 'scatter_chat' && h.role === 'assistant');
  const tight = scattered.hits.find((h) => h.sessionId === 'scatter_chat' && h.role === 'user');
  assert.ok(tight && tight.confidence === 'strong', 'adjacent terms are strong');
  assert.ok(!loose || loose.confidence !== 'strong', 'scattered co-occurrence must not be strong');
  if (loose && tight) assert.ok(scattered.hits.indexOf(tight) < scattered.hits.indexOf(loose), 'tight match ranks first');

  console.log('recall index regression passed');

  // Auto recall: casual messages inject nothing; topical ones inject a capped,
  // current-chat-excluded block.
  for (const casual of ['Okay', 'lol', 'yup lets do those pls', 'go ahead and fix it']) {
    assert.equal(buildAutoRecallContext(ws, casual, { excludeSessionId: 'current_chat' }).text, '', `no recall for "${casual}"`);
  }
  const auto = buildAutoRecallContext(ws, 'where did we land on that needs you card for blockers?', { excludeSessionId: 'current_chat' });
  assert.ok(auto.text.startsWith('[AUTO_RECALL]'), 'topical message injects recall');
  assert.ok(auto.text.includes('old_chat'), 'recall cites the source chat');
  assert.ok(!auto.text.includes('current_chat'), 'current chat is excluded');
  assert.ok(auto.text.length <= 1_400 + 200, 'recall block is capped');
  const tiny = buildAutoRecallContext(ws, 'needs you card blockers', { excludeSessionId: 'current_chat', maxChars: 300 });
  assert.ok(tiny.text.length < 600, 'maxChars caps the block');
  console.log('recall auto-context regression passed');
} finally {
  closeRecallIndex(ws);
  fs.rmSync(ws, { recursive: true, force: true });
}

// Startup race: a search before any background slice ran must not report an
// empty index; it warms the index synchronously first.
const ws2 = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-recall-warm-'));
try {
  const tdir = path.join(ws2, 'audit', 'chats', 'transcripts');
  fs.mkdirSync(tdir, { recursive: true });
  fs.writeFileSync(path.join(tdir, 'a.jsonl'), JSON.stringify({ timestamp: 1, sessionId: 'a', role: 'user', content: 'the purple lighthouse keeper' }) + '\n');
  const res = searchRecall(ws2, { query: 'purple lighthouse' });
  assert.ok(res.stats.docs > 0, 'first search warms the index');
  assert.equal(res.best, 'strong');
  console.log('recall index warm-start regression passed');
} finally {
  closeRecallIndex(ws2);
  fs.rmSync(ws2, { recursive: true, force: true });
}
