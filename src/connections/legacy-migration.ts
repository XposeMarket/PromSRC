import { loadSavedConnections } from '../integrations/connection-state';
import { getConnectorStatuses } from '../integrations/connector-registry';
import type { ConnectionStore } from './connection-store';

/** One-way compatibility projection. Legacy sources remain readable until each
 * connector is migrated, but new lifecycle updates are written only to v2. */
export function migrateLegacyConnections(store: ConnectionStore): { migrated: string[] } {
  const migrated: string[] = [];
  let saved: Record<string, any> = {};
  let statuses: Record<string, any> = {};
  try { saved = loadSavedConnections(); } catch {}
  try { statuses = getConnectorStatuses(); } catch {}
  const ids = new Set([...Object.keys(saved), ...Object.keys(statuses)]);
  for (const serviceId of ids) {
    if (store.findByService(serviceId).length) continue;
    const savedState = saved[serviceId] || {};
    const status = statuses[serviceId] || {};
    const authenticated = status.connected === true || savedState.connected === true;
    const configured = authenticated || status.hasCredentials === true;
    if (!configured) continue;
    store.create({
      serviceId, serviceName: serviceId, pluginId: serviceId, strategyId: 'legacy-compatibility', adapterId: 'legacy',
      installed: true, enabled: true, configured, authenticated, registered: false, exposed: false, verified: false,
      authState: authenticated ? 'healthy' : 'none', health: authenticated ? 'unknown' : 'unavailable',
      grantedCapabilities: [], registeredTools: [], exposedTools: [],
      configuration: { migratedFrom: 'legacy', authType: status.authType || savedState.authType },
    });
    migrated.push(serviceId);
  }
  return { migrated };
}
