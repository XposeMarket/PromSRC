import { getConfig } from '../config/config.js';
import { getVault } from '../security/vault.js';

/**
 * Resolve a single saved credential field for a connector.
 *
 * Lookup order:
 *   1. Vault key `integration.<connectorId>.credentials` (JSON of all fields
 *      saved through the Connections panel credential form).
 *   2. Vault key `integration.<connectorId>.oauth_tokens` (for OAuth connectors,
 *      e.g. an `access_token` field).
 *   3. Process env (uppercased `<CONNECTORID>_<FIELDKEY>`), useful for headless
 *      / Docker deploys that inject secrets via env.
 *
 * Returns undefined when nothing is found. Never throws — credential lookups
 * happen inside tool execution and must degrade gracefully.
 */
export function resolveConnectorCredential(
  connectorId: string,
  fieldKey: string,
): string | undefined {
  const id = String(connectorId || '').trim();
  const key = String(fieldKey || '').trim();
  if (!id || !key) return undefined;

  const configDir = getConfig().getConfigDir();

  for (const vaultKey of [
    `integration.${id}.credentials`,
    `integration.${id}.oauth_tokens`,
  ]) {
    try {
      const secret = getVault(configDir).get(vaultKey, `extension:getCredential:${id}`);
      if (!secret) continue;
      const parsed = JSON.parse(secret.expose());
      const value = parsed?.[key];
      if (typeof value === 'string' && value.trim()) return value;
    } catch {
      // malformed/unset vault entry — fall through to the next source
    }
  }

  const envKey = `${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_${key.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
  const envVal = String(process.env[envKey] || '').trim();
  if (envVal) return envVal;

  return undefined;
}
