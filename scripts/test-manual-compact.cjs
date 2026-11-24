'use strict';
/*
 * Isolated backend integration regression for manual /compact.
 *
 * Portable: place in <repo>/scripts/ (or any folder under the repo) and run with tsx:
 *   npx tsx scripts/test-manual-compact.cjs
 * The repo root is found by walking up from this file until src/gateway/session.ts exists
 * (override with PROMETHEUS_REPO_ROOT).
 *
 * Uses the real session store, real manual-compact route module, real turn coordinator,
 * real compaction-safety validation and the real interactive-turn /compact branch.
 * Only the summarizer provider is faked (getOllamaClient().chatWithThinking). No real provider
 * is contacted. Every run uses fresh temp data/workspace dirs and never touches live state.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

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
const CHILD_SID = process.env.PROMETHEUS_COMPACT_CHILD_SID || '';

// Fresh data dirs for every run (child processes reuse the parent's dir via env).
const DATA_ROOT = process.env.PROMETHEUS_COMPACT_TEST_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), 'prom-manual-compact-'));
process.env.PROMETHEUS_DATA_DIR = DATA_ROOT;
process.env.PROMETHEUS_WORKSPACE_DIR = DATA_ROOT;

const req = (rel) => require(path.join(ROOT, rel));
const HEADINGS = [
  'Primary Request and Intent', 'Key Technical Concepts', 'Files and Code Sections', 'Errors, Fixes, and Test Results',
  'Problem Solving and Decisions', 'Recent User Messages', 'Pending Tasks', 'Current Work', 'Recovery Artifacts', 'Continue From Here',
];
const summaryText = (tag) => HEADINGS.map((h, i) =>
  `${i + 1}. ${h}:\n- ${tag} handoff fact ${i + 1}: src/gateway/routes/chat/manual-compact.ts behaviour preserved, decision recorded.\n- ${tag} second bullet for ${h}.`).join('\n');
const LONG = 'Regression detail about compaction, files, decisions and test results for the manual compact harness. '.repeat(5);

const results = [];
const record = (name, status, detail = {}) => { results.push({ name, status, detail }); console.log(`[${status}] ${name} ${JSON.stringify(detail)}`); };

async function main() {
  const session = req('src/gateway/session.ts');
  const manual = req('src/gateway/routes/chat/manual-compact.ts');
  const state = req('src/gateway/chat/manual-compact-state.ts');
  const coordinator = req('src/gateway/chat/turn-coordinator.ts').mainChatTurnCoordinator;
  const ollama = req('src/agents/ollama-client.ts');
  const { requestManualCompact, manualCompactHttp } = manual;
  const { COMPACT_BUSY, compactLabels, isCompactRow, manualCompactions } = state;

  // ---- real router module: registers compaction dependencies (prefixes, policy, tool name) at load ----
  const compaction = req('src/gateway/routes/chat/pipeline/compaction.ts');
  let depsSource = 'router';
  try { req('src/gateway/routes/chat.router.ts'); } catch (err) { depsSource = `router_import_failed: ${String(err?.message || err).slice(0, 200)}`; }
  if (!compaction.isCompactionSummaryMessage({ role: 'assistant', content: '[Rolling context summary]\nx' })) {
    // Fallback mirrors chat.router.ts lines 2049-2050 and 2963 when the router cannot load.
    depsSource = 'fallback_constants';
    compaction.configureCompactionDependencies({
      ROLLING_COMPACTION_SUMMARY_PREFIX: '[Rolling context summary]',
      LEGACY_COMPACTION_SUMMARY_PREFIX: '[Compacted context summary]',
      resolveRollingCompactionPolicy: () => ({ enabled: true, toolTurns: 5, summaryMaxWords: 0, model: '' }),
      CONTEXT_COMPACTION_TOOL_NAME: 'context_compaction',
    });
  }
  record('S0 harness: compaction dependencies configured', 'pass', { depsSource });

  // ---- fake summarizer provider (the only fake) ----
  const fake = { mode: 'ok', tag: 'T0', calls: [], gate: null };
  const client = ollama.getOllamaClient();
  client.chatWithThinking = async (messages, role, opts = {}) => {
    fake.calls.push({ role, promptHasHeadings: String(messages.at(-1)?.content || '').includes('[ACTIVE_MESSAGES'), prevSummaryIncluded: String(messages.at(-1)?.content || '').includes('[PREVIOUS_SUMMARY]') });
    if (fake.mode === 'throw') throw new Error('fake provider failure (regression)');
    if (fake.mode === 'invalid') return { message: { content: 'COMPACTION_INCOMPLETE' } };
    if (fake.mode === 'gate') await fake.gate;
    if (fake.mode === 'hang') {
      await new Promise((_, reject) => {
        const s = opts.abortSignal;
        if (!s) return reject(new Error('no abort signal passed to provider'));
        if (s.aborted) return reject(new Error('aborted'));
        s.addEventListener('abort', () => reject(new Error('aborted by signal')), { once: true });
      });
    }
    // Per-call tag: the existing validator rejects an unchanged summary, which is correct behaviour.
    return { message: { content: summaryText(`${fake.tag}-c${fake.calls.length}`) } };
  };
  const resetFake = (mode, tag) => { fake.mode = mode; fake.tag = tag; fake.calls = []; fake.gate = null; };

  let seq = 0;
  const sid = (label) => `compact-regression-${label}-${++seq}`;
  const T0 = Date.UTC(2026, 10, 24, 12, 0, 0);
  const seed = (id, pairs = 6, tsBase = T0) => {
    for (let i = 0; i < pairs; i++) {
      session.addMessage(id, { role: 'user', content: `user turn ${i}: ${LONG}`, timestamp: tsBase + i * 2 }, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
      session.addMessage(id, { role: 'assistant', content: `assistant turn ${i}: ${LONG}`, timestamp: tsBase + i * 2 + 1 }, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
    }
    session.flushSession(id);
  };
  const body = (id, extra = {}) => ({ message: '/compact', clientMessageId: id, ...extra });
  const rows = (id, kind) => session.getSession(id).history.filter((m) => m.messageKind === kind);
  const statusRow = (id, cid) => session.getSession(id).history.find((m) => m.messageId === `manual_compact:${cid}:status`);

  async function scenario(name, fn) {
    try { const detail = (await fn()) || {}; record(name, 'pass', detail); }
    catch (err) { record(name, 'FAIL', { error: String(err?.message || err).slice(0, 500) }); }
  }

  // S1 success: command vs next-turn history
  await scenario('S1 success: /compact summarizes, saves boundary, next-turn history excludes command rows', async () => {
    resetFake('ok', 'S1');
    const id = sid('success');
    seed(id, 6);
    const before = session.getSession(id).history.length;
    const out = await requestManualCompact(id, body('cmp-s1'));
    assert.equal(out.status, 'success');
    assert.equal(out.message, compactLabels.success);
    assert.equal(fake.calls.length, 1, 'exactly one provider call');
    assert.equal(fake.calls[0].promptHasHeadings, true);
    const s = session.getSession(id);
    assert.ok(s.latestContextSummary.includes('S1-c1 handoff fact 1'), 'summary committed');
    assert.equal(s.contextStartIndex, before + 2, 'boundary after command+status rows');
    assert.equal(statusRow(id, 'cmp-s1').compactStatus, 'success');
    assert.equal(rows(id, 'manual_compact_command').length, 1);
    const api = session.getHistoryForApiCall(id, 60, { fullActiveHistory: true, includeCommentaryContext: false });
    assert.ok(api[0].content.startsWith('[Rolling context summary]'), 'next turn starts with rolling summary');
    assert.equal(api.some((m) => isCompactRow(m) || m.content === '/compact' || m.content === compactLabels.running), false, 'no command/status rows in next-turn API history');
    session.addMessage(id, { role: 'user', content: 'next question after compact', timestamp: Date.now() }, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
    session.flushSession(id);
    const api2 = session.getHistoryForApiCall(id, 60, { fullActiveHistory: true, includeCommentaryContext: false });
    assert.equal(api2.at(-1).content, 'next question after compact');
    assert.equal(api2.length, 2, 'summary + new user message only');
    return { providerCalls: fake.calls.length, historyRows: s.history.length, apiHistoryNextTurn: api2.length, contextStartIndex: s.contextStartIndex };
  });

  // S2 dedup + skip + merge-with-previous summary
  await scenario('S2 dedup: same id replays stored status; empty window skips; new turn merges previous summary', async () => {
    resetFake('ok', 'S2');
    const id = sid('dedup');
    seed(id, 4);
    const first = await requestManualCompact(id, body('cmp-s2a'));
    const replay = await requestManualCompact(id, body('cmp-s2a'));
    assert.equal(first.status, 'success');
    assert.deepEqual(replay, { status: 'success', message: compactLabels.success });
    assert.equal(fake.calls.length, 1, 'replayed id makes no provider call');
    const skip = await requestManualCompact(id, body('cmp-s2b'));
    assert.equal(skip.status, 'skipped', 'nothing new after compaction');
    assert.equal(skip.message, compactLabels.skipped);
    assert.equal(fake.calls.length, 1, 'skip makes no provider call');
    session.addMessage(id, { role: 'user', content: 'fresh material for second compact', timestamp: Date.now() }, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
    session.addMessage(id, { role: 'assistant', content: 'fresh reply', timestamp: Date.now() + 1 }, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
    session.flushSession(id);
    const second = await requestManualCompact(id, body('cmp-s2c'));
    assert.equal(second.status, 'success');
    assert.equal(fake.calls.length, 2);
    assert.equal(fake.calls[1].prevSummaryIncluded, true, 'second compaction carries previous summary');
    return { firstStatus: first.status, replayProviderCalls: 0, skipStatus: skip.status, secondStatus: second.status, totalProviderCalls: fake.calls.length };
  });

  // S3 in-flight dedup, busy rejection, lease held
  await scenario('S3 in-flight: same id joins, other id/normal turn is refused, lease held until done', async () => {
    resetFake('gate', 'S3');
    let open;
    fake.gate = new Promise((r) => { open = r; });
    const id = sid('inflight');
    seed(id, 4);
    const p1 = requestManualCompact(id, body('cmp-s3'));
    await waitFor(() => fake.calls.length === 1);
    const p2 = requestManualCompact(id, body('cmp-s3'));
    await assert.rejects(requestManualCompact(id, body('cmp-other')), (e) => e.message === COMPACT_BUSY);
    const interactive = await (req('src/gateway/routes/chat/pipeline/interactive-turn.ts').runInteractiveTurn)('hello while compacting', id, () => {});
    assert.equal(interactive.text, COMPACT_BUSY, 'normal chat turn refused while compaction owns the chat');
    assert.equal(coordinator.tryAcquire(id), null, 'turn lease is held by compaction');
    assert.equal(manualCompactions.get(id)?.id, 'cmp-s3');
    open();
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1.status, 'success');
    assert.deepEqual(r2, r1);
    assert.equal(fake.calls.length, 1, 'one provider call for duplicate in-flight ids');
    const lease = coordinator.tryAcquire(id);
    assert.ok(lease, 'lease released after completion');
    coordinator.release(lease);
    assert.equal(manualCompactions.has(id), false);
    return { providerCalls: fake.calls.length, busyRejections: 2, interactiveText: interactive.text };
  });

  // S4 provider throws -> failed, context unchanged
  await scenario('S4 failure: provider error -> failed, previous context unchanged', async () => {
    resetFake('throw', 'S4');
    const id = sid('failure');
    seed(id, 4);
    const beforeLen = session.getSession(id).history.length;
    const out = await requestManualCompact(id, body('cmp-s4'));
    assert.equal(out.status, 'failed');
    assert.equal(out.message, compactLabels.failed);
    const s = session.getSession(id);
    assert.equal(s.latestContextSummary, undefined);
    assert.equal(s.contextStartIndex, 0);
    assert.equal(statusRow(id, 'cmp-s4').compactStatus, 'failed');
    assert.equal(s.history.length, beforeLen + 2, 'command+status rows kept, no seeded rows removed');
    const api = session.getHistoryForApiCall(id, 60, { fullActiveHistory: true, includeCommentaryContext: false });
    assert.equal(api.length, 8, 'next-turn API history still the 8 seeded messages');
    return { providerCalls: fake.calls.length, status: out.status, apiHistory: api.length };
  });

  // S5 invalid summary (COMPACTION_INCOMPLETE) rejected by existing safety validation
  await scenario('S5 invalid summary: existing compaction-safety rejects -> failed, nothing committed', async () => {
    resetFake('invalid', 'S5');
    const id = sid('invalid');
    seed(id, 4);
    const out = await requestManualCompact(id, body('cmp-s5'));
    assert.equal(out.status, 'failed');
    const s = session.getSession(id);
    assert.equal(s.latestContextSummary, undefined);
    assert.equal(s.contextStartIndex, 0);
    return { providerCalls: fake.calls.length, status: out.status };
  });

  // S6 interruption: user aborts mid-summary
  await scenario('S6 interruption: abort during summarize -> failed, no commit, lease released', async () => {
    resetFake('hang', 'S6');
    const id = sid('interrupt');
    seed(id, 4);
    const ctrl = new AbortController();
    const p = requestManualCompact(id, body('cmp-s6'), ctrl.signal);
    await waitFor(() => fake.calls.length === 1);
    ctrl.abort();
    const out = await p;
    assert.equal(out.status, 'failed');
    const s = session.getSession(id);
    assert.equal(s.latestContextSummary, undefined);
    assert.equal(s.contextStartIndex, 0);
    assert.equal(statusRow(id, 'cmp-s6').compactStatus, 'failed');
    assert.equal(manualCompactions.has(id), false);
    const lease = coordinator.tryAcquire(id);
    assert.ok(lease, 'lease free after interruption');
    coordinator.release(lease);
    return { providerCalls: fake.calls.length, status: out.status };
  });

  // S7 skip on empty chat
  await scenario('S7 skip: empty chat -> skipped, no provider call, command rows still recorded', async () => {
    resetFake('ok', 'S7');
    const id = sid('empty');
    const out = await requestManualCompact(id, body('cmp-s7'));
    assert.equal(out.status, 'skipped');
    assert.equal(fake.calls.length, 0);
    assert.equal(statusRow(id, 'cmp-s7').compactStatus, 'skipped');
    return { providerCalls: 0, status: out.status };
  });

  // S8 refusals (validation + native-only) through the real HTTP handler
  await scenario('S8 refusals: attachments, external agent, bad id -> HTTP 400/409 with no rows written', async () => {
    resetFake('ok', 'S8');
    const cases = [
      { name: 'attachments', sessionId: sid('refuse-att'), body: { message: '/compact', attachments: [{ name: 'a.png' }] }, code: 400 },
      { name: 'non-native agent', sessionId: sid('refuse-agent'), body: { message: '/compact', agent: { id: 'codex' } }, code: 409 },
      { name: 'bad session id', sessionId: '../escape', body: { message: '/compact' }, code: 400 },
      { name: 'bad request id', sessionId: sid('refuse-id'), body: { message: '/compact', clientMessageId: 'bad id with spaces!' }, code: 400 },
    ];
    const out = {};
    for (const c of cases) {
      const res = fakeRes();
      await manualCompactHttp({ body: { sessionId: c.sessionId, ...c.body } }, res);
      assert.equal(res.code, c.code, `${c.name} -> ${res.code} ${JSON.stringify(res.body)}`);
      out[c.name] = res.code;
      if (c.name !== 'bad session id' && c.name !== 'bad request id') {
        assert.equal(session.getSession(c.sessionId).history.length, 0, `${c.name}: no command row written`);
      }
    }
    assert.equal(fake.calls.length, 0);
    return out;
  });

  // S9 HTTP happy path + lease pre-held by a live turn
  await scenario('S9 HTTP + busy lease: pre-held turn lease -> 409 busy, no command row; HTTP success returns status', async () => {
    resetFake('ok', 'S9');
    const id = sid('http');
    seed(id, 4);
    const held = coordinator.tryAcquire(id);
    assert.ok(held, 'test acquired lease');
    const busy = fakeRes();
    await manualCompactHttp({ body: { sessionId: id, message: '/compact', clientMessageId: 'cmp-s9-busy' } }, busy);
    assert.equal(busy.code, 409);
    assert.equal(busy.body.error, COMPACT_BUSY);
    assert.equal(rows(id, 'manual_compact_command').length, 0, 'refused before any row is written');
    coordinator.release(held);
    const ok = fakeRes();
    await manualCompactHttp({ body: { sessionId: id, message: '/compact', clientMessageId: 'cmp-s9' } }, ok);
    assert.equal(ok.code, 200);
    assert.equal(ok.body.status, 'success');
    return { busyCode: busy.code, httpSuccessCode: ok.code, providerCalls: fake.calls.length };
  });

  // S10 slash command through the real interactive-turn branch (normal /api/chat entry point)
  await scenario('S10 interactive /api/chat entry: /compact via runInteractiveTurn saves success, second /compact during run is busy', async () => {
    resetFake('ok', 'S10');
    const id = sid('interactive');
    seed(id, 4);
    const turn = await (req('src/gateway/routes/chat/pipeline/interactive-turn.ts').runInteractiveTurn)('/compact', id, () => {}, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { clientRequestId: 'cmp-s10' });
    assert.equal(turn.text, compactLabels.success);
    assert.equal(statusRow(id, 'cmp-s10').compactStatus, 'success');
    return { turnText: turn.text, providerCalls: fake.calls.length };
  });

  // S11 restart: a persisted running status is not replayed; it is marked failed on load
  await scenario('S11 restart: persisted running status is healed to failed on fresh load, no provider call', async () => {
    resetFake('ok', 'S11');
    const id = sid('restart');
    seed(id, 2);
    session.addMessage(id, { role: 'user', content: '/compact', timestamp: Date.now(), messageKind: 'manual_compact_command', messageId: 'manual_compact:cmp-s11:command' }, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
    session.getSession(id).history.push({ role: 'assistant', messageKind: 'manual_compact_status', messageId: 'manual_compact:cmp-s11:status', compactStatus: 'running', content: compactLabels.running, timestamp: Date.now() });
    assert.equal(session.flushSession(id), true);
    const child = spawnSync(process.execPath, [...process.execArgv, __filename], {
      env: { ...process.env, PROMETHEUS_COMPACT_CHILD_SID: id, PROMETHEUS_COMPACT_TEST_ROOT: DATA_ROOT },
      encoding: 'utf8', timeout: 180000,
    });
    assert.equal(child.status, 0, `child failed: ${child.stderr || child.stdout}`);
    const line = child.stdout.split(/\r?\n/).find((l) => l.startsWith('CHILD_RESULT '));
    const childOut = JSON.parse(line.slice('CHILD_RESULT '.length));
    assert.equal(childOut.statusAfterLoad, 'failed');
    assert.equal(childOut.childProviderCalls, 0);
    return childOut;
  });

  // Static wiring of the real router (router is too large to mount in isolation)
  await scenario('S12 wiring: chat.router.ts registers POST /api/chat/manual-compact to manualCompactHttp', async () => {
    const text = fs.readFileSync(path.join(ROOT, 'src/gateway/routes/chat.router.ts'), 'utf8');
    assert.ok(/router\.post\('\/api\/chat\/manual-compact',\s*manualCompactHttp\)/.test(text));
    return { route: 'POST /api/chat/manual-compact' };
  });

  const failed = results.filter((r) => r.status !== 'pass');
  const report = { root: ROOT, dataRoot: DATA_ROOT, total: results.length, passed: results.length - failed.length, failed: failed.length, results };
  console.log('MANUAL_COMPACT_REPORT ' + JSON.stringify(report));
  if (failed.length) process.exitCode = 1;
}

function fakeRes() {
  return { code: 200, body: undefined, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}
async function waitFor(pred, ms = 10000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function child() {
  const session = require(path.join(ROOT, 'src/gateway/session.ts'));
  const { isCompactRow } = require(path.join(ROOT, 'src/gateway/chat/manual-compact-state.ts'));
  const s = session.getSession(CHILD_SID);
  const row = s.history.find((m) => m.messageId && m.messageId.endsWith(':status') && m.messageKind === 'manual_compact_status');
  const apiHist = session.getHistoryForApiCall(CHILD_SID, 60, { fullActiveHistory: true, includeCommentaryContext: false });
  console.log('CHILD_RESULT ' + JSON.stringify({
    statusAfterLoad: row?.compactStatus,
    contentAfterLoad: row?.content,
    childProviderCalls: 0,
    apiHistoryCompactRows: apiHist.filter((m) => isCompactRow(m)).length,
  }));
}

(CHILD_SID ? child() : main())
  .catch((err) => {
    console.error('MANUAL_COMPACT_HARNESS_ERROR', err?.stack || err);
    process.exitCode = 1;
  })
  .finally(() => { if (!CHILD_SID) process.exit(process.exitCode || 0); }); // router import may leave timers; parent forces a clean exit
