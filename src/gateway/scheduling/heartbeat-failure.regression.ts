import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HandleChatResult } from '../chat/chat-helpers';

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-heartbeat-failure-'));
  const ws = path.join(root, 'workspace');
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = ws;
  fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(path.join(ws, 'HEARTBEAT.md'), '# Heartbeat\n- Check queued tasks\n');
  const { SubagentHeartbeatManager, heartbeatThreadId } = await import('./heartbeat-runner');
  const { getConfig } = await import('../../config/config');
  const { getSession } = await import('../session');
  const events: any[] = [], messages: string[] = [];
  let reviews = 0;
  const retry = 'No final response was generated. Please retry.';
  let result: HandleChatResult = { type: 'chat', text: retry, noResultFailure: 'provider_failure' };
  const manager = new SubagentHeartbeatManager({
    configPath: path.join(root, 'heartbeat.json'), getMainSessionId: () => 'default',
    handleChat: async () => result, broadcast: e => events.push(e),
    deliverChannels: text => { messages.push(text); },
    reviewAllTeams: async () => { reviews++; return { reviewed: 0, failed: 0 }; },
  });
  manager.updateConfig({ reviewTeamsAfterRun: true });
  for (const id of ['main', 'scanner']) manager.registerAgent(id, ws);
  const status = (id: string) => manager.listAgentConfigs().find(e => e.agentId === id)?.lastResult;
  const file = (id: string) => path.join(getConfig().getConfigDir(), 'sessions', heartbeatThreadId(id) + '.json');
  for (const id of ['main', 'scanner']) {
    for (const failure of ['provider_failure', 'missing_final'] as const) {
      result = { type: 'chat', text: retry, noResultFailure: failure };
      await manager.tick(id);
      assert.equal(status(id), 'error');
    }
    result = { type: 'chat', text: 'HEARTBEAT_OK' };
    await manager.tick(id);
    assert.equal(status(id), 'ok');
    assert.equal(fs.existsSync(file(id)), false);
  }
  assert.deepEqual(events, []); assert.deepEqual(messages, []); assert.equal(reviews, 0);
  // Same wording without a diagnostic flag: never censor a model-authored result by text.
  result = { type: 'chat', text: retry };
  await manager.tick('scanner');
  assert.equal(status('scanner'), 'active');
  assert.equal(events[0]?.automatedSession?.id, heartbeatThreadId('scanner'));
  assert.equal(getSession(heartbeatThreadId('scanner')).history.at(-1)?.content, retry);
  assert.ok(messages[0]?.includes(retry)); assert.equal(reviews, 0);
  result = { type: 'execute', text: 'Saved the report before the stream stopped.' };
  await manager.tick('main');
  assert.equal(reviews, 1); assert.equal(messages.length, 2); assert.equal(events.length, 2);
  console.log('heartbeat-failure regression: PASS');
}
run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
