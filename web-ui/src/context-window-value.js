function nonNegativeFinite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

/**
 * Select the active context total for a visible meter. The context-window
 * snapshot describes the bounded next model call, while pressure mirrors the
 * full active transcript used by the compaction gate. Either estimate may be
 * temporarily behind the other, so the visible gauge must retain the larger
 * value until an explicit compaction event resets both baselines.
 */
export function resolveActiveContextTokens({ currentStateTokens, pressureTokens, fallbackTokens } = {}) {
  const candidates = [currentStateTokens, pressureTokens, fallbackTokens]
    .filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)))
    .map(nonNegativeFinite);
  return candidates.length ? Math.max(...candidates) : 0;
}
