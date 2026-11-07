import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { getVault } from '../security/vault';
import type { SecureSecretField } from './types';

interface SecureInputSession {
  id: string; serviceId: string; attemptId: string; fields: SecureSecretField[];
  expiresAt: number; consumed: boolean;
}

type CredentialOwner = { serviceId: string; attemptId: string };

export class SecureInputService {
  private readonly sessions = new Map<string, SecureInputSession>();
  private readonly references = new Map<string, CredentialOwner>();
  constructor(private readonly configDir: string, private readonly ttlMs = 10 * 60_000) {
    const file = path.join(configDir, 'connection-credential-owners.json');
    if (!fs.existsSync(file)) return;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('ownership index is not an object');
      for (const [reference, owner] of Object.entries(data)) {
        const candidate = owner as Partial<CredentialOwner> | null;
        if (typeof candidate?.serviceId === 'string' && typeof candidate?.attemptId === 'string') {
          this.references.set(reference, { serviceId: candidate.serviceId, attemptId: candidate.attemptId });
        }
      }
    } catch (error: any) {
      // Fail closed: an unreadable ownership index owns nothing. Keep a copy for recovery
      // and never let it crash connection-runtime initialization.
      try { fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`); } catch { /* best effort */ }
      console.warn('[connections] credential ownership index unreadable; references fail closed:', error?.message || error);
    }
  }
  private saveOwners(): void {
    fs.mkdirSync(this.configDir, { recursive: true });
    const file = path.join(this.configDir, 'connection-credential-owners.json');
    const temp = `${file}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(Object.fromEntries(this.references)), { mode: 0o600 }); fs.renameSync(temp, file);
  }

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
      const value = String(values[field.key] ?? '');
      if (field.required && !value) throw new Error(`Credential field "${field.label}" is required.`);
      if (value) accepted[field.key] = value;
    }
    const credentialRef = `connection.credentials.${session.serviceId}.${randomUUID()}`;
    getVault(this.configDir).set(credentialRef, JSON.stringify(accepted), `connection-secure-input:${session.attemptId}`);
    this.references.set(`vault:${credentialRef}`, { serviceId: session.serviceId, attemptId: session.attemptId });
    this.saveOwners();
    session.consumed = true;
    this.sessions.delete(id);
    return { credentialRef: `vault:${credentialRef}`, fieldsReceived: Object.keys(accepted) };
  }

  ownsReference(reference: string, serviceId: string, attemptId: string): boolean {
    const owner = this.references.get(reference);
    return Boolean(owner && owner.serviceId === serviceId && owner.attemptId === attemptId);
  }

  /**
   * Delete a connection credential. Owned references (created by this index) are
   * always cleared for their owning attempt. References created before the
   * ownership index exist are cleared only when the caller passes
   * `persistedLegacy: true`, i.e. the reference is the trusted persisted
   * connection.credentialRef, never raw model input.
   */
  clearReference(reference: string, serviceId?: string, attemptId?: string, options: { persistedLegacy?: boolean } = {}): void {
    const key = String(reference || '').replace(/^vault:/, '');
    if (!key.startsWith('connection.credentials.')) throw new Error('Invalid connection credential reference.');
    const owned = Boolean(serviceId && attemptId && this.ownsReference(reference, serviceId, attemptId));
    if (!owned && options.persistedLegacy !== true) throw new Error('Credential reference does not belong to this connection attempt.');
    getVault(this.configDir).delete(key, 'connection-secure-input:clear');
    if (this.references.delete(reference)) this.saveOwners();
  }

  status(id: string): { valid: boolean; expiresAt?: string; fields?: Array<{ key: string; label: string; required?: boolean }> } {
    const session = this.sessions.get(id);
    if (!session || session.consumed || session.expiresAt <= Date.now()) return { valid: false };
    return { valid: true, expiresAt: new Date(session.expiresAt).toISOString(), fields: session.fields.map(({ key, label, required }) => ({ key, label, required })) };
  }

  private prune(): void { const now = Date.now(); for (const [id, session] of this.sessions) if (session.consumed || session.expiresAt <= now) this.sessions.delete(id); }
}
