import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildTools } from '../tool-builder';
import { normalizeBackgroundSpawnToolCategories, resolveBackgroundAgentModelRouting } from './task-runner';
import { readChatRouterSource } from '../../testing/chat-router-source';
import {
  BACKGROUND_WORKER_WITHHELD_TOOL_NAMES,
  backgroundWorkerToolRefusal,
  backgroundWorkerWithheldReason,
  evaluateToolDispatch,
  isBackgroundSpawnWorkerSession,
  registerBackgroundSpawnWorkerSession,
  toolNameSetOf,
} from '../chat/tool-dispatch-policy';

assert.deepEqual(resolveBackgroundAgentModelRouting({ providerId: 'openai_codex', model: 'sol', reasoningEffort: 'medium' }), {
  providerId: 'openai_codex', model: 'gpt-5.6-sol', reasoningEffort: 'medium', source: 'background_spawn.override',
});
assert.equal(resolveBackgroundAgentModelRouting({ providerId: 'openai_codex', model: 'luna' }).model, 'gpt-5.6-luna');
assert.equal(resolveBackgroundAgentModelRouting({ providerId: 'anthropic', model: 'opus-4.8' }).model, 'claude-opus-4-8');

// Regression for the background_spawn tool-surface leak observed 2026-09-19:
// a read-only recon spawn had 8 categories / 162 tools provisioned because
// handleChat ran the keyword auto-activation planner over the task prompt.
// The prompt merely *mentioned* browser/desktop/agents/workspace/etc.
//
// Contract after the fix:
//  1. Spawn workers start with core tools + spawner-declared tool_categories only.
//  2. The task prompt is never keyword-scanned for categories
//     (handleChat is called with skipAutomaticToolCategoryActivation).
//  3. Declared categories are normalized, deduped, and capped.

const deps = {
  getMCPManager: () => ({ getAllTools: () => [] }),
  skipDynamicExtensionTools: true,
};

// A prompt that name-drops nearly every category. Pre-fix this provisioned
// browser_automation, desktop_automation, agents_and_teams, workspace_write,
// automation_sessions, external_apps, integration_admin, model_management.
const RECON_PROMPT = [
  'READ-ONLY recon. Map the browser session router, the desktop screenshot helper,',
  'the agent/team dispatch wrapper, the workspace_edit executor, prometheus_thread_ops,',
  'the x_search_ops connector, connection_ops integration setup, and get_agent_models.',
  'Do NOT edit files.',
].join(' ');

// 1 + 3: normalization
assert.deepEqual(normalizeBackgroundSpawnToolCategories(undefined), []);
// A bare string is a single category, not an empty grant. Returning [] here
// silently downgraded the spawn to core-only while the spawner believed the
// category was granted — invisible at runtime, and the worker then burns many
// native round trips replacing one shell command.
assert.deepEqual(
  normalizeBackgroundSpawnToolCategories('workspace_write'),
  ['workspace_write'],
  'a bare string category must be accepted, not silently dropped',
);
assert.deepEqual(
  normalizeBackgroundSpawnToolCategories('browser'),
  ['browser_automation'],
  'a bare string category must still normalize legacy aliases',
);
assert.deepEqual(normalizeBackgroundSpawnToolCategories('not_a_category'), []);
assert.deepEqual(normalizeBackgroundSpawnToolCategories(''), []);
assert.deepEqual(normalizeBackgroundSpawnToolCategories(42), []);
assert.deepEqual(
  normalizeBackgroundSpawnToolCategories(['workspace_write', 'workspace_write', 'not_a_category', 'browser']),
  ['workspace_write', 'browser_automation'],
  'declared categories must normalize legacy aliases, dedupe, and drop unknown ids',
);
const tooMany = normalizeBackgroundSpawnToolCategories([
  'browser_automation', 'desktop_automation', 'agents_and_teams', 'workspace_write',
  'advanced_memory', 'media_assets', 'media_generation', 'automations', 'runtime_admin',
  'integration_admin', 'external_apps',
]);
assert.ok(tooMany.length <= 8, 'declared category list must be capped: ' + JSON.stringify(tooMany));

// 1: surface shape for a core-only spawn vs a declared-category spawn
const coreSurface = buildTools(deps, new Set());
const coreNames = new Set(coreSurface.map((tool: any) => String(tool?.function?.name || '')));
assert.equal(coreNames.has('request_tool_category'), true, 'spawn workers must keep request_tool_category to escalate');
assert.equal(coreNames.has('workspace_edit'), false, 'core-only spawn must not expose workspace_edit');
assert.equal(coreNames.has('browser_session'), false, 'core-only spawn must not expose browser_session');
assert.equal(coreNames.has('desktop_screen'), false, 'core-only spawn must not expose desktop_screen');
// Terminal access is the expensive omission: without workspace_run a worker
// rebuilds one shell command out of many native read/grep round trips. Pin the
// fact so the tool-surface notice in task-runner stays truthful.
assert.equal(coreNames.has('workspace_run'), false, 'core-only spawn must not expose workspace_run (terminal)');

const declared = buildTools(deps, new Set(normalizeBackgroundSpawnToolCategories(['workspace_write'])));
const declaredNames = new Set(declared.map((tool: any) => String(tool?.function?.name || '')));
assert.equal(declaredNames.has('workspace_edit'), true, 'declared workspace_write must expose workspace_edit');
assert.equal(declaredNames.has('workspace_run'), true, 'declared workspace_write must expose workspace_run (terminal)');
assert.equal(declaredNames.has('browser_session'), false, 'declared workspace_write must not drag in browser tools');
assert.ok(
  declared.length < coreSurface.length + 40,
  `declared single-category surface unexpectedly large: ${declared.length} tools (core ${coreSurface.length})`,
);

// 2: static contract. The spawn runner must opt out of automatic category
// activation, and the router must honour that flag before running the planner.
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const taskRunnerSource = readFileSync(path.join(repoRoot, 'src', 'gateway', 'tasks', 'task-runner.ts'), 'utf8');
const chatRouterSource = readChatRouterSource();
assert.match(
  taskRunnerSource,
  /skipAutomaticToolCategoryActivation:\s*true/,
  'task-runner background spawn must call handleChat with skipAutomaticToolCategoryActivation: true',
);
assert.match(
  taskRunnerSource,
  /setActivatedToolCategories\(sessionId,\s*Array\.isArray\(record\.toolCategories\)/,
  'task-runner must seed the worker session from record.toolCategories only',
);
assert.match(
  chatRouterSource,
  /!isSupervisionLoop\s*&&\s*!skipAutomaticToolCategoryActivation\s*\n?\s*\?\s*autoActivateToolCategories\(/,
  'chat.router must gate autoActivateToolCategories on skipAutomaticToolCategoryActivation',
);
assert.match(
  RECON_PROMPT,
  /browser|desktop|agent|workspace_edit|thread_ops|x_search_ops|connection_ops|get_agent_models/,
  'sanity: recon prompt must still contain the category trigger words this test guards against',
);

// 4: background workers lose tools that act on the user's live chat or start
// more workers (observed: a small model spawned a nested "placeholder" agent it
// could not cancel). Stripped from the surface AND refused at dispatch.
const WITHHELD = ['set_current_model', 'switch_model', 'update_heartbeat', 'background_ops'];
assert.deepEqual([...BACKGROUND_WORKER_WITHHELD_TOOL_NAMES].sort(), [...WITHHELD].sort());

// A worker is identified by a live round, not by its session name: every
// spawn/follow-up/steer/resume round registers its session when it starts and
// releases it when it settles. A webhook can be configured with any sessionKey,
// so a background_ name that no spawn started (for example background_custom)
// is not a worker, and neither is a worker's id once its round has settled.
const refusedAll = (session: string) => WITHHELD.every((name) => /not available to background workers/.test(backgroundWorkerToolRefusal(name, session) || ''));
const refusedNone = (session: string) => WITHHELD.every((name) => backgroundWorkerToolRefusal(name, session) === null);
assert.equal(isBackgroundSpawnWorkerSession('background_custom'), false, 'configured background_custom session keeps the tools');
assert.ok(refusedNone('background_custom'), 'background_custom may call all four tools');
assert.equal(isBackgroundSpawnWorkerSession('background_bg_123'), false, 'unregistered background_ name is not a worker');
const releaseRound1 = registerBackgroundSpawnWorkerSession('background_bg_123');
assert.equal(isBackgroundSpawnWorkerSession('background_bg_123'), true, 'live background_ops spawn round is a worker');
assert.ok(refusedAll('background_bg_123'), 'live worker round is refused all four tools');
assert.equal(isBackgroundSpawnWorkerSession('background_custom'), false, 'registering one worker does not mark other background_ names');
releaseRound1();
assert.equal(isBackgroundSpawnWorkerSession('background_bg_123'), false, 'settled round releases the session');
assert.ok(refusedNone('background_bg_123'), 'a non-worker run reusing the settled session id keeps all four tools');
releaseRound1();
assert.equal(isBackgroundSpawnWorkerSession('background_bg_123'), false, 'a second release is a no-op');
// A second round on the same session (follow-up) is refused again.
const releaseRound2 = registerBackgroundSpawnWorkerSession('background_bg_123');
assert.ok(refusedAll('background_bg_123'), 'second round on the same session is refused again');
// Overlapping rounds: a new round can start while the previous one is still
// settling. The first to settle must not release the other.
const releaseRound3 = registerBackgroundSpawnWorkerSession('background_bg_123');
releaseRound2();
releaseRound2();
assert.ok(refusedAll('background_bg_123'), 'overlapping round stays a worker after the other round settles (double release included)');
releaseRound3();
assert.ok(refusedNone('background_bg_123'), 'all overlapping rounds settled: session released');
// Follow-up after a gateway restart: this process starts with an empty
// registry, and the follow-up round's start registers the conversation session
// again before its first tool call.
const FOLLOW_UP_SESSION = 'background_bg_conv_after_restart';
assert.equal(isBackgroundSpawnWorkerSession(FOLLOW_UP_SESSION), false, 'fresh process: not yet registered');
const releaseFollowUp = registerBackgroundSpawnWorkerSession(FOLLOW_UP_SESSION);
assert.equal(isBackgroundSpawnWorkerSession(FOLLOW_UP_SESSION), true, 'follow-up round start registers the worker again');
assert.match(backgroundWorkerToolRefusal('background_ops', FOLLOW_UP_SESSION) || '', /not available to background workers/, 'follow-up worker is refused');
releaseFollowUp();
// Registration lives where every worker round starts, before the round's
// async body, and the release is in the promise's finally, which runs whether
// the round completed, failed, was cancelled or threw. Every round path
// (recover after restart, spawn, follow-up, steer continuation) goes through it.
assert.match(taskRunnerSource, /function startBackgroundExecution\([^)]*\)[^{]*\{[\s\S]{0,400}?const releaseWorkerSession = registerBackgroundSpawnWorkerSession\(backgroundRuntimeSessionId\(record\)\);\s*(?:\/\/[^\n]*\n\s*)*const execution = \(async \(\) => \{/,
  'startBackgroundExecution must register the worker session before the round runs');
assert.match(taskRunnerSource, /return execution\.finally\(\(\) => \{[\s\S]{0,200}?releaseWorkerSession\(\);/,
  'startBackgroundExecution must release the worker session when the round settles');
for (const fn of ['recoverBackgroundExecutions', 'backgroundSpawn', 'backgroundFollowUp', 'backgroundSteer']) {
  const start = taskRunnerSource.indexOf(`export function ${fn}(`);
  assert.ok(start >= 0, `${fn} exists`);
  const next = taskRunnerSource.indexOf('\nexport function ', start + 10);
  assert.match(taskRunnerSource.slice(start, next < 0 ? undefined : next), /startBackgroundExecution\(/, `${fn} must start its round through startBackgroundExecution`);
}
assert.equal((taskRunnerSource.match(/handleChat\(/g) || []).length, 1, 'the only worker handleChat call is inside startBackgroundExecution');
assert.equal(isBackgroundSpawnWorkerSession('main_chat'), false, 'main chat keeps the tools');
assert.equal(isBackgroundSpawnWorkerSession('meta_coordinator_abc'), false, 'team coordinator keeps the tools');
assert.equal(isBackgroundSpawnWorkerSession('webhook_abc'), false, 'webhook runs keep the tools');
assert.equal(isBackgroundSpawnWorkerSession('team_x_agent_y'), false, 'team members keep the tools');
assert.equal(isBackgroundSpawnWorkerSession('cron_job_1'), false, 'scheduled jobs keep the tools');
// Standalone subagents run in executionMode background_agent (background-task-runner
// selects it for task.subagentProfile) with a subagent_<id>_<ts> session: not a worker.
const STANDALONE_SUBAGENT_SESSION = 'subagent_researcher_1732500000000';
assert.equal(isBackgroundSpawnWorkerSession(STANDALONE_SUBAGENT_SESSION), false, 'standalone subagent keeps the tools');
assert.match(taskRunnerSource, /return `background_\$\{String\(record\.conversationId \|\| record\.id \|\| ''\)\.trim\(\)\}`;/,
  'spawn and follow-up rounds must keep running in the background_ conversation session');
assert.match(readFileSync(path.join(repoRoot, 'src', 'gateway', 'agents-runtime', 'subagent-manager.ts'), 'utf8'), /const subagentSessionId = `subagent_/,
  'standalone subagent sessions must not use the background_ prefix');

// Main chat surface (core + automation_scheduling for update_heartbeat) offers all four.
const mainSurface = toolNameSetOf(buildTools(deps, new Set(['automation_scheduling'])));
for (const name of WITHHELD) assert.equal(mainSurface.has(name), true, `main chat must offer ${name}`);
// The worker strip removes exactly those; approval gates stay.
const workerSurface = new Set([...mainSurface].filter((name) => !BACKGROUND_WORKER_WITHHELD_TOOL_NAMES.includes(name)));
for (const name of WITHHELD) assert.equal(workerSurface.has(name), false, `worker must not see ${name}`);
for (const name of ['ask_prometheus_questions', 'request_final_action_approval', 'write_note', 'request_tool_category']) {
  assert.equal(workerSurface.has(name), mainSurface.has(name), `worker keeps ${name}`);
}
assert.equal(mainSurface.has('ask_prometheus_questions'), true);
assert.equal(mainSurface.has('request_final_action_approval'), true);

// handleChat wires the strip and the dispatch refusal to the worker predicate.
assert.match(chatRouterSource, /const isBackgroundWorkerRun = isBackgroundSpawnWorkerSession\(sessionId\);/);
assert.match(chatRouterSource, /\.\.\.\(isBackgroundWorkerRun \? BACKGROUND_WORKER_WITHHELD_TOOL_NAMES : \[\]\)/);
assert.match(chatRouterSource, /withheldReason: \(name\) => backgroundWorkerToolRefusal\(name, sessionId\)/);
// executeTool enforces the same check for every execution (composites, tool_call).
assert.match(
  readFileSync(path.join(repoRoot, 'src', 'gateway', 'agents-runtime', 'subagent-executor.ts'), 'utf8'),
  /const workerRefusal = backgroundWorkerToolRefusal\(name, sessionId\);\s+if \(workerRefusal\) return/,
);

// Dispatch: a worker calling a stripped name is refused in every enforcement
// mode, including the schema-hidden background_* aliases; other tools pass.
const dispatch = (name: string, mode: 'enforce' | 'warn' | 'off', worker: boolean) => evaluateToolDispatch({
  name,
  rawArguments: '{}',
  offered: worker ? workerSurface : mainSurface,
  mode,
  isKnownTool: () => true,
  categoryOf: () => null,
  isCategoryActive: () => true,
  withheldReason: worker ? backgroundWorkerWithheldReason : undefined,
});
for (const mode of ['enforce', 'warn', 'off'] as const) {
  for (const name of [...WITHHELD, 'background_spawn', 'background_follow_up']) {
    const decision = dispatch(name, mode, true);
    assert.equal(decision.ok, false, `worker dispatch of ${name} must be refused (${mode})`);
    if (!decision.ok) {
      assert.equal(decision.code, 'not_offered');
      assert.match(decision.message, /not available to background workers/);
    }
  }
}
for (const name of ['bg_plan_declare', 'bg_plan_advance', 'ask_prometheus_questions', 'write_note']) {
  assert.equal(dispatch(name, 'enforce', true).ok, true, `worker may still call ${name}`);
}
for (const name of WITHHELD) assert.equal(dispatch(name, 'enforce', false).ok, true, `main chat may call ${name}`);
// A standalone subagent (background_agent mode, subagent_ session) keeps all
// four on its surface and its calls are not refused.
const subagentIsWorker = isBackgroundSpawnWorkerSession(STANDALONE_SUBAGENT_SESSION);
const subagentStrip = new Set(subagentIsWorker ? BACKGROUND_WORKER_WITHHELD_TOOL_NAMES : []);
const subagentSurface = new Set([...mainSurface].filter((name) => !subagentStrip.has(name)));
for (const name of WITHHELD) {
  assert.equal(subagentSurface.has(name), true, `standalone subagent must keep ${name}`);
  assert.equal(dispatch(name, 'enforce', subagentIsWorker).ok, true, `standalone subagent may call ${name}`);
}

console.log('background-spawn-tool-surface regression: ok');
