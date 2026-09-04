function nonNegativeFinite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

/**
 * Select the active context total for a visible meter. The context-window
 * snapshot is the authoritative current state; pressure is only a fallback
 * for the short period where that snapshot is unavailable.
 */
export function resolveActiveContextTokens({ currentStateTokens, pressureTokens, fallbackTokens } = {}) {
  if (currentStateTokens !== null && currentStateTokens !== undefined && Number.isFinite(Number(currentStateTokens))) {
    return nonNegativeFinite(currentStateTokens);
  }
  if (pressureTokens !== null && pressureTokens !== undefined && Number.isFinite(Number(pressureTokens))) {
    return nonNegativeFinite(pressureTokens);
  }
  return nonNegativeFinite(fallbackTokens);
}
