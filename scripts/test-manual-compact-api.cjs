'use strict';
/*
 * Mounted /api/chat regression for manual /compact (companion to test-manual-compact.cjs).
 *
 * Mounts the REAL chat.router.ts on a local express app and sends HTTP requests to POST /api/chat:
 *   1. "/compact" (command)  -> must make zero ordinary model dispatches and one summarizer call.
 *   2. a normal, explicitly sent follow-up -> must make exactly one ordinary dispatch whose context
 *      carries the saved summary, and must not carry "/compact" or compact status rows.
 * Only the model seam is faked: getOllamaClient().chatWithThinking. The summarizer is recognised by
 * its "You are ContextCompactor" system prompt; every other call is counted as ordinary dispatch.
 * No real provider is contacted. Each run uses fresh temp data dirs.
 *
 * Portable: place in <repo>/scripts/ and run from the repo root:
 *   npx tsx scripts/test-manual-compact-api.cjs
 * Repo root is found by walking up to src/gateway/session.ts (override with PROMETHEUS_REPO_ROOT).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function findRepoRoot(start) {
  if (process.env.PROMETHEUS_REPO_ROOT) return path.resolve(process.env.PROMETHEUS_REPO_ROOT);
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'src', 'gateway', 'session.ts'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`repo root not found above ${start}`);
    dir = parent;
  }
}
const ROOT = findRepoRoot(__dirname);
const DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-manual-compact-api-'));
process.env.PROMETHEUS_DATA_DIR = DATA_ROOT;
process.env.PROMETHEUS_WORKSPACE_DIR = DATA_ROOT;

const req = (rel) => require(path.join(ROOT, rel));
const HEADINGS = [
  'Primary Request and Intent', 'Key Technical Concepts', 'Files and Code Sections', 'Errors, Fixes, and Test Results',
  'Problem Solving and Decisions', 'Recent User Messages', 'Pending Tasks', 'Current Work', 'Recovery Artifacts', 'Continue From Here',
];
const summaryText = (tag) => HEADINGS.map((h, i) =>
  `${i + 1}. ${h}:\n- ${tag} handoff fact ${i + 1}: src/gateway/routes/chat/manual-compact.ts behaviour preserved, decision recorded.\n- ${tag} second bullet for ${h}.`).join('\n');
const LONG = 'Regression detail about compaction, files, decisions and test results for the mounted api harness. '.repeat(5);

const results = [];
const record = (name, status, detail = {}) => { results.push({ name, status, detail }); console.log(`[${status}] ${name} ${JSON.stringify(detail)}`); };

// Reads SSE frames until the stream ends or the harness timeout cancels it.
async function readSSE(res, timeoutMs = 60000) {
  const frames = [];
  let ended = false;
  if (!res.body) return { frames, ended: true };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const timer = setTimeout(() => { reader.cancel('harness timeout').catch(() => {}); }, timeoutMs);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) { ended = true; break; }
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const line = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        try { frames.push(JSON.parse(line.slice(6))); } catch { /* ignore non-JSON frame */ }
      }
    }
  } catch { /* cancelled by timeout */ } finally { clearTimeout(timer); }
  return { frames, ended };
}

async function main() {
  // Load the real router FIRST, as the server entry does: chat.router configures handle-chat's
  // dependencies at module load, and loading it later inside a cycle leaves them unset.
  const chatRouterModule = req('src/gateway/routes/chat.router.ts');
  // Production wiring: server-v2.ts calls initChatRouter(deps) once at boot. Without it the
  // handle-chat dependencies (e.g. shouldUseSessionWorkspace) stay unset and ordinary turns fail.
  // Stub singletons. A plain text turn only reads skills (buildTurnContext returns a string);
  // it makes no cron or telegram calls. Empty skill catalog keeps the prompt deterministic.
  const skillsManagerStub = {
    buildTurnContext: () => '',
    get: () => undefined,
    getAll: () => [],
    listResources: () => [],
    refreshSkillsIfChanged: () => {},
    hasScanned: () => true,
  };
  chatRouterModule.initChatRouter({ cronScheduler: {}, telegramChannel: {}, skillsManager: skillsManagerStub });
  const router = chatRouterModule.router;
  const express = req('node_modules/express');
  const session = req('src/gateway/session.ts');
  const state = req('src/gateway/chat/manual-compact-state.ts');
  const ollama = req('src/agents/ollama-client.ts');
  const { compactLabels } = state;
  assert.ok(router, 'real chat.router exported `router`');

  // ---- the only fake: the model seam ----
  const fake = { mode: 'ok', tag: 'API', compactor: 0, ordinary: [] };
  ollama.getOllamaClient().chatWithThinking = async (messages) => {
    const sys = String(messages.find((m) => m.role === 'system')?.content || '');
    if (sys.includes('You are ContextCompactor')) {
      fake.compactor += 1;
      if (fake.mode === 'throw') throw new Error('fake provider failure (api regression)');
      return { message: { content: summaryText(`${fake.tag}-c${fake.compactor}`) } };
    }
    fake.ordinary.push({ messages: messages.map((m) => ({ role: m.role, content: String(m.content || '') })) });
    return { message: { content: `ordinary reply ${fake.ordinary.length}` } };
  };

  // ---- real router mounted on a real HTTP listener (loopback only) ----
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(router);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  record('A0 mounted: real chat.router served on loopback', 'pass', { base: base.replace(/\d+$/, 'N') });

  let seq = 0;
  const sid = (label) => `compact-api-${label}-${++seq}`;
  const T0 = Date.UTC(2026, 10, 24, 12, 0, 0);
  const seed = (id, pairs) => {
    for (let i = 0; i < pairs; i++) {
      session.addMessage(id, { role: 'user', content: `user turn ${i}: ${LONG}`, timestamp: T0 + i * 2 }, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
      session.addMessage(id, { role: 'assistant', content: `assistant turn ${i}: ${LONG}`, timestamp: T0 + i * 2 + 1 }, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
    }
    session.flushSession(id);
  };
  const post = (body) => fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const snapshot = () => ({ compactor: fake.compactor, ordinary: fake.ordinary.length });
  const delta = (before) => ({ compactor: fake.compactor - before.compactor, ordinary: fake.ordinary.length - before.ordinary });
  const dispatchedWith = (mark) => fake.ordinary.filter((c) => c.messages.some((m) => m.role === 'user' && m.content.includes(mark)));

  async function scenario(name, fn) {
    try { const detail = (await fn()) || {}; record(name, 'pass', detail); }
    catch (err) { record(name, 'FAIL', { error: String(err?.message || err).slice(0, 500) }); }
  }

  const ctx = {};

  // A1: the /compact command over the mounted endpoint
  await scenario('A1 command: POST /api/chat "/compact" -> success, zero ordinary dispatch, one summarizer call', async () => {
    fake.mode = 'ok'; fake.tag = 'A1';
    const id = sid('success'); ctx.successId = id;
    seed(id, 4);
    const before = snapshot();
    const r = await post({ sessionId: id, message: '/compact', clientMessageId: 'api-cmp-1' });
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.equal(body.status, 'success');
    assert.deepEqual(delta(before), { compactor: 1, ordinary: 0 }, 'command: one summarizer call, zero ordinary dispatch');
    assert.ok(session.getSession(id).latestContextSummary.includes('A1-c1 handoff fact 1'), 'summary committed');
    return { http: r.status, status: body.status, ...delta(before) };
  });

  // A2: normal explicitly sent follow-up after the command
  await scenario('A2 follow-up: normal /api/chat message -> one ordinary dispatch with the summary, no /compact or status rows', async () => {
    const id = ctx.successId;
    assert.ok(id, 'A1 produced a session');
    const mark = 'A2FOLLOWUP-MARK';
    const before = snapshot();
    const r = await post({ sessionId: id, message: `${mark} what did we decide about the harness?` });
    assert.equal(r.status, 200);
    const { frames, ended } = await readSSE(r);
    const calls = dispatchedWith(mark);
    assert.equal(calls.length, 1, `follow-up dispatched exactly once (got ${calls.length})`);
    assert.equal(delta(before).compactor, 0, 'follow-up made no summarizer call');
    const msgs = calls[0].messages;
    assert.ok(msgs.some((m) => m.content.includes('A1-c1 handoff fact 1')), 'next-turn context carries the saved summary');
    assert.ok(msgs.some((m) => m.content.startsWith('[Rolling context summary]')), 'rolling summary message present');
    assert.equal(msgs.some((m) => m.role === 'user' && m.content.trim() === '/compact'), false, 'no /compact command in follow-up context');
    const labels = Object.values(compactLabels).filter(Boolean);
    assert.equal(msgs.some((m) => labels.some((l) => m.content.includes(l))), false, 'no compact status text in follow-up context');
    assert.equal(msgs.some((m) => m.content.includes('user turn 0:')), false, 'pre-boundary turns are not replayed');
    return { followupDispatches: calls.length, contextMessages: msgs.length, frameTypes: [...new Set(frames.map((f) => f.type))], streamEnded: ended };
  });

  // A3: replaying the same /compact id returns the stored status and dispatches nothing
  await scenario('A3 replay: same /compact clientMessageId -> stored success, zero summarizer and zero ordinary calls', async () => {
    const before = snapshot();
    const r = await post({ sessionId: ctx.successId, message: '/compact', clientMessageId: 'api-cmp-1' });
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.equal(body.status, 'success');
    assert.deepEqual(delta(before), { compactor: 0, ordinary: 0 }, 'replay makes no model call');
    return { http: r.status, status: body.status };
  });

  // A4: failed compaction via the mounted endpoint commits nothing; the next normal turn sees full history
  await scenario('A4 failure: failed /compact commits nothing, next normal turn carries full uncompacted history', async () => {
    fake.mode = 'throw'; fake.tag = 'A4';
    const id = sid('failure');
    seed(id, 3);
    const r = await post({ sessionId: id, message: '/compact', clientMessageId: 'api-cmp-4' });
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.equal(body.status, 'failed');
    assert.equal(session.getSession(id).latestContextSummary, undefined, 'no summary committed');
    fake.mode = 'ok';
    const mark = 'A4FOLLOWUP-MARK';
    const before = snapshot();
    const f = await post({ sessionId: id, message: `${mark} continue after the failed compact` });
    assert.equal(f.status, 200);
    await readSSE(f);
    const calls = dispatchedWith(mark);
    assert.equal(calls.length, 1, `follow-up dispatched exactly once (got ${calls.length})`);
    assert.equal(delta(before).compactor, 0, 'follow-up made no summarizer call');
    const msgs = calls[0].messages;
    assert.equal(msgs.some((m) => m.content.startsWith('[Rolling context summary]')), false, 'no summary in context');
    assert.ok(msgs.some((m) => m.content.includes('user turn 0:')), 'full seeded history still in context');
    return { commandStatus: body.status, followupDispatches: calls.length };
  });

  server.close();
  const failed = results.filter((r) => r.status !== 'pass');
  const report = { root: ROOT, dataRoot: DATA_ROOT, total: results.length, passed: results.length - failed.length, failed: failed.length, ordinaryDispatchTotal: fake.ordinary.length, summarizerCallsTotal: fake.compactor, results };
  console.log('API_REGRESSION_REPORT ' + JSON.stringify(report));
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('API_HARNESS_ERROR', err?.stack || err);
    process.exitCode = 1;
  })
  .finally(() => { process.exit(process.exitCode || 0); }); // router import leaves timers; force a clean exit
