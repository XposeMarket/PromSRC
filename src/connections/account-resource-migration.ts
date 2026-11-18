import { createHash } from 'node:crypto';
import type { ConnectionStore } from './connection-store.js';
import { loadObsidianBridgeState } from '../gateway/obsidian/bridge.js';
import { getExtensionDescriptor } from '../extensions/registry.js';
import { getDeclaredExtensionTools } from '../extensions/tool-contracts.js';

/** Owner-only migration. Each complete vault record is one atomic write; retries never reactivate it. */
export function adoptLegacyObsidianAccounts(store: ConnectionStore, legacyId: string, ownerId: string): void {
  const legacy = store.get(legacyId);
  if (!ownerId || !legacy || legacy.serviceId !== 'obsidian' || legacy.accountAccess) throw new Error('ACCOUNT_UNAVAILABLE');
  const vaults = loadObsidianBridgeState().vaults.filter(vault => vault.enabled !== false);
  if (!vaults.length) throw new Error('ACCOUNT_RESOURCE_UNAVAILABLE');
  const tools = getDeclaredExtensionTools(getExtensionDescriptor('obsidian'));
  // Check every prior identity before publishing any new resource on a retry.
  for (const vault of vaults) {
    const id = `connection_${createHash('sha256').update(JSON.stringify(['obsidian',legacyId,vault.id])).digest('hex').slice(0,32)}`;
    const prior = store.get(id);
    if (prior && (prior.accountAccess?.ownerId !== ownerId || prior.configuration?.resourceId !== vault.id)) throw new Error('ACCOUNT_UNAVAILABLE');
  }
  for (const vault of vaults) {
    const id = `connection_${createHash('sha256').update(JSON.stringify(['obsidian',legacyId,vault.id])).digest('hex').slice(0,32)}`;
    const prior = store.get(id);
    if (prior) {
      if (prior.accountAccess?.ownerId !== ownerId || prior.configuration?.resourceId !== vault.id) throw new Error('ACCOUNT_UNAVAILABLE');
      continue;
    }
    store.create({id,serviceId:'obsidian',serviceName:'Obsidian',pluginId:'obsidian',strategyId:'obsidian-local-vault',adapterId:'local-resource',
      installed:true,enabled:true,configured:true,authenticated:true,authState:'healthy',registered:true,exposed:true,verified:false,health:'unknown',
      grantedCapabilities:[],registeredTools:tools,exposedTools:tools,
      accountAccess:{ownerId,label:vault.name,family:'resource',instanceId:id,generation:1,policyRevision:1},
      configuration:{path:vault.path,resourceId:vault.id,resourceKind:'directory'},
      account:{provider:'obsidian',providerAccountId:vault.id,displayName:vault.name}});
  }
  store.update(legacy.id,{enabled:false,authenticated:false,exposed:false,authState:'none'});
}
