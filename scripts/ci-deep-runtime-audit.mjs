import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const results = [];

function run(name, command, args, extraEnv = {}) {
  console.log(`\n===== DEEP AUDIT: ${name} =====`);
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
    windowsHide: true,
  });
  const ok = result.status === 0 && !result.error;
  results.push({ name, ok, status: result.status, durationMs: Date.now() - started, error: result.error?.message || null });
  console.log(`===== ${ok ? 'PASS' : 'FAIL'}: ${name} (${Date.now() - started} ms) =====`);
  return ok;
}

async function waitForGateway(url, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.status < 500) return true;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.error('Gateway readiness failed:', lastError?.message || lastError);
  return false;
}

run('rebuild native modules', npm, ['rebuild', 'better-sqlite3', 'node-pty']);
run('backend build', npm, ['run', 'build:backend']);
run('runtime worker broker', npx, ['tsx', 'src/gateway/process/runtime-worker-broker.regression.ts']);
run('memory index worker', npx, ['tsx', 'src/gateway/memory-index/memory-index.regression.ts']);
run('audit worker operations', npx, ['tsx', 'src/gateway/audit/audit-ops.regression.ts']);
run('request operations', 'node', ['scripts/test-prometheus-request-ops.mjs']);
run('activity package', npx, ['tsx', 'src/gateway/brain/activity-package.regression.ts']);
run('process hygiene', npx, ['tsx', 'src/gateway/process-hygiene.regression.ts']);
run('supervised restart cleanup', 'node', ['scripts/test-supervised-restart-cleanup.mjs']);
run('main chat restart retrigger', 'node', ['scripts/test-main-chat-restart-retrigger.mjs']);
run('gateway supervisor policy', npx, ['tsx', 'src/cli/gateway-supervisor-policy.regression.ts']);
run('workspace process health', 'node', ['scripts/test-workspace-process-health.mjs']);
run('tool issue regressions', 'node', ['scripts/test-prometheus-tool-issue-regressions.mjs']);
run('integration runtime contract', 'node', ['scripts/test-integration-runtime-contract.mjs']);
run('connection orchestrator', 'node', ['scripts/test-connection-orchestrator.mjs']);
run('automation runtime contract', 'node', ['scripts/test-automation-runtime-contract.mjs']);
run('internal watch restart recovery', npx, ['tsx', 'src/gateway/internal-watch/internal-watch-restart-recovery.regression.ts']);
run('internal watch policy', npx, ['tsx', 'src/gateway/internal-watch/internal-watch-policy.regression.ts']);
run('tool benchmark aggregation', 'node', ['scripts/test-tool-benchmark-aggregate.mjs']);

const playwrightInstalled = run('install Playwright Chromium', npx, ['playwright', 'install', 'chromium']);
if (playwrightInstalled) {
  console.log('\n===== DEEP AUDIT: clean gateway + performance benchmark =====');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-deep-audit-'));
  const stdoutPath = path.join(dataDir, 'gateway.stdout.log');
  const stderrPath = path.join(dataDir, 'gateway.stderr.log');
  const stdoutFd = fs.openSync(stdoutPath, 'a');
  const stderrFd = fs.openSync(stderrPath, 'a');
  const gatewayEnv = { ...process.env, PROMETHEUS_DATA_DIR: dataDir };
  const gateway = spawn(npm, ['run', 'gateway'], {
    cwd: root,
    env: gatewayEnv,
    stdio: ['ignore', stdoutFd, stderrFd],
    windowsHide: true,
  });
  let gatewayOk = false;
  try {
    gatewayOk = await waitForGateway('http://127.0.0.1:18789/');
    results.push({ name: 'clean gateway readiness', ok: gatewayOk, status: gatewayOk ? 0 : 1, durationMs: null, error: null });
    if (gatewayOk) {
      run('performance benchmark', npm, ['run', 'benchmark:performance', '--', '--samples=3', '--source=git', '--skip-mobile'], {
        PROMETHEUS_DATA_DIR: dataDir,
        PROMETHEUS_BENCHMARK_URL: 'http://127.0.0.1:18789/',
      });
    }
  } finally {
    try { gateway.kill('SIGTERM'); } catch {}
    try { fs.closeSync(stdoutFd); } catch {}
    try { fs.closeSync(stderrFd); } catch {}
    console.log('\n--- gateway stdout tail ---');
    try { console.log(fs.readFileSync(stdoutPath, 'utf8').split(/\r?\n/).slice(-120).join('\n')); } catch {}
    console.log('\n--- gateway stderr tail ---');
    try { console.log(fs.readFileSync(stderrPath, 'utf8').split(/\r?\n/).slice(-120).join('\n')); } catch {}
  }
}

console.log('\n===== DEEP AUDIT SUMMARY =====');
for (const row of results) {
  console.log(`AUDIT_RESULT ${row.ok ? 'PASS' : 'FAIL'} :: ${row.name}${row.durationMs == null ? '' : ` :: ${row.durationMs}ms`}${row.error ? ` :: ${row.error}` : ''}`);
}

const failed = results.filter((row) => !row.ok);
if (failed.length) {
  console.error(`DEEP_AUDIT_FAILED ${failed.length} stage(s)`);
  process.exit(1);
}
console.log('DEEP_AUDIT_PASSED');
