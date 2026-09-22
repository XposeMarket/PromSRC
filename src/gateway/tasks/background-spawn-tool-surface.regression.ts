import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildTools } from '../tool-builder';
import { normalizeBackgroundSpawnToolCategories, resolveBackgroundAgentModelRouting } from './task-runner';

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
const chatRouterSource = readFileSync(path.join(repoRoot, 'src', 'gateway', 'routes', 'chat.router.ts'), 'utf8');
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

console.log('background-spawn-tool-surface regression: ok');
