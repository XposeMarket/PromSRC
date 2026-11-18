import type { ConnectionRecord } from './types.js';
import { accountPayloadDigest } from './account-policy.js';
import { currentAccountExecution } from './account-execution-context.js';

/** Defense in depth at family dispatch: adding an account must never leave a singleton bypass.
 * Legacy-only services retain their old path until canonical migration establishes ownership.
 */
export function assertAccountToolBoundary(records: readonly ConnectionRecord[], serviceId: string, toolName: string, args: Record<string, unknown>): void {
  const scoped = records.filter(record => record.serviceId === serviceId && record.accountAccess);
  const execution = currentAccountExecution(serviceId);
  if (!scoped.length && !execution) return;
  if (!execution) throw new Error('ACCOUNT_SELECTION_REQUIRED');
  execution.revalidate();
  if (execution.binding.capability !== toolName) throw new Error('ACCOUNT_TOOL_MISMATCH');
  if (args?.connection_id !== undefined && args.connection_id !== execution.binding.connectionId) throw new Error('ACCOUNT_PAYLOAD_MISMATCH');
  if (accountPayloadDigest(args) !== execution.binding.payloadDigest) throw new Error('ACCOUNT_PAYLOAD_MISMATCH');
  const record = scoped.find(item => item.id === execution.binding.connectionId);
  if (!record || record.pluginId !== execution.binding.pluginId || !record.enabled
    || !record.authenticated || record.authState !== 'healthy'
    || !record.availableTools?.includes(toolName)) throw new Error('ACCOUNT_TOOL_UNAVAILABLE');
}

/** MCP instances use real transport IDs, not OAuth account labels or preset IDs. */
export function assertMcpAccountBoundary(records: readonly ConnectionRecord[], serverId: string, toolName: string, args: Record<string, unknown>): void {
  const matches = records.filter(record => record.accountAccess?.family === 'mcp'
    && (record.accountAccess.instanceId === serverId || record.configuration?.mcpServerId === serverId));
  const execution = currentAccountExecution();
  if (!matches.length) {
    if (execution) throw new Error('ACCOUNT_SERVICE_MISMATCH');
    return;
  }
  if (matches.length !== 1) throw new Error('ACCOUNT_SELECTION_REQUIRED');
  const record = matches[0];
  if (!execution || execution.binding.connectionId !== record.id) throw new Error('ACCOUNT_SELECTION_REQUIRED');
  assertAccountToolBoundary(records, record.serviceId, toolName, args);
}
