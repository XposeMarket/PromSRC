/**
 * Isolated real-worker / real-handleChat / scripted-provider regression.
 * Run: node scripts/test-background-review-followup.mjs
 * See test-background-review-followup.README.md for scope and limitations.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Must precede every application require: never read the operator's config/data.
const originalCwd = process.cwd();
const parentOwnedRoot = process.env.BACKGROUND_REVIEW_FOLLOWUP_TEST_ROOT;
const root = parentOwnedRoot || fs.mkdtempSync(path.join(os.tmpdir(), 'background-review-followup-'));
assert.ok(path.isAbsolute(root) && path.basename(root).startsWith('background-review-followup-'), 'use an isolated fixture root');
// Nest the replay harness's own mkdtemp root so parent cleanup owns everything.
process.env.TEMP = root;
process.env.TMP = root;
for (const key of ['PROMETHEUS_APP_DATA_DIR', 'PROMETHEUS_DATA_DIR', 'PROMETHEUS_WORKSPACE_DIR', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOME']) {
  process.env[key] = root;
}
process.env.PROMETHEUS_CONFIG_PATH = path.join(root, 'config.json');
// Preview intentionally rejects follow-up admission. Boot only the headless
// replay router (no gateway startup), using isolated roots and fail-closed I/O.
process.env.PROMETHEUS_PREVIEW_MODE = '0';
process.env.PROMETHEUS_MODEL_CALL_WORKERS = '0';
process.env.PROMETHEUS_CONTEXT_BUILD_WORKERS = '0';
process.env.PROMETHEUS_CHAT_NUM_CTX = '131072';
// Some audit/learning stores use cwd as their fallback. Contain those too.
process.chdir(root);
// A fixed model route keeps account selection out of this test; factory override
// below supplies all main and side-channel model responses in-process.
const FIRST = 'Review synthetic fixture FIRST_ASSIGNMENT_63a90; return a concise verdict.';
const QUESTION = 'NEW_QUESTION_8cb41: what exact internal specimen code did your tool report? Do not reread it.';
const FACT = 'TOOL_ONLY_SPECIMEN_05d848d7';
const VERDICT = 'FIRST_VERDICT_27cf1: the synthetic fixture passes review.';
const ANSWER = `FOLLOWUP_VERDICT_12a99: the recorded specimen code is ${FACT}.`;
assert.ok(!VERDICT.includes(FACT));
const networkAttempts: string[] = [];
function forbidNetwork(label: string): never {
  networkAttempts.push(label);
  throw new Error(`Network is forbidden in background review regression: ${label}`);
}
(globalThis as any).fetch = () => forbidNetwork('fetch');
for (const moduleName of ['node:http', 'node:https']) {
  const mod = require(moduleName);
  mod.request = () => forbidNetwork(`${moduleName}.request`);
  mod.get = () => forbidNetwork(`${moduleName}.get`);
}
require('node:net').Socket.prototype.connect = function () { return forbidNetwork('net.Socket.connect'); };

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
// Authority check for every provider request: tool outputs and the follow-up
// assignment may only appear in user/tool-role messages, never system authority.
function assertRoleAuthority(request: any, label: string, forbidden: string[]): void {
  const messages: any[] = Array.isArray(request?.messages) ? request.messages : [];
  for (const message of messages.filter((m) => m?.role === 'system')) {
    const content = String(message.content ?? '');
    for (const needle of forbidden) {
      assert.ok(!content.includes(needle), `${label}: system-authority message must not contain ${needle}`);
    }
  }
}
async function until(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await sleep(10);
  }
}

async function main(): Promise<void> {
  const { bootReplayHarness } = require('../src/testing/replay/harness');
  const { ScriptedProvider } = require('../src/testing/replay/scripted-provider');
  const h = await bootReplayHarness();
  const factory = require('../src/providers/factory');
  const runner = require('../src/gateway/tasks/task-runner');
  const router = require('../src/gateway/routes/chat.router');
  const executor = require('../src/gateway/agents-runtime/subagent-executor');
  const session = require('../src/gateway/session');
  const config = require('../src/config/config').getConfig();
  config.getConfigDir = () => root;
  config.getWorkspacePath = () => h.workspace;
  const workerCalls: any[][] = [];
  const dispatched: string[] = [];
  let reads = 0;
  let firstSession = '';
  let freshSession = '';
  // All tools fail closed except our synthetic read: no real filesystem read,
  // shell, browser, approval, account, connector or other tool can escape.
  executor.setToolExecutionOverrideForTesting(async (name: string, args: any) => {
    dispatched.push(name);
    if (name !== 'skill_list') throw new Error(`Unexpected tool execution: ${name}`);
    reads++;
    return { name, args, result: `Synthetic tool observation: specimen=${FACT}`, error: false };
  });
  const provider = new ScriptedProvider([
    (request: any) => {
      const text = JSON.stringify(request.messages);
      assert.ok(text.includes(FIRST), 'fresh initial provider request includes assignment');
      assert.ok(!text.includes(QUESTION), 'fresh assignment is not a follow-up');
      assert.ok(!text.includes(VERDICT), 'fresh assignment has no invented verdict');
      assert.ok(!text.includes(FACT), 'fact starts outside provider context');
      assertRoleAuthority(request, 'fresh request', [FACT, QUESTION, VERDICT]);
      return { toolCalls: [{ name: 'skill_list', args: { query: 'synthetic specimen lookup' }, id: 'fixture_read_1' }] };
    },
    (request: any) => {
      assert.ok(request.messages.some((m: any) => m.role === 'tool' && String(m.content).includes(FACT)), 'first verdict model call sees actual tool output');
      assertRoleAuthority(request, 'verdict request', [FACT]);
      return { text: VERDICT };
    },
    (request: any) => {
      // This is the FIRST model request of the SECOND worker invocation, not
      // merely the tool-loop's second request in the original assignment.
      const text = JSON.stringify(request.messages);
      assert.ok(text.includes(QUESTION), 'follow-up provider request gets the new question');
      assert.ok(text.includes(VERDICT), 'follow-up provider request gets first verdict');
      assert.ok(text.includes(FACT), 'follow-up provider request retains tool-only fact omitted from verdict');
      assert.equal(reads, 1, 'fact reaches second invocation without reread');
      // Authority: the question and the evidence are user/tool data; system carries only the round notice.
      assertRoleAuthority(request, 'follow-up request', [FACT, QUESTION, VERDICT]);
      const userOrTool = request.messages.filter((m: any) => m.role === 'user' || m.role === 'tool');
      assert.ok(userOrTool.some((m: any) => String(m.content).includes(FACT)), 'tool-only fact is carried by user/tool-role messages');
      const assignment = userOrTool.filter((m: any) => String(m.content).includes(QUESTION));
      assert.equal(assignment.length, 1, `the new question appears in exactly one user-role message (no duplicate assignment): ${JSON.stringify(request.messages.map((m: any) => [m.role, String(m.content).slice(0, 70)]))}`);
      assert.match(String(assignment[0].content), /\[NEW ASSIGNMENT:[^\]]*\][\s\S]*NEW_QUESTION_8cb41/, 'question is the labelled new assignment');
      assert.ok(!request.messages.some((m: any) => m.role === 'system' && String(m.content).includes(QUESTION)), 'new assignment is never system authority');
      assert.ok(!request.messages.some((m: any) => m.role === 'system' && String(m.content).includes('[NEW ASSIGNMENT')), 'assignment label never system authority');
      return { text: ANSWER };
    },
    (request: any) => {
      const text = JSON.stringify(request.messages);
      assert.ok(text.includes('FRESH_CONTROL_ASSIGNMENT_731f'), 'new spawn gets its own first assignment');
      assert.ok(!text.includes(QUESTION), 'unrelated fresh spawn does not receive prior question');
      assert.ok(!text.includes(VERDICT), 'unrelated fresh spawn does not inherit first verdict');
      assert.ok(!text.includes(FACT), 'unrelated fresh spawn does not inherit tool fact');
      assertRoleAuthority(request, 'fresh control request', [FACT, QUESTION, VERDICT]);
      return { text: 'FRESH_CONTROL_VERDICT_9bd4: complete.' };
    },
  ], { onExhausted: 'throw' });
  factory.setProviderOverrideForTesting(provider);
  runner.setBackgroundAgentDeps({
    broadcastWS() {},
    handleChat: async (...args: any[]) => {
      workerCalls.push(args);
      return router.handleChat(...args);
    },
  });
  try {
    const parent = 'synthetic_parent_32e93';
    session.setWorkspace(parent, h.workspace);
    const first = runner.backgroundSpawn({ prompt: FIRST, spawnerSessionId: parent, workDir: h.workspace,
      providerOverride: 'ollama', modelOverride: 'replay-model', toolCategories: [] });
    firstSession = first.backgroundSessionId;
    await until(() => runner.backgroundStatus(first.id)?.state === 'completed', 'first review completion');
    assert.equal(provider.requests.length, 2, 'first invocation made one read and one verdict model request');
    assert.equal(runner.backgroundStatus(first.id)?.result, VERDICT, 'actual first result omits the tool-only fact');
    assert.equal(workerCalls.length, 1);
    assert.equal(workerCalls[0][0], FIRST, 'fresh invocation receives first assignment directly');
    assert.equal(typeof runner.backgroundFollowUp, 'function', 'core backgroundFollowUp implementation must be present');
    const follow = await runner.backgroundFollowUp(first.id, QUESTION, {
      spawnerSessionId: parent, parentTurnId: 'synthetic_turn_2', requestId: 'synthetic_request_2',
    });
    assert.ok(!follow?.error, `follow-up admission failed: ${JSON.stringify(follow)}`);
    assert.ok(follow?.queued, `follow-up was not queued: ${JSON.stringify(follow)}`);
    assert.notEqual(follow.id, first.id, 'follow-up is a fresh immutable execution');
    assert.equal(follow.newExecution, true);
    await until(() => workerCalls.length === 2 && runner.backgroundStatus(follow.id)?.state === 'completed', 'follow-up completion');
    assert.equal(provider.requests.length, 3, 'follow-up makes exactly one further model request (no hidden reread)');
    assert.equal(workerCalls[1][1], firstSession, 'follow-up stays in the original worker session');
    assert.ok(String(workerCalls[1][0]).includes(QUESTION), 'second invocation is driven by new question');
    assert.notEqual(workerCalls[1][0], FIRST, 'second invocation must not rerun original assignment');
    assert.equal(reads, 1);
    assert.equal(runner.backgroundStatus(first.id)?.result, VERDICT, 'original execution verdict remains immutable');
    assert.deepEqual(dispatched, ['skill_list']);
    assert.ok(JSON.stringify(runner.backgroundStatus(follow.id)).includes('FOLLOWUP_VERDICT_12a99'), 'follow-up answer is the completed worker result');

    const fresh = runner.backgroundSpawn({ prompt: 'FRESH_CONTROL_ASSIGNMENT_731f: inspect a separate synthetic fixture.',
      spawnerSessionId: parent, workDir: h.workspace, providerOverride: 'ollama', modelOverride: 'replay-model', toolCategories: [] });
    freshSession = fresh.backgroundSessionId;
    await until(() => runner.backgroundStatus(fresh.id)?.state === 'completed', 'fresh control completion');
    assert.notEqual(freshSession, firstSession);
    assert.equal(provider.requests.length, 4);
    assert.equal(workerCalls.length, 3);
    assert.equal(reads, 1);
    assert.deepEqual(networkAttempts, [], 'no attempted network/provider/account calls');
    console.log('PASS background review follow-up: actual spawn -> handleChat -> provider.chat; follow-up request retains verdict + tool-only fact with exactly one total read; fresh assignment/new question and independent fresh spawn verified.');
  } finally {
    factory.setProviderOverrideForTesting(null);
    executor.setToolExecutionOverrideForTesting(null);
    await sleep(900); // Drain coalesced isolated persistence before cleanup.
    require('../src/gateway/memory-index/sqlite-store').closeSqliteMemoryConnections();
    const recall = require('../src/gateway/memory-index/recall-index');
    for (const directory of [root, h.root, h.workspace]) recall.closeRecallIndex(directory);
    h.shutdown();
    process.chdir(originalCwd);
    cleanupRoot();
  }
}
function cleanupRoot(): void {
  if (parentOwnedRoot) return; // Launcher removes it after SQLite/watch handles close.
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }); }
  catch (error: any) { console.warn(`Temporary fixture cleanup deferred until process exit (${root}): ${error.code}`); }
}
main().then(() => process.exit(0), error => { console.error(error); process.chdir(originalCwd); cleanupRoot(); process.exit(1); });
