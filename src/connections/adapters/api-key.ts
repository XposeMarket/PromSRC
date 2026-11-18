import { classifyConnectorTools } from '../connector-contract.js';
import {
  CONNECTOR_CONNECTION_CONTRACT_VERSION,
  type ConnectionAdapter, type ConnectionAdapterContext, type ConnectionAdapterResult,
  type ConnectionRecord, type ConnectionStrategy, type ConnectionVerificationResult, type SecureSecretField,
} from '../types.js';

export interface ApiKeyAdapterOptions {
  createCredentialSession: (context: ConnectionAdapterContext, fields: SecureSecretField[]) => Promise<{ id: string; expiresAt?: string }>;
  verifyCredential?: (credentialRef: string, context: ConnectionAdapterContext, connection: ConnectionRecord) => Promise<{ ok: boolean; message?: string; details?: Record<string, unknown> }>;
  clearCredential?: (credentialRef: string, context: ConnectionAdapterContext) => Promise<void>;
  /** Tools the installed plugin declares (contracts.tools / ownership.tools). Used when an older plan snapshot lacks them. */
  declaredTools?: (pluginId: string) => string[];
  /** True only while the stored reference is still owned by this service/attempt (false after disconnect/delete). */
  credentialUsable?: (credentialRef: string, context: ConnectionAdapterContext) => boolean;
}

function registeredToolsFor(strategy: ConnectionStrategy, context: ConnectionAdapterContext, options: ApiKeyAdapterOptions): string[] {
  const planned = strategy.configuration?.registeredTools;
  if (Array.isArray(planned) && planned.length) return planned.map(String);
  const pluginId = String(context.attempt.plan?.pluginId || context.attempt.pluginId || context.attempt.serviceId || '').trim();
  if (!pluginId || !options.declaredTools) return [];
  try { return options.declaredTools(pluginId) || []; } catch { return []; }
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

  // Preparation only creates an expiring input session; saving still requires owner proof.
  async prepare(context: ConnectionAdapterContext): Promise<ConnectionAdapterResult> {
    return this.connect({ ...context, credentialRef: undefined });
  }

  async connect(context: ConnectionAdapterContext): Promise<ConnectionAdapterResult> {
    const strategy = context.attempt.plan?.strategy;
    if (!strategy) return { state: 'failed', error: { code: 'PLAN_REQUIRED', message: 'API-key setup requires a selected connection plan.', phase: 'planning' } };
    if (!context.credentialRef) {
      const fields = fieldsFor(strategy);
      const session = await this.options.createCredentialSession(context, fields);
      return { state: 'awaiting_secure_input', userAction: { type: 'secure-input', label: `Enter credentials for ${context.attempt.serviceName || context.attempt.serviceId}`, credentialSessionId: session.id, fields, expiresAt: session.expiresAt } };
    }
    return { state: 'registering', connection: this.storedConnection(strategy, context, context.credentialRef) };
  }

  /**
   * The owner entered the key through the protected secure card, so the
   * connection is usable. Register the plugin's declared tools: read-only tools
   * are exposed automatically, writes/unknown stay approval-gated per call.
   * `verified` stays false until verify() runs a safe read with the key.
   */
  private storedConnection(strategy: ConnectionStrategy, context: ConnectionAdapterContext, credentialRef: string): Partial<ConnectionRecord> {
    const tools = classifyConnectorTools(registeredToolsFor(strategy, context, this.options), true);
    const registered = tools.registeredTools.length > 0;
    return {
      contractVersion: CONNECTOR_CONNECTION_CONTRACT_VERSION,
      configured: true,
      authenticated: true,
      authState: 'healthy',
      registered,
      registeredTools: tools.registeredTools,
      availableTools: tools.registeredTools,
      exposedTools: tools.exposedTools,
      exposed: tools.exposedTools.length > 0,
      tools: tools.tools,
      credentialRef,
    };
  }

  /** Re-register tools for an already stored key (e.g. records saved before tool registration existed). */
  async repair(context: ConnectionAdapterContext, connection: ConnectionRecord): Promise<ConnectionAdapterResult> {
    const strategy = context.attempt.plan?.strategy;
    if (!strategy) return { state: 'failed', error: { code: 'PLAN_REQUIRED', message: 'API-key repair requires a selected connection plan.', phase: 'planning' } };
    // Never revive a disconnected record or a deleted/foreign credential: require a fresh protected save instead.
    const disconnected = connection.enabled === false || connection.authState === 'none' || connection.health === 'unavailable';
    const usable = Boolean(connection.credentialRef) && !disconnected
      && this.options.credentialUsable?.(connection.credentialRef!, context) === true;
    if (!usable) return this.connect({ ...context, credentialRef: undefined });
    return { state: 'verifying', connection: this.storedConnection(strategy, context, connection.credentialRef!) };
  }

  async continue(context: ConnectionAdapterContext, input: Record<string, unknown> = {}): Promise<ConnectionAdapterResult> {
    const credentialRef = context.credentialRef || (typeof input.credentialRef === 'string' ? input.credentialRef : undefined);
    return this.connect({ ...context, credentialRef });
  }

  async verify(context: ConnectionAdapterContext, connection: ConnectionRecord): Promise<ConnectionVerificationResult[]> {
    const checked = connection.credentialRef && this.options.verifyCredential
      ? await this.options.verifyCredential(connection.credentialRef, context, connection)
      : { ok: false, message: connection.credentialRef ? 'Stored, not verified: no safe authentication verifier is available.' : 'Credential reference is missing.' };
    return [{ id: `${connection.id}:credential`, check: 'credential.authentication', passed: checked.ok, message: checked.message, details: checked.details, verifiedAt: new Date().toISOString() }];
  }

  async disconnect(context: ConnectionAdapterContext, connection: ConnectionRecord): Promise<void> {
    if (connection.credentialRef && this.options.clearCredential) await this.options.clearCredential(connection.credentialRef, context);
  }
}
