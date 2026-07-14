import type { ConnectionAdapter, ConnectionAdapterContext, ConnectionAdapterResult, ConnectionRecord, ConnectionStrategy, ConnectionVerificationResult } from '../types.js';

export interface McpOAuthHost {
  startOAuth(context: ConnectionAdapterContext, strategy: ConnectionStrategy): Promise<{ authorizationUrl: string; expiresAt?: string; scopes?: string[]; discoveryVersion?: number }>;
  oauthStatus(context: ConnectionAdapterContext): Promise<{ state: 'pending' | 'connected' | 'error'; error?: string }>;
  connectServer(context: ConnectionAdapterContext): Promise<{ ok: boolean; tools?: string[]; configuration?: Record<string, unknown>; error?: string }>;
  disconnectServer?(context: ConnectionAdapterContext, connection: ConnectionRecord): Promise<void>;
  clearOAuth?(context: ConnectionAdapterContext): Promise<void>;
}

export class McpOAuthConnectionAdapter implements ConnectionAdapter {
  readonly id = 'mcp-oauth'; readonly kind = 'mcp-oauth'; readonly displayName = 'Remote MCP with OAuth'; readonly priority = 110;
  constructor(private readonly host: McpOAuthHost) {}
  supports(strategy: ConnectionStrategy): boolean { return strategy.adapter === 'mcp-oauth'; }
  async connect(context: ConnectionAdapterContext): Promise<ConnectionAdapterResult> {
    const strategy = context.attempt.plan?.strategy;
    if (!strategy) return { state: 'failed', error: { code: 'PLAN_REQUIRED', message: 'MCP OAuth requires a selected connection plan.', phase: 'planning' } };
    const existingAuth = await this.host.oauthStatus(context);
    if (existingAuth.state === 'connected') {
      context.emitProgress?.('Existing OAuth authorization is valid; connecting to the MCP server.');
      return this.completeConnection(context);
    }
    const flow = await this.host.startOAuth(context, strategy);
    return { state: 'awaiting_oauth', configuration: { oauthDiscoveryVersion: flow.discoveryVersion || 2 }, userAction: { type: 'oauth', label: `Connect ${context.attempt.serviceName || context.attempt.serviceId}`, authorizationUrl: flow.authorizationUrl, scopes: flow.scopes, expiresAt: flow.expiresAt, opensExternalBrowser: true, desktopRequired: context.attempt.plan?.strategy.configuration?.desktopRequired === true, desktopReason: String(context.attempt.plan?.strategy.configuration?.desktopReason || '') || undefined } };
  }
  async continue(context: ConnectionAdapterContext): Promise<ConnectionAdapterResult> {
    const auth = await this.host.oauthStatus(context);
    if (auth.state === 'pending') return { state: 'awaiting_oauth' };
    if (auth.state === 'error') return { state: 'reauth_required', error: { code: 'MCP_OAUTH_FAILED', message: auth.error || 'MCP authorization failed.', retryable: true, phase: 'awaiting_oauth' } };
    context.emitProgress?.('OAuth complete; connecting to the MCP server.');
    return this.completeConnection(context);
  }
  private async completeConnection(context: ConnectionAdapterContext): Promise<ConnectionAdapterResult> {
    const connected = await this.host.connectServer(context);
    if (!connected.ok) return { state: 'degraded', error: { code: 'MCP_CONNECT_FAILED', message: connected.error || 'MCP server connection failed.', retryable: true, phase: 'registering' } };
    const tools = connected.tools || [];
    const readOnly = tools.filter((name) => /\b(get|list|read|search|find|lookup|fetch|view|inspect|status|quote|balance|holding|position|profile|history)\b/i.test(name.replace(/[_-]+/g, ' ')) && !/\b(place|submit|buy|sell|trade|order|transfer|withdraw|deposit|delete|cancel|create|update|write)\b/i.test(name.replace(/[_-]+/g, ' ')));
    return { state: 'verifying', configuration: connected.configuration, connection: { configured: true, authenticated: true, authState: 'healthy', registered: true, registeredTools: tools, exposed: readOnly.length > 0, exposedTools: readOnly, tools: tools.map((name) => ({ name, risk: readOnly.includes(name) ? 'read-only' : 'unknown', approved: readOnly.includes(name), classificationReason: readOnly.includes(name) ? 'Conservative read-only name classification.' : 'Blocked pending explicit review.' })) } };
  }
  async verify(_context: ConnectionAdapterContext, connection: ConnectionRecord): Promise<ConnectionVerificationResult[]> {
    const now = new Date().toISOString();
    return [
      { id: `${connection.id}:oauth`, check: 'mcp.oauth', passed: connection.authenticated && connection.authState === 'healthy', verifiedAt: now },
      { id: `${connection.id}:tools`, check: 'mcp.tools.discovered', passed: connection.registered && connection.registeredTools.length > 0, message: `${connection.registeredTools.length} tool(s) discovered.`, verifiedAt: now },
    ];
  }
  async repair(context: ConnectionAdapterContext): Promise<ConnectionAdapterResult> { await this.host.clearOAuth?.(context); return this.connect(context); }
  async disconnect(context: ConnectionAdapterContext, connection: ConnectionRecord): Promise<void> { await this.host.disconnectServer?.(context, connection); await this.host.clearOAuth?.(context); }
}
