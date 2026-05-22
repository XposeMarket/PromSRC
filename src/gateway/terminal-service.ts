import path from 'path';
import { getConfig } from '../config/config';
import { getProcessSupervisor } from './process/supervisor';
import type { ManagedProcessRun, ProcessRunExit, ProcessShell, ProcessSpawnMode } from './process/types';

export type TerminalMode = 'auto' | ProcessSpawnMode;

export interface TerminalRunInput {
  command: string;
  cwd?: string;
  mode?: TerminalMode;
  shell?: ProcessShell;
  pty?: boolean;
  title?: string;
  sessionId?: string;
  taskId?: string;
  codingSessionId?: string;
  approvalId?: string;
  rerunOf?: string;
  timeoutMs?: number;
  noOutputTimeoutMs?: number;
  stdin?: boolean;
  input?: string;
}

export interface TerminalRunResult {
  run: ManagedProcessRun;
  exit?: ProcessRunExit;
}

const LONG_RUNNING_PATTERNS = [
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|watch)\b/i,
  /\bdocker\s+compose\s+up\b/i,
  /\bnext\s+dev\b/i,
  /\bvite(?:\s|$)/i,
  /\bnodemon\b/i,
  /\buvicorn\b/i,
  /\bgunicorn\b/i,
  /\bpython(?:3)?\s+-m\s+http\.server\b/i,
];

const INTERACTIVE_PATTERNS = [
  /\b(?:codex|claude|python|python3|node|pwsh|powershell)\s*$/i,
  /\bauth\s+(?:login|oauth|oauth2)\b/i,
  /\blogin\b/i,
  /\bssh\b/i,
];

function stripQuoted(command: string): string {
  return String(command || '').replace(/"[^"]*"|'[^']*'/g, ' ');
}

export function looksLongRunning(command: string): boolean {
  const unquoted = stripQuoted(command);
  return /(?:^|[\s;|&])(?:nohup|setsid|disown)\b/i.test(unquoted)
    || /(?:^|[^&])&\s*$/.test(unquoted)
    || LONG_RUNNING_PATTERNS.some((pattern) => pattern.test(unquoted));
}

export function looksInteractive(command: string): boolean {
  const unquoted = stripQuoted(command);
  return INTERACTIVE_PATTERNS.some((pattern) => pattern.test(unquoted));
}

export function resolveTerminalCwd(cwd?: string): string {
  const workspacePath = getConfig().getWorkspacePath() || process.cwd();
  return path.resolve(cwd ? (path.isAbsolute(cwd) ? cwd : path.join(workspacePath, cwd)) : workspacePath);
}

export function resolveTerminalMode(input: TerminalRunInput): ProcessSpawnMode {
  if (input.mode === 'foreground' || input.mode === 'background') return input.mode;
  return looksLongRunning(input.command) ? 'background' : 'foreground';
}

export function resolveTerminalPty(input: TerminalRunInput): boolean {
  if (input.pty === true) return true;
  return looksInteractive(input.command);
}

export async function runTerminal(input: TerminalRunInput): Promise<TerminalRunResult> {
  const command = String(input.command || '').trim();
  if (!command) throw new Error('command is required');
  const mode = resolveTerminalMode(input);
  const pty = resolveTerminalPty(input);
  const run = await getProcessSupervisor().spawn({
    command,
    cwd: resolveTerminalCwd(input.cwd),
    mode,
    shell: input.shell || 'auto',
    pty,
    title: input.title,
    sessionId: input.sessionId,
    taskId: input.taskId,
    codingSessionId: input.codingSessionId,
    approvalId: input.approvalId,
    rerunOf: input.rerunOf,
    timeoutMs: input.timeoutMs,
    noOutputTimeoutMs: input.noOutputTimeoutMs,
    stdinMode: input.stdin === true || input.input != null || pty ? 'pipe' : 'ignore',
    input: input.input,
  });
  if (mode === 'foreground') {
    const exit = await run.wait();
    return { run, exit };
  }
  return { run };
}
