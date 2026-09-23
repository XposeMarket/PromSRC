/** Keep provider transport payloads out of assistant prose while preserving
 * enough detail for the user to choose a working route. */
export function presentProviderCallFailure(error: unknown): string {
  const raw = String((error as any)?.message || error || 'Unknown provider error');
  if (/^anthropic API error 400:/i.test(raw)) {
    try {
      const payload = JSON.parse(raw.slice(raw.indexOf('{')));
      const message = String(payload?.error?.message || '');
      if (/you're out of extra usage/i.test(message)) {
        // Anthropic sends this when it bills a setup-token request to extra
        // usage (overflow) and extra usage is off on the account
        // (overage-disabled-reason: org_level_disabled). Observed 2026-09-23
        // this also hits single requests while the plan still has capacity:
        // the same thread succeeded 30s later. The adapter already retried
        // once before this reaches the user, so this is a persistent rejection.
        return 'Anthropic billed this request to extra usage instead of your Claude plan and rejected it, because extra usage is turned off on the account. Prometheus already retried once. This is usually intermittent: send again, or switch to another connected model to keep going.';
      }
    } catch {
      // Preserve the original error when Anthropic did not return valid JSON.
    }
  }
  return `Error: ${raw}`;
}
