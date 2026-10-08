import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1))), '..');
const require = createRequire(import.meta.url);
const {
  getPosixListeningPids,
  killGatewayProcessTree,
  parsePidList,
} = require(path.join(root, 'electron', 'gateway-process.js'));
const mainSource = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
const cliSource = fs.readFileSync(path.join(root, 'src', 'cli', 'index.ts'), 'utf8');
const lifecycleSource = fs.readFileSync(path.join(root, 'src', 'gateway', 'lifecycle.ts'), 'utf8');

// --- Single launcher contract -------------------------------------------------
// Electron starts the same supervisor `prom gateway start` runs and owns no
// supervision of its own.
assert.match(mainSource, /\['gateway', 'start', '--port', String\(gatewayPort\)\]/, 'Electron must launch `gateway start` through the CLI');
assert.match(mainSource, /'dist', 'cli', 'index\.js'/, 'packaged Electron must launch the compiled CLI');
assert.match(mainSource, /'src', 'cli', 'index\.ts'/, 'source Electron must launch the CLI source');
assert.match(mainSource, /PROMETHEUS_SUPERVISOR:\s*'1'/, 'Electron must enable the CLI supervisor');
assert.match(mainSource, /PROMETHEUS_ELECTRON_SUPPORTS_RELAUNCH: '1'/);
assert.match(mainSource, /detached:\s*process\.platform !== 'win32'/);
assert.match(mainSource, /supervisor\.stdin\?\.write\(\(vaultKeyHex \|\| ''\) \+ '\\n'\)/, 'Electron hands the vault key line to the supervisor');
for (const removed of [
  'createGatewayReverseProxy',
  'startGatewayHealthWatchdog',
  'requestAutomaticGatewayRecovery',
  'classifyGatewaySupervisorObservation',
  'drainingGatewayProcesses',
  'handoffGatewayFromElectron',
  'gatewayBackendPort',
  'PROMETHEUS_GATEWAY_INTERNAL_PORT: String',
]) {
  assert.ok(!mainSource.includes(removed), `electron/main.js must not keep its own supervisor (${removed})`);
}
const relaunchStart = mainSource.indexOf('if (code === GATEWAY_APP_RELAUNCH_EXIT_CODE) {');
assert.ok(relaunchStart >= 0, 'Electron must relaunch the app on supervisor exit code 43');
assert.match(mainSource.slice(relaunchStart, relaunchStart + 1200), /app\.relaunch\(/);

// The CLI supervisor forwards the vault key and the relaunch code.
assert.match(cliSource, /getInjectedMasterKey\(\)/, 'the supervisor reads the vault key Electron handed it');
assert.match(cliSource, /launched\.stdin\?\.end\(electronVaultKeyLine\)/, 'the supervisor forwards the vault key to each gateway child');
assert.match(cliSource, /desktopManaged && code === GATEWAY_APP_RELAUNCH_EXIT_CODE/);
assert.match(cliSource, /process\.exit\(GATEWAY_APP_RELAUNCH_EXIT_CODE\)/);
assert.match(cliSource, /desktopManaged && code === 0\)/, 'a clean desktop gateway shutdown must stop the supervisor');
assert.match(lifecycleSource, /externallySupervised && !electronManaged && restartCtx\.restartScope === 'supervisor'/,
  'a desktop supervisor is replaced by an app relaunch, never a detached supervisor');

assert.deepEqual(parsePidList('101\n202\n101\nnot-a-pid\n'), [101, 202]);
assert.deepEqual(
  getPosixListeningPids(18789, () => '101\n202\n101\n'),
  [101, 202],
);
assert.deepEqual(getPosixListeningPids(0, () => '101\n'), []);

if (process.platform === 'win32') {
  console.log('electron gateway launcher contract: ok (process-group smoke test skipped on Windows)');
  process.exit(0);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function portAvailable(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    let settled = false;
    const done = (available) => {
      if (settled) return;
      settled = true;
      resolve(available);
    };
    probe.once('error', () => done(false));
    probe.listen({ port, host: '127.0.0.1', exclusive: true }, () => {
      probe.close(() => done(true));
    });
  });
}

async function waitForPortState(port, expectedAvailable, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portAvailable(port) === expectedAvailable) return;
    await wait(50);
  }
  throw new Error(`Timed out waiting for port ${port} availability=${expectedAvailable}`);
}

const port = 28000 + Math.floor(Math.random() * 1000);
const listenerCode = [
  "const net = require('node:net');",
  `net.createServer(() => {}).listen(${port}, '127.0.0.1');`,
  'setInterval(() => {}, 1000);',
].join('\n');
const parentCode = [
  "const { spawn } = require('node:child_process');",
  `const listenerCode = ${JSON.stringify(listenerCode)};`,
  "spawn(process.execPath, ['-e', listenerCode], { stdio: 'ignore' });",
  'setInterval(() => {}, 1000);',
].join('\n');

const parent = spawn(process.execPath, ['-e', parentCode], {
  detached: true,
  stdio: 'ignore',
});

try {
  await waitForPortState(port, false);
  assert.ok(parent.pid, 'fixture parent must have a pid');
  killGatewayProcessTree(parent);
  await waitForPortState(port, true);
  console.log('electron gateway restart process-group smoke test: ok');
} finally {
  try { killGatewayProcessTree(parent); } catch {}
  for (const pid of getPosixListeningPids(port)) {
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }
}
