import { randomUUID } from 'crypto';
import { getVault } from '../security/vault';
import type { SecureSecretField } from './types';

interface SecureInputSession {
  id: string; serviceId: string; attemptId: string; fields: SecureSecretField[];
  expiresAt: number; consumed: boolean;
}

export class SecureInputService {
  private readonly sessions = new Map<string, SecureInputSession>();
  constructor(private readonly configDir: string, private readonly ttlMs = 10 * 60_000) {}

  create(input: { serviceId: string; attemptId: string; fields: SecureSecretField[] }): { id: string; expiresAt: string } {
    this.prune();
    const id = `credential_session_${randomUUID()}`;
    const expiresAt = Date.now() + this.ttlMs;
    this.sessions.set(id, { id, serviceId: input.serviceId, attemptId: input.attemptId, fields: input.fields, expiresAt, consumed: false });
    return { id, expiresAt: new Date(expiresAt).toISOString() };
  }

  submit(id: string, values: Record<string, unknown>): { credentialRef: string; fieldsReceived: string[] } {
    const session = this.sessions.get(id);
    if (!session || session.consumed || session.expiresAt <= Date.now()) throw new Error('Secure credential session is missing, expired, or already consumed.');
    const accepted: Record<string, string> = {};
    for (const field of session.fields) {
      const value = String(values[field.key] ?? '').trim();
      if (field.required && !value) throw new Error(`Credential field "${field.label}" is required.`);
      if (value) accepted[field.key] = value;
    }
    const credentialRef = `connection.credentials.${session.serviceId}.${randomUUID()}`;
    getVault(this.configDir).set(credentialRef, JSON.stringify(accepted), `connection-secure-input:${session.attemptId}`);
    session.consumed = true;
    this.sessions.delete(id);
    return { credentialRef: `vault:${credentialRef}`, fieldsReceived: Object.keys(accepted) };
  }

  clearReference(reference: string): void {
    const key = String(reference || '').replace(/^vault:/, '');
    if (key) getVault(this.configDir).delete(key, 'connection-secure-input:clear');
  }

  status(id: string): { valid: boolean; expiresAt?: string; fields?: Array<{ key: string; label: string; required?: boolean }> } {
    const session = this.sessions.get(id);
    if (!session || session.consumed || session.expiresAt <= Date.now()) return { valid: false };
    return { valid: true, expiresAt: new Date(session.expiresAt).toISOString(), fields: session.fields.map(({ key, label, required }) => ({ key, label, required })) };
  }

  private prune(): void { const now = Date.now(); for (const [id, session] of this.sessions) if (session.consumed || session.expiresAt <= now) this.sessions.delete(id); }
}
