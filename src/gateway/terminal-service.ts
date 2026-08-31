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
  workspacePath?: string;
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

const WORKSPACE_MUTATION_PATTERNS = [
  /\b(?:set|add|clear)-content\b/i,
  /\bout-file\b/i,
  /\b(?:new|remove|copy|move|rename)-item(?:property)?\b/i,
  /\bset-item(?:property)?\b/i,
  /\b(?:writealltext|writeallbytes|appendalltext|appendalllines)\b/i,
  /\b(?:writefile|appendfile|unlink|rmsync|mkdir|rename|copyfile)(?:sync)?\b/i,
  /(?:^|[;&|]\s*)(?:rm|del|erase|move|mv|copy|cp|ren|mkdir|md|rmdir|touch|tee)\b/i,
  /\bsed\s+-[^\r\n;|&]*i\b/i,
  /(?:^|[^>])>{1,2}(?!=)/,
  /\bgit\s+(?:add|apply|am|checkout|switch|commit|merge|rebase|reset|restore|clean|cherry-pick|revert|stash|tag|push|pull)\b/i,
  /\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|remove|uninstall|update|upgrade|run|exec|publish)\b/i,
  /\b(?:npx|tsx|ts-node|node|python|python3|pip|pip3|cargo|go|dotnet|docker|kubectl)\b/i,
];

const CONFIDENT_READ_ONLY_PATTERNS = [
  /^\s*(?:get-(?:childitem|content|item|location)|select-string|test-path|resolve-path)\b/i,
  /^\s*\$[A-Za-z_][\w:.-]*\s*=.*\b(?:get-(?:childitem|content|item)|select-string|test-path|resolve-path)\b/is,
  /^\s*git\s+(?:status|diff|log|show|rev-parse|ls-files|grep|branch\s+--show-current)\b/i,
  /^\s*(?:rg|grep|findstr|ls|dir|cat|type)\b/i,
];

function stripQuoted(command: string): string {
  return String(command || '').replace(/"[^"]*"|'[^']*'/g, ' ');
}

function splitPowerShellClauses(command: string): string[] {
  const source = String(command || '');
  const clauses: string[] = [];
  let quote: "'" | '"' | null = null;
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === '`' && index + 1 < source.length) {
        index += 1;
        continue;
      }
      if (char === quote) {
        if (quote === "'" && source[index + 1] === "'") {
          index += 1;
          continue;
        }
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === ';' || char === '\r' || char === '\n') {
      const clause = source.slice(start, index).trim();
      if (clause) clauses.push(clause);
      start = index + 1;
      if (char === '\r' && source[index + 1] === '\n') {
        index += 1;
        start = index + 1;
      }
    }
  }
  const tail = source.slice(start).trim();
  if (tail) clauses.push(tail);
  return clauses;
}

function isKnownReadOnlyPowerShellSequence(command: string): boolean {
  const clauses = splitPowerShellClauses(command);
  if (clauses.length < 2) return false;
  let sawInspection = false;
  for (const clause of clauses) {
    // Each statement-delimited clause must itself be a single recognized
    // observational expression. A safe-looking prefix followed by a pipeline
    // or call operator can execute arbitrary code (for example,
    // `Get-Content file | Invoke-Expression`) and must retain change tracking.
    if (/(?:&&|\|\||[|&])/.test(stripQuoted(clause))) return false;
    if (/^\$[A-Za-z_][\w:.-]*\s*=\s*(?:'[^']*'|"[^"]*")\s*$/s.test(clause)) continue;
    if (/^\$[A-Za-z_][\w:.-]*\s*=\s*(?:get-(?:childitem|content|item|location)|select-string|test-path|resolve-path)\b/i.test(clause)) {
      sawInspection = true;
      continue;
    }
    if (/^\$[A-Za-z_][\w:.-]*\s*=\s*\[regex\]::Match\([^;]+\)\.Value\s*$/i.test(clause)) continue;
    if (/^(?:write-output|select-object|where-object|sort-object|measure-object|format-(?:list|table|wide|custom))\b/i.test(clause)) continue;
    if (CONFIDENT_READ_ONLY_PATTERNS.some((pattern) => pattern.test(clause))) {
      sawInspection = true;
      continue;
    }
    return false;
  }
  return sawInspection;
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

/**
 * Terminal change tracking takes a synchronous before/after workspace
 * fingerprint. Skip it only for commands that are confidently observational;
 * unknown commands remain tracked so undo/change evidence stays conservative.
 */
export function shouldTrackTerminalWorkspaceChanges(command: string): boolean {
  const source = String(command || '').trim();
  if (!source) return false;
  if (WORKSPACE_MUTATION_PATTERNS.some((pattern) => pattern.test(source))) return true;
  const confidentlyReadOnly = CONFIDENT_READ_ONLY_PATTERNS.some((pattern) => pattern.test(source));
  if (!confidentlyReadOnly) return true;

  // A read-only prefix does not make the rest of a compound shell command safe.
  // Unless we can recognize the whole sequence as observational, retain change
  // tracking so later clauses cannot mutate files without undo/plan evidence.
  const unquoted = stripQuoted(source);
  if (/(?:&&|\|\||[;|]|[\r\n])/.test(unquoted) && !isKnownReadOnlyPowerShellSequence(source)) return true;
  return false;
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
    workspacePath: input.workspacePath || resolveTerminalCwd(input.cwd),
    trackWorkspaceChanges: shouldTrackTerminalWorkspaceChanges(command),
  });
  if (mode === 'foreground') {
    const exit = await run.wait();
    return { run, exit };
  }
  return { run };
}
