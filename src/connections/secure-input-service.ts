import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { getVault } from '../security/vault';
import type { SecureSecretField } from './types';

interface SecureInputSession {
  id: string; serviceId: string; attemptId: string; fields: SecureSecretField[];
  expiresAt: number; consumed: boolean;
}

export class SecureInputService {
  private readonly sessions = new Map<string, SecureInputSession>();
  private readonly references = new Map<string, { serviceId: string; attemptId: string }>();
  constructor(private readonly configDir: string, private readonly ttlMs = 10 * 60_000) {
    const file = path.join(configDir, 'connection-credential-owners.json');
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const [reference, owner] of Object.entries(data)) this.references.set(reference, owner as { serviceId: string; attemptId: string });
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

  clearReference(reference: string, serviceId?: string, attemptId?: string): void {
    if (!serviceId || !attemptId || !this.ownsReference(reference, serviceId, attemptId)) throw new Error('Credential reference does not belong to this connection attempt.');
    const key = reference.replace(/^vault:/, '');
    if (!key.startsWith('connection.credentials.')) throw new Error('Invalid connection credential reference.');
    getVault(this.configDir).delete(key, 'connection-secure-input:clear');
    this.references.delete(reference); this.saveOwners();
  }

  status(id: string): { valid: boolean; expiresAt?: string; fields?: Array<{ key: string; label: string; required?: boolean }> } {
    const session = this.sessions.get(id);
    if (!session || session.consumed || session.expiresAt <= Date.now()) return { valid: false };
    return { valid: true, expiresAt: new Date(session.expiresAt).toISOString(), fields: session.fields.map(({ key, label, required }) => ({ key, label, required })) };
  }

  private prune(): void { const now = Date.now(); for (const [id, session] of this.sessions) if (session.consumed || session.expiresAt <= now) this.sessions.delete(id); }
}
