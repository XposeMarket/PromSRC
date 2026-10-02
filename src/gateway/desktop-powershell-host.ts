/**
 * Persistent PowerShell hosts for desktop automation.
 *
 * Every desktop primitive used to spawn a fresh powershell.exe (230-440 ms of
 * process start + .NET/Add-Type warmup) for a few milliseconds of Win32 work.
 * This module keeps a small pool of long-lived hosts and feeds them scripts
 * over stdin, so repeat calls cost ~1-20 ms.
 *
 * Semantics are kept identical to a fresh `powershell -NoProfile -Command`:
 *  - Each script is written to its own temp .ps1 and invoked with `&`, so it
 *    gets its own script scope ($script:x does not leak between calls) and
 *    `exit` ends only that script, never the host.
 *  - Hosts are partitioned by apartment (STA/MTA) and by DPI awareness. A
 *    script that calls SetProcessDpiAwarenessContext changes the process for
 *    good, so DPI-aware scripts never share a host with scripts that expect the
 *    default (unaware) coordinate space.
 *  - Output = the script's success stream rendered with Out-String; error
 *    records written to the error stream are reported as stderr; an uncaught
 *    terminating error (or `exit <nonzero>`) rejects, matching execFile's
 *    non-zero-exit rejection.
 *  - Responses are framed with a marker so stray console writes (warnings,
 *    native exe output) can never corrupt the protocol.
 *
 * A host that times out, is aborted, or crashes is killed and transparently
 * replaced on the next call. Set PROMETHEUS_DESKTOP_PS_HOST=0 to disable.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const MARKER = '\u0001PSH\u0002';
const MAX_CALLS_PER_HOST = Math.max(50, Number(process.env.PROMETHEUS_DESKTOP_PS_HOST_RECYCLE || 400) || 400);
const MAX_HOSTS_PER_KIND = 3;
const IDLE_SHUTDOWN_MS = Math.max(30_000, Number(process.env.PROMETHEUS_DESKTOP_PS_HOST_IDLE_MS || 10 * 60_000) || 10 * 60_000);

const HOST_SCRIPT = `
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
$marker = [string][char]1 + 'PSH' + [string][char]2
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $sep = $line.IndexOf(' ')
  if ($sep -lt 1) { continue }
  $id = $line.Substring(0, $sep)
  $file = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line.Substring($sep + 1)))
  $out = ''; $err = ''; $fatal = ''; $code = 0
  try {
    $global:LASTEXITCODE = 0
    $items = @(& $file 2>&1)
    $code = [int]$global:LASTEXITCODE
    $errs = @($items | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] })
    $outs = @($items | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] })
    if ($outs.Count) { $out = ($outs | Out-String -Width 32766) }
    if ($errs.Count) { $err = ($errs | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine }
  } catch {
    $fatal = $_.Exception.Message
    if (-not $fatal) { $fatal = [string]$_ }
  }
  $payload = @{ id = $id; out = $out; err = $err; fatal = $fatal; code = $code } | ConvertTo-Json -Compress
  [Console]::Out.WriteLine($marker + $payload)
  [Console]::Out.Flush()
}
`;

export interface PowerShellRunOptions {
  timeoutMs?: number;
  sta?: boolean;
  signal?: AbortSignal;
}

interface PendingCall {
  resolve: (value: string) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  file: string;
  cleanupAbort?: () => void;
}

interface HostResponse {
  id: string;
  out?: string;
  err?: string;
  fatal?: string;
  code?: number;
}

let tempDir: string | null = null;
function scriptDir(): string {
  if (tempDir && fs.existsSync(tempDir)) return tempDir;
  tempDir = path.join(os.tmpdir(), `prometheus-psh-${process.pid}`);
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function abortError(): Error {
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  return err;
}

class PowerShellHost {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private pending = new Map<string, PendingCall>();
  private nextId = 1;
  calls = 0;
  dead = false;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(private readonly sta: boolean) {}

  private armIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.pending.size === 0) this.kill(new Error('PowerShell host idle shutdown.'));
    }, IDLE_SHUTDOWN_MS);
    this.idleTimer.unref?.();
  }

  get busy(): number {
    return this.pending.size;
  }

  private ensure(): ChildProcessWithoutNullStreams {
    if (this.proc) return this.proc;
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];
    if (this.sta) args.push('-STA');
    args.push('-Command', HOST_SCRIPT);
    const proc = spawn('powershell.exe', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => this.onData(chunk));
    proc.stderr.on('data', () => { /* drained; per-call errors come back framed */ });
    proc.on('exit', () => this.fail(new Error('PowerShell host exited.')));
    proc.on('error', (error) => this.fail(error));
    proc.stdin.on('error', () => { /* surfaced through exit */ });
    this.proc = proc;
    return proc;
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let nl = this.buffer.indexOf('\n');
    while (nl >= 0) {
      const line = this.buffer.slice(0, nl).replace(/\r$/, '');
      this.buffer = this.buffer.slice(nl + 1);
      nl = this.buffer.indexOf('\n');
      const at = line.indexOf(MARKER);
      if (at < 0) continue;
      let msg: HostResponse;
      try { msg = JSON.parse(line.slice(at + MARKER.length)); } catch { continue; }
      const call = this.pending.get(String(msg.id));
      if (!call) continue;
      this.pending.delete(String(msg.id));
      this.settle(call);
      const out = String(msg.out || '').trim();
      const err = String(msg.err || '').trim();
      if (msg.fatal) call.reject(new Error(String(msg.fatal).slice(0, 500)));
      // Like execFile + `out || throw stderr`: output wins; a non-zero exit
      // only fails the call when the script produced nothing.
      else if (!out && Number(msg.code || 0) !== 0) call.reject(new Error((err || `PowerShell script exited with code ${msg.code}`).slice(0, 500)));
      else if (err && !out) call.reject(new Error(err.slice(0, 500)));
      else call.resolve(out);
    }
  }

  private settle(call: PendingCall): void {
    clearTimeout(call.timer);
    call.cleanupAbort?.();
    this.armIdle();
    fs.promises.unlink(call.file).catch(() => {});
  }

  private fail(error: Error): void {
    this.dead = true;
    for (const [, call] of this.pending) {
      this.settle(call);
      call.reject(error);
    }
    this.pending.clear();
    this.proc = null;
    this.buffer = '';
  }

  kill(reason: Error): void {
    const proc = this.proc;
    this.fail(reason);
    if (proc) {
      try { proc.stdin.end(); } catch { /* best effort */ }
      try { proc.kill(); } catch { /* best effort */ }
    }
  }

  run(script: string, opts: PowerShellRunOptions): Promise<string> {
    if (opts.signal?.aborted) return Promise.reject(abortError());
    const proc = this.ensure();
    const id = String(this.nextId++);
    this.calls += 1;
    const file = path.join(scriptDir(), `${id}-${crypto.randomBytes(4).toString('hex')}.ps1`);
    // UTF-8 BOM: Windows PowerShell 5.1 reads BOM-less .ps1 files as ANSI.
    fs.writeFileSync(file, `\ufeff${script}`, 'utf8');
    return new Promise<string>((resolve, reject) => {
      const timeoutMs = Math.max(500, Number(opts.timeoutMs ?? 15000) || 15000);
      const timer = setTimeout(() => {
        // A stuck script may hold the host; kill it so later calls get a clean one.
        this.kill(Object.assign(new Error(`PowerShell script timed out after ${timeoutMs}ms`), { killed: true, code: 'ETIMEDOUT' }));
      }, timeoutMs);
      let cleanupAbort: (() => void) | undefined;
      if (opts.signal) {
        const onAbort = () => this.kill(abortError());
        opts.signal.addEventListener('abort', onAbort, { once: true });
        cleanupAbort = () => opts.signal?.removeEventListener('abort', onAbort);
      }
      this.pending.set(id, { resolve, reject, timer, file, cleanupAbort });
      proc.stdin.write(`${id} ${Buffer.from(file, 'utf8').toString('base64')}\n`);
    });
  }
}

const pools = new Map<string, PowerShellHost[]>();

export function isDesktopPowerShellHostEnabled(): boolean {
  return process.platform === 'win32' && String(process.env.PROMETHEUS_DESKTOP_PS_HOST ?? '1').trim() !== '0';
}

/** Scripts that switch the process to per-monitor DPI awareness. */
export function scriptChangesDpiAwareness(script: string): boolean {
  return /PrometheusDpiApi|SetProcessDpiAwareness|SetProcessDPIAware/i.test(script);
}

function pickHost(sta: boolean, dpiAware: boolean): PowerShellHost | null {
  const key = `${sta ? 'sta' : 'mta'}:${dpiAware ? 'dpi' : 'plain'}`;
  let pool = pools.get(key);
  if (!pool) { pool = []; pools.set(key, pool); }
  for (let i = pool.length - 1; i >= 0; i -= 1) {
    const host = pool[i];
    if (host.dead || (host.calls >= MAX_CALLS_PER_HOST && host.busy === 0)) {
      if (!host.dead) host.kill(new Error('PowerShell host recycled.'));
      pool.splice(i, 1);
    }
  }
  const idle = pool.find((host) => host.busy === 0 && host.calls < MAX_CALLS_PER_HOST);
  if (idle) return idle;
  if (pool.length < MAX_HOSTS_PER_KIND) {
    const host = new PowerShellHost(sta);
    pool.push(host);
    return host;
  }
  // Never queue behind another script: a queued call's timeout would kill
  // the host mid-script. The caller falls back to a one-shot process.
  return null;
}

export class PowerShellHostBusyError extends Error {
  constructor() {
    super('All persistent PowerShell hosts are busy.');
    this.name = 'PowerShellHostBusyError';
  }
}

/**
 * Run a script in a persistent host. Rejects with PowerShellHostBusyError when
 * every host of the required kind is busy, and with message
 * 'PowerShell host exited.' when the host process itself died; callers should
 * fall back to a one-shot powershell.exe for those two cases only.
 */
export function runPowerShellInHost(script: string, opts: PowerShellRunOptions = {}): Promise<string> {
  const host = pickHost(opts.sta === true, scriptChangesDpiAwareness(script));
  if (!host) return Promise.reject(new PowerShellHostBusyError());
  return host.run(script, opts);
}

let warmed = false;
/** Start hosts ahead of use (fire-and-forget). `scripts` should exercise the
 *  same Add-Type headers the real calls use so their compile cost is paid once. */
export function warmDesktopPowerShellHosts(scripts: Array<{ script: string; sta: boolean }>): void {
  if (warmed || !isDesktopPowerShellHostEnabled()) return;
  warmed = true;
  for (const { script, sta } of scripts) {
    runPowerShellInHost(script, { sta, timeoutMs: 30000 }).catch(() => {});
  }
}

export function disposeDesktopPowerShellHosts(): void {
  for (const pool of pools.values()) for (const host of pool) host.kill(new Error('PowerShell host disposed.'));
  pools.clear();
}

export function getDesktopPowerShellHostStats(): Array<{ kind: string; hosts: number; calls: number; busy: number }> {
  return [...pools.entries()].map(([kind, pool]) => ({
    kind,
    hosts: pool.length,
    calls: pool.reduce((n, host) => n + host.calls, 0),
    busy: pool.reduce((n, host) => n + host.busy, 0),
  }));
}
