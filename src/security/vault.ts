/**
 * vault.ts — Prometheus Secret Vault
 *
 * Provides AES-256-GCM encrypted storage for all credentials.
 * Secrets are NEVER returned in logs, toString(), or JSON.stringify().
 *
 * Master key handling depends on how Prometheus is running:
 *  - Desktop app (Electron-managed): the master key is OS-sealed at rest by the
 *    Electron main process (safeStorage → DPAPI on Windows / Keychain on macOS),
 *    stored as `vault/vault.key.enc`, and handed to this gateway process in memory
 *    via stdin (see vault-key-bootstrap.ts). The plaintext key never touches disk
 *    in this mode.
 *  - Standalone (Docker / `npm run gateway`): no main process is available to seal
 *    the key, so it falls back to a local `vault/vault.key` file with NO at-rest
 *    protection. A one-time warning is logged in this mode.
 *
 * Security model:
 *  - Encrypt on write, decrypt only on explicit .get() call
 *  - All access logged with caller tag (no secret value in log)
 *  - UI/log layer should always call redact() before outputting any string
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getInjectedMasterKey } from './vault-key-bootstrap.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const ALGO        = 'aes-256-gcm';
const KEY_BYTES   = 32;
const IV_BYTES    = 16;
const KEY_ITERS   = 200_000;
const KEY_DIGEST  = 'sha512';
const VAULT_FILE  = 'vault.enc';
const MASTER_FILE = 'vault.key';
const AUDIT_FILE  = 'vault-audit.log';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VaultEntry {
  /** Encrypted payload (hex) */
  enc: string;
  /** IV (hex) */
  iv: string;
  /** Auth tag (hex) */
  tag: string;
  /** When this entry was stored (Unix ms) */
  createdAt: number;
  /** When this entry expires (Unix ms), 0 = never */
  expiresAt: number;
}

export interface VaultMetadata {
  version: 1;
  entries: Record<string, VaultEntry>;
}

// ─── SecretValue ─────────────────────────────────────────────────────────────
/**
 * Wraps a plaintext secret so it CANNOT accidentally appear in logs,
 * JSON.stringify, or console output. Call .expose() only at the exact
 * point the raw value is needed (e.g. an HTTP Authorization header).
 */
export class SecretValue {
  readonly #value: string;

  constructor(raw: string) {
    this.#value = raw;
  }

  /** Only way to get the plaintext — call only at point-of-use */
  expose(): string {
    return this.#value;
  }

  toString(): string { return '[REDACTED]'; }
  toJSON(): string   { return '[REDACTED]'; }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return 'SecretValue([REDACTED])';
  }
}

// ─── Log scrubber ─────────────────────────────────────────────────────────────
/**
 * Call scrubSecrets() on ANY string before writing to logs, sending to UI,
 * or passing to an LLM (e.g. "summarise these logs").
 */

const SECRET_PATTERNS: RegExp[] = [
  // Bearer tokens
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  // OpenAI-style keys
  /sk-[A-Za-z0-9]{20,}/g,
  // AWS access key IDs
  /AKIA[A-Z0-9]{16}/g,
  // JWTs
  /eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*/g,
  // JSON key-value pairs containing sensitive field names
  /"(?:api_key|apikey|api_token|access_token|refresh_token|secret|password|passwd|credential|token)"\s*:\s*"[^"]{6,}"/gi,
  /'(?:api_key|apikey|api_token|access_token|refresh_token|secret|password|passwd|credential|token)'\s*:\s*'[^']{6,}'/gi,
  // Query-string style
  /(?:api_key|apikey|token|secret|password)=[^\s&"']{6,}/gi,
];

function looksHighEntropy(s: string): boolean {
  if (s.length < 32) return false;
  const unique = new Set(s.replace(/[^A-Za-z0-9+/=_\-]/g, '')).size;
  return unique >= 20;
}

export function scrubSecrets(input: string): string {
  let out = input;

  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (match) => {
      const eqIdx    = match.indexOf('=');
      const colonIdx = match.indexOf(':');
      if (eqIdx    > 0 && eqIdx    < 30) return match.slice(0, eqIdx + 1)    + '[REDACTED]';
      if (colonIdx > 0 && colonIdx < 30) return match.slice(0, colonIdx + 1) + ' "[REDACTED]"';
      return '[REDACTED]';
    });
  }

  // High-entropy word catch-all
  out = out.replace(/[A-Za-z0-9+/=_\-]{32,}/g, (word) =>
    looksHighEntropy(word) ? '[REDACTED-HE]' : word
  );

  return out;
}

// ─── Fallback warning ──────────────────────────────────────────────────────────

let _warnedUnprotectedKey = false;
function warnUnprotectedKeyOnce(): void {
  if (_warnedUnprotectedKey) return;
  _warnedUnprotectedKey = true;
  console.warn(
    '[Vault] Master key stored unencrypted on disk (vault/vault.key). ' +
    'OS-backed key protection is only available in the Prometheus desktop app. ' +
    'Protect the vault directory with filesystem permissions.'
  );
}

// ─── SecretVault ──────────────────────────────────────────────────────────────

export class SecretVault {
  private readonly vaultPath: string;
  private readonly keyPath: string;
  private readonly auditPath: string;
  private masterKey: Buffer | null = null;
  private data: VaultMetadata = { version: 1, entries: {} };

  constructor(configDir: string) {
    const vaultDir = path.join(configDir, 'vault');
    if (!fs.existsSync(vaultDir)) fs.mkdirSync(vaultDir, { recursive: true });
    this.vaultPath = path.join(vaultDir, VAULT_FILE);
    this.keyPath   = path.join(vaultDir, MASTER_FILE);
    this.auditPath = path.join(vaultDir, AUDIT_FILE);
    this.loadOrInit();
  }

  // ── Key management ────────────────────────────────────────────────────────

  private loadOrInit(): void {
    this.masterKey = this.loadOrCreateMasterKey();
    this.data = this.readDiskData();
  }

  private loadOrCreateMasterKey(): Buffer {
    // Preferred path: key was OS-sealed by the Electron main process and handed to
    // us over stdin. Use it directly — never read or write a key file.
    const injected = getInjectedMasterKey();
    if (injected) return injected;

    // Fallback path (standalone / Docker): no main process to seal the key, so it
    // lives in a plaintext file alongside the vault with no at-rest protection.
    warnUnprotectedKeyOnce();
    if (fs.existsSync(this.keyPath)) {
      const hex = fs.readFileSync(this.keyPath, 'utf-8').trim();
      return Buffer.from(hex, 'hex');
    }
    const key = crypto.randomBytes(KEY_BYTES);
    // mode 0o600 = owner read/write only (no-op on Windows/NTFS)
    fs.writeFileSync(this.keyPath, key.toString('hex'), { mode: 0o600 });
    return key;
  }

  private deriveKey(salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(this.masterKey!, salt, KEY_ITERS, KEY_BYTES, KEY_DIGEST);
  }

  // ── Crypto ────────────────────────────────────────────────────────────────

  private encrypt(plaintext: string): Omit<VaultEntry, 'createdAt' | 'expiresAt'> {
    const iv     = crypto.randomBytes(IV_BYTES);
    const key    = this.deriveKey(iv);
    const cipher = crypto.createCipheriv(ALGO, key, iv) as crypto.CipherGCM;
    const enc    = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const tag    = cipher.getAuthTag();
    return { enc: enc.toString('hex'), iv: iv.toString('hex'), tag: tag.toString('hex') };
  }

  private decrypt(entry: VaultEntry): string {
    const iv      = Buffer.from(entry.iv,  'hex');
    const key     = this.deriveKey(iv);
    const decipher = crypto.createDecipheriv(ALGO, key, iv) as crypto.DecipherGCM;
    decipher.setAuthTag(Buffer.from(entry.tag, 'hex'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(entry.enc, 'hex')),
      decipher.final(),
    ]);
    return plain.toString('utf-8');
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  private readDiskData(): VaultMetadata {
    if (!fs.existsSync(this.vaultPath)) return { version: 1, entries: {} };
    try {
      const raw = fs.readFileSync(this.vaultPath, 'utf-8');
      const parsed = JSON.parse(raw) as VaultMetadata;
      if (parsed?.version !== 1 || !parsed.entries || typeof parsed.entries !== 'object') {
        return { version: 1, entries: {} };
      }
      return parsed;
    } catch {
      return { version: 1, entries: {} };
    }
  }

  private refreshFromDisk(): void {
    this.data = this.readDiskData();
  }

  private persist(options: { mergeExisting?: boolean } = {}): void {
    const mergeExisting = options.mergeExisting ?? true;
    const next: VaultMetadata = mergeExisting
      ? { version: 1, entries: { ...this.readDiskData().entries, ...this.data.entries } }
      : this.data;
    const tmpPath = `${this.vaultPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), { mode: 0o600 });
    fs.renameSync(tmpPath, this.vaultPath);
    this.data = next;
  }

  // ── Audit ─────────────────────────────────────────────────────────────────

  private audit(action: string, key: string, caller: string): void {
    const line = `${new Date().toISOString()} | ${action.padEnd(8)} | key=${key} | caller=${caller}\n`;
    try { fs.appendFileSync(this.auditPath, line); } catch { /* must not break call */ }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Store an encrypted secret.
   * @param key    Logical name (e.g. "openai.api_key")
   * @param value  Plaintext secret
   * @param caller Who is storing — recorded in audit log
   * @param ttlMs  Time-to-live ms; 0 = never expire
   */
  set(key: string, value: string, caller = 'unknown', ttlMs = 0): void {
    const { enc, iv, tag } = this.encrypt(value);
    this.data.entries[key] = {
      enc, iv, tag,
      createdAt: Date.now(),
      expiresAt: ttlMs > 0 ? Date.now() + ttlMs : 0,
    };
    this.persist();
    this.audit('SET', key, caller);
  }

  /**
   * Retrieve a secret wrapped in SecretValue (no plaintext in logs).
   * Returns null if missing or expired.
   */
  get(key: string, caller = 'unknown'): SecretValue | null {
    this.refreshFromDisk();
    const entry = this.data.entries[key];
    if (!entry) return null;
    if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
      this.delete(key, 'vault:expiry');
      return null;
    }
    this.audit('GET', key, caller);
    try {
      return new SecretValue(this.decrypt(entry));
    } catch {
      this.audit('GET_FAIL', key, caller);
      return null;
    }
  }

  /** Check existence without decrypting or emitting a GET audit event */
  has(key: string): boolean {
    this.refreshFromDisk();
    const entry = this.data.entries[key];
    if (!entry) return false;
    if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
      this.delete(key, 'vault:expiry');
      return false;
    }
    return true;
  }

  delete(key: string, caller = 'unknown'): void {
    this.refreshFromDisk();
    if (this.data.entries[key]) {
      delete this.data.entries[key];
      this.persist({ mergeExisting: false });
      this.audit('DEL', key, caller);
    }
  }

  /** List all live key names — never values */
  keys(): string[] {
    this.refreshFromDisk();
    return Object.keys(this.data.entries).filter((k) => {
      const e = this.data.entries[k];
      return !(e.expiresAt > 0 && Date.now() > e.expiresAt);
    });
  }

  /**
   * Rotate: re-encrypt with a fresh IV. Preserves original TTL.
   * Returns false if key doesn't exist.
   */
  rotate(key: string, newValue: string, caller = 'unknown'): boolean {
    this.refreshFromDisk();
    const existing = this.data.entries[key];
    if (!existing) return false;
    const ttlMs = existing.expiresAt > 0
      ? existing.expiresAt - existing.createdAt
      : 0;
    this.set(key, newValue, caller, ttlMs);
    this.audit('ROTATE', key, caller);
    return true;
  }

  /** Factory-reset: wipe all entries */
  clear(caller = 'unknown'): void {
    this.data = { version: 1, entries: {} };
    this.persist({ mergeExisting: false });
    this.audit('CLEAR', '*', caller);
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

const _vaults = new Map<string, SecretVault>();
let _defaultVaultKey: string | null = null;

export function getVault(configDir?: string): SecretVault {
  if (configDir) {
    const resolved = path.resolve(configDir);
    let vault = _vaults.get(resolved);
    if (!vault) {
      vault = new SecretVault(resolved);
      _vaults.set(resolved, vault);
    }
    if (!_defaultVaultKey) _defaultVaultKey = resolved;
    return vault;
  }

  if (!_defaultVaultKey) {
    throw new Error('[Vault] configDir required for first initialisation');
  }

  const vault = _vaults.get(_defaultVaultKey);
  if (!vault) {
    throw new Error('[Vault] default vault unavailable');
  }
  return vault;
}
