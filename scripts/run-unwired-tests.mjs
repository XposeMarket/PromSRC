#!/usr/bin/env node
// Runs every test file that no package.json script or CI workflow references.
//
// Hundreds of one-off regression scripts were written alongside fixes but never
// wired into `npm test` or CI, so they silently rotted (the Oct 2026 legacy
// audit found ~25 failing, all stale or broken harnesses, none caught). This
// runner keeps them honest without putting slow suites in the PR gate:
//
//   npm run test:unwired                 # run all unwired tests (6 at a time)
//   npm run test:unwired -- --list       # just list them
//   npm run test:unwired -- --filter video --concurrency 2
//
// Every test runs from the repo root with the tsx loader (several .mjs tests
// import .ts modules) and with no environment overrides: tests that need
// isolated data dirs create their own.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const concurrency = Math.max(1, Number(opt('concurrency', 6)) || 6);
const timeoutMs = Math.max(10_000, Number(opt('timeout', 180_000)) || 180_000);
const filter = opt('filter', '');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'generated', 'release', 'release-public', 'artifacts', '.tmp', 'temp', 'fixtures']);
const TEST_FILE = /(^|[\\/])(test-[\w.-]+\.(mjs|js|ts)|[\w.-]+\.regression\.ts|[\w.-]+\.test\.(mjs|ts))$/;

function walk(dir, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      walk(path.join(dir, entry.name), out);
    } else if (TEST_FILE.test(entry.name)) {
      out.push(path.relative(root, path.join(dir, entry.name)).replace(/\\/g, '/'));
    }
  }
}

const candidates = [];
for (const dir of ['scripts', 'src', 'apps']) walk(path.join(root, dir), candidates);

const references = [fs.readFileSync(path.join(root, 'package.json'), 'utf8')];
const workflows = path.join(root, '.github', 'workflows');
for (const name of fs.existsSync(workflows) ? fs.readdirSync(workflows) : []) references.push(fs.readFileSync(path.join(workflows, name), 'utf8'));
const wired = references.join('\n');

const unwired = candidates
  .filter((file) => file !== 'scripts/run-unwired-tests.mjs')
  .filter((file) => !wired.includes(file) && !wired.includes(path.basename(file)))
  .filter((file) => !filter || file.includes(filter))
  .sort();

if (flag('list')) {
  for (const file of unwired) console.log(file);
  console.log(`${unwired.length} unwired test file(s)`);
  process.exit(0);
}

const results = [];
let next = 0;
function runOne(file) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, ['--import', 'tsx', file], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    const capture = (chunk) => { output = (output + chunk.toString()).slice(-8000); };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      else child.kill('SIGKILL');
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ file, status: timedOut ? 'timeout' : code === 0 ? 'pass' : 'fail', ms: Date.now() - started, output });
    });
  });
}
async function worker() {
  while (next < unwired.length) {
    const result = await runOne(unwired[next++]);
    results.push(result);
    console.log(`${result.status.padEnd(7)} ${String(result.ms).padStart(6)}ms ${result.file}`);
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, unwired.length || 1) }, worker));

const failed = results.filter((result) => result.status !== 'pass');
for (const result of failed) {
  console.log(`\n--- ${result.status}: ${result.file}`);
  console.log(result.output.trim().split(/\r?\n/).slice(-15).join('\n'));
}
console.log(`\n${results.length - failed.length}/${results.length} unwired tests passed`);
process.exit(failed.length ? 1 : 0);
