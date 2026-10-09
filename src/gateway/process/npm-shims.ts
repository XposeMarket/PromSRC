import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Windows npm/npx shims with absolute paths.
 *
 * npm's stock `npx.cmd` / `npm.cmd` locate npm through `%~dp0`. When a process
 * spawns them by bare quoted name (CreateProcess -> `cmd /c "npx.cmd" ...`,
 * which is what Node `spawn`, .NET `Process.Start` and PowerShell helper
 * scripts do), cmd resolves `%~dp0` to the *current directory* instead of the
 * Node install. Inside a promsrc-pr worktree that produced
 * `Cannot find module '<worktree>\node_modules\npm\bin\npx-cli.js'`, so every
 * agent fell back to `node --import tsx`.
 *
 * The fix is a tiny shim directory, put first on PATH for commands Prometheus
 * runs, whose `npx.cmd` / `npm.cmd` call node + the npm CLI by absolute path.
 */

export interface NpmShimPaths {
  nodeDir: string;
  nodeExe: string;
  npmCli: string;
  npxCli: string;
}

let cachedShimDir: { key: string; dir: string | null } | null = null;

function stripQuotes(value: string): string {
  return value.trim().replace(/^"|"$/g, '');
}

/** Find the Node install that owns npm, scanning PATH in order. */
export function findNodeNpmInstall(pathValue: string): NpmShimPaths | null {
  for (const raw of String(pathValue || '').split(';')) {
    const dir = stripQuotes(raw);
    if (!dir) continue;
    const nodeExe = path.join(dir, 'node.exe');
    const npmCli = path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const npxCli = path.join(dir, 'node_modules', 'npm', 'bin', 'npx-cli.js');
    try {
      if (fs.statSync(nodeExe).isFile() && fs.statSync(npxCli).isFile() && fs.statSync(npmCli).isFile()) {
        return { nodeDir: dir, nodeExe, npmCli, npxCli };
      }
    } catch {
      // not this entry
    }
  }
  return null;
}

export function buildNpmShimScripts(install: NpmShimPaths): { npx: string; npm: string } {
  const line = (cli: string) => `@"${install.nodeExe}" "${cli}" %*\r\n`;
  return {
    npx: `:: Prometheus shim: absolute-path npx (see src/gateway/process/npm-shims.ts)\r\n${line(install.npxCli)}`,
    npm: `:: Prometheus shim: absolute-path npm (see src/gateway/process/npm-shims.ts)\r\n${line(install.npmCli)}`,
  };
}

/**
 * Ensure the shim directory exists and return it, or null when not on Windows,
 * when disabled, or when no Node+npm install is on PATH.
 */
export function ensureWindowsNpmShimDir(pathValue: string, baseDir = os.tmpdir()): string | null {
  if (process.platform !== 'win32') return null;
  if (process.env.PROMETHEUS_DISABLE_NPM_SHIMS === '1') return null;
  const install = findNodeNpmInstall(pathValue);
  if (!install) return null;
  const key = `${baseDir}|${install.nodeDir}`.toLowerCase();
  if (cachedShimDir && cachedShimDir.key === key) return cachedShimDir.dir;
  let dir: string | null = path.join(baseDir, 'prometheus-npm-shims');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const scripts = buildNpmShimScripts(install);
    for (const [name, body] of [['npx.cmd', scripts.npx], ['npm.cmd', scripts.npm]] as const) {
      const target = path.join(dir, name);
      let current = '';
      try { current = fs.readFileSync(target, 'utf8'); } catch { /* missing */ }
      if (current !== body) fs.writeFileSync(target, body, 'utf8');
    }
  } catch {
    dir = null;
  }
  cachedShimDir = { key, dir };
  return dir;
}

/** Prepend the shim directory to a PATH value (no-op when it is already first or unavailable). */
export function withNpmShimsOnPath(pathValue: string, baseDir?: string): string {
  const dir = ensureWindowsNpmShimDir(pathValue, baseDir);
  if (!dir) return pathValue;
  const entries = String(pathValue || '').split(';').filter(Boolean);
  if (entries.length && stripQuotes(entries[0]).toLowerCase() === dir.toLowerCase()) return pathValue;
  return [dir, ...entries.filter((entry) => stripQuotes(entry).toLowerCase() !== dir.toLowerCase())].join(';');
}

export function resetNpmShimCacheForTests(): void {
  cachedShimDir = null;
}
