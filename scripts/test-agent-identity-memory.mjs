import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const actorRuntime = await import(pathToFileURL(path.join(root, 'dist/gateway/runtime-actor.js')).href);
const memoryRuntime = await import(pathToFileURL(path.join(root, 'dist/gateway/agents-runtime/capabilities/memory-executor.js')).href);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-agent-memory-'));

try {
  const mainWorkspace = path.join(tempRoot, 'main');
  const agentRoot = path.join(tempRoot, 'agent-a');
  fs.mkdirSync(mainWorkspace, { recursive: true });
  fs.writeFileSync(path.join(mainWorkspace, 'MEMORY.md'), '# Main memory\n\n## private\n- never touch', 'utf8');

  actorRuntime.setRuntimeActorContext('agent-memory-test', {
    kind: 'agent',
    surface: 'direct_chat',
    agentId: 'agent-a',
    displayName: 'Agent A',
    identityRoot: agentRoot,
    memoryRoot: agentRoot,
    executionRoot: mainWorkspace,
  });

  const write = await memoryRuntime.memoryCapabilityExecutor.execute({
    name: 'memory_write',
    args: { file: 'memory', category: 'lessons', content: 'Keep this private to Agent A.' },
    workspacePath: mainWorkspace,
    sessionId: 'agent-memory-test',
    deps: {},
  });
  assert.equal(write.error, false);
  assert.match(String(write.result), /agent:agent-a/);
  assert.match(fs.readFileSync(path.join(agentRoot, 'MEMORY.md'), 'utf8'), /Keep this private to Agent A/);
  assert.doesNotMatch(fs.readFileSync(path.join(mainWorkspace, 'MEMORY.md'), 'utf8'), /Keep this private to Agent A/);

  const blocked = await memoryRuntime.memoryCapabilityExecutor.execute({
    name: 'memory_read',
    args: { file: 'user' },
    workspacePath: mainWorkspace,
    sessionId: 'agent-memory-test',
    deps: {},
  });
  assert.equal(blocked.error, true);
  assert.match(String(blocked.result), /main-Prometheus memory/);

  const managerRole = actorRuntime.buildRuntimeActorRoleContract({
    kind: 'manager', surface: 'team_room', agentId: 'manager-a', displayName: 'Avery', teamName: 'Research',
  });
  assert.match(managerRole, /Avery/);
  assert.match(managerRole, /not Prom/);

  const dispatchSource = fs.readFileSync(path.join(root, 'src/gateway/teams/team-dispatch-runtime.ts'), 'utf8');
  assert.doesNotMatch(dispatchSource, /You are Prometheus\. You have been assigned a specific role on this team/);
  const coordinatorSource = fs.readFileSync(path.join(root, 'src/gateway/teams/team-coordinator.ts'), 'utf8');
  assert.match(coordinatorSource, /ensureManagedTeamManagerAgent/);
  assert.match(coordinatorSource, /prepareTeamManagerRuntime/);
  const cronSource = fs.readFileSync(path.join(root, 'src/gateway/scheduling/cron-scheduler.ts'), 'utf8');
  assert.match(cronSource, /surface: 'scheduled_run'/);

  console.log('PASS: distinct actor identity and private memory boundaries');
} finally {
  actorRuntime.clearRuntimeActorContext('agent-memory-test');
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
