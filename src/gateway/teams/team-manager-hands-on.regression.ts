import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolated data/workspace dirs so the real config/session store is never touched.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-team-hands-on-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');
fs.mkdirSync(process.env.PROMETHEUS_WORKSPACE_DIR, { recursive: true });

/**
 * Hands-on team managers (2026-10-27):
 *  - a manager fixing member work itself (edits / runs / commits) counts as team activity,
 *    so the coordinator loop does not idle-stop it mid-fix;
 *  - reads, status checks, memory and chat posts still do NOT count (talk-only managers idle-stop);
 *  - workspace_write is preloaded into the manager session (idempotent);
 *  - the manager prompt teaches the fix ladder instead of "re-dispatch or escalate everything".
 */
async function main() {
  const coord = await import('./team-coordinator');
  const { isTeamManagerActivityTool, prepareTeamManagerToolScope, TEAM_MANAGER_PRELOADED_CATEGORIES } = coord as any;

  // 1. Activity accounting.
  const yes: Array<[string, any?]> = [
    ['dispatch_team_agent', { agent_id: 'a1' }],
    ['request_team_member_turn', { agent_id: 'a1' }],
    ['team_ops_wrapper', { action: 'dispatch_team_agent' }],
    ['team_ops_wrapper', { action: 'request_member_turn' }],
    ['workspace_edit', { action: 'find_replace', path: 'out/report.md' }],
    ['workspace_edit', { action: 'write', path: 'out/report.md' }],
    ['workspace_run', { action: 'run', command: 'npm test' }],
    ['workspace_run', { action: 'typecheck' }],
    ['workspace_git', { action: 'commit', message: 'fix' }],
    ['find_replace', { path: 'x' }],
    ['run_command', { command: 'npm test' }],
  ];
  for (const [name, args] of yes) {
    assert.equal(isTeamManagerActivityTool(name, args), true, `${name} ${JSON.stringify(args)} counts as activity`);
  }
  const no: Array<[string, any?]> = [
    ['', undefined],
    ['workspace_read', { action: 'read', path: 'x' }],
    ['workspace_run', { action: 'status', runId: 'r' }],
    ['workspace_run', { action: 'log', runId: 'r' }],
    ['workspace_edit', { action: 'preview_patch', patch: '' }],
    ['workspace_edit', { action: 'patchset', dry_run: true }],
    ['workspace_git', { action: 'status' }],
    ['team_ops_wrapper', { action: 'get_agent_result' }],
    ['team_ops_wrapper', { action: 'post_chat' }],
    ['memory', { action: 'search' }],
    ['post_to_team_chat', { message: 'hi' }],
    ['manage_team_goal', { action: 'log_completed' }],
    ['message_main_agent', { message: 'blocked' }],
  ];
  for (const [name, args] of no) {
    assert.equal(isTeamManagerActivityTool(name, args), false, `${name} ${JSON.stringify(args)} is not activity`);
  }

  // 2. Preload: workspace_write is active for the manager session, and a second call is a no-op.
  assert.deepEqual([...TEAM_MANAGER_PRELOADED_CATEGORIES], ['workspace_write']);
  const { getActivatedToolCategories, getSession } = await import('../session');
  const sid = 'team_coord_hands_on_test';
  const before = new Set(getActivatedToolCategories(sid));
  prepareTeamManagerToolScope(sid);
  prepareTeamManagerToolScope(sid);
  const after = getActivatedToolCategories(sid);
  const added = [...after].filter((c) => !before.has(c));
  assert.ok(added.length >= 1, `preload activated a category (before=${[...before]}, after=${[...after]})`);
  const persisted = (getSession(sid) as any).activatedToolCategories || [];
  assert.equal(new Set(persisted).size, persisted.length, 'no duplicate session categories after two preloads');
  prepareTeamManagerToolScope(''); // empty id is ignored, never throws

  // 3. Prompt teaches the fix ladder and drops the "everything goes elsewhere" rules.
  const src = fs.readFileSync(path.join(__dirname, 'team-coordinator.ts'), 'utf8');
  assert.match(src, /4a\. FIX IT YOURSELF WHEN IT IS SMALL/, 'fix ladder rule present');
  assert.match(src, /your fix does NOT replace that verdict/, 'QA-gated lanes keep their reviewer verdict');
  assert.match(src, /manager fix: <what you changed>/, 'manager fixes are logged as such');
  assert.match(src, /never edit the live Prometheus checkout directly/, 'Prometheus self-source still goes through proposal/PR');
  assert.doesNotMatch(src, /instead of assuming manager-local source_write access/, 'no longer forbids manager-local edits');
  assert.doesNotMatch(src, /Errors, blockers, missing credentials — all go to the main agent first/, 'no longer sends every error to main first');
  assert.doesNotMatch(src, /toolName === 'dispatch_team_agent' \|\| toolName === 'request_team_member_turn'/, 'both loops use the shared activity helper');
  assert.equal((src.match(/isTeamManagerActivityTool\(toolName, data\?\.args\)/g) || []).length, 2, 'both coordinator loops count hands-on work');

  console.log('team-manager-hands-on regression: PASS');
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
