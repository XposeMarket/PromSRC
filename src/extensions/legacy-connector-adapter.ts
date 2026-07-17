// Extension runtime bootstrap + narrow X/xAI bridge.
//
// Historically this file mirrored hardcoded connector maps/handlers into the
// extension registry. That legacy is gone: every connector_* connector is now a
// native runtime.ts module (see §23B). What remains is:
//   1. loadManifestRuntimeExtensions() — load native bundled/user extension modules
//   2. the X and xAI connector STATUS records, whose tools are registered by
//      xai-extension-adapter.ts (x_api_* / x_search / xai_live_search) rather than
//      by a native connector module — so their records live here for now
//   3. refreshXAITools() + a warn-only consistency check
import {
  X_API_REQUEST_TOOL_NAME,
  X_SEARCH_TOOL_NAME,
  XAI_LIVE_SEARCH_TOOL_NAME,
  XAI_TOOL_NAMES,
} from '../gateway/tools/defs/xai-tools.js';
import { getXApiOAuthStatus } from '../auth/x-api-oauth.js';
import { getConfig } from '../config/config.js';
import { logExtensionConsistencyOnce } from './consistency.js';
import { getExtensionRuntimeRegistry } from './runtime-registry.js';
import { loadManifestRuntimeExtensions } from './runtime-loader.js';
import { hasXAIConfiguredCredentials, refreshXAITools } from './xai-extension-adapter.js';

let loaded = false;
let lastCredentialRefreshAt = 0;
const CREDENTIAL_REFRESH_TTL_MS = 5_000;

function registerXConnectorRecords(): void {
  const registry = getExtensionRuntimeRegistry();

  const xToolNames = XAI_TOOL_NAMES.filter((name) => name.startsWith('x_api_'));
  const getXStatus = () => getXApiOAuthStatus(getConfig().getConfigDir());
  registry.registerConnector('x', {
    id: 'x',
    name: 'X / Twitter',
    authType: 'oauth',
    capabilities: registry.getExtension('x')?.contracts?.capabilities || ['social', 'publishing', 'official_api'],
    toolNames: xToolNames,
    isConnected: () => getXStatus().connected,
    hasCredentials: () => getXStatus().credentialsConfigured || getXStatus().connected,
    describeStatus: () => {
      const status = getXStatus();
      return status.connected
        ? `X API OAuth user context${status.username ? ` (@${status.username})` : ''}; ${xToolNames.length} X API tool(s), including ${X_API_REQUEST_TOOL_NAME}`
        : status.credentialsConfigured
          ? 'X Developer app credentials saved; authorize OAuth user context'
          : 'not connected';
    },
  });

  registry.registerConnector('xai', {
    id: 'xai',
    name: 'xAI / Grok',
    authType: 'oauth',
    capabilities: registry.getExtension('xai')?.contracts?.capabilities || ['search', 'social'],
    toolNames: [X_SEARCH_TOOL_NAME, XAI_LIVE_SEARCH_TOOL_NAME],
    isConnected: () => hasXAIConfiguredCredentials(),
    hasCredentials: () => hasXAIConfiguredCredentials(),
    describeStatus: () => (hasXAIConfiguredCredentials() ? 'xAI/Grok credentials configured' : 'not connected'),
  });
}

export function resetPrometheusExtensionRuntimeLoaded(): void {
  loaded = false;
  lastCredentialRefreshAt = 0;
}

export function ensurePrometheusExtensionRuntimeLoaded(): void {
  if (!loaded) {
    loadManifestRuntimeExtensions();
    registerXConnectorRecords();
    loaded = true;
  }
  // X/xAI records depend on auth state initialized at gateway startup; refresh on
  // a short bounded cadence. Tool surfaces are rebuilt repeatedly inside a turn;
  // re-decrypting OAuth state for each rebuild blocks the gateway event loop.
  const now = Date.now();
  if (now - lastCredentialRefreshAt >= CREDENTIAL_REFRESH_TTL_MS) {
    refreshXAITools();
    lastCredentialRefreshAt = now;
  }
  // Warn-only guardrail (logs once): catches manifest/registry drift.
  logExtensionConsistencyOnce();
}
