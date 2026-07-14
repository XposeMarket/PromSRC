import type { ConnectionAdapter, ConnectionAdapterContext, ConnectionAdapterResult, ConnectionRecord, ConnectionStrategy, ConnectionVerificationResult } from '../types.js';

export interface McpStdioHost {
  connect(context: ConnectionAdapterContext, configuration: Record<string, unknown>): Promise<{ ok: boolean; tools?: string[]; error?: string; configuration?: Record<string, unknown> }>;
  disconnect?(context: ConnectionAdapterContext, connection: ConnectionRecord): Promise<void>;
}
export class McpStdioConnectionAdapter implements ConnectionAdapter {
  readonly id = 'mcp-stdio'; readonly kind = 'mcp-stdio'; readonly displayName = 'Local MCP process'; readonly priority = 85;
  constructor(private readonly host: McpStdioHost) {}
  supports(strategy: ConnectionStrategy): boolean { return strategy.adapter === 'mcp-stdio'; }
  async prepare(context: ConnectionAdapterContext): Promise<ConnectionAdapterResult> {
    const config = { ...(context.attempt.plan?.strategy.configuration || {}), ...(context.configuration || {}) };
    const command = typeof config.command === 'string' ? config.command : '';
    if (!command) return { state: 'failed', error: { code: 'MCP_COMMAND_REQUIRED', message: 'A local MCP command is required.', phase: 'planning' } };
    return { state: 'awaiting_approval', configuration: config, userAction: { type: 'package-install-review', label: `Approve local MCP process for ${context.attempt.serviceName || context.attempt.serviceId}`, packageName: command, version: typeof config.version === 'string' ? config.version : undefined, source: typeof config.source === 'string' ? config.source : undefined, permissions: Array.isArray(config.permissions) ? config.permissions.map(String) : ['process'] } };
  }
  async connect(context: ConnectionAdapterContext): Promise<ConnectionAdapterResult> {
    const config = { ...(context.attempt.plan?.strategy.configuration || {}), ...(context.configuration || {}) };
    const result = await this.host.connect(context, config);
    if (!result.ok) return { state: 'failed', error: { code: 'MCP_STDIO_CONNECT_FAILED', message: result.error || 'Local MCP server failed to start.', retryable: true, phase: 'registering' } };
    const tools = result.tools || [];
    const readOnly = tools.filter((name) => /\b(get|list|read|search|find|lookup|fetch|view|inspect|status)\b/i.test(name.replace(/[_-]+/g, ' ')) && !/\b(delete|create|update|write|send|run|execute)\b/i.test(name.replace(/[_-]+/g, ' ')));
    return { state: 'verifying', configuration: result.configuration || config, connection: { configured: true, authenticated: true, authState: 'healthy', registered: true, registeredTools: tools, exposed: readOnly.length > 0, exposedTools: readOnly, tools: tools.map((name) => ({ name, risk: readOnly.includes(name) ? 'read-only' : 'unknown', approved: readOnly.includes(name) })) } };
  }
  async continue(context: ConnectionAdapterContext, input: Record<string, unknown> = {}): Promise<ConnectionAdapterResult> {
    if (input.approved !== true) return { state: 'cancelled', error: { code: 'INSTALL_NOT_APPROVED', message: 'Local MCP process approval was not granted.', phase: 'awaiting_approval' } };
    return this.connect(context);
  }
  async verify(_context: ConnectionAdapterContext, connection: ConnectionRecord): Promise<ConnectionVerificationResult[]> { return [{ id: `${connection.id}:stdio`, check: 'mcp.stdio.tools', passed: connection.registered && connection.registeredTools.length > 0, message: `${connection.registeredTools.length} tool(s) discovered.`, verifiedAt: new Date().toISOString() }]; }
  async disconnect(context: ConnectionAdapterContext, connection: ConnectionRecord): Promise<void> { await this.host.disconnect?.(context, connection); }
}
