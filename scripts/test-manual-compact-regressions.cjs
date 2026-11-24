'use strict';
/*
 * Backend regressions for manual /compact review fixes (companion to test-manual-compact*.cjs).
 *   R1 history-sync route refuses 409 while /compact holds the chat; the status row stays attached.
 *   R2 a stale running row with no in-memory owner heals to terminal on replay: no provider call, no duplicate row.
 *   R3 explicit user input is refused with busy; a scheduled turn queues on the normal lease and is never told "busy".
 *   R4 the dedicated endpoint and /api/chat compact path require an explicit sessionId (no default chat).
 * Only the summarizer/model seam is faked (getOllamaClient().chatWithThinking). Fresh temp data dir per run.
 * Portable: npx tsx scripts/test-manual-compact-regressions.cjs (repo root found by walking up to src/gateway/session.ts).
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
const DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-manual-compact-regr-'));
process.env.PROMETHEUS_DATA_DIR = DATA_ROOT;
process.env.PROMETHEUS_WORKSPACE_DIR = DATA_ROOT;
const req = (rel) => require(path.join(ROOT, rel));

const HEADINGS = [
  'Primary Request and Intent', 'Key Technical Concepts', 'Files and Code Sections', 'Errors, Fixes, and Test Results',
  'Problem Solving and Decisions', 'Recent User Messages', 'Pending Tasks', 'Current Work', 'Recovery Artifacts', 'Continue From Here',
];
const summaryText = (tag) => HEADINGS.map((h, i) =>
  `${i + 1}. ${h}:\n- ${tag} handoff fact ${i + 1}: manual compact regression detail, decision recorded.\n- ${tag} second bullet for ${h}.`).join('\n');
const LONG = 'Regression detail about compaction, files, decisions and test results. '.repeat(5);

async function waitFor(cond, ms = 10000) {
  const t = Date.now();
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}
const tick = (ms = 150) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // Real router first (it configures handle-chat dependencies at load), then the production boot wiring.
  const chatRouterModule = req('src/gateway/routes/chat.router.ts');
  const skillsManagerStub = {
    buildTurnContext: () => '', get: () => undefined, getAll: () => [], listResources: () => [],
    refreshSkillsIfChanged: () => {}, hasScanned: () => true,
  };
  chatRouterModule.initChatRouter({ cronScheduler: {}, telegramChannel: {}, skillsManager: skillsManagerStub });
  const express = req('node_modules/express');
  const session = req('src/gateway/session.ts');
  const { requestManualCompact, manualCompactHttp } = req('src/gateway/routes/chat/manual-compact.ts');
  const { manualCompactions, COMPACT_BUSY, compactLabels } = req('src/gateway/chat/manual-compact-state.ts');
  const coordinator = req('src/gateway/chat/turn-coordinator.ts').mainChatTurnCoordinator;
  const { runInteractiveTurn } = req('src/gateway/routes/chat/pipeline/interactive-turn.ts');
  const ollama = req('src/agents/ollama-client.ts');

  // The only fake: the model seam. Summarizer calls are recognised by their system prompt.
  const fake = { gate: null, compactor: 0, ordinary: 0 };
  ollama.getOllamaClient().chatWithThinking = async (messages) => {
    const sys = String(messages.find((m) => m.role === 'system')?.content || '');
    if (sys.includes('You are ContextCompactor')) {
      fake.compactor += 1;
      if (fake.gate) await fake.gate;
      return { message: { content: summaryText(`R-c${fake.compactor}`) } };
    }
    fake.ordinary += 1;
    return { message: { content: 'ordinary reply' } };
  };

  // Real router on a loopback HTTP listener.
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(chatRouterModule.router);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  let seq = 0;
  const sid = (label) => `compact-regr-${label}-${Date.now()}-${++seq}`;
  const seed = (id, pairs = 4) => {
    for (let i = 0; i < pairs; i++) {
      session.addMessage(id, { role: 'user', content: `user ${i}: ${LONG}`, timestamp: Date.UTC(2026, 10, 24) + i * 2 }, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
      session.addMessage(id, { role: 'assistant', content: `assistant ${i}: ${LONG}`, timestamp: Date.UTC(2026, 10, 24) + i * 2 + 1 }, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
    }
    session.flushSession(id);
  };
  const statusRows = (id) => session.getSession(id).history.filter((m) => m.messageKind === 'manual_compact_status');
  const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  const failures = [];
  async function check(name, fn) {
    try {
      const detail = (await fn()) || {};
      console.log(`[pass] ${name} ${JSON.stringify(detail)}`);
    } catch (err) {
      failures.push(name);
      console.log(`[FAIL] ${name} ${String(err?.message || err).slice(0, 400)}`);
    } finally {
      fake.gate = null;
    }
  }
  // ---- scenarios R1-R4 are appended below ----

  // R1: held-reference race. A history replace while /compact runs must be refused; the row must still settle.
  await check('R1 sync: POST /api/sessions/:id/history is 409 while /compact holds the chat; status settles on the durable row', async () => {
    const id = sid('sync');
    seed(id, 4);
    const before = fake.compactor;
    let open;
    fake.gate = new Promise((r) => { open = r; });
    const p = requestManualCompact(id, { message: '/compact', clientMessageId: 'r1-cmd' });
    await waitFor(() => fake.compactor > before && manualCompactions.has(id));
    const res = await post(`/api/sessions/${id}/history`, { history: [] });
    const body = await res.json();
    assert.equal(res.status, 409);
    assert.equal(body.code, 'COMPACT_BUSY');
    assert.ok(session.getSession(id).history.length > 4, 'history was not replaced');
    open();
    const out = await p;
    assert.equal(out.status, 'success');
    const rows = statusRows(id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].compactStatus, 'success');
    assert.equal(manualCompactions.has(id), false);
    return { httpStatus: res.status, code: body.code, status: out.status, statusRows: rows.length };
  });

  // R2: a running status with no owner (orphan) must heal to terminal on replay, never replay as running.
  await check('R2 stale running: orphaned running row heals to failed on replay with no provider call and no duplicate row', async () => {
    const id = sid('stale');
    seed(id, 3);
    const before = fake.compactor;
    const s = session.getSession(id);
    s.history.push(
      { role: 'user', messageKind: 'manual_compact_command', messageId: 'manual_compact:r2:command', content: '/compact', timestamp: Date.now() },
      { role: 'assistant', messageKind: 'manual_compact_status', messageId: 'manual_compact:r2:status', compactStatus: 'running', content: compactLabels.running, timestamp: Date.now() + 1 },
    );
    session.flushSession(id);
    const first = await requestManualCompact(id, { message: '/compact', clientMessageId: 'r2' });
    const second = await requestManualCompact(id, { message: '/compact', clientMessageId: 'r2' });
    assert.equal(first.status, 'failed');
    assert.equal(second.status, 'failed');
    assert.equal(first.message, compactLabels.failed);
    assert.equal(fake.compactor, before, 'orphan replay made no provider call');
    const rows = session.getSession(id).history.filter((m) => m.messageId === 'manual_compact:r2:status');
    assert.equal(rows.length, 1, 'no duplicate status row');
    assert.equal(rows[0].compactStatus, 'failed');
    return { first: first.status, second: second.status, providerCalls: fake.compactor - before };
  });

  // R3: explicit input is refused as busy; a scheduled turn waits on the normal lease and is never told "busy".
  await check('R3 busy semantics: explicit turn refused; scheduled turn queues behind /compact then runs', async () => {
    const id = sid('queue');
    seed(id, 3);
    const before = fake.compactor;
    let open;
    fake.gate = new Promise((r) => { open = r; });
    const compact = requestManualCompact(id, { message: '/compact', clientMessageId: 'r3-cmd' });
    await waitFor(() => fake.compactor > before && manualCompactions.has(id));
    const explicit = await runInteractiveTurn('explicit user message', id, () => {});
    assert.equal(explicit.text, COMPACT_BUSY, 'explicit user input is refused while compacting');
    const ordinaryBefore = fake.ordinary;
    let scheduledText;
    // Exact six-argument call the real timer-runner.ts:111 makes: (message, sessionId, sendSSE, pinned, abortSignal, callerContext).
    // No flags and no turn origin: the trusted signal is the "[Timer fired]" message prefix, as in timer-runner.ts:84.
    const timerAbort = { aborted: false, signal: new AbortController().signal };
    const scheduled = runInteractiveTurn(
      '[Timer fired]\nUser asked earlier: wake\nTimer label: r3\nScheduled for: now\nProceed now as if the user just sent this request.',
      id, () => {}, undefined, timerAbort,
      '[Timer r3-timer] This is a delayed main-chat user turn. Treat it like the user just sent it in this same chat session.',
    ).then((r) => { scheduledText = r?.text; });
    await tick(200);
    assert.equal(scheduledText, undefined, 'scheduled turn is queued, not answered with busy text');
    assert.equal(coordinator.isActive(id), true, 'compaction still owns the lease');
    open();
    const out = await compact;
    assert.equal(out.status, 'success');
    await Promise.race([scheduled, tick(60000)]);
    assert.notEqual(scheduledText, COMPACT_BUSY, 'scheduled turn never receives the busy text');
    assert.ok(fake.ordinary > ordinaryBefore, 'scheduled turn ran after compaction released the lease');
    return { explicit: explicit.text === COMPACT_BUSY, scheduledText: String(scheduledText || '').slice(0, 40), ordinaryCalls: fake.ordinary - ordinaryBefore };
  });

  // R4: no default chat. Missing sessionId is refused on the dedicated endpoint and on /api/chat.
  await check('R4 sessionId: missing sessionId is 400 on the dedicated endpoint and on /api/chat compact (no default chat)', async () => {
    const dedicated = await post('/api/chat/manual-compact', { message: '/compact', clientMessageId: 'r4-a' });
    const viaChat = await post('/api/chat', { message: '/compact', clientMessageId: 'r4-b' });
    assert.equal(dedicated.status, 400);
    assert.equal(viaChat.status, 400);
    const blank = await post('/api/chat/manual-compact', { sessionId: '   ', message: '/compact', clientMessageId: 'r4-c' });
    assert.equal(blank.status, 400);
    return { dedicated: dedicated.status, apiChat: viaChat.status, blank: blank.status };
  });

  server.close();
  console.log(`MANUAL_COMPACT_REGRESSIONS_REPORT ${JSON.stringify({ total: 4, failed: failures.length, failures })}`);
  process.exitCode = failures.length ? 1 : 0;
}

main()
  .catch((err) => { console.error('MANUAL_COMPACT_REGRESSION_HARNESS_ERROR', err?.stack || err); process.exitCode = 1; })
  .finally(() => { process.exit(process.exitCode || 0); });
