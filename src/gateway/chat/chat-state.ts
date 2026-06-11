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
 * Maximum LLM↔tool rounds per handleChat invocation (each round = model reply + tool batch).
 * No cap — the loop ends naturally when the model stops calling tools (or on abort).
 */
export function getMaxToolRounds(): number {
  return Infinity;
}
