/**
 * workspace-context.ts
 *
 * Per-execution workspace scoping for subagents and team managers.
 *
 * PROBLEM SOLVED:
 *   All file tools (read, write, edit, list, mkdir, etc.) previously resolved
 *   paths against the GLOBAL workspace config. This meant a subagent spawned
 *   with workspacePath = ".prometheus/agents/news_harvester_v1/workspace" could
 *   still read/write anywhere in the global workspace — a major security/isolation
 *   gap when running autonomous teams.
 *
 * SOLUTION:
 *   AsyncLocalStorage carries the active workspace root through the entire async
 *   call chain of a single reactor run. The Reactor sets it via runWithWorkspace()
 *   before executing any tools. File tools read it via getActiveWorkspace().
 *
 *   - No shared mutable globals — safe for concurrent subagent runs.
 *   - Zero performance overhead — AsyncLocalStorage is a thin V8 primitive.
 *   - Falls back to global config workspace if called outside a scoped context
 *     (preserves backward compatibility for direct tool calls).
 *
 * ENFORCEMENT:
 *   isPathInWorkspace() is called by file tools to verify every resolved path
 *   stays inside the active workspace root. Any path escaping the workspace
 *   is rejected with a clear error message.
 */

import { AsyncLocalStorage } from 'async_hooks';
import path from 'path';

// ── Storage ───────────────────────────────────────────────────────────────────

const workspaceStorage = new AsyncLocalStorage<string>();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run a callback with a specific workspace root set as the active context.
 * All file tool calls within the callback (and any async operations it spawns)
 * will be scoped to this workspace.
 *
 * @example
 *   await runWithWorkspace('/path/to/agent/workspace', async () => {
 *     await reactor.run(task, options);
 *   });
 */
export function runWithWorkspace<T>(workspacePath: string, fn: () => Promise<T>): Promise<T> {
  const resolved = path.resolve(workspacePath);
  return workspaceStorage.run(resolved, fn);
}

/**
 * Returns the active workspace root for the current async context.
 * Falls back to the global config workspace if called outside a scoped context.
 */
export function getActiveWorkspace(globalFallback: string): string {
  return workspaceStorage.getStore() ?? path.resolve(globalFallback);
}

/**
 * Returns true if targetPath is inside (or equal to) workspaceRoot.
 * Works cross-platform using case-insensitive compare on Windows.
 */
export function isPathInWorkspace(workspaceRoot: string, targetPath: string): boolean {
  const normalise = (p: string) => {
    const resolved = path.resolve(p);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const base = normalise(workspaceRoot);
  const target = normalise(targetPath);
  if (base === target) return true;
  const rel = path.relative(base, target);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}
