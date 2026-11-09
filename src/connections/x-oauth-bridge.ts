import { getConfig } from '../config/config';
import { getXApiOAuthStatus, startXApiOAuthFlowBackground, pollXApiOAuthBackground, clearXApiTokens, cancelXApiOAuthFlow, getValidXApiToken } from '../auth/x-api-oauth';
import type { ConnectorOAuthBridge } from './adapters/connector-oauth';

/** Reuses the existing PKCE implementation; browser cookies never count as API access. */
export function buildXOAuthBridge(): ConnectorOAuthBridge {
  const dir = () => getConfig().getConfigDir();
  return {
    id: 'x', name: 'X / Twitter',
    isConnected: () => getXApiOAuthStatus(dir()).connected,
    start: async (_account, _scopes, attemptId) => startXApiOAuthFlowBackground(dir(), { openBrowser: false, attemptId }) as any,
    poll: async (attemptId) => { const result = pollXApiOAuthBackground(attemptId); return result.done ? { success: !!result.success, error: result.error } : null; },
    metadata: async () => {
      const s = getXApiOAuthStatus(dir());
      return { account: { providerAccountId: s.user_id, username: s.username }, grantedScopes: s.scopes,
        refreshAvailable: !!s.refresh_available, clientIdConfigured: s.credentialsConfigured, clientSecretConfigured: s.credentialsConfigured };
    },
    verify: async () => {
      const token = await getValidXApiToken(dir());
      const response = await fetch('https://api.x.com/2/users/me?user.fields=username,name', {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000), redirect: 'error',
      });
      if (!response.ok) throw new Error(`X account verification failed (HTTP ${response.status}).`);
      const body = await response.json() as any;
      if (!body?.data?.id) throw new Error('X account verification returned no identity.');
      return { account: { provider: 'x', providerAccountId: String(body.data.id), username: body.data.username, displayName: body.data.name } };
    },
    cancel: (attemptId) => cancelXApiOAuthFlow(attemptId),
    clear: () => { cancelXApiOAuthFlow(); clearXApiTokens(dir()); },
  };
}
