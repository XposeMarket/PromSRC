import { ConnectionStore } from './connection-store.js';
import { resolveBoundPluginCredential } from './plugin-credential-binding.js';
import { resolveMcpAccountTransport } from './mcp-account-transport.js';
import { buildMcpServerConfigFromPreset, listMcpPresets } from '../extensions/mcp-preset-service.js';
import { ensurePrometheusExtensionRuntimeLoaded } from '../extensions/extension-bootstrap.js';

/** Returns launch-only configuration. Callers must never persist or expose this value. */
export function resolveProtectedMcpLaunch(configDir: string, instanceId: string) {
  if (!instanceId.startsWith('account_')) return undefined;
  ensurePrometheusExtensionRuntimeLoaded();
  const store = new ConnectionStore(configDir);
  return resolveMcpAccountTransport(instanceId, {
    readConnection: id => store.get(id),
    readFields: record => {
      const preset = listMcpPresets().find(item => item.id === record.pluginId);
      if (!preset) throw new Error('MCP_ACCOUNT_TEMPLATE_UNAVAILABLE');
      const fields: Record<string, string> = {};
      for (const field of preset.credentialFields) {
        const value = resolveBoundPluginCredential(configDir, record.serviceId, field.key, record.id).value;
        if (value !== undefined) fields[field.key] = value;
        else if (field.required) throw new Error('MCP_ACCOUNT_INPUT_UNAVAILABLE');
      }
      return fields;
    },
    build: buildMcpServerConfigFromPreset,
  });
}
