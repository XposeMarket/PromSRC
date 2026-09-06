import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const repo = process.cwd();
const keep = process.argv.includes('--keep');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-audit-materializer-'));
const configDir = path.join(root, 'config');
const workspace = path.join(root, 'workspace');
const rawDir = path.join(configDir, 'tool-observations', 'raw');
const helper = path.join(repo, 'scripts', 'run-audit-materializer-fixture.ts');
const tsx = path.join(repo, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const currentModule = path.join(repo, 'src', 'gateway', 'audit', 'materializer.ts');
const baselineWorktree = path.join(root, 'baseline-worktree');
const baselineModule = path.join(baselineWorktree, 'src', 'gateway', 'audit', 'materializer.ts');

function mkdir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function writeJson(file, value) { mkdir(path.dirname(file)); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }

function buildFixture() {
  mkdir(rawDir);
  mkdir(workspace);
  writeJson(path.join(configDir, 'sessions', 'recent.json'), {
    id: 'recent', title: 'materializer benchmark', history: [{ role: 'user', content: 'hello' }],
  });
  writeJson(path.join(configDir, 'tasks', 'task.json'), { id: 'task', status: 'completed', title: 'benchmark' });

  const targetBytes = 48 * 1024 * 1024;
  const line = `${JSON.stringify({
    type: 'tool-observation',
    payload: 'x'.repeat(480),
    authorization: 'Bearer benchmark-secret',
  })}\n`;
  const fd = fs.openSync(path.join(rawDir, 'large.jsonl'), 'w');
  let written = 0;
  try {
    while (written < targetBytes) {
      fs.writeSync(fd, line);
      written += Buffer.byteLength(line);
    }
  } finally {
    fs.closeSync(fd);
  }
  writeJson(path.join(rawDir, 'small.json'), { authorization: 'Bearer benchmark-secret', value: 'small' });
  return { targetBytes: written };
}

function run(label, modulePath, envOverrides, runWorkspace) {
  const env = { ...process.env };
  for (const key of [
    'PROMETHEUS_AUDIT_MATERIALIZER_DISABLED',
    'PROMETHEUS_AUDIT_MATERIALIZER_EXCLUDE_DOMAINS',
    'PROMETHEUS_AUDIT_MATERIALIZER_INCLUDE_TOOL_OBSERVATIONS',
    'PROMETHEUS_AUDIT_MATERIALIZER_MAX_SINGLE_FILE_BYTES',
    'PROMETHEUS_AUDIT_MATERIALIZER_MAX_TOTAL_BYTES',
    'PROMETHEUS_AUDIT_MATERIALIZER_MAX_FILES_PER_RUN',
    'PROMETHEUS_AUDIT_MATERIALIZER_MAX_LINE_BYTES',
  ]) delete env[key];
  Object.assign(env, envOverrides);
  const child = spawnSync(process.execPath, [tsx, helper, modulePath, configDir, runWorkspace], {
    cwd: repo,
    env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (child.status !== 0) {
    throw new Error(`${label} failed (exit=${child.status}):\n${child.stdout}\n${child.stderr}`);
  }
  const lines = String(child.stdout || '').trim().split(/\r?\n/).filter(Boolean);
  const report = JSON.parse(lines[lines.length - 1]);
  return { label, ...report };
}

function compactReport(report) {
  const stats = report.result?.stats || report.indexTelemetry || {};
  return {
    label: report.label,
    sourceBytes: report.source?.bytes,
    sourceFiles: report.source?.files,
    durationMs: report.durationMs,
    eventLoopDelayMs: report.eventLoopDelayMs,
    maxRSSMiB: Number((Number(report.maxRSSKiB || 0) / 1024).toFixed(1)),
    endRSSMiB: Number((Number(report.endRSSBytes || 0) / 1024 / 1024).toFixed(1)),
    mirrorBytes: report.mirror?.bytes,
    mirrorFiles: report.mirror?.files,
    materializer: {
      copied: stats.copied,
      skipped: stats.skipped,
      deferred: stats.deferred,
      skippedTooLarge: stats.skippedTooLarge,
      errors: stats.errors,
      bytesRead: stats.bytesRead,
      bytesWritten: stats.bytesWritten,
      excludedPrefixes: stats.excludedPrefixes,
    },
  };
}

try {
  const fixture = buildFixture();
  execFileSync('git', ['worktree', 'add', '--detach', baselineWorktree, 'HEAD'], { cwd: repo, stdio: 'ignore' });

  const reports = [
    run('before-legacy-full-materializer', baselineModule, {}, path.join(root, 'before-workspace')),
    run('after-default-excludes-tool-observations', currentModule, {}, path.join(root, 'after-default-workspace')),
    run('after-streamed-bounded-opt-in', currentModule, {
      PROMETHEUS_AUDIT_MATERIALIZER_INCLUDE_TOOL_OBSERVATIONS: '1',
      PROMETHEUS_AUDIT_MATERIALIZER_MAX_SINGLE_FILE_BYTES: String(64 * 1024 * 1024),
      PROMETHEUS_AUDIT_MATERIALIZER_MAX_TOTAL_BYTES: String(64 * 1024 * 1024),
      PROMETHEUS_AUDIT_MATERIALIZER_MAX_FILES_PER_RUN: '5000',
    }, path.join(root, 'after-streamed-workspace')),
  ];
  const baseline = reports[0];
  const after = reports[2];
  console.log(JSON.stringify({
    fixture,
    reports: reports.map(compactReport),
    deltas: {
      streamedVsLegacyDurationMs: Number((after.durationMs - baseline.durationMs).toFixed(2)),
      streamedVsLegacyMaxRSSMiB: Number((after.maxRSSKiB / 1024 - baseline.maxRSSKiB / 1024).toFixed(1)),
      defaultExcludedBytesRead: reports[1].result?.stats?.bytesRead ?? 0,
      defaultExcludedCopied: reports[1].result?.stats?.copied ?? 0,
    },
    tempRoot: root,
  }, null, 2));
} finally {
  try { execFileSync('git', ['worktree', 'remove', '--force', baselineWorktree], { cwd: repo, stdio: 'ignore' }); } catch { /* best effort */ }
  if (!keep) fs.rmSync(root, { recursive: true, force: true });
}
