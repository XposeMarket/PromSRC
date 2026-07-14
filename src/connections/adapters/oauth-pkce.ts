import type { ConnectionAdapter, ConnectionAdapterContext, ConnectionAdapterResult, ConnectionRecord, ConnectionStrategy, ConnectionVerificationResult } from '../types.js';

export interface OAuthPkceFlow {
  start(context: ConnectionAdapterContext, strategy: ConnectionStrategy): Promise<{ authorizationUrl: string; expiresAt?: string; scopes?: string[]; configuration?: Record<string, unknown> }>;
  status(context: ConnectionAdapterContext): Promise<{ state: 'pending' | 'connected' | 'error'; credentialRef?: string; error?: string; configuration?: Record<string, unknown> }>;
  clear?(context: ConnectionAdapterContext, connection?: ConnectionRecord): Promise<void>;
}

export class OAuthPkceConnectionAdapter implements ConnectionAdapter {
  readonly id = 'oauth-pkce'; readonly kind = 'oauth-pkce'; readonly displayName = 'OAuth 2.0 with PKCE'; readonly priority = 100;
  constructor(private readonly flow: OAuthPkceFlow) {}
  supports(strategy: ConnectionStrategy): boolean { return strategy.adapter === 'oauth-pkce' || strategy.adapter === 'oauth-manual-callback'; }
  async connect(context: ConnectionAdapterContext): Promise<ConnectionAdapterResult> {
    const strategy = context.attempt.plan?.strategy;
    if (!strategy) return { state: 'failed', error: { code: 'PLAN_REQUIRED', message: 'OAuth setup requires a selected connection plan.', phase: 'planning' } };
    const started = await this.flow.start(context, strategy);
    return { state: 'awaiting_oauth', configuration: started.configuration, userAction: { type: 'oauth', label: `Authorize ${context.attempt.serviceName || context.attempt.serviceId}`, authorizationUrl: started.authorizationUrl, scopes: started.scopes, expiresAt: started.expiresAt, opensExternalBrowser: true } };
  }
  async continue(context: ConnectionAdapterContext): Promise<ConnectionAdapterResult> {
    const status = await this.flow.status(context);
    if (status.state === 'pending') return { state: 'awaiting_oauth', configuration: status.configuration };
    if (status.state === 'error') return { state: 'reauth_required', error: { code: 'OAUTH_FAILED', message: status.error || 'OAuth authorization failed.', retryable: true, phase: 'awaiting_oauth' } };
    return { state: 'registering', configuration: status.configuration, connection: { authenticated: true, authState: 'healthy', credentialRef: status.credentialRef } };
  }
  async verify(_context: ConnectionAdapterContext, connection: ConnectionRecord): Promise<ConnectionVerificationResult[]> {
    return [{ id: `${connection.id}:oauth`, check: 'oauth.authentication', passed: connection.authenticated && connection.authState === 'healthy', message: connection.authenticated ? 'OAuth authorization is healthy.' : 'OAuth authorization is unavailable.', verifiedAt: new Date().toISOString() }];
  }
  async disconnect(context: ConnectionAdapterContext, connection: ConnectionRecord): Promise<void> { await this.flow.clear?.(context, connection); }
}
