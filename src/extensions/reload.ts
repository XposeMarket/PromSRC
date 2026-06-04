import path from 'path';
import { clearExtensionRegistryCache } from './registry.js';
import {
  clearExtensionRuntimeRegistry,
  getExtensionRuntimeRegistry,
} from './runtime-registry.js';
import {
  ensurePrometheusExtensionRuntimeLoaded,
  resetPrometheusExtensionRuntimeLoaded,
} from './legacy-connector-adapter.js';
import { resolveUserPluginsDir } from './loader.js';

/**
 * Drop cached `require()` entries for any module that lives under the user
 * plugins dir. Without this, editing or reinstalling a user plugin's index.js
 * would keep executing the stale code that Node cached on first require.
 */
function bustUserPluginRequireCache(): void {
  const userDir = path.resolve(resolveUserPluginsDir());
  for (const key of Object.keys(require.cache)) {
    if (path.resolve(key).startsWith(userDir)) {
      delete require.cache[key];
    }
  }
}

/**
 * Full hot-reload of the extension system. Used after a user (or Prometheus
 * itself) installs, edits, or removes a plugin so the new tool/connector
 * surface is live without restarting the app.
 *
 * Order matters: tear down the runtime registry and loaded flag first, bust the
 * module cache, clear the descriptor cache, then re-run discovery from disk.
 */
export function reloadExtensions(): { connectors: number; tools: number } {
  clearExtensionRuntimeRegistry();
  resetPrometheusExtensionRuntimeLoaded();
  bustUserPluginRequireCache();
  clearExtensionRegistryCache();

  // Re-run manifest discovery + runtime module loading from disk.
  ensurePrometheusExtensionRuntimeLoaded();

  const registry = getExtensionRuntimeRegistry();
  return {
    connectors: registry.listConnectors().length,
    tools: registry.listTools().length,
  };
}
