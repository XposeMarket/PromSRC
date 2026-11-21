'use strict';
// Decides whether a source checkout may run its compiled dist/ instead of src/
// through tsx. Shared by electron/main.js (desktop dev launch), src/cli/index.ts
// (every gateway child the supervisor starts) and src/gateway/lifecycle.ts
// (self-spawned restarts). Packaged builds only ship dist/ and never ask.
//
// Why it matters: under tsx every process (CLI supervisor, gateway, each runtime
// worker) hashes and loads each .ts module through the transpile cache. Measured
// on a dev checkout: gateway spawn -> /api/health 7.3-11.5s via tsx, 4.0s from
// dist/.
//
// dist/ counts as current only when `npm run build:backend` completed and no
// file or directory in a tree the backend build reads was modified after that
// build started. Directory mtimes change when an entry is added, removed or
// renamed, so deletions and renames count as changes too.
// `build-stamp.js begin` (first build step) removes the completion stamp and
// records the start time plus the owning build; `build-stamp.js complete` (last
// step, after tsc and every copy step succeeded) writes dist/.build-complete.json
// only for that same build. A failed, interrupted or still-running build never
// counts, an edit made while the build was running keeps the checkout on tsx
// until the next build, and a second concurrent build of the same checkout is
// refused instead of interleaving its output. prune-dist drops the completion
// stamp whenever it deletes output outside a build.
const fs = require('fs');
const path = require('path');

const BUILD_COMPLETE_STAMP = path.join('dist', '.build-complete.json');
const BUILD_IN_PROGRESS_STAMP = path.join('dist', '.build-in-progress.json');
// Trees the backend build compiles or copies into dist/.
const SOURCE_TREES = ['src', path.join('extensions', 'prometheus-personal-chrome')];
const REQUIRED_COMPILED_ENTRIES = [
  path.join('dist', 'cli', 'index.js'),
  path.join('dist', 'gateway', 'server-v2.js'),
];
const SKIPPED_DIRS = new Set(['node_modules', '.git']);
// An in-progress stamp older than this is treated as abandoned even if its pid was reused.
const ABANDONED_BUILD_MS = 30 * 60_000;

const toPosix = (p) => p.split(path.sep).join('/');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return !!error && error.code === 'EPERM'; }
}

// build:backend runs `begin` ... `complete` as children of one npm script shell,
// so that shell's pid identifies the build. A shell may exec the last command of
// a chain (same pid), so `complete` also accepts its own pid.
function defaultBuildOwner() {
  return { token: process.ppid, pids: [process.ppid, process.pid] };
}

/**
 * First file or directory under the source trees modified after thresholdMs, or
 * null. Directories end in '/'. Stops at the first hit.
 */
function findSourceModifiedAfter(rootDir, thresholdMs) {
  for (const tree of SOURCE_TREES) {
    const pending = [path.join(rootDir, tree)];
    while (pending.length) {
      const dir = pending.pop();
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      // Adding, deleting or renaming an entry updates the directory's mtime.
      try {
        if (fs.statSync(dir).mtimeMs > thresholdMs) return `${toPosix(path.relative(rootDir, dir))}/`;
      } catch { continue; }
      for (const entry of entries) {
        if (SKIPPED_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { pending.push(full); continue; }
        let mtimeMs;
        try { mtimeMs = fs.statSync(full).mtimeMs; } catch { continue; }
        if (mtimeMs > thresholdMs) return toPosix(path.relative(rootDir, full));
      }
    }
  }
  return null;
}

function readCompletedBuild(rootDir) {
  const stampPath = path.join(rootDir, BUILD_COMPLETE_STAMP);
  let stat;
  try { stat = fs.statSync(stampPath); } catch { return null; }
  let startedAtMs = NaN;
  try { startedAtMs = Number(JSON.parse(fs.readFileSync(stampPath, 'utf8')).startedAtMs); } catch {}
  // Without a readable start time fall back to the stamp's own mtime (later, so stricter is not
  // possible; this only happens for a hand-made stamp).
  return { startedAtMs: Number.isFinite(startedAtMs) && startedAtMs > 0 ? startedAtMs : stat.mtimeMs };
}

/**
 * @returns {{ fresh: boolean, reason: string, checkMs: number }}
 */
function checkCompiledBuildFreshness(rootDir) {
  const started = Date.now();
  const result = (fresh, reason) => ({ fresh, reason, checkMs: Date.now() - started });
  for (const rel of REQUIRED_COMPILED_ENTRIES) {
    if (!fs.existsSync(path.join(rootDir, rel))) return result(false, `${toPosix(rel)} is missing`);
  }
  if (fs.existsSync(path.join(rootDir, BUILD_IN_PROGRESS_STAMP))) {
    return result(false, 'a backend build started and has not completed');
  }
  const build = readCompletedBuild(rootDir);
  if (!build) return result(false, 'no completed backend build stamp (run npm run build)');
  const changed = findSourceModifiedAfter(rootDir, build.startedAtMs);
  if (changed) return result(false, `${changed} changed after the last backend build`);
  return result(true, 'dist/ matches the source tree');
}

function beginBuildStamp(rootDir, now = Date.now(), owner = defaultBuildOwner()) {
  const inProgress = path.join(rootDir, BUILD_IN_PROGRESS_STAMP);
  const active = readJson(inProgress);
  const activeOwner = Number(active && active.ownerPid);
  if (
    active
    && activeOwner !== owner.token
    && isProcessAlive(activeOwner)
    && now - Number(active.startedAtMs) < ABANDONED_BUILD_MS
  ) {
    throw new Error(
      `another backend build (pid ${activeOwner}) is writing dist/ in this checkout; `
      + `wait for it to finish, or delete ${toPosix(BUILD_IN_PROGRESS_STAMP)} if that process is not a build`,
    );
  }
  fs.rmSync(path.join(rootDir, BUILD_COMPLETE_STAMP), { force: true });
  fs.mkdirSync(path.join(rootDir, 'dist'), { recursive: true });
  fs.writeFileSync(inProgress, `${JSON.stringify({ startedAtMs: now, ownerPid: owner.token }, null, 2)}\n`);
}

/** @returns {boolean} true when this build published the completion stamp. */
function completeBuildStamp(rootDir, now = Date.now(), owner = defaultBuildOwner()) {
  const inProgress = path.join(rootDir, BUILD_IN_PROGRESS_STAMP);
  const active = readJson(inProgress);
  const startedAtMs = Number(active && active.startedAtMs);
  if (!active || !Number.isFinite(startedAtMs) || startedAtMs <= 0) {
    throw new Error(`${toPosix(BUILD_IN_PROGRESS_STAMP)} is missing; run build-stamp.js begin before the build`);
  }
  if (active.ownerPid !== undefined && !owner.pids.includes(Number(active.ownerPid))) {
    // A different build owns dist/ now; only its own completion step may publish the stamp.
    return false;
  }
  fs.writeFileSync(
    path.join(rootDir, BUILD_COMPLETE_STAMP),
    `${JSON.stringify({ startedAtMs, completedAtMs: now, node: process.version }, null, 2)}\n`,
  );
  fs.rmSync(inProgress, { force: true });
  return true;
}


module.exports = {
  BUILD_COMPLETE_STAMP,
  BUILD_IN_PROGRESS_STAMP,
  SOURCE_TREES,
  beginBuildStamp,
  checkCompiledBuildFreshness,
  completeBuildStamp,
  findSourceModifiedAfter,
};
