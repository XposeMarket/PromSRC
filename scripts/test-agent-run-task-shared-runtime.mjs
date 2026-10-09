/**
 * Scenario test for the Reactor retirement (legacy cleanup PR-3).
 *
 * "Run task" (desktop + mobile), Telegram agent dispatch and team
 * schedule_job run_now all call runAgentTaskOnce(), which must run the agent
 * through the shared runInteractiveTurn/handleChat runtime (no node_call VM),
 * in a fresh per-run session, and report success/failure honestly.
 *
 * Run after `npm run build:backend`:
 *   node scripts/test-agent-run-task-shared-runtime.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-run-task-'));
process.env.PROMETHEUS_DATA_DIR = path.join(testRoot, 'data');
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(testRoot, 'workspace');
fs.mkdirSync(process.env.PROMETHEUS_DATA_DIR, { recursive: true });
fs.mkdirSync(process.env.PROMETHEUS_WORKSPACE_DIR, { recursive: true });

const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);

// Source contracts: the Reactor engine is gone and every dispatch path is wired to the shared runtime.
for (const retired of ['src/agents/reactor.ts', 'src/agents/spawner.ts', 'src/agents/provider-reactor.ts']) {
  assert.equal(fs.existsSync(path.join(root, retired)), false, `${retired} must stay retired`);
}
const startupSrc = fs.readFileSync(path.join(root, 'src/gateway/core/startup.ts'), 'utf8');
assert.doesNotMatch(startupSrc, /agents\/spawner/, 'startup must not load the Reactor spawner');
assert.equal((startupSrc.match(/spawnAgent: runAgentTaskLazy/g) || []).length, 1,
  'Telegram dispatch must use runAgentTaskOnce');
// team-tools.ts (Reactor-only team tools) was retired with the second tool registry;
// live schedule_job run_now goes through automation-executor instead.
assert.doesNotMatch(startupSrc, /tools\/team-tools|injectTeamToolDeps/, 'startup must not load the retired team-tools module');
assert.equal(fs.existsSync(path.join(root, 'src/tools/registry.ts')), false, 'the second tool registry must stay retired');

try {
  const { getConfig } = await load('dist/config/config.js');
  const channels = await load('dist/gateway/routes/channels.router.js');
  assert.equal(typeof channels.runAgentTaskOnce, 'function');

  const cfg = getConfig().getConfig();
  cfg.agents = [{ id: 'run_task_probe', name: 'Run Task Probe', model: 'openai/gpt-test' }];

  const calls = [];
  let mode = 'ok';
  channels.initChannelsRouter({
    cronScheduler: null,
    telegramChannel: null,
    telegramPersonaBots: null,
    telegramTeamRoomBridge: null,
    skillsManager: null,
    dispatchToAgent: async () => ({}),
    runInteractiveTurn: async (message, sessionId, sendSSE, _pinned, abortSignal, callerContext, _reasoning, _att, _prev, modelOverride, flags) => {
      calls.push({ message, sessionId, callerContext, modelOverride, flags, abortSignal });
      sendSSE('token', { text: 'working' });
      if (mode === 'fail') throw new Error('provider exploded');
      return { type: 'chat', text: `done: ${message}` };
    },
  });

  const ok = await channels.runAgentTaskOnce({
    agentId: 'run_task_probe',
    task: 'summarize the repo',
    context: '[CONTEXT REFERENCES]\n- ref one',
    timeoutMs: 30_000,
  });
  assert.equal(ok.success, true, ok.error);
  assert.equal(ok.result, 'done: summarize the repo');
  assert.equal(ok.agentName, 'Run Task Probe');
  assert.equal(calls.length, 1, 'exactly one shared-runtime turn per run');
  assert.match(calls[0].sessionId, /^subagent_task_run_task_probe_\d+$/, 'each run gets its own fresh session');
  assert.match(calls[0].callerContext, /\[SUBAGENT CHAT CONTEXT\]/, 'agent identity context is supplied');
  assert.match(calls[0].callerContext, /ref one/, 'context refs / caller context are forwarded');
  assert.equal(calls[0].flags?.directSubagentChat, true, 'runs on the shared subagent tool surface');
  assert.ok(ok.historyEntry && ok.historyEntry.success === true, 'successful run is recorded in agent run history');

  const second = await channels.runAgentTaskOnce({ agentId: 'run_task_probe', task: 'again' });
  assert.equal(second.success, true);
  assert.notEqual(calls[1].sessionId, calls[0].sessionId, 'runs must not share a session');

  mode = 'fail';
  const failed = await channels.runAgentTaskOnce({ agentId: 'run_task_probe', task: 'boom' });
  assert.equal(failed.success, false, 'runtime errors must surface as a failed run, not a silent success');
  assert.match(String(failed.error), /provider exploded/);
  assert.ok(failed.historyEntry && failed.historyEntry.success === false, 'failed run is recorded in agent run history');

  const missing = await channels.runAgentTaskOnce({ agentId: 'no_such_agent', task: 'x' });
  assert.equal(missing.success, false);
  assert.match(String(missing.error), /not found/);
  assert.equal(calls.length, 3, 'unknown agents must not start a turn');

  console.log('agent run-task shared runtime: ok');
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true });
}
process.exit(0);
