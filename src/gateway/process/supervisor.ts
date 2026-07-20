import crypto from 'crypto';
import path from 'path';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { execSync } from 'child_process';
import pty from 'node-pty';
import { getConfig } from '../../config/config';
import { broadcastWS } from '../comms/broadcaster';
import { ProcessRunStore } from './store';
import { classifyCommandTermination } from './command-outcome';
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

function nowIso(): string {
  return new Date().toISOString();
}

function trimPreview(text: string): string {
  if (text.length <= MAX_PREVIEW_CHARS) return text;
  return text.slice(-MAX_PREVIEW_CHARS);
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
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
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

  constructor(store: ProcessRunStore) {
    this.store = store;
    this.markStaleRunsExited();
  }

  private warnPersistenceFailure(operation: string, error: unknown): void {
    const now = Date.now();
    if (now - this.lastPersistenceWarningAt < 10_000) return;
    this.lastPersistenceWarningAt = now;
    console.warn(`[ProcessSupervisor] ${operation} failed; continuing without terminating the gateway:`, (error as any)?.message || error);
  }

  private appendOutput(runId: string, kind: 'stdout' | 'stderr', text: string): void {
    try {
      if (kind === 'stdout') this.store.appendStdout(runId, text);
      else this.store.appendStderr(runId, text);
      this.store.appendCombined(runId, text);
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
    const invocation = getShellInvocation(command, input.shell);
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
      shellCommand: [invocation.shell, ...invocation.args].join(' '),
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

    if (input.pty === true) {
      return this.spawnPty(input, record, invocation);
    }

    const child = spawn(invocation.shell, invocation.args, {
      cwd,
      env: process.env,
      windowsHide: true,
      stdio: [input.stdinMode === 'pipe' || input.input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;

    let stdout = '';
    let stderr = '';
    let settled = false;
    let forcedReason: ProcessTerminationReason | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;
    let noOutputTimer: NodeJS.Timeout | null = null;
    const captureOutput = input.captureOutput !== false;

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
        if (kind === 'stdout') stdout += text;
        else stderr += text;
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
      this.persistAndBroadcast(record, 'process_run_output', { stream: kind, chunk: text, sequence: record.outputSeq });
    };

    child.stdout.on('data', (chunk) => onChunk('stdout', chunk));
    child.stderr.on('data', (chunk) => onChunk('stderr', chunk));
    child.on('error', (err) => {
      stderr += String(err?.message || err);
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

    const waitPromise = new Promise<ProcessRunExit>((resolve) => {
      child.on('close', (code, signal) => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (noOutputTimer) clearTimeout(noOutputTimer);
        const reason: ProcessTerminationReason = forcedReason || (signal ? 'signal' : 'exit');
        const exit: ProcessRunExit = {
          runId,
          reason,
          exitCode: code,
          exitSignal: signal,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          timedOut: reason === 'overall_timeout' || reason === 'no_output_timeout',
          noOutputTimedOut: reason === 'no_output_timeout',
        };
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
          completionSummary: outcome.ok ? buildSummary(code, stderr, stdout) : undefined,
          failureSummary: outcome.ok ? undefined : (buildSummary(code, stderr, stdout) || outcome.label),
        }, 'process_run_exited');
        this.active.delete(runId);
        resolve(exit);
      });
    });

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
  ): Promise<ManagedProcessRun> {
    const runId = record.runId;
    const cwd = record.cwd;
    let stdout = '';
    let stderr = '';
    let settled = false;
    let forcedReason: ProcessTerminationReason | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;
    let noOutputTimer: NodeJS.Timeout | null = null;
    const captureOutput = input.captureOutput !== false;

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
      env: process.env as any,
    });

    const onChunk = (chunk: string) => {
      const text = String(chunk);
      if (captureOutput) stdout += text;
      record.stdoutBytes += Buffer.byteLength(text);
      this.appendOutput(runId, 'stdout', text);
      record.outputPreview = trimPreview(`${record.outputPreview}${text}`);
      record.outputSeq = Number(record.outputSeq || 0) + 1;
      record.waitingForInputHint = /(?:press any key|password|passphrase|enter .*:|continue\?|y\/n|\[y\/n\]|waiting for input)/i.test(record.outputPreview);
      touchOutput();
      this.persistAndBroadcast(record, 'process_run_output', { stream: 'stdout', chunk: text, sequence: record.outputSeq });
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

    const waitPromise = new Promise<ProcessRunExit>((resolve) => {
      ptyProcess.onExit(({ exitCode, signal }) => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (noOutputTimer) clearTimeout(noOutputTimer);
        const reason: ProcessTerminationReason = forcedReason || (signal ? 'signal' : 'exit');
        const exit: ProcessRunExit = {
          runId,
          reason,
          exitCode,
          exitSignal: signal || null,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          timedOut: reason === 'overall_timeout' || reason === 'no_output_timeout',
          noOutputTimedOut: reason === 'no_output_timeout',
        };
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
          completionSummary: outcome.ok ? buildSummary(exitCode, stderr, stdout) : undefined,
          failureSummary: outcome.ok ? undefined : (buildSummary(exitCode, stderr, stdout) || outcome.label),
        }, 'process_run_exited');
        this.active.delete(runId);
        resolve(exit);
      });
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
    return run.write(appendNewline ? `${data}\n` : data);
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
        timedOut: record.timedOut === true,
        noOutputTimedOut: record.noOutputTimedOut === true,
      };
    }
    return run.wait();
  }

  private persistAndBroadcast(record: ProcessRunRecord, eventType: string, extra: Record<string, unknown> = {}): void {
    try {
      this.store.writeRecord(record);
    } catch (error) {
      this.warnPersistenceFailure(`persisting record ${record.runId}`, error);
    }
    try {
      broadcastWS({ type: eventType, run: record, ...extra, timestamp: Date.now() });
    } catch {
      // WebSocket broadcast is best-effort.
    }
  }

  private markStaleRunsExited(): void {
    for (const record of this.store.listRecords(500)) {
      if (record.state !== 'running' && record.state !== 'starting' && record.state !== 'exiting') continue;
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
    }
  }
}

let supervisor: ProcessSupervisor | null = null;

export function getProcessSupervisor(): ProcessSupervisor {
  if (!supervisor) {
    const root = path.join(getConfig().getConfigDir(), 'processes');
    supervisor = new ProcessSupervisor(new ProcessRunStore(root));
  }
  return supervisor;
}
