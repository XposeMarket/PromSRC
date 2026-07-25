/**
 * Shared, non-secret account selection and failover rules for LLM providers.
 * Credential loading stays in each provider-specific auth module.
 */

export function orderProviderAccountIds(
  accounts: Record<string, unknown>,
  preferredAccountId?: string,
  defaultAccountId?: string,
): string[] {
  const ordered: string[] = [];
  const add = (value: unknown) => {
    const id = String(value || '').trim();
    if (id && accounts[id] && !ordered.includes(id)) ordered.push(id);
  };
  add(preferredAccountId);
  add(defaultAccountId);
  for (const id of Object.keys(accounts)) add(id);
  return ordered;
}

/**
 * Only retry another account when the failure plausibly belongs to that
 * account: credentials, billing/quota, rate limits, or a transient upstream
 * failure. Invalid requests deliberately remain attached to the selected
 * account so a bad prompt cannot consume every account in the pool.
 */
export function isRetryableAccountFailure(status: number, responseText = ''): boolean {
  if ([401, 402, 403, 408, 409, 429].includes(Number(status)) || Number(status) >= 500) return true;
  return /(?:insufficient|exhausted|out of)\s+(?:credits?|quota|usage)|(?:credits?|quota|usage|balance|billing).{0,100}(?:insufficient|exhausted|empty|limit|required|too low|exceeded)/i
    .test(String(responseText || ''));
}
