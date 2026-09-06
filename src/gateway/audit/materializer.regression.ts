import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { materializeAuditSnapshot } from './materializer';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-materializer-regression-'));
const configDir = path.join(root, 'config');
const workspace = path.join(root, 'workspace');
const rawDir = path.join(configDir, 'tool-observations', 'raw');
const largeRaw = path.join(rawDir, 'session.jsonl');
fs.mkdirSync(rawDir, { recursive: true });
fs.mkdirSync(workspace, { recursive: true });
fs.writeFileSync(path.join(configDir, 'sessions.json'), '{}');

const line = `${JSON.stringify({ authorization: 'Bearer regression-secret', payload: 'x'.repeat(256) })}\n`;
const fd = fs.openSync(largeRaw, 'w');
try {
  for (let i = 0; i < 6_000; i += 1) fs.writeSync(fd, line);
} finally {
  fs.closeSync(fd);
}

const savedEnv = { ...process.env };
try {
  process.env.PROMETHEUS_AUDIT_MATERIALIZER_DISABLED = '1';
  const disabled = materializeAuditSnapshot(configDir, workspace);
  assert.equal(disabled.disabled, true);
  assert.equal(fs.existsSync(path.join(workspace, 'audit')), false);

  delete process.env.PROMETHEUS_AUDIT_MATERIALIZER_DISABLED;
  delete process.env.PROMETHEUS_AUDIT_MATERIALIZER_INCLUDE_TOOL_OBSERVATIONS;
  const excluded = materializeAuditSnapshot(configDir, workspace);
  assert.deepEqual(excluded.stats.excludedPrefixes, ['chats/tool-observations']);
  assert.equal(excluded.stats.bytesRead, 0);
  assert.equal(fs.existsSync(largeRaw), true);
  assert.equal(fs.existsSync(path.join(workspace, 'audit', 'chats', 'tool-observations', 'raw', 'session.jsonl')), false);

  process.env.PROMETHEUS_AUDIT_MATERIALIZER_INCLUDE_TOOL_OBSERVATIONS = '1';
  process.env.PROMETHEUS_AUDIT_MATERIALIZER_MAX_SINGLE_FILE_BYTES = String(64 * 1024);
  const limited = materializeAuditSnapshot(configDir, workspace);
  assert.equal(limited.stats.skippedTooLarge, 1);
  assert.equal(fs.existsSync(largeRaw), true);

  process.env.PROMETHEUS_AUDIT_MATERIALIZER_MAX_SINGLE_FILE_BYTES = String(4 * 1024 * 1024);
  process.env.PROMETHEUS_AUDIT_MATERIALIZER_MAX_TOTAL_BYTES = String(4 * 1024 * 1024);
  const streamed = materializeAuditSnapshot(configDir, workspace);
  assert.equal(streamed.stats.errors, 0);
  assert.ok(streamed.stats.bytesRead > 0);
  const mirrored = fs.readFileSync(path.join(workspace, 'audit', 'chats', 'tool-observations', 'raw', 'session.jsonl'), 'utf8');
  assert.equal(mirrored.includes('regression-secret'), false);
  assert.ok(mirrored.includes('[REDACTED]'));
  console.log(JSON.stringify({ excluded: excluded.stats, limited: limited.stats, streamed: streamed.stats }, null, 2));
} finally {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(savedEnv)) process.env[key] = value;
  fs.rmSync(root, { recursive: true, force: true });
}
