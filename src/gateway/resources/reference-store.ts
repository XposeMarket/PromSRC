import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { resolveConfinedStoragePath } from '../storage/storage-paths';

/** Canonical library metadata, never a rebuildable search index. Stage A only. */
export const AUTOMATIC_REFERENCE_CAPTURE_READY = false;
export interface ReferenceBinding { resourceId: string; versionId: string }
export interface SavedReference extends ReferenceBinding {
  id: string; operationId: string; workspace: string; title: string;
  sourceSession?: string; sourceMessage?: string; userQuote?: string;
  interpretation?: string; status: 'saved' | 'suggested' | 'confirmed';
  createdAt: string;
}

// Implementation below keeps pins durable before ResourceStore can flush/prune.
interface WriterIdentity { token: string; pid: number; host: string; startedAt: string }
interface CaptureOperation { reference: SavedReference; bindings: ReferenceBinding[] }
const requireNative = createRequire(__filename);
const processStartedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();

function loadDatabase(): any { return requireNative('better-sqlite3'); }
function validateKey(value: string): void {
  if (!value || value.length > 256 || /[\u0000-\u001f]/.test(value)) throw new Error('Invalid reference identifier');
}
function durableJson(file: string, data: unknown): void {
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(data)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function readIdentity(file: string): WriterIdentity { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function isProvablyDead(holder: WriterIdentity): boolean {
  if (!holder.token || !holder.startedAt || holder.host !== os.hostname() || !Number.isInteger(holder.pid) || holder.pid <= 0) return false;
  // A live/reused PID or permission error is ambiguous: retain the lock. Never steal by age.
  try { process.kill(holder.pid, 0); return false; } catch (error: any) { return error.code === 'ESRCH'; }
}

/** Exclusive single metadata writer; other instances may only read an existing DB. */
export class ReferenceStore {
  readonly databasePath: string;
  readonly lockPath: string;
  readonly workspace: string;
  readonly writable: boolean;
  private db: any;
  private identity?: WriterIdentity;
  private closed = false;
  private owner?: ReferenceStore;

  constructor(readonly rootDir: string, workspace: string, options: { readOnly?: boolean; owner?: ReferenceStore } = {}) {
    this.rootDir = path.resolve(rootDir);
    this.workspace = path.resolve(workspace);
    this.databasePath = path.join(this.rootDir, 'references.sqlite');
    this.lockPath = path.join(this.rootDir, 'references.lock');
    if (options.owner) {
      if (options.owner.rootDir !== this.rootDir) throw new Error('Metadata owner root mismatch');
      options.owner.assertWriter();
      this.owner = options.owner;
      this.db = options.owner.db;
      this.identity = options.owner.identity;
      this.writable = true;
      return;
    }
    const Database = loadDatabase(); // Dependency failure must not leave a writer lock.
    if (!fs.existsSync(this.databasePath) && fs.existsSync(path.join(this.rootDir, 'references.required'))) throw new Error('Reference database missing; restore metadata backup before writing');
    if (!options.readOnly) {
      fs.mkdirSync(this.rootDir, { recursive: true });
      resolveConfinedStoragePath(this.rootDir, 'references.sqlite', { label: 'reference metadata' });
      resolveConfinedStoragePath(this.rootDir, 'references.lock', { label: 'reference lock' });
      this.identity = this.acquireWriter();
    }
    this.writable = Boolean(this.identity);
    try {
      resolveConfinedStoragePath(this.rootDir, 'references.sqlite', { label: 'reference metadata' });
      this.db = new Database(this.databasePath, { readonly: !this.writable, fileMustExist: !this.writable, timeout: 1000 });
      if (this.writable) {
        const marker = path.join(this.rootDir, 'references.required');
        if (!fs.existsSync(marker)) durableJson(marker, { schemaVersion: 1 });
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = FULL');
        const version = this.db.pragma('user_version', { simple: true });
        if (version > 1) throw new Error('Reference database needs a newer Prometheus version');
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS saved_references (
            id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE, workspace TEXT NOT NULL,
            resource_id TEXT NOT NULL, version_id TEXT NOT NULL, data TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS capture_operations (
            id TEXT PRIMARY KEY, workspace TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS version_pins (
            version_id TEXT NOT NULL, holder_kind TEXT NOT NULL, holder_id TEXT NOT NULL,
            PRIMARY KEY(version_id, holder_kind, holder_id));
          PRAGMA user_version = 1;
        `);
      }
    } catch (error) { this.db?.close(); this.releaseWriter(); throw error; }
  }

  private acquireWriter(): WriterIdentity | undefined {
    const identity = { token: crypto.randomUUID(), pid: process.pid, host: os.hostname(), startedAt: processStartedAt };
    try { durableJson(this.lockPath, identity); return identity; }
    catch (error: any) { if (error.code !== 'EEXIST') throw error; }
    // Serialize takeover so two contenders cannot both replace a dead writer.
    const recovery = `${this.lockPath}.recovery`;
    let fd: number;
    try { fd = fs.openSync(recovery, 'wx', 0o600); }
    catch (error: any) { if (error.code === 'EEXIST') return undefined; throw error; }
    try {
      let previous: WriterIdentity;
      try { previous = readIdentity(this.lockPath); } catch { return undefined; }
      if (!isProvablyDead(previous)) return undefined;
      if (readIdentity(this.lockPath).token !== previous.token) return undefined;
      fs.unlinkSync(this.lockPath);
      try { durableJson(this.lockPath, identity); return identity; }
      catch (error: any) { if (error.code === 'EEXIST') return undefined; throw error; }
    } finally { fs.closeSync(fd); fs.unlinkSync(recovery); }
  }

  assertWriter(): void {
    this.owner?.assertWriter();
    if (this.closed || !this.writable || !this.identity) throw new Error('Reference library is read-only: another writer owns it');
    if (readIdentity(this.lockPath).token !== this.identity.token) throw new Error('Reference writer ownership changed');
  }
  private releaseWriter(): void {
    if (!this.identity) return;
    try { if (readIdentity(this.lockPath).token === this.identity.token) fs.unlinkSync(this.lockPath); } catch { /* conservative */ }
    this.identity = undefined;
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.owner) return;
    this.db?.close();
    this.releaseWriter();
  }

  findByOperation(operationId: string): SavedReference | undefined {
    validateKey(operationId);
    const row = this.db.prepare('SELECT data FROM saved_references WHERE operation_id=? AND workspace=?').get(operationId, this.workspace);
    return row ? JSON.parse(row.data) : undefined;
  }
  get(referenceId: string): SavedReference | undefined {
    const row = this.db.prepare('SELECT data FROM saved_references WHERE id=? AND workspace=?').get(referenceId, this.workspace);
    return row ? JSON.parse(row.data) : undefined;
  }
  pendingOperation(operationId: string): CaptureOperation | undefined {
    const row = this.db.prepare('SELECT data FROM capture_operations WHERE id=? AND workspace=? AND state=?').get(operationId, this.workspace, 'pending');
    return row ? JSON.parse(row.data) : undefined;
  }
  /** Durable pending roots precede any registry flush, including crash recovery. */
  prepare(reference: SavedReference, bindings: ReferenceBinding[]): void {
    this.assertWriter();
    validateKey(reference.operationId); validateKey(reference.id);
    if (reference.workspace !== this.workspace) throw new Error('Reference workspace mismatch');
    if (!bindings.some(item => item.resourceId === reference.resourceId && item.versionId === reference.versionId)) throw new Error('Reference primary evidence must be pinned');
    for (const binding of bindings) { validateKey(binding.resourceId); validateKey(binding.versionId); }
    const data = JSON.stringify({ reference, bindings } satisfies CaptureOperation);
    this.db.transaction(() => {
      const previous = this.db.prepare('SELECT data FROM capture_operations WHERE id=?').get(reference.operationId);
      if (previous && previous.data !== data) throw new Error('Capture operation already has different content');
      this.db.prepare('INSERT OR IGNORE INTO capture_operations VALUES (?, ?, ?, ?)').run(reference.operationId, this.workspace, 'pending', data);
      for (const binding of bindings) this.db.prepare('INSERT OR IGNORE INTO version_pins VALUES (?, ?, ?)').run(binding.versionId, 'pending', reference.operationId);
    })();
  }
  complete(operationId: string): SavedReference {
    this.assertWriter();
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT data FROM capture_operations WHERE id=? AND workspace=?').get(operationId, this.workspace);
      if (!row) throw new Error('No prepared capture operation');
      const { reference, bindings } = JSON.parse(row.data) as CaptureOperation;
      this.db.prepare('INSERT OR IGNORE INTO saved_references VALUES (?, ?, ?, ?, ?, ?)').run(reference.id, operationId, this.workspace, reference.resourceId, reference.versionId, JSON.stringify(reference));
      for (const binding of bindings) this.db.prepare('INSERT OR IGNORE INTO version_pins VALUES (?, ?, ?)').run(binding.versionId, 'reference', reference.id);
      this.db.prepare('DELETE FROM version_pins WHERE holder_kind=? AND holder_id=?').run('pending', operationId);
      this.db.prepare('UPDATE capture_operations SET state=? WHERE id=?').run('complete', operationId);
      return reference;
    })();
  }
  /** Never expire pending roots by age; only complete when every durable version exists. */
  recover(isDurable: (binding: ReferenceBinding) => boolean): { completed: number; pending: number } {
    this.assertWriter();
    let completed = 0; let pending = 0;
    for (const row of this.db.prepare('SELECT id,data FROM capture_operations WHERE workspace=? AND state=?').all(this.workspace, 'pending')) {
      const operation = JSON.parse(row.data) as CaptureOperation;
      if (operation.bindings.every(isDurable)) { this.complete(row.id); completed++; } else pending++;
    }
    return { completed, pending };
  }
  async backup(destination: string): Promise<void> {
    this.assertWriter();
    // SQLite backup includes WAL-consistent metadata; caller separately backs up managed bytes.
    if (fs.existsSync(destination)) throw new Error('Reference backup destination already exists');
    await this.db.backup(destination);
  }
  pins(): Set<string> { return new Set(this.db.prepare('SELECT DISTINCT version_id FROM version_pins').all().map((row: any) => row.version_id)); }
}

/** Called by ALL ResourceStore instances. Missing DB is normal only before first use. */
export function readReferencePins(rootDir: string): Set<string> {
  const file = path.join(rootDir, 'references.sqlite');
  if (!fs.existsSync(file)) {
    if (fs.existsSync(path.join(rootDir, 'references.lock')) || fs.existsSync(path.join(rootDir, 'references.required'))) throw new Error('Reference metadata missing; retention cannot be determined');
    return new Set();
  }
  resolveConfinedStoragePath(rootDir, 'references.sqlite', { label: 'reference metadata' });
  const Database = loadDatabase();
  const db = new Database(file, { readonly: true, fileMustExist: true, timeout: 1000 });
  try { return new Set(db.prepare('SELECT DISTINCT version_id FROM version_pins').all().map((row: any) => row.version_id)); }
  finally { db.close(); }
}
