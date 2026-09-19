import type { KeyValueStorage } from './storage';

export interface StoredGatewayCredential {
  token: string;
  deviceId?: string;
  updatedAt: number;
}

/** Namespaced, gateway-scoped credential persistence. Storage is injected by the platform layer. */
export class GatewayCredentialStore {
  private readonly prefix: string;

  constructor(private readonly storage: KeyValueStorage, namespace = 'prometheus.mobile.gatewayCredential.v1') {
    this.prefix = `${namespace}:`;
  }

  get(gatewayId: string): StoredGatewayCredential | null {
    const id = normalizeGatewayId(gatewayId);
    const raw = this.storage.get(`${this.prefix}${encodeURIComponent(id)}`);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as Partial<StoredGatewayCredential>;
      if (typeof value.token !== 'string' || !value.token) return null;
      return { token: value.token, ...(value.deviceId ? { deviceId: String(value.deviceId) } : {}), updatedAt: Number(value.updatedAt) || 0 };
    } catch {
      return null;
    }
  }

  set(gatewayId: string, credential: Omit<StoredGatewayCredential, 'updatedAt'> & { updatedAt?: number }): void {
    const id = normalizeGatewayId(gatewayId);
    const token = String(credential.token || '');
    if (!token) throw new TypeError('A device token is required.');
    this.storage.set(`${this.prefix}${encodeURIComponent(id)}`, JSON.stringify({
      token,
      ...(credential.deviceId ? { deviceId: String(credential.deviceId) } : {}),
      updatedAt: credential.updatedAt || Date.now(),
    } satisfies StoredGatewayCredential));
  }

  remove(gatewayId: string): void {
    this.storage.remove(`${this.prefix}${encodeURIComponent(normalizeGatewayId(gatewayId))}`);
  }
}

function normalizeGatewayId(value: string): string {
  const id = String(value || '').trim();
  if (!id) throw new TypeError('Gateway id is required.');
  return id;
}
