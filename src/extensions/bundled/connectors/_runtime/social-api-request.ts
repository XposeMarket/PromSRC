import type { PrometheusExtensionApi } from '../../../runtime-api.js';
import { resolveConnectorCredential } from '../../../credential-access.js';
import { registerConnectorApiRequestTool } from './api-request.js';

// Browser cookies are NOT API credentials. These optional tools use a provider
// access_token saved in the secure credential store (or <ID>_ACCESS_TOKEN).
// Browser-session setup remains unchanged; no cookies are exported or scraped.
export function registerSocialApiRequest(api: PrometheusExtensionApi, id: string, name: string, base: string, examplePath: string, headers?: Record<string, string>, credential = () => resolveConnectorCredential(id, 'access_token')): void {
  api.registerConnector({
    id, name, authType: 'browser_session', capabilities: ['social', 'api'],
    toolNames: [`connector_${id}_api_request`],
    isConnected: () => Boolean(credential()),
    hasCredentials: () => Boolean(credential()),
    describeStatus: () => credential() ? 'API token configured; browser login is separate' : 'API requires a provider access_token; browser login is separate',
  });
  registerConnectorApiRequestTool(api, {
    connectorId: id, displayName: name, bases: { api: base }, examplePath, headers,
    coverageHint: 'provider-approved endpoints and scopes; requires a separately saved API access_token, not browser cookies',
    getConnector: () => { const token = credential(); return token ? { token } : undefined; },
    getToken: async (c: { token: string }) => c.token,
  });
}
