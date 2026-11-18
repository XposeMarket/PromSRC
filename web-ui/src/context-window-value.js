function nonNegativeFinite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

/**
 * Select the stored thread total for the visible context-window headline.
 *
 * The detail rows are a current-call composition estimate, but the headline
 * is explicitly the persisted thread footprint returned as totalThreadTokens.
 * Keep current-state/pressure values as compatibility fallbacks for older
 * responses so a missing new field cannot make the control disappear.
 */
export function resolveContextWindowHeadlineTokens({ totalThreadTokens, currentStateTokens, pressureTokens, fallbackTokens } = {}) {
  if (totalThreadTokens !== null && totalThreadTokens !== undefined && Number.isFinite(Number(totalThreadTokens))) {
    return nonNegativeFinite(totalThreadTokens);
  }
  if (currentStateTokens !== null && currentStateTokens !== undefined && Number.isFinite(Number(currentStateTokens))) {
    return nonNegativeFinite(currentStateTokens);
  }
  if (pressureTokens !== null && pressureTokens !== undefined && Number.isFinite(Number(pressureTokens))) {
    return nonNegativeFinite(pressureTokens);
  }
  return nonNegativeFinite(fallbackTokens);
}
