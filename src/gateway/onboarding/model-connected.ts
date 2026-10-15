// Answers "can this install talk to a model right now?" from real credentials,
// independent of whether the onboarding model step was ever completed. Installs
// that skipped onboarding (or were grandfathered as existing installs) but have
// an OAuth login or API key must not be shown "Connect a model" prompts.

import { getConfig } from '../../config/config';

const OAUTH_PROVIDERS = new Set(['anthropic', 'openai_codex']);

export interface ModelCredentialDeps {
  config?: any;
  configDir?: string;
  oauthConnected?: (provider: string, configDir: string, accountId?: string) => boolean;
}

function defaultOauthConnected(provider: string, configDir: string, accountId?: string): boolean {
  try {
    // Lazy requires keep the auth modules (vault access) off the router import path.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = provider === 'anthropic' ? require('../../auth/anthropic-oauth') : require('../../auth/openai-oauth');
    return !!mod.isConnected?.(configDir, accountId);
  } catch {
    return false;
  }
}

export function hasActiveModelCredential(deps: ModelCredentialDeps = {}): boolean {
  try {
    const cfg: any = deps.config ?? getConfig().getConfig();
    const providerId = String(cfg?.llm?.provider || '').trim();
    if (!providerId) return false;
    const provider: any = cfg?.llm?.providers?.[providerId] || {};
    if (provider.api_key || provider.apiKey) return true;
    if (OAUTH_PROVIDERS.has(providerId)) {
      const configDir = deps.configDir ?? getConfig().getConfigDir();
      const check = deps.oauthConnected || defaultOauthConnected;
      const accountId = provider.defaultAccountId || undefined;
      return check(providerId, configDir, accountId) || (accountId ? check(providerId, configDir) : false);
    }
    return false;
  } catch {
    return false;
  }
}
