import type { ConnectionRecord } from './types.js';
/** Explicit allowlist: no vault references, transport config, tokens or grants in general account discovery. */
export function publicAccountView(record: ConnectionRecord) {
  return {
    id: record.id, serviceId: record.serviceId, pluginId: record.pluginId,
    label: record.accountAccess?.label || record.serviceName || record.serviceId,
    family: record.accountAccess?.family, enabled: record.enabled, authenticated: record.authenticated,
    authState: record.authState, health: record.health,
    account: record.account ? { provider: record.account.provider, providerAccountId: record.account.providerAccountId,
      email: record.account.email, username: record.account.username, displayName: record.account.displayName } : undefined,
    generation: record.accountAccess?.generation,
  };
}
