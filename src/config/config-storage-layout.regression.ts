import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function run(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-config-layout-v2-'));
  const appData = path.join(root, 'Prometheus');
  const runtime = path.join(appData, 'runtime');
  const workspace = path.join(appData, 'workspace');
  const legacyConfig = path.join(appData, '.prometheus');
  const previous = {
    data: process.env.PROMETHEUS_DATA_DIR,
    appData: process.env.PROMETHEUS_APP_DATA_DIR,
    runtime: process.env.PROMETHEUS_RUNTIME_DIR,
    workspace: process.env.PROMETHEUS_WORKSPACE_DIR,
    layout: process.env.PROMETHEUS_STORAGE_LAYOUT,
  };

  try {
    process.env.PROMETHEUS_DATA_DIR = appData;
    process.env.PROMETHEUS_APP_DATA_DIR = appData;
    process.env.PROMETHEUS_RUNTIME_DIR = runtime;
    process.env.PROMETHEUS_WORKSPACE_DIR = workspace;
    process.env.PROMETHEUS_STORAGE_LAYOUT = 'canonical';

    fs.mkdirSync(path.join(legacyConfig, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(legacyConfig, 'agents', 'run-history.json'), JSON.stringify([{
      id: 'legacy-run',
      agentId: 'researcher',
      agentName: 'Researcher',
      trigger: 'manual',
      success: true,
      startedAt: 1,
      finishedAt: 2,
      durationMs: 1,
    }], null, 2), 'utf-8');

    const configModule = await import('./config.js');
    const manager = configModule.getConfig();
    manager.ensureDirectories();

    assert.equal(manager.getConfigDir(), runtime);
    assert.equal(manager.getWorkspacePath(), workspace);
    assert.equal(manager.getConfig().workspace.path, workspace);
    assert.equal(manager.getConfig().skills.directory, path.join(workspace, 'skills'));
    assert.equal(manager.getConfig().memory.path, path.join(runtime, 'memory-index'));

    manager.updateConfig({
      workspace: { ...manager.getConfig().workspace, path: workspace },
    } as any);
    const configFile = path.join(runtime, 'config', 'config.json');
    assert.ok(fs.existsSync(configFile), 'canonical config should be stored under runtime/config');
    assert.equal(fs.existsSync(path.join(legacyConfig, 'config.json')), false, 'canonical save must not write legacy config');

    const agentWorkspace = configModule.ensureAgentWorkspace({
      id: 'researcher',
      name: 'Researcher',
      description: 'Research agent',
      default: false,
    } as any);
    assert.equal(agentWorkspace, path.join(workspace, '.prometheus', 'subagents', 'researcher'));
    assert.ok(fs.existsSync(path.join(agentWorkspace, 'AGENT.md')));
    assert.ok(fs.existsSync(path.join(agentWorkspace, 'MEMORY.md')));
    assert.ok(fs.existsSync(path.join(agentWorkspace, 'HEARTBEAT.md')));

    const scheduler = await import('../scheduler.js');
    const history = scheduler.getAgentRunHistory('researcher');
    assert.equal(history[0]?.id, 'legacy-run');
    assert.ok(fs.existsSync(path.join(runtime, 'agents', 'run-history.json')), 'legacy run history should be copied into runtime/agents');
    assert.ok(fs.existsSync(path.join(legacyConfig, 'agents', 'run-history.json')), 'legacy run history must remain intact');

    console.log('canonical config storage regression passed');
  } finally {
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore('PROMETHEUS_DATA_DIR', previous.data);
    restore('PROMETHEUS_APP_DATA_DIR', previous.appData);
    restore('PROMETHEUS_RUNTIME_DIR', previous.runtime);
    restore('PROMETHEUS_WORKSPACE_DIR', previous.workspace);
    restore('PROMETHEUS_STORAGE_LAYOUT', previous.layout);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run();
