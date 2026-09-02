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
  const explicitMode = getExplicitAuthMode();
  const preferredAccountId = String(providerCfg.accountId || '').trim() || undefined;

  if (explicitMode !== 'api_key') {
    const candidates = await getXaiAuthCandidates(preferredAccountId);
    const oauthCandidate = candidates.find((candidate) => candidate.auth === 'xai_oauth');
    if (oauthCandidate) {
      const credentials = await getValidXAIRuntimeCredentials(
        getConfig().getConfigDir(),
        oauthCandidate.accountId,
      );
      return {
        bearerToken: credentials.api_key,
        baseUrl: credentials.base_url.replace(/\/+$/, ''),
        auth: 'oauth',
        accountId: oauthCandidate.accountId,
      };
    }
  }

  if (explicitMode !== 'oauth') {
    const apiKey = getApiKey();
    if (apiKey) {
      return { bearerToken: apiKey, baseUrl: getApiBase(fallbackBaseUrl), auth: 'api_key' };
    }
  }

  return { baseUrl: getApiBase(fallbackBaseUrl), auth: 'none' };
}
