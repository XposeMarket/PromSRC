/**
 * Pre-warmed one-shot PowerShell processes for run_command / workspace_run.
 *
 * Starting powershell.exe costs ~350-500 ms before the first statement runs,
 * and every shell-path command (pipes, $vars, cmdlets, quotes) paid it. A
 * shared long-lived host would leak cwd, variables, `exit` and kill semantics
 * between commands, so instead we keep a small pool of *spare* processes that
 * have already started and are blocked reading stdin. A command claims one,
 * sends its script (base64 UTF-8) and closes stdin; the process runs the exact
 * same wrapper the cold path uses and exits. Each command still gets a fresh
 * process (fresh state, own pid tree, real exit code, streaming stdout/stderr);
 * only the startup cost moves off the critical path. A replacement spare is
 * started in the background after every claim.
 *
 * Set PROMETHEUS_DISABLE_WARM_SHELL=1 to turn this off.
 */
import os from 'os';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';

// Spares start in a neutral directory: an idle process whose cwd is a user
// folder holds a handle on it (EBUSY on rmdir / git worktree remove). Each
// command sets its real location before running.
const SPARE_CWD = os.tmpdir();

const POOL_SIZE = Math.max(0, Math.min(4, Number(process.env.PROMETHEUS_WARM_SHELL_POOL ?? 2) || 0));
// Spares are recycled periodically so a long-idle process never runs with a
// stale environment (PATH is also compared on every claim).
const MAX_SPARE_AGE_MS = 10 * 60_000;

// Reads the whole of stdin, decodes base64 UTF-8 (stdin is decoded with the OEM
// codepage in PS 5.1, so raw non-ASCII would be mangled), sets the location and
// runs it in global scope exactly like -Command would. Empty stdin (gateway
// died / spare discarded) exits quietly.
export const WARM_BOOTSTRAP = [
  '$__pmIn = [Console]::In.ReadToEnd()',
  'if ([string]::IsNullOrWhiteSpace($__pmIn)) { exit 0 }',
  '$__pmScript = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($__pmIn.Trim()))',
  'Remove-Variable __pmIn',
  'Invoke-Expression $__pmScript',
].join('; ');

interface Spare {
  child: ChildProcessWithoutNullStreams;
  exe: string;
  pathValue: string;
  createdAt: number;
}

const spares: Spare[] = [];
let refillScheduled = false;
let stats = { claimed: 0, cold: 0, spawned: 0 };

export function isWarmShellEnabled(): boolean {
  return process.platform === 'win32'
    && POOL_SIZE > 0
    && String(process.env.PROMETHEUS_DISABLE_WARM_SHELL || '').trim() !== '1';
}

function pathOf(env: NodeJS.ProcessEnv): string {
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'Path';
  return String(env[key] || '');
}

function alive(spare: Spare): boolean {
  const c = spare.child;
  return c.exitCode === null && c.signalCode === null && !c.killed && !!c.pid && !c.stdin.destroyed;
}

function discard(spare: Spare): void {
  try { spare.child.stdin.end(); } catch {}
  try { spare.child.kill(); } catch {}
}

function startSpare(exe: string, env: NodeJS.ProcessEnv, cwd: string): Spare | null {
  try {
    const child = spawn(exe, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', WARM_BOOTSTRAP], {
      cwd: SPARE_CWD,
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
    stats.spawned += 1;
    const spare: Spare = { child, exe, pathValue: pathOf(env), createdAt: Date.now() };
    child.on('error', () => { /* surfaced by alive() */ });
    child.stdin.on('error', () => { /* surfaced by alive() */ });
    // Spares must not keep the gateway alive or block shutdown.
    (child as any).unref?.();
    (child.stdout as any).unref?.();
    (child.stderr as any).unref?.();
    (child.stdin as any).unref?.();
    child.once('exit', () => {
      const i = spares.indexOf(spare);
      if (i >= 0) spares.splice(i, 1);
    });
    return spare;
  } catch {
    return null;
  }
}

let lastSpawnArgs: { exe: string; env: NodeJS.ProcessEnv; cwd: string } | null = null;

function scheduleRefill(): void {
  if (refillScheduled || !lastSpawnArgs) return;
  refillScheduled = true;
  // Let the claimed command start first; the refill competes for CPU otherwise.
  setTimeout(() => {
    refillScheduled = false;
    if (!lastSpawnArgs || !isWarmShellEnabled()) return;
    while (spares.length < POOL_SIZE) {
      const spare = startSpare(lastSpawnArgs.exe, lastSpawnArgs.env, lastSpawnArgs.cwd);
      if (!spare) break;
      spares.push(spare);
    }
  }, 50).unref?.();
}

/**
 * Claim a ready process for `exe` with the given env. Returns null when none is
 * ready (caller spawns cold). Always schedules the pool to be topped up.
 */
export function claimWarmPowerShell(exe: string, env: NodeJS.ProcessEnv, cwd: string): ChildProcessWithoutNullStreams | null {
  if (!isWarmShellEnabled()) return null;
  lastSpawnArgs = { exe, env, cwd };
  const wantPath = pathOf(env);
  const now = Date.now();
  let claimed: Spare | null = null;
  for (let i = spares.length - 1; i >= 0; i -= 1) {
    const spare = spares[i];
    const stale = !alive(spare) || spare.exe !== exe || spare.pathValue !== wantPath || now - spare.createdAt > MAX_SPARE_AGE_MS;
    if (stale) {
      spares.splice(i, 1);
      discard(spare);
      continue;
    }
    if (!claimed) {
      spares.splice(i, 1);
      claimed = spare;
    }
  }
  scheduleRefill();
  if (!claimed) {
    stats.cold += 1;
    return null;
  }
  stats.claimed += 1;
  const child = claimed.child;
  // Claimed processes are real runs again: they should hold the event loop.
  (child as any).ref?.();
  (child.stdout as any).ref?.();
  (child.stderr as any).ref?.();
  (child.stdin as any).ref?.();
  return child;
}

/** Hand the script to a claimed process. Sets cwd for both PowerShell and .NET. */
export function sendWarmScript(child: ChildProcessWithoutNullStreams, cwd: string, script: string): void {
  const quotedCwd = `'${cwd.replace(/'/g, "''")}'`;
  const full = `Set-Location -LiteralPath ${quotedCwd}; [System.Environment]::CurrentDirectory = ${quotedCwd}\n${script}`;
  child.stdin.end(`${Buffer.from(full, 'utf8').toString('base64')}\n`);
}

/** Start spares ahead of the first command (fire-and-forget). */
export function prewarmPowerShell(exe: string, env: NodeJS.ProcessEnv, cwd: string): void {
  if (!isWarmShellEnabled()) return;
  lastSpawnArgs = { exe, env, cwd };
  scheduleRefill();
}

export function disposeWarmPowerShell(): void {
  while (spares.length) discard(spares.pop()!);
  lastSpawnArgs = null;
}

export function getWarmPowerShellStats(): { spares: number; claimed: number; cold: number; spawned: number } {
  return { spares: spares.length, ...stats };
}

export function resetWarmPowerShellStatsForTest(): void {
  stats = { claimed: 0, cold: 0, spawned: 0 };
}
