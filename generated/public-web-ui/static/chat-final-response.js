// The stream transports deltas, never whitespace-normalized prose.  Keep this
// deliberately small and dependency-free so every chat surface applies the
// same final-response contract.

/**
 * Append one final-response delta without attempting prose or overlap repair.
 *
 * Sequence-aware transports already discard duplicate frames.  Trying to infer
 * overlap here loses legitimate repeated characters and Markdown delimiters
 * (for example split `**`, headings, blank lines, and code fences).
 */
export function appendFinalResponseDelta(existing, delta) {
  const previous = String(existing ?? '');
  const incoming = String(delta ?? '');
  if (!incoming) return previous;
  // A few provider adapters emit a full snapshot instead of a delta.  This is
  // the only safe replacement case; all other input is an exact append.
  if (previous && incoming.length > previous.length && incoming.startsWith(previous)) return incoming;
  return `${previous}${incoming}`;
}

/**
 * The terminal event is the canonical response.  Reconcile even if a live
 * preview exists: a preview is intentionally lossy only in timing, never in
 * the completed message.
 */
export function reconcileFinalResponse(liveText, canonicalText) {
  const canonical = String(canonicalText ?? '');
  return canonical ? canonical : String(liveText ?? '');
}

export function beginFinalResponse(state) {
  if (state && typeof state === 'object') state.finalResponseStarted = true;
  return state;
}
