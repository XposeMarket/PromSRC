// Extension runtime bootstrap + narrow X/xAI bridge.
//
// Historically this file mirrored hardcoded connector maps/handlers into the
// extension registry. That legacy is gone: every connector_* connector is now a
// native runtime.ts module (see Â§23B). What remains is:
//   1. loadManifestRuntimeExtensions() â€” load native bundled/user extension modules
//   2. the xAI connector STATUS record, whose x_search tool is registered by
//      xai-extension-adapter.ts. X (x_api_*) is a native connector module now
//      (connectors/x/runtime.ts).
//   3. refreshXAITools() + a warn-only consistency check
import {
  X_SEARCH_TOOL_NAME,
  XAI_LIVE_SEARCH_TOOL_NAME,
} from '../gateway/tools/defs/xai-tools.js';
import { getConfig } from '../config/config.js';
import { logExtensionConsistencyOnce } from './consistency.js';
import { getExtensionRuntimeRegistry } from './runtime-registry.js';
import { loadManifestRuntimeExtensions } from './runtime-loader.js';
import { hasXAIConfiguredCredentials, refreshXAITools } from './xai-extension-adapter.js';

let loaded = false;
let lastCredentialRefreshAt = 0;
const CREDENTIAL_REFRESH_TTL_MS = 5_000;

function registerXaiConnectorRecord(): void {
  const registry = getExtensionRuntimeRegistry();

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
    registerXaiConnectorRecord();
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
