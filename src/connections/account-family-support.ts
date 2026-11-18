import { nativeAccountConnectorIds } from '../integrations/connector-instances.js';
export interface AccountFamilySupport { mode: 'account' | 'instance' | 'existing-model-connection' | 'gated'; reason?: string; }
/** Explicit capability declaration. Gated families must not silently mutate singleton credentials. */
export function accountFamilySupport(kind: string, serviceId: string, adapterId?: string): AccountFamilySupport {
  if (kind === 'provider') return { mode: 'existing-model-connection' };
  if (kind === 'mcp_preset') return { mode: 'instance' };
  if (adapterId === 'mcp-oauth' || adapterId === 'mcp-stdio' || adapterId === 'mcp-http') return { mode: 'gated', reason: 'Custom/imported MCP needs an explicit safe transport template; credentials and resource paths must not be copied from another instance.' };
  if (kind === 'connector' && (serviceId === 'vercel' || serviceId === 'obsidian' || nativeAccountConnectorIds.includes(serviceId))) return { mode: 'account' };
  return { mode: 'gated', reason: 'This adapter has not yet verified independent account/profile/resource lifecycle. Existing connection is preserved; adding an identity is disabled.' };
}
