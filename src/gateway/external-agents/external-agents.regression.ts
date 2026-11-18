/**
 * Stage 3 live Codex chats: regression test.
 *
 * Every Codex interaction runs against testkit/fake-codex-app-server.mjs. The
 * real `codex` is never launched and no model turn is ever run.
 */
import assert from 'assert';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const FAKE = path.join(__dirname, 'testkit', 'fake-codex-app-server.mjs');

function hashTree(root: string, skip: (rel: string) => boolean): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replace(/\\/g, '/');
      if (skip(rel)) continue;
      if (entry.isDirectory()) walk(full);
      else out[rel] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out;
}

function pidAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function waitFor(check: () => boolean, ms = 4000): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-external-agents-'));
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = workspace;
  const logFile = path.join(root, 'fake-codex.log');
  const fakeEnv = (mode = 'ready') => ({ ...process.env, FAKE_CODEX_MODE: mode, FAKE_CODEX_LOG: logFile });
  const fakeCommand = () => ({ command: process.execPath, args: [FAKE], source: FAKE });
  const readLog = (): any[] => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '')
    .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));

  const { CodexAdapter, mapCodexServerRequest } = await import('./adapters/codex');
  const pending = await import('./pending-requests');
  const types = await import('./types');
  const store = await import('./store');

  const adapters: any[] = [];
  const makeAdapter = (mode = 'ready', extra: Record<string, any> = {}) => {
    const adapter = new CodexAdapter({ resolveCommand: fakeCommand, env: fakeEnv(mode), clientVersion: 'test', requestTimeoutMs: 5000, interruptGraceMs: 1500, ...extra });
    adapters.push(adapter);
    return adapter;
  };

  try {
    // ── verify: ready / signed_out / not_installed / start failure / too old ──
    {
      const ready = await makeAdapter('ready').verify();
      assert.strictEqual(ready.status, 'ready');
      assert.strictEqual(ready.version, '0.163.0');
      assert.match(ready.statusText, /^Connected · v0\.163\.0 · ChatGPT Plus$/);
      assert.deepStrictEqual(ready.account, { kind: 'chatgpt', label: 'ChatGPT Plus' });
      assert.ok(!JSON.stringify(ready).includes('someone@example.com'), 'email never leaves the adapter');

      const signedOut = await makeAdapter('signed_out').verify();
      assert.strictEqual(signedOut.status, 'signed_out');
      assert.match(signedOut.statusText, /codex login/);

      const missing = await new CodexAdapter({ resolveCommand: () => null }).verify();
      assert.strictEqual(missing.status, 'not_installed');

      const crash = await makeAdapter('crash_on_start').verify();
      assert.strictEqual(crash.status, 'error');
      assert.match(crash.statusText, /^Couldn't start Codex: /);

      const old = await new CodexAdapter({ resolveCommand: fakeCommand, readVersion: async () => ({ version: '0.10.0', ok: true }) }).verify();
      assert.strictEqual(old.status, 'too_old');
      for (const adapter of adapters) await adapter.shutdown();
    }

    // ── store holds no token or full email ──
    {
      store.setExternalAgentStorePathForTests(path.join(root, 'external-agents.json'));
      store.updateExternalAgentEntry('codex', {
        enabled: true, lastStatus: 'ready', lastStatusText: 'Connected', version: '0.163.0',
        accountKind: 'chatgpt', accountLabel: 'someone@example.com',
        ...( { token: 'sk-abcdefghijklmnopqrstuvwxyz0123456789' } as any),
      });
      const raw = fs.readFileSync(path.join(root, 'external-agents.json'), 'utf8');
      assert.ok(!raw.includes('@'), 'no email on disk');
      assert.ok(!/sk-|token/i.test(raw), 'no token on disk');
      assert.strictEqual(JSON.parse(raw).agents.codex.enabled, true);
    }

    // ── lone surrogate text is cut safely ──
    {
      const bad = `ok\uD83D tail \uDE00 end 😀`;
      const clean = types.sanitizeAgentText(bad);
      assert.strictEqual(clean, 'ok tail  end 😀');
      assert.strictEqual(types.sanitizeAgentText('a😀b', 2), 'a');
    }

    // Review: identity is bound before prompt submission; cancelling at binding sends no prompt.
    {
      const a = makeAdapter();
      fs.writeFileSync(logFile, '');
      const abort = new AbortController();
      let bound = '';
      const result = await a.runTurn({ sessionId: 'bind-stop', cwd: workspace, text: 'must not send', signal: abort.signal,
        emit: () => {}, requestUser: async () => ({ optionId: 'decline' }),
        onSessionBound: (id) => { bound = id; assert.ok(!readLog().some((x) => x.method === 'turn/start')); abort.abort(); },
      });
      assert.ok(bound);
      assert.equal(result.status, 'interrupted');
      assert.ok(!readLog().some((x) => x.method === 'turn/start'));
      await a.shutdown();
    }
    // Unanswered request cards expire on normal completion and process death.
    for (const text of ['PENDING_END', 'PENDING_CRASH']) {
      const a = makeAdapter();
      let seen = false;
      await a.runTurn({ sessionId: text, cwd: workspace, text, signal: new AbortController().signal, emit: () => {},
        requestUser: (card, opts) => { seen = true; return pending.createPendingRequest({ ...card, agentId: 'codex', sessionId: text }, { signal: opts?.signal, cancelResponse: { optionId: 'decline' } }); },
      });
      assert.equal(seen, true);
      assert.equal(pending.listPendingRequests(text).length, 0, 'terminal turn cannot retain answerable cards');
      await a.shutdown();
    }

    // ── first turn: thread/start with ONLY cwd; deltas in order; second turn reuses the thread ──
    const adapter = makeAdapter('ready');
    let threadId = '';
    {
      fs.writeFileSync(logFile, '');
      const events: any[] = [];
      const controller = new AbortController();
      const result = await adapter.runTurn({
        sessionId: 's1', cwd: workspace, text: 'hi', signal: controller.signal,
        emit: (event) => events.push(event),
        requestUser: async () => { throw new Error('no requests expected'); },
      });
      assert.strictEqual(result.status, 'completed');
      assert.strictEqual(result.finalText, 'Hello world');
      assert.strictEqual(result.model, 'fake-model');
      threadId = result.upstreamSessionId;
      assert.ok(threadId.startsWith('thr-'));
      const sent = readLog();
      const init = sent.find((m) => m.method === 'initialize');
      assert.deepStrictEqual(init.params, { clientInfo: { name: 'prometheus', title: 'Prometheus', version: 'test' }, capabilities: { experimentalApi: false } });
      assert.ok(sent.some((m) => m.method === 'initialized' && m.id === undefined));
      const start = sent.find((m) => m.method === 'thread/start');
      assert.deepStrictEqual(Object.keys(start.params), ['cwd'], 'thread/start carries only cwd');
      assert.strictEqual(start.params.cwd, workspace);
      const turn = sent.find((m) => m.method === 'turn/start');
      assert.deepStrictEqual(turn.params, { threadId, input: [{ type: 'text', text: 'hi', text_elements: [] }] });
      for (const forbidden of ['baseInstructions', 'developerInstructions', 'model', 'approvalPolicy', 'sandbox', 'sandboxPolicy', 'effort', 'personality']) {
        assert.ok(!sent.some((m) => m.params && Object.prototype.hasOwnProperty.call(m.params, forbidden)), `never sends ${forbidden}`);
      }
      const order = events.map((e) => e.type === 'text_delta' ? `t:${e.text}` : e.type === 'state' ? `s:${e.phase}` : e.type);
      assert.deepStrictEqual(order, ['s:starting', 's:running', 'item_started', 'item_completed', 'reasoning_delta', 't:Hello', 't: world', 'usage']);
      const done = events.find((e) => e.type === 'item_completed');
      assert.deepStrictEqual({ kind: done.kind, ok: done.ok, exitCode: done.exitCode }, { kind: 'command', ok: true, exitCode: 0 });

      fs.writeFileSync(logFile, '');
      const second = await adapter.runTurn({
        sessionId: 's1', upstreamSessionId: threadId, cwd: workspace, text: 'again', signal: new AbortController().signal,
        emit: () => undefined, requestUser: async () => ({ optionId: 'cancel' }),
      });
      assert.strictEqual(second.upstreamSessionId, threadId);
      const sent2 = readLog();
      assert.ok(!sent2.some((m) => m.method === 'thread/start' || m.method === 'thread/resume'), 'second turn reuses the loaded thread');
      assert.strictEqual(sent2.filter((m) => m.method === 'turn/start').length, 1);
    }

    // ── simulated restart: new process, thread/resume, and NO prompt by itself ──
    {
      await adapter.shutdown();
      assert.strictEqual(adapter.isRunning(), false);
      fs.writeFileSync(logFile, '');
      const restarted = makeAdapter('ready');
      const verified = await restarted.verify(); // a status check after restart must not resend anything
      assert.strictEqual(verified.status, 'ready');
      assert.ok(!readLog().some((m) => m.method === 'turn/start' || m.method === 'thread/resume'), 'restart alone sends no prompt');
      const events: any[] = [];
      const result = await restarted.runTurn({
        sessionId: 's1', upstreamSessionId: threadId, cwd: workspace, text: 'after restart', signal: new AbortController().signal,
        emit: (event) => events.push(event), requestUser: async () => ({ optionId: 'cancel' }),
      });
      assert.strictEqual(result.status, 'completed');
      assert.strictEqual(result.finalText, 'Hello world', 'stale replayed previous-turn events must not hijack the resumed turn');
      assert.notStrictEqual(result.upstreamTurnId, 'turn-previous');
      const sent = readLog();
      const resume = sent.find((m) => m.method === 'thread/resume');
      assert.deepStrictEqual(resume.params, { threadId, excludeTurns: true });
      const turns = sent.filter((m) => m.method === 'turn/start');
      assert.strictEqual(turns.length, 1);
      assert.strictEqual(turns[0].params.input[0].text, 'after restart', 'only the new user message is sent');
      assert.ok(events.some((e) => e.type === 'state' && e.phase === 'resuming'));

      const missing = await restarted.runTurn({
        sessionId: 's1', upstreamSessionId: 'missing-thread', cwd: workspace, text: 'x', signal: new AbortController().signal,
        emit: () => undefined, requestUser: async () => ({ optionId: 'cancel' }),
      });
      assert.strictEqual(missing.upstreamMissing, true);
      assert.match(String(missing.error), /can't find this session/);
      assert.ok(!readLog().some((m) => m.method === 'thread/start'), 'a missing session is never silently replaced');
      await restarted.shutdown();
    }

    // ── interrupt: turn/interrupt to the same thread+turn, partial text kept ──
    {
      fs.writeFileSync(logFile, '');
      const slow = makeAdapter('ready');
      const controller = new AbortController();
      const events: any[] = [];
      const running = slow.runTurn({
        sessionId: 's2', cwd: workspace, text: 'SLOW please', signal: controller.signal,
        emit: (event) => events.push(event), requestUser: async () => ({ optionId: 'cancel' }),
      });
      await waitFor(() => events.some((e) => e.type === 'text_delta'));
      controller.abort('operator_abort');
      const result = await running;
      assert.strictEqual(result.status, 'interrupted');
      assert.strictEqual(result.finalText, 'partial answer');
      const interrupt = readLog().find((m) => m.method === 'turn/interrupt');
      assert.ok(interrupt, 'turn/interrupt was sent');
      assert.deepStrictEqual(interrupt.params, { threadId: result.upstreamSessionId, turnId: result.upstreamTurnId });
      await slow.shutdown();
    }

    // ── command approval: options = upstream decisions, answer reaches the same JSON-RPC id, no Prometheus grant ──
    {
      const skipNoise = (rel: string) => rel.startsWith('workspace') || rel.endsWith('.log') || rel === 'external-agents.json';
      const before = hashTree(root, skipNoise);
      fs.writeFileSync(logFile, '');
      const approver = makeAdapter('ready');
      const cards: any[] = [];
      const result = await approver.runTurn({
        sessionId: 's3', cwd: workspace, text: 'APPROVAL please', signal: new AbortController().signal,
        emit: () => undefined,
        requestUser: (card, opts) => pending.createPendingRequest(
          { ...card, agentId: 'codex', sessionId: 's3' },
          {
            onRequest: (request) => {
              cards.push(request);
              setTimeout(() => {
                const answered = pending.respondToPendingRequest(request.requestId, { optionId: 'acceptForSession' }, { sessionId: 's3', agentId: 'codex' });
                assert.ok(answered.ok);
              }, 5);
            },
            signal: opts?.signal,
            cancelResponse: opts?.cancelResponse || { optionId: 'cancel' },
          },
        ),
      });
      assert.strictEqual(cards.length, 1);
      assert.deepStrictEqual(cards[0].options.map((o: any) => o.id), ['accept', 'acceptForSession', 'decline', 'cancel']);
      assert.strictEqual(cards[0].detail.command, 'npm test');
      assert.strictEqual(result.finalText, 'decision=acceptForSession');
      const answer = readLog().find((m) => m.id === 'srv-1' && m.method === undefined);
      assert.deepStrictEqual(answer.result, { decision: 'acceptForSession' }, 'answer went to the same upstream request id');
      // Answered twice, unknown id, wrong session: nothing changes.
      assert.strictEqual(pending.respondToPendingRequest(cards[0].requestId, { optionId: 'accept' }).ok, false);
      assert.strictEqual((pending.respondToPendingRequest('nope', { optionId: 'accept' }) as any).status, 404);
      const after = hashTree(root, skipNoise);
      assert.deepStrictEqual(after, before, 'no Prometheus approval/permission store was written');
      await approver.shutdown();
    }

    // ── a request with an option Codex did not offer is refused ──
    {
      const waiting = pending.createPendingRequest(
        { kind: 'command', title: 't', detail: {}, options: [{ id: 'accept', label: 'Allow', kind: 'allow_once' }], agentId: 'codex', sessionId: 's9' },
        { cancelResponse: { optionId: 'cancel' } },
      );
      const listed = pending.listPendingRequests('s9');
      assert.strictEqual(listed.length, 1);
      const bad = pending.respondToPendingRequest(listed[0].requestId, { optionId: 'always_allow' });
      assert.strictEqual((bad as any).status, 400);
      assert.strictEqual((pending.respondToPendingRequest(listed[0].requestId, { optionId: 'accept' }, { sessionId: 'other' }) as any).status, 404);
      assert.strictEqual(pending.cancelPendingRequests({ sessionId: 's9' }), 1);
      assert.deepStrictEqual(await waiting, { optionId: 'cancel' }, 'cancel never picks an allow option');
    }

    // ── unknown server request is declined, not hung ──
    {
      fs.writeFileSync(logFile, '');
      const unknown = makeAdapter('ready');
      const events: any[] = [];
      const result = await unknown.runTurn({
        sessionId: 's4', cwd: workspace, text: 'UNKNOWN thing', signal: new AbortController().signal,
        emit: (event) => events.push(event), requestUser: async () => { throw new Error('must not ask'); },
      });
      assert.strictEqual(result.status, 'completed');
      assert.strictEqual(result.finalText, 'declined-ok');
      assert.ok(events.some((e) => e.type === 'notice' && /declined/.test(e.text)));
      const reply = readLog().find((m) => m.id === 'srv-1' && m.method === undefined);
      assert.strictEqual(reply.error.code, -32601);
      await unknown.shutdown();
    }

    // ── pending requests are cancelled on abort; Codex gets `cancel` ──
    {
      fs.writeFileSync(logFile, '');
      const aborted = makeAdapter('ready');
      const controller = new AbortController();
      let seen = 0;
      const running = aborted.runTurn({
        sessionId: 's5', cwd: workspace, text: 'APPROVAL then stop', signal: controller.signal,
        emit: () => undefined,
        requestUser: (card, opts) => pending.createPendingRequest(
          { ...card, agentId: 'codex', sessionId: 's5' },
          { onRequest: () => { seen += 1; }, signal: opts?.signal, cancelResponse: opts?.cancelResponse || { optionId: 'cancel' } },
        ),
      });
      await waitFor(() => seen === 1);
      assert.strictEqual(pending.listPendingRequests('s5').length, 1);
      controller.abort('operator_abort');
      const result = await running;
      assert.strictEqual(pending.listPendingRequests('s5').length, 0, 'no request left waiting');
      const reply = readLog().find((m) => m.id === 'srv-1' && m.method === undefined);
      assert.deepStrictEqual(reply.result, { decision: 'cancel' });
      assert.ok(['interrupted', 'completed'].includes(result.status));
      await aborted.shutdown();
    }

    // ── mapping: legacy + permissions + question shapes ──
    {
      const legacy = mapCodexServerRequest('execCommandApproval', { conversationId: 't', callId: 'c', approvalId: null, command: ['git', 'status'], cwd: '/r', reason: null, parsedCmd: [] })!;
      assert.strictEqual(legacy.card.detail.command, 'git status');
      assert.deepStrictEqual(legacy.toResult({ optionId: 'denied' }), { decision: { denied: { rejection: 'Declined in Prometheus.' } } });
      assert.deepStrictEqual(legacy.toResult({ optionId: 'bogus' }), { decision: 'abort' });
      const perm = mapCodexServerRequest('item/permissions/requestApproval', { threadId: 't', turnId: 'u', itemId: 'i', environmentId: null, startedAtMs: 0, cwd: '/r', reason: 'net', permissions: { network: { enabled: true }, fileSystem: null } })!;
      assert.deepStrictEqual(perm.toResult({ optionId: 'session' }), { permissions: { network: { enabled: true } }, scope: 'session' });
      assert.deepStrictEqual(perm.toResult({ optionId: 'deny' }), { permissions: {}, scope: 'turn' });
      const q = mapCodexServerRequest('item/tool/requestUserInput', { threadId: 't', turnId: 'u', itemId: 'i', isBlocking: true, questions: [{ id: 'q1', header: 'Pick', question: 'Which?', isOther: false, isSecret: false, options: [{ label: 'A', description: '' }] }] })!;
      assert.deepStrictEqual(q.toResult({ optionId: 'submit', answers: { q1: ['A'] } }), { answers: { q1: { answers: ['A'] } } });
      assert.strictEqual(mapCodexServerRequest('item/tool/call', {}), null);
    }

    // ── shutdown kills the child: no orphan ──
    {
      const live = makeAdapter('ready');
      await live.verify();
      const pid = live.processId();
      assert.ok(pidAlive(pid), 'app-server child is running');
      await live.shutdown();
      await waitFor(() => !pidAlive(pid), 5000);
      assert.strictEqual(live.isRunning(), false);
    }

    await runSessionChecks({ root, workspace, fakeCommand, fakeEnv, readLog, logFile });
    console.log('external-agents regression: ok');
  } finally {
    for (const adapter of adapters) await adapter.shutdown().catch(() => undefined);
    store.setExternalAgentStorePathForTests(null);
  }
}

/** Session binding + turn branch checks (fake app-server only). */
async function runSessionChecks(ctx: Record<string, any>): Promise<void> {
  const { root, workspace, fakeCommand, fakeEnv } = ctx;
  const sessions = await import('../session');
  const store = await import('./store');
  const registry = await import('./registry');
  const runner = await import('./turn-runner');
  const { CodexAdapter } = await import('./adapters/codex');
  store.setExternalAgentStorePathForTests(path.join(root, 'external-agents.json'));
  store.updateExternalAgentEntry('codex', { enabled: true, lastStatus: 'ready', lastStatusText: 'Connected' });
  const adapter = new CodexAdapter({ resolveCommand: fakeCommand, env: fakeEnv('ready'), clientVersion: 'test', requestTimeoutMs: 5000 });
  registry.setExternalAgentAdapterForTests(adapter);

  try {
    // Native session: no binding, never enters the branch, cannot be bound later.
    sessions.getSession('ea_native');
    sessions.addMessage('ea_native', { role: 'user', content: 'hello', timestamp: Date.now() } as any, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
    const nativeBind = runner.bindExternalAgentForRequest('ea_native', null);
    assert.deepStrictEqual(nativeBind, { ok: true, binding: null, created: false });
    assert.strictEqual(sessions.getSessionExternalAgent('ea_native'), undefined);
    const late = runner.bindExternalAgentForRequest('ea_native', { id: 'codex' });
    assert.strictEqual(late.ok, false);
    assert.strictEqual((late as any).code, 'agent_locked');

    // The branch sits before every native step, and the native path still calls handleChat.
    const itSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'chat', 'pipeline', 'interactive-turn.ts'), 'utf8');
    const branchAt = itSource.indexOf('const externalBinding = getSessionExternalAgent(sessionId);');
    assert.ok(branchAt > 0, 'branch present');
    for (const marker of ['captureChatTurnRouteSnapshot(sessionId)', 'handleMainChatGoalCommand(', 'autoAttachChatInputResources(', 'addMessage(sessionId, userMsg', 'handleChat(']) {
      const at = itSource.indexOf(marker);
      assert.ok(at > branchAt, `branch precedes ${marker}`);
    }
    const hcSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'chat', 'pipeline', 'handle-chat.ts'), 'utf8');
    assert.ok(hcSource.includes('const boundAgent = getSessionExternalAgent(String(sessionId'), 'handleChat backstop present');

    // Imported chat + live agent are rejected.
    const imported = sessions.getSession('ea_imported');
    (imported as any).externalImport = { version: 1, source: { provider: 'codex' }, continuation: 'prometheus', sourceResume: 'unsupported', importedAt: new Date().toISOString() };
    const importBind = runner.bindExternalAgentForRequest('ea_imported', { id: 'codex' });
    assert.strictEqual((importBind as any).code, 'imported_chat');
    assert.throws(() => sessions.setSessionExternalAgent('ea_imported', { version: 1, agentId: 'codex', cwd: workspace, boundAt: new Date().toISOString() }));

    // New chat binds on the first message; a different agent later is agent_locked.
    const bind = runner.bindExternalAgentForRequest('ea_codex', { id: 'codex', cwd: workspace });
    assert.ok(bind.ok && bind.created && bind.binding?.agentId === 'codex');
    assert.strictEqual((runner.bindExternalAgentForRequest('ea_codex', { id: 'prometheus' }) as any).code, 'agent_locked');
    assert.ok(runner.bindExternalAgentForRequest('ea_codex', { id: 'codex' }).ok);
    assert.strictEqual((runner.bindExternalAgentForRequest('ea_badcwd', { id: 'codex', cwd: path.join(root, 'nope') }) as any).code, 'bad_cwd');

    // A real turn through the runner: SSE mapping, transcript, binding update.
    const events: Array<[string, any]> = [];
    const binding = sessions.getSessionExternalAgent('ea_codex')!;
    const result = await runner.runExternalAgentTurn({ sessionId: 'ea_codex', message: 'hi there', sendSSE: (e, d) => events.push([e, d]) }, binding);
    assert.strictEqual(result.text, 'Hello world');
    const names = events.map(([e]) => e);
    assert.deepStrictEqual(names.filter((n) => n === 'token').length, 2);
    assert.ok(names.indexOf('tool_call') < names.indexOf('tool_result'));
    const toolCall = events.find(([e]) => e === 'tool_call')![1];
    assert.strictEqual(toolCall.observed, true, 'tool rows are observed (display only)');
    assert.strictEqual(toolCall.external, true);
    const history = sessions.getSession('ea_codex').history;
    assert.strictEqual(history[history.length - 2].role, 'user');
    assert.strictEqual(history[history.length - 1].content, 'Hello world');
    assert.strictEqual((history[history.length - 1] as any).externalAgent.agentId, 'codex');
    const after = sessions.getSessionExternalAgent('ea_codex')!;
    assert.ok(after.upstreamSessionId?.startsWith('thr-'));
    assert.strictEqual(after.lastTurn?.status, 'completed');
    assert.strictEqual(sessions.getSession('ea_codex').title, 'hi there', 'named without a model call');

    // Persisted file carries the binding and nothing from the agent's auth.
    sessions.flushSession('ea_codex');
    const files = fs.readdirSync(root, { recursive: true } as any).map(String).filter((f: string) => /ea_codex\.json$/.test(f));
    assert.ok(files.length >= 1, 'session file written');
    const saved = JSON.parse(fs.readFileSync(path.join(root, files[0]), 'utf8'));
    assert.strictEqual(saved.externalAgent.agentId, 'codex');
    assert.ok(!JSON.stringify(saved).includes('someone@example.com'));

    // Slash commands that drive the native loop are refused with a plain line.
    const slash = await runner.runExternalAgentTurn({ sessionId: 'ea_codex', message: '/goal ship it', sendSSE: () => undefined }, after);
    assert.strictEqual(slash.externalAgent.status, 'refused');
    assert.match(slash.text, /doesn't apply here/);

    // Timers cannot target a bound chat.
    const timers = await import('../timers/timer-store');
    assert.throws(() => timers.createMainChatTimer({ sessionId: 'ea_codex', instruction: 'later', dueAt: new Date(Date.now() + 60_000) }), /connected agent/);

    // Turning the agent off: bound chat stays readable and says so; on again: usable.
    await registry.disableExternalAgent('codex');
    assert.strictEqual(adapter.isRunning(), false, 'idle process closed');
    const off = await runner.runExternalAgentTurn({ sessionId: 'ea_codex', message: 'still there?', sendSSE: () => undefined }, after);
    assert.strictEqual(off.externalAgent.status, 'refused');
    assert.match(off.text, /turned off/);
    assert.strictEqual((runner.bindExternalAgentForRequest('ea_new', { id: 'codex' }) as any).code, 'agent_unavailable');
    assert.ok(sessions.getSessionExternalAgent('ea_codex'), 'binding kept while off');
    const back = await registry.enableExternalAgent('codex');
    assert.strictEqual(back?.status, 'ready');
    const again = await runner.runExternalAgentTurn({ sessionId: 'ea_codex', message: 'back', sendSSE: () => undefined }, sessions.getSessionExternalAgent('ea_codex')!);
    assert.strictEqual(again.externalAgent.status, 'completed');

    // Upstream session missing: explicit message, never silently replaced.
    sessions.setSessionExternalAgent('ea_codex', { ...sessions.getSessionExternalAgent('ea_codex')!, upstreamSessionId: 'missing-1' });
    await adapter.shutdown();
    const missing = await runner.runExternalAgentTurn({ sessionId: 'ea_codex', message: 'x', sendSSE: () => undefined }, sessions.getSessionExternalAgent('ea_codex')!);
    assert.match(missing.text, /can't find this session/);
    assert.strictEqual(sessions.getSessionExternalAgent('ea_codex')!.upstreamSessionId, 'missing-1');
    assert.strictEqual(sessions.getSessionExternalAgent('ea_codex')!.lastTurn?.upstreamMissing, true, 'missing-session recovery survives normalization and reload');
    assert.ok(!runner.startFreshUpstreamSession('ea_codex')!.upstreamSessionId, 'fresh only on explicit request');
  } finally {
    await adapter.shutdown().catch(() => undefined);
    registry.setExternalAgentAdapterForTests(null);
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
