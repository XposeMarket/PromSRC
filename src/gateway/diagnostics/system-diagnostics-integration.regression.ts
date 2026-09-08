import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-diagnostic-evidence-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_APP_DATA_DIR = root;
process.env.PROMETHEUS_RUNTIME_DIR = path.join(root, 'runtime');
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');
const { systemDiagnosticsTool } = require('./system-diagnostics') as typeof import('./system-diagnostics');
const { getConfig } = require('../../config/config') as typeof import('../../config/config');
const { markProviderStatus, getProviderStatusCacheKey, PROVIDER_STATUS_CACHE_MS } = require('../provider-status') as typeof import('../provider-status');
const now = Date.now();
const configDir = getConfig().getConfigDir();
fs.mkdirSync(configDir, { recursive: true });
fs.writeFileSync(path.join(configDir, 'gateway-runtime-status.json'), JSON.stringify({ pid: process.pid, timestamp: now }));
const jobs = [
  { id: 'running', name: 'running', enabled: true, status: 'running' },
  { id: 'paused', name: 'paused', enabled: false, status: 'scheduled', consecutiveErrors: 10, lastResult: 'historical error' },
  { id: 'unverified', name: 'unverified', enabled: true, status: 'scheduled' },
  { id: 'failed', name: 'failed', enabled: true, status: 'scheduled', consecutiveErrors: 1 },
];
const snapshot = (time = now) => systemDiagnosticsTool({ scheduler: { getJobs: () => jobs }, workspacePath: process.env.PROMETHEUS_WORKSPACE_DIR!, configDir, now: () => time }, { limit: 1 }).data;
const result = snapshot();
assert.equal(result.automation.counts.jobs, 4);
assert.equal(result.automation.counts.unhealthyJobs, 1);
assert.equal(result.automation.counts.intentionalJobs, 1);
assert.equal(result.automation.counts.unverifiedJobs, 1);
assert.equal(result.automation.unhealthyJobs[0].id, 'failed', 'a fault after the display limit must remain visible');
assert.equal(result.automation.intentionalJobs[0].id, 'paused');
markProviderStatus(false, getProviderStatusCacheKey(), { result: 'timeout', source: 'connection_probe' });
assert.equal(snapshot().provider.state, 'check_failed');
assert.equal(snapshot().provider.result, 'timeout');
assert.equal(snapshot(now + PROVIDER_STATUS_CACHE_MS + 100).provider.state, 'unknown', 'expired failure must not imply current failure');
assert.equal(snapshot(now + PROVIDER_STATUS_CACHE_MS + 100).provider.freshness, 'stale');
markProviderStatus(false);
assert.equal(snapshot().provider.state, 'unknown', 'a chat failure without route evidence must not declare the configured provider offline');
console.log('system diagnostics integration: full job classification, intentional state, scoped probes, and freshness passed');
process.exit(0);
