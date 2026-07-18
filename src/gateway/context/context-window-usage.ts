/**
 * The context meter is a snapshot of input that can be sent on the next model
 * call. It is deliberately distinct from cumulative provider/tool usage.
 */
export type ContextWindowUsageStatus = 'normal' | 'full' | 'over_capacity' | 'unavailable';

export interface ContextWindowUsage {
  usedTokens: number;
  capacityTokens: number;
  ratio: number;
  percent: number;
  progressPercent: number;
  overflowTokens: number;
  status: ContextWindowUsageStatus;
}

function nonNegativeFinite(value: unknown): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.max(0, numberValue) : 0;
}

/**
 * Builds the one shared contract used by context-window API consumers. Never
 * clamp `percent`: callers need the actual value to make overflow visible.
 * `progressPercent` is the separately-clamped value intended only for bars.
 */
export function deriveContextWindowUsage(usedTokens: unknown, capacityTokens: unknown): ContextWindowUsage {
  const used = nonNegativeFinite(usedTokens);
  const capacity = nonNegativeFinite(capacityTokens);
  if (capacity <= 0) {
    return {
      usedTokens: used,
      capacityTokens: capacity,
      ratio: 0,
      percent: 0,
      progressPercent: 0,
      overflowTokens: 0,
      status: 'unavailable',
    };
  }

  const ratio = used / capacity;
  const percent = ratio * 100;
  const overflowTokens = Math.max(0, used - capacity);
  return {
    usedTokens: used,
    capacityTokens: capacity,
    ratio,
    percent,
    progressPercent: Math.min(100, percent),
    overflowTokens,
    status: overflowTokens > 0 ? 'over_capacity' : used === capacity ? 'full' : 'normal',
  };
}
