import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Each child resolves CONFIG_FILE after its own isolated data-root environment.
// Use the real ConfigManager: parsing helpers alone would miss silent defaults.
const marker = 'CONFIG_BOM_RESULT=';
if (process.argv.includes('--config-child')) {
  const { ConfigManager } = require('./config-classic');
  const config = new ConfigManager().getConfig();
  console.log(marker + JSON.stringify({ port: config.gateway.port, name: config.agent?.name }));
} else {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-config-bom-'));
  try {
    for (const [label, prefix, malformed] of [['plain', '', false], ['utf8-bom', '\uFEFF', false], ['malformed', '', true]] as const) {
      const dir = path.join(root, label);
      fs.mkdirSync(path.join(dir, '.prometheus'), { recursive: true });
      const data = JSON.stringify({ gateway: { port: 18761 }, agent: { name: 'BOM_PROFILE_SENTINEL' } });
      fs.writeFileSync(path.join(dir, '.prometheus', 'config.json'), prefix + (malformed ? '{ invalid JSON' : data), 'utf8');
      const child = spawnSync(process.execPath, ['--require', 'tsx/cjs', __filename, '--config-child'], {
        cwd: process.cwd(), env: { ...process.env, PROMETHEUS_DATA_DIR: dir, PROMETHEUS_WORKSPACE_DIR: path.join(dir, 'workspace'), PROMETHEUS_GATEWAY_PORT: '', GATEWAY_PORT: '' }, encoding: 'utf8', timeout: 30000,
      });
      assert.equal(child.status, 0, `${label}: ${child.stderr}`);
      const line = child.stdout.split(/\r?\n/).find((line) => line.startsWith(marker));
      assert.ok(line, `${label}: child result missing: ${child.stdout}`);
      const actual = JSON.parse(line.slice(marker.length));
      if (malformed) {
        assert.notEqual(actual.port, 18761, 'malformed config must not be accepted');
        assert.match(child.stderr, /Failed to load config/, 'malformed input must retain visible error fallback');
      } else {
        assert.equal(actual.port, 18761, `${label}: configured gateway port must survive load`);
        assert.equal(actual.name, 'BOM_PROFILE_SENTINEL', `${label}: configured profile must not become defaults`);
        assert.doesNotMatch(child.stderr, /Failed to load config/, `${label}: valid JSON must not fall back`);
      }
    }
    console.log('config BOM regression passed: plain/BOM preserved, malformed fallback unchanged');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
