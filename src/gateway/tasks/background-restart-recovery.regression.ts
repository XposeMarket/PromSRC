import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';

const stage = process.env.BG_RECOVERY_STAGE;
const root = process.env.BG_RECOVERY_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), 'bg-restart-'));
const source = process.env.BG_RECOVERY_SOURCE || process.cwd();
const idsFile = path.join(root, 'ids.json');

async function claimProcesses(): Promise<void> {
  const isolated = path.join(root, 'claims');
  fs.mkdirSync(isolated, { recursive: true });
  process.env.APPDATA = isolated; process.env.USERPROFILE = isolated; process.env.HOME = isolated;
  process.env.PROMETHEUS_WORKSPACE_DIR = isolated;
  const config = require(path.join(source, 'src/config/config.ts')).getConfig();
  config.getConfigDir = () => isolated;
  config.getWorkspacePath = () => isolated;
  const store = require(path.join(source, 'src/gateway/tasks/background-execution-store.ts'));
  assert.deepEqual(store.readBackgroundExecutions(), [], 'missing store root is empty, not executable');
  const directory = path.join(isolated, 'background-executions');
  fs.mkdirSync(directory);
  const file = path.join(directory, 'bg_claim-test.json');
  const original = { version: 1, id: 'bg_claim-test', ownerPid: process.pid, ownerToken: 'old-owner', savedAt: Date.now(),
    record: { id: 'bg_claim-test', state: 'queued', prompt: 'claim test', startedAt: Date.now(), timeoutMs: 1,
      joinPolicy: 'wait_all', toolCategories: [], outstandingTools: [], workDir: isolated } };
  const write = (value: any) => fs.writeFileSync(file, JSON.stringify(value));
  write(original);
  assert.equal(store.claimBackgroundExecution(store.readBackgroundExecutions()[0]), false, 'live owner cannot be claimed');
  for (const mutate of [
    (v: any) => { v.version = 2; }, (v: any) => { v.ownerPid = 'unknown'; },
    (v: any) => { v.record.state = 'invented'; }, (v: any) => { v.record.workDir = 'relative'; },
    (v: any) => { v.record.toolCategories = [42]; }, (v: any) => { v.record.outstandingTools = [{}]; },
    (v: any) => { v.record.allowedWorkPaths = ['relative']; }, (v: any) => { v.record.toolCeiling = []; },
  ]) {
    const invalid = JSON.parse(JSON.stringify(original)); mutate(invalid); write(invalid);
    assert.deepEqual(store.readBackgroundExecutions(), [], 'invalid executable schema must be rejected');
  }
  fs.writeFileSync(file, '{broken');
  assert.deepEqual(store.readBackgroundExecutions(), []);
  write(original);
  const children: ChildProcess[] = [];
  const launch = (phase: string) => {
    const child = spawn(process.execPath, ['--import', 'tsx', __filename], { cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, BG_RECOVERY_ROOT: isolated, BG_RECOVERY_STAGE: phase } });
    children.push(child);
    return child;
  };
  const message = (child: ChildProcess): Promise<any> => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error('claim child IPC timeout')); }, 30_000);
    const done = (value: any) => { cleanup(); resolve(value); };
    const exited = (code: number | null) => { cleanup(); reject(new Error(`claim child exited ${code}`)); };
    const cleanup = () => { clearTimeout(timeout); child.off('message', done); child.off('exit', exited); };
    child.once('message', done); child.once('exit', exited);
  });
  const stop = async (child: ChildProcess) => {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; }
  };
  try {
    // A real process holds the same SQLite write lock used by claims. Killing
    // it must release that lock without any stale-lock unlink protocol.
    const holder = launch('claim-holder');
    await message(holder);
    assert.equal(store.claimBackgroundExecution(original), false, 'held transaction fails closed');
    await stop(holder);
    // Give the envelope a known dead PID, avoiding assumptions about arbitrary PIDs.
    original.ownerPid = holder.pid!; write(original);
    const contenders = Array.from({ length: 4 }, () => launch('claim-contender'));
    await Promise.all(contenders.map(message));
    const results = contenders.map((child) => { const result = message(child); child.send('claim'); return result; });
    const outcomes = await Promise.all(results);
    assert.equal(outcomes.filter((result) => result.claimed).length, 1, 'exactly one real concurrent claimant wins');
    const current = store.readBackgroundExecutions()[0];
    assert(contenders.some((child) => child.pid === current.ownerPid));
    assert.equal(store.claimBackgroundExecution(current), false, 'winner ownership remains live');
    assert(!fs.existsSync(`${file}.claim`));
    assert(!fs.readdirSync(directory).some((name) => name.endsWith('.tmp') && !name.includes(`.${holder.pid}.`)),
      'returning claimants clean temporary payloads; killed process may leave a non-authoritative temp');
    await Promise.all(contenders.map(stop));
    assert.equal(store.claimBackgroundExecution(store.readBackgroundExecutions()[0]), true, 'dead winner can be recovered again');
    console.log('PASS claim schema/root/live-owner, killed SQLite lock holder, four concurrent children and second recovery');
  } finally { await Promise.all(children.map(stop)); }
}

async function child(): Promise<void> {
  // No production sessions, ledgers, receipts, providers or models are used.
  const { getConfig } = require(path.join(source, 'src/config/config.ts'));
  const config = getConfig();
  config.getConfigDir = () => root;
  config.getWorkspacePath = () => root;
  if (stage?.startsWith('claim-')) {
    const store = require(path.join(source, 'src/gateway/tasks/background-execution-store.ts'));
    const envelope = store.readBackgroundExecutions()[0];
    assert(envelope);
    if (stage === 'claim-holder') {
      const Database = require('better-sqlite3');
      const db = new Database(path.join(root, 'background-executions', 'claims.sqlite'));
      db.exec('BEGIN IMMEDIATE');
      process.send!({ ready: true });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      throw new Error('claim holder must be killed inside SQLite transaction');
    }
    setInterval(() => {}, 1000); // keep the winning PID live until parent kills it
    process.send!({ ready: true });
    process.once('message', () => {
      process.send!({ claimed: store.claimBackgroundExecution(envelope) });
      // Keep winner alive until every contender has observed its ownership.
    });
    return;
  }
  const runner = require(path.join(source, 'src/gateway/tasks/task-runner.ts'));
  const session = require(path.join(source, 'src/gateway/session.ts'));
  const mode = process.env.BG_RECOVERY_MODE || 'safe';
  let calls = 0;
  runner.setBackgroundAgentDeps({ broadcastWS() {}, async handleChat(prompt: string, sid: string, sse: any, ...args: any[]) {
    calls++;
    if (stage === 'seed' && (mode === 'planned' || mode === 'cancelled')) {
      const registry = require(path.join(source, 'src/gateway/live-runtime-registry.ts'));
      const runtime = registry.listLiveRuntimes().find((entry: any) => entry.sessionId === sid);
      assert(runtime);
      const signal = args[1] as AbortSignal;
      const stopped = new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      if (mode === 'planned') require(path.join(source, 'src/gateway/runtime-recovery.ts')).prepareActiveRuntimesForGatewayShutdown();
      else assert.equal(registry.abortLiveRuntime(runtime.id).ok, true);
      await stopped;
      return { text: 'NOT_A_SUCCESS_AFTER_ABORT' };
    }
    if (stage === 'seed') {
      session.addMessage(sid, { role: 'assistant', content: 'CHECKPOINT_ALREADY_DONE', timestamp: Date.now() });
      sse('tool_call', { name: 'web_fetch', toolCallId: 'call-one', args: { url: 'https://example.invalid' } });
      if (mode !== 'unsafe') sse('tool_result', { name: 'web_fetch', toolCallId: 'call-one', result: 'completed read' });
      sse('token', { text: 'checkpoint' });
      process.exit(0); // actual process replacement, not clearing an in-memory map
    }
    assert.match(prompt, /Continue background task/);
    assert.match(prompt, /ORIGINAL_ASSIGNMENT/);
    assert(session.getSession(sid).history.some((entry: any) => entry.content === 'CHECKPOINT_ALREADY_DONE') || ['queued', 'planned'].includes(mode));
    assert.equal(session.getWorkspace(sid), root);
    assert.equal(args[3], 'gpt-5.6-sol'); // handleChat positional modelOverride
    assert.deepEqual(args[5], ['web_fetch']); // persisted ceiling, not new parent defaults
    assert.match(args[2], /provider=openai_codex/);
    const store = require(path.join(source, 'src/gateway/tasks/background-execution-store.ts'));
    const restored = store.readBackgroundExecutions()[0].record;
    assert.equal(restored.workDir, root);
    assert.deepEqual(restored.allowedWorkPaths, [path.join(root, 'extra')]);
    assert.deepEqual(restored.resourceIds, ['resource-test']);
    return { text: 'FULL_RESULT:' + 'x'.repeat(12_000) } as any;
  } });
  if (stage === 'seed') {
    const { recordSessionToolCeiling } = require(path.join(source, 'src/gateway/agents-runtime/tool-ceiling.ts'));
    recordSessionToolCeiling('parent-test', ['web_fetch']);
    const status = runner.backgroundSpawn({ prompt: 'ORIGINAL_ASSIGNMENT', spawnerSessionId: 'parent-test', workDir: root,
      modelOverride: 'gpt-5.6-sol', providerOverride: 'openai_codex', toolCategories: [], timeoutMs: 1,
      allowedWorkPaths: [path.join(root, 'extra')], resourceIds: ['resource-test'],
      ...(mode === 'custom' ? { tools: [{ type: 'function', function: { name: 'private_custom' } }] } : {}) });
    fs.writeFileSync(idsFile, JSON.stringify([status.id]));
    if (mode === 'queued' || mode === 'custom') process.exit(0);
    if (mode === 'planned' || mode === 'cancelled') {
      for (let i = 0; i < 200; i++) {
        const current = runner.backgroundStatus(status.id);
        if ((mode === 'cancelled' && current.state === 'failed') || (mode === 'planned' && current.state === 'in_progress' && calls === 1)) {
          await new Promise((resolve) => setTimeout(resolve, 30));
          const store = require(path.join(source, 'src/gateway/tasks/background-execution-store.ts'));
          const saved = store.readBackgroundExecutions().find((entry: any) => entry.id === status.id).record;
          assert.equal(saved.state, mode === 'planned' ? 'in_progress' : 'failed');
          process.exit(0);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('abort transition did not settle');
    }
    await new Promise(() => {});
  }
  const [id] = JSON.parse(fs.readFileSync(idsFile, 'utf8'));
  assert.equal(typeof runner.recoverBackgroundExecutions, 'function', 'durable same-ID execution recovery must exist');
  if (stage === 'preview') {
    process.env.PROMETHEUS_PREVIEW_MODE = '1';
    assert.deepEqual(runner.recoverBackgroundExecutions(), []);
    assert.equal(calls, 0);
  } else if (stage === 'hosted') {
    assert.deepEqual(runner.recoverBackgroundExecutions({ isHostedElsewhere: () => true }), []);
    assert.equal(calls, 0);
  } else if (stage === 'recover') {
    runner.recoverBackgroundExecutions();
    assert.deepEqual(runner.recoverBackgroundExecutions(), []);
    const joined = await runner.backgroundJoin({ backgroundId: id, joinPolicy: 'wait_all' });
    if (['unsafe', 'custom', 'missing', 'cancelled'].includes(mode)) {
      assert.equal(calls, 0);
      assert.equal(joined.state, 'failed');
      assert.match(joined.error, mode === 'cancelled' ? /[Aa]bort|[Cc]ancel/ : /Recovery blocked/);
    } else {
      assert.equal(calls, 1);
      assert.equal(joined.id, id);
      assert.equal(joined.state, 'completed');
      assert(joined.result.length > 12_000, 'authoritative result must not truncate at receipt limit');
      assert.equal(joined.merged, true);
    }
  } else if (stage === 'consumed') {
    runner.recoverBackgroundExecutions();
    const joined = await runner.backgroundJoin({ backgroundId: id, joinPolicy: 'wait_all' });
    assert.equal(calls, 0);
    assert.equal(joined.merged, false, 'join consumption must survive replacement');
    if (mode === 'safe' || mode === 'queued') assert(joined.result.length > 12_000);
  }
  process.exit(0);
}
if (stage) child().catch((error) => { console.error(error); process.exit(1); });
else void (async () => {
  try {
    await claimProcesses();
    for (const mode of ['safe', 'queued', 'unsafe', 'custom', 'missing', 'planned', 'cancelled']) {
      const isolated = path.join(root, mode);
      fs.mkdirSync(isolated, { recursive: true });
      for (const phase of ['seed', 'preview', 'hosted', 'recover', 'consumed']) {
        if (mode === 'missing' && phase === 'preview') {
          const directory = path.join(isolated, 'background-executions');
          const filename = path.join(directory, fs.readdirSync(directory).find((name) => name.endsWith('.json'))!);
          const envelope = JSON.parse(fs.readFileSync(filename, 'utf8'));
          envelope.record.workDir = path.join(isolated, 'removed-work-root');
          fs.writeFileSync(filename, JSON.stringify(envelope));
        }
        const result = spawnSync(process.execPath, ['--import', 'tsx', __filename], { cwd: process.cwd(), encoding: 'utf8', timeout: 60_000,
          env: { ...process.env, BG_RECOVERY_ROOT: isolated, BG_RECOVERY_STAGE: phase, BG_RECOVERY_MODE: mode,
            PROMETHEUS_WORKSPACE_DIR: isolated, APPDATA: isolated, USERPROFILE: isolated, HOME: isolated } });
        assert.equal(result.status, 0, `${mode}/${phase}: ${result.stdout}\n${result.stderr}`);
      }
    }
    console.log('PASS background restart recovery: process replacement, same ID/history/route/scope, queued, unsafe/custom blocking, preview/host gates, full result and consumed merge');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
