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
// renamed, so deletions and renames count as changes too; a source root that
// existed at build time and is now gone (deleted or renamed tree) also counts.
// scripts/build-backend.mjs (`npm run build:backend`) takes an exclusive build
// lock (dist/.build-in-progress.json, O_EXCL create) for the whole pipeline,
// which also drops the previous completion stamp, and publishes
// dist/.build-complete.json only after every step succeeded and only while it
// still holds the lock. A failed, interrupted or still-running build never
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

const toPosix = (p) => p.split(path.sep).join('/');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return !!error && error.code === 'EPERM'; }
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
  const stamp = readJson(stampPath) || {};
  const startedAtMs = Number(stamp.startedAtMs);
  return {
    // Without a readable start time fall back to the stamp's own mtime (only a hand-made stamp).
    startedAtMs: Number.isFinite(startedAtMs) && startedAtMs > 0 ? startedAtMs : stat.mtimeMs,
    sourceRoots: Array.isArray(stamp.sourceRoots) ? stamp.sourceRoots.map(String) : [],
  };
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
  const goneRoot = build.sourceRoots.find((root) => !fs.existsSync(path.join(rootDir, root)));
  if (goneRoot) return result(false, `${goneRoot}/ was removed or renamed after the last backend build`);
  const changed = findSourceModifiedAfter(rootDir, build.startedAtMs);
  if (changed) return result(false, `${changed} changed after the last backend build`);
  return result(true, 'dist/ matches the source tree');
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

function parseLock(raw) {
  try {
    const lock = JSON.parse(raw);
    return lock && Number.isInteger(Number(lock.ownerPid)) && Number(lock.ownerPid) > 0 && lock.token ? lock : null;
  } catch { return null; }
}

/**
 * Take the dist/ build lock (dist/.build-in-progress.json, created with O_EXCL so
 * two builds can never both acquire it). A lock whose owner process is alive is
 * never taken over; an empty or unreadable lock fails closed; one whose owner is gone
 * (hard-killed build) is reclaimed under a second exclusive lock (`<lock>.reclaim`).
 * Acquiring drops any previous completion stamp. scripts/build-backend.mjs holds
 * the lock for the whole pipeline and releases it in a finally block.
 * @returns {{ startedAtMs: number, ownerPid: number, token: string, sourceRoots: string[] }}
 *
 * `hooks` exist only so tests can pause at the two race windows deterministically.
 */
function acquireBuildLock(rootDir, { now = Date.now(), pid = process.pid, hooks = {} } = {}) {
  const lockPath = path.join(rootDir, BUILD_IN_PROGRESS_STAMP);
  const reclaimPath = `${lockPath}.reclaim`;
  const lockRel = toPosix(BUILD_IN_PROGRESS_STAMP);
  fs.mkdirSync(path.join(rootDir, 'dist'), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    let fd = null;
    try {
      fd = fs.openSync(lockPath, 'wx');
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
    }
    if (fd !== null) {
      const lock = {
        startedAtMs: now,
        ownerPid: pid,
        token: `${pid}-${now}-${Math.random().toString(36).slice(2)}`,
        sourceRoots: SOURCE_TREES.filter((tree) => fs.existsSync(path.join(rootDir, tree))).map(toPosix),
      };
      try {
        if (hooks.afterCreate) hooks.afterCreate(lockPath);
        fs.writeSync(fd, `${JSON.stringify(lock, null, 2)}\n`);
      } finally {
        fs.closeSync(fd);
      }
      fs.rmSync(path.join(rootDir, BUILD_COMPLETE_STAMP), { force: true });
      return lock;
    }
    const raw = readText(lockPath);
    if (raw === null) continue; // released between our create attempt and read: retry
    const active = parseLock(raw);
    if (!active) {
      // Empty or unreadable: possibly a build that has created the lock but not written it yet.
      // Fail closed; never delete a lock we cannot attribute to a dead owner.
      throw new Error(`${lockRel} is empty or unreadable (another build may be starting); retry, or delete it if no build is running`);
    }
    const owner = Number(active.ownerPid);
    if (isProcessAlive(owner)) {
      throw new Error(
        `another backend build (pid ${owner}) is writing dist/ in this checkout; wait for it to finish, `
        + `or delete ${lockRel} if pid ${owner} is not a build`,
      );
    }
    // The owner process is gone (hard-killed build). Reclaim under a second exclusive lock so two
    // reclaimers can never interleave: only the reclaim holder deletes the lock, and only if it still
    // holds the exact abandoned content we inspected.
    if (hooks.beforeReclaim) hooks.beforeReclaim(lockPath);
    let reclaimFd;
    try {
      reclaimFd = fs.openSync(reclaimPath, 'wx');
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        throw new Error(`another build is reclaiming the abandoned ${lockRel}; retry, or delete ${lockRel}.reclaim if no build is running`);
      }
      throw error;
    }
    try {
      fs.closeSync(reclaimFd);
      if (readText(lockPath) === raw) fs.rmSync(lockPath, { force: true });
    } finally {
      fs.rmSync(reclaimPath, { force: true });
    }
  }
  throw new Error(`could not acquire ${lockRel}: another build took it at the same moment`);
}

function holdsBuildLock(rootDir, lock) {
  const active = readJson(path.join(rootDir, BUILD_IN_PROGRESS_STAMP));
  return !!(active && lock && active.token === lock.token);
}

/**
 * Publish dist/.build-complete.json for the build holding `lock`, after every
 * build step succeeded. Returns false (publishes nothing) if the lock is no
 * longer ours.
 */
function completeBuild(rootDir, lock, now = Date.now()) {
  if (!holdsBuildLock(rootDir, lock)) return false;
  fs.writeFileSync(
    path.join(rootDir, BUILD_COMPLETE_STAMP),
    `${JSON.stringify({ startedAtMs: lock.startedAtMs, completedAtMs: now, node: process.version, sourceRoots: lock.sourceRoots }, null, 2)}\n`,
  );
  return true;
}

/** Release the lock if we still hold it (success or failure). */
function releaseBuildLock(rootDir, lock) {
  if (holdsBuildLock(rootDir, lock)) fs.rmSync(path.join(rootDir, BUILD_IN_PROGRESS_STAMP), { force: true });
}

module.exports = {
  BUILD_COMPLETE_STAMP,
  BUILD_IN_PROGRESS_STAMP,
  SOURCE_TREES,
  acquireBuildLock,
  checkCompiledBuildFreshness,
  completeBuild,
  findSourceModifiedAfter,
  releaseBuildLock,
};
