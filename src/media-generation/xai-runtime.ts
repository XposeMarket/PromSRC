import { getConfig } from '../config/config.js';
import { getXaiAuthCandidates } from '../auth/xai-account-pool.js';
import { getValidXAIRuntimeCredentials } from '../auth/xai-oauth.js';
import { getConfiguredProviderConfig } from './provider-credentials.js';

export type XAIRuntime = {
  bearerToken?: string;
  baseUrl: string;
  auth: 'oauth' | 'api_key' | 'none';
  accountId?: string;
};

function getProviderConfig(): Record<string, any> {
  return getConfiguredProviderConfig('xai');
}

function resolveSecret(value: unknown): string | undefined {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  if (raw.startsWith('env:')) return String(process.env[raw.slice(4)] || '').trim() || undefined;
  return String(getConfig().resolveSecret(raw) || '').trim() || undefined;
}

function getApiKey(): string | undefined {
  const providerCfg = getProviderConfig();
  return resolveSecret(providerCfg.api_key) || process.env.XAI_API_KEY;
}

function getApiBase(fallbackBaseUrl: string): string {
  const providerCfg = getProviderConfig();
  const configured = String(
    providerCfg.endpoint
    || process.env.PROMETHEUS_XAI_BASE_URL
    || process.env.XAI_BASE_URL
    || process.env.HERMES_XAI_BASE_URL
    || fallbackBaseUrl
    || '',
  ).trim();
  return (configured || fallbackBaseUrl).replace(/\/+$/, '');
}

function getExplicitAuthMode(): 'oauth' | 'api_key' | '' {
  const providerCfg = getProviderConfig();
  const explicit = String(providerCfg.auth_mode || providerCfg.authType || '').trim().toLowerCase();
  if (explicit.startsWith('oauth')) return 'oauth';
  if (explicit === 'api_key' || explicit === 'apikey' || explicit === 'api-key') return 'api_key';
  return '';
}

/**
 * Resolve xAI credentials through the same account pool used by chat and
 * realtime voice. This intentionally falls back to the legacy vault key when
 * a selected named account has not been migrated yet.
 */
export async function resolveXAIMediaRuntime(fallbackBaseUrl: string): Promise<XAIRuntime> {
  const providerCfg = getProviderConfig();
  // auth_mode is a preference, not a filter. It used to hard-exclude the other
  // auth type, so a stale `auth_mode: "api_key"` with an empty key blocked a
  // connected OAuth account and media_generate reported "provider xai is not
  // available" while Grok chat and x_search (which use the full pool) worked.
  const explicitMode = getExplicitAuthMode();
  const preferredAccountId = String(providerCfg.accountId || '').trim() || undefined;

  let candidates: Awaited<ReturnType<typeof getXaiAuthCandidates>> = [];
  try {
    candidates = await getXaiAuthCandidates(preferredAccountId);
  } catch {
    candidates = [];
  }
  const oauthCandidates = candidates.filter((candidate) => candidate.auth === 'xai_oauth');
  const keyCandidates = candidates.filter((candidate) => candidate.auth === 'api_key');

  const tryOAuth = async (): Promise<XAIRuntime | null> => {
    for (const candidate of oauthCandidates) {
      try {
        const credentials = await getValidXAIRuntimeCredentials(getConfig().getConfigDir(), candidate.accountId);
        const bearerToken = String(credentials.api_key || '').trim();
        if (!bearerToken) continue;
        return {
          bearerToken,
          baseUrl: String(credentials.base_url || getApiBase(fallbackBaseUrl)).replace(/\/+$/, ''),
          auth: 'oauth',
          accountId: candidate.accountId,
        };
      } catch {
        // A stale account must not block the remaining candidates.
      }
    }
    return null;
  };

  const tryApiKey = (): XAIRuntime | null => {
    const apiKey = getApiKey() || keyCandidates[0]?.token;
    if (!apiKey) return null;
    return {
      bearerToken: apiKey,
      baseUrl: getApiBase(fallbackBaseUrl),
      auth: 'api_key',
      accountId: getApiKey() ? undefined : keyCandidates[0]?.accountId,
    };
  };

  // OAuth (the connected xAI login) always wins; an API key is only a fallback.
  // `auth_mode: "oauth"` additionally disables the key fallback.
  const oauth = await tryOAuth();
  if (oauth) return oauth;
  if (explicitMode !== 'oauth') {
    const keyed = tryApiKey();
    if (keyed) return keyed;
  }
  return { baseUrl: getApiBase(fallbackBaseUrl), auth: 'none' };
}
