import type { ConnectionAdapter, ConnectionAdapterContext, ConnectionAdapterResult, ConnectionRecord, ConnectionStrategy, ConnectionVerificationResult, SecureSecretField } from '../types.js';

export interface OpenAiCompatibleHost {
  createCredentialSession(context: ConnectionAdapterContext, fields: SecureSecretField[]): Promise<{ id: string; expiresAt?: string }>;
  probe(context: ConnectionAdapterContext, configuration: Record<string, unknown>): Promise<{ ok: boolean; models?: string[]; streaming?: boolean; toolCalling?: boolean; error?: string; details?: Record<string, unknown> }>;
  register(context: ConnectionAdapterContext, configuration: Record<string, unknown>): Promise<{ providerId: string; models: string[] }>;
  unregister?(context: ConnectionAdapterContext, connection: ConnectionRecord): Promise<void>;
}
function modelConfig(context: ConnectionAdapterContext): Record<string, unknown> { return { ...(context.attempt.plan?.strategy.configuration || {}), ...(context.configuration || {}) }; }
export class OpenAiCompatibleModelConnectionAdapter implements ConnectionAdapter {
  readonly id = 'openai-compatible-model'; readonly kind = 'openai-compatible-model'; readonly displayName = 'OpenAI-compatible model endpoint'; readonly priority = 90;
  constructor(private readonly host: OpenAiCompatibleHost) {}
  supports(strategy: ConnectionStrategy): boolean { return strategy.adapter === 'openai-compatible-model'; }
  async connect(context: ConnectionAdapterContext): Promise<ConnectionAdapterResult> {
    const config = modelConfig(context);
    const baseUrl = typeof config.baseUrl === 'string' ? config.baseUrl.trim() : '';
    if (!baseUrl) return { state: 'awaiting_secure_input', error: { code: 'BASE_URL_REQUIRED', message: 'The model endpoint base URL is required.', retryable: true, phase: 'awaiting_secure_input' } };
    try { const url = new URL(baseUrl); if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol'); } catch { return { state: 'failed', error: { code: 'INVALID_BASE_URL', message: 'The model endpoint must be an HTTP or HTTPS URL.', phase: 'planning' } }; }
    if (!context.credentialRef && config.authentication !== 'none') {
      const fields: SecureSecretField[] = [{ key: 'api_key', label: 'API key', secret: true, required: true }];
      const session = await this.host.createCredentialSession(context, fields);
      return { state: 'awaiting_secure_input', configuration: config, userAction: { type: 'secure-input', label: `Connect ${context.attempt.serviceName || context.attempt.serviceId}`, credentialSessionId: session.id, fields, expiresAt: session.expiresAt } };
    }
    const probe = await this.host.probe(context, config);
    if (!probe.ok) return { state: 'failed', error: { code: 'MODEL_ENDPOINT_PROBE_FAILED', message: probe.error || 'The model endpoint verification failed.', retryable: true, phase: 'verifying', details: probe.details } };
    const registered = await this.host.register(context, { ...config, discoveredModels: probe.models || [] });
    return { state: 'verifying', configuration: { ...config, providerId: registered.providerId, models: registered.models, streaming: probe.streaming, toolCalling: probe.toolCalling }, connection: { configured: true, authenticated: config.authentication === 'none' || Boolean(context.credentialRef), authState: config.authentication === 'none' || context.credentialRef ? 'healthy' : 'none', registered: true, credentialRef: context.credentialRef, registeredTools: [] } };
  }
  async continue(context: ConnectionAdapterContext, input: Record<string, unknown> = {}): Promise<ConnectionAdapterResult> { return this.connect({ ...context, credentialRef: context.credentialRef || (typeof input.credentialRef === 'string' ? input.credentialRef : undefined) }); }
  async verify(context: ConnectionAdapterContext, connection: ConnectionRecord): Promise<ConnectionVerificationResult[]> {
    const probe = await this.host.probe(context, connection.configuration || {}); const now = new Date().toISOString();
    return [
      { id: `${connection.id}:reachability`, check: 'model.reachability', passed: probe.ok, message: probe.error, details: probe.details, verifiedAt: now },
      { id: `${connection.id}:models`, check: 'model.discovery', passed: Boolean(probe.models?.length), message: `${probe.models?.length || 0} model(s) discovered.`, verifiedAt: now },
      { id: `${connection.id}:streaming`, check: 'model.streaming', passed: probe.streaming !== false, verifiedAt: now },
      { id: `${connection.id}:tools`, check: 'model.tool-calling', passed: probe.toolCalling !== false, verifiedAt: now },
    ];
  }
  async disconnect(context: ConnectionAdapterContext, connection: ConnectionRecord): Promise<void> { await this.host.unregister?.(context, connection); }
}
