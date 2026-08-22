import assert from 'node:assert/strict';
import path from 'node:path';
import { resolvePrometheusLayout, standaloneSubagentWorkspace, teamRoot, teamSharedWorkspace, teamSubagentWorkspace } from './storage-layout.js';

function env(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as NodeJS.ProcessEnv;
}

function run(): void {
  const home = path.resolve('/tmp/prometheus-layout-user');
  const repo = path.resolve('/tmp/prometheus-layout-repo');
  const data = path.resolve('/tmp/prometheus-layout-data');

  const legacy = resolvePrometheusLayout({
    env: env({}),
    homedir: home,
    cwd: repo,
    platform: 'linux',
    existsSync: (candidate) => path.resolve(candidate) === path.join(repo, '.prometheus'),
  });
  assert.equal(legacy.mode, 'legacy');
  assert.equal(legacy.activeConfigRoot, path.join(repo, '.prometheus'));
  assert.equal(legacy.activeWorkspaceRoot, path.join(repo, 'workspace'));

  const canonical = resolvePrometheusLayout({
    env: env({ PROMETHEUS_DATA_DIR: data, PROMETHEUS_STORAGE_LAYOUT: 'canonical' }),
    homedir: home,
    cwd: repo,
    platform: 'linux',
    existsSync: () => false,
  });
  assert.equal(canonical.mode, 'canonical');
  assert.equal(canonical.appDataRoot, data);
  assert.equal(canonical.runtime.root, path.join(data, 'runtime'));
  assert.equal(canonical.runtime.config, path.join(data, 'runtime', 'config'));
  assert.equal(canonical.runtime.sessions, path.join(data, 'runtime', 'sessions'));
  assert.equal(canonical.runtime.agents, path.join(data, 'runtime', 'agents'));
  assert.equal(canonical.runtime.audit, path.join(data, 'runtime', 'audit'));
  assert.equal(canonical.workspace.root, path.join(data, 'workspace'));
  assert.equal(canonical.workspace.skills, path.join(data, 'workspace', 'skills'));
  assert.equal(canonical.workspace.standaloneSubagents, path.join(data, 'workspace', '.prometheus', 'subagents'));
  assert.equal(canonical.activeConfigRoot, canonical.runtime.config);
  assert.equal(canonical.activeWorkspaceRoot, canonical.workspace.root);

  const explicitRuntime = resolvePrometheusLayout({
    env: env({ PROMETHEUS_DATA_DIR: data, PROMETHEUS_RUNTIME_DIR: path.join(data, 'isolated-runtime') }),
    homedir: home,
    cwd: repo,
    platform: 'linux',
    existsSync: () => true,
  });
  assert.equal(explicitRuntime.mode, 'canonical');
  assert.equal(explicitRuntime.runtime.root, path.join(data, 'isolated-runtime'));
  assert.equal(explicitRuntime.activeConfigRoot, path.join(data, 'isolated-runtime', 'config'));
  assert.equal(explicitRuntime.workspace.root, path.join(data, 'workspace'));

  const legacyElectronShape = resolvePrometheusLayout({
    env: env({ PROMETHEUS_DATA_DIR: data, PROMETHEUS_WORKSPACE_DIR: path.join(data, 'workspace') }),
    homedir: home,
    cwd: repo,
    platform: 'linux',
    existsSync: () => false,
  });
  assert.equal(legacyElectronShape.mode, 'legacy');
  assert.equal(legacyElectronShape.activeConfigRoot, path.join(data, '.prometheus'));
  assert.equal(legacyElectronShape.activeWorkspaceRoot, path.join(data, 'workspace'));

  const subagent = standaloneSubagentWorkspace(canonical, '../researcher');
  assert.equal(subagent, path.join(canonical.workspace.standaloneSubagents, '.._researcher'));
  assert.ok(subagent.startsWith(canonical.workspace.standaloneSubagents));

  // Exact dot path segments were previously accepted by the character allowlist.
  // They must never alias or escape the intended storage container.
  assert.equal(
    standaloneSubagentWorkspace(canonical, '..'),
    path.join(canonical.workspace.standaloneSubagents, 'agent'),
  );
  assert.equal(
    standaloneSubagentWorkspace(canonical, '.'),
    path.join(canonical.workspace.standaloneSubagents, 'agent'),
  );
  assert.equal(teamRoot(canonical, '..'), path.join(canonical.workspace.teams, 'team'));
  assert.equal(teamRoot(canonical, '.'), path.join(canonical.workspace.teams, 'team'));
  assert.equal(
    teamSubagentWorkspace(canonical, 'team-alpha', '..'),
    path.join(canonical.workspace.teams, 'team-alpha', 'subagents', 'agent'),
  );

  assert.equal(
    teamSharedWorkspace(canonical, 'team-alpha'),
    path.join(canonical.workspace.teams, 'team-alpha', 'workspace'),
  );
  assert.equal(
    teamSubagentWorkspace(canonical, 'team-alpha', 'builder'),
    path.join(canonical.workspace.teams, 'team-alpha', 'subagents', 'builder'),
  );

  console.log('storage layout regression passed');
}

run();
