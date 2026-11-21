#!/usr/bin/env node
// Pull-request regression suite runner. The suite itself lives in scripts/ci/regressions.json.
//
//   node scripts/ci/run-regressions.mjs --shard 2/4     run one CI shard (what GitHub runs)
//   node scripts/ci/run-regressions.mjs --plan 4        show how the suite splits into 4 shards
//   node scripts/ci/run-regressions.mjs --list          list every regression with its estimate
//   node scripts/ci/run-regressions.mjs --only <regex>  run regressions whose name matches
//   node scripts/ci/run-regressions.mjs --all           run the whole suite in this process
//
// Every regression runs even after an earlier one fails, so one CI round reports every failure.
// Shards are balanced from each entry's `seconds` estimate; the plan is deterministic, so every
// shard job computes the same split from the same manifest.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const manifestPath = path.join(repoRoot, 'scripts', 'ci', 'regressions.json');
export const DEFAULT_SECONDS = 5;
export const DEFAULT_TIMEOUT_SECONDS = 600;
export const TIMINGS_TITLE = 'Regression timings';
const ENTRY_KEYS = new Set(['name', 'run', 'needs', 'seconds', 'timeoutSeconds']);
const SETUP_KEYS = new Set(['description', 'run', 'seconds', 'timeoutSeconds']);

export function commandsOf(item) {
  const list = Array.isArray(item?.run) ? item.run : [item?.run];
  return list.filter((command) => typeof command === 'string' && command.trim()).map((command) => command.trim());
}

export function validateManifest(manifest) {
  const problems = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('regression manifest must be a JSON object');
  const setups = manifest.setups || {};
  if (typeof setups !== 'object' || Array.isArray(setups)) problems.push('setups must be an object');
  for (const [id, setup] of Object.entries(setups)) {
    if (!/^[a-z][a-z0-9-]*$/.test(id)) problems.push(`setup "${id}" must be lower-case kebab-case`);
    for (const key of Object.keys(setup || {})) if (!SETUP_KEYS.has(key)) problems.push(`setup "${id}" has unknown key "${key}"`);
    if (!commandsOf(setup).length) problems.push(`setup "${id}" needs a run command`);
    if (setup?.seconds != null && !(Number.isFinite(setup.seconds) && setup.seconds > 0)) problems.push(`setup "${id}" seconds must be a positive number`);
  }
  if (!Array.isArray(manifest.regressions) || manifest.regressions.length === 0) problems.push('regressions must be a non-empty array');
  const names = new Set();
  for (const [index, entry] of (manifest.regressions || []).entries()) {
    const label = typeof entry?.name === 'string' && entry.name.trim() ? `"${entry.name}"` : `#${index + 1}`;
    if (label.startsWith('#')) problems.push(`regression ${label} needs a name`);
    else if (names.has(entry.name)) problems.push(`duplicate regression name ${label}`);
    else names.add(entry.name);
    for (const key of Object.keys(entry || {})) if (!ENTRY_KEYS.has(key)) problems.push(`regression ${label} has unknown key "${key}"`);
    if (!commandsOf(entry).length) problems.push(`regression ${label} needs a run command`);
    if (Array.isArray(entry?.run) && commandsOf(entry).length !== entry.run.length) problems.push(`regression ${label} has an empty command`);
    if (entry?.needs != null && !Array.isArray(entry.needs)) problems.push(`regression ${label} needs must be an array`);
    for (const need of entry?.needs || []) if (!Object.hasOwn(setups, need)) problems.push(`regression ${label} needs unknown setup "${need}"`);
    for (const key of ['seconds', 'timeoutSeconds']) {
      if (entry?.[key] != null && !(Number.isFinite(entry[key]) && entry[key] > 0)) problems.push(`regression ${label} ${key} must be a positive number`);
    }
  }
  if (problems.length) throw new Error(`Invalid regression manifest:\n- ${problems.join('\n- ')}`);
  return manifest;
}

export function loadManifest(file = manifestPath) {
  return validateManifest(JSON.parse(fs.readFileSync(file, 'utf8')));
}

const estimate = (item) => (Number.isFinite(item?.seconds) && item.seconds > 0 ? item.seconds : DEFAULT_SECONDS);

// Greedy longest-first balancing. Placing an entry on a shard that has not yet run one of its
// setups costs that setup's estimate too, so entries sharing a setup tend to share a shard.
export function planShards(manifest, count) {
  if (!Number.isInteger(count) || count < 1) throw new Error(`shard count must be a positive integer (got ${count})`);
  const setups = manifest.setups || {};
  const shards = Array.from({ length: count }, (_, index) => ({ index: index + 1, load: 0, setups: new Set(), items: [] }));
  const order = manifest.regressions
    .map((entry, position) => ({ entry, position }))
    .sort((a, b) => (estimate(b.entry) - estimate(a.entry)) || (a.position - b.position));
  for (const item of order) {
    let best = null;
    let bestCost = Infinity;
    for (const shard of shards) {
      const setupCost = (item.entry.needs || []).filter((need) => !shard.setups.has(need)).reduce((sum, need) => sum + estimate(setups[need]), 0);
      const cost = shard.load + setupCost + estimate(item.entry);
      if (cost < bestCost) { best = shard; bestCost = cost; }
    }
    best.load = bestCost;
    for (const need of item.entry.needs || []) best.setups.add(need);
    best.items.push(item);
  }
  return shards.map((shard) => ({
    index: shard.index,
    estimatedSeconds: Math.round(shard.load),
    setups: [...shard.setups].sort(),
    entries: shard.items.sort((a, b) => a.position - b.position).map((item) => item.entry),
  }));
}

export function parseShard(value) {
  const match = /^(\d+)\/(\d+)$/.exec(String(value || ''));
  if (!match) throw new Error(`--shard expects <index>/<count>, for example 2/4 (got "${value}")`);
  const index = Number(match[1]);
  const count = Number(match[2]);
  if (count < 1 || index < 1 || index > count) throw new Error(`--shard ${value} is out of range`);
  return { index, count };
}

const inActions = () => process.env.GITHUB_ACTIONS === 'true';
const escapeData = (value) => String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
let activeChild = null;
let interrupted = null;

function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
}

// Runs one shell command, streaming its output and keeping the tail for failure reports.
export function runCommand(command, { cwd = repoRoot, env = process.env, timeoutSeconds = DEFAULT_TIMEOUT_SECONDS, out = process.stdout, err = process.stderr } = {}) {
  return new Promise((resolve) => {
    let tail = '';
    let timedOut = false;
    let settled = false;
    const keep = (chunk) => { tail = (tail + chunk).slice(-24000); };
    // POSIX: own process group, so a timeout or cancel can stop the whole command tree.
    const child = spawn(command, { cwd, env, shell: true, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
    activeChild = child;
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutSeconds * 1000);
    child.stdout.on('data', (chunk) => { out.write(chunk); keep(String(chunk)); });
    child.stderr.on('data', (chunk) => { err.write(chunk); keep(String(chunk)); });
    const done = (code, signal, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (activeChild === child) activeChild = null;
      resolve({ code: timedOut ? 124 : (signal ? 1 : (code ?? 1)), signal: signal || null, timedOut, error: error ? String(error.message || error) : null, tail });
    };
    child.on('error', (error) => done(1, null, error));
    child.on('close', (code, signal) => done(code, signal));
  });
}

function describeFailure(failure) {
  if (failure.timedOut) return `timed out running: ${failure.command}`;
  if (failure.error) return `could not start "${failure.command}": ${failure.error}`;
  if (failure.signal) return `terminated by ${failure.signal} running: ${failure.command}`;
  if (interrupted) return `interrupted by ${interrupted} running: ${failure.command}`;
  return `exit ${failure.code} running: ${failure.command}`;
}

// Runs entries in order, running each needed setup once (lazily) before its first user.
export async function runSuite({ manifest, entries, label = 'suite', cwd = repoRoot, env = process.env, out = process.stdout, err = process.stderr } = {}) {
  const setups = manifest.setups || {};
  const setupState = new Map();
  const results = [];
  const started = Date.now();
  const actions = inActions();

  const reportFailure = (name, detail, tail) => {
    if (actions) out.write(`::error title=Regression failed::${escapeData(`${name}: ${detail}`)}\n`);
    out.write(`\n✖ FAIL ${name}: ${detail}\n`);
    const lines = String(tail || '').trimEnd().split(/\r?\n/).slice(-60);
    if (lines.length && lines[0]) out.write(`--- last output of ${name} ---\n${lines.join('\n')}\n--- end of ${name} ---\n`);
  };

  async function runItem(title, item) {
    const t0 = Date.now();
    out.write(actions ? `::group::${title}\n` : `\n=== ${title}\n`);
    let failure = null;
    for (const command of commandsOf(item)) {
      out.write(`$ ${command}\n`);
      const result = await runCommand(command, { cwd, env, out, err, timeoutSeconds: item.timeoutSeconds || DEFAULT_TIMEOUT_SECONDS });
      if (result.code !== 0 || interrupted) { failure = { command, ...result }; break; }
    }
    if (actions) out.write('::endgroup::\n');
    return { ok: !failure, failure, seconds: (Date.now() - t0) / 1000 };
  }

  for (const entry of entries) {
    if (interrupted) {
      results.push({ name: entry.name, status: 'not run', seconds: 0, detail: `interrupted by ${interrupted}` });
      continue;
    }
    let blockedBy = null;
    for (const need of entry.needs || []) {
      if (!setupState.has(need)) {
        const setup = setups[need];
        const outcome = await runItem(`setup: ${need}${setup.description ? ` (${setup.description})` : ''}`, setup);
        setupState.set(need, outcome);
        const detail = outcome.failure ? describeFailure(outcome.failure) : '';
        results.push({ name: `setup: ${need}`, setup: true, status: outcome.ok ? 'passed' : 'failed', seconds: outcome.seconds, estimate: setup.seconds, detail });
        if (!outcome.ok) reportFailure(`setup: ${need}`, detail, outcome.failure.tail);
        else out.write(`✔ setup ${need} (${outcome.seconds.toFixed(1)}s)\n`);
      }
      if (!setupState.get(need).ok && !blockedBy) blockedBy = need;
    }
    if (blockedBy) {
      const detail = `not run because setup "${blockedBy}" failed`;
      results.push({ name: entry.name, status: 'blocked', seconds: 0, estimate: entry.seconds, detail });
      if (actions) out.write(`::error title=Regression blocked::${escapeData(`${entry.name}: ${detail}`)}\n`);
      continue;
    }
    const outcome = await runItem(entry.name, entry);
    const detail = outcome.failure ? describeFailure(outcome.failure) : '';
    results.push({ name: entry.name, status: outcome.ok ? 'passed' : (interrupted ? 'interrupted' : 'failed'), seconds: outcome.seconds, estimate: entry.seconds, detail });
    if (outcome.ok) out.write(`✔ PASS ${entry.name} (${outcome.seconds.toFixed(1)}s)\n`);
    else reportFailure(entry.name, detail, outcome.failure.tail);
  }
  return { label, results, seconds: (Date.now() - started) / 1000, interrupted };
}

export function summarize(run) {
  const bad = run.results.filter((result) => result.status !== 'passed');
  const passed = run.results.filter((result) => result.status === 'passed' && !result.setup).length;
  const verdict = bad.length === 0 && !run.interrupted ? 'PASS' : 'FAIL';
  const icon = (result) => (result.status === 'passed' ? '✅' : result.status === 'failed' ? '❌' : '⚠️');
  const sorted = [...run.results].sort((a, b) => (a.status === 'passed') - (b.status === 'passed') || b.seconds - a.seconds);
  const text = [
    `Regression ${run.label}: ${verdict} (${passed} passed, ${bad.length} not passing) in ${run.seconds.toFixed(1)}s`,
    ...bad.map((result) => `  ✖ ${result.status.toUpperCase()} ${result.name}: ${result.detail}`),
  ].join('\n');
  const markdown = [
    `### Regression ${run.label}: ${verdict} in ${run.seconds.toFixed(1)}s`,
    '',
    '| Result | Seconds | Estimate | Regression |',
    '|---|---:|---:|---|',
    ...sorted.map((result) => `| ${icon(result)} ${result.status} | ${result.seconds.toFixed(1)} | ${result.estimate ?? DEFAULT_SECONDS} | ${result.name.replace(/\|/g, '/')} |`),
    '',
  ].join('\n');
  const timings = Object.fromEntries(run.results.map((result) => [result.name, Number(result.seconds.toFixed(1))]));
  return { verdict, text, markdown, timings };
}

function usage() {
  return 'usage: run-regressions.mjs --shard <i>/<n> | --plan <n> | --list | --only <regex> | --all';
}

export async function main(argv) {
  const args = { };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--list' || flag === '--all') args[flag.slice(2)] = true;
    else if (flag === '--shard' || flag === '--plan' || flag === '--only') args[flag.slice(2)] = argv[++i];
    else throw new Error(`unknown argument "${flag}"\n${usage()}`);
  }
  const manifest = loadManifest();
  if (args.list) {
    for (const entry of manifest.regressions) console.log(`${String(estimate(entry)).padStart(4)}s  ${entry.name}${entry.needs?.length ? `  [needs ${entry.needs.join(', ')}]` : ''}`);
    return 0;
  }
  if (args.plan) {
    for (const shard of planShards(manifest, Number(args.plan))) {
      console.log(`shard ${shard.index}/${args.plan}: ~${shard.estimatedSeconds}s, ${shard.entries.length} regressions${shard.setups.length ? `, setups: ${shard.setups.join(', ')}` : ''}`);
      for (const entry of shard.entries) console.log(`  ${String(estimate(entry)).padStart(4)}s  ${entry.name}`);
    }
    return 0;
  }
  let entries;
  let label;
  if (args.shard) {
    const { index, count } = parseShard(args.shard);
    const shard = planShards(manifest, count)[index - 1];
    entries = shard.entries;
    label = `shard ${index}/${count}`;
    console.log(`Regression ${label}: ${entries.length} regressions, estimated ~${shard.estimatedSeconds}s${shard.setups.length ? ` (setups: ${shard.setups.join(', ')})` : ''}`);
  } else if (args.only) {
    const pattern = new RegExp(args.only, 'i');
    entries = manifest.regressions.filter((entry) => pattern.test(entry.name));
    if (!entries.length) throw new Error(`no regression name matches /${args.only}/i`);
    label = `--only ${args.only}`;
  } else if (args.all) {
    entries = manifest.regressions;
    label = 'full suite';
  } else {
    console.error(usage());
    return 2;
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { interrupted = signal; killTree(activeChild); });
  const run = await runSuite({ manifest, entries, label });
  const summary = summarize(run);
  console.log(`\n${summary.text}`);
  console.log(`CI_TIMINGS_JSON=${JSON.stringify(summary.timings)}`);
  // Annotations are readable through the public API (logs are not), so `npm run ci:rebalance -- <run id>`
  // can refresh the manifest's seconds from a real run.
  if (inActions()) console.log(`::notice title=${TIMINGS_TITLE} ${label.replace(/[:,]/g, ' ')}::${escapeData(JSON.stringify(summary.timings))}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.markdown);
  if (run.interrupted) return run.interrupted === 'SIGINT' ? 130 : 143;
  return summary.verdict === 'PASS' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error) => { console.error(error?.message || error); process.exitCode = 2; },
  );
}
