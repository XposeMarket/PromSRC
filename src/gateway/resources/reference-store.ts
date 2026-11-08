import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { resolveConfinedStoragePath } from '../storage/storage-paths';
import { ReferenceSharingStore, migrateReferenceSharing } from './reference-sharing';

/** Canonical library metadata, never a rebuildable search index. Stage A only. */
export const AUTOMATIC_REFERENCE_CAPTURE_READY = false;
export interface ReferenceBinding { resourceId: string; versionId: string }
export interface SavedReference extends ReferenceBinding {
  id: string; operationId: string; workspace: string; title: string;
  sourceSession?: string; sourceMessage?: string; userQuote?: string;
  interpretation?: string; status: 'saved' | 'suggested' | 'confirmed';
  createdAt: string;
  updatedAt?: string; excluded?: boolean; deleted?: boolean; searchText?: string;
  notes?: string; relatedIds?: string[]; forgottenSource?: boolean;
}
export interface ReferenceSettings { capture: boolean; recall: boolean }


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
        if (version > 3) throw new Error('Reference database needs a newer Prometheus version');
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS saved_references (
            id TEXT NOT NULL, operation_id TEXT NOT NULL, workspace TEXT NOT NULL,
            resource_id TEXT NOT NULL, version_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(workspace,id), UNIQUE(workspace,operation_id));
          CREATE TABLE IF NOT EXISTS capture_operations (
            id TEXT NOT NULL, workspace TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(workspace,id));
          CREATE TABLE IF NOT EXISTS version_pins (
            version_id TEXT NOT NULL, holder_kind TEXT NOT NULL, holder_id TEXT NOT NULL,
            PRIMARY KEY(version_id, holder_kind, holder_id));
          CREATE TABLE IF NOT EXISTS reference_settings (workspace TEXT PRIMARY KEY, data TEXT NOT NULL);
        `);
        this.db.transaction(() => { migrateReferenceSharing(this.db); this.db.pragma('user_version = 3'); })();
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
      const previous = this.db.prepare('SELECT data FROM capture_operations WHERE id=? AND workspace=?').get(reference.operationId, this.workspace);
      if (previous && previous.data !== data) throw new Error('Capture operation already has different content');
      this.db.prepare('INSERT OR IGNORE INTO capture_operations VALUES (?, ?, ?, ?)').run(reference.operationId, this.workspace, 'pending', data);
      for (const binding of bindings) this.db.prepare('INSERT OR IGNORE INTO version_pins VALUES (?, ?, ?)').run(binding.versionId, 'pending', this.pendingHolder(reference.operationId));
    })();
  }
  /** Workspace-namespaced holder so one workspace's completion cannot release another's pending roots. */
  private pendingHolder(operationId: string): string { return crypto.createHash('sha256').update(this.workspace + '|' + operationId).digest('hex'); }
  complete(operationId: string): SavedReference {
    this.assertWriter();
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT data FROM capture_operations WHERE id=? AND workspace=?').get(operationId, this.workspace);
      if (!row) throw new Error('No prepared capture operation');
      const { reference, bindings } = JSON.parse(row.data) as CaptureOperation;
      this.db.prepare('INSERT OR IGNORE INTO saved_references VALUES (?, ?, ?, ?, ?, ?)').run(reference.id, operationId, this.workspace, reference.resourceId, reference.versionId, JSON.stringify(reference));
      for (const binding of bindings) this.db.prepare('INSERT OR IGNORE INTO version_pins VALUES (?, ?, ?)').run(binding.versionId, 'reference', reference.id);
      this.db.prepare('DELETE FROM version_pins WHERE holder_kind=? AND holder_id=?').run('pending', this.pendingHolder(operationId));
      this.db.prepare('UPDATE capture_operations SET state=? WHERE id=? AND workspace=?').run('complete', operationId, this.workspace);
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

  blocksResource(resourceId: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM saved_references WHERE workspace=? AND resource_id=? AND (json_extract(data,'$.excluded')=1 OR json_extract(data,'$.deleted')=1) LIMIT 1`).get(this.workspace, resourceId);
  }
  forgetSource(id: string): void {
    this.assertWriter(); const ref = this.get(id); if (!ref || ref.deleted) throw new Error('Reference unavailable');
    ref.forgottenSource = true; ref.excluded = true;
    this.db.prepare('UPDATE saved_references SET data=? WHERE workspace=? AND id=?').run(JSON.stringify(ref), this.workspace, id);
  }
  forgottenSessions(): Set<string> {
    return new Set(this.db.prepare(`SELECT DISTINCT json_extract(data,'$.sourceSession') AS session FROM saved_references WHERE workspace=? AND json_extract(data,'$.forgottenSource')=1`).all(this.workspace).map((row: any) => row.session).filter(Boolean));
  }
  private usageCache?: { at: number; bytes: number };
  storageUsage(): number {
    // Installation-managed resource bytes, not just this workspace's reference pins.
    // Cache the bounded walk so typing/search never scans the disk per request.
    if (this.usageCache && Date.now() - this.usageCache.at < 60000) return this.usageCache.bytes;
    let bytes = 0; let visited = 0;
    const walk = (dir: string, depth: number) => { if (depth > 4 || visited >= 100000) return; for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (++visited > 100000) return;
      if (entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      try { if (entry.isDirectory()) walk(file, depth + 1); else if (entry.isFile()) bytes += fs.statSync(file).size; } catch { /* Concurrent cleanup: approximate usage. */ }
    } };
    walk(this.rootDir, 0); this.usageCache = { at: Date.now(), bytes }; return bytes;
  }
  backlinks(id: string): SavedReference[] {
    return this.db.prepare(`SELECT data FROM saved_references WHERE workspace=? AND COALESCE(json_extract(data,'$.deleted'),0)=0 AND EXISTS(SELECT 1 FROM json_each(saved_references.data,'$.relatedIds') WHERE value=?) LIMIT 100`).all(this.workspace, id).map((r: any) => JSON.parse(r.data));
  }
  stats(): { total: number; excluded: number } {
    const row = this.db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN json_extract(data,'$.excluded')=1 THEN 1 ELSE 0 END),0) AS excluded FROM saved_references WHERE workspace=? AND COALESCE(json_extract(data,'$.deleted'),0)=0`).get(this.workspace);
    return { total: row.total, excluded: row.excluded };
  }
  settings(): ReferenceSettings {
    if (!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='reference_settings'").get()) return { capture: false, recall: false };
    const row = this.db.prepare('SELECT data FROM reference_settings WHERE workspace=?').get(this.workspace);
    return row ? { capture: false, recall: false, ...JSON.parse(row.data) } : { capture: false, recall: false };
  }
  setSettings(patch: Partial<ReferenceSettings>): ReferenceSettings {
    this.assertWriter(); const next = this.settings();
    for (const key of ['capture', 'recall'] as const) if (typeof patch[key] === 'boolean') next[key] = patch[key]!;
    this.db.prepare('INSERT OR REPLACE INTO reference_settings VALUES (?, ?)').run(this.workspace, JSON.stringify(next));
    return next;
  }
  list(options: { query?: string; limit?: number; offset?: number; includeExcluded?: boolean; sourceSession?: string } = {}): SavedReference[] {
    const words = String(options.query || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 12);
    // Filter inside SQLite: no full-library materialization and no stale projection resurrection.
    const predicates = ['workspace=?', `COALESCE(json_extract(data,'$.deleted'),0)=0`]; const args: any[] = [this.workspace];
    if (!options.includeExcluded) predicates.push(`COALESCE(json_extract(data,'$.excluded'),0)=0`);
    if (options.sourceSession) { predicates.push(`json_extract(data,'$.sourceSession')=?`); args.push(options.sourceSession); }
    const searchable = ['title','userQuote','interpretation','notes','searchText'].map(key => `COALESCE(json_extract(data,'$.${key}'),'')`).join(`||' '||`);
    for (const word of words) { predicates.push(`instr(lower(${searchable}),?)>0`); args.push(word); }
    args.push(Math.max(1, Math.min(100, Math.floor(options.limit || 30))), Math.max(0, Math.min(1000000, Math.floor(options.offset || 0))));
    return this.db.prepare(`SELECT data FROM saved_references WHERE ${predicates.join(' AND ')} ORDER BY rowid DESC LIMIT ? OFFSET ?`).all(...args).map((r: any) => JSON.parse(r.data));
  }
  update(id: string, patch: Partial<Pick<SavedReference, 'title' | 'userQuote' | 'interpretation' | 'status' | 'notes' | 'relatedIds' | 'excluded' | 'searchText'>>): SavedReference {
    this.assertWriter(); const ref = this.get(id); if (!ref || ref.deleted) throw new Error('Reference unavailable');
    for (const key of ['title', 'userQuote', 'interpretation', 'notes', 'searchText'] as const) {
      if (typeof patch[key] === 'string') ref[key] = patch[key]!.slice(0, key === 'searchText' ? 24000 : key === 'title' ? 500 : 16000);
    }
    if (patch.status && ['saved', 'suggested', 'confirmed'].includes(patch.status)) ref.status = patch.status;
    if (typeof patch.excluded === 'boolean') { ref.excluded = patch.excluded; if (!patch.excluded) ref.forgottenSource = false; }
    if (Array.isArray(patch.relatedIds)) ref.relatedIds = [...new Set(patch.relatedIds)].slice(0, 30).filter(target => target !== id && !!this.get(target) && !this.get(target)!.deleted);
    ref.updatedAt = new Date().toISOString();
    this.db.prepare('UPDATE saved_references SET data=? WHERE workspace=? AND id=?').run(JSON.stringify(ref), this.workspace, id);
    return ref;
  }
  remove(id: string): void {
    this.assertWriter(); const ref = this.get(id); if (!ref || ref.deleted) return;
    // Keep a source/operation tombstone: deleting does not silently re-capture it.
    ref.deleted = true; ref.excluded = true; ref.updatedAt = new Date().toISOString();
    ref.title = 'Deleted reference'; ref.userQuote = undefined; ref.interpretation = undefined; ref.searchText = undefined; ref.notes = undefined; ref.relatedIds = [];
    this.db.transaction(() => {
      this.db.prepare('UPDATE saved_references SET data=? WHERE workspace=? AND id=?').run(JSON.stringify(ref), this.workspace, id);
      this.db.prepare('DELETE FROM version_pins WHERE holder_kind=? AND holder_id=?').run('reference', id);
      this.db.prepare('DELETE FROM capture_operations WHERE workspace=? AND id=? AND state=?').run(this.workspace, ref.operationId, 'complete');
    })();
  }

  sharing(): ReferenceSharingStore { return new ReferenceSharingStore(this.db, this.workspace, () => this.assertWriter(), id => this.get(id)); }

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
