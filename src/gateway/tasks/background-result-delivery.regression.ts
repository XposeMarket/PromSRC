import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const stage = process.env.BG_DELIVERY_STAGE;
const root = process.env.BG_DELIVERY_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), 'bg-delivery-'));
const source = process.env.BG_RECOVERY_SOURCE || process.cwd();
const fullResult = 'DELIVERY_FULL_RESULT:' + 'r'.repeat(12_000);
async function child() {
  const { getConfig } = require(path.join(source, 'src/config/config.ts'));
  const config = getConfig();
  config.getConfigDir = () => root;
  config.getWorkspacePath = () => root;
  const runner = require(path.join(source, 'src/gateway/tasks/task-runner.ts'));
  const sessions = require(path.join(source, 'src/gateway/session.ts'));
  const runtime = require(path.join(source, 'src/gateway/live-runtime-registry.ts'));
  const store = stage === 'queue-only' ? undefined : require(path.join(source, 'src/gateway/tasks/background-execution-store.ts'));
  const parent = 'delivery-parent';
  let calls = 0;
  runner.setBackgroundAgentDeps({ broadcastWS() {}, async handleChat() { calls++; return { text: fullResult }; } });
  runtime.registerLiveRuntime({ kind: 'main_chat', label: 'test parent', sessionId: parent });
  if (stage === 'queue-only') {
    for (let i = 0; i < 2; i++) runtime.addPendingRuntimeSteerForSession(parent, {
      kind: 'background_agent_result', backgroundAgentId: 'bg-repeat', message: fullResult,
      clientRequestId: 'background_agent_result:bg-repeat',
    });
    assert.equal(runtime.consumePendingRuntimeSteersForSession(parent, 20).length, 1,
      'one logical completion must enqueue once even when publication retries');
    process.exit(0);
  }
  if (stage === 'seed') {
    const spawned = runner.backgroundSpawn({ prompt: 'complete once', spawnerSessionId: parent, workDir: root,
      providerOverride: 'openai_codex', modelOverride: 'gpt-6.1-sol', toolCategories: [] });
    fs.writeFileSync(path.join(root, 'id'), spawned.id);
    const waited = await runner.backgroundWait({ backgroundId: spawned.id, timeoutMs: 5000 });
    assert.equal(waited.completed, 1);
    assert.equal(calls, 1);
    assert(store.readBackgroundExecutions().some((item: any) => item.record.result === fullResult));
    // Leave a completed result before foreground delivery/ACK. Repeated enqueue
    // attempts in the actual registry must collapse, not just echo a request ID.
    for (let i = 0; i < 2; i++) runtime.addPendingRuntimeSteerForSession(parent, {
      kind: 'background_agent_result', backgroundAgentId: spawned.id, message: fullResult,
      clientRequestId: `background_agent_result:${spawned.id}`,
    });
    const events = runtime.consumePendingRuntimeSteersForSession(parent, 20);
    assert.equal(events.filter((event: any) => event.backgroundAgentId === spawned.id).length, 1);
    // Normal user correction repeats remain distinct.
    for (let i = 0; i < 2; i++) runtime.addPendingRuntimeSteerForSession(parent, { kind: 'correction', message: 'repeat' });
    assert.equal(runtime.consumePendingRuntimeSteersForSession(parent, 20).length, 2);
  } else {
    const id = fs.readFileSync(path.join(root, 'id'), 'utf8');
    runner.recoverBackgroundExecutions();
    assert.equal(calls, 0, 'completed worker must not execute again');
    const events = runtime.consumePendingRuntimeSteersForSession(parent, 20);
    if (stage === 'preack' || stage === 'ack') {
      assert.equal(events.length, 1, 'unacknowledged result must retry after process replacement');
      assert.equal(events[0].message, fullResult, 'complete result must not be replaced by public receipt truncation');
      const committed = sessions.persistBackgroundResultMessage(parent, id, fullResult);
      assert.equal(committed.inserted, stage === 'preack');
      const results = sessions.getSession(parent).history.filter((entry: any) => entry.messageKind === 'background_agent_result');
      assert.equal(results.length, 1, 'crash-after-history-before-ACK must not add another message');
      assert.equal(results[0].content, fullResult);
      if (stage === 'ack') {
        runner.acknowledgeBackgroundResult('wrong-parent', id);
        assert(!store.readBackgroundExecutions().find((item: any) => item.id === id).record.deliveredAt);
        runner.acknowledgeBackgroundResult(parent, id);
        assert(store.readBackgroundExecutions().find((item: any) => item.id === id).record.deliveredAt);
      }
    } else {
      assert.equal(events.length, 0, 'acknowledged result must not redeliver');
      assert.equal(sessions.getSession(parent).history.filter((entry: any) => entry.messageKind === 'background_agent_result').length, 1);
      const joined = await runner.backgroundJoin({ backgroundId: id, joinPolicy: 'wait_all' });
      assert.equal(joined.result, fullResult, 'notification ACK does not discard join result');
    }
  }
  process.exit(0);
}
if (stage) child().catch((error) => { console.error(error); process.exit(1); });
else {
  try {
    for (const phase of ['queue-only', 'seed', 'preack', 'ack', 'verify']) {
      const run = spawnSync(process.execPath, ['--import', 'tsx', __filename], {
        cwd: process.cwd(), encoding: 'utf8', timeout: 30_000,
        env: { ...process.env, BG_DELIVERY_STAGE: phase, BG_DELIVERY_ROOT: root, PROMETHEUS_CONFIG_PATH: path.join(root, 'config.json'),
          PROMETHEUS_APP_DATA_DIR: root, PROMETHEUS_DATA_DIR: root, PROMETHEUS_WORKSPACE_DIR: root, HOME: root, USERPROFILE: root },
      });
      assert.equal(run.status, 0, `${phase}: ${run.stdout}\n${run.stderr}`);
    }
    console.log('background result delivery regression: PASS (queue dedup, real process loss before/after history+ACK, full result, normal steers)');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
