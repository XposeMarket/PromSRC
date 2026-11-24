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

/** Only a confirmed limit, not generic provider overload/auth. Never echo the payload. */
export function usageCutoffNotice(error: any, now = Date.now()): string | undefined {
  const raw = String(error?.message ?? error ?? '');
  if (!/\busage_limit_reached\b|\brate_limit_(?:error|exceeded)\b|\binsufficient_quota\b|\busage limit (?:has been |was )?reached\b/i.test(raw)
    && !((Number(error?.status ?? error?.response?.status) === 429 || /\b429\b/.test(raw)) && /rate limit|usage limit|quota|exceed your account/i.test(raw))) return;
  const headers = error?.rateLimitHeaders ?? {};
  const absolute = (value: unknown) => {
    if (value == null || value === '') return NaN;
    const n = Number(value);
    const ms = Number.isFinite(n) ? n * (n < 1e12 ? 1000 : 1) : Date.parse(String(value));
    return Number.isFinite(new Date(ms).getTime()) && ms > now ? ms : NaN;
  };
  const times = [absolute(headers['anthropic-ratelimit-unified-reset']), absolute(error?.resets_at),
    absolute(raw.match(/"resets_at"\s*:\s*"?([\dT:.+Z-]+)/i)?.[1])];
  for (const window of ['5h','7d']) {
    const key = `anthropic-ratelimit-unified-${window}`;
    if (headers[`${key}-status`] === 'rejected' || Number(headers[`${key}-utilization`]) === 1) times.push(absolute(headers[`${key}-reset`]));
  }
  const fmt = (ms: number) => new Intl.DateTimeFormat(undefined, {month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(ms);
  const reset = Math.max(...times.filter(Number.isFinite));
  const retry = headers['retry-after'];
  const retryAt = typeof retry === 'string' && /^\d+$/.test(retry) ? now + Number(retry)*1000 : absolute(retry);
  const timing = Number.isFinite(reset) ? `Resets ${fmt(reset)}.` : retryAt > now && Number.isFinite(new Date(retryAt).getTime()) ? `Try again ${fmt(retryAt)}.` : 'Reset time unavailable.';
  return `Usage limit reached. ${timing}\n\nType \`continue\` to resume.`;
}
