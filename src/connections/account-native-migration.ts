import type { ConnectionStore } from './connection-store.js';
import type { OAuthConnector } from '../integrations/oauth-base.js';
import type { ConnectorInstanceRegistry } from '../integrations/connector-instances.js';

/** Explicit host-owned migration. Does not revoke/delete legacy secrets or contact a provider.
 * Token copy precedes metadata publication; interrupted copies can be retried at the same ID.
 */
export function adoptLegacyNativeAccount(store: ConnectionStore, instances: ConnectorInstanceRegistry,
  recordId: string, ownerId: string, legacy: OAuthConnector): string {
  const record = store.get(recordId);
  if (!record || !ownerId) throw new Error('ACCOUNT_UNAVAILABLE');
  if (record.accountAccess) {
    if (record.accountAccess.ownerId !== ownerId) throw new Error('ACCOUNT_UNAVAILABLE');
    return record.id;
  }
  if (legacy.credentialReference() !== `vault:integration.${record.serviceId}.oauth_tokens`) throw new Error('ACCOUNT_SERVICE_MISMATCH');
  const tokens = legacy.loadTokens();
  if (!tokens?.access_token) throw new Error('ACCOUNT_REAUTH_REQUIRED');
  const client = instances.get(record.serviceId, record.id);
  // A failed earlier metadata write may have left a staged copy. Do not replace it blindly.
  const staged = client.loadTokens();
  if (staged && JSON.stringify(staged) !== JSON.stringify(tokens)) throw new Error('ACCOUNT_MIGRATION_CONFLICT');
  if (!staged) client.saveTokens(tokens);
  if (!client.loadTokens()?.access_token) throw new Error('ACCOUNT_MIGRATION_STORAGE_FAILED');
  store.update(record.id, { contractVersion: 2, credentialRef: client.credentialReference(),
    accountAccess: { ownerId, label: record.account?.email || record.serviceName || record.serviceId,
      family: 'connector', instanceId: record.id, generation: 1, policyRevision: 1, grants: [] } });
  return record.id;
}

/** X keeps its legacy token format outside the native connector registry. */
export function adoptLegacyXAccount(store: ConnectionStore, instances: ConnectorInstanceRegistry,
  recordId: string, ownerId: string, tokens: import('../auth/x-api-oauth.js').XApiTokens | null): string {
  const record=store.get(recordId);
  if(!record || record.serviceId!=='x' || !ownerId) throw new Error('ACCOUNT_UNAVAILABLE');
  if(record.accountAccess){if(record.accountAccess.ownerId!==ownerId)throw new Error('ACCOUNT_UNAVAILABLE');return record.id;}
  if(!tokens?.access_token || !tokens.user_id)throw new Error('ACCOUNT_REAUTH_REQUIRED');
  const client=instances.get('x',record.id);
  const converted={access_token:tokens.access_token,refresh_token:tokens.refresh_token,expires_at:tokens.expires_at,
    scope:tokens.scope,token_type:tokens.token_type,account_id:tokens.user_id};
  const staged=client.loadTokens();
  if(staged && JSON.stringify(staged)!==JSON.stringify(converted))throw new Error('ACCOUNT_MIGRATION_CONFLICT');
  if(!staged)client.saveTokens(converted);
  if(!client.loadTokens()?.access_token)throw new Error('ACCOUNT_MIGRATION_STORAGE_FAILED');
  store.update(record.id,{contractVersion:2,credentialRef:client.credentialReference(),
    accountAccess:{ownerId,label:tokens.username || record.serviceName || 'X',family:'connector',instanceId:record.id,generation:1,policyRevision:1,grants:[]}});
  return record.id;
}
