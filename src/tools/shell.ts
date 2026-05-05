import path from 'path';
import { spawn } from 'child_process';
import { getConfig } from '../config/config.js';
import { ToolResult } from '../types.js';
import { log } from '../security/log-scrubber.js';
import { getActiveAllowedWorkspaces, getActiveWorkspace } from './workspace-context.js';

export interface ShellToolArgs {
  command: string;
  cwd?: string;
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

export async function executeShell(args: ShellToolArgs): Promise<ToolResult> {
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
        success: false,
        error: `Security: Command execution outside allowed paths is not allowed. Allowed: ${allowedPaths.join(', ')}, Requested: ${cwd}`
      };
    }
    if (isPathInsideAnyDir(blockedPaths, cwd)) {
      log.warn('[shell] Blocked: cwd inside blocked path:', cwd);
      return {
        success: false,
        error: `Security: Command execution inside blocked paths is not allowed. Requested: ${cwd}`
      };
    }

    // Also block commands that reference absolute paths outside the configured file allowlist.
    if (containsOutOfScopeAbsPath(args.command, allowedPaths)) {
      log.warn('[shell] Blocked: command references path outside allowed paths:', args.command.slice(0, 120));
      return {
        success: false,
        error: `Security: Command references a path outside allowed paths.`
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
          success: false,
          error: `Security: Command references a blocked path.`
        };
      }
    }
  }

  // Check config-defined blocked patterns
  for (const pattern of permissions.blocked_patterns) {
    if (args.command.includes(pattern)) {
      log.warn('[shell] Blocked pattern match:', pattern);
      return {
        success: false,
        error: `Security: Command blocked due to dangerous pattern: "${pattern}"`
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
        success: false,
        error: `Security: Potentially destructive command detected (${label}): ${args.command.slice(0, 80)}`
      };
    }
  }

  try {
    const output = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? (process.env.ComSpec || 'cmd.exe') : (process.env.SHELL || '/bin/bash');
      const shellArgs = isWindows ? ['/d', '/s', '/c', args.command] : ['-lc', args.command];
      const child = spawn(shell, shellArgs, {
        cwd,
        env: process.env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const cap = (current: string, chunk: Buffer | string) => (current + String(chunk)).slice(0, 120000);
      child.stdout?.on('data', chunk => { stdout = cap(stdout, chunk); });
      child.stderr?.on('data', chunk => { stderr = cap(stderr, chunk); });
      child.on('close', code => resolve({ stdout, stderr, code }));
      child.on('error', err => resolve({ stdout, stderr: String(err?.message || err), code: 1 }));
    });
    return {
      success: output.code === 0,
      stdout: output.stdout.trim(),
      stderr: output.stderr.trim(),
      exitCode: output.code ?? 0,
      error: output.code === 0 ? undefined : output.stderr.trim() || `Command exited with ${output.code ?? 'unknown status'}`,
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
  description: 'Execute terminal commands in the workspace',
  execute: executeShell,
  schema: {
    command: 'string (required) - The command to execute',
    cwd: 'string (optional) - Working directory, defaults to workspace'
  }
};
