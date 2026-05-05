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
 * Desktop/browser automation often needs many rounds (screenshot → scroll × N → summarize).
 * Override with env PROMETHEUS_MAX_TOOL_ROUNDS (5–500).
 */
export function getMaxToolRounds(): number {
  const raw = String(process.env.PROMETHEUS_MAX_TOOL_ROUNDS || '').trim();
  const n = parseInt(raw, 10);
  if (Number.isFinite(n) && n >= 5 && n <= 500) return n;
  return 80;
}
