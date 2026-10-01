/** Backoff between retries of a trigger agent run that died on a provider outage. */
export const TRANSIENT_RETRY_DELAYS_MS = [30_000, 90_000, 180_000];

/**
 * True when an agent run's final text is a bare provider/runtime error rather than real
 * output (e.g. "Error: xai API error 403 ... spending-limit"). Such runs must count as
 * FAILED so only-on-failure rules report them instead of silently swallowing them.
 */
export function isProviderErrorText(text: string): boolean {
  const s = String(text || '').trim();
  if (!s || s.length > 1500) return false;
  return /^(?:Error:|Trigger agent failed:)/i.test(s) || /^\S+ API error \d{3}\b/i.test(s);
}

/**
 * True only for short provider-failure texts (e.g. "Error: openai_codex API error 503",
 * "overloaded_error", "429 rate limit"). Long agent output that merely mentions an error
 * code is never treated as transient. Usage/credit exhaustion is NOT transient: retrying
 * cannot fix it.
 */
export function isTransientProviderFailure(text: string): boolean {
  const s = String(text || '').trim();
  if (!s || s.length > 600) return false;
  if (/usage_limit_reached|out of extra usage|insufficient_quota|credits depleted|spending-limit|run out of credits/i.test(s)) return false;
  return /\bAPI error (?:429|5\d\d)\b|\b(?:429|500|502|503|504|529)\b.*\b(?:error|unavailable|overloaded|timeout)|overloaded_error|service unavailable|bad gateway|gateway timeout|ECONNRESET|ETIMEDOUT|socket hang up|fetch failed/i.test(s);
}
