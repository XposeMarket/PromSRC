import type { ConnectionAdapter, ConnectionAdapterContext, ConnectionAdapterResult, ConnectionRecord, ConnectionStrategy, ConnectionVerificationResult } from '../types.js';

export interface DeviceCodeFlow {
  start(context: ConnectionAdapterContext, strategy: ConnectionStrategy): Promise<{ verificationUrl: string; userCode: string; expiresAt?: string; pollIntervalSeconds?: number; configuration?: Record<string, unknown> }>;
  poll(context: ConnectionAdapterContext): Promise<{ state: 'pending' | 'connected' | 'expired' | 'error'; credentialRef?: string; error?: string }>;
  clear?(context: ConnectionAdapterContext, connection?: ConnectionRecord): Promise<void>;
}
export class DeviceCodeConnectionAdapter implements ConnectionAdapter {
  readonly id = 'oauth-device-code'; readonly kind = 'oauth-device-code'; readonly displayName = 'OAuth device code'; readonly priority = 95;
  constructor(private readonly flow: DeviceCodeFlow) {}
  supports(strategy: ConnectionStrategy): boolean { return strategy.adapter === 'oauth-device-code'; }
  async connect(context: ConnectionAdapterContext): Promise<ConnectionAdapterResult> {
    const strategy = context.attempt.plan?.strategy;
    if (!strategy) return { state: 'failed', error: { code: 'PLAN_REQUIRED', message: 'Device authorization requires a selected connection plan.', phase: 'planning' } };
    const result = await this.flow.start(context, strategy);
    return { state: 'awaiting_device_code', configuration: result.configuration, userAction: { type: 'device-code', label: `Authorize ${context.attempt.serviceName || context.attempt.serviceId}`, verificationUrl: result.verificationUrl, userCode: result.userCode, expiresAt: result.expiresAt, pollIntervalSeconds: result.pollIntervalSeconds } };
  }
  async continue(context: ConnectionAdapterContext): Promise<ConnectionAdapterResult> {
    const result = await this.flow.poll(context);
    if (result.state === 'pending') return { state: 'awaiting_device_code' };
    if (result.state !== 'connected') return { state: result.state === 'expired' ? 'reauth_required' : 'failed', error: { code: result.state === 'expired' ? 'DEVICE_CODE_EXPIRED' : 'DEVICE_CODE_FAILED', message: result.error || 'Device authorization did not complete.', retryable: true, phase: 'awaiting_device_code' } };
    return { state: 'registering', connection: { authenticated: true, authState: 'healthy', credentialRef: result.credentialRef } };
  }
  async verify(_context: ConnectionAdapterContext, connection: ConnectionRecord): Promise<ConnectionVerificationResult[]> { return [{ id: `${connection.id}:device`, check: 'device-code.authentication', passed: connection.authenticated, verifiedAt: new Date().toISOString() }]; }
  async disconnect(context: ConnectionAdapterContext, connection: ConnectionRecord): Promise<void> { await this.flow.clear?.(context, connection); }
}
