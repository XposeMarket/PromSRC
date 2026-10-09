import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { execSync } from 'child_process';
import * as pty from 'node-pty';
import { getConfig } from '../../config/config';
import { broadcastWS } from '../comms/broadcaster';
import { ProcessRunStore } from './store';
import { classifyCommandTermination } from './command-outcome';
import type { TerminalWorkspaceChangeResult } from '../coding/terminal-change-tracker';
import { createManagedTerminalWorkspaceTracker, type ManagedTerminalWorkspaceTracker } from './terminal-workspace-worker-client';
import { enqueueAsyncAppend } from '../../runtime/async-file-queue';
import { ProcessOutputBatcher } from './output-batcher';
import { withNpmShimsOnPath } from './npm-shims';
import { claimWarmPowerShell, prewarmPowerShell, sendWarmScript } from './warm-powershell';
import type {
  ManagedProcessRun,
  ProcessLogResult,
  ProcessRunExit,
  ProcessRunRecord,
  ProcessShell,
  ProcessSpawnInput,
  ProcessTerminationReason,
} from './types';

const MAX_PREVIEW_CHARS = 4000;
const configuredCaptureChars = Number(process.env.PROMETHEUS_PROCESS_CAPTURE_MAX_CHARS);
const MAX_CAPTURE_CHARS = Number.isFinite(configuredCaptureChars)
  ? Math.max(64 * 1024, Math.min(16 * 1024 * 1024, Math.floor(configuredCaptureChars)))
  : 2 * 1024 * 1024;

function nowIso(): string {
  return new Date().toISOString();
}

function trimPreview(text: string): string {
  if (text.length <= MAX_PREVIEW_CHARS) return text;
  return text.slice(-MAX_PREVIEW_CHARS);
}

class BoundedOutputCapture {
  private chunks: string[] = [];
  private chars = 0;
  truncated = false;

  append(text: string): void {
    if (text.length >= MAX_CAPTURE_CHARS) {
      this.chunks = [text.slice(-MAX_CAPTURE_CHARS)];
      this.chars = this.chunks[0].length;
      this.truncated = true;
      return;
    }
    this.chunks.push(text);
    this.chars += text.length;
    while (this.chars > MAX_CAPTURE_CHARS) {
      const excess = this.chars - MAX_CAPTURE_CHARS;
      const first = this.chunks[0];
      if (first.length <= excess) {
        this.chunks.shift();
        this.chars -= first.length;
      } else {
        this.chunks[0] = first.slice(excess);
        this.chars -= excess;
      }
      this.truncated = true;
    }
  }

  value(): string {
    return this.chunks.join('');
  }
}

function normalizeShell(input?: ProcessShell): ProcessShell {
  const shell = String(input || 'auto').toLowerCase();
  if (shell === 'powershell' || shell === 'cmd' || shell === 'bash') return shell;
  return 'auto';
}

function isPowerShellNative(command: string): boolean {
  return /^\s*(?:get|set|new|remove|copy|move|rename|test|resolve|select|where|foreach|measure|convertto|convertfrom|invoke|start|stop)-[a-z]/i.test(command)
    || /^\s*\$[A-Za-z_][\w:.-]*\s*=/.test(command);
}

function resolveShell(input: ProcessShell | undefined, command: string): Exclude<ProcessShell, 'auto'> {
  const shell = normalizeShell(input);
  if (shell !== 'auto') return shell;
  if (process.platform === 'win32') return isPowerShellNative(command) ? 'powershell' : 'powershell';
  return 'bash';
}

/**
 * Environment for agent commands. On Windows the gateway's PATH is frozen at
 * boot, so a tool installed afterwards (winget install ripgrep) stayed "not
 * recognized" until a full app restart. Re-read the persisted Machine + User
 * PATH (cached briefly) and append any entries the process PATH is missing.
 */
let cachedCommandPath: { at: number; value: string } | null = null;
function readPersistedWindowsPath(): string {
  const now = Date.now();
  if (cachedCommandPath && now - cachedCommandPath.at < 60_000) return cachedCommandPath.value;
  let value = '';
  try {
    const query = (hive: string) => {
      try {
        const out = execSync(`reg query "${hive}" /v Path`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000, windowsHide: true });
        const match = out.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i);
        return match ? match[1].trim().replace(/%([^%]+)%/g, (_m, key) => process.env[key] || `%${key}%`) : '';
      } catch { return ''; }
    };
    value = [query('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'), query('HKCU\\Environment')]
      .filter(Boolean).join(';');
  } catch { value = ''; }
  cachedCommandPath = { at: now, value };
  return value;
}

export function resolveCommandEnv(): NodeJS.ProcessEnv {
  if (process.platform !== 'win32') return process.env;
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') || 'Path';
  const current = String(process.env[pathKey] || '');
  const seen = new Set(current.split(';').map((entry) => entry.trim().toLowerCase()).filter(Boolean));
  const extra = readPersistedWindowsPath().split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry && !seen.has(entry.toLowerCase()) && (seen.add(entry.toLowerCase()), true));
  const merged = [current, ...extra].filter(Boolean).join(';');
  // Absolute-path npx/npm shims first, so `"npx.cmd"` spawned by name works
  // from any cwd (stock shims resolve npm via %~dp0, which breaks there).
  const withShims = withNpmShimsOnPath(merged);
  if (withShims === current) return process.env;
  return { ...process.env, [pathKey]: withShims };
}

// ---------------------------------------------------------------------------
// Direct-exec fast path (Windows, shell:"auto" only).
// Every run_command used to start powershell.exe (~250-300 ms) even for a
// plain `git status --short` or `node script.mjs`. For a small allowlist of
// real executables with plainly-tokenized arguments, the shell adds nothing:
// PowerShell does not glob or expand anything in such argv for native
// commands. Anything with a variable, quote escape, operator, redirection,
// pipeline, subexpression, comment, array comma, or splat stays on PowerShell.
// Set PROMETHEUS_DISABLE_DIRECT_EXEC=1 to turn this off.
const DIRECT_EXEC_ALLOWLIST = new Set(['git', 'node', 'rg']);
// No ~ (home expansion differs between shells), no @ (splat), no , (array),
// no $ ` ' ; | & < > ( ) { } # (variables, quoting, operators, comments).
// * and ? are fine: PowerShell never globs arguments to native executables.
const DIRECT_BARE_TOKEN = /^[A-Za-z0-9_.:\/\\=+%*?-]+$/;
const DIRECT_QUOTED_TOKEN = /^"[^"$`]*"$/;
const directExeCache = new Map<string, { at: number; path: string | null }>();

/** Split a command into argv if (and only if) it is safe to run without a shell. */
export function parseDirectExecCommand(command: string): string[] | null {
  const text = String(command || '').trim();
  if (!text || /[\r\n]/.test(text)) return null;
  const tokens = text.match(/"[^"]*"|[^\s"]+/g);
  if (!tokens || tokens.join(' ').length !== text.replace(/\s+/g, ' ').length) return null;
  const argv: string[] = [];
  for (const token of tokens) {
    if (DIRECT_QUOTED_TOKEN.test(token)) { argv.push(token.slice(1, -1)); continue; }
    if (!DIRECT_BARE_TOKEN.test(token)) return null;
    if (token === '--%') return null;
    argv.push(token);
  }
  const exe = argv[0].toLowerCase().replace(/\.exe$/, '');
  if (!DIRECT_EXEC_ALLOWLIST.has(exe)) return null;
  argv[0] = exe;
  return argv;
}

function resolveExecutableOnPath(name: string, env: NodeJS.ProcessEnv): string | null {
  const now = Date.now();
  const cached = directExeCache.get(name);
  if (cached && now - cached.at < 60_000) return cached.path;
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'Path';
  let found: string | null = null;
  for (const dir of String(env[pathKey] || '').split(';')) {
    const trimmed = dir.trim().replace(/^"|"$/g, '');
    if (!trimmed) continue;
    const candidate = path.join(trimmed, `${name}.exe`);
    try { if (fs.statSync(candidate).isFile()) { found = candidate; break; } } catch { /* next */ }
  }
  directExeCache.set(name, { at: now, path: found });
  return found;
}

function getDirectInvocation(command: string, requestedShell: ProcessShell | undefined, env: NodeJS.ProcessEnv): { requestedShell: ProcessShell; shellKind: Exclude<ProcessShell, 'auto'>; shell: string; args: string[]; direct: true } | null {
  if (process.platform !== 'win32') return null;
  if (process.env.PROMETHEUS_DISABLE_DIRECT_EXEC === '1') return null;
  if (normalizeShell(requestedShell) !== 'auto') return null;
  const argv = parseDirectExecCommand(command);
  if (!argv) return null;
  const exePath = resolveExecutableOnPath(argv[0], env);
  if (!exePath) return null;
  return { requestedShell: 'auto', shellKind: 'powershell', shell: exePath, args: argv.slice(1), direct: true };
}

function getShellInvocation(command: string, requestedShell?: ProcessShell): { requestedShell: ProcessShell; shellKind: Exclude<ProcessShell, 'auto'>; shell: string; args: string[] } {
  const shellKind = resolveShell(requestedShell, command);
  if (process.platform === 'win32') {
    if (shellKind === 'cmd') {
      return { requestedShell: normalizeShell(requestedShell), shellKind, shell: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', command] };
    }
    if (shellKind === 'bash') {
      return { requestedShell: normalizeShell(requestedShell), shellKind, shell: process.env.PROMETHEUS_BASH_PATH || 'bash.exe', args: ['-lc', command] };
    }
    return {
      requestedShell: normalizeShell(requestedShell),
      shellKind,
      shell: process.env.PROMETHEUS_POWERSHELL_PATH || 'powershell.exe',
      // Windows PowerShell 5.1 decodes native output with the OEM codepage, so
      // UTF-8 from git/node (box-drawing, em dashes) came back as "�"?" mojibake.
      // Exit code: PS 5.1 -Command exits 1 whenever the last statement set
      // $? = $false, and `native 2>&1` turns ANY stderr line (git "Switched to
      // branch", npm warnings) into a NativeCommandError. Successful runs came
      // back "exit 1" and failures could hide. Treat a stderr-only
      // NativeCommandError as success unless the native exit code was nonzero.
      // Early pipeline stop: `rg ... | Select -First 5` / `git log | Select -First 1`
      // makes Select-Object stop upstream, PowerShell kills the native process and
      // sets $LASTEXITCODE = -1 (reported as 4294967295) with an empty $Error even
      // though the output is complete. Treat -1 with no recorded error as success.
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', buildWindowsPowerShellWrapper(command)],
    };
  }
  if (shellKind === 'powershell') {
    return { requestedShell: normalizeShell(requestedShell), shellKind, shell: process.env.PROMETHEUS_POWERSHELL_PATH || 'pwsh', args: ['-NoProfile', '-Command', command] };
  }
  if (shellKind === 'cmd') {
    return { requestedShell: normalizeShell(requestedShell), shellKind: 'bash', shell: process.env.SHELL || '/bin/bash', args: ['-lc', command] };
  }
  return { requestedShell: normalizeShell(requestedShell), shellKind: 'bash', shell: process.env.SHELL || '/bin/bash', args: ['-lc', command] };
}

/**
 * Windows PowerShell 5.1 -Command wrapper: UTF-8 output plus truthful exit codes.
 * Exported for regression tests.
 */
export function buildWindowsPowerShellWrapper(command: string): string {
  return `try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; $PSDefaultParameterValues['Get-Content:Encoding'] = 'UTF8'; $PSDefaultParameterValues['Select-String:Encoding'] = 'UTF8' } catch {}\n$Error.Clear()\n${command}\n$__pmOk = $?; $__pmNative = ($Error.Count -gt 0 -and "$($Error[0].FullyQualifiedErrorId)" -like 'NativeCommandError*'); if (-not $__pmOk) { if ($LASTEXITCODE -is [int] -and $LASTEXITCODE -eq -1 -and $Error.Count -eq 0) { exit 0 }; if ($LASTEXITCODE -is [int] -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; if ($__pmNative) { exit 0 }; exit 1 }; exit 0`;
}

function killProcessTree(child: ChildProcessWithoutNullStreams): void {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore', timeout: 5000 });
      return;
    } catch {
      // Fall through to normal kill.
    }
  }
  try { child.kill('SIGKILL'); } catch {}
}

function buildSummary(exitCode: number | null, stderr: string, stdout: string): string {
  const source = exitCode === 0 ? stdout : (stderr || stdout);
  return String(source || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-4)
    .join('\n')
    .slice(0, 1000);
}

export class ProcessSupervisor {
  private readonly store: ProcessRunStore;
  private readonly active = new Map<string, ManagedProcessRun>();
  private lastPersistenceWarningAt = 0;
  private readonly initialization: Promise<void>;
  private readonly initializedAt = Date.now();

  constructor(store: ProcessRunStore) {
    this.store = store;
    this.initialization = store.prime().then(() => this.markStaleRunsExited()).catch((error) => {
      this.warnPersistenceFailure('loading process history', error);
    });
  }

  ready(): Promise<void> {
    return this.initialization;
  }

  private warnPersistenceFailure(operation: string, error: unknown): void {
    const now = Date.now();
    if (now - this.lastPersistenceWarningAt < 10_000) return;
    this.lastPersistenceWarningAt = now;
    console.warn(`[ProcessSupervisor] ${operation} failed; continuing without terminating the gateway:`, (error as any)?.message || error);
  }

  private appendOutput(runId: string, kind: 'stdout' | 'stderr', text: string): void {
    try {
      const streamPath = kind === 'stdout' ? this.store.stdoutPath(runId) : this.store.stderrPath(runId);
      enqueueAsyncAppend(streamPath, text);
      enqueueAsyncAppend(this.store.combinedPath(runId), text);
    } catch (error) {
      this.warnPersistenceFailure(`persisting ${kind} for ${runId}`, error);
    }
  }

  list(limit = 100): ProcessRunRecord[] {
    const persisted = this.store.listRecords(limit);
    const activeIds = new Set(this.active.keys());
    const activeRecords = Array.from(this.active.values()).map((run) => run.record);
    const merged = [
      ...activeRecords,
      ...persisted.filter((record) => !activeIds.has(record.runId)),
    ];
    return merged
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
      .slice(0, Math.max(1, Math.min(500, limit)));
  }

  /**
   * One chat's runs, newest first. Unlike list(500)+filter, this sees the
   * chat's runs even when 500 newer runs from other chats exist.
   */
  listForSession(sessionId: string, limit = 100): ProcessRunRecord[] {
    const sid = String(sessionId || '').trim();
    if (!sid) return [];
    const matches = (record: ProcessRunRecord) => String(record.sessionId || '').trim() === sid
      || String((record as any).codingSessionId || '').trim() === sid;
    const activeIds = new Set(this.active.keys());
    const activeRecords = Array.from(this.active.values()).map((run) => run.record).filter(matches);
    return [
      ...activeRecords,
      ...this.store.listRecordsForSession(sid, limit).filter((record) => !activeIds.has(record.runId)),
    ]
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
      .slice(0, Math.max(1, Math.min(500, limit)));
  }

  get(runId: string): ProcessRunRecord | null {
    return this.active.get(runId)?.record || this.store.loadRecord(runId);
  }

  log(runId: string, maxChars = 200_000): ProcessLogResult {
    const stdout = this.store.readLogFile(this.store.stdoutPath(runId), maxChars);
    const stderr = this.store.readLogFile(this.store.stderrPath(runId), maxChars);
    const chronological = this.store.readLogFile(this.store.combinedPath(runId), maxChars);
    const combined = chronological.text || [stdout.text, stderr.text].filter(Boolean).join('\n');
    return {
      runId,
      stdout: stdout.text,
      stderr: stderr.text,
      combined,
      stdoutBytes: stdout.bytes,
      stderrBytes: stderr.bytes,
      truncated: chronological.truncated || stdout.truncated || stderr.truncated,
    };
  }

  async spawn(input: ProcessSpawnInput): Promise<ManagedProcessRun> {
    const command = String(input.command || '').trim();
    if (!command) throw new Error('command is required');
    const cwd = path.resolve(String(input.cwd || getConfig().getWorkspacePath() || process.cwd()));
    const runId = `run_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const startedAt = nowIso();
    const commandEnv = resolveCommandEnv();
    const directInvocation = input.pty === true ? null : getDirectInvocation(command, input.shell, commandEnv);
    const invocation = directInvocation || getShellInvocation(command, input.shell);
    const record: ProcessRunRecord = {
      runId,
      sessionId: input.sessionId,
      toolCallId: input.toolCallId,
      taskId: input.taskId,
      codingSessionId: input.codingSessionId,
      approvalId: input.approvalId,
      rerunOf: input.rerunOf,
      command,
      cwd,
      mode: input.mode || 'foreground',
      shell: invocation.shellKind,
      shellCommand: directInvocation
        ? `${[invocation.shell, ...invocation.args].join(' ')} [direct exec, no shell]`
        : [invocation.shell, ...invocation.args].join(' '),
      pty: input.pty === true,
      title: input.title,
      state: 'starting',
      startedAt,
      updatedAt: startedAt,
      stdinOpen: input.stdinMode === 'pipe' || input.input != null || input.pty === true,
      stdoutBytes: 0,
      stderrBytes: 0,
      outputPreview: '',
      outputSeq: 0,
    };
    this.persistAndBroadcast(record, 'process_run_started');
    const workspaceTracker: ManagedTerminalWorkspaceTracker | null = input.trackWorkspaceChanges
      ? await createManagedTerminalWorkspaceTracker({
          workspacePath: input.workspacePath || getConfig().getWorkspacePath() || cwd,
          cwd,
          command,
          runId,
          sessionId: input.sessionId,
          toolCallId: input.toolCallId,
        })
      : null;
    if (workspaceTracker) record.workspacePath = workspaceTracker.workspacePath;

    if (input.pty === true) {
      return this.spawnPty(input, record, invocation, workspaceTracker);
    }

    // Warm path: a pre-started powershell.exe is already blocked on stdin, so
    // the ~400 ms startup is off the critical path. Same wrapper, fresh process
    // per command. Only for runs that don't need stdin themselves.
    const wantsStdin = input.stdinMode === 'pipe' || input.input != null;
    const warmChild = !directInvocation && !wantsStdin && invocation.shellKind === 'powershell' && process.platform === 'win32'
      ? claimWarmPowerShell(invocation.shell, commandEnv, cwd)
      : null;
    if (warmChild) {
      sendWarmScript(warmChild, cwd, buildWindowsPowerShellWrapper(command));
      record.shellCommand = `${invocation.shell} [warm] ${command}`;
    }
    const child = warmChild || spawn(invocation.shell, invocation.args, {
      cwd,
      env: commandEnv,
      windowsHide: true,
      stdio: [wantsStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;

    const stdoutCapture = new BoundedOutputCapture();
    const stderrCapture = new BoundedOutputCapture();
    let settled = false;
    let forcedReason: ProcessTerminationReason | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;
    let noOutputTimer: NodeJS.Timeout | null = null;
    let forcedCloseTimer: NodeJS.Timeout | null = null;
    const captureOutput = input.captureOutput !== false;
    const outputBatch = new ProcessOutputBatcher((stream, chunk, sequence) => {
      this.persistAndBroadcast(record, 'process_run_output', { stream, chunk, sequence });
      try { input.onOutput?.({ runId, stream, chunk, sequence }); } catch {}
    });

    const updateRecord = (patch: Partial<ProcessRunRecord>, eventType = 'process_run_update', extra: Record<string, unknown> = {}) => {
      Object.assign(record, patch, { updatedAt: nowIso() });
      this.persistAndBroadcast(record, eventType, extra);
    };

    const touchOutput = () => {
      const ts = nowIso();
      record.lastOutputAt = ts;
      record.updatedAt = ts;
      if (input.noOutputTimeoutMs && input.noOutputTimeoutMs > 0 && !settled) {
        if (noOutputTimer) clearTimeout(noOutputTimer);
        noOutputTimer = setTimeout(() => {
          forcedReason = 'no_output_timeout';
          managed.cancel('no_output_timeout');
        }, input.noOutputTimeoutMs);
        if (typeof (noOutputTimer as any).unref === 'function') (noOutputTimer as any).unref();
      }
    };

    const onChunk = (kind: 'stdout' | 'stderr', chunk: Buffer | string) => {
      const text = String(chunk);
      if (captureOutput) {
        (kind === 'stdout' ? stdoutCapture : stderrCapture).append(text);
      }
      if (kind === 'stdout') {
        record.stdoutBytes += Buffer.byteLength(text);
      } else {
        record.stderrBytes += Buffer.byteLength(text);
      }
      this.appendOutput(runId, kind, text);
      record.outputPreview = trimPreview(`${record.outputPreview}${text}`);
      record.outputSeq = Number(record.outputSeq || 0) + 1;
      touchOutput();
      outputBatch.push(kind, text, record.outputSeq);
    };

    child.stdout.on('data', (chunk) => onChunk('stdout', chunk));
    child.stderr.on('data', (chunk) => onChunk('stderr', chunk));
    child.on('error', (err) => {
      stderrCapture.append(String(err?.message || err));
      forcedReason = 'spawn_error';
    });

    updateRecord({ pid: child.pid, state: 'running' });

    if (input.input && child.stdin) {
      child.stdin.write(input.input);
      child.stdin.end();
    }

    if (input.timeoutMs && input.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        forcedReason = 'overall_timeout';
        managed.cancel('overall_timeout');
      }, input.timeoutMs);
      if (typeof (timeoutTimer as any).unref === 'function') (timeoutTimer as any).unref();
    }

    const finalizeWorkspace = async (exit: ProcessRunExit): Promise<TerminalWorkspaceChangeResult | null> => {
      if (!workspaceTracker) return null;
      try {
        const result = await workspaceTracker.finalize();
        if (!result) return null;
        if (result.workspaceChanges.length) {
          Object.assign(exit, {
            workspacePath: result.workspacePath,
            workspaceChanges: result.workspaceChanges,
            workspaceSnapshots: result.workspaceSnapshots,
            workspaceChangeSource: result.workspaceChangeSource,
            ...(result.truncated ? { workspaceChangesTruncated: true } : {}),
          });
        }
        return result;
      } catch (error: any) {
        console.warn(`[ProcessSupervisor] workspace tracking failed for ${runId}:`, error?.message || error);
        return null;
      }
    };

    let resolveWait: (exit: ProcessRunExit) => void = () => {};
    const waitPromise = new Promise<ProcessRunExit>((resolve) => { resolveWait = resolve; });
    const finishRun = async (code: number | null, signal: NodeJS.Signals | null) => {
        if (settled) return;
        settled = true;
        outputBatch.flush();
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (noOutputTimer) clearTimeout(noOutputTimer);
        if (forcedCloseTimer) clearTimeout(forcedCloseTimer);
        const stdout = stdoutCapture.value();
        const stderr = stderrCapture.value();
        const reason: ProcessTerminationReason = forcedReason || (signal ? 'signal' : 'exit');
        const exit: ProcessRunExit = {
          runId,
          reason,
          exitCode: code,
          exitSignal: signal,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          ...(stdoutCapture.truncated ? { stdoutTruncated: true } : {}),
          ...(stderrCapture.truncated ? { stderrTruncated: true } : {}),
          timedOut: reason === 'overall_timeout' || reason === 'no_output_timeout',
          noOutputTimedOut: reason === 'no_output_timeout',
        };
        if (workspaceTracker) updateRecord({ state: 'exiting' });
        const workspaceResult = await finalizeWorkspace(exit);
        const outcome = classifyCommandTermination({ code, timedOut: exit.timedOut, reason, signal });
        updateRecord({
          state: 'exited',
          completedAt: nowIso(),
          durationMs: Date.now() - Date.parse(startedAt),
          exitCode: code,
          exitSignal: signal,
          terminationReason: reason,
          timedOut: exit.timedOut,
          noOutputTimedOut: exit.noOutputTimedOut,
          stdinOpen: false,
          waitingForInputHint: false,
          ...(stdoutCapture.truncated ? { stdoutTruncated: true } : {}),
          ...(stderrCapture.truncated ? { stderrTruncated: true } : {}),
          completionSummary: outcome.ok ? buildSummary(code, stderr, stdout) : undefined,
          failureSummary: outcome.ok ? undefined : (buildSummary(code, stderr, stdout) || outcome.label),
          ...(workspaceResult?.workspaceChanges.length ? {
            workspacePath: workspaceResult.workspacePath,
            workspaceChanges: workspaceResult.workspaceChanges,
            workspaceSnapshots: workspaceResult.workspaceSnapshots,
            workspaceChangeSource: workspaceResult.workspaceChangeSource,
            ...(workspaceResult.truncated ? { workspaceChangesTruncated: true } : {}),
          } : {}),
        }, 'process_run_exited');
        if (workspaceResult?.workspaceChanges.length) {
          this.persistAndBroadcast(record, 'workspace_changes', {
            runId,
            sessionId: record.sessionId,
            toolCallId: record.toolCallId,
            workspacePath: workspaceResult.workspacePath,
            workspaceChanges: workspaceResult.workspaceChanges,
            workspaceSnapshots: workspaceResult.workspaceSnapshots,
            workspaceChangeSource: workspaceResult.workspaceChangeSource,
            ...(workspaceResult.truncated ? { workspaceChangesTruncated: true } : {}),
          });
        }
        this.active.delete(runId);
        resolveWait(exit);
    };
    child.on('close', (code, signal) => { void finishRun(code, signal); });

    const managed: ManagedProcessRun = {
      runId,
      pid: child.pid,
      record,
      wait: async () => waitPromise,
      cancel: (reason = 'manual_cancel') => {
        if (settled) return;
        forcedReason = reason;
        updateRecord({ state: 'exiting', terminationReason: reason });
        killProcessTree(child);
        // A detached child can keep stdout/stderr pipe handles open after the
        // shell is killed. Node then never emits `close`, so a 30-second tool
        // timeout can hold the chat turn until its 10-minute watchdog fires.
        // Settle the captured run after a short drain window in that case.
        if (!forcedCloseTimer) {
          forcedCloseTimer = setTimeout(() => {
            try { child.stdout.destroy(); } catch {}
            try { child.stderr.destroy(); } catch {}
            void finishRun(child.exitCode, child.signalCode);
          }, 3_000);
        }
      },
      write: (data: string) => {
        if (!child.stdin || child.stdin.destroyed) return false;
        child.stdin.write(String(data));
        return true;
      },
      closeStdin: () => {
        if (!child.stdin || child.stdin.destroyed) return false;
        child.stdin.end();
        updateRecord({ stdinOpen: false, waitingForInputHint: false });
        return true;
      },
    };

    this.active.set(runId, managed);
    return managed;
  }

  private async spawnPty(
    input: ProcessSpawnInput,
    record: ProcessRunRecord,
    invocation: ReturnType<typeof getShellInvocation>,
    workspaceTracker: ManagedTerminalWorkspaceTracker | null,
  ): Promise<ManagedProcessRun> {
    const runId = record.runId;
    const cwd = record.cwd;
    const stdoutCapture = new BoundedOutputCapture();
    let settled = false;
    let forcedReason: ProcessTerminationReason | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;
    let noOutputTimer: NodeJS.Timeout | null = null;
    const captureOutput = input.captureOutput !== false;
    const outputBatch = new ProcessOutputBatcher((stream, chunk, sequence) => {
      this.persistAndBroadcast(record, 'process_run_output', { stream, chunk, sequence });
      try { input.onOutput?.({ runId, stream, chunk, sequence }); } catch {}
    });

    const updateRecord = (patch: Partial<ProcessRunRecord>, eventType = 'process_run_update', extra: Record<string, unknown> = {}) => {
      Object.assign(record, patch, { updatedAt: nowIso() });
      this.persistAndBroadcast(record, eventType, extra);
    };

    const touchOutput = () => {
      const ts = nowIso();
      record.lastOutputAt = ts;
      record.updatedAt = ts;
      if (input.noOutputTimeoutMs && input.noOutputTimeoutMs > 0 && !settled) {
        if (noOutputTimer) clearTimeout(noOutputTimer);
        noOutputTimer = setTimeout(() => {
          forcedReason = 'no_output_timeout';
          managed.cancel('no_output_timeout');
        }, input.noOutputTimeoutMs);
        if (typeof (noOutputTimer as any).unref === 'function') (noOutputTimer as any).unref();
      }
    };

    const ptyProcess = pty.spawn(invocation.shell, invocation.args, {
      name: 'xterm-color',
      cols: 120,
      rows: 30,
      cwd,
      env: resolveCommandEnv() as any,
    });

    const onChunk = (chunk: string) => {
      const text = String(chunk);
      if (captureOutput) {
        stdoutCapture.append(text);
      }
      record.stdoutBytes += Buffer.byteLength(text);
      this.appendOutput(runId, 'stdout', text);
      record.outputPreview = trimPreview(`${record.outputPreview}${text}`);
      record.outputSeq = Number(record.outputSeq || 0) + 1;
      record.waitingForInputHint = /(?:press any key|password|passphrase|enter .*:|continue\?|y\/n|\[y\/n\]|waiting for input)/i.test(record.outputPreview);
      touchOutput();
      outputBatch.push('stdout', text, record.outputSeq);
    };

    ptyProcess.onData(onChunk);
    updateRecord({ pid: ptyProcess.pid, state: 'running' });

    if (input.input) ptyProcess.write(input.input);

    if (input.timeoutMs && input.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        forcedReason = 'overall_timeout';
        managed.cancel('overall_timeout');
      }, input.timeoutMs);
      if (typeof (timeoutTimer as any).unref === 'function') (timeoutTimer as any).unref();
    }

    const finalizeWorkspace = async (exit: ProcessRunExit): Promise<TerminalWorkspaceChangeResult | null> => {
      if (!workspaceTracker) return null;
      try {
        const result = await workspaceTracker.finalize();
        if (!result) return null;
        if (result.workspaceChanges.length) {
          Object.assign(exit, {
            workspacePath: result.workspacePath,
            workspaceChanges: result.workspaceChanges,
            workspaceSnapshots: result.workspaceSnapshots,
            workspaceChangeSource: result.workspaceChangeSource,
            ...(result.truncated ? { workspaceChangesTruncated: true } : {}),
          });
        }
        return result;
      } catch (error: any) {
        console.warn(`[ProcessSupervisor] workspace tracking failed for ${record.runId}:`, error?.message || error);
        return null;
      }
    };

    const waitPromise = new Promise<ProcessRunExit>((resolve) => {
      ptyProcess.onExit(({ exitCode, signal }) => { void (async () => {
        if (settled) return;
        settled = true;
        outputBatch.flush();
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (noOutputTimer) clearTimeout(noOutputTimer);
        const stdout = stdoutCapture.value();
        const stderr = '';
        const reason: ProcessTerminationReason = forcedReason || (signal ? 'signal' : 'exit');
        const exit: ProcessRunExit = {
          runId,
          reason,
          exitCode,
          exitSignal: signal || null,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          ...(stdoutCapture.truncated ? { stdoutTruncated: true } : {}),
          timedOut: reason === 'overall_timeout' || reason === 'no_output_timeout',
          noOutputTimedOut: reason === 'no_output_timeout',
        };
        if (workspaceTracker) updateRecord({ state: 'exiting' });
        const workspaceResult = await finalizeWorkspace(exit);
        const outcome = classifyCommandTermination({ code: exitCode, timedOut: exit.timedOut, reason, signal: signal || null });
        updateRecord({
          state: 'exited',
          completedAt: nowIso(),
          durationMs: Date.now() - Date.parse(record.startedAt),
          exitCode,
          exitSignal: signal || null,
          terminationReason: reason,
          timedOut: exit.timedOut,
          noOutputTimedOut: exit.noOutputTimedOut,
          stdinOpen: false,
          waitingForInputHint: false,
          ...(stdoutCapture.truncated ? { stdoutTruncated: true } : {}),
          completionSummary: outcome.ok ? buildSummary(exitCode, stderr, stdout) : undefined,
          failureSummary: outcome.ok ? undefined : (buildSummary(exitCode, stderr, stdout) || outcome.label),
          ...(workspaceResult?.workspaceChanges.length ? {
            workspacePath: workspaceResult.workspacePath,
            workspaceChanges: workspaceResult.workspaceChanges,
            workspaceSnapshots: workspaceResult.workspaceSnapshots,
            workspaceChangeSource: workspaceResult.workspaceChangeSource,
            ...(workspaceResult.truncated ? { workspaceChangesTruncated: true } : {}),
          } : {}),
        }, 'process_run_exited');
        if (workspaceResult?.workspaceChanges.length) {
          this.persistAndBroadcast(record, 'workspace_changes', {
            runId: record.runId,
            sessionId: record.sessionId,
            toolCallId: record.toolCallId,
            workspacePath: workspaceResult.workspacePath,
            workspaceChanges: workspaceResult.workspaceChanges,
            workspaceSnapshots: workspaceResult.workspaceSnapshots,
            workspaceChangeSource: workspaceResult.workspaceChangeSource,
            ...(workspaceResult.truncated ? { workspaceChangesTruncated: true } : {}),
          });
        }
        this.active.delete(runId);
        resolve(exit);
      })(); });
    });

    const managed: ManagedProcessRun = {
      runId,
      pid: ptyProcess.pid,
      record,
      wait: async () => waitPromise,
      cancel: (reason = 'manual_cancel') => {
        if (settled) return;
        forcedReason = reason;
        updateRecord({ state: 'exiting', terminationReason: reason });
        try { ptyProcess.kill(); } catch {}
      },
      write: (data: string) => {
        if (settled) return false;
        ptyProcess.write(String(data));
        updateRecord({ waitingForInputHint: false, stdinOpen: true });
        return true;
      },
      closeStdin: () => {
        if (settled) return false;
        updateRecord({ stdinOpen: false, waitingForInputHint: false });
        return true;
      },
    };

    this.active.set(runId, managed);
    return managed;
  }

  cancel(runId: string, reason: ProcessTerminationReason = 'manual_cancel'): boolean {
    const run = this.active.get(runId);
    if (!run) return false;
    run.cancel(reason);
    return true;
  }

  write(runId: string, data: string, appendNewline = false): boolean {
    const run = this.active.get(runId);
    if (!run) return false;
    return run.write(appendNewline ? `${data}${run.record.pty ? '\r' : '\n'}` : data);
  }

  closeStdin(runId: string): boolean {
    const run = this.active.get(runId);
    if (!run) return false;
    return run.closeStdin();
  }

  async wait(runId: string): Promise<ProcessRunExit | null> {
    const run = this.active.get(runId);
    if (!run) {
      const record = this.store.loadRecord(runId);
      if (!record || record.state !== 'exited') return null;
      const logs = this.log(runId);
      return {
        runId,
        reason: record.terminationReason || 'exit',
        exitCode: record.exitCode ?? null,
        exitSignal: record.exitSignal ?? null,
        stdout: logs.stdout.trim(),
        stderr: logs.stderr.trim(),
        stdoutTruncated: record.stdoutTruncated || logs.truncated,
        stderrTruncated: record.stderrTruncated || logs.truncated,
        timedOut: record.timedOut === true,
        noOutputTimedOut: record.noOutputTimedOut === true,
        workspacePath: record.workspacePath,
        workspaceChanges: record.workspaceChanges,
        workspaceSnapshots: record.workspaceSnapshots,
        workspaceChangeSource: record.workspaceChangeSource,
        workspaceChangesTruncated: record.workspaceChangesTruncated,
      };
    }
    return run.wait();
  }

  private persistAndBroadcast(record: ProcessRunRecord, eventType: string, extra: Record<string, unknown> = {}): void {
    const now = Date.now();
    // Streaming logs are already asynchronously appended. Do not force a
    // synchronous temp-file write + rename for every output batch; lifecycle
    // updates (including exit) still checkpoint the complete record durably.
    if (eventType !== 'process_run_output') {
      try {
        this.store.writeRecord(record);
      } catch (error) {
        this.warnPersistenceFailure(`persisting record ${record.runId}`, error);
      }
    }
    try {
      // Full records, shellCommand and output logs remain available via process
      // status/log APIs; streaming output only needs identity + its new chunk.
      const run = eventType === 'process_run_output'
        ? { runId: record.runId, sessionId: record.sessionId, toolCallId: record.toolCallId,
            state: record.state, outputSeq: record.outputSeq }
        : { ...record, shellCommand: undefined,
            outputPreview: String(record.outputPreview || '').slice(-1_024),
            command: String(record.command || '').slice(0, 500),
            workspaceSnapshots: undefined, workspaceChanges: undefined };
      broadcastWS({ type: eventType, sessionId: record.sessionId, run, ...extra, timestamp: now });
    } catch {
      // WebSocket broadcast is best-effort.
    }
  }

  private async markStaleRunsExited(): Promise<void> {
    let corrected = 0;
    for (const record of this.store.listRecords(500)) {
      if (record.state !== 'running' && record.state !== 'starting' && record.state !== 'exiting') continue;
      if (this.active.has(record.runId) || Date.parse(record.startedAt) >= this.initializedAt) continue;
      const updated: ProcessRunRecord = {
        ...record,
        state: 'exited',
        completedAt: record.completedAt || nowIso(),
        updatedAt: nowIso(),
        terminationReason: record.terminationReason || 'spawn_error',
      };
      try {
        this.store.writeRecord(updated);
      } catch (error) {
        this.warnPersistenceFailure(`marking stale record ${record.runId}`, error);
      }
      if (++corrected % 16 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
}

let supervisor: ProcessSupervisor | null = null;

export function getProcessSupervisor(): ProcessSupervisor {
  if (!supervisor) {
    const root = path.join(getConfig().getConfigDir(), 'processes');
    supervisor = new ProcessSupervisor(new ProcessRunStore(root));
    // Have a warm powershell.exe ready before the first shell-path command.
    if (process.platform === 'win32') {
      setImmediate(() => {
        try {
          prewarmPowerShell(
            process.env.PROMETHEUS_POWERSHELL_PATH || 'powershell.exe',
            resolveCommandEnv(),
            path.resolve(String(getConfig().getWorkspacePath() || process.cwd())),
          );
        } catch { /* best effort */ }
      });
    }
  }
  return supervisor;
}
