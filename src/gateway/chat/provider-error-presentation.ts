/** Keep provider transport payloads out of assistant prose while preserving
 * enough detail for the user to choose a working route. */
export function presentProviderCallFailure(error: unknown): string {
  const raw = String((error as any)?.message || error || 'Unknown provider error');
  if (/^anthropic API error 400:/i.test(raw)) {
    try {
      const payload = JSON.parse(raw.slice(raw.indexOf('{')));
      const message = String(payload?.error?.message || '');
      if (/you're out of extra usage/i.test(message)) {
        return 'Anthropic rejected this Prometheus Claude request with an “out of extra usage” error. This does not establish that your interactive Claude plan is exhausted: Prometheus uses a separately saved credential. Check the selected Claude account and test this model in Settings, or select another connected model to continue.';
      }
    } catch {
      // Preserve the original error when Anthropic did not return valid JSON.
    }
  }
  return `Error: ${raw}`;
}
