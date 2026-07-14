import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { materializeAuditSnapshot } = await import('../dist/gateway/audit/materializer.js');
const { systemDiagnosticsTool } = await import('../dist/gateway/diagnostics/system-diagnostics.js');
const { createDiagnosticPacket, getDiagnosticPacket } = await import('../dist/gateway/diagnostics/diagnostic-packet-store.js');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-diagnostics-'));
const configDir = path.join(temp, 'config');
const workspace = path.join(temp, 'workspace');
fs.mkdirSync(path.join(configDir, 'sessions'), { recursive: true });
fs.mkdirSync(path.join(configDir, 'tasks'), { recursive: true });
fs.mkdirSync(path.join(configDir, 'logs'), { recursive: true });
fs.mkdirSync(workspace, { recursive: true });

fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ apiKey: 'short', maxTokens: 900, env: { SAFE: 'yes', SERVICE_TOKEN: 'secret-token' } }));
fs.writeFileSync(path.join(configDir, 'connections.json'), JSON.stringify({ headers: { authorization: 'Bearer abc', accept: 'json' }, accessToken: 'xyz' }));
fs.writeFileSync(path.join(configDir, 'sessions', 'one.json'), JSON.stringify({ message: 'password=abc and https://x.test/?token=tiny' }));
fs.writeFileSync(path.join(configDir, 'logs', 'gateway.log'), 'Authorization: Bearer live-secret\napi_key=z\n');
fs.writeFileSync(path.join(configDir, 'gateway-runtime-status.json'), JSON.stringify({ pid: 10, lastHeartbeatAt: Date.now() - 1000, lastMainSessionId: 'private-session' }));

materializeAuditSnapshot(configDir, workspace);
const auditRoot = path.join(workspace, 'audit');
const allAudit = fs.readdirSync(auditRoot, { recursive: true }).filter((name) => typeof name === 'string' && fs.statSync(path.join(auditRoot, name)).isFile()).map((name) => fs.readFileSync(path.join(auditRoot, name), 'utf8')).join('\n');
for (const secret of ['short', 'secret-token', 'Bearer abc', 'password=abc', 'token=tiny', 'live-secret']) assert.equal(allAudit.includes(secret), false, `audit leaked ${secret}`);
assert.match(allAudit, /\[REDACTED\]/);
assert.match(allAudit, /"maxTokens": 900/);
const manifestText = fs.readFileSync(path.join(auditRoot, '_index', 'materializer-manifest.json'), 'utf8');
assert.equal(manifestText.includes(temp), false);
const global = JSON.parse(fs.readFileSync(path.join(auditRoot, '_index', 'global.json'), 'utf8'));
assert.equal(global.sourceOfTruth, false);
assert.equal(global.freshness.redactionSchemaVersion, 1);

const scheduler = { getJobs: () => [] };
const diag = systemDiagnosticsTool({ scheduler, workspacePath: workspace, configDir, now: () => Date.now() }, { limit: 5 });
assert.equal(diag.success, true);
assert.equal(diag.data.gateway.state, 'healthy');
const diagText = JSON.stringify(diag);
assert.equal(diagText.includes('private-session'), false);
assert.equal(diag.data.audit.canonical, false);

const packet = createDiagnosticPacket(workspace, {
  classification: 'application_defect', severity: 'high', confidence: 'high',
  observed_behavior: 'Authorization: Bearer packet-secret failed', expected_behavior: 'operation succeeds',
  minimal_reproduction: ['run safe fixture'], affected_subsystem: 'gateway',
  evidence: [{ kind: 'system_diagnostics', ref: 'live snapshot', freshness: 'current', provenance: 'live_tool' }],
  attempted_recoveries: [{ action: 'retry read-only check', outcome: 'failed' }], operational_recovery_exhausted: true,
  sanitized_summary: 'token=packet-token reproducible defect',
});
const stored = getDiagnosticPacket(workspace, packet.id);
assert(stored);
const packetText = JSON.stringify(stored);
assert.equal(packetText.includes('packet-secret'), false);
assert.equal(packetText.includes('packet-token'), false);
assert.equal(stored.classification, 'application_defect');

console.log('Self-repair diagnostics, audit redaction, and packet regressions passed.');
