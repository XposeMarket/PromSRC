import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const stage = process.env.BG_RECOVERY_STAGE;
const root = process.env.BG_RECOVERY_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), 'bg-restart-'));
const source = process.env.BG_RECOVERY_SOURCE || process.cwd();
const idsFile = path.join(root, 'ids.json');
async function child(): Promise<void> {
  // No production sessions, ledgers, receipts, providers or models are used.
  const { getConfig } = require(path.join(source, 'src/config/config.ts'));
  const config = getConfig();
  config.getConfigDir = () => root;
  config.getWorkspacePath = () => root;
  const runner = require(path.join(source, 'src/gateway/tasks/task-runner.ts'));
  const session = require(path.join(source, 'src/gateway/session.ts'));
  const mode = process.env.BG_RECOVERY_MODE || 'safe';
  let calls = 0;
  runner.setBackgroundAgentDeps({ broadcastWS() {}, async handleChat(prompt: string, sid: string, sse: any, ...args: any[]) {
    calls++;
    if (stage === 'seed') {
      session.addMessage(sid, { role: 'assistant', content: 'CHECKPOINT_ALREADY_DONE', timestamp: Date.now() });
      sse('tool_call', { name: 'web_fetch', toolCallId: 'call-one', args: { url: 'https://example.invalid' } });
      if (mode !== 'unsafe') sse('tool_result', { name: 'web_fetch', toolCallId: 'call-one', result: 'completed read' });
      sse('token', { text: 'checkpoint' });
      process.exit(0); // actual process replacement, not clearing an in-memory map
    }
    assert.match(prompt, /Continue background task/);
    assert.match(prompt, /ORIGINAL_ASSIGNMENT/);
    assert(session.getSession(sid).history.some((entry: any) => entry.content === 'CHECKPOINT_ALREADY_DONE') || mode === 'queued');
    assert.equal(session.getWorkspace(sid), root);
    assert.equal(args[3], 'gpt-5.6-sol'); // handleChat positional modelOverride
    assert.deepEqual(args[5], ['web_fetch']); // persisted ceiling, not new parent defaults
    return { text: 'FULL_RESULT:' + 'x'.repeat(12_000) } as any;
  } });
  if (stage === 'seed') {
    const { recordSessionToolCeiling } = require(path.join(source, 'src/gateway/agents-runtime/tool-ceiling.ts'));
    recordSessionToolCeiling('parent-test', ['web_fetch']);
    const status = runner.backgroundSpawn({ prompt: 'ORIGINAL_ASSIGNMENT', spawnerSessionId: 'parent-test', workDir: root,
      modelOverride: 'gpt-5.6-sol', providerOverride: 'openai_codex', toolCategories: [], timeoutMs: 1,
      ...(mode === 'custom' ? { tools: [{ type: 'function', function: { name: 'private_custom' } }] } : {}) });
    fs.writeFileSync(idsFile, JSON.stringify([status.id]));
    if (mode === 'queued' || mode === 'custom') process.exit(0);
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
    if (mode === 'unsafe' || mode === 'custom') {
      assert.equal(calls, 0);
      assert.equal(joined.state, 'failed');
      assert.match(joined.error, /Recovery blocked/);
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
else {
  try {
    for (const mode of ['safe', 'queued', 'unsafe', 'custom']) {
      const isolated = path.join(root, mode);
      fs.mkdirSync(isolated, { recursive: true });
      for (const phase of ['seed', 'preview', 'hosted', 'recover', 'consumed']) {
        const result = spawnSync(process.execPath, ['--import', 'tsx', __filename], { cwd: process.cwd(), encoding: 'utf8', timeout: 60_000,
          env: { ...process.env, BG_RECOVERY_ROOT: isolated, BG_RECOVERY_STAGE: phase, BG_RECOVERY_MODE: mode,
            PROMETHEUS_WORKSPACE_DIR: isolated, APPDATA: isolated, USERPROFILE: isolated, HOME: isolated } });
        assert.equal(result.status, 0, `${mode}/${phase}: ${result.stdout}\n${result.stderr}`);
      }
    }
    console.log('PASS background restart recovery: process replacement, same ID/history/route/scope, queued, unsafe/custom blocking, preview/host gates, full result and consumed merge');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
