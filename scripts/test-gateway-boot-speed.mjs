#!/usr/bin/env node
// Regression for the gateway boot/restart speed work:
//  1. compiled-build freshness + build stamps decide dist/ vs tsx correctly (behavioral, temp tree)
//  2. a planned restart exit (42) relaunches without crash backoff or the netstat port scan
//  3. the desktop dev launcher uses dist/ when current instead of always forcing tsx
//  4. boot-path costs stay off the critical path (vault decrypt for the banner, document
//     parsers at import, double skill seeding)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const require = createRequire(import.meta.url);
const freshness = require(path.join(repo, 'electron', 'compiled-build-freshness.js'));
const read = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8');

// ── 1. freshness + stamps ──────────────────────────────────────────────────
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-boot-freshness-'));
const write = (rel, body = 'x', mtimeMs) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  if (mtimeMs) fs.utimesSync(p, mtimeMs / 1000, mtimeMs / 1000);
};
try {
  const t0 = Date.now() - 60_000;
  write('src/gateway/server-v2.ts', 'a', t0);
  write('src/config/soul.md', 'a', t0);
  write('extensions/prometheus-personal-chrome/manifest.json', '{}', t0);

  let r = freshness.checkCompiledBuildFreshness(root);
  assert.equal(r.fresh, false);
  assert.match(r.reason, /dist\/cli\/index\.js is missing/);

  write('dist/cli/index.js');
  write('dist/gateway/server-v2.js');
  r = freshness.checkCompiledBuildFreshness(root);
  assert.equal(r.fresh, false, 'entries without a completed build stamp are not current');
  assert.match(r.reason, /no completed backend build stamp/);

  assert.throws(() => freshness.completeBuildStamp(root), /build-in-progress\.json is missing/, 'complete without begin must fail the build');

  freshness.beginBuildStamp(root, t0 + 1_000);
  r = freshness.checkCompiledBuildFreshness(root);
  assert.equal(r.fresh, false, 'an in-progress build is never current');
  freshness.completeBuildStamp(root, t0 + 5_000);
  assert.ok(!fs.existsSync(path.join(root, 'dist', '.build-in-progress.json')));
  r = freshness.checkCompiledBuildFreshness(root);
  assert.equal(r.fresh, true, r.reason);
  assert.equal(typeof r.checkMs, 'number');

  // An edit made while the build was running (after start, before complete) keeps tsx.
  write('src/config/soul.md', 'b', t0 + 2_000);
  r = freshness.checkCompiledBuildFreshness(root);
  assert.equal(r.fresh, false);
  assert.match(r.reason, /src\/config\/soul\.md changed after the last backend build/);

  // A new build makes it current again; copied trees outside src/ count too.
  freshness.beginBuildStamp(root, t0 + 10_000);
  freshness.completeBuildStamp(root, t0 + 12_000);
  assert.equal(freshness.checkCompiledBuildFreshness(root).fresh, true);
  write('extensions/prometheus-personal-chrome/service-worker.js', 'x', t0 + 20_000);
  assert.equal(freshness.checkCompiledBuildFreshness(root).fresh, false, 'the copied chrome extension tree is a build input');

  // begin drops a previous completion stamp, so a failed rebuild is never current.
  freshness.beginBuildStamp(root, t0 + 30_000);
  assert.ok(!fs.existsSync(path.join(root, 'dist', '.build-complete.json')));
  assert.equal(freshness.checkCompiledBuildFreshness(root).fresh, false);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

// ── 2. planned restart fast path (CLI supervisor) ─────────────────────────
const cli = read('src/cli/index.ts');
assert.match(cli, /const GATEWAY_PLANNED_RESTART_EXIT_CODE = 42;/);
assert.match(cli, /const plannedRestart = code === GATEWAY_PLANNED_RESTART_EXIT_CODE;/);
assert.match(cli, /const portOwnerPids = plannedRestart \? \[\] : getGatewayPortOwnerPids\(\);/, 'planned exits skip the netstat owner scan');
assert.match(cli, /scheduleLaunch\(hasExplicitQuickRestartContext\(supervisorStateDir\), plannedRestart\);/);
assert.match(cli, /: plannedRestart\s*\n\s*\? 100\s*\n\s*: Math\.min\(10_000, 1000 \+ restartCount \* 1000\)/, 'planned exits relaunch after 100ms, crash loops still back off first');
assert.match(cli, /if \(!explicitQuickRestart && !plannedRestart\) await clearUnhealthyGatewayPort/, 'planned relaunch skips the port-clearing probe');
assert.match(cli, /\.\.\.\(explicitQuickRestart \? \{ PROMETHEUS_HOT_RESTART: '1' \} : \{\}\)/, 'only explicit quick restarts boot hot');
assert.match(cli, /checkCompiledBuildFreshness\(rootDir\)/);
assert.match(cli, /entry\.endsWith\('\.ts'\) \? \[\.\.\.sourceLoaderExecArgv\(\), \.\.\.heapFlags, entry\]/, 'a compiled supervisor adds tsx when it relaunches from source');
assert.doesNotMatch(cli, /function sourceTreeNewerThanCompiled/);

// ── 3. desktop dev launcher ────────────────────────────────────────────────
const main = read('electron/main.js');
assert.match(main, /const \{ checkCompiledBuildFreshness \} = require\('\.\/compiled-build-freshness'\);/);
assert.match(main, /path\.join\(APP_ROOT, 'dist', 'cli', 'index\.js'\)/);
assert.doesNotMatch(main, /PROMETHEUS_GATEWAY_USE_SOURCE: '1'/, 'dev launches must not force tsx');
assert.doesNotMatch(main, /execFileSync\(tailscaleBin/, 'the Funnel retarget must not block the gateway launch');
assert.match(main, /const rendererPrepared = prepareSourceElectronRenderer\(\);\s*\n\s*await waitForGateway\(\);\s*\n\s*await rendererPrepared;/);
const lifecycle = read('src/gateway/lifecycle.ts');
assert.match(lifecycle, /checkCompiledBuildFreshness\(root\)\.fresh/);
assert.doesNotMatch(lifecycle, /function isSourceTreeNewerThanCompiled/);
const pkg = JSON.parse(read('package.json'));
assert.match(pkg.scripts['build:backend'], /^node scripts\/build-stamp\.js begin && /);
assert.match(pkg.scripts['build:backend'], / && node scripts\/build-stamp\.js complete$/);

// ── 4. boot-path costs ─────────────────────────────────────────────────────
const startup = read('src/gateway/core/startup.ts');
assert.doesNotMatch(startup, /resolveSecret\(searchCfg\./, 'the terminal banner must not decrypt vault entries before listen');
const attachments = read('src/gateway/chat/attachment-context.ts');
assert.doesNotMatch(attachments, /^const \w+: any = require\('(?:xlsx|mammoth|pdf-parse)'\);/m, 'document parsers load on first use');
const server = read('src/gateway/server-v2.ts');
assert.match(server, /seenFolders\.has\(folderKey\(dir\)\)/, 'each real skills folder is seeded once');
assert.match(server, /seedBundledSkillsIntoDir\(dir, bundledSkillsDir, triggerBaseline\)/);

console.log('gateway boot speed: all checks passed');
