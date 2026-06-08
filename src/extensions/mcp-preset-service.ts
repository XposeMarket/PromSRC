// Registry-backed MCP preset service. Presets (their launch config) live in the
// extension registry (registered from mcp_preset manifests at load — see
// runtime-loader). This module turns a preset id + user-supplied credentials into
// a concrete MCP server config the MCP manager can launch, and lists presets for
// quick-setup / the Connections UI. One source of truth, no hardcoded preset list.
import { getExtensionRuntimeRegistry } from './runtime-registry.js';

export interface McpPresetSummary {
  id: string;
  name: string;
  transport: string;
  /** Credential field keys the user must supply (from manifest setup.fields). */
  credentialFields: Array<{ key: string; label?: string; required?: boolean; secret?: boolean }>;
}

export interface BuiltMcpServerConfig {
  id: string;
  transport: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** List all known MCP presets (bundled + user-installed) from the registry. */
export function listMcpPresets(): McpPresetSummary[] {
  return getExtensionRuntimeRegistry()
    .listMcpPresets()
    .map((preset) => {
      const config = asRecord(preset.config);
      const setup = asRecord(config.setup);
      const fields = Array.isArray(setup.fields) ? (setup.fields as any[]) : [];
      return {
        id: preset.id,
        name: preset.name,
        transport: String(config.transport || 'stdio'),
        credentialFields: fields.map((f) => ({ key: String(f?.key || ''), label: f?.label, required: f?.required, secret: f?.secret })).filter((f) => f.key),
      };
    });
}

/**
 * Resolve `{{credential:<presetId>:<field>}}` placeholders and empty-string env
 * slots against the supplied credentials. Returns a concrete server config or
 * throws when the preset id is unknown.
 */
export function buildMcpServerConfigFromPreset(presetId: string, credentials: Record<string, string> = {}): BuiltMcpServerConfig {
  const preset = getExtensionRuntimeRegistry().getMcpPreset(presetId);
  if (!preset) throw new Error(`Unknown MCP preset: ${presetId}`);
  const config = asRecord(preset.config);

  const resolve = (raw: string): string => {
    let out = String(raw ?? '');
    out = out.replace(/\{\{\s*credential:([^:}]+):([^}]+)\s*\}\}/g, (_m, _pid, field) => credentials[String(field).trim()] ?? '');
    return out;
  };

  const built: BuiltMcpServerConfig = {
    id: preset.id,
    transport: String(config.transport || 'stdio'),
  };

  if (config.command) built.command = String(config.command);
  if (Array.isArray(config.args)) built.args = config.args.map((a) => resolve(String(a)));

  const envTemplate = asRecord(config.envTemplate);
  if (Object.keys(envTemplate).length) {
    built.env = {};
    for (const [key, tpl] of Object.entries(envTemplate)) {
      const tplStr = String(tpl ?? '');
      // Empty template slot → fill directly from a credential of the same key.
      built.env[key] = tplStr ? resolve(tplStr) : (credentials[key] ?? '');
    }
  }

  if (config.urlTemplate) built.url = resolve(String(config.urlTemplate));
  const headersTemplate = asRecord(config.headersTemplate);
  if (Object.keys(headersTemplate).length) {
    built.headers = {};
    for (const [key, tpl] of Object.entries(headersTemplate)) built.headers[key] = resolve(String(tpl ?? ''));
  }

  return built;
}
