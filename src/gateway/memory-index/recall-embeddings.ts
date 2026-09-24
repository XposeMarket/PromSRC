/**
 * recall-embeddings.ts
 *
 * Semantic layer for the recall index. Keyword FTS answers "what did we say
 * about X" when the words match; this answers it when they don't
 * ("the sign-in sheet for agents" -> "Needs-You card / login handoff").
 *
 * - Vectors live in recall_vec (rowid -> Float32 blob) next to recall_fts and
 *   are dropped with the rows they belong to.
 * - Filled in the background in small batches after the FTS index settles.
 *   Local providers only (Ollama / LM Studio) by default: no per-chat cost and
 *   transcripts never leave the machine. memory.recall_embeddings.provider can
 *   override.
 * - Search is an in-memory cosine scan over a Float32 matrix (~22k x 768 is
 *   ~65MB and scans in tens of ms), loaded lazily and rebuilt when stale.
 * - Everything degrades to keyword-only: no provider, no vectors, or a slow
 *   embed never blocks or fails a search.
 */
import { getConfig } from '../../config/config';
import { getRecallDb } from './recall-index';

// Local nomic-embed-text runs ~5 rows/s here; 12 keeps each request ~2.5s,
// well under the provider's 8s HTTP timeout, and leaves the GPU responsive.
const BATCH = 12;
const BATCH_GAP_MS = 400;
const MAX_EMBED_CHARS = 1_200;
const QUERY_TIMEOUT_MS = 1_200;
const MIN_BODY_CHARS = 24;

interface EmbedProvider { id: string; model: string; embedBatch(inputs: string[]): Promise<Array<{ vector: number[] }>>; embedQuery(input: string): Promise<{ vector: number[] }> }

let providerPromise: Promise<EmbedProvider | null> | null = null;
let providerCheckedAt = 0;
const running = new Set<string>();
const timers = new Map<string, NodeJS.Timeout>();
let matrixCache: { key: string; model: string; dims: number; ids: Int32Array; data: Float32Array; count: number; builtAt: number } | null = null;
let matrixDirty = true;

export function invalidateRecallVectorCache(): void { matrixDirty = true; }

function recallEmbeddingPreference(): string {
  try {
    const cfg: any = getConfig().getConfig();
    return String(cfg?.memory?.recall_embeddings?.provider || process.env.PROMETHEUS_RECALL_EMBEDDING_PROVIDER || 'local').trim();
  } catch { return 'local'; }
}

async function resolveProvider(): Promise<EmbedProvider | null> {
  if (providerPromise && Date.now() - providerCheckedAt < 5 * 60_000) return providerPromise;
  providerCheckedAt = Date.now();
  providerPromise = (async () => {
    const pref = recallEmbeddingPreference();
    if (pref === 'off' || pref === 'none' || pref === 'hash') return null;
    try {
      const reg = require('../memory/embeddings/registry');
      const all: any[] = reg.listMemoryEmbeddingProviders();
      const candidates = pref === 'local'
        ? all.filter((p) => p.local && p.id !== 'hash')
        : all.filter((p) => p.id === pref);
      for (const p of candidates) {
        try {
          const st = await Promise.race([p.status(), new Promise<any>((_, rej) => setTimeout(() => rej(new Error('timeout')), 3_000))]);
          if (!st?.ok) continue;
          // status() only proves the server is up; prove the model is pulled.
          await p.embedQuery('probe');
          return { id: p.id, model: String(st.model || p.defaultModel), embedBatch: p.embedBatch.bind(p), embedQuery: p.embedQuery.bind(p) };
        } catch { /* next */ }
      }
    } catch { /* registry unavailable */ }
    return null;
  })();
  return providerPromise;
}

function ensureTable(db: any): void {
  db.exec(`CREATE TABLE IF NOT EXISTS recall_vec (
    rowid INTEGER PRIMARY KEY,
    path TEXT NOT NULL,
    model TEXT NOT NULL,
    dims INTEGER NOT NULL,
    vec BLOB NOT NULL
  );
  CREATE INDEX IF NOT EXISTS recall_vec_path ON recall_vec(path);`);
}

function toBlob(v: number[]): Buffer {
  const f = new Float32Array(v.length);
  let n = 0;
  for (let i = 0; i < v.length; i += 1) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i += 1) f[i] = v[i] / n; // store unit vectors: cosine = dot
  return Buffer.from(f.buffer);
}

function embedText(body: string, title: string): string {
  const t = String(title || '').trim();
  const b = String(body || '').replace(/\s+/g, ' ').trim();
  return (t ? `${t}\n${b}` : b).slice(0, MAX_EMBED_CHARS);
}

/** Embed one batch of rows that have no vector yet. Returns rows embedded. */
export async function embedRecallBatch(workspacePath: string, batch = BATCH): Promise<number> {
  const provider = await resolveProvider();
  if (!provider) return 0;
  const db = getRecallDb(workspacePath);
  if (!db) return 0;
  ensureTable(db);
  // Newest first: recent conversations matter most and finish embedding first.
  const rows = db.prepare(`SELECT f.rowid AS id, f.body AS body, f.title AS title, f.path AS path
    FROM recall_fts f LEFT JOIN recall_vec v ON v.rowid = f.rowid AND v.model = ?
    WHERE v.rowid IS NULL AND length(f.body) >= ?
    ORDER BY CAST(f.ts AS INTEGER) DESC LIMIT ?`).all(provider.model, MIN_BODY_CHARS, batch) as any[];
  if (!rows.length) return 0;
  const vectors = await provider.embedBatch(rows.map((r) => embedText(r.body, r.title)));
  const insert = db.prepare('INSERT OR REPLACE INTO recall_vec(rowid, path, model, dims, vec) VALUES (?, ?, ?, ?, ?)');
  db.transaction(() => {
    rows.forEach((r, i) => {
      const v = vectors[i]?.vector;
      if (Array.isArray(v) && v.length) insert.run(r.id, r.path, provider.model, v.length, toBlob(v));
    });
  })();
  matrixDirty = true;
  return rows.length;
}

/** Background fill; one runner per workspace, yields between batches. */
export function scheduleRecallEmbedding(workspacePath: string, delayMs = 2_000): void {
  if (!workspacePath || process.env.PROMETHEUS_DISABLE_RECALL_INDEX === '1') return;
  if (running.has(workspacePath) || timers.has(workspacePath)) return;
  const t = setTimeout(async () => {
    timers.delete(workspacePath);
    running.add(workspacePath);
    try {
      for (;;) {
        const n = await embedRecallBatch(workspacePath);
        if (n < BATCH) break;
        await new Promise((r) => setTimeout(r, BATCH_GAP_MS));
      }
    } catch (err: any) {
      console.warn('[recall-embeddings] batch failed:', String(err?.message || err).slice(0, 200));
    } finally {
      running.delete(workspacePath);
    }
  }, delayMs);
  (t as any).unref?.();
  timers.set(workspacePath, t);
}

function loadMatrix(workspacePath: string, model: string): typeof matrixCache {
  const key = `${workspacePath}|${model}`;
  if (matrixCache && matrixCache.key === key && (!matrixDirty || Date.now() - matrixCache.builtAt < 15_000)) return matrixCache;
  const db = getRecallDb(workspacePath);
  if (!db) return null;
  ensureTable(db);
  const rows = db.prepare('SELECT rowid AS id, dims, vec FROM recall_vec WHERE model = ?').all(model) as any[];
  if (!rows.length) { matrixCache = null; return null; }
  const dims = Number(rows[0].dims);
  const data = new Float32Array(rows.length * dims);
  const ids = new Int32Array(rows.length);
  let count = 0;
  for (const r of rows) {
    if (Number(r.dims) !== dims) continue;
    const buf: Buffer = r.vec;
    data.set(new Float32Array(buf.buffer, buf.byteOffset, dims), count * dims);
    ids[count] = Number(r.id);
    count += 1;
  }
  matrixCache = { key, model, dims, ids, data, count, builtAt: Date.now() };
  matrixDirty = false;
  return matrixCache;
}

export interface SemanticRecallHit { rowid: number; similarity: number }

/**
 * Top-k nearest rows by cosine similarity. Returns [] (never throws) when
 * embeddings are unavailable or the query embed exceeds the time budget.
 */
export async function semanticRecallSearch(workspacePath: string, query: string, k = 30): Promise<{ hits: SemanticRecallHit[]; model: string; coverage: number }> {
  const none = { hits: [], model: '', coverage: 0 };
  try {
    const provider = await Promise.race([resolveProvider(), new Promise<null>((r) => setTimeout(() => r(null), 500))]);
    if (!provider) return none;
    const m = loadMatrix(workspacePath, provider.model);
    if (!m || !m.count) return none;
    const q = await Promise.race([
      provider.embedQuery(String(query || '').slice(0, MAX_EMBED_CHARS)),
      new Promise<null>((r) => setTimeout(() => r(null), QUERY_TIMEOUT_MS)),
    ]);
    const qv = q?.vector;
    if (!Array.isArray(qv) || qv.length !== m.dims) return none;
    let n = 0;
    for (const x of qv) n += x * x;
    n = Math.sqrt(n) || 1;
    const qf = new Float32Array(qv.map((x) => x / n));
    // Partial selection: keep a small sorted top-k.
    const top: SemanticRecallHit[] = [];
    let floor = -Infinity;
    for (let i = 0; i < m.count; i += 1) {
      let dot = 0;
      const off = i * m.dims;
      for (let d = 0; d < m.dims; d += 1) dot += qf[d] * m.data[off + d];
      if (top.length < k || dot > floor) {
        top.push({ rowid: m.ids[i], similarity: dot });
        if (top.length > k) { top.sort((a, b) => b.similarity - a.similarity); top.length = k; }
        floor = top.length >= k ? Math.min(...top.map((t) => t.similarity)) : -Infinity;
      }
    }
    top.sort((a, b) => b.similarity - a.similarity);
    const db = getRecallDb(workspacePath);
    const total = Number((db?.prepare('SELECT count(*) AS c FROM recall_fts').get() as any)?.c || 0);
    return { hits: top, model: provider.model, coverage: total ? m.count / total : 0 };
  } catch {
    return none;
  }
}

export function getRecallEmbeddingStats(workspacePath: string): { vectors: number; model: string | null; running: boolean } {
  try {
    const db = getRecallDb(workspacePath);
    if (!db) return { vectors: 0, model: null, running: false };
    ensureTable(db);
    const row = db.prepare('SELECT model, count(*) AS c FROM recall_vec GROUP BY model ORDER BY c DESC LIMIT 1').get() as any;
    return { vectors: Number(row?.c || 0), model: row?.model || null, running: running.has(workspacePath) };
  } catch { return { vectors: 0, model: null, running: false }; }
}

export function resetRecallEmbeddingsForTests(): void {
  providerPromise = null;
  providerCheckedAt = 0;
  matrixCache = null;
  matrixDirty = true;
}
