import path from 'path';
import { getConfig } from '../config/config.js';
import { ToolResult } from '../types.js';
import { log } from '../security/log-scrubber.js';
import { getActiveAllowedWorkspaces, getActiveWorkspace } from './workspace-context.js';
import { getProcessSupervisor } from '../gateway/process/supervisor.js';
import { runTerminal } from '../gateway/terminal-service.js';
import type { ProcessShell } from '../gateway/process/types.js';
import { isSessionAllowedPath } from '../gateway/path-permissions.js';
import { getSharedToolExecutionContext } from './execution-context.js';
import { isCanonicalPathInsideSync } from './workspace-boundary.js';

/**
 * Commands that are trusted in lite mode and bypass per-command approval.
 * These are all read-only or workspace-scoped write operations with minimal risk.
 */
export const TRUSTED_DEV_COMMANDS: string[] = [
  // git reads
  'git status', 'git log', 'git diff', 'git branch', 'git show', 'git fetch', 'git stash list',
  'git stash show',
  // git workspace writes (low risk, workspace-scoped)
  'git add', 'git commit', 'git stash',
  // package managers
  'npm', 'npx', 'pnpm', 'yarn', 'bun',
  // node execution
  'node',
  // typescript / linting
  'tsc', 'eslint', 'prettier',
  // basic inspection
  'where', 'echo', 'type ', 'dir',
];

export function commandMatchesTrustedDev(command: string): boolean {
  return commandMatchesAllowlist(command, TRUSTED_DEV_COMMANDS);
}

export interface ShellToolArgs {
  command: string;
  cwd?: string;
  background?: boolean;
  timeoutMs?: number;
  timeout_ms?: number;
  noOutputTimeoutMs?: number;
  no_output_timeout_ms?: number;
  shell?: ProcessShell;
  pty?: boolean;
}

// ── Path confinement helper ───────────────────────────────────────────────────
// Uses proper path.resolve + path.relative — immune to case, trailing-slash,
// and "../" traversal bypasses that defeat simple startsWith() checks.
function isPathInsideDir(base: string, target: string): boolean {
  return isCanonicalPathInsideSync(base, target);
}

function isPathInsideAnyDir(basePaths: string[], target: string): boolean {
  return basePaths.some((base) => {
    try { return isPathInsideDir(base, target); } catch { return false; }
  });
}

// ── Absolute-path detector ────────────────────────────────────────────────────
// Catches commands that contain absolute paths outside the workspace even when
// cwd is inside it — e.g. `type C:\Windows\System32\config\SAM`
function containsOutOfScopeAbsPath(command: string, allowedPaths: string[]): boolean {
  // Match Windows and POSIX absolute paths embedded in command strings
  const absPathRe = process.platform === 'win32'
    ? /[A-Za-z]:[/\\][^\s"']+/g
    : /\/[^\s"']{3,}/g;

  const matches = command.match(absPathRe) || [];
  for (const match of matches) {
    try {
      if (!isPathInsideAnyDir(allowedPaths, match)) return true;
    } catch {
      // If we can't resolve it, treat as suspicious
      return true;
    }
  }
  return false;
}

/**
 * Returns true if `command` matches any entry in `patterns`.
 * Supports: exact match, prefix match ("npm" matches "npm install"),
 * and glob suffix ("npm *" or "npm*" matches any npm command).
 * Case-insensitive on all platforms.
 */
export function commandMatchesAllowlist(command: string, patterns: string[]): boolean {
  const cmd = command.trim().toLowerCase();
  for (const raw of patterns) {
    const p = raw.trim().toLowerCase();
    if (!p) continue;
    if (p.endsWith('*')) {
      // "npm *" → prefix is "npm ", "npm*" → prefix is "npm"
      const prefix = p.endsWith(' *') ? p.slice(0, -1) : p.slice(0, -1);
      if (cmd.startsWith(prefix)) return true;
    } else if (cmd === p || cmd.startsWith(p + ' ') || cmd.startsWith(p + '\t')) {
      return true;
    }
  }
  return false;
}

export function validateShellRequest(args: ShellToolArgs): { ok: true; cwd: string; command: string } | { ok: false; result: ToolResult } {
  const config = getConfig().getConfig();
  const permissions = config.tools.permissions.shell;
  const filePermissions = config.tools.permissions.files;
  const workspacePath = path.resolve(getActiveWorkspace(config.workspace.path));
  const allowedPaths = getActiveAllowedWorkspaces(config.workspace.path, filePermissions?.allowed_paths || []);
  const blockedPaths = (filePermissions?.blocked_paths || []).map((p: string) => path.resolve(p));

  // Determine and resolve working directory
  const cwd = path.resolve(args.cwd ? (path.isAbsolute(args.cwd) ? args.cwd : path.join(workspacePath, args.cwd)) : workspacePath);

  if (isPathInsideAnyDir(blockedPaths, cwd)) {
    log.warn('[shell] Blocked: cwd inside blocked path:', cwd);
    return {
      ok: false,
      result: {
        success: false,
        error: `Security: Command execution inside blocked paths is not allowed. Requested: ${cwd}`
      }
    };
  }
  if (blockedPaths.length > 0) {
    const absPathRe = process.platform === 'win32'
      ? /[A-Za-z]:[/\\][^\s"']+/g
      : /\/[^\s"']{3,}/g;
    const matches = args.command.match(absPathRe) || [];
    if (matches.some((match) => isPathInsideAnyDir(blockedPaths, match))) {
      log.warn('[shell] Blocked: command references blocked path:', args.command.slice(0, 120));
      return {
        ok: false,
        result: {
          success: false,
          error: `Security: Command references a blocked path.`
        }
      };
    }
  }

  // ── FIX HIGH-05: use proper path confinement (not startsWith) ──────────────
  const enforceWorkspaceOnly = permissions.workspace_only && permissions.approval_mode !== 'lite';
  if (enforceWorkspaceOnly) {
    const { sessionId } = getSharedToolExecutionContext();
    if (!isPathInsideAnyDir(allowedPaths, cwd) && !isSessionAllowedPath(sessionId, cwd)) {
      log.warn('[shell] Path approval needed: cwd outside workspace:', cwd);
      return {
        ok: false,
        result: {
          success: false,
          error: `Path "${cwd}" is outside the allowed workspace paths.`,
          data: { _needsPathApproval: true, requestedPath: cwd },
        }
      };
    }

    // Also block commands that reference absolute paths outside the configured file allowlist.
    if (containsOutOfScopeAbsPath(args.command, allowedPaths)) {
      log.warn('[shell] Blocked: command references path outside allowed paths:', args.command.slice(0, 120));
      return {
        ok: false,
        result: {
          success: false,
          error: `Security: Command references a path outside allowed paths.`
        }
      };
    }
  }

  // ── Config allowed_commands: bypass blocked-pattern + dangerous-command checks ──
  const allowedCmds: string[] = (permissions as any).allowed_commands ?? [];
  if (allowedCmds.length > 0 && commandMatchesAllowlist(args.command, allowedCmds)) {
    return { ok: true, cwd, command: args.command };
  }

  // Check config-defined blocked patterns
  for (const pattern of permissions.blocked_patterns) {
    if (args.command.includes(pattern)) {
      log.warn('[shell] Blocked pattern match:', pattern);
      return {
        ok: false,
        result: {
          success: false,
          error: `Security: Command blocked due to dangerous pattern: "${pattern}"`
        }
      };
    }
  }

  // Hardcoded dangerous command patterns
  const dangerousCommands: Array<[RegExp, string]> = [
    [/rm\s+-rf\s+\//, 'rm -rf /'],
    [/mkfs/, 'filesystem format'],
    [/dd\s+if=/, 'disk write'],
    [/>\s*\/dev\//, 'device write'],
    [/\bsudo\b/, 'privilege escalation'],
    [/\bsu\s/, 'user switch'],
    [/chmod\s+777/, 'world-writable permission'],
    [/\bcurl\b.*\|.*\bbash\b/, 'curl-pipe-bash'],
    [/\bwget\b.*-O.*\s*-\s*\|/, 'wget-pipe'],
  ];

  for (const [pattern, label] of dangerousCommands) {
    if (pattern.test(args.command)) {
      log.warn('[shell] Blocked dangerous command:', label);
      return {
        ok: false,
        result: {
          success: false,
          error: `Security: Potentially destructive command detected (${label}): ${args.command.slice(0, 80)}`
        }
      };
    }
  }

  return { ok: true, cwd, command: args.command };
}

export async function executeShell(args: ShellToolArgs): Promise<ToolResult> {
  const validation = validateShellRequest(args);
  if (!validation.ok) return validation.result;
  const timeoutMs = Number(args.timeoutMs ?? args.timeout_ms ?? 120000);
  const noOutputTimeoutMs = args.noOutputTimeoutMs ?? args.no_output_timeout_ms;
  const supervisor = getProcessSupervisor();
  try {
    const result = await runTerminal({
      command: validation.command,
      cwd: validation.cwd,
      mode: args.background ? 'background' : 'foreground',
      shell: args.shell || 'auto',
      pty: args.pty === true,
      timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 120000,
      noOutputTimeoutMs: noOutputTimeoutMs == null ? undefined : Number(noOutputTimeoutMs),
    });
    const run = result.run;
    if (args.background) {
      return {
        success: true,
        stdout: `Started background command ${run.runId}`,
        data: { runId: run.runId, run: run.record },
      };
    }
    const output = result.exit || await run.wait();
    return {
      success: output.exitCode === 0,
      stdout: output.stdout,
      stderr: output.stderr,
      exitCode: output.exitCode ?? 0,
      data: { runId: output.runId, run: supervisor.get(output.runId) },
      error: output.exitCode === 0 ? undefined : output.stderr || `Command exited with ${output.exitCode ?? 'unknown status'}`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      stdout: '',
      stderr: '',
      exitCode: 1
    };
  }
}

export const shellTool = {
  name: 'shell',
  description: 'Execute terminal commands in the workspace through Prometheus supervised command runs',
  execute: executeShell,
  schema: {
    command: 'string (required) - The command to execute',
    cwd: 'string (optional) - Working directory, defaults to workspace',
    background: 'boolean (optional) - If true, starts the command and returns a runId immediately',
    timeoutMs: 'number (optional) - Foreground timeout in milliseconds',
    noOutputTimeoutMs: 'number (optional) - Kill if no output arrives within this many milliseconds'
  }
};
