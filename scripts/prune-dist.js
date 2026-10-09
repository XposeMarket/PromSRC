#!/usr/bin/env node
/**
 * Keep dist/ in sync with its sources.
 *
 * tsc never deletes output for a source file that was removed, and the copy
 * steps use cpSync, which never deletes either. Without this, dist/ keeps
 * compiled copies of retired modules (Reactor, file-op-v2, ...) forever, and
 * electron-builder packages them because it ships dist/**.
 *
 *   node scripts/prune-dist.js            remove dist files with no source (default, keeps tsc incremental)
 *   node scripts/prune-dist.js --check    report orphans and exit 1 if any (no changes)
 *   node scripts/prune-dist.js --all      delete dist/ completely (release builds)
 *   --root <dir>                          repo root (default: this repo; used by tests)
 *   --quiet                               only print when something is removed or found
 *
 * A dist file is kept when one of these owns it:
 *   - dist/.tsbuildinfo (tsc incremental state)
 *   - a compiled output (.js, .js.map, .d.ts, .d.ts.map) whose src/<path>.ts|.tsx|.mts|.cts exists
 *   - dist/extensions/prometheus-personal-chrome/<p> when extensions/prometheus-personal-chrome/<p> exists
 *   - any other dist/<p> when src/<p> exists (assets copied by the build: config prompts,
 *     bundled extension descriptors, creative renderers)
 * Everything else is an orphan.
 */

const fs = require('fs');
const path = require('path');

const COMPILED_SUFFIXES = ['.d.ts.map', '.js.map', '.d.ts', '.js'];
const SOURCE_EXTS = ['.ts', '.tsx', '.mts', '.cts'];
const MIRRORS = [
  // [dist subdir, source dir] for trees copied from outside src/
  ['extensions/prometheus-personal-chrome', 'extensions/prometheus-personal-chrome'],
];

function parseArgs(argv) {
  const opts = { mode: 'prune', root: path.resolve(__dirname, '..'), quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') opts.mode = 'check';
    else if (a === '--all') opts.mode = 'all';
    else if (a === '--quiet') opts.quiet = true;
    else if (a === '--root') opts.root = path.resolve(argv[++i]);
    else throw new Error(`prune-dist: unknown argument ${a}`);
  }
  return opts;
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function exists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Walk dist without following symlinks/junctions. Returns posix paths relative to dist. */
function listFiles(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      out.push(toPosix(path.relative(base, full)));
    } else if (entry.isDirectory()) {
      listFiles(full, base, out);
    } else {
      out.push(toPosix(path.relative(base, full)));
    }
  }
  return out;
}

function isOwned(rel, root) {
  if (rel === '.tsbuildinfo') return true;
  for (const [distDir, srcDir] of MIRRORS) {
    if (rel === distDir || rel.startsWith(distDir + '/')) {
      return exists(path.join(root, srcDir, rel.slice(distDir.length + 1)));
    }
  }
  if (exists(path.join(root, 'src', rel))) return true;
  const suffix = COMPILED_SUFFIXES.find((s) => rel.endsWith(s));
  if (!suffix) return false;
  const stem = rel.slice(0, -suffix.length);
  return SOURCE_EXTS.some((ext) => exists(path.join(root, 'src', stem + ext)));
}

function findOrphans(root) {
  const dist = path.join(root, 'dist');
  if (!exists(dist)) return [];
  return listFiles(dist).filter((rel) => !isOwned(rel, root)).sort();
}

/** Remove empty directories bottom-up; never removes dist itself. */
function removeEmptyDirs(dir, isRoot = true) {
  let empty = true;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      if (!removeEmptyDirs(path.join(dir, entry.name), false)) empty = false;
    } else {
      empty = false;
    }
  }
  if (empty && !isRoot) {
    fs.rmdirSync(dir);
    return true;
  }
  return false;
}

function summarize(orphans) {
  const modules = new Set(orphans.map((rel) => {
    const suffix = COMPILED_SUFFIXES.find((s) => rel.endsWith(s));
    return suffix ? rel.slice(0, -suffix.length) : rel;
  }));
  return `${orphans.length} file(s), ${modules.size} module(s)`;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dist = path.join(opts.root, 'dist');

  if (opts.mode === 'all') {
    if (exists(dist)) {
      fs.rmSync(dist, { recursive: true, force: true });
      console.log(`[build] Removed ${dist}`);
    } else if (!opts.quiet) {
      console.log('[build] dist/ already absent');
    }
    return 0;
  }

  const orphans = findOrphans(opts.root);

  if (opts.mode === 'check') {
    if (orphans.length === 0) {
      if (!opts.quiet) console.log('[prune-dist] dist/ has no orphaned files');
      return 0;
    }
    console.error(`[prune-dist] dist/ has ${summarize(orphans)} with no source:`);
    for (const rel of orphans.slice(0, 50)) console.error(`  dist/${rel}`);
    if (orphans.length > 50) console.error(`  ... and ${orphans.length - 50} more`);
    console.error('Run `node scripts/prune-dist.js` (or `npm run build:backend`) to remove them.');
    return 1;
  }

  for (const rel of orphans) fs.rmSync(path.join(dist, rel), { force: true });
  if (exists(dist)) removeEmptyDirs(dist);
  if (orphans.length > 0) {
    console.log(`[build] Pruned ${summarize(orphans)} from dist/ with no source`);
  } else if (!opts.quiet) {
    console.log('[build] dist/ has no orphaned files');
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (err) {
    console.error(err && err.message ? err.message : err);
    process.exitCode = 2;
  }
}

module.exports = { findOrphans, isOwned };
