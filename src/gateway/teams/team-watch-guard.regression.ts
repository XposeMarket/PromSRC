import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-team-watch-guard-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');
fs.mkdirSync(process.env.PROMETHEUS_WORKSPACE_DIR, { recursive: true });

/**
 * Post-#566 live run: the manager still created 3 internal task watches because the
 * guard lived in subagent-executor, but the capability registry (automation-executor)
 * handles internal_watch first. Also, write_note in team sessions kept rewriting
 * memory.json and recreating last_run.json / pending.json.
 */
async function main() {
  const { executeRegisteredCapabilityTool } = await import('../agents-runtime/capabilities/registry');
  const deps: any = { broadcastWS: () => {}, cronScheduler: null };
  const call = (sessionId: string) => executeRegisteredCapabilityTool({
    name: 'internal_watch',
    args: { action: 'create', id: 'w1', target: { type: 'task', task_id: 'team_bg_x' } },
    deps,
    sessionId,
    workspacePath: root,
  } as any);

  // 1. The live registry path rejects manager task watches.
  const dispatched: any = await call('team_coord_team_abc');
  assert.equal(dispatched.handled, true, 'registry handles internal_watch');
  const blocked: any = dispatched.result;
  assert.equal(blocked.error, true, 'manager task watch rejected');
  assert.match(String(blocked.result), /not used by team managers/);

  // 2. team notes are append-only and do not recreate the legacy memory files.
  const { appendTeamMemoryEvent, getTeamWorkspacePath, readTeamMemoryContext } = await import('./team-workspace');
  assert.equal(appendTeamMemoryEvent('team_abc', { authorType: 'manager', authorId: 'm', content: 'first' }), true);
  assert.equal(appendTeamMemoryEvent('team_abc', { authorType: 'subagent', authorId: 'a1', tag: 'x', content: 'second' }), true);
  const ws = getTeamWorkspacePath('team_abc');
  for (const legacy of ['memory.json', 'last_run.json', 'pending.json']) {
    assert.ok(!fs.existsSync(path.join(ws, legacy)), `${legacy} not created`);
  }
  const lines = fs.readFileSync(path.join(ws, 'team-notes.jsonl'), 'utf-8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(readTeamMemoryContext('team_abc'), /second/);

  // 3. No prompt still tells agents to maintain the legacy files.
  for (const rel of ['team-dispatch-runtime.ts', 'team-workspace.ts', 'managed-teams.ts', 'team-coordinator.ts']) {
    const src = fs.readFileSync(path.join(__dirname, rel), 'utf8');
    assert.ok(!/Prior run context: memory\.json|Update memory\.json, last_run\.json|belongs in the team workspace memory\.json|\(pending\.json\) so the coordinator|Prior run memory:/.test(src),
      `${rel} prompt strings drop memory-file instructions`);
  }

  console.log('team-watch-guard regression: ok');
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
