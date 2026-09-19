/**
 * End-to-end warm handoff against a real supervised gateway.
 *
 * Starts `prom gateway start` (supervised, compiled dist) in an isolated data
 * dir with a 45s synthetic runtime, then issues a quick restart while that
 * runtime is live and asserts:
 *   - the replacement gateway comes up under a new pid while the old one stays alive;
 *   - the replacement mirrors the carried runtime (ledger entry under the old pid);
 *   - the old gateway's broadcasts reach a WebSocket client of the replacement;
 *   - the carried runtime finishes, the old gateway exits with code 0 (not 42);
 *   - the supervisor keeps exactly one healthy gateway.
 *
 *   npm run test:gateway-handoff-e2e
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliEntry = path.join(root, 'dist', 'cli', 'index.js');
assert.ok(fs.existsSync(cliEntry), 'dist/cli/index.js is missing; run npm run build:backend first');

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-handoff-e2e-'));
const dataDir = path.join(testRoot, 'data');
const workspaceDir = path.join(testRoot, 'workspace');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(workspaceDir, { recursive: true });
const stateDir = path.join(dataDir, '.prometheus');
const ledgerPath = path.join(stateDir, 'runtimes', 'active-runtimes.json');
const exitDiagnosticsPath = path.join(root, '.prometheus', 'logs', 'gateway-exit-diagnostics.ndjson');

const SYNTHETIC_MS = 45_000;
const port = await findFreePort();
const base = `http://127.0.0.1:${port}`;
const logLines = [];
let supervisor = null;

function log(message) {
  console.log(`[handoff-e2e] ${message}`);
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(address.port));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(label, predicate, timeoutMs, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await predicate();
      if (last) return last;
    } catch {}
    await sleep(intervalMs);
  }
  let stateDump = '';
  try {
    const runtimesDir = path.join(stateDir, 'runtimes');
    stateDump = `\n--- ${runtimesDir} ---\n${fs.existsSync(runtimesDir) ? fs.readdirSync(runtimesDir).join(', ') : '(missing)'}\n--- ledger ---\n${fs.existsSync(ledgerPath) ? fs.readFileSync(ledgerPath, 'utf-8').slice(0, 2_000) : '(missing)'}`;
  } catch {}
  throw new Error(`timed out after ${timeoutMs}ms waiting for: ${label}${stateDump}\n--- gateway log tail ---\n${logLines.slice(-40).join('\n')}`);
}

async function health() {
  const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2_000) });
  if (!res.ok) return null;
  return res.json();
}

function readLedger() {
  try { return JSON.parse(fs.readFileSync(ledgerPath, 'utf-8')); } catch { return null; }
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}

function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' }); } catch {}
    return;
  }
  try { process.kill(-pid, 'SIGKILL'); } catch {}
  try { process.kill(pid, 'SIGKILL'); } catch {}
}

function openWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const received = [];
    ws.on('message', (raw) => {
      try { received.push(JSON.parse(String(raw))); } catch {}
    });
    ws.once('open', () => resolve({ ws, received }));
    ws.once('error', reject);
  });
}

const exitDiagnosticsOffset = (() => {
  try { return fs.statSync(exitDiagnosticsPath).size; } catch { return 0; }
})();

// The WebSocket endpoint requires a signed-in account. Seed a local session in
// the legacy plaintext location; the gateway migrates it into its own vault.
fs.writeFileSync(path.join(dataDir, 'auth-session.json'), JSON.stringify({
  userId: 'handoff-e2e-user',
  email: 'handoff-e2e@example.invalid',
  accessToken: 'handoff-e2e-access-token',
  refreshToken: 'handoff-e2e-refresh-token',
  expiresAt: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
  isAdmin: false,
}));

try {
  supervisor = spawn(process.execPath, [cliEntry, 'gateway', 'start'], {
    cwd: root,
    env: {
      ...process.env,
      PROMETHEUS_DATA_DIR: dataDir,
      PROMETHEUS_WORKSPACE_DIR: workspaceDir,
      PROMETHEUS_GATEWAY_PORT: String(port),
      PROMETHEUS_SUPERVISOR: '1',
      PROMETHEUS_DISABLE_GATEWAY_SUPERVISOR: '0',
      PROMETHEUS_GATEWAY_USE_COMPILED: '1',
      PROMETHEUS_HANDOFF_SYNTHETIC_RUNTIME_MS: String(SYNTHETIC_MS),
      PROMETHEUS_QUICK_RESTART_DELAY_MS: '100',
      PROMETHEUS_GATEWAY_STALL_AUTORESTART: '0',
      PROMETHEUS_GATEWAY_MEMORY_AUTORESTART: '0',
      PROMETHEUS_STARTUP_MEMORY_REFRESH: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  for (const stream of [supervisor.stdout, supervisor.stderr]) {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        logLines.push(line);
        if (/handoff|GatewaySupervisor|lifecycle\]/i.test(line)) log(line.slice(0, 220));
      }
    });
  }

  log(`waiting for the first gateway on port ${port}`);
  const first = await waitFor('first gateway health', health, 180_000, 1_000);
  const pidA = Number(first.pid);
  assert.ok(pidA > 0, 'first gateway reports its pid');
  log(`gateway A pid=${pidA}`);

  const syntheticId = await waitFor('synthetic runtime registered in ledger', () => {
    const ledger = readLedger();
    const entry = Object.values(ledger?.runtimes || {}).find((r) => r.taskId === 'handoff-synthetic-fixture' && r.status === 'running');
    return entry?.id || null;
  }, 30_000);
  log(`synthetic runtime ${syntheticId} running in A`);

  const wsA = await openWs();
  await waitFor('ticks from A over WS', () => wsA.received.some((m) => m.type === 'handoff_synthetic_tick'), 10_000);
  const closedA = new Promise((resolve) => wsA.ws.once('close', resolve));

  const restart = await fetch(`${base}/api/voice-agent/restart-gateway-quick`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'handoff e2e', sessionId: 'default' }),
  });
  assert.equal(restart.status, 202, 'quick restart accepted');
  log('quick restart requested while the synthetic runtime is live');

  await closedA;
  log('A terminated its WebSocket clients (expected)');

  const second = await waitFor('replacement gateway health under a new pid', async () => {
    const h = await health();
    return h && Number(h.pid) !== pidA ? h : null;
  }, 120_000, 1_000);
  const pidB = Number(second.pid);
  log(`gateway B pid=${pidB} is serving; A (${pidA}) alive=${pidAlive(pidA)}`);
  assert.ok(pidAlive(pidA), 'A must still be alive while it drains the synthetic runtime');

  await waitFor('B mirrors the carried runtime in its ledger', () => {
    const ledger = readLedger();
    const entry = ledger?.runtimes?.[syntheticId];
    return entry && entry.status === 'running' && Number(entry.pid) === pidA ? entry : null;
  }, 30_000);
  log('B ledger shows the synthetic runtime carried under pid A');
  assert.equal(fs.existsSync(path.join(stateDir, 'runtimes', 'handoff-hosts', `${pidA}.json`)), true, 'host manifest present during drain');

  const wsB = await openWs();
  const relayed = await waitFor('A\'s ticks relayed through B', () => {
    const ticks = wsB.received.filter((m) => m.type === 'handoff_synthetic_tick' && Number(m.pid) === pidA);
    return ticks.length >= 2 ? ticks : null;
  }, 30_000);
  assert.ok(relayed[relayed.length - 1].tick > relayed[0].tick, 'relayed ticks keep advancing');
  log(`B relayed ${relayed.length} tick(s) that originated in A`);

  await waitFor('synthetic runtime finished and dropped from B\'s ledger', () => {
    const ledger = readLedger();
    return ledger && !ledger.runtimes?.[syntheticId] ? true : null;
  }, SYNTHETIC_MS + 30_000, 1_000);
  assert.ok(wsB.received.some((m) => m.type === 'handoff_synthetic_done' && Number(m.pid) === pidA), 'completion broadcast from A reached B\'s client');
  log('synthetic runtime completed in A and was retired from B\'s ledger');

  await waitFor('A exits after draining', () => (!pidAlive(pidA) ? true : null), 60_000, 500);
  assert.equal(fs.existsSync(path.join(stateDir, 'runtimes', 'handoff-hosts', `${pidA}.json`)), false, 'host manifest removed after drain');
  log('A exited after the drain');

  const diagnostics = fs.existsSync(exitDiagnosticsPath)
    ? fs.readFileSync(exitDiagnosticsPath, 'utf-8').slice(exitDiagnosticsOffset).split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean)
    : [];
  const exitsA = diagnostics.filter((d) => d.pid === pidA && d.type === 'process_exit');
  if (exitsA.length) {
    assert.ok(exitsA.every((d) => d.code === 0), `A must exit 0 after a drain, saw ${JSON.stringify(exitsA.map((d) => d.code))}`);
  }

  const still = await health();
  assert.equal(Number(still?.pid), pidB, 'B remains the serving gateway');
  assert.ok(logLines.some((line) => /is handing off/.test(line)), 'supervisor logged the handoff notice');
  assert.ok(logLines.some((line) => /Drained gateway .* exited/.test(line)), 'supervisor logged the drained exit without relaunching');
  assert.ok(!logLines.some((line) => /Gateway exited \((42|0)\)\./.test(line) && /Scheduling gateway restart/.test(line)), 'no relaunch was scheduled for the drained gateway');

  wsB.ws.close();
  console.log('gateway handoff e2e: ok');
} finally {
  if (supervisor?.pid) killTree(supervisor.pid);
  await sleep(500);
  if (process.env.PROMETHEUS_HANDOFF_E2E_KEEP === '1') console.log(`[handoff-e2e] kept ${testRoot}`);
  else try { fs.rmSync(testRoot, { recursive: true, force: true }); } catch {}
}
