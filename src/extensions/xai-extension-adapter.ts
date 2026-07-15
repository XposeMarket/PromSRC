import { isXAIConnected } from '../auth/xai-oauth.js';
import { getXApiOAuthStatus } from '../auth/x-api-oauth.js';
import { getXAIToolDefs } from '../gateway/tools/defs/xai-tools.js';
import {
  getEffectiveXaiApiKey,
  handleXAISearchTool,
} from '../gateway/tools/handlers/xai-handlers.js';
import { getConfig } from '../config/config.js';
import { getExtensionRuntimeRegistry } from './runtime-registry.js';

function configDir(): string {
  return getConfig().getConfigDir();
}

export function hasXAIConfiguredCredentials(): boolean {
  try {
    if (isXAIConnected(configDir())) return true;
  } catch {}
  return !!process.env.XAI_API_KEY || !!getEffectiveXaiApiKey();
}

function refreshToolRegistrySnapshot(): void {
  try {
    const registryModule = require('../tools/registry.js') as typeof import('../tools/registry.js');
    registryModule.refreshExtensionTools?.();
  } catch {}
}

export function refreshXAITools(): void {
  const registry = getExtensionRuntimeRegistry();
  const hasXaiCredentials = hasXAIConfiguredCredentials();
  const hasXApiCredentials = getXApiOAuthStatus(configDir()).connected;
  let changed = false;

  // xai_live_search is intentionally absent: xAI retired the Live Search endpoint.
  registry.unregisterTool('xai_live_search', 'xai');
  for (const definition of getXAIToolDefs()) {
    const fn = definition?.function;
    const name = String(fn?.name || '').trim();
    if (!name) continue;
    const isXApiTool = name.startsWith('x_api_');
    const shouldRegister = isXApiTool ? hasXApiCredentials : hasXaiCredentials;

    if (shouldRegister && !registry.getTool(name)) {
      registry.registerTool('xai', {
        name,
        description: String(fn?.description || ''),
        parameters: fn?.parameters || { type: 'object', required: [], properties: {} },
        connectorId: isXApiTool ? 'x' : 'xai',
        capability: 'social',
        execute: async (args) => handleXAISearchTool(name, args),
      });
      changed = true;
    } else if (!shouldRegister && registry.unregisterTool(name, 'xai')) {
      changed = true;
    }
  }

  if (changed) refreshToolRegistrySnapshot();
}
