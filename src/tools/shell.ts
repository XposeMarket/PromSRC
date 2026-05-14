import path from 'path';
import { getConfig } from '../config/config.js';
import { ToolResult } from '../types.js';
import { log } from '../security/log-scrubber.js';
import { getActiveAllowedWorkspaces, getActiveWorkspace } from './workspace-context.js';
import { getProcessSupervisor } from '../gateway/process/supervisor.js';

export interface ShellToolArgs {
  command: string;
  cwd?: string;
  background?: boolean;
  timeoutMs?: number;
  timeout_ms?: number;
  noOutputTimeoutMs?: number;
  no_output_timeout_ms?: number;
}

// ── Path confinement helper ───────────────────────────────────────────────────
// Uses proper path.resolve + path.relative — immune to case, trailing-slash,
// and "../" traversal bypasses that defeat simple startsWith() checks.
function isPathInsideDir(base: string, target: string): boolean {
  const resolvedBase   = path.resolve(base);
  const resolvedTarget = path.resolve(target);
  const compareBase = process.platform === 'win32' ? resolvedBase.toLowerCase() : resolvedBase;
  const compareTarget = process.platform === 'win32' ? resolvedTarget.toLowerCase() : resolvedTarget;
  if (compareBase === compareTarget) return true;
  const rel = path.relative(compareBase, compareTarget);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
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

export function validateShellRequest(args: ShellToolArgs): { ok: true; cwd: string; command: string } | { ok: false; result: ToolResult } {
  const config = getConfig().getConfig();
  const permissions = config.tools.permissions.shell;
  const filePermissions = config.tools.permissions.files;
  const workspacePath = path.resolve(getActiveWorkspace(config.workspace.path));
  const allowedPaths = getActiveAllowedWorkspaces(config.workspace.path, filePermissions?.allowed_paths || []);
  const blockedPaths = (filePermissions?.blocked_paths || []).map((p: string) => path.resolve(p));

  // Determine and resolve working directory
  const cwd = path.resolve(args.cwd ? (path.isAbsolute(args.cwd) ? args.cwd : path.join(workspacePath, args.cwd)) : workspacePath);

  // ── FIX HIGH-05: use proper path confinement (not startsWith) ──────────────
  if (permissions.workspace_only) {
    if (!isPathInsideAnyDir(allowedPaths, cwd)) {
      log.warn('[shell] Blocked: cwd outside workspace:', cwd);
      return {
        ok: false,
        result: {
          success: false,
          error: `Security: Command execution outside allowed paths is not allowed. Allowed: ${allowedPaths.join(', ')}, Requested: ${cwd}`
        }
      };
    }
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
    const run = await supervisor.spawn({
      command: validation.command,
      cwd: validation.cwd,
      mode: args.background ? 'background' : 'foreground',
      timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 120000,
      noOutputTimeoutMs: noOutputTimeoutMs == null ? undefined : Number(noOutputTimeoutMs),
    });
    if (args.background) {
      return {
        success: true,
        stdout: `Started background command ${run.runId}`,
        data: { runId: run.runId, run: run.record },
      };
    }
    const output = await run.wait();
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
