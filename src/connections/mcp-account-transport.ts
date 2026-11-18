import type { ConnectionRecord } from './types.js';
import type { BuiltMcpServerConfig } from '../extensions/mcp-preset-service.js';

/** Resolve protected launch fields in memory from canonical state; persisted MCP config is not authority. */
export function resolveMcpAccountTransport(instanceId: string, deps: {
  readConnection(id: string): ConnectionRecord | undefined;
  readFields(record: ConnectionRecord): Record<string, string>;
  build(templateId: string, fields: Record<string, string>): BuiltMcpServerConfig;
}): BuiltMcpServerConfig | undefined {
  if (!instanceId.startsWith('account_')) return undefined;
  const connectionId = instanceId.slice('account_'.length);
  const record = deps.readConnection(connectionId);
  if (!record?.accountAccess || record.id !== connectionId || !record.enabled
    || record.accountAccess.instanceId !== instanceId || record.accountAccess.family !== 'mcp'
    || !record.accountAccess.ownerId || record.serviceId !== record.pluginId
    || !['mcp-stdio', 'mcp-oauth', 'mcp-http'].includes(record.adapterId || '')) throw new Error('MCP_ACCOUNT_UNAVAILABLE');
  const built = deps.build(record.pluginId, deps.readFields(record));
  return { ...built, id: instanceId };
}
