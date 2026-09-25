// Extension runtime bootstrap (formerly legacy-connector-adapter.ts).
//
// Every connector is a native runtime.ts module under bundled/connectors/<id>/.
// This file only:
//   1. loads bundled/user extension modules into the runtime registry
//      (loadManifestRuntimeExtensions), once per process or after reload;
//   2. registers the xAI connector STATUS record (x_search itself is registered
//      by xai-extension-adapter.ts from auth state);
//   3. refreshes xAI tool registration on a short TTL + a warn-only
//      manifest/registry consistency check.
import { X_SEARCH_TOOL_NAME } from '../gateway/tools/defs/xai-tools.js';
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
    // xai_live_search is retired and intentionally unregistered; listing it
    // here made connector_list report a false "1/2 registered, 1 missing".
    toolNames: [X_SEARCH_TOOL_NAME],
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
