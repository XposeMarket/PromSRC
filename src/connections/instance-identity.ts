import type { ConnectionAdapterContext } from './types.js';
/** Template identity is not runtime transport identity. Never use user labels in either key. */
export function connectionInstanceIdentity(context: ConnectionAdapterContext): { templateId: string; instanceId: string; accountScoped: boolean } {
  const templateId = String(context.attempt.plan?.strategy.configuration?.mcpServerId || context.attempt.serviceId);
  const connectionId = context.attempt.metadata?.connectionId;
  if (connectionId === undefined) return { templateId, instanceId: templateId, accountScoped: false };
  if (typeof connectionId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(connectionId)) throw new Error('INVALID_CONNECTION_ID');
  return { templateId, instanceId: `account_${connectionId}`, accountScoped: true };
}
