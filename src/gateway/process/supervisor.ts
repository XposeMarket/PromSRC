import crypto from 'crypto';
import path from 'path';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { execSync } from 'child_process';
import { getConfig } from '../../config/config';
import { broadcastWS } from '../comms/broadcaster';
import { ProcessRunStore } from './store';
import type {
  ManagedProcessRun,
  ProcessLogResult,
  ProcessRunExit,
  ProcessRunRecord,
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

function getShellInvocation(command: string): { shell: string; args: string[] } {
  if (process.platform === 'win32') {
    return { shell: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', command] };
  }
  return { shell: process.env.SHELL || '/bin/bash', args: ['-lc', command] };
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

export class ProcessSupervisor {
  private readonly store: ProcessRunStore;
  private readonly active = new Map<string, ManagedProcessRun>();

  constructor(store: ProcessRunStore) {
    this.store = store;
    this.markStaleRunsExited();
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
    const combined = [stdout.text, stderr.text].filter(Boolean).join('\n');
    return {
      runId,
      stdout: stdout.text,
      stderr: stderr.text,
      combined,
      stdoutBytes: stdout.bytes,
      stderrBytes: stderr.bytes,
      truncated: stdout.truncated || stderr.truncated,
    };
  }

  async spawn(input: ProcessSpawnInput): Promise<ManagedProcessRun> {
    const command = String(input.command || '').trim();
    if (!command) throw new Error('command is required');
    const cwd = path.resolve(String(input.cwd || getConfig().getWorkspacePath() || process.cwd()));
    const runId = `run_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const startedAt = nowIso();
    const record: ProcessRunRecord = {
      runId,
      sessionId: input.sessionId,
      taskId: input.taskId,
      codingSessionId: input.codingSessionId,
      command,
      cwd,
      mode: input.mode || 'foreground',
      title: input.title,
      state: 'starting',
      startedAt,
      updatedAt: startedAt,
      stdoutBytes: 0,
      stderrBytes: 0,
      outputPreview: '',
    };
    this.persistAndBroadcast(record, 'process_run_started');

    const { shell, args } = getShellInvocation(command);
    const child = spawn(shell, args, {
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

    const updateRecord = (patch: Partial<ProcessRunRecord>, eventType = 'process_run_update') => {
      Object.assign(record, patch, { updatedAt: nowIso() });
      this.persistAndBroadcast(record, eventType);
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
        this.store.appendStdout(runId, text);
      } else {
        record.stderrBytes += Buffer.byteLength(text);
        this.store.appendStderr(runId, text);
      }
      record.outputPreview = trimPreview(`${record.outputPreview}${text}`);
      touchOutput();
      this.persistAndBroadcast(record, 'process_run_output');
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
        updateRecord({
          state: 'exited',
          completedAt: nowIso(),
          exitCode: code,
          exitSignal: signal,
          terminationReason: reason,
          timedOut: exit.timedOut,
          noOutputTimedOut: exit.noOutputTimedOut,
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
    if (!run) return null;
    return run.wait();
  }

  private persistAndBroadcast(record: ProcessRunRecord, eventType: string): void {
    this.store.writeRecord(record);
    try {
      broadcastWS({ type: eventType, run: record, timestamp: Date.now() });
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
      this.store.writeRecord(updated);
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
