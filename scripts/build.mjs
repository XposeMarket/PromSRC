#!/usr/bin/env node
// `npm run build`: compile the backend and sync the public web UI at the same time.
// The halves write disjoint outputs (backend: dist/; web: generated/public-web-ui and
// web-ui/src/vendor/thinking-orb.js) and neither reads the other's output, so running
// them concurrently produces the same files as `npm run build:serial` in less time.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tasks = [
  { label: 'backend', script: 'build:backend' },
  { label: 'web', script: 'build:web' },
];

function spawnNpmScript(script) {
  const options = { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true };
  const npmCli = process.env.npm_execpath;
  // Under `npm run`, npm_execpath is npm's JS entry: run it with this Node, no shell needed.
  if (npmCli && /\.[cm]?js$/i.test(npmCli)) return spawn(process.execPath, [npmCli, 'run', '-s', script], options);
  if (process.platform === 'win32') return spawn('npm.cmd', ['run', '-s', script], { ...options, shell: true });
  return spawn('npm', ['run', '-s', script], options);
}

function forward(stream, target, label) {
  let pending = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop();
    for (const line of lines) target.write(`[${label}] ${line}\n`);
  });
  stream.on('end', () => { if (pending) target.write(`[${label}] ${pending}\n`); });
}

function run({ label, script }) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    const done = (code, detail) => {
      if (settled) return;
      settled = true;
      resolve({ label, script, code, detail, seconds: (Date.now() - started) / 1000 });
    };
    const child = spawnNpmScript(script);
    forward(child.stdout, process.stdout, label);
    forward(child.stderr, process.stderr, label);
    child.on('error', (error) => done(1, error.message));
    child.on('close', (code, signal) => done(signal ? 1 : (code ?? 1), signal ? `terminated by ${signal}` : ''));
  });
}

const started = Date.now();
const results = await Promise.all(tasks.map(run));
for (const result of results) {
  const status = result.code === 0 ? 'ok' : `FAILED (npm run ${result.script}: exit ${result.code}${result.detail ? `, ${result.detail}` : ''})`;
  console.log(`[build] ${result.label}: ${status} in ${result.seconds.toFixed(1)}s`);
}
console.log(`[build] total ${((Date.now() - started) / 1000).toFixed(1)}s`);
process.exitCode = results.every((result) => result.code === 0) ? 0 : 1;
