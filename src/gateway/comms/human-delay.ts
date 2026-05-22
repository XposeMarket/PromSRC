/**
 * human-delay.ts
 *
 * Random pacing helper. Generates a "human-like" delay (in ms) between
 * outbound message bubbles so Prometheus' replies arrive in conversational
 * rhythm instead of all at once.
 *
 * Modes:
 *   - "off"     → 0ms (instant)
 *   - "natural" → uniform random in [800, 2500] ms
 *   - "custom"  → uniform random in [minMs, maxMs] ms
 *
 * Inspired by OpenClaw's reply-dispatcher.getHumanDelay implementation.
 */

export type HumanDelayMode = 'off' | 'natural' | 'custom';

export interface HumanDelayConfig {
  mode?: HumanDelayMode;
  /** Minimum delay in milliseconds (default: 800). */
  minMs?: number;
  /** Maximum delay in milliseconds (default: 2500). */
  maxMs?: number;
}

const DEFAULT_HUMAN_DELAY_MIN_MS = 800;
const DEFAULT_HUMAN_DELAY_MAX_MS = 2500;

/**
 * Returns a random delay in milliseconds based on the configured mode.
 * Returns 0 when mode is "off" or unspecified.
 */
export function getHumanDelayMs(config?: HumanDelayConfig): number {
  const mode = config?.mode ?? 'off';
  if (mode === 'off') return 0;

  const min = mode === 'custom'
    ? Math.max(0, config?.minMs ?? DEFAULT_HUMAN_DELAY_MIN_MS)
    : DEFAULT_HUMAN_DELAY_MIN_MS;
  const max = mode === 'custom'
    ? Math.max(min, config?.maxMs ?? DEFAULT_HUMAN_DELAY_MAX_MS)
    : DEFAULT_HUMAN_DELAY_MAX_MS;

  if (max <= min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Promisified setTimeout. */
export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const HUMAN_DELAY_DEFAULTS = {
  minMs: DEFAULT_HUMAN_DELAY_MIN_MS,
  maxMs: DEFAULT_HUMAN_DELAY_MAX_MS,
} as const;
