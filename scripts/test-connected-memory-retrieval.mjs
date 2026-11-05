// Isolated connected-memory retrieval integration test.
// Exercises the real recall-index.ts SQLite FTS search, rebuild and auto-recall paths against
// lexical transcript fixtures, with source suppression coming from the real reference store.
// No gateway, browser, provider, embedding or paid calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const results = [];
async function check(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, ok: false, error: String(error?.message || error) }); console.log(`FAIL ${name}: ${error?.message || error}`); }
}

const TERM_QUERY = 'quokkaplum ferment';
const AUTO_MESSAGE = 'what quokkaplum ferment notes do I have';
const SECRET_A = 'A-secret-alpha';
const PUBLIC_B = 'B-public-beta';

function writeTranscript(workspace, sessionId, text) {
  const dir = path.join(workspace, 'audit', 'chats', 'transcripts');
  fs.mkdirSync(dir, { recursive: true });
  const row = { role: 'user', content: text, sessionId, timestamp: Date.now() };
  fs.appendFileSync(path.join(dir, `${sessionId}.jsonl`), JSON.stringify(row) + '\n');
}

function sessionsOf(result) {
  return result.hits.map(h => h.sessionId).sort();
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-retrieval-'));
  const home = path.join(root, 'home'); fs.mkdirSync(home, { recursive: true });
  Object.assign(process.env, {
    HOME: home, USERPROFILE: home, APPDATA: path.join(root, 'appdata'), LOCALAPPDATA: path.join(root, 'localappdata'),
    PROMETHEUS_CONFIG_DIR: path.join(root, 'config'), PROMETHEUS_DATA_DIR: path.join(root, 'data'), PROMETHEUS_HOME: path.join(root, 'prom-home'),
  });
  delete process.env.PROMETHEUS_DISABLE_RECALL_INDEX;
  delete process.env.PROMETHEUS_DISABLE_AUTO_RECALL;

  const require = createRequire(import.meta.url);
  require('tsx/cjs');
  const workspace = path.join(root, 'workspace'); fs.mkdirSync(workspace, { recursive: true });

  // Transcript fixtures: two chat sessions containing the same lexical terms.
  writeTranscript(workspace, 'chat-A', `${TERM_QUERY} ${SECRET_A}`);
  writeTranscript(workspace, 'chat-B', `${TERM_QUERY} ${PUBLIC_B}`);

  const recall = require('../src/gateway/memory-index/recall-index.ts');
  const { getReferenceService } = require('../src/gateway/resources/reference-service.ts');
  const { ReferenceStore } = require('../src/gateway/resources/reference-store.ts');

  const service = getReferenceService(workspace);
  const metadata = service.metadata;
  const rootDir = service.resources.rootDir;
  let noteA;

  const rebuildRecallFromDisk = () => {
    recall.closeRecallIndex(workspace);
    const base = recall.recallIndexPath(workspace);
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(base + suffix, { force: true });
    return recall.drainRecallIndex(workspace);
  };

  try {
    metadata.setSettings({ capture: true, recall: true });
    // Reference fixture: a saved reference whose source chat is chat-A.
    noteA = service.saveText({ operationId: 'rt-note-a', title: 'Retrieval note A', content: `${TERM_QUERY} ${SECRET_A} note`, userQuote: 'ferment', sourceSession: 'chat-A' });

    await check('baseline: lexical recall search returns both source sessions before suppression', async () => {
      recall.drainRecallIndex(workspace);
      const r = recall.searchRecall(workspace, { query: TERM_QUERY, limit: 10 });
      assert.deepEqual(sessionsOf(r), ['chat-A', 'chat-B']);
      assert.ok(r.stats.available, 'recall index available');
    });

    await check('baseline: automatic recall includes both source sessions before suppression', async () => {
      const auto = recall.buildAutoRecallContext(workspace, AUTO_MESSAGE);
      assert.ok(auto.hits > 0, `auto recall produced hits (skipped=${auto.skipped})`);
      assert.ok(auto.text.includes(SECRET_A), 'chat-A auto-recalled');
      assert.ok(auto.text.includes(PUBLIC_B), 'chat-B auto-recalled');
    });

    await check('forgetSource hides chat-A transcript hits from actual lexical recall search', async () => {
      metadata.forgetSource(noteA.id);
      assert.ok(metadata.forgottenSessions().has('chat-A'));
      const r = recall.searchRecall(workspace, { query: TERM_QUERY, limit: 10 });
      assert.deepEqual(sessionsOf(r), ['chat-B'], 'only unrelated session remains');
      assert.ok(r.hits.every(h => !h.snippet.includes(SECRET_A)), 'no chat-A snippet leaks');
    });

    await check('forgetSource hides chat-A from automatic recall', async () => {
      const auto = recall.buildAutoRecallContext(workspace, AUTO_MESSAGE);
      assert.ok(auto.text.includes(PUBLIC_B), 'unrelated chat-B still auto-recalled');
      assert.equal(auto.text.includes(SECRET_A), false, 'chat-A not auto-recalled');
    });

    await check('suppression survives index rebuild from disk (chat-A still hidden)', async () => {
      const stats = rebuildRecallFromDisk();
      assert.ok(stats.available, 'rebuilt index available');
      const r = recall.searchRecall(workspace, { query: TERM_QUERY, limit: 10 });
      assert.deepEqual(sessionsOf(r), ['chat-B'], 'chat-A absent after rebuild');
      const auto = recall.buildAutoRecallContext(workspace, AUTO_MESSAGE);
      assert.equal(auto.text.includes(SECRET_A), false, 'chat-A absent from auto recall after rebuild');
      assert.ok(auto.text.includes(PUBLIC_B), 'chat-B still present after rebuild');
    });

    await check('suppression survives recall-process restart and reference-store reader', async () => {
      recall.closeRecallIndex(workspace);
      const reader = new ReferenceStore(rootDir, workspace, { readOnly: true });
      try { assert.ok(reader.forgottenSessions().has('chat-A'), 'durable suppression visible to fresh reader'); }
      finally { reader.close(); }
      const r = recall.searchRecall(workspace, { query: TERM_QUERY, limit: 10 });
      assert.deepEqual(sessionsOf(r), ['chat-B'], 'chat-A still absent after restart');
    });

    await check('undo restores chat-A to lexical recall search and automatic recall', async () => {
      metadata.update(noteA.id, { excluded: false });
      assert.equal(metadata.forgottenSessions().has('chat-A'), false);
      const r = recall.searchRecall(workspace, { query: TERM_QUERY, limit: 10 });
      assert.deepEqual(sessionsOf(r), ['chat-A', 'chat-B'], 'chat-A back in search');
      const auto = recall.buildAutoRecallContext(workspace, AUTO_MESSAGE);
      assert.ok(auto.text.includes(SECRET_A), 'chat-A back in auto recall');
    });

    await check('undo survives rebuild from disk', async () => {
      rebuildRecallFromDisk();
      const r = recall.searchRecall(workspace, { query: TERM_QUERY, limit: 10 });
      assert.deepEqual(sessionsOf(r), ['chat-A', 'chat-B'], 'both sessions after rebuild post-undo');
    });
  } finally {
    try { recall.closeRecallIndex(workspace); } catch { /* best-effort */ }
    try { service.resources.flushSync(); } catch { /* best-effort */ }
    try { metadata.close(); } catch { /* best-effort */ }
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
    catch (error) { console.log(`CLEANUP_WARNING: ${error?.message || error}`); }
  }

  const failed = results.filter(r => !r.ok);
  console.log(`CONNECTED_MEMORY_RETRIEVAL_RESULT: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch(error => { console.error('SETUP_FAILED', error); process.exitCode = 1; })
  .finally(() => process.exit(process.exitCode || 0));
