/**
 * Find an agent's program without a shell.
 *
 * On Windows the `codex` that npm puts on PATH is a `.cmd`/`.ps1` shim. Shims
 * are never spawned: they are resolved to the real `.exe`, or to
 * `node <entry.js>` read from the shim's own text. Candidate list mirrors the
 * Codex voice bridge's `executableCandidates` (realtime/codex-app-server-bridge.ts),
 * which keeps working unchanged.
 */
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/** A resolved, directly spawnable command: argv[0] plus fixed leading args. */
export interface ResolvedCommand {
  command: string;
  args: string[];
  /** What was found on disk (for display only). */
  source: string;
}

function isFile(candidate: string): boolean {
  try { return fs.statSync(candidate).isFile(); } catch { return false; }
}

/** Expand a leading `~` (T3 Code gotcha: the shell never does it for us). */
export function expandHome(value: string): string {
  const text = String(value || '').trim();
  if (text === '~') return os.homedir();
  if (/^~[\\/]/.test(text)) return path.join(os.homedir(), text.slice(2));
  return text;
}

/** Look a bare program name up on PATH (with PATHEXT on Windows). No shell. */
export function findOnPath(name: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const dirs = String(env.PATH || env.Path || '').split(path.delimiter).map((dir) => dir.trim().replace(/^"|"$/g, '')).filter(Boolean);
  const exts = process.platform === 'win32'
    ? ['', ...String(env.PATHEXT || '.EXE;.CMD;.BAT;.PS1').split(';').map((ext) => ext.trim().toLowerCase()).filter(Boolean)]
    : [''];
  const found: string[] = [];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, `${name}${ext}`);
      if (isFile(candidate) && !found.includes(candidate)) found.push(candidate);
    }
  }
  return found;
}

/**
 * Turn a Windows npm shim into something spawnable without a shell.
 * Returns null when the shim cannot be resolved safely.
 */
export function resolveWindowsShim(shimPath: string): ResolvedCommand | null {
  const ext = path.extname(shimPath).toLowerCase();
  if (ext !== '.cmd' && ext !== '.ps1' && ext !== '.bat' && ext !== '') return null;
  const dir = path.dirname(shimPath);
  let text = '';
  try { text = fs.readFileSync(shimPath, 'utf8').slice(0, 8192); } catch { return null; }
  // npm cmd-shim: "%dp0%\node_modules\@openai\codex\bin\codex.js"; ps1: "$basedir/node_modules/...".
  // Standard npm shims start with `IF EXIST "%dp0%\node.exe"` (the interpreter probe), so the
  // FIRST match is the bundled node.exe, not the program. Skip interpreter matches and take the
  // first real entry (found by a real OpenClaw install: it launched bare node and exited).
  const pattern = /(?:%~?dp0%?|\$basedir)[\\/]+([^"'\r\n%$]+?\.(?:c?js|mjs|exe))/gi;
  let target = '';
  for (const match of text.matchAll(pattern)) {
    const candidate = path.resolve(dir, match[1].replace(/[\\/]+/g, path.sep));
    if (/^node(?:\.exe)?$/i.test(path.basename(candidate))) continue;
    if (isFile(candidate)) { target = candidate; break; }
  }
  if (!target) return null;
  if (/\.exe$/i.test(target)) return { command: target, args: [], source: shimPath };
  const localNode = path.join(dir, 'node.exe');
  const node = isFile(localNode) ? localNode : process.execPath;
  return { command: node, args: [target], source: shimPath };
}

/** Resolve the first spawnable command from a candidate list. */
export function resolveFromCandidates(candidates: string[]): ResolvedCommand | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = path.isAbsolute(candidate) ? candidate : '';
    if (resolved && isFile(resolved)) {
      // npm also writes an extensionless POSIX shell shim next to the .cmd one; PATH lookup
      // (PATHEXT '' first) finds it before openclaw.cmd. Windows can't spawn it, so resolve
      // it like the other shims (its $basedir/... entry names the same program).
      if (process.platform === 'win32' && (/\.(cmd|bat|ps1)$/i.test(resolved) || !path.extname(resolved))) {
        const shim = resolveWindowsShim(resolved);
        if (shim) return shim;
        continue;
      }
      return { command: resolved, args: [], source: resolved };
    }
  }
  return null;
}

export function codexExecutableCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const candidates: string[] = [];
  const configured = String(env.PROMETHEUS_CODEX_BIN || '').trim();
  if (configured) candidates.push(expandHome(configured));
  if (process.platform === 'win32') {
    const appData = String(env.APPDATA || '').trim();
    if (appData) {
      const npmRoot = path.join(appData, 'npm', 'node_modules', '@openai', 'codex', 'node_modules');
      candidates.push(path.join(npmRoot, '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'));
      candidates.push(path.join(npmRoot, '@openai', 'codex-win32-arm64', 'vendor', 'aarch64-pc-windows-msvc', 'bin', 'codex.exe'));
    }
    candidates.push(...findOnPath('codex', env).sort((a, b) => rankWin(a) - rankWin(b)));
  } else {
    candidates.push(...findOnPath('codex', env));
    if (process.platform === 'darwin') {
      for (const root of [path.join(os.homedir(), 'Applications'), '/Applications']) {
        candidates.push(path.join(root, 'ChatGPT.app', 'Contents', 'Resources', 'codex'));
        candidates.push(path.join(root, 'Codex.app', 'Contents', 'Resources', 'codex'));
      }
    }
  }
  return [...new Set(candidates)];
}

function rankWin(file: string): number {
  const ext = path.extname(file).toLowerCase();
  return ext === '.exe' ? 0 : ext === '.cmd' ? 1 : ext === '.ps1' ? 2 : 3;
}

export function resolveCodexCommand(env: NodeJS.ProcessEnv = process.env): ResolvedCommand | null {
  return resolveFromCandidates(codexExecutableCandidates(env));
}

/** `<program> --version`, no shell, bounded, async (does not block the gateway). Returns the semver or ''. */
export function readProgramVersion(cmd: ResolvedCommand, timeoutMs = 8000): Promise<{ version: string; ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    try {
      execFile(cmd.command, [...cmd.args, '--version'], {
        encoding: 'utf8',
        timeout: timeoutMs,
        windowsHide: true,
        shell: false,
      }, (error, stdout, stderr) => {
        const text = `${stdout || ''}\n${stderr || ''}`;
        const version = text.match(/\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/)?.[1] || '';
        if (error && !version) {
          resolve({ version: '', ok: false, error: String(error.message || error).split(/\r?\n/)[0].slice(0, 300) });
          return;
        }
        resolve({ version, ok: true });
      });
    } catch (error: any) {
      resolve({ version: '', ok: false, error: String(error?.message || error).slice(0, 300) });
    }
  });
}

/** -1 / 0 / 1 on the numeric x.y.z part. */
export function compareVersions(a: string, b: string): number {
  const pa = String(a).match(/^(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number) || [0, 0, 0];
  const pb = String(b).match(/^(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number) || [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}
