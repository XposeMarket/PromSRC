#!/usr/bin/env node
// Guards the sharded pull-request CI: manifest shape, deterministic shard plan, the workflow's
// required `verify` gate, and the runner's failure semantics (every failure reported, setups
// once, blocked dependents, timeouts, no false PASS).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadManifest, validateManifest, planShards, parseShard, runSuite, summarize, commandsOf, main, repoRoot } from './ci/run-regressions.mjs';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
let checks = 0;
const ok = (name) => { checks++; console.log(`ok ${checks} - ${name}`); };

// 1. Manifest: valid, and every command points at a real npm script or file.
const manifest = loadManifest();
for (const entry of [...manifest.regressions, ...Object.values(manifest.setups)]) {
  for (const command of commandsOf(entry)) {
    for (const part of command.split('&&').map((p) => p.trim())) {
      const npm = /^npm run(?: -s)? ([\w:.-]+)/.exec(part);
      if (npm) { assert.ok(pkg.scripts[npm[1]], `${entry.name || entry.description}: unknown npm script "${npm[1]}"`); continue; }
      const file = /^(?:node(?: --test| --import tsx)?|npx(?: --no-install)? tsx|tsx) ([\w./-]+\.(?:m?js|cjs|ts))\b/.exec(part);
      if (file) assert.ok(fs.existsSync(path.join(repoRoot, file[1])), `${entry.name}: missing file ${file[1]}`);
    }
  }
}
ok(`manifest has ${manifest.regressions.length} valid regressions whose scripts and files exist`);

assert.throws(() => validateManifest({ setups: {}, regressions: [{ name: 'a', run: 'x' }, { name: 'a', run: 'y' }] }), /duplicate regression name/);
assert.throws(() => validateManifest({ setups: {}, regressions: [{ name: 'a', run: 'x', needs: ['nope'] }] }), /unknown setup "nope"/);
assert.throws(() => validateManifest({ setups: {}, regressions: [{ name: 'a', run: ['x', ''] }] }), /empty command/);
assert.throws(() => validateManifest({ setups: {}, regressions: [{ name: 'a', run: 'x', shard: 2 }] }), /unknown key "shard"/);
ok('manifest validation rejects duplicates, unknown setups, empty commands and unknown keys');

// 2. Workflow: matrix shards run the manifest; `verify` stays the single required gate.
const workflow = yaml.load(fs.readFileSync(path.join(repoRoot, '.github/workflows/pr-regression.yml'), 'utf8'));
const shardJob = workflow.jobs.regressions;
const shards = shardJob.strategy.matrix.shard;
assert.equal(shardJob.strategy['fail-fast'], false, 'one failing shard must not cancel the others');
assert.deepEqual(shards, shards.map((_, i) => i + 1), 'matrix.shard must be 1..N');
assert.ok(shardJob.steps.find((s) => s.uses?.startsWith('actions/checkout')).with.ref.includes('inputs.ref'), 'shards check out the requested ref');
const runnerStep = shardJob.steps.find((s) => /run-regressions\.mjs/.test(s.run || '') && !/--print-setups/.test(s.run));
// Per-shard caches: the incremental backend build is restored only in shards whose plan needs it.
const planStep = shardJob.steps.find((s) => s.id === 'plan');
assert.match(planStep.run, /--shard \$\{\{ matrix\.shard \}\}\/\$\{\{ strategy\.job-total \}\} --print-setups/);
const distRestore = shardJob.steps.find((s) => s.uses?.startsWith('actions/cache/restore') && s.with?.path === 'dist');
const distSave = shardJob.steps.find((s) => s.uses?.startsWith('actions/cache/save') && s.with?.path === 'dist');
assert.ok(distRestore && distSave, 'backend dist cache restore and save steps');
for (const step of [distRestore, distSave]) assert.match(String(step.if), /contains\(steps\.plan\.outputs\.setups, ',backend,'\)/, 'dist cache only in shards that build the backend');
assert.equal(distRestore.with.key, distSave.with.key);
assert.ok(shardJob.steps.indexOf(distRestore) < shardJob.steps.indexOf(runnerStep) && shardJob.steps.indexOf(runnerStep) < shardJob.steps.indexOf(distSave));
assert.match(runnerStep.run, /--shard \$\{\{ matrix\.shard \}\}\/\$\{\{ strategy\.job-total \}\}/);
const stepIndex = (re) => shardJob.steps.findIndex((s) => re.test(s.run || ''));
assert.ok(stepIndex(/npm ci/) < stepIndex(/sync:web-ui/) && stepIndex(/sync:web-ui/) < shardJob.steps.indexOf(runnerStep), 'install, then web UI build, then regressions');
for (const step of shardJob.steps) {
  if (!step.run || step === runnerStep) continue;
  assert.doesNotMatch(step.run, /npm run (-s )?test:|\.regression\.ts|scripts\/test-/, `regressions belong in scripts/ci/regressions.json, not workflow step "${step.name}"`);
}
// The dependency cache must hold every directory npm ci writes. Local file: packages keep their
// own node_modules (packages/claude-driver/node_modules); missing one broke a cache-hit run.
const restore = shardJob.steps.find((s) => s.id === 'modules');
const save = shardJob.steps.find((s) => s.uses?.startsWith('actions/cache/save') && s.with?.path !== 'dist');
const cachePaths = String(restore.with.path).split('\n').map((p) => p.trim()).filter(Boolean);
assert.deepEqual(String(save.with.path).split('\n').map((p) => p.trim()).filter(Boolean), cachePaths, 'save and restore must cover the same paths');
const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));
const installDirs = new Set(['node_modules']);
for (const key of Object.keys(lock.packages || {})) {
  const at = key.indexOf('/node_modules/');
  if (key && !key.startsWith('node_modules/') && at > 0) installDirs.add(key.slice(0, at + '/node_modules'.length));
}
const globToRegExp = (glob) => new RegExp(`^${glob.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+')}$`);
for (const dir of installDirs) assert.ok(cachePaths.some((glob) => globToRegExp(glob).test(dir)), `dependency cache misses ${dir} (add it to the cache path list)`);
assert.match(restore.with.key, /hashFiles\('package-lock\.json'\)/);

const verify = workflow.jobs.verify;
assert.ok(verify && !verify.name, 'job id `verify` must keep its default check name (branch protection requires "verify")');
assert.match(String(verify.if), /always\(\)/, 'verify must run even when a shard fails (a skipped required check counts as passing)');
assert.deepEqual([].concat(verify.needs), ['regressions']);
assert.match(JSON.stringify(verify.steps), /needs\.regressions\.result/);
assert.match(JSON.stringify(verify.steps), /success/);
const audit = yaml.load(fs.readFileSync(path.join(repoRoot, '.github/workflows/privacy-secret-scan.yml'), 'utf8'));
assert.ok(audit.jobs.audit && !audit.jobs.audit.name, 'job id `audit` must keep its required check name');
ok(`workflow runs ${shards.length} shards and gates them behind the required verify check`);

// 3. Shard plan: every regression exactly once, deterministic, no empty shard.
const planA = planShards(manifest, shards.length);
const planB = planShards(manifest, shards.length);
assert.deepEqual(planA, planB, 'plan must be deterministic across shard jobs');
const assigned = planA.flatMap((shard) => shard.entries.map((entry) => entry.name)).sort();
assert.deepEqual(assigned, manifest.regressions.map((entry) => entry.name).sort());
for (const shard of planA) assert.ok(shard.entries.length > 0, `shard ${shard.index} is empty`);
assert.ok(manifest.regressions.some((entry) => (entry.needs || []).includes('backend')), 'some shard must run the backend build (it is the backend type-check)');
const affinity = planShards({ setups: { s: { run: 'x', seconds: 30 } }, regressions: [{ name: 'a', run: 'x', seconds: 20, needs: ['s'] }, { name: 'b', run: 'x', seconds: 10, needs: ['s'] }, { name: 'c', run: 'x', seconds: 40 }] }, 2);
assert.deepEqual(affinity.map((shard) => shard.entries.map((entry) => entry.name).join('+')).sort(), ['a+b', 'c'], 'entries sharing a setup share a shard when that is cheaper');
assert.deepEqual(affinity.find((shard) => shard.entries.length === 2).setups, ['s']);
assert.deepEqual(parseShard('2/4'), { index: 2, count: 4 });
for (const bad of ['0/4', '5/4', '2', 'a/b']) assert.throws(() => parseShard(bad));
ok('shard plan covers every regression once, is deterministic and keeps setups together');

// 4. Runner semantics on fixture manifests (real child processes, quiet output).
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-ci-runner-'));
const sink = { write() { return true; } };
const touch = (name) => `node -e "require('fs').appendFileSync('${name}','x')"`;
const exists = (name) => fs.existsSync(path.join(temp, name));
try {
  const fixture = validateManifest({
    setups: { good: { run: touch('setup-good') }, bad: { run: 'node -e "process.exit(3)"' } },
    regressions: [
      { name: 'first fails', run: [`node -e "process.exit(2)"`, touch('after-first-failure')] },
      { name: 'passes', run: touch('passes') },
      { name: 'uses good setup', run: touch('uses-good-1'), needs: ['good'] },
      { name: 'uses good setup again', run: touch('uses-good-2'), needs: ['good'] },
      { name: 'blocked by bad setup', run: touch('blocked'), needs: ['bad'] },
      { name: 'hangs', run: 'node -e "setTimeout(() => {}, 60000)"', timeoutSeconds: 1 },
      { name: 'last fails too', run: 'node -e "process.exit(1)"' },
    ],
  });
  const started = Date.now();
  const run = await runSuite({ manifest: fixture, entries: fixture.regressions, label: 'fixture', cwd: temp, out: sink, err: sink });
  const status = Object.fromEntries(run.results.map((result) => [result.name, result.status]));
  assert.equal(status['first fails'], 'failed');
  assert.equal(exists('after-first-failure'), false, 'a multi-command entry stops at its first failing command');
  assert.equal(status.passes, 'passed');
  assert.equal(exists('passes'), true);
  assert.equal(fs.readFileSync(path.join(temp, 'setup-good'), 'utf8'), 'x', 'a setup runs once for all of its users');
  assert.equal(status['uses good setup again'], 'passed');
  assert.equal(status['setup: bad'], 'failed');
  assert.equal(status['blocked by bad setup'], 'blocked');
  assert.equal(exists('blocked'), false, 'entries behind a failed setup never run');
  assert.equal(status.hangs, 'failed');
  assert.match(run.results.find((result) => result.name === 'hangs').detail, /timed out/);
  assert.equal(status['last fails too'], 'failed', 'entries after failures still run');
  assert.ok(Date.now() - started < 30000, 'timeout must stop the hung command promptly');
  const summary = summarize(run);
  assert.equal(summary.verdict, 'FAIL');
  for (const name of ['first fails', 'blocked by bad setup', 'hangs', 'last fails too', 'setup: bad']) assert.ok(summary.text.includes(name), `summary lists ${name}`);
  assert.match(summary.markdown, /\| Result \| Seconds \|/);
  ok('runner reports every failure, runs setups once, blocks dependents and enforces timeouts');

  const clean = await runSuite({ manifest: fixture, entries: fixture.regressions.filter((e) => e.name === 'passes'), label: 'clean', cwd: temp, out: sink, err: sink });
  assert.equal(summarize(clean).verdict, 'PASS');
  await assert.rejects(main(['--bogus']), /unknown argument/);
  ok('runner passes only when every selected regression passed, and rejects unknown flags');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
// 5. Rebalancing merges measured timings into the manifest (setups too) and ignores unknown names.
const { applyTimings } = await import('./ci/update-estimates.mjs');
const rebalance = { setups: { backend: { run: 'x', seconds: 35 } }, regressions: [{ name: 'a', run: 'x', seconds: 9 }, { name: 'b', run: 'x' }] };
const changes = applyTimings(rebalance, { 'setup: backend': 29.2, a: 0.3, b: 12.01, gone: 4, bad: Number.NaN });
assert.equal(rebalance.setups.backend.seconds, 30);
assert.equal(rebalance.regressions[0].seconds, 1, 'measured seconds round up with a floor of 1');
assert.equal(rebalance.regressions[1].seconds, 13);
assert.deepEqual(changes.map((change) => change.name), ['setup: backend', 'a', 'b']);
validateManifest(rebalance);
ok('ci:rebalance merges measured timings into setups and regressions');

console.log(`PASS: ${checks} CI regression runner checks`);
