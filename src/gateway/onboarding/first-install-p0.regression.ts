import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-p0-'));
  const oldData = process.env.PROMETHEUS_DATA_DIR;
  const oldHost = process.env.GATEWAY_HOST;
  const oldRuntime = process.env.PROMETHEUS_RUNTIME_DIR;
  const oldWorkspace = process.env.PROMETHEUS_WORKSPACE_DIR;
  process.env.PROMETHEUS_RUNTIME_DIR = path.join(root, 'runtime');
  process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');
  process.env.PROMETHEUS_DATA_DIR = root;
  delete process.env.GATEWAY_HOST;
  try {
    const { ConfigManager } = await import('../../config/config');
    const cfg = new ConfigManager();
    assert.equal(cfg.getConfig().gateway.host, '127.0.0.1');
    const { getPrometheusLayout } = await import('../../runtime/storage-layout');
    const layout = getPrometheusLayout();
    const configFile = path.join(layout.mode === 'canonical' ? layout.runtime.config : cfg.getConfigDir(), 'config.json');
    const saved = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    assert.equal(saved.gateway.host, '127.0.0.1', 'first-boot writer persists loopback');
    cfg.updateConfig({ gateway: { ...cfg.getConfig().gateway, host: '0.0.0.0' } });
    assert.equal(new ConfigManager().getConfig().gateway.host, '0.0.0.0', 'saved explicit host survives reload');
    cfg.updateConfig({ gateway: { ...cfg.getConfig().gateway, host: '127.0.0.1' } });
    assert.equal(new ConfigManager().getConfig().gateway.host, '127.0.0.1', 'LAN opt-in is reversible');

    const { startupModelReady } = await import('./startup-model-ready');
    let checks = 0;
    const healthy = async () => { checks++; return true; };
    assert.equal(await startupModelReady({ connected: () => false, healthy }), false);
    assert.equal(checks, 0, 'fresh/skipped model never invokes a provider');
    assert.equal(await startupModelReady({ connected: () => true, healthy: async () => false }), false);
    assert.equal(await startupModelReady({ connected: () => true, healthy }), true);
    assert.equal(checks, 1);
    assert.equal(await startupModelReady({ connected: () => { throw new Error('bad record'); }, healthy }), false);
    console.log('first-install P0 regression passed');
  } finally {
    if (oldData === undefined) delete process.env.PROMETHEUS_DATA_DIR; else process.env.PROMETHEUS_DATA_DIR = oldData;
    if (oldHost === undefined) delete process.env.GATEWAY_HOST; else process.env.GATEWAY_HOST = oldHost;
    if (oldRuntime === undefined) delete process.env.PROMETHEUS_RUNTIME_DIR; else process.env.PROMETHEUS_RUNTIME_DIR = oldRuntime;
    if (oldWorkspace === undefined) delete process.env.PROMETHEUS_WORKSPACE_DIR; else process.env.PROMETHEUS_WORKSPACE_DIR = oldWorkspace;
    fs.rmSync(root, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
