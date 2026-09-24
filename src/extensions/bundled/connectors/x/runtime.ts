// Native X / Twitter connector runtime (X API v2, OAuth 2.0 user context).
// Previously these 50 x_api_* tools were defined in core gateway files and
// bridged in by xai-extension-adapter.ts; they now live here like every other
// connector. Auth stays in src/auth/x-api-oauth.ts.
import { getXApiOAuthStatus } from '../../../../auth/x-api-oauth.js';
import type { PrometheusExtensionApi, PrometheusExtensionDefinition } from '../../../runtime-api.js';
import { executeXApiTool } from './x-api-client.js';
import { getXApiToolDefs, X_API_REQUEST_TOOL_NAME, X_API_TOOL_NAMES } from './x-api-tools.js';

const ID = 'x';
const NAME = 'X / Twitter';

function status() {
  const { getConfig } = require('../../../../config/config') as typeof import('../../../../config/config');
  return getXApiOAuthStatus(getConfig().getConfigDir());
}

const ext: PrometheusExtensionDefinition = {
  id: ID,
  register(api: PrometheusExtensionApi) {
    api.registerConnector({
      id: ID,
      name: NAME,
      authType: 'oauth',
      capabilities: ['social', 'publishing', 'official_api'],
      toolNames: X_API_TOOL_NAMES,
      isConnected: () => status().connected,
      hasCredentials: () => { const s = status(); return !!(s.credentialsConfigured || s.connected); },
      describeStatus: () => {
        const s = status();
        return s.connected
          ? `X API OAuth user context${s.username ? ` (@${s.username})` : ''}; ${X_API_TOOL_NAMES.length} X API tool(s), including ${X_API_REQUEST_TOOL_NAME}`
          : s.credentialsConfigured
            ? 'X Developer app credentials saved; authorize OAuth user context'
            : 'not connected';
      },
    });

    // Tools stay registered; the registry hides them while the connector is
    // disconnected (isToolAvailable / listConnectedConnectorToolDefinitions).
    for (const definition of getXApiToolDefs()) {
      const fn = definition?.function;
      const name = String(fn?.name || '').trim();
      if (!name) continue;
      api.registerTool({
        name,
        description: String(fn?.description || ''),
        parameters: fn?.parameters || { type: 'object', required: [], properties: {} },
        connectorId: ID,
        capability: 'social',
        execute: async (args: any) => {
          const out = await executeXApiTool(name, args || {});
          return {
            result: out.success ? JSON.stringify(out.data || {}, null, 2) : `${name} failed: ${out.error || 'unknown error'}`,
            error: !out.success,
            data: out,
          } as any;
        },
      });
    }
  },
};

export default ext;
