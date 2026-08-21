/**
 * chat-state.ts — Shared mutable state for the chat pipeline.
 *
 * Extracted from server-v2.ts (B6) so that chat.router.ts and
 * skills.router.ts can both import the same live Map without creating
 * a circular dependency through server-v2.
 */

import type { TaskState } from '../tasks/task-runner';

// Active background tasks keyed by sessionId.
// Written by handleChat when it spawns a BackgroundTaskRunner,
// read by skills.router for task-status telemetry.
export const activeTasks: Map<string, TaskState> = new Map();

/**
 * Default maximum LLM↔tool rounds per handleChat invocation (each round =
 * model reply + tool batch). Individual execution modes may override this
 * through the bounded PROMETHEUS_*_MAX_TOOL_ROUNDS settings.
 */
export function getMaxToolRounds(): number {
  const parsed = Number(process.env.PROMETHEUS_INTERACTIVE_MAX_TOOL_ROUNDS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.floor(parsed)) : 48;
}
