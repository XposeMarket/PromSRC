import type { OAuthCallbackResult, OAuthConnectorMetadata, OAuthStartResult } from '../../integrations/oauth-base.js';
import {
  accountIdentityKey,
  accountIdentitiesMatch,
  buildConnectorCapabilityGrants,
  classifyConnectorTools,
  normalizeConnectionAccountIdentity,
  normalizeConnectionResources,
} from '../connector-contract.js';
import type {
  ConnectionAdapter,
  ConnectionAdapterContext,
  ConnectionAdapterResult,
  ConnectionAccountIdentity,
  ConnectionProviderAppMetadata,
  ConnectionRecord,
  ConnectionResourceIdentity,
  ConnectionStrategy,
  ConnectionVerificationResult,
} from '../types.js';
import { CONNECTOR_CONNECTION_CONTRACT_VERSION } from '../types.js';

export interface ConnectorOAuthVerification {
  account?: ConnectionAccountIdentity;
  resources?: ConnectionResourceIdentity[];
}

export interface ConnectorOAuthBridge {
  id: string;
  name: string;
  start(expectedAccountId?: string, requestedScopes?: string[]): OAuthStartResult | Promise<OAuthStartResult>;
  poll(): Promise<OAuthCallbackResult | null>;
  metadata(): OAuthConnectorMetadata | Promise<OAuthConnectorMetadata>;
  verify(): Promise<ConnectorOAuthVerification>;
  clear(): void | Promise<void>;
  revoke?(): void | Promise<void>;
  credentialReference?(): string;
}

function callbackUri(strategy: ConnectionStrategy): string | undefined {
  const callback = strategy.authentication?.callback;
  if (!callback?.port || !callback.path) return undefined;
  return `http://${callback.host || 'localhost'}:${callback.port}${callback.path}`;
}

function providerAppMetadata(
  strategy: ConnectionStrategy,
  metadata: OAuthConnectorMetadata,
  provider: string,
): ConnectionProviderAppMetadata {
  const declared = (strategy.configuration?.providerApp || {}) as Record<string, unknown>;
  return {
    provider: String(declared.provider || provider),
    appType: (declared.appType as ConnectionProviderAppMetadata['appType']) || 'unknown',
    clientIdConfigured: metadata.clientIdConfigured,
    clientSecretConfigured: metadata.clientSecretConfigured,
    pkceRequired: strategy.authentication?.pkceRequired === true,
    nonceRequired: strategy.authentication?.nonceRequired === true,
    redirectUri: callbackUri(strategy),
    externalSetupRequired: declared.externalSetupRequired !== false,
  };
}

function accountFromMetadata(
  provider: string,
  metadata: OAuthConnectorMetadata,
  callbackResult?: OAuthCallbackResult | null,
): ConnectionAccountIdentity | undefined {
  return normalizeConnectionAccountIdentity({
    provider,
    ...(metadata.account || {}),
    email: metadata.account?.email || callbackResult?.account_email,
  }, provider);
}

function resourceList(
  account: ConnectionAccountIdentity | undefined,
  resources: unknown,
): ConnectionResourceIdentity[] {
  const normalized = normalizeConnectionResources(resources);
  const accountKey = accountIdentityKey(account);
  if (normalized.length || !accountKey || !account) return normalized;
  return [{ kind: 'account', id: accountKey, displayName: account.displayName || account.username || account.email }];
}

function safeErrorMessage(error: unknown): string {
  return String((error as any)?.message || error || 'Unknown provider error')
    .replace(/"(?:access_token|refresh_token|client_secret|authorization)"\s*:\s*"[^"]*"/gi, '"credential" : "[redacted]"')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/(access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, 240);
}

export class ConnectorOAuthConnectionAdapter implements ConnectionAdapter {
  readonly id = 'connector-oauth';
  readonly kind = 'connector-oauth' as const;
  readonly displayName = 'Provider OAuth with PKCE';
  readonly priority = 120;

  constructor(private readonly bridge: ConnectorOAuthBridge | Readonly<Record<string, ConnectorOAuthBridge>>) {}

  private bridgeFor(context: ConnectionAdapterContext): ConnectorOAuthBridge {
    if (typeof (this.bridge as ConnectorOAuthBridge).start === 'function') {
      return this.bridge as ConnectorOAuthBridge;
    }
    const serviceId = String(
      context.attempt.plan?.strategy.configuration?.connectorId
        || context.attempt.serviceId
        || '',
    ).trim();
    const selected = (this.bridge as Readonly<Record<string, ConnectorOAuthBridge>>)[serviceId];
    if (!selected) throw new Error(`OAuth connector bridge is not implemented for ${serviceId || 'this service'}.`);
    return selected;
  }

  supports(strategy: ConnectionStrategy): boolean {
    return strategy.adapter === this.id || strategy.adapter === 'connector-oauth';
  }

  async connect(context: ConnectionAdapterContext): Promise<ConnectionAdapterResult> {
    const strategy = context.attempt.plan?.strategy;
    if (!strategy) return this.planRequired();
    const bridge = this.bridgeFor(context);
    const expectedAccountId = String(context.attempt.metadata?.expectedAccountId || '').trim() || undefined;
    const requestedScopes = Array.isArray(strategy.authentication?.scopes)
      ? strategy.authentication.scopes.map(String)
      : undefined;
    const started = await bridge.start(expectedAccountId, requestedScopes);
    if (started.error || !started.authUrl) {
      return {
        state: 'failed',
        error: {
          code: 'OAUTH_PROVIDER_APP_NOT_CONFIGURED',
          message: started.error || `${bridge.name} OAuth app is not configured.`,
          retryable: false,
          phase: 'planning',
        },
      };
    }
    return {
      state: 'awaiting_oauth',
      configuration: { connectionContractVersion: CONNECTOR_CONNECTION_CONTRACT_VERSION, oauthProvider: bridge.id },
      userAction: {
        type: 'oauth',
        label: `Sign in with ${bridge.name}`,
        authorizationUrl: started.authUrl,
        scopes: strategy.authentication?.scopes,
        opensExternalBrowser: true,
        desktopRequired: true,
        desktopReason: 'The authorization code returns to a loopback callback owned by the local desktop gateway.',
      },
    };
  }

  async continue(context: ConnectionAdapterContext): Promise<ConnectionAdapterResult> {
    const bridge = this.bridgeFor(context);
    const result = await bridge.poll();
    if (!result) return { state: 'awaiting_oauth' };
    if (!result.success) {
      return {
        state: 'reauth_required',
        error: {
          code: /account mismatch/i.test(result.error || '') ? 'ACCOUNT_MISMATCH' : 'OAUTH_FAILED',
          message: result.error || 'OAuth authorization failed.', retryable: true, phase: 'awaiting_oauth',
        },
      };
    }
    const strategy = context.attempt.plan?.strategy;
    if (!strategy) return this.planRequired();
    const metadata = await bridge.metadata();
    const connection = this.buildConnection(context, strategy, metadata, result, bridge);
    const expectedAccount = String(context.attempt.metadata?.expectedAccountId || '').trim();
    const actualAccount = accountIdentityKey(connection.account);
    if (expectedAccount && actualAccount && expectedAccount !== actualAccount) {
      return {
        state: 'reauth_required',
        error: {
          code: 'ACCOUNT_MISMATCH',
          message: `The provider account returned by OAuth does not match the selected account. Disconnect or select the intended account before continuing.`,
          retryable: true,
          phase: 'awaiting_oauth',
          details: { expectedAccountId: expectedAccount, actualAccountId: actualAccount },
        },
      };
    }
    return {
      state: 'registering',
      configuration: { connectionContractVersion: CONNECTOR_CONNECTION_CONTRACT_VERSION, oauthProvider: bridge.id },
      connection,
    };
  }

  async verify(context: ConnectionAdapterContext, connection: ConnectionRecord): Promise<ConnectionVerificationResult[]> {
    const bridge = this.bridgeFor(context);
    const verifiedAt = new Date().toISOString();
    const checks: ConnectionVerificationResult[] = [];
    if (!connection.authenticated || connection.authState !== 'healthy') {
      checks.push({ id: `${connection.id}:oauth`, check: 'oauth.authentication', passed: false, message: 'OAuth authorization is not healthy.', verifiedAt });
      return checks;
    }
    checks.push({ id: `${connection.id}:oauth`, check: 'oauth.authentication', passed: true, message: 'OAuth authorization is present.', verifiedAt });
    try {
      const fresh = await bridge.verify();
      const sameAccount = accountIdentitiesMatch(connection.account, fresh.account);
      checks.push({
        id: `${connection.id}:account`,
        check: 'account.identity',
        passed: sameAccount,
        message: sameAccount ? 'Provider account identity matches the connected session.' : 'Provider account identity changed; reauthorization is required.',
        details: fresh.account ? { providerAccountId: fresh.account.providerAccountId, username: fresh.account.username, email: fresh.account.email } : undefined,
        verifiedAt,
      });
      checks.push({ id: `${connection.id}:resources`, check: 'resource.scope', passed: true, message: `${(fresh.resources || connection.resources || []).length} provider resource identity record(s) are associated.`, verifiedAt });
    } catch (error: any) {
      checks.push({ id: `${connection.id}:provider`, check: 'provider.account', passed: false, message: safeErrorMessage(error), verifiedAt });
    }
    return checks;
  }

  async repair(context: ConnectionAdapterContext): Promise<ConnectionAdapterResult> {
    return this.connect(context);
  }

  async disconnect(context: ConnectionAdapterContext, _connection: ConnectionRecord): Promise<void> {
    const bridge = this.bridgeFor(context);
    try {
      await bridge.revoke?.();
      context.emitProgress?.('Provider revocation completed or was not required.', { remoteRevocation: 'completed' });
    } catch (error: any) {
      // The local vault must still be cleared. The progress detail makes the
      // provider-side failure visible without returning credentials or tokens.
      context.emitProgress?.('Provider revocation could not be confirmed; local credentials will still be cleared.', { remoteRevocation: 'failed', error: safeErrorMessage(error) });
    } finally {
      await bridge.clear();
    }
  }

  private buildConnection(
    context: ConnectionAdapterContext,
    strategy: ConnectionStrategy,
    metadata: OAuthConnectorMetadata,
    callbackResult: OAuthCallbackResult,
    bridge: ConnectorOAuthBridge,
  ): Partial<ConnectionRecord> {
    const account = accountFromMetadata(bridge.id, metadata, callbackResult);
    const resources = resourceList(account, metadata.resources || context.attempt.metadata?.resources);
    const tools = classifyConnectorTools(
      Array.isArray(strategy.configuration?.registeredTools) ? strategy.configuration.registeredTools.map(String) : [],
      context.attempt.readOnly !== false,
    );
    const capabilities = buildConnectorCapabilityGrants(
      strategy.capabilityContracts,
      context.attempt.requestedCapabilities,
      context.attempt.readOnly !== false,
    );
    return {
      contractVersion: CONNECTOR_CONNECTION_CONTRACT_VERSION,
      migration: {
        source: 'legacy',
        target: 'connection-v2',
        version: CONNECTOR_CONNECTION_CONTRACT_VERSION,
        migratedAt: new Date().toISOString(),
        rollbackSupported: true,
        legacyReadable: true,
      },
      configured: true,
      authenticated: true,
      registered: true,
      exposed: tools.exposedTools.length > 0,
      verified: false,
      authState: 'healthy',
      health: 'unknown',
      account,
      resources,
      grantedCapabilities: capabilities.grantedCapabilities,
      capabilityGrants: capabilities.capabilityGrants,
      grantedScopes: metadata.grantedScopes,
      registeredTools: tools.registeredTools,
      availableTools: tools.registeredTools,
      exposedTools: tools.exposedTools,
      tools: tools.tools,
      providerApp: providerAppMetadata(strategy, metadata, bridge.id),
      credentialRef: bridge.credentialReference?.(),
    };
  }

  private planRequired(): ConnectionAdapterResult {
    return { state: 'failed', error: { code: 'PLAN_REQUIRED', message: 'OAuth setup requires a selected connection plan.', phase: 'planning' } };
  }
}
