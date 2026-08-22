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
 * Interactive Prometheus turns are intentionally not bounded by a practical
 * total tool-round count. Real safety comes from explicit cancellation,
 * progress/stall detection, repeated-tool loop protection, provider failures,
 * and task-level guards — not an arbitrary per-turn tool quota.
 *
 * chat.router.ts still accepts this legacy numeric hook while the large router
 * is being decomposed, so return the largest exact integer rather than a small
 * limit that can interrupt productive long-running work.
 */
export function getMaxToolRounds(): number {
  return Number.MAX_SAFE_INTEGER;
}
