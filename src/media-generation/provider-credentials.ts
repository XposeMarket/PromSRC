import { getConfig } from '../config/config.js';

type ProviderConfig = Record<string, any>;

function getRuntimeConfig(): any {
  return getConfig().getConfig() as any;
}

function getRawProviderConfig(providerId: string): ProviderConfig {
  const providers = getRuntimeConfig()?.llm?.providers;
  const value = providers?.[providerId];
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/**
 * Resolve the account selected for a media provider without exposing any
 * secret values. The active LLM account is intentionally reused only when it
 * belongs to this provider (or the OpenAI API/Codex pair).
 */
export function getConfiguredProviderAccountId(providerId: string): string | undefined {
  const normalized = String(providerId || '').trim().toLowerCase();
  const runtime = getRuntimeConfig();
  const activeProvider = String(runtime?.llm?.provider || '').trim().toLowerCase();
  const activeAccountId = String(runtime?.llm?.accountId || '').trim();
  if (
    activeAccountId
    && (activeProvider === normalized
      || ((normalized === 'openai' || normalized === 'openai_codex')
        && (activeProvider === 'openai' || activeProvider === 'openai_codex')))
  ) {
    return activeAccountId;
  }

  const providerConfig = getRawProviderConfig(normalized);
  const configured = String(providerConfig.defaultAccountId || '').trim();
  const accounts = providerConfig.accounts;
  if (accounts && typeof accounts === 'object' && !Array.isArray(accounts)) {
    if (configured && accounts[configured] && typeof accounts[configured] === 'object') return configured;
    const first = Object.keys(accounts).find((id) => accounts[id] && typeof accounts[id] === 'object');
    if (first) return first;
  }
  // Keep supporting vault-backed accounts that predate the account map.
  if (configured) return configured;
  return undefined;
}

/**
 * Merge the selected account over the provider-level settings. This mirrors
 * the main model factory and, importantly, lets media tools use credentials
 * saved under llm.<provider>.accounts instead of only legacy top-level keys.
 */
export function getConfiguredProviderConfig(providerId: string): ProviderConfig {
  const normalized = String(providerId || '').trim().toLowerCase();
  const raw = getRawProviderConfig(normalized);
  const accountId = getConfiguredProviderAccountId(normalized);
  const account = accountId && raw.accounts?.[accountId];
  const { accounts: _accounts, defaultAccountId: _defaultAccountId, ...providerSettings } = raw;
  return {
    ...providerSettings,
    ...(account && typeof account === 'object' && !Array.isArray(account) ? account : {}),
    accountId,
  };
}
