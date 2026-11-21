#!/usr/bin/env node
// Regression for the gateway boot/restart speed work:
//  1. compiled-build freshness + the dist/ build lock decide dist/ vs tsx correctly (behavioral, temp tree)
//  2. a planned restart exit (42) relaunches without crash backoff or the netstat port scan
//  3. the desktop dev launcher uses dist/ when current instead of always forcing tsx
//  4. boot-path costs stay off the critical path (vault decrypt for the banner, document
//     parsers at import, double skill seeding)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const require = createRequire(import.meta.url);
const freshnessPath = path.join(repo, 'electron', 'compiled-build-freshness.js');
const freshness = require(freshnessPath);
const read = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8');

// ── 1. freshness + build lock ──────────────────────────────────────────────
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-boot-freshness-'));
const lockFile = path.join(root, 'dist', '.build-in-progress.json');
const completeFile = path.join(root, 'dist', '.build-complete.json');
const setTime = (p, ms) => fs.utimesSync(p, ms / 1000, ms / 1000);
const write = (rel, body = 'x', mtimeMs) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  if (mtimeMs) setTime(p, mtimeMs);
};
// Folder mtimes count (add/delete/rename), so fixtures backdate the whole source tree.
const ageTree = (dir, ms) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) ageTree(p, ms);
    setTime(p, ms);
  }
  setTime(dir, ms);
};
const ageSources = (ms) => { ageTree(path.join(root, 'src'), ms); ageTree(path.join(root, 'extensions'), ms); };
const build = (startMs, completeMs) => {
  const lock = freshness.acquireBuildLock(root, { now: startMs });
  assert.equal(freshness.completeBuild(root, lock, completeMs), true);
  freshness.releaseBuildLock(root, lock);
};
const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid; // exited by the time we use it

try {
  const t0 = Date.now() - 60_000;
  write('src/gateway/server-v2.ts', 'a', t0);
  write('src/config/soul.md', 'a', t0);
  write('extensions/prometheus-personal-chrome/manifest.json', '{}', t0);
  ageSources(t0);

  let r = freshness.checkCompiledBuildFreshness(root);
  assert.equal(r.fresh, false);
  assert.match(r.reason, /dist\/cli\/index\.js is missing/);

  write('dist/cli/index.js');
  write('dist/gateway/server-v2.js');
  r = freshness.checkCompiledBuildFreshness(root);
  assert.equal(r.fresh, false, 'entries without a completed build stamp are not current');
  assert.match(r.reason, /no completed backend build stamp/);

  // A build in progress is never current; completing + releasing makes it current.
  const lock = freshness.acquireBuildLock(root, { now: t0 + 1_000 });
  assert.equal(freshness.checkCompiledBuildFreshness(root).fresh, false);
  assert.match(freshness.checkCompiledBuildFreshness(root).reason, /a backend build started and has not completed/);
  assert.equal(freshness.completeBuild(root, lock, t0 + 5_000), true);
  freshness.releaseBuildLock(root, lock);
  assert.ok(!fs.existsSync(lockFile));
  r = freshness.checkCompiledBuildFreshness(root);
  assert.equal(r.fresh, true, r.reason);
  assert.deepEqual(JSON.parse(fs.readFileSync(completeFile, 'utf8')).sourceRoots, ['src', 'extensions/prometheus-personal-chrome']);

  // An edit made while the build was running (after start, before complete) keeps tsx.
  write('src/config/soul.md', 'b', t0 + 2_000);
  r = freshness.checkCompiledBuildFreshness(root);
  assert.equal(r.fresh, false);
  assert.match(r.reason, /src\/config\/soul\.md changed after the last backend build/);

  // Copied trees outside src/ are build inputs too.
  ageSources(t0);
  build(t0 + 10_000, t0 + 12_000);
  assert.equal(freshness.checkCompiledBuildFreshness(root).fresh, true);
  write('extensions/prometheus-personal-chrome/service-worker.js', 'x', t0 + 20_000);
  assert.equal(freshness.checkCompiledBuildFreshness(root).fresh, false, 'the copied chrome extension tree is a build input');

  // Deleting a source file (no surviving file is newer) is caught by its folder mtime.
  ageSources(t0);
  build(t0 + 30_000, t0 + 31_000);
  fs.rmSync(path.join(root, 'src', 'config', 'soul.md'));
  r = freshness.checkCompiledBuildFreshness(root);
  assert.equal(r.fresh, false, 'a deleted source file must invalidate dist/');
  assert.match(r.reason, /src\/config\/ changed after the last backend build/);

  // Renaming a file keeps its own mtime but changes its folder's.
  ageSources(t0);
  build(t0 + 40_000, t0 + 41_000);
  fs.renameSync(path.join(root, 'src', 'gateway', 'server-v2.ts'), path.join(root, 'src', 'gateway', 'server-v3.ts'));
  assert.equal(freshness.checkCompiledBuildFreshness(root).fresh, false, 'a renamed source file must invalidate dist/');
  fs.renameSync(path.join(root, 'src', 'gateway', 'server-v3.ts'), path.join(root, 'src', 'gateway', 'server-v2.ts'));

  // Deleting or renaming a whole source root (its parent is not scanned) still invalidates dist/.
  ageSources(t0);
  build(t0 + 45_000, t0 + 46_000);
  assert.equal(freshness.checkCompiledBuildFreshness(root).fresh, true);
  const chrome = path.join(root, 'extensions', 'prometheus-personal-chrome');
  fs.renameSync(chrome, `${chrome}-old`);
  r = freshness.checkCompiledBuildFreshness(root);
  assert.equal(r.fresh, false, 'a renamed source root must invalidate dist/');
  assert.match(r.reason, /extensions\/prometheus-personal-chrome\/ was removed or renamed after the last backend build/);
  fs.renameSync(`${chrome}-old`, chrome);
  ageSources(t0);
  build(t0 + 47_000, t0 + 48_000);
  assert.equal(freshness.checkCompiledBuildFreshness(root).fresh, true);

  // Acquiring the lock drops the previous completion stamp.
  const held = freshness.acquireBuildLock(root, { now: t0 + 50_000 });
  assert.ok(!fs.existsSync(completeFile));
  // A live owner is never taken over, however old its lock is.
  fs.writeFileSync(lockFile, JSON.stringify({ startedAtMs: 1, ownerPid: process.pid, token: 'ancient-but-alive' }));
  assert.throws(() => freshness.acquireBuildLock(root, { pid: process.pid + 1 }), /another backend build \(pid \d+\) is writing dist\//);
  // A build that lost its lock may neither publish nor delete the new owner's lock.
  assert.equal(freshness.completeBuild(root, held, t0 + 52_000), false);
  freshness.releaseBuildLock(root, held);
  assert.ok(fs.existsSync(lockFile), 'release must only remove our own lock');
  assert.ok(!fs.existsSync(completeFile));
  // An abandoned lock (owner process gone, e.g. a hard-killed build) is replaced.
  fs.writeFileSync(lockFile, JSON.stringify({ startedAtMs: Date.now(), ownerPid: deadPid(), token: 'abandoned' }));
  const takeover = freshness.acquireBuildLock(root, { now: t0 + 53_000 });
  assert.equal(freshness.completeBuild(root, takeover, t0 + 54_000), true);
  freshness.releaseBuildLock(root, takeover);
  assert.equal(freshness.checkCompiledBuildFreshness(root).fresh, true);

  // Race window 1: a lock created but not yet written is never treated as abandoned.
  let contenderError = null;
  const paused = freshness.acquireBuildLock(root, {
    pid: process.pid,
    hooks: { afterCreate: () => {
      assert.equal(fs.readFileSync(lockFile, 'utf8'), '', 'the lock is still empty at this point');
      try { freshness.acquireBuildLock(root, { pid: deadPid() }); } catch (e) { contenderError = e; }
    } },
  });
  assert.match(String(contenderError && contenderError.message), /is empty or unreadable/, 'an empty lock fails closed');
  assert.ok(freshness.completeBuild(root, paused), 'the paused winner still owns its lock');
  freshness.releaseBuildLock(root, paused);
  fs.writeFileSync(lockFile, '{ not json');
  assert.throws(() => freshness.acquireBuildLock(root), /is empty or unreadable/, 'a malformed lock fails closed');
  assert.equal(fs.readFileSync(lockFile, 'utf8'), '{ not json', 'a malformed lock is never deleted');
  fs.rmSync(lockFile);

  // Race window 2: two reclaimers of the same abandoned lock. B reclaims and acquires while A is
  // between inspecting the dead lock and reclaiming it; A must not delete B's fresh lock.
  fs.writeFileSync(lockFile, JSON.stringify({ startedAtMs: 1, ownerPid: deadPid(), token: 'abandoned-2' }));
  let lockB = null;
  assert.throws(() => freshness.acquireBuildLock(root, {
    pid: process.pid + 2_000_000,
    hooks: { beforeReclaim: () => { if (!lockB) lockB = freshness.acquireBuildLock(root, { pid: process.pid }); } },
  }), /another backend build \(pid \d+\)/, 'A sees B as the live owner after B reclaimed');
  assert.equal(JSON.parse(fs.readFileSync(lockFile, 'utf8')).token, lockB.token, "B's lock survived A's reclaim attempt");
  // A reclaim already in progress (its mutex exists) makes other reclaimers back off without deleting.
  freshness.releaseBuildLock(root, lockB);
  fs.writeFileSync(lockFile, JSON.stringify({ startedAtMs: 1, ownerPid: deadPid(), token: 'abandoned-3' }));
  fs.writeFileSync(`${lockFile}.reclaim`, '');
  assert.throws(() => freshness.acquireBuildLock(root), /another build is reclaiming/);
  assert.equal(JSON.parse(fs.readFileSync(lockFile, 'utf8')).token, 'abandoned-3');
  fs.rmSync(`${lockFile}.reclaim`);
  const reclaimed = freshness.acquireBuildLock(root);
  assert.ok(!fs.existsSync(`${lockFile}.reclaim`), 'the reclaim mutex is released');
  freshness.releaseBuildLock(root, reclaimed);

  // Simultaneous builds: of four processes acquiring at the same instant, exactly one wins.
  const startAt = Date.now() + 1_500;
  const contender = `
    const f = require(${JSON.stringify(freshnessPath)});
    const wait = ${startAt} - Date.now(); const spinUntil = ${startAt};
    setTimeout(() => {
      while (Date.now() < spinUntil) {}
      let lock;
      try { lock = f.acquireBuildLock(${JSON.stringify(root)}); }
      catch (e) { process.exit(/another backend build|could not acquire|is empty or unreadable|another build is reclaiming/.test(e.message) ? 3 : 1); }
      setTimeout(() => { f.releaseBuildLock(${JSON.stringify(root)}, lock); process.exit(0); }, 800);
    }, Math.max(0, wait - 50));
  `;
  const exits = await Promise.all([1, 2, 3, 4].map(() => new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', contender], { stdio: 'ignore' });
    child.on('exit', (code) => resolve(code));
  })));
  assert.deepEqual(exits.slice().sort(), [0, 3, 3, 3], `exactly one concurrent build may hold the lock (exits ${exits})`);
  assert.ok(!fs.existsSync(lockFile), 'the winner released the lock');

  // The build pipeline: a failing step leaves no completion stamp and releases the lock.
  const { runBackendBuild } = await import(pathToFileURL(path.join(repo, 'scripts', 'build-backend.mjs')).href);
  write('ok-step.js', 'process.exit(0)');
  write('fail-step.js', 'process.exit(7)');
  assert.equal(runBackendBuild(root, [['ok-step.js'], ['fail-step.js'], ['ok-step.js']]), 7);
  assert.ok(!fs.existsSync(completeFile), 'a failed build must not be marked complete');
  assert.ok(!fs.existsSync(lockFile), 'a failed build must release the lock');
  assert.equal(runBackendBuild(root, [['ok-step.js']]), 0);
  assert.ok(fs.existsSync(completeFile) && !fs.existsSync(lockFile));
  // A second build while one holds the lock is refused before running any step.
  const blocker = freshness.acquireBuildLock(root);
  write('marker-step.js', `require('fs').writeFileSync(${JSON.stringify(path.join(root, 'ran.txt'))}, '1')`);
  assert.equal(runBackendBuild(root, [['marker-step.js']]), 1);
  assert.ok(!fs.existsSync(path.join(root, 'ran.txt')), 'a refused build runs no steps');
  freshness.releaseBuildLock(root, blocker);

  // prune-dist outside a build: deleting orphaned output drops the completion stamp.
  ageSources(t0);
  build(t0 + 60_000, t0 + 61_000);
  write('dist/gateway/retired-module.js');
  const prune = spawnSync(process.execPath, [path.join(repo, 'scripts', 'prune-dist.js'), '--quiet', '--root', root], { encoding: 'utf8' });
  assert.equal(prune.status, 0, prune.stderr);
  assert.ok(!fs.existsSync(path.join(root, 'dist', 'gateway', 'retired-module.js')));
  assert.ok(!fs.existsSync(completeFile), 'pruning output must invalidate the completed build');
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

// ── 3. desktop dev launcher + build wiring ─────────────────────────────────
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
assert.equal(pkg.scripts['build:backend'], 'node scripts/build-backend.mjs');

// ── 4. boot-path costs ─────────────────────────────────────────────────────
const startup = read('src/gateway/core/startup.ts');
assert.doesNotMatch(startup, /resolveSecret\(searchCfg\./, 'the terminal banner must not decrypt vault entries before listen');
const attachments = read('src/gateway/chat/attachment-context.ts');
assert.doesNotMatch(attachments, /^const \w+: any = require\('(?:xlsx|mammoth|pdf-parse)'\);/m, 'document parsers load on first use');
const server = read('src/gateway/server-v2.ts');
assert.match(server, /seenFolders\.has\(folderKey\(dir\)\)/, 'each real skills folder is seeded once');
assert.match(server, /seedBundledSkillsIntoDir\(dir, bundledSkillsDir, triggerBaseline\)/);

console.log('gateway boot speed: all checks passed');
