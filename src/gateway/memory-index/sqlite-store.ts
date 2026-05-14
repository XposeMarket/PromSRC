import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getActiveMemoryEmbeddingProvider, getMemoryEmbeddingStatus } from '../memory/embeddings/registry';
import { embedMemoryHash } from '../memory/embeddings/hash-provider';
import { rerankMmr } from '../memory/ranking/mmr';
import { temporalDecayMultiplier } from '../memory/ranking/temporal-decay';

type MemoryIndexSourceType =
  | 'chat_session'
  | 'chat_transcript'
  | 'chat_compaction'
  | 'task_state'
  | 'proposal_state'
  | 'cron_run'
  | 'cron_job'
  | 'schedule_state'
  | 'team_state'
  | 'project_state'
  | 'memory_root'
  | 'memory_note'
  | 'obsidian_note'
  | 'audit_misc';

type RecordItem = {
  id: string;
  sourcePath: string;
  sourceType: MemoryIndexSourceType;
  title: string;
  timestampMs: number;
  day: string;
  projectId?: string;
  durability: number;
  sourceSection?: string;
  sourceStartLine?: number;
  sourceEndLine?: number;
  contentHash?: string;
  authority?: string;
  confidence?: number;
  status?: string;
  supersedesId?: string;
};

type ChunkItem = {
  id: string;
  recordId: string;
  index: number;
  text: string;
  terms: string[];
  embedding: number[];
  sourceSection?: string;
  sourceStartLine?: number;
  sourceEndLine?: number;
  contentHash?: string;
};

type RelationItem = {
  id: string;
  fromId: string;
  toId: string;
  type: string;
  score: number;
};

type EvidenceStore = {
  version: number;
  updatedAt: string;
  records: Record<string, RecordItem>;
  chunks: Record<string, ChunkItem>;
  relations: RelationItem[];
};

type OperationalRecord = {
  id: string;
  canonicalKey: string;
  recordType: string;
  title: string;
  summary: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  day: string;
  sourceRefs: Array<{
    sourceType: string;
    sourcePath: string;
    confidence: number;
    sourceSection?: string;
    sourceStartLine?: number;
    sourceEndLine?: number;
  }>;
  projectId: string | null;
  confidence: number;
  durability: number;
  status?: string;
  supersedes: string[];
  supersededBy: string[];
  relatedIds: string[];
  exactTerms: string[];
  tags: string[];
  entities?: Record<string, string[]>;
};

type MemorySearchParams = {
  query: string;
  mode?: 'quick' | 'deep' | 'project' | 'timeline';
  limit?: number;
  sourceTypes?: MemoryIndexSourceType[];
  projectId?: string;
  dateFrom?: string;
  dateTo?: string;
  minDurability?: number;
  debug?: boolean;
  rerank?: boolean;
  queryRoute?: string;
};

type MemorySearchDiagnostics = {
  backend: string;
  queryRoute: string;
  ftsScore: number;
  vectorScore: number;
  lexicalScore: number;
  authorityScore: number;
  recencyScore: number;
  temporalDecay: number;
  durabilityScore: number;
  confidenceScore: number;
  statusPenalty: number;
  layerBoost: number;
  finalScoreBeforeMmr: number;
  finalScore: number;
  mmrScore?: number;
  matchedTerms: string[];
  embeddingProvider?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
};

type MemorySearchHit = {
  rank: number;
  score: number;
  chunkId: string;
  recordId: string;
  sourceType: MemoryIndexSourceType;
  sourcePath: string;
  timestamp: string;
  title: string;
  preview: string;
  projectId?: string;
  layer?: 'operational' | 'evidence';
  recordType?: string;
  canonicalKey?: string;
  whyMatched?: { exactTerms: string[]; entities: string[]; lexical: string[]; recordTypeReason?: string; recencyReason?: string };
  diagnostics?: MemorySearchDiagnostics;
  citation?: {
    sourceType: string;
    sourcePath: string;
    sourceSection?: string;
    sourceStartLine?: number;
    sourceEndLine?: number;
    authority: string;
    confidence: number;
    status: string;
  };
};

type MemorySearchResult = {
  query: string;
  mode: string;
  totalCandidates: number;
  hits: MemorySearchHit[];
  citations?: NonNullable<MemorySearchHit['citation']>[];
  stats: { records: number; chunks: number; indexedAt: string; backend?: string; embedding?: any; rerank?: string };
};

type ResolvedMemoryRecord = {
  layer: 'evidence' | 'operational';
  record: any | null;
  chunks: any[];
};

type SqliteDatabase = any;

const INDEX_VERSION = 1;
const EMBEDDING_DIM = 96;
const STOP = new Set([
  'a','an','and','are','as','at','be','by','for','from','had','has','have',
  'i','if','in','is','it','its','of','on','or','that','the','their','them',
  'they','this','to','was','we','were','what','when','where','who','why',
  'will','with','you','your',
]);

const SOURCE_AUTHORITY: Record<string, string> = {
  memory_root: 'durable_memory_file',
  obsidian_note: 'durable_memory_file',
  memory_note: 'explicit_user_instruction',
  proposal_state: 'verified_task_outcome',
  task_state: 'verified_task_outcome',
  project_state: 'durable_memory_file',
  chat_compaction: 'assistant_inference',
  chat_session: 'raw_transcript',
  chat_transcript: 'raw_transcript',
  schedule_state: 'verified_task_outcome',
  cron_job: 'verified_task_outcome',
  cron_run: 'raw_evidence',
  team_state: 'verified_task_outcome',
  audit_misc: 'raw_evidence',
};

const AUTHORITY_WEIGHT: Record<string, number> = {
  explicit_user_instruction: 0.42,
  user_correction: 0.44,
  durable_memory_file: 0.34,
  business_entity_file: 0.3,
  verified_task_outcome: 0.24,
  assistant_inference: 0.08,
  raw_transcript: 0,
  raw_evidence: 0,
};

let DatabaseCtor: any | undefined;
let databaseLoadError = '';

function loadBetterSqlite(): any | null {
  if (DatabaseCtor) return DatabaseCtor;
  if (databaseLoadError) return null;
  try {
    // Lazy require keeps memory_search functional when native bindings need rebuild.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    DatabaseCtor = require('better-sqlite3');
    return DatabaseCtor;
  } catch (err: any) {
    databaseLoadError = String(err?.message || err);
    return null;
  }
}

export function getSqliteMemoryStatus(workspacePath: string): {
  available: boolean;
  path: string;
  error?: string;
  records?: number;
  chunks?: number;
  indexedAt?: string;
} {
  const dbPath = sqlitePath(workspacePath);
  const Database = loadBetterSqlite();
  if (!Database) return { available: false, path: dbPath, error: databaseLoadError || 'better-sqlite3 unavailable' };
  try {
    const db = openDb(workspacePath);
    if (!db) return { available: false, path: dbPath, error: databaseLoadError || 'open failed' };
    const records = Number(db.prepare('SELECT COUNT(*) AS n FROM memory_records').get()?.n || 0);
    const chunks = Number(db.prepare('SELECT COUNT(*) AS n FROM memory_chunks').get()?.n || 0);
    const indexedAt = String(db.prepare("SELECT value FROM memory_index_state WHERE key = 'indexed_at'").get()?.value || '');
    db.close();
    return { available: true, path: dbPath, records, chunks, indexedAt };
  } catch (err: any) {
    return { available: false, path: dbPath, error: String(err?.message || err) };
  }
}

function sqlitePath(workspacePath: string): string {
  return path.join(workspacePath, 'audit', '_index', 'memory', 'memory.sqlite');
}

function openDb(workspacePath: string): SqliteDatabase | null {
  const Database = loadBetterSqlite();
  if (!Database) return null;
  const dbPath = sqlitePath(workspacePath);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initializeSchema(db);
  return db;
}

function initializeSchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_records (
      id TEXT PRIMARY KEY,
      layer TEXT NOT NULL,
      canonical_key TEXT,
      type TEXT NOT NULL,
      title TEXT,
      summary TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      source_type TEXT NOT NULL,
      source_path TEXT,
      source_section TEXT,
      source_start_line INTEGER,
      source_end_line INTEGER,
      project_id TEXT,
      entity_id TEXT,
      durability REAL DEFAULT 0.5,
      confidence REAL DEFAULT 0.8,
      authority TEXT,
      status TEXT DEFAULT 'active',
      supersedes_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      timestamp_ms INTEGER DEFAULT 0,
      day TEXT,
      content_hash TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS memory_chunks (
      id TEXT PRIMARY KEY,
      record_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      source_section TEXT,
      source_start_line INTEGER,
      source_end_line INTEGER,
      content_hash TEXT,
      embedding_json TEXT,
      FOREIGN KEY (record_id) REFERENCES memory_records(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memory_edges (
      id TEXT PRIMARY KEY,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      confidence REAL DEFAULT 0.8,
      score REAL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_embeddings (
      record_id TEXT PRIMARY KEY,
      embedding BLOB NOT NULL,
      provider_id TEXT NOT NULL DEFAULT 'hash',
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL DEFAULT 96,
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (record_id) REFERENCES memory_records(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memory_index_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_memory_records_layer ON memory_records(layer);
    CREATE INDEX IF NOT EXISTS idx_memory_records_type ON memory_records(type);
    CREATE INDEX IF NOT EXISTS idx_memory_records_project ON memory_records(project_id);
    CREATE INDEX IF NOT EXISTS idx_memory_records_source_type ON memory_records(source_type);
    CREATE INDEX IF NOT EXISTS idx_memory_records_status ON memory_records(status);
    CREATE INDEX IF NOT EXISTS idx_memory_chunks_record ON memory_chunks(record_id);
    CREATE INDEX IF NOT EXISTS idx_memory_edges_from ON memory_edges(from_id);
    CREATE INDEX IF NOT EXISTS idx_memory_edges_to ON memory_edges(to_id);
  `);

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      record_id UNINDEXED,
      title,
      summary,
      content,
      canonical_key,
      source_path,
      tags
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunk_fts USING fts5(
      chunk_id UNINDEXED,
      record_id UNINDEXED,
      text
    );
  `);

  const embeddingColumns = new Set(
    db.prepare('PRAGMA table_info(memory_embeddings)').all().map((row: any) => String(row.name)),
  );
  if (!embeddingColumns.has('provider_id')) db.exec("ALTER TABLE memory_embeddings ADD COLUMN provider_id TEXT NOT NULL DEFAULT 'hash'");
  if (!embeddingColumns.has('dimensions')) db.exec('ALTER TABLE memory_embeddings ADD COLUMN dimensions INTEGER NOT NULL DEFAULT 96');
}

function norm(s: string): string {
  return String(s || '').replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function stem(t: string): string {
  let x = t.toLowerCase();
  if (x.endsWith('ing') && x.length > 5) x = x.slice(0, -3);
  else if (x.endsWith('ed') && x.length > 4) x = x.slice(0, -2);
  else if (x.endsWith('s') && x.length > 3) x = x.slice(0, -1);
  return x;
}

function terms(s: string): string[] {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map(v => stem(v.trim()))
    .filter(v => v.length > 2 && !STOP.has(v));
}

function uniqTop(arr: string[], n: number): string[] {
  const m = new Map<string, number>();
  for (const a of arr) m.set(a, (m.get(a) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

function hashToDim(token: string): number {
  const h = crypto.createHash('sha1').update(token).digest();
  return ((h[0] << 8) + h[1]) % EMBEDDING_DIM;
}

function embedTerms(ts: string[]): number[] {
  return embedMemoryHash(ts.join(' '));
}

function cosine(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0;
  let dot = 0;
  let ma = 0;
  let mb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    ma += a[i] * a[i];
    mb += b[i] * b[i];
  }
  if (!ma || !mb) return 0;
  return dot / (Math.sqrt(ma) * Math.sqrt(mb));
}

function preview(s: string): string {
  const x = norm(s).replace(/\n/g, ' ');
  return x.length <= 260 ? x : `${x.slice(0, 257)}...`;
}

function contentHash(text: string): string {
  return crypto.createHash('sha1').update(String(text || '')).digest('hex');
}

function vectorToBlob(vector: number[]): Buffer {
  const dimensions = Math.max(1, vector.length || EMBEDDING_DIM);
  const arr = new Float32Array(dimensions);
  for (let i = 0; i < dimensions; i += 1) arr[i] = Number(vector[i] || 0);
  return Buffer.from(arr.buffer);
}

function blobToVector(blob: Buffer | null | undefined): number[] {
  if (!blob) return [];
  const view = new Float32Array(blob.buffer, blob.byteOffset, Math.floor(blob.byteLength / 4));
  return Array.from(view);
}

function sourceAuthority(sourceType: string, layer: 'evidence' | 'operational'): string {
  if (layer === 'operational' && sourceType === 'memory_note') return 'explicit_user_instruction';
  if (layer === 'operational' && sourceType === 'memory_root') return 'durable_memory_file';
  return SOURCE_AUTHORITY[sourceType] || 'raw_evidence';
}

function parseDate(v?: string, end = false): number | null {
  const s = String(v || '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(`${s}T${end ? '23:59:59.999' : '00:00:00.000'}Z`);
  const d = Date.parse(s);
  return Number.isFinite(d) ? d : null;
}

function recency(ts: number, now: number): number {
  const days = Math.max(0, (now - ts) / 86400000);
  if (days <= 1) return 1;
  if (days >= 180) return 0.1;
  return Math.max(0.1, 1 - days / 180);
}

function statusPenalty(status: string): number {
  const s = String(status || 'active').toLowerCase();
  if (s === 'superseded' || s === 'archived') return -0.65;
  if (s === 'rejected' || s === 'failed') return -0.25;
  return 0;
}

function ftsQuery(query: string): string {
  const qTerms = uniqTop(terms(query), 12);
  if (!qTerms.length) return '';
  return qTerms.map((term) => `${term.replace(/"/g, '""')}*`).join(' OR ');
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return 'null';
  }
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try {
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function readOperationalRecords(workspacePath: string): OperationalRecord[] {
  const p = path.join(workspacePath, 'audit', '_index', 'memory', 'operational', 'records.json');
  if (!fs.existsSync(p)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return Object.values(parsed?.records || {}) as OperationalRecord[];
  } catch {
    return [];
  }
}

function makeOperationalChunks(record: OperationalRecord): Array<{ id: string; index: number; text: string }> {
  return [record.summary, record.body]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .map((text, index) => ({ id: `${record.id}:chunk:${index}`, index, text }));
}

export function syncSqliteMemoryIndex(workspacePath: string, store: EvidenceStore): {
  ok: boolean;
  path: string;
  records: number;
  chunks: number;
  error?: string;
} {
  const db = openDb(workspacePath);
  const dbPath = sqlitePath(workspacePath);
  if (!db) return { ok: false, path: dbPath, records: 0, chunks: 0, error: databaseLoadError || 'better-sqlite3 unavailable' };

  const operational = readOperationalRecords(workspacePath);
  const nowIso = new Date().toISOString();
  let recordCount = 0;
  let chunkCount = 0;
  const chunksByRecord = new Map<string, any[]>();
  for (const chunk of Object.values(store.chunks || {})) {
    if (!chunksByRecord.has(chunk.recordId)) chunksByRecord.set(chunk.recordId, []);
    chunksByRecord.get(chunk.recordId)?.push(chunk);
  }
  for (const chunks of chunksByRecord.values()) {
    chunks.sort((a, b) => a.index - b.index);
  }

  const tx = db.transaction(() => {
    db.exec(`
      DELETE FROM memory_chunk_fts;
      DELETE FROM memory_fts;
      DELETE FROM memory_embeddings;
      DELETE FROM memory_edges;
      DELETE FROM memory_chunks;
      DELETE FROM memory_records;
    `);

    const insertRecord = db.prepare(`
      INSERT INTO memory_records (
        id, layer, canonical_key, type, title, summary, content, source_type, source_path,
        source_section, source_start_line, source_end_line, project_id, entity_id, durability,
        confidence, authority, status, supersedes_id, created_at, updated_at, timestamp_ms,
        day, content_hash, metadata_json
      ) VALUES (
        @id, @layer, @canonical_key, @type, @title, @summary, @content, @source_type, @source_path,
        @source_section, @source_start_line, @source_end_line, @project_id, @entity_id, @durability,
        @confidence, @authority, @status, @supersedes_id, @created_at, @updated_at, @timestamp_ms,
        @day, @content_hash, @metadata_json
      )
    `);
    const insertChunk = db.prepare(`
      INSERT INTO memory_chunks (
        id, record_id, chunk_index, text, source_section, source_start_line, source_end_line, content_hash, embedding_json
      ) VALUES (@id, @record_id, @chunk_index, @text, @source_section, @source_start_line, @source_end_line, @content_hash, @embedding_json)
    `);
    const insertRecordFts = db.prepare(`
      INSERT INTO memory_fts (record_id, title, summary, content, canonical_key, source_path, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertChunkFts = db.prepare(`
      INSERT INTO memory_chunk_fts (chunk_id, record_id, text)
      VALUES (?, ?, ?)
    `);
    const insertEmbedding = db.prepare(`
      INSERT INTO memory_embeddings (record_id, embedding, provider_id, model, dimensions, content_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertEdge = db.prepare(`
      INSERT INTO memory_edges (id, from_id, to_id, relation, confidence, score, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const record of Object.values(store.records || {})) {
      const chunks = chunksByRecord.get(record.id) || [];
      const content = chunks.map((chunk) => chunk.text).join('\n\n');
      const hash = record.contentHash || contentHash(content || record.title || record.id);
      const authority = record.authority || sourceAuthority(record.sourceType, 'evidence');
      insertRecord.run({
        id: record.id,
        layer: 'evidence',
        canonical_key: null,
        type: record.sourceType,
        title: record.title || record.id,
        summary: preview(content),
        content,
        source_type: record.sourceType,
        source_path: record.sourcePath,
        source_section: record.sourceSection || null,
        source_start_line: record.sourceStartLine || null,
        source_end_line: record.sourceEndLine || null,
        project_id: record.projectId || null,
        entity_id: null,
        durability: Number(record.durability || 0.5),
        confidence: Number(record.confidence || 0.8),
        authority,
        status: record.status || 'active',
        supersedes_id: record.supersedesId || null,
        created_at: new Date(record.timestampMs || 0).toISOString(),
        updated_at: new Date(record.timestampMs || 0).toISOString(),
        timestamp_ms: Number(record.timestampMs || 0),
        day: record.day || '',
        content_hash: hash,
        metadata_json: safeJson(record),
      });
      insertRecordFts.run(record.id, record.title || '', preview(content), content, '', record.sourcePath || '', record.sourceType || '');
      const recVector = embedTerms(uniqTop(terms(`${record.title}\n${content}`), 96));
      insertEmbedding.run(record.id, vectorToBlob(recVector), 'hash', 'prometheus-hash-terms-v1', recVector.length, hash, nowIso);
      recordCount += 1;

      for (const chunk of chunks) {
        const chunkHash = chunk.contentHash || contentHash(chunk.text);
        insertChunk.run({
          id: chunk.id,
          record_id: record.id,
          chunk_index: chunk.index,
          text: chunk.text,
          source_section: chunk.sourceSection || record.sourceSection || null,
          source_start_line: chunk.sourceStartLine || null,
          source_end_line: chunk.sourceEndLine || null,
          content_hash: chunkHash,
          embedding_json: safeJson(chunk.embedding || []),
        });
        insertChunkFts.run(chunk.id, record.id, chunk.text);
        chunkCount += 1;
      }
    }

    for (const record of operational) {
      const source = record.sourceRefs?.[0] || { sourceType: 'audit_misc', sourcePath: '', confidence: 0.8 };
      const timestampMs = Date.parse(record.updatedAt || record.createdAt || '');
      const content = [record.summary, record.body].filter(Boolean).join('\n\n');
      const hash = contentHash(`${record.canonicalKey}\n${content}`);
      const status = record.supersededBy?.length ? 'superseded' : (record.status || 'active');
      const authority = sourceAuthority(String(source.sourceType || 'audit_misc'), 'operational');
      insertRecord.run({
        id: record.id,
        layer: 'operational',
        canonical_key: record.canonicalKey,
        type: record.recordType,
        title: record.title || record.canonicalKey,
        summary: record.summary || '',
        content: record.body || record.summary || '',
        source_type: source.sourceType || 'audit_misc',
        source_path: source.sourcePath || '',
        source_section: source.sourceSection || null,
        source_start_line: source.sourceStartLine || null,
        source_end_line: source.sourceEndLine || null,
        project_id: record.projectId || null,
        entity_id: null,
        durability: Number(record.durability || 0.5),
        confidence: Number(record.confidence || source.confidence || 0.8),
        authority,
        status,
        supersedes_id: record.supersedes?.[0] || null,
        created_at: record.createdAt || new Date(Number.isFinite(timestampMs) ? timestampMs : 0).toISOString(),
        updated_at: record.updatedAt || new Date(Number.isFinite(timestampMs) ? timestampMs : 0).toISOString(),
        timestamp_ms: Number.isFinite(timestampMs) ? timestampMs : 0,
        day: record.day || '',
        content_hash: hash,
        metadata_json: safeJson(record),
      });
      insertRecordFts.run(
        record.id,
        record.title || '',
        record.summary || '',
        record.body || '',
        record.canonicalKey || '',
        source.sourcePath || '',
        [...(record.tags || []), ...(record.exactTerms || [])].join(' '),
      );
      const recVector = embedTerms(uniqTop(terms(`${record.title}\n${record.summary}\n${record.body}\n${(record.tags || []).join(' ')}`), 96));
      insertEmbedding.run(record.id, vectorToBlob(recVector), 'hash', 'prometheus-hash-terms-v1', recVector.length, hash, nowIso);
      recordCount += 1;

      for (const chunk of makeOperationalChunks(record)) {
        insertChunk.run({
          id: chunk.id,
          record_id: record.id,
          chunk_index: chunk.index,
          text: chunk.text,
          source_section: source.sourceSection || null,
          source_start_line: source.sourceStartLine || null,
          source_end_line: source.sourceEndLine || null,
          content_hash: contentHash(chunk.text),
          embedding_json: safeJson(embedTerms(uniqTop(terms(chunk.text), 96))),
        });
        insertChunkFts.run(chunk.id, record.id, chunk.text);
        chunkCount += 1;
      }

      for (const relatedId of record.relatedIds || []) {
        insertEdge.run(`edge_${record.id}_${relatedId}`, record.id, relatedId, 'related', 0.82, 0.82, nowIso);
      }
      for (const supersededId of record.supersedes || []) {
        insertEdge.run(`sup_${record.id}_${supersededId}`, record.id, supersededId, 'supersedes', 0.95, 1, nowIso);
      }
    }

    for (const edge of store.relations || []) {
      insertEdge.run(edge.id, edge.fromId, edge.toId, edge.type, 0.8, Number(edge.score || 0), nowIso);
    }

    db.prepare('INSERT OR REPLACE INTO memory_index_state (key, value) VALUES (?, ?)').run('version', String(INDEX_VERSION));
    db.prepare('INSERT OR REPLACE INTO memory_index_state (key, value) VALUES (?, ?)').run('indexed_at', store.updatedAt || nowIso);
    db.prepare('INSERT OR REPLACE INTO memory_index_state (key, value) VALUES (?, ?)').run('embedding_model', 'prometheus-hash-terms-v1');
    db.prepare('INSERT OR REPLACE INTO memory_index_state (key, value) VALUES (?, ?)').run('embedding_provider', 'hash');
  });

  try {
    tx();
    return { ok: true, path: dbPath, records: recordCount, chunks: chunkCount };
  } catch (err: any) {
    return { ok: false, path: dbPath, records: 0, chunks: 0, error: String(err?.message || err) };
  } finally {
    try { db.close(); } catch {}
  }
}

function rowToHit(
  row: any,
  score: number,
  rank: number,
  why: MemorySearchHit['whyMatched'],
  chunkText?: string,
  diagnostics?: MemorySearchDiagnostics,
): MemorySearchHit {
  const metadata = parseJson<any>(row.metadata_json, {});
  const sourceStartLine = Number(row.source_start_line || metadata.sourceStartLine || 0) || undefined;
  const sourceEndLine = Number(row.source_end_line || metadata.sourceEndLine || 0) || undefined;
  return {
    rank,
    score: Number(score.toFixed(4)),
    chunkId: String(row.chunk_id || row.id || ''),
    recordId: String(row.id || ''),
    sourceType: String(row.source_type || 'audit_misc') as MemoryIndexSourceType,
    sourcePath: String(row.source_path || ''),
    timestamp: row.updated_at || row.created_at || new Date(Number(row.timestamp_ms || 0)).toISOString(),
    title: String(row.title || row.canonical_key || row.id || 'Memory record'),
    preview: preview(chunkText || row.summary || row.content || ''),
    projectId: row.project_id || undefined,
    layer: row.layer === 'operational' ? 'operational' : 'evidence',
    recordType: row.type || undefined,
    canonicalKey: row.canonical_key || undefined,
    whyMatched: why,
    diagnostics,
    citation: {
      sourceType: String(row.source_type || 'audit_misc'),
      sourcePath: String(row.source_path || ''),
      sourceSection: row.source_section || metadata.sourceSection || undefined,
      sourceStartLine,
      sourceEndLine,
      authority: String(row.authority || 'raw_evidence'),
      confidence: Number(row.confidence || 0.8),
      status: String(row.status || 'active'),
    },
  };
}

function scoreRow(
  row: any,
  qEmbedding: number[],
  matchedTerms: string[],
  ftsScore: number,
  now: number,
  recencyBias: boolean,
  queryRoute: string,
  embeddingProvider?: string,
  embeddingModel?: string,
): { score: number; diagnostics: MemorySearchDiagnostics; vector: number[] } {
  const vec = blobToVector(row.embedding);
  const sem = qEmbedding.length ? Math.max(0, cosine(qEmbedding, vec)) : 0.25;
  const rc = recency(Number(row.timestamp_ms || 0), now);
  const temporal = temporalDecayMultiplier({
    timestampMs: Number(row.timestamp_ms || 0),
    nowMs: now,
    sourceType: row.source_type,
    sourcePath: row.source_path,
    recordType: row.type,
    authority: row.authority,
    status: row.status,
  });
  const authority = AUTHORITY_WEIGHT[String(row.authority || '')] ?? 0;
  const layerBoost = row.layer === 'operational' ? 0.38 : 0;
  const recencyWeight = recencyBias ? 0.28 : 0.12;
  const durabilityScore = Number(row.durability || 0.5) * 0.22;
  const confidenceScore = Number(row.confidence || 0.8) * 0.12;
  const penalty = statusPenalty(String(row.status || 'active'));
  const rawScore = (
    ftsScore * 0.8 +
    sem * 0.62 +
    matchedTerms.length * 0.08 +
    durabilityScore +
    confidenceScore +
    rc * recencyWeight +
    authority +
    layerBoost +
    penalty
  );
  const score = rawScore * temporal;
  return {
    score,
    vector: vec,
    diagnostics: {
      backend: 'sqlite-local',
      queryRoute,
      ftsScore: Number(ftsScore.toFixed(4)),
      vectorScore: Number(sem.toFixed(4)),
      lexicalScore: Number((matchedTerms.length * 0.08).toFixed(4)),
      authorityScore: Number(authority.toFixed(4)),
      recencyScore: Number((rc * recencyWeight).toFixed(4)),
      temporalDecay: Number(temporal.toFixed(4)),
      durabilityScore: Number(durabilityScore.toFixed(4)),
      confidenceScore: Number(confidenceScore.toFixed(4)),
      statusPenalty: Number(penalty.toFixed(4)),
      layerBoost: Number(layerBoost.toFixed(4)),
      finalScoreBeforeMmr: Number(score.toFixed(4)),
      finalScore: Number(score.toFixed(4)),
      matchedTerms,
      embeddingProvider: embeddingProvider || row.provider_id || 'hash',
      embeddingModel: embeddingModel || row.model || 'prometheus-hash-terms-v1',
      embeddingDimensions: Number(row.dimensions || vec.length || qEmbedding.length || EMBEDDING_DIM),
    },
  };
}

function recordFilters(params: MemorySearchParams): { where: string[]; values: any[] } {
  const where: string[] = [];
  const values: any[] = [];
  const sourceTypes = params.sourceTypes || [];
  if (sourceTypes.length) {
    where.push(`r.source_type IN (${sourceTypes.map(() => '?').join(',')})`);
    values.push(...sourceTypes);
  }
  if (params.projectId) {
    where.push('r.project_id = ?');
    values.push(params.projectId);
  }
  const from = parseDate(params.dateFrom);
  if (from !== null) {
    where.push('r.timestamp_ms >= ?');
    values.push(from);
  }
  const to = parseDate(params.dateTo, true);
  if (to !== null) {
    where.push('r.timestamp_ms <= ?');
    values.push(to);
  }
  if (Number.isFinite(Number(params.minDurability))) {
    where.push('r.durability >= ?');
    values.push(Number(params.minDurability));
  }
  return { where, values };
}

type SqliteSearchVector = {
  vector: number[];
  providerId: string;
  model: string;
  dimensions: number;
};

function searchSqliteMemoryIndexWithVector(workspacePath: string, params: MemorySearchParams, queryVector?: SqliteSearchVector): MemorySearchResult | null {
  const db = openDb(workspacePath);
  if (!db) return null;
  try {
    const recordCount = Number(db.prepare('SELECT COUNT(*) AS n FROM memory_records').get()?.n || 0);
    if (!recordCount) return null;

    const q = String(params.query || '').trim();
    const mode = String(params.mode || 'quick');
    const limit = Math.max(1, Math.min(50, Number(params.limit || 8)));
    const qTerms = uniqTop(terms(q), 24);
    const qEmbedding = queryVector?.vector?.length ? queryVector.vector : embedTerms(qTerms);
    const query = ftsQuery(q);
    const now = Date.now();
    const recencyBias = mode === 'deep' || mode === 'timeline';
    const filters = recordFilters(params);
    const queryRoute = String(params.queryRoute || 'tool_manual');
    const candidates = new Map<string, { row: any; chunkText?: string; fts: number; lexical: string[] }>();

    if (query) {
      const where = filters.where.length ? `AND ${filters.where.join(' AND ')}` : '';
      const recordRows = db.prepare(`
        SELECT r.*, e.embedding, e.provider_id, e.model, e.dimensions, bm25(memory_fts) AS rank_score
        FROM memory_fts
        JOIN memory_records r ON r.id = memory_fts.record_id
        LEFT JOIN memory_embeddings e ON e.record_id = r.id
        WHERE memory_fts MATCH ? ${where}
        ORDER BY rank_score
        LIMIT 220
      `).all(query, ...filters.values);
      for (const row of recordRows) {
        const fts = 1 / (1 + Math.abs(Number(row.rank_score || 0)));
        candidates.set(row.id, { row, fts, lexical: qTerms.filter((term) => String(row.content || row.summary || '').toLowerCase().includes(term)) });
      }

      const chunkRows = db.prepare(`
        SELECT r.*, c.id AS chunk_id, c.text AS chunk_text, c.source_section AS chunk_source_section,
               c.source_start_line AS chunk_source_start_line, c.source_end_line AS chunk_source_end_line,
               e.embedding, e.provider_id, e.model, e.dimensions, bm25(memory_chunk_fts) AS rank_score
        FROM memory_chunk_fts
        JOIN memory_chunks c ON c.id = memory_chunk_fts.chunk_id
        JOIN memory_records r ON r.id = c.record_id
        LEFT JOIN memory_embeddings e ON e.record_id = r.id
        WHERE memory_chunk_fts MATCH ? ${where}
        ORDER BY rank_score
        LIMIT 260
      `).all(query, ...filters.values);
      for (const row of chunkRows) {
        const existing = candidates.get(row.id);
        const fts = 1 / (1 + Math.abs(Number(row.rank_score || 0)));
        const lexical = qTerms.filter((term) => String(row.chunk_text || '').toLowerCase().includes(term));
        const mergedRow = {
          ...row,
          source_section: row.chunk_source_section || row.source_section,
          source_start_line: row.chunk_source_start_line || row.source_start_line,
          source_end_line: row.chunk_source_end_line || row.source_end_line,
        };
        if (!existing || fts > existing.fts) candidates.set(row.id, { row: mergedRow, chunkText: row.chunk_text, fts, lexical });
      }
    }

    if (!candidates.size || mode === 'deep' || mode === 'timeline') {
      const where = filters.where.length ? `WHERE ${filters.where.join(' AND ')}` : '';
      const rows = db.prepare(`
        SELECT r.*, e.embedding, e.provider_id, e.model, e.dimensions
        FROM memory_records r
        LEFT JOIN memory_embeddings e ON e.record_id = r.id
        ${where}
        LIMIT ${mode === 'deep' || mode === 'timeline' ? 5000 : 600}
      `).all(...filters.values);
      for (const row of rows) {
        if (candidates.has(row.id)) continue;
        const text = `${row.title || ''} ${row.summary || ''} ${row.content || ''}`;
        const rowTerms = new Set(terms(text));
        const lexical = qTerms.filter((term) => rowTerms.has(term));
        candidates.set(row.id, { row, fts: lexical.length ? lexical.length / Math.max(1, qTerms.length) : 0.05, lexical });
      }
    }

    const ranked = [...candidates.values()]
      .map((entry) => {
        const scored = scoreRow(
          entry.row,
          qEmbedding,
          entry.lexical,
          entry.fts,
          now,
          recencyBias,
          queryRoute,
          queryVector?.providerId,
          queryVector?.model,
        );
        return { entry, score: scored.score, diagnostics: scored.diagnostics, vector: scored.vector };
      })
      .filter(({ score }) => score > 0.02)
      .sort((a, b) => {
        if (mode === 'timeline') return Number(a.entry.row.timestamp_ms || 0) - Number(b.entry.row.timestamp_ms || 0);
        return b.score - a.score || Number(b.entry.row.timestamp_ms || 0) - Number(a.entry.row.timestamp_ms || 0);
      });

    const reranked = mode === 'timeline' || params.rerank === false
      ? ranked.slice(0, limit)
      : rerankMmr(
          ranked.slice(0, 50).map(item => ({
            ...item,
            text: `${item.entry.row.title || ''}\n${item.entry.chunkText || item.entry.row.summary || item.entry.row.content || ''}`,
          })),
          limit,
        ).map(item => {
          const diagnostics = {
            ...item.diagnostics,
            mmrScore: item.mmrScore,
            finalScore: Number((item.mmrScore ?? item.score).toFixed(4)),
          };
          return { ...item, diagnostics, score: diagnostics.finalScore };
        });

    const hits = reranked
      .map(({ entry, score, diagnostics }, index) => rowToHit(entry.row, score, index + 1, {
        exactTerms: [],
        entities: [],
        lexical: entry.lexical,
        recordTypeReason: entry.row.layer === 'operational' ? `authority:${entry.row.authority || 'operational'}` : undefined,
        recencyReason: recencyBias ? 'recency bias' : undefined,
      }, entry.chunkText, diagnostics));

    const chunks = Number(db.prepare('SELECT COUNT(*) AS n FROM memory_chunks').get()?.n || 0);
    const indexedAt = String(db.prepare("SELECT value FROM memory_index_state WHERE key = 'indexed_at'").get()?.value || '');
    const embeddingProvider = queryVector?.providerId || String(db.prepare("SELECT value FROM memory_index_state WHERE key = 'embedding_provider'").get()?.value || 'hash');
    const embeddingModel = queryVector?.model || String(db.prepare("SELECT value FROM memory_index_state WHERE key = 'embedding_model'").get()?.value || 'prometheus-hash-terms-v1');
    return {
      query: q,
      mode,
      totalCandidates: candidates.size,
      hits,
      citations: hits.map((hit) => hit.citation).filter(Boolean) as NonNullable<MemorySearchHit['citation']>[],
      stats: {
        records: recordCount,
        chunks,
        indexedAt,
        backend: 'sqlite_fts_vector_hybrid',
        embedding: {
          provider: embeddingProvider,
          model: embeddingModel,
          dimensions: queryVector?.dimensions || undefined,
        },
        rerank: mode === 'timeline' || params.rerank === false ? 'disabled' : 'mmr',
      },
    };
  } finally {
    try { db.close(); } catch {}
  }
}

export function searchSqliteMemoryIndex(workspacePath: string, params: MemorySearchParams): MemorySearchResult | null {
  const hashVector = {
    vector: embedMemoryHash(String(params.query || '')),
    providerId: 'hash',
    model: 'prometheus-hash-terms-v1',
    dimensions: EMBEDDING_DIM,
  };
  return searchSqliteMemoryIndexWithVector(workspacePath, params, hashVector);
}

export async function searchSqliteMemoryIndexAsync(workspacePath: string, params: MemorySearchParams): Promise<MemorySearchResult | null> {
  try {
    const provider = await getActiveMemoryEmbeddingProvider();
    const embedded = await provider.embedQuery(String(params.query || ''));
    return searchSqliteMemoryIndexWithVector(workspacePath, params, {
      vector: embedded.vector,
      providerId: embedded.providerId,
      model: embedded.model,
      dimensions: embedded.dimensions,
    });
  } catch {
    return searchSqliteMemoryIndex(workspacePath, params);
  }
}

export function readSqliteMemoryRecord(workspacePath: string, recordId: string): ResolvedMemoryRecord | null {
  const db = openDb(workspacePath);
  if (!db) return null;
  try {
    const record = db.prepare('SELECT * FROM memory_records WHERE id = ? OR canonical_key = ?').get(recordId, recordId);
    if (!record) return null;
    const metadata = parseJson<any>(record.metadata_json, {});
    const chunks = db.prepare('SELECT * FROM memory_chunks WHERE record_id = ? ORDER BY chunk_index ASC').all(record.id);
    return {
      layer: record.layer === 'operational' ? 'operational' : 'evidence',
      record: {
        ...metadata,
        id: record.id,
        layer: record.layer,
        canonicalKey: record.canonical_key || metadata.canonicalKey,
        recordType: record.type,
        title: record.title,
        summary: record.summary,
        body: record.content,
        sourceType: record.source_type,
        sourcePath: record.source_path,
        sourceSection: record.source_section || undefined,
        sourceStartLine: record.source_start_line || undefined,
        sourceEndLine: record.source_end_line || undefined,
        projectId: record.project_id || null,
        durability: record.durability,
        confidence: record.confidence,
        authority: record.authority,
        status: record.status,
        supersedesId: record.supersedes_id || undefined,
        timestampMs: record.timestamp_ms,
        timestamp: record.updated_at || record.created_at,
        contentHash: record.content_hash,
      },
      chunks: chunks.map((chunk: any) => ({
        id: chunk.id,
        recordId: chunk.record_id,
        index: chunk.chunk_index,
        text: chunk.text,
        sourceSection: chunk.source_section || undefined,
        sourceStartLine: chunk.source_start_line || undefined,
        sourceEndLine: chunk.source_end_line || undefined,
        contentHash: chunk.content_hash,
      })),
    };
  } finally {
    try { db.close(); } catch {}
  }
}

export async function backfillSqliteMemoryEmbeddings(workspacePath: string, options?: {
  limit?: number;
  provider?: string;
  force?: boolean;
}): Promise<{
  ok: boolean;
  provider: string;
  model: string;
  dimensions?: number;
  scanned: number;
  updated: number;
  skipped: number;
  error?: string;
}> {
  const db = openDb(workspacePath);
  if (!db) return { ok: false, provider: 'none', model: '', scanned: 0, updated: 0, skipped: 0, error: databaseLoadError || 'better-sqlite3 unavailable' };
  try {
    const provider = await getActiveMemoryEmbeddingProvider(options?.provider);
    if (provider.id === 'hash' && !options?.force) {
      const status = await getMemoryEmbeddingStatus();
      return {
        ok: true,
        provider: 'hash',
        model: 'prometheus-hash-terms-v1',
        scanned: 0,
        updated: 0,
        skipped: 0,
        error: `No real embedding provider available. Active fallback is hash. Status: ${JSON.stringify(status.providers)}`,
      };
    }
    const limit = Math.max(1, Math.min(5000, Number(options?.limit || 500)));
    const rows = db.prepare(`
      SELECT r.id, r.title, r.summary, r.content, r.content_hash, e.provider_id, e.model
      FROM memory_records r
      LEFT JOIN memory_embeddings e ON e.record_id = r.id
      WHERE (? = 1 OR e.provider_id IS NULL OR e.provider_id = 'hash' OR e.provider_id != ? OR e.content_hash != r.content_hash)
      ORDER BY r.updated_at DESC
      LIMIT ?
    `).all(options?.force ? 1 : 0, provider.id, limit);
    const update = db.prepare(`
      INSERT INTO memory_embeddings (record_id, embedding, provider_id, model, dimensions, content_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(record_id) DO UPDATE SET
        embedding = excluded.embedding,
        provider_id = excluded.provider_id,
        model = excluded.model,
        dimensions = excluded.dimensions,
        content_hash = excluded.content_hash,
        created_at = excluded.created_at
    `);
    let updated = 0;
    let skipped = 0;
    const batchSize = 32;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const texts = batch.map((row: any) => `${row.title || ''}\n${row.summary || ''}\n${row.content || ''}`.trim());
      const vectors = await provider.embedBatch(texts);
      const tx = db.transaction(() => {
        for (let j = 0; j < batch.length; j += 1) {
          const row = batch[j];
          const embedding = vectors[j];
          if (!embedding?.vector?.length) {
            skipped += 1;
            continue;
          }
          update.run(
            row.id,
            vectorToBlob(embedding.vector),
            embedding.providerId,
            embedding.model,
            embedding.dimensions,
            row.content_hash || contentHash(texts[j]),
            new Date().toISOString(),
          );
          updated += 1;
        }
      });
      tx();
    }
    db.prepare('INSERT OR REPLACE INTO memory_index_state (key, value) VALUES (?, ?)').run('embedding_provider', provider.id);
    db.prepare('INSERT OR REPLACE INTO memory_index_state (key, value) VALUES (?, ?)').run('embedding_model', provider.defaultModel);
    return {
      ok: true,
      provider: provider.id,
      model: provider.defaultModel,
      dimensions: vectorsDimensionHint(db, provider.id, provider.defaultModel),
      scanned: rows.length,
      updated,
      skipped,
    };
  } catch (err: any) {
    return { ok: false, provider: 'unknown', model: '', scanned: 0, updated: 0, skipped: 0, error: String(err?.message || err) };
  } finally {
    try { db.close(); } catch {}
  }
}

function vectorsDimensionHint(db: SqliteDatabase, providerId: string, model: string): number | undefined {
  try {
    const row = db.prepare('SELECT dimensions FROM memory_embeddings WHERE provider_id = ? AND model = ? ORDER BY created_at DESC LIMIT 1').get(providerId, model);
    return row?.dimensions ? Number(row.dimensions) : undefined;
  } catch {
    return undefined;
  }
}

export function getRelatedSqliteMemory(workspacePath: string, recordId: string, limit = 8): MemorySearchHit[] | null {
  const db = openDb(workspacePath);
  if (!db) return null;
  try {
    const base = db.prepare('SELECT * FROM memory_records WHERE id = ? OR canonical_key = ?').get(recordId, recordId);
    if (!base) return null;
    const rows = db.prepare(`
      SELECT r.*, e.score AS edge_score, e.relation
      FROM memory_edges e
      JOIN memory_records r ON r.id = CASE WHEN e.from_id = ? THEN e.to_id ELSE e.from_id END
      WHERE e.from_id = ? OR e.to_id = ?
      ORDER BY e.score DESC
      LIMIT ?
    `).all(base.id, base.id, base.id, Math.max(1, Math.min(50, limit)));
    return rows.map((row: any, index: number) => rowToHit(row, Number(row.edge_score || 0.1), index + 1, {
      exactTerms: [],
      entities: [],
      lexical: [],
      recordTypeReason: `related:${row.relation || 'edge'}`,
    }));
  } finally {
    try { db.close(); } catch {}
  }
}

export function getSqliteMemoryGraphSnapshot(workspacePath: string): { generatedAt: string; nodeCount: number; edgeCount: number; nodes: any[]; edges: any[] } | null {
  const db = openDb(workspacePath);
  if (!db) return null;
  try {
    const nodeRows = db.prepare(`
      SELECT id, layer, type, title, source_type, source_path, project_id, durability, timestamp_ms, day, authority, status
      FROM memory_records
      ORDER BY timestamp_ms DESC
      LIMIT 12000
    `).all();
    if (!nodeRows.length) return null;
    const edgeRows = db.prepare(`
      SELECT id, from_id, to_id, relation, score
      FROM memory_edges
      ORDER BY score DESC
      LIMIT 12000
    `).all();
    const indexedAt = String(db.prepare("SELECT value FROM memory_index_state WHERE key = 'indexed_at'").get()?.value || '');
    return {
      generatedAt: indexedAt || new Date(0).toISOString(),
      nodeCount: nodeRows.length,
      edgeCount: edgeRows.length,
      nodes: nodeRows.map((row: any) => ({
        id: row.id,
        layer: row.layer,
        recordType: row.type,
        sourceType: row.source_type,
        sourcePath: row.source_path,
        title: row.title,
        timestamp: new Date(Number(row.timestamp_ms || 0)).toISOString(),
        day: row.day,
        projectId: row.project_id || null,
        durability: Number(row.durability || 0.5),
        authority: row.authority,
        status: row.status,
      })),
      edges: edgeRows.map((row: any) => ({
        id: row.id,
        from: row.from_id,
        to: row.to_id,
        type: row.relation,
        score: Number(row.score || 0),
      })),
    };
  } finally {
    try { db.close(); } catch {}
  }
}
