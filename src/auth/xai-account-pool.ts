import { getConfig } from '../config/config';
import { getValidXAIToken, isXAIConnected } from './xai-oauth';

export type XAIAuthCandidate = {
  token: string;
  auth: 'xai_oauth' | 'api_key';
  accountId?: string;
  label: string;
};

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

export function orderXaiAccountIds(
  accounts: Record<string, any>,
  preferredAccountId?: string,
  defaultAccountId?: string,
): string[] {
  const ordered: string[] = [];
  const push = (value: unknown) => {
    const id = String(value || '').trim();
    if (id && accounts[id] && !ordered.includes(id)) ordered.push(id);
  };
  push(preferredAccountId);
  push(defaultAccountId);
  for (const id of Object.keys(accounts)) push(id);
  return ordered;
}

function resolveSecret(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('env:')) return String(process.env[raw.slice(4)] || '').trim();
  try {
    return String(getConfig().resolveSecret(raw) || '').trim();
  } catch {
    return '';
  }
}

function looksLikeXaiApiKey(value: string): boolean {
  return /^xai-[A-Za-z0-9_-]+/.test(String(value || '').trim());
}

function xaiConfig(): { configDir: string; provider: Record<string, any>; preferredAccountId?: string } {
  const manager = getConfig();
  const cfg = manager.getConfig() as any;
  const provider = record(cfg?.llm?.providers?.xai);
  const preferredAccountId = String(cfg?.llm?.provider || '') === 'xai'
    ? String(cfg?.llm?.accountId || '').trim() || undefined
    : undefined;
  return { configDir: manager.getConfigDir(), provider, preferredAccountId };
}

export function getConfiguredXaiCredentialSummary(): { configured: boolean; oauthConfigured: boolean; apiKeyConfigured: boolean } {
  const { configDir, provider } = xaiConfig();
  const accounts = record(provider.accounts);
  let oauthConfigured = false;
  let apiKeyConfigured = false;
  for (const accountId of Object.keys(accounts)) {
    if (isXAIConnected(configDir, accountId)) oauthConfigured = true;
    if (looksLikeXaiApiKey(resolveSecret(record(accounts[accountId]).api_key))) apiKeyConfigured = true;
  }
  if (isXAIConnected(configDir)) oauthConfigured = true;
  const topLevelKey = String(process.env.XAI_API_KEY || resolveSecret(provider.api_key) || '').trim();
  if (looksLikeXaiApiKey(topLevelKey)) apiKeyConfigured = true;
  return { configured: oauthConfigured || apiKeyConfigured, oauthConfigured, apiKeyConfigured };
}

export function hasConfiguredXaiCredentials(): boolean {
  return getConfiguredXaiCredentialSummary().configured;
}

export async function getXaiAuthCandidates(preferredAccountId?: string): Promise<XAIAuthCandidate[]> {
  const state = xaiConfig();
  const accounts = record(state.provider.accounts);
  const orderedIds = orderXaiAccountIds(
    accounts,
    preferredAccountId || state.preferredAccountId,
    String(state.provider.defaultAccountId || '').trim(),
  );
  const candidates: XAIAuthCandidate[] = [];
  const seen = new Set<string>();
  const push = (candidate: XAIAuthCandidate) => {
    const token = String(candidate.token || '').trim();
    if (!token || seen.has(token)) return;
    seen.add(token);
    candidates.push({ ...candidate, token });
  };

  for (const accountId of orderedIds) {
    const account = record(accounts[accountId]);
    const label = String(account.label || accountId).trim() || accountId;
    if (isXAIConnected(state.configDir, accountId)) {
      try {
        push({ token: await getValidXAIToken(state.configDir, accountId), auth: 'xai_oauth', accountId, label });
      } catch {
        // A stale account must not prevent the remaining accounts from being tried.
      }
    }
    const apiKey = resolveSecret(account.api_key);
    if (looksLikeXaiApiKey(apiKey)) push({ token: apiKey, auth: 'api_key', accountId, label });
  }

  // Backward compatibility for installations that predate named accounts.
  if (isXAIConnected(state.configDir)) {
    try {
      push({ token: await getValidXAIToken(state.configDir), auth: 'xai_oauth', label: 'Legacy xAI account' });
    } catch {}
  }
  const topLevelKey = String(process.env.XAI_API_KEY || resolveSecret(state.provider.api_key) || '').trim();
  if (looksLikeXaiApiKey(topLevelKey)) push({ token: topLevelKey, auth: 'api_key', label: 'xAI API key' });
  return candidates;
}

export function isXaiCredentialFailure(status: number, responseText = ''): boolean {
  if ([401, 402, 403, 408, 409, 429].includes(Number(status)) || Number(status) >= 500) return true;
  return /(?:insufficient|exhausted|out of)\s+(?:credits?|quota)|(?:credits?|quota|balance|billing).{0,80}(?:insufficient|exhausted|empty|limit|required|too low)/i.test(responseText);
}
