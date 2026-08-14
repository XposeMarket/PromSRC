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

assert.match(mainSource, /detached:\s*process\.platform !== 'win32'/);
assert.match(mainSource, /killManagedGatewayProcessTree\(staleProcess\)/);
assert.match(mainSource, /await waitForGatewayPortRelease\(\)/);

assert.deepEqual(parsePidList('101\n202\n101\nnot-a-pid\n'), [101, 202]);
assert.deepEqual(
  getPosixListeningPids(18789, () => '101\n202\n101\n'),
  [101, 202],
);
assert.deepEqual(getPosixListeningPids(0, () => '101\n'), []);

if (process.platform === 'win32') {
  console.log('electron gateway restart process-group smoke test: skipped on Windows');
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
