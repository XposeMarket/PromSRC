#!/usr/bin/env node
/**
 * `npm run build:backend`: prune stale dist/ output, compile with tsc, copy runtime
 * assets, then mark dist/ as a completed build of the current source tree.
 *
 * The whole pipeline runs under the dist/ build lock (electron/compiled-build-freshness.js):
 * a concurrent build of the same checkout is refused instead of interleaving its output,
 * and a failed or interrupted build never leaves a completion stamp, so source checkouts
 * keep launching the gateway through tsx until the next good build.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { acquireBuildLock, completeBuild, releaseBuildLock } = require('../electron/compiled-build-freshness.js');

// Each step runs as `node <script> ...args` with the checkout as cwd, in order.
export const BACKEND_BUILD_STEPS = [
  ['scripts/prune-dist.js', '--quiet'],
  [require.resolve('typescript/bin/tsc')],
  ['scripts/copy-creative-renderers.js'],
  ['scripts/copy-runtime-prompt-assets.js'],
  ['scripts/copy-extension-descriptors.js'],
];

/** Runs the steps while holding the build lock. Returns the process exit code. */
export function runBackendBuild(rootDir = repoRoot, steps = BACKEND_BUILD_STEPS) {
  let lock;
  try {
    lock = acquireBuildLock(rootDir);
  } catch (error) {
    console.error(`[build] ${error.message}`);
    return 1;
  }
  const release = () => releaseBuildLock(rootDir, lock);
  const onSignal = () => { release(); process.exit(130); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  let code = 0;
  try {
    for (const [script, ...args] of steps) {
      const run = spawnSync(process.execPath, [script, ...args], { cwd: rootDir, stdio: 'inherit' });
      if (run.status !== 0) {
        code = run.status ?? 1;
        console.error(`[build] ${path.basename(script)} failed (${run.status ?? run.signal}); dist/ is not marked as a completed build.`);
        break;
      }
    }
    if (code === 0 && !completeBuild(rootDir, lock)) {
      console.error('[build] Lost the dist/ build lock; dist/ is not marked as a completed build.');
      code = 1;
    }
  } finally {
    release();
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = runBackendBuild();
}
