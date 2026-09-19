import { GatewayHttpClient, type HttpClientOptions } from '../transport/http-client';
import type { GatewayDescriptor } from '../gateway/types';

export interface PairingClientOptions extends Omit<HttpClientOptions, 'origin'> {
  origin: string;
}

export interface PairingClaimInput {
  code: string;
  deviceName: string;
  deviceFingerprint: string;
}

export interface PairingClaimResult {
  success: boolean;
  requestId?: string;
  expiresAt?: number;
  status?: string;
  resumed?: boolean;
  gateway?: Partial<GatewayDescriptor> & Record<string, unknown>;
  error?: string;
}

export interface PairingPollResult {
  success: boolean;
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'not_found' | 'wrong_device' | 'approved_already_collected' | string;
  deviceId?: string;
  deviceToken?: string;
  gateway?: Partial<GatewayDescriptor> & Record<string, unknown>;
  error?: string;
}

/** Pairing operations always target the supplied gateway; no active gateway global is consulted. */
export class PairingClient {
  readonly origin: string;
  private readonly http: GatewayHttpClient;

  constructor(options: PairingClientOptions) {
    this.http = new GatewayHttpClient(options);
    this.origin = this.http.origin;
  }

  claim(input: PairingClaimInput, options: { signal?: AbortSignal } = {}): Promise<PairingClaimResult> {
    if (!input.code.trim()) throw new TypeError('Pairing code is required.');
    return this.http.request('/api/pairing/claim', {
      method: 'POST', signal: options.signal,
      body: { code: input.code.trim(), deviceName: input.deviceName.trim() || 'Mobile device', deviceFingerprint: input.deviceFingerprint.trim() },
    });
  }

  poll(requestId: string, deviceFingerprint: string, options: { signal?: AbortSignal } = {}): Promise<PairingPollResult> {
    const id = String(requestId || '').trim();
    if (!id) throw new TypeError('Pairing request id is required.');
    return this.http.request(`/api/pairing/poll/${encodeURIComponent(id)}`, {
      signal: options.signal,
      headers: { 'X-Pairing-Device-Fingerprint': deviceFingerprint.trim() },
    });
  }

  me(options: { signal?: AbortSignal } = {}): Promise<{ success: boolean; device?: unknown }> {
    return this.http.request('/api/pairing/me', options);
  }

  revoke(options: { signal?: AbortSignal } = {}): Promise<{ success: boolean; revoked?: boolean; deviceId?: string }> {
    return this.http.request('/api/pairing/me/revoke', { method: 'POST', body: {}, ...options });
  }
}
