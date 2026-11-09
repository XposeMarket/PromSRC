import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export type AccessMode = 'new' | 'existing' | 'api_key' | 'otp';
export type AccessState = 'saved_not_submitted' | 'submitted_outcome_unknown' | 'verified' | 'needs_attention' | 'revoked';
export interface AccessRequest {
  id: string; sessionId: string; label: string; purpose: string; origin: string; mode: AccessMode;
  identifier?: string; expiresAt: string; status: 'pending' | 'saved' | 'cancelled' | 'expired'; credentialId?: string; replaces?: string;
}
export interface AccessCredential {
  id: string; label: string; origin: string; identifier: string; kind: 'login' | 'api_key' | 'otp';
  state: AccessState; storage: 'persistent' | 'session'; createdAt: string; lastUsedAt?: string; grants: string[];
  version: number; priorVersions: number[]; expiresAt?: string;
}
export interface AccessAudit { at: string; action: string; actor: string; outcome: string }
export interface AccessValueStore { set(key: string, value: string): void; get(key: string): string | null | undefined; delete(key: string): unknown }
export interface AccessBrokerOptions {
  directory: string; store: AccessValueStore; persistentAllowed: () => boolean; now?: () => number;
}
const ID = /^cred_[0-9a-f-]{36}$/;
const MODES: AccessMode[] = ['new', 'existing', 'api_key', 'otp'];
export class AccessError extends Error { constructor(public readonly code: string) { super(code); } }
function deny(code: string): never { throw new AccessError(code); }
function text(value: unknown, max: number): string { return typeof value === 'string' ? value.slice(0, max) : ''; }
export function exactAccessOrigin(value: unknown): string {
  let url: URL;
  try { url = new URL(String(value)); } catch { return deny('INVALID_ORIGIN'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') return deny('HTTPS_ORIGIN_REQUIRED');
  return url.origin;
}
/** Trusted gateway-owner broker. Metadata is readable; values are never returned by public operations.
 * Not an isolation boundary against other processes running as the same OS user. */
export class SecureAccessBroker {
  private requests = new Map<string, AccessRequest>();
  private credentials = new Map<string, AccessCredential>();
  private audits = new Map<string, AccessAudit[]>();
  private ephemeral = new Map<string, string>();
  private busy = new Set<string>();
  private readonly file: string;
  private readonly now: () => number;
  constructor(private readonly options: AccessBrokerOptions) {
    this.file = path.join(options.directory, 'secure-access-metadata.json');
    this.now = options.now || Date.now;
    if (fs.existsSync(this.file)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        for (const r of data.requests || []) if (typeof r.id === 'string') this.requests.set(r.id, r);
        for (const c of data.credentials || []) if (ID.test(c.id) && c.storage === 'persistent') this.credentials.set(c.id, c);
        for (const [id, events] of data.audits || []) if (ID.test(id)) this.audits.set(id, events);
      } catch { deny('METADATA_UNAVAILABLE'); }
    }
  }
  private stamp(): string { return new Date(this.now()).toISOString(); }
  private persist(): void {
    fs.mkdirSync(this.options.directory, { recursive: true, mode: 0o700 });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ version: 1, requests: [...this.requests.values()].slice(-500),
      credentials: [...this.credentials.values()].filter(c => c.storage === 'persistent'), audits: [...this.audits] }), { mode: 0o600 });
    fs.renameSync(temp, this.file);
  }
  private audit(id: string, action: string, outcome: string, actor = 'owner'): void {
    const events = this.audits.get(id) || [];
    events.push({ at: this.stamp(), action, actor, outcome });
    this.audits.set(id, events.slice(-100));
  }
  private record(id: string): AccessCredential {
    if (!ID.test(id)) return deny('INVALID_CREDENTIAL_ID');
    return this.credentials.get(id) || deny('CREDENTIAL_NOT_FOUND');
  }
  private key(c: AccessCredential, version = c.version): string { return `secure.access.owner.${c.id}.v${version}`; }
  status() { const allowed = this.options.persistentAllowed(); return { protection: allowed ? 'os_protected' : 'unprotected', persistentAllowed: allowed }; }
  create(input: { sessionId?: string; label?: string; purpose?: string; origin: string; mode: AccessMode; identifier?: string; replaces?: string }): AccessRequest {
    if (!MODES.includes(input.mode)) return deny('INVALID_MODE');
    if ([...this.requests.values()].filter(r => r.status === 'pending' && Date.parse(r.expiresAt) > this.now()).length >= 50) return deny('TOO_MANY_REQUESTS');
    const origin = exactAccessOrigin(input.origin);
    if (input.replaces) { const c = this.record(input.replaces); if (c.origin !== origin || c.kind === 'otp') deny('INVALID_REPLACEMENT'); }
    const request: AccessRequest = { id: `access_${randomUUID()}`, sessionId: text(input.sessionId, 200), label: text(input.label, 100) || new URL(origin).hostname,
      purpose: text(input.purpose, 300) || 'Sign in only; other actions need separate approval.', origin, mode: input.mode,
      identifier: text(input.identifier, 254), expiresAt: new Date(this.now() + 10 * 60_000).toISOString(), status: 'pending', replaces: input.replaces };
    this.requests.set(request.id, request); this.persist(); return structuredClone(request);
  }
  listRequests(sessionId?: string): AccessRequest[] {
    for (const r of this.requests.values()) if (r.status === 'pending' && Date.parse(r.expiresAt) <= this.now()) r.status = 'expired';
    return structuredClone([...this.requests.values()].filter(r => sessionId === undefined || r.sessionId === sessionId).slice(-100));
  }
  submit(id: string, input: { identifier?: unknown; secret?: unknown; remember?: boolean; recoveryConfirmed?: boolean; generated?: boolean }, policy: { entryOnly?: boolean } = {}): AccessCredential {
    const r = this.requests.get(id);
    if (!r || r.status !== 'pending' || Date.parse(r.expiresAt) <= this.now()) return deny('REQUEST_EXPIRED_OR_USED');
    // Pairing permits fresh entry, not replacement/regrant of an existing credential.
    if (policy.entryOnly && r.replaces) return deny('OWNER_APPROVAL_REQUIRED_FOR_REPLACEMENT');
    const secret = input.secret;
    if (typeof secret !== 'string' || secret.length < 1 || secret.length > 16384) return deny('INVALID_SECRET');
    const identifier = text(input.identifier ?? r.identifier, 254);
    if ((r.mode === 'new' || r.mode === 'existing') && !identifier) return deny('IDENTIFIER_REQUIRED');
    if (input.generated && !input.recoveryConfirmed) return deny('RECOVERY_CONFIRMATION_REQUIRED');
    if (input.remember && r.mode !== 'otp' && !this.options.persistentAllowed()) return deny('PROTECTED_STORAGE_REQUIRED');
    if (r.mode === 'new' && [...this.credentials.values()].some(c => c.origin === r.origin && c.identifier === identifier && c.kind === 'login')) return deny('ACCOUNT_ALREADY_SAVED');
    const old = r.replaces ? this.record(r.replaces) : undefined;
    if (old && this.busy.has(old.id)) return deny('CREDENTIAL_BUSY');
    const c: AccessCredential = { id: old?.id || `cred_${randomUUID()}`, label: r.label, origin: r.origin, identifier,
      kind: r.mode === 'api_key' ? 'api_key' : r.mode === 'otp' ? 'otp' : 'login',
      state: old ? 'needs_attention' : 'saved_not_submitted', storage: input.remember && r.mode !== 'otp' ? 'persistent' : 'session',
      createdAt: old?.createdAt || this.stamp(), grants: ['main'], version: old ? old.version + 1 : 1,
      priorVersions: old ? [...old.priorVersions, old.version] : [], ...(r.mode === 'otp' ? { expiresAt: new Date(this.now() + 5 * 60_000).toISOString() } : {}) };
    if (old && old.storage !== c.storage) return deny('REPLACEMENT_STORAGE_MUST_MATCH');
    const key = this.key(c);
    if (c.storage === 'persistent') this.options.store.set(key, secret); else this.ephemeral.set(key, secret);
    this.credentials.set(c.id, c); r.status = 'saved'; r.credentialId = c.id;
    this.audit(c.id, old ? 'replace' : 'save', old ? 'prior_version_retained' : 'saved'); this.persist();
    return structuredClone(c);
  }
  cancel(id: string): void { const r = this.requests.get(id); if (r?.status === 'pending') { r.status = 'cancelled'; this.persist(); } }
  list(): AccessCredential[] {
    for (const c of this.credentials.values()) if (c.kind === 'otp' && c.expiresAt && Date.parse(c.expiresAt) <= this.now()) { this.ephemeral.delete(this.key(c)); this.credentials.delete(c.id); }
    return structuredClone([...this.credentials.values()]);
  }
  events(id: string): AccessAudit[] { this.record(id); return structuredClone(this.audits.get(id) || []); }
  revoke(id: string): AccessCredential { const c = this.record(id); c.grants = []; c.state = 'revoked'; this.audit(id, 'revoke', 'future_uses_denied'); this.persist(); return structuredClone(c); }
  grants(id: string, grants: unknown): AccessCredential {
    if (!Array.isArray(grants) || grants.length !== 1 || grants[0] !== 'main') return deny('MAIN_ONLY_IN_THIS_RELEASE');
    const c = this.record(id); c.grants = ['main']; if (c.state === 'revoked') c.state = 'needs_attention';
    this.audit(id, 'grant', 'main'); this.persist(); return structuredClone(c);
  }
  delete(id: string, confirmed: boolean): void {
    if (confirmed !== true) return deny('DELETE_CONFIRMATION_REQUIRED');
    const c = this.record(id); if (this.busy.has(id)) return deny('CREDENTIAL_BUSY');
    for (const v of [...c.priorVersions, c.version]) {
      const key = this.key(c, v); if (c.storage === 'persistent') this.options.store.delete(key); else this.ephemeral.delete(key);
    }
    this.credentials.delete(id); this.audit(id, 'delete', 'local_only_provider_unchanged'); this.persist();
  }
  replace(id: string, sessionId?: string): AccessRequest {
    const c = this.record(id);
    return this.create({ label: c.label, purpose: 'Replace saved value; previous value retained until resolved.', origin: c.origin, mode: c.kind === 'api_key' ? 'api_key' : 'existing', identifier: c.identifier, replaces: id, sessionId });
  }
  /** Internal adapter only. There is deliberately no API/tool exposing this callback or its value. */
  async use(id: string, actor: string, origin: string, sink: (value: string, metadata: Readonly<AccessCredential>, check: () => void) => Promise<void>): Promise<{ credentialId: string; outcome: string }> {
    const c = this.record(id);
    if (c.expiresAt && Date.parse(c.expiresAt) <= this.now()) { this.ephemeral.delete(this.key(c)); return deny('VALUE_EXPIRED'); }
    const check = () => { if (actor !== 'main' || !c.grants.includes(actor) || c.state === 'revoked' || exactAccessOrigin(origin) !== c.origin) deny('USE_DENIED'); };
    check(); if (this.busy.has(id)) return deny('CREDENTIAL_BUSY');
    if (c.storage === 'persistent' && !this.options.persistentAllowed()) return deny('PROTECTED_STORAGE_REQUIRED');
    const secret = c.storage === 'persistent' ? this.options.store.get(this.key(c)) : this.ephemeral.get(this.key(c));
    if (!secret) return deny('VALUE_UNAVAILABLE');
    this.busy.add(id);
    try {
      check(); await sink(secret, structuredClone(c), check);
      c.lastUsedAt = this.stamp(); this.audit(id, 'use', 'filled', actor); this.persist();
      return { credentialId: id, outcome: 'filled' };
    } catch { this.audit(id, 'use', 'refused_or_interrupted', actor); this.persist(); return deny('PROTECTED_USE_FAILED'); }
    finally { this.busy.delete(id); }
  }
  markDispatched(id: string): void { const c = this.record(id); if (c.state !== 'revoked') c.state = 'submitted_outcome_unknown'; this.audit(id, 'submit', 'outcome_unknown'); this.persist(); }
  confirmOutcome(id: string, verified: boolean): AccessCredential { const c = this.record(id); if (c.state !== 'revoked') c.state = verified ? 'verified' : 'needs_attention'; this.audit(id, 'owner_confirmation', verified ? 'verified' : 'needs_attention'); this.persist(); return structuredClone(c); }
}
