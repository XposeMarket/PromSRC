import type {
  ConnectionAdapter, ConnectionAdapterContext, ConnectionAdapterResult,
  ConnectionRecord, ConnectionStrategy, ConnectionVerificationResult, SecureSecretField,
} from '../types.js';

export interface ApiKeyAdapterOptions {
  createCredentialSession: (context: ConnectionAdapterContext, fields: SecureSecretField[]) => Promise<{ id: string; expiresAt?: string }>;
  verifyCredential?: (credentialRef: string, context: ConnectionAdapterContext) => Promise<{ ok: boolean; message?: string; details?: Record<string, unknown> }>;
  clearCredential?: (credentialRef: string, context: ConnectionAdapterContext) => Promise<void>;
}

function fieldsFor(strategy: ConnectionStrategy): SecureSecretField[] {
  const configured = strategy.configuration?.credentialFields;
  if (Array.isArray(configured)) return configured.filter((v): v is SecureSecretField => Boolean(v && typeof v === 'object' && (v as SecureSecretField).key));
  return [{ key: 'api_key', label: 'API key', secret: true, required: true }];
}

export class ApiKeyConnectionAdapter implements ConnectionAdapter {
  readonly id = 'api-key';
  readonly kind = 'api-key';
  readonly displayName = 'API key';
  readonly priority = 80;
  constructor(private readonly options: ApiKeyAdapterOptions) {}
  supports(strategy: ConnectionStrategy): boolean { return strategy.adapter === 'api-key' || strategy.adapter === 'setup-token'; }

  async connect(context: ConnectionAdapterContext): Promise<ConnectionAdapterResult> {
    const strategy = context.attempt.plan?.strategy;
    if (!strategy) return { state: 'failed', error: { code: 'PLAN_REQUIRED', message: 'API-key setup requires a selected connection plan.', phase: 'planning' } };
    if (!context.credentialRef) {
      const fields = fieldsFor(strategy);
      const session = await this.options.createCredentialSession(context, fields);
      return { state: 'awaiting_secure_input', userAction: { type: 'secure-input', label: `Enter credentials for ${context.attempt.serviceName || context.attempt.serviceId}`, credentialSessionId: session.id, fields, expiresAt: session.expiresAt } };
    }
    return { state: 'registering', connection: { configured: true, authenticated: true, authState: 'healthy', credentialRef: context.credentialRef } };
  }

  async continue(context: ConnectionAdapterContext, input: Record<string, unknown> = {}): Promise<ConnectionAdapterResult> {
    const credentialRef = context.credentialRef || (typeof input.credentialRef === 'string' ? input.credentialRef : undefined);
    return this.connect({ ...context, credentialRef });
  }

  async verify(context: ConnectionAdapterContext, connection: ConnectionRecord): Promise<ConnectionVerificationResult[]> {
    const checked = connection.credentialRef && this.options.verifyCredential
      ? await this.options.verifyCredential(connection.credentialRef, context)
      : { ok: Boolean(connection.credentialRef), message: connection.credentialRef ? 'Credential reference is stored.' : 'Credential reference is missing.' };
    return [{ id: `${connection.id}:credential`, check: 'credential.authentication', passed: checked.ok, message: checked.message, details: checked.details, verifiedAt: new Date().toISOString() }];
  }

  async disconnect(context: ConnectionAdapterContext, connection: ConnectionRecord): Promise<void> {
    if (connection.credentialRef && this.options.clearCredential) await this.options.clearCredential(connection.credentialRef, context);
  }
}
