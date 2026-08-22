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
 * Main interactive Prometheus chat is intentionally not bounded by an
 * arbitrary total LLM↔tool round quota. Productive turns can legitimately
 * require hundreds of tool calls; stopping them at 48/69/120 rounds creates
 * synthetic "continue" turns and breaks autonomous work.
 *
 * The chat pipeline still has real safety controls (explicit abort/cancel,
 * repeated-tool/cycle guards, no-progress/stall handling, provider failures,
 * and task-specific limits). This legacy numeric hook therefore returns an
 * effectively unreachable ceiling and explicitly ignores the old interactive
 * max-round environment override.
 */
export function getMaxToolRounds(): number {
  // chat.router.ts still consults PROMETHEUS_INTERACTIVE_MAX_TOOL_ROUNDS after
  // calling this hook. Remove that obsolete override from this process so an
  // old local value (for example 120) cannot silently restore the boundary.
  delete process.env.PROMETHEUS_INTERACTIVE_MAX_TOOL_ROUNDS;
  return Number.MAX_SAFE_INTEGER;
}
