import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type MemoryIndexSourceType =
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
  | 'audit_misc';

export interface MemorySearchParams {
  query: string;
  mode?: 'quick' | 'deep' | 'project' | 'timeline';
  limit?: number;
  sourceTypes?: MemoryIndexSourceType[];
  projectId?: string;
  dateFrom?: string;
  dateTo?: string;
  minDurability?: number;
}

export interface MemorySearchHit {
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
}

export interface MemorySearchResult {
  query: string;
  mode: string;
  totalCandidates: number;
  hits: MemorySearchHit[];
  stats: { records: number; chunks: number; indexedAt: string };
}

type RecordItem = {
  id: string;
  sourcePath: string;
  sourceType: MemoryIndexSourceType;
  title: string;
  timestampMs: number;
  day: string;
  projectId?: string;
  durability: number;
};

type ChunkItem = {
  id: string;
  recordId: string;
  index: number;
  text: string;
  terms: string[];
  embedding: number[];
};

type RelationItem = {
  id: string;
  fromId: string;
  toId: string;
  type: 'record_family' | 'same_project' | 'shared_terms' | 'semantic_neighbor';
  score: number;
};

type ManifestEntry = { mtimeMs: number; size: number; recordId: string; chunkIds: string[] };
type Store = {
  version: number;
  updatedAt: string;
  records: Record<string, RecordItem>;
  chunks: Record<string, ChunkItem>;
  tokenIndex: Record<string, string[]>;
  relations: RelationItem[];
};
type Manifest = { version: number; updatedAt: string; lastRunAtMs: number; files: Record<string, ManifestEntry> };

const INDEX_VERSION = 1;
const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 180;
const EMBEDDING_DIM = 96;
const MAX_SOURCE_BYTES = 450000;
const STOP = new Set(['a','an','and','are','as','at','be','by','for','from','had','has','have','i','if','in','is','it','its','of','on','or','that','the','their','them','they','this','to','was','we','were','what','when','where','who','why','will','with','you','your']);
const ROOT_DIRS = ['chats', 'tasks', 'cron', 'teams', 'proposals', 'memory', 'projects', 'schedules'] as const;

function idxPaths(workspacePath: string) {
  const root = path.join(workspacePath, 'audit', '_index', 'memory');
  return { root, store: path.join(root, 'store.json'), manifest: path.join(root, 'manifest.json'), readme: path.join(root, 'README.md') };
}
function ensureDir(d: string): void { fs.mkdirSync(d, { recursive: true }); }
function readJson<T>(p: string, fallback: T): T { try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) as T : fallback; } catch { return fallback; } }
function writeJson(p: string, data: unknown): void { ensureDir(path.dirname(p)); fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8'); }
function rel(abs: string, root: string): string { return path.relative(root, abs).replace(/\\/g, '/'); }
function id(prefix: string, input: string): string { return `${prefix}_${crypto.createHash('sha1').update(input).digest('hex').slice(0, 16)}`; }
function norm(s: string): string { return String(s || '').replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n').trim(); }
function stem(t: string): string { let x = t.toLowerCase(); if (x.endsWith('ing') && x.length > 5) x = x.slice(0, -3); else if (x.endsWith('ed') && x.length > 4) x = x.slice(0, -2); else if (x.endsWith('s') && x.length > 3) x = x.slice(0, -1); return x; }
function terms(s: string): string[] { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).map(v => stem(v.trim())).filter(v => v.length > 2 && !STOP.has(v)); }
function uniqTop(arr: string[], n: number): string[] { const m = new Map<string, number>(); for (const a of arr) m.set(a, (m.get(a) || 0) + 1); return [...m.entries()].sort((a,b) => b[1]-a[1]).slice(0, n).map(([k]) => k); }
function hashToDim(token: string): number {
  const h = crypto.createHash('md5').update(token).digest();
  const n = (h[0] << 8) + h[1];
  return n % EMBEDDING_DIM;
}
function embedTerms(ts: string[]): number[] {
  const v = new Array<number>(EMBEDDING_DIM).fill(0);
  for (const t of ts) {
    const dim = hashToDim(t);
    const sign = (t.charCodeAt(0) % 2 === 0) ? 1 : -1;
    v[dim] += sign;
  }
  let normSq = 0;
  for (const x of v) normSq += x * x;
  const n = Math.sqrt(normSq) || 1;
  return v.map((x) => Number((x / n).toFixed(6)));
}
function cosine(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let an = 0;
  let bn = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    an += a[i] * a[i];
    bn += b[i] * b[i];
  }
  const den = Math.sqrt(an) * Math.sqrt(bn);
  if (!den) return 0;
  return dot / den;
}
function preview(s: string): string { const x = norm(s).replace(/\n/g, ' '); return x.length <= 260 ? x : `${x.slice(0, 257)}...`; }
function inferType(r: string): MemoryIndexSourceType {
  if (r.startsWith('chats/sessions/')) return 'chat_session';
  if (r.startsWith('chats/transcripts/')) return 'chat_transcript';
  if (r.startsWith('chats/compactions/')) return 'chat_compaction';
  if (r.startsWith('tasks/state/')) return 'task_state';
  if (r.startsWith('proposals/state/')) return 'proposal_state';
  if (r.startsWith('cron/runs/')) return 'cron_run';
  if (r.startsWith('cron/jobs/')) return 'cron_job';
  if (r.startsWith('schedules/state/')) return 'schedule_state';
  if (r.startsWith('teams/state/')) return 'team_state';
  if (r.startsWith('projects/state/')) return 'project_state';
  if (r.startsWith('memory/root/')) return 'memory_root';
  if (r.startsWith('memory/files/')) return 'memory_note';
  return 'audit_misc';
}
function durability(t: MemoryIndexSourceType): number { return ({ memory_root: 1, proposal_state: 0.88, project_state: 0.82, chat_compaction: 0.76, task_state: 0.72, chat_session: 0.64, schedule_state: 0.6, cron_job: 0.58, chat_transcript: 0.56, team_state: 0.54, cron_run: 0.5, memory_note: 0.45, audit_misc: 0.5 } as Record<string, number>)[t] || 0.5; }
function projectFrom(relPath: string, obj: any): string | undefined {
  const m = relPath.match(/^projects\/state\/([^/]+)/); if (m?.[1]) return m[1];
  for (const v of [obj?.projectId, obj?.project_id, obj?.project, obj?.metadata?.projectId]) { const s = String(v || '').trim(); if (s) return s; }
  return undefined;
}
function tsFrom(relPath: string, st: fs.Stats, obj: any): number {
  for (const v of [obj?.lastActiveAt, obj?.updatedAt, obj?.createdAt, obj?.completedAt, obj?.timestamp]) {
    const n = Number(v); if (Number.isFinite(n) && n > 0) return n > 1e12 ? n : n * 1000;
    const d = Date.parse(String(v || '')); if (Number.isFinite(d) && d > 0) return d;
  }
  const m = relPath.match(/(\d{4}-\d{2}-\d{2})/); if (m?.[1]) { const ms = Date.parse(`${m[1]}T00:00:00.000Z`); if (Number.isFinite(ms)) return ms; }
  return st.mtimeMs;
}
function day(tsMs: number): string { try { return new Date(tsMs).toISOString().slice(0, 10); } catch { return ''; } }
function listFilesRecursive(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) return [];
  const out: string[] = []; const stack = [rootDir];
  while (stack.length) {
    const cur = stack.pop() as string;
    let ents: fs.Dirent[] = []; try { ents = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) { const abs = path.join(cur, e.name); if (e.isDirectory()) stack.push(abs); else if (e.isFile()) out.push(abs); }
  }
  return out;
}
function parseContent(abs: string, relPath: string): { text: string; parsed?: any } | null {
  let raw = ''; try { raw = fs.readFileSync(abs, 'utf-8'); } catch { return null; }
  if (!raw.trim()) return null; if (raw.length > MAX_SOURCE_BYTES) raw = `${raw.slice(0, MAX_SOURCE_BYTES)}\n...[truncated_for_index]`;
  const lower = relPath.toLowerCase();
  if (lower.endsWith('.jsonl')) {
    const lines = raw.split('\n').filter(l => l.trim()).slice(-1200);
    const text = lines.map((l) => { try { return JSON.stringify(JSON.parse(l)); } catch { return l; } }).join('\n');
    return { text };
  }
  if (lower.endsWith('.json')) {
    try {
      const parsed = JSON.parse(raw);
      if (relPath.startsWith('chats/sessions/')) {
        const h = Array.isArray(parsed?.history) ? parsed.history.slice(-300) : [];
        const text = [`Session: ${String(parsed?.id || path.basename(relPath, '.json'))}`, String(parsed?.latestContextSummary || '').trim() ? `Summary: ${String(parsed.latestContextSummary)}` : '', ...h.map((m: any) => `[${String(m?.role || 'unknown')}] ${String(m?.content || '').trim()}`)].filter(Boolean).join('\n');
        return { text, parsed };
      }
      if (relPath.startsWith('tasks/state/')) {
        const j = Array.isArray(parsed?.journal) ? parsed.journal.slice(-120) : [];
        const text = [`Title: ${String(parsed?.title || '')}`, `Status: ${String(parsed?.status || '')}`, String(parsed?.prompt || ''), ...j.map((x: any) => `[${String(x?.type || 'entry')}] ${String(x?.content || x?.detail || '')}`)].filter(Boolean).join('\n');
        return { text, parsed };
      }
      if (relPath.startsWith('proposals/state/')) {
        const text = [`title: ${String(parsed?.title || '')}`, `summary: ${String(parsed?.summary || '')}`, `details: ${String(parsed?.details || '')}`, `status: ${String(parsed?.status || '')}`, `type: ${String(parsed?.type || '')}`, `priority: ${String(parsed?.priority || '')}`].filter(Boolean).join('\n');
        return { text, parsed };
      }
      return { text: JSON.stringify(parsed), parsed };
    } catch { return { text: raw }; }
  }
  return { text: raw };
}
function removeChunkIndex(tokenIndex: Record<string, string[]>, chunk: ChunkItem): void {
  for (const t of new Set(chunk.terms)) {
    const arr = tokenIndex[t]; if (!arr) continue;
    const next = arr.filter((x) => x !== chunk.id); if (next.length) tokenIndex[t] = next; else delete tokenIndex[t];
  }
}
function addChunkIndex(tokenIndex: Record<string, string[]>, chunk: ChunkItem): void {
  for (const t of new Set(chunk.terms)) {
    if (!tokenIndex[t]) tokenIndex[t] = [];
    if (!tokenIndex[t].includes(chunk.id)) tokenIndex[t].push(chunk.id);
  }
}
function makeChunks(record: RecordItem, text: string): ChunkItem[] {
  const out: ChunkItem[] = []; const clean = norm(text); let idx = 0; let start = 0;
  while (start < clean.length) {
    const end = Math.min(clean.length, start + CHUNK_SIZE);
    const piece = clean.slice(start, end).trim();
    if (piece) {
      const chunkTerms = uniqTop(terms(piece), 72);
      out.push({
        id: id('chk', `${record.id}:${idx}:${piece.slice(0, 80)}`),
        recordId: record.id,
        index: idx,
        text: piece,
        terms: chunkTerms,
        embedding: embedTerms(chunkTerms),
      });
    }
    if (end >= clean.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1); idx += 1;
  }
  return out;
}

function recordEmbedding(recordId: string, chunks: Record<string, ChunkItem>): number[] {
  const picked = Object.values(chunks).filter((c) => c.recordId === recordId);
  if (picked.length === 0) return new Array<number>(EMBEDDING_DIM).fill(0);
  const acc = new Array<number>(EMBEDDING_DIM).fill(0);
  for (const ch of picked) {
    const v = ch.embedding || [];
    for (let i = 0; i < Math.min(EMBEDDING_DIM, v.length); i++) acc[i] += v[i];
  }
  const inv = 1 / Math.max(1, picked.length);
  for (let i = 0; i < acc.length; i++) acc[i] = Number((acc[i] * inv).toFixed(6));
  return acc;
}

function recordTerms(recordId: string, chunks: Record<string, ChunkItem>): string[] {
  const picked = Object.values(chunks).filter((c) => c.recordId === recordId);
  const merged: string[] = [];
  for (const chunk of picked) merged.push(...(chunk.terms || []).slice(0, 24));
  return uniqTop(merged, 28);
}

function relRoot(sourcePath: string): string {
  return String(sourcePath || '').split('/')[0] || '';
}

function relStem(sourcePath: string): string {
  const base = path.basename(String(sourcePath || ''), path.extname(String(sourcePath || '')));
  return base.replace(/\.(jsonl|md)$/i, '').trim().toLowerCase();
}

function overlapScore(aTerms: string[], bTerms: string[]): { count: number; score: number } {
  if (!aTerms.length || !bTerms.length) return { count: 0, score: 0 };
  const a = new Set(aTerms);
  const b = new Set(bTerms);
  let shared = 0;
  for (const term of a) {
    if (b.has(term)) shared += 1;
  }
  const denom = Math.max(1, Math.min(a.size, b.size));
  return { count: shared, score: shared / denom };
}

function buildRelations(records: Record<string, RecordItem>, chunks: Record<string, ChunkItem>): RelationItem[] {
  const recs = Object.values(records);
  if (recs.length < 2) return [];
  const byProject = new Map<string, RecordItem[]>();
  const byFamily = new Map<string, RecordItem[]>();
  const recEmbedding = new Map<string, number[]>();
  const recTerms = new Map<string, string[]>();
  const tokenBuckets = new Map<string, string[]>();

  for (const r of recs) {
    if (r.projectId) {
      if (!byProject.has(r.projectId)) byProject.set(r.projectId, []);
      byProject.get(r.projectId)?.push(r);
    }
    const familyKey = relStem(r.sourcePath);
    if (familyKey) {
      if (!byFamily.has(familyKey)) byFamily.set(familyKey, []);
      byFamily.get(familyKey)?.push(r);
    }
    recEmbedding.set(r.id, recordEmbedding(r.id, chunks));
    const termsForRecord = recordTerms(r.id, chunks);
    recTerms.set(r.id, termsForRecord);
    for (const term of termsForRecord.slice(0, 12)) {
      if (!tokenBuckets.has(term)) tokenBuckets.set(term, []);
      tokenBuckets.get(term)?.push(r.id);
    }
  }

  const rels: RelationItem[] = [];
  const addNearbyLinks = (arr: RecordItem[], type: RelationItem['type'], baseScore: number): void => {
    if (arr.length < 2) return;
    const sorted = [...arr].sort((a, b) => b.timestampMs - a.timestampMs);
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const a = sorted[i];
      for (let j = i + 1; j < Math.min(sorted.length, i + 3); j += 1) {
        const b = sorted[j];
        const rootBoost = relRoot(a.sourcePath) === relRoot(b.sourcePath) ? 0.04 : 0;
        rels.push({
          id: id('rel', `${type}:${a.id}:${b.id}`),
          fromId: a.id,
          toId: b.id,
          type,
          score: Number((baseScore - ((j - i - 1) * 0.06) + rootBoost).toFixed(4)),
        });
      }
    }
  };

  for (const [, arr] of byProject) addNearbyLinks(arr, 'same_project', 0.88);
  for (const [, arr] of byFamily) {
    if (arr.length < 2) continue;
    const sameRoot = new Set(arr.map((item) => relRoot(item.sourcePath)));
    if (sameRoot.size < 2) continue;
    addNearbyLinks(arr, 'record_family', 0.94);
  }

  const seenSharedPairs = new Set<string>();
  for (const [term, recordIds] of tokenBuckets) {
    if (!term || recordIds.length < 2) continue;
    const uniqueIds = [...new Set(recordIds)].slice(0, 24);
    for (let i = 0; i < uniqueIds.length - 1; i += 1) {
      const aId = uniqueIds[i];
      const a = records[aId];
      if (!a) continue;
      for (let j = i + 1; j < uniqueIds.length; j += 1) {
        const bId = uniqueIds[j];
        const b = records[bId];
        if (!b) continue;
        if (relRoot(a.sourcePath) !== relRoot(b.sourcePath) && String(a.projectId || '') !== String(b.projectId || '')) continue;
        const pairKey = [aId, bId].sort().join(':');
        if (seenSharedPairs.has(pairKey)) continue;
        const overlap = overlapScore(recTerms.get(aId) || [], recTerms.get(bId) || []);
        if (overlap.count < 3 || overlap.score < 0.2) continue;
        seenSharedPairs.add(pairKey);
        rels.push({
          id: id('rel', `shared_terms:${aId}:${bId}`),
          fromId: aId,
          toId: bId,
          type: 'shared_terms',
          score: Number((0.52 + Math.min(0.34, overlap.score)).toFixed(4)),
        });
      }
    }
  }

  for (const a of recs) {
    const aVec = recEmbedding.get(a.id) || [];
    const aTerms = recTerms.get(a.id) || [];
    let best: { recId: string; score: number } | null = null;
    for (const b of recs) {
      if (b.id === a.id) continue;
      const overlap = overlapScore(aTerms, recTerms.get(b.id) || []);
      if (overlap.count < 2) continue;
      if (relRoot(a.sourcePath) !== relRoot(b.sourcePath) && String(a.projectId || '') !== String(b.projectId || '') && overlap.count < 4) continue;
      const bVec = recEmbedding.get(b.id) || [];
      const sim = cosine(aVec, bVec);
      if (sim <= 0.56) continue;
      if (!best || sim > best.score) best = { recId: b.id, score: sim };
    }
    if (best) {
      rels.push({
        id: id('rel', `semantic_neighbor:${a.id}:${best.recId}`),
        fromId: a.id,
        toId: best.recId,
        type: 'semantic_neighbor',
        score: Number(best.score.toFixed(4)),
      });
    }
  }

  // Dedupe and cap for sanity.
  const seen = new Set<string>();
  const deduped: RelationItem[] = [];
  for (const r of rels) {
    const k = `${r.type}:${[r.fromId, r.toId].sort().join(':')}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(r);
    if (deduped.length >= 5000) break;
  }
  return deduped;
}

export function refreshMemoryIndexFromAudit(workspacePath: string, options?: { force?: boolean; minIntervalMs?: number; maxChangedFiles?: number }): { indexedFiles: number; skippedFiles: number; removedFiles: number; deferredFiles: number; totalRecords: number; totalChunks: number; updatedAt: string } {
  const { root, store: storePath, manifest: manifestPath, readme } = idxPaths(workspacePath);
  const auditRoot = path.join(workspacePath, 'audit');
  const now = Date.now(); const nowIso = new Date(now).toISOString();
  const store = readJson<Store>(storePath, { version: INDEX_VERSION, updatedAt: new Date(0).toISOString(), records: {}, chunks: {}, tokenIndex: {}, relations: [] });
  const manifest = readJson<Manifest>(manifestPath, { version: INDEX_VERSION, updatedAt: new Date(0).toISOString(), lastRunAtMs: 0, files: {} });
  const minIntervalMs = Math.max(0, Number(options?.minIntervalMs ?? 20000));
  if (!options?.force && now - Number(manifest.lastRunAtMs || 0) < minIntervalMs) {
    return { indexedFiles: 0, skippedFiles: 0, removedFiles: 0, deferredFiles: 0, totalRecords: Object.keys(store.records).length, totalChunks: Object.keys(store.chunks).length, updatedAt: store.updatedAt };
  }
  if (!fs.existsSync(auditRoot)) return { indexedFiles: 0, skippedFiles: 0, removedFiles: 0, deferredFiles: 0, totalRecords: 0, totalChunks: 0, updatedAt: nowIso };

  const filesAbs = ROOT_DIRS.flatMap((d) => listFilesRecursive(path.join(auditRoot, d)));
  const rels = filesAbs.map((a) => rel(a, auditRoot)).filter((r) => r && !r.startsWith('_index/') && !r.endsWith('/INDEX.md') && !r.endsWith('/README.md'));
  const relSet = new Set(rels);
  let removed = 0; let skipped = 0; let indexed = 0;
  for (const oldRel of Object.keys(manifest.files)) {
    if (relSet.has(oldRel)) continue;
    const ent = manifest.files[oldRel];
    for (const cid of ent.chunkIds || []) { const c = store.chunks[cid]; if (c) { removeChunkIndex(store.tokenIndex, c); delete store.chunks[cid]; } }
    delete store.records[ent.recordId];
    delete manifest.files[oldRel];
    removed += 1;
  }
  const changed: string[] = [];
  for (const relPath of rels) {
    const st = fs.statSync(path.join(auditRoot, relPath));
    const prev = manifest.files[relPath];
    if (!prev || prev.mtimeMs !== st.mtimeMs || prev.size !== st.size) changed.push(relPath); else skipped += 1;
  }
  const maxChanged = Math.max(1, Number(options?.maxChangedFiles ?? 200));
  const nowChanges = changed.slice(0, maxChanged);
  const deferred = Math.max(0, changed.length - nowChanges.length);
  for (const relPath of nowChanges) {
    const abs = path.join(auditRoot, relPath); const st = fs.statSync(abs);
    const prev = manifest.files[relPath];
    if (prev) {
      for (const cid of prev.chunkIds || []) { const c = store.chunks[cid]; if (c) { removeChunkIndex(store.tokenIndex, c); delete store.chunks[cid]; } }
      delete store.records[prev.recordId];
    }
    const parsed = parseContent(abs, relPath);
    if (!parsed || !norm(parsed.text)) { delete manifest.files[relPath]; indexed += 1; continue; }
    const type = inferType(relPath); const ts = tsFrom(relPath, st, parsed.parsed); const recId = id('rec', relPath);
    const rec: RecordItem = { id: recId, sourcePath: relPath, sourceType: type, title: path.basename(relPath), timestampMs: ts, day: day(ts), projectId: projectFrom(relPath, parsed.parsed), durability: durability(type) };
    store.records[recId] = rec;
    const chunks = makeChunks(rec, parsed.text);
    for (const c of chunks) { store.chunks[c.id] = c; addChunkIndex(store.tokenIndex, c); }
    manifest.files[relPath] = { mtimeMs: st.mtimeMs, size: st.size, recordId: recId, chunkIds: chunks.map((c) => c.id) };
    indexed += 1;
  }
  store.relations = buildRelations(store.records, store.chunks);
  store.version = INDEX_VERSION; store.updatedAt = nowIso;
  manifest.version = INDEX_VERSION; manifest.updatedAt = nowIso; manifest.lastRunAtMs = now;
  ensureDir(root); writeJson(storePath, store); writeJson(manifestPath, manifest);
  const graphPath = path.join(root, 'graph.json');
  const nodes = Object.values(store.records).map((r) => ({
    id: r.id,
    sourceType: r.sourceType,
    sourcePath: r.sourcePath,
    title: r.title,
    timestamp: new Date(r.timestampMs).toISOString(),
    day: r.day,
    projectId: r.projectId || null,
    durability: r.durability,
  }));
  const edges = store.relations.map((e) => ({
    id: e.id,
    from: e.fromId,
    to: e.toId,
    type: e.type,
    score: e.score,
  }));
  writeJson(graphPath, {
    generatedAt: nowIso,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes,
    edges,
  });
  fs.writeFileSync(readme, `# Memory Index\n\nGenerated from workspace/audit.\n\nUpdated: ${nowIso}\nRecords: ${Object.keys(store.records).length}\nChunks: ${Object.keys(store.chunks).length}\nTokens: ${Object.keys(store.tokenIndex).length}\nRelations: ${store.relations.length}\nGraph: graph.json\n`, 'utf-8');
  return { indexedFiles: indexed, skippedFiles: skipped, removedFiles: removed, deferredFiles: deferred, totalRecords: Object.keys(store.records).length, totalChunks: Object.keys(store.chunks).length, updatedAt: nowIso };
}

function parseDate(v?: string, end = false): number | null {
  const s = String(v || '').trim(); if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(`${s}T${end ? '23:59:59.999' : '00:00:00.000'}Z`);
  const d = Date.parse(s); return Number.isFinite(d) ? d : null;
}
function recency(ts: number, now: number): number { const days = Math.max(0, (now - ts) / 86400000); if (days <= 1) return 1; if (days >= 180) return 0.1; return Math.max(0.1, 1 - days / 180); }

export function searchMemoryIndex(workspacePath: string, params: MemorySearchParams): MemorySearchResult {
  refreshMemoryIndexFromAudit(workspacePath, { minIntervalMs: 15000, maxChangedFiles: 120 });
  const { store: storePath } = idxPaths(workspacePath);
  const store = readJson<Store>(storePath, { version: INDEX_VERSION, updatedAt: new Date(0).toISOString(), records: {}, chunks: {}, tokenIndex: {}, relations: [] });
  const q = String(params.query || '').trim(); const mode = String(params.mode || 'quick'); const qTerms = uniqTop(terms(q), 24);
  const qEmbedding = embedTerms(qTerms);
  const candidates = new Set<string>(); if (qTerms.length) for (const t of qTerms) for (const id of (store.tokenIndex[t] || [])) candidates.add(id);
  if (!candidates.size || mode === 'deep' || mode === 'timeline') for (const cid of Object.keys(store.chunks)) candidates.add(cid);
  const sourceSet = new Set((params.sourceTypes || []).filter(Boolean)); const projectId = String(params.projectId || '').trim();
  const from = parseDate(params.dateFrom); const to = parseDate(params.dateTo, true); const minDur = Number.isFinite(Number(params.minDurability)) ? Number(params.minDurability) : 0;
  const limit = Math.max(1, Math.min(50, Number(params.limit || 8))); const now = Date.now();
  const scored: Array<{ c: ChunkItem; r: RecordItem; s: number }> = [];
  for (const cid of candidates) {
    const c = store.chunks[cid]; if (!c) continue; const r = store.records[c.recordId]; if (!r) continue;
    if (sourceSet.size && !sourceSet.has(r.sourceType)) continue;
    if (projectId && String(r.projectId || '') !== projectId) continue;
    if (from !== null && r.timestampMs < from) continue; if (to !== null && r.timestampMs > to) continue;
    if (r.durability < minDur) continue;
    const cSet = new Set(c.terms); const matched = qTerms.filter((t) => cSet.has(t)).length;
    const kw = qTerms.length ? matched / qTerms.length : 0.25; const rc = recency(r.timestampMs, now);
    const sem = qTerms.length ? Math.max(0, cosine(qEmbedding, c.embedding || [])) : 0.25;
    const s = (kw * 0.45) + (sem * 0.25) + (rc * 0.15) + (r.durability * 0.15);
    scored.push({ c, r, s });
  }
  scored.sort((a,b) => b.s - a.s || b.r.timestampMs - a.r.timestampMs);
  const hits: MemorySearchHit[] = []; const seenRec = new Set<string>();
  for (const { c, r, s } of scored) {
    if ((mode === 'quick' || mode === 'project') && seenRec.has(r.id)) continue;
    seenRec.add(r.id);
    hits.push({ rank: hits.length + 1, score: Number(s.toFixed(4)), chunkId: c.id, recordId: r.id, sourceType: r.sourceType, sourcePath: r.sourcePath, timestamp: new Date(r.timestampMs).toISOString(), title: r.title, preview: preview(c.text), projectId: r.projectId });
    if (hits.length >= limit) break;
  }
  if (mode === 'timeline') { hits.sort((a,b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)); hits.forEach((h, i) => { h.rank = i + 1; }); }
  return { query: q, mode, totalCandidates: scored.length, hits, stats: { records: Object.keys(store.records).length, chunks: Object.keys(store.chunks).length, indexedAt: store.updatedAt } };
}

export function readMemoryRecord(workspacePath: string, recordId: string): { record: any | null; chunks: any[] } {
  refreshMemoryIndexFromAudit(workspacePath, { minIntervalMs: 20000, maxChangedFiles: 120 });
  const { store: storePath } = idxPaths(workspacePath);
  const store = readJson<Store>(storePath, { version: INDEX_VERSION, updatedAt: new Date(0).toISOString(), records: {}, chunks: {}, tokenIndex: {}, relations: [] });
  const rec = store.records[String(recordId || '').trim()] || null;
  if (!rec) return { record: null, chunks: [] };
  const chunks = Object.values(store.chunks).filter((c) => c.recordId === rec.id).sort((a, b) => a.index - b.index);
  return { record: rec, chunks };
}

export function searchProjectMemory(workspacePath: string, projectId: string, query: string, limit = 10): MemorySearchResult {
  return searchMemoryIndex(workspacePath, { mode: 'project', projectId, query, limit });
}

export function searchMemoryTimeline(workspacePath: string, query: string, dateFrom?: string, dateTo?: string, limit = 20): MemorySearchResult {
  return searchMemoryIndex(workspacePath, { mode: 'timeline', query, dateFrom, dateTo, limit });
}

export function getMemoryGraphSnapshot(workspacePath: string): { generatedAt: string; nodeCount: number; edgeCount: number; nodes: any[]; edges: any[] } {
  refreshMemoryIndexFromAudit(workspacePath, { minIntervalMs: 20000, maxChangedFiles: 120 });
  const { root, store: storePath } = idxPaths(workspacePath);
  const graphPath = path.join(root, 'graph.json');
  if (fs.existsSync(graphPath)) {
    return readJson(graphPath, { generatedAt: new Date(0).toISOString(), nodeCount: 0, edgeCount: 0, nodes: [], edges: [] } as any);
  }
  const store = readJson<Store>(storePath, { version: INDEX_VERSION, updatedAt: new Date(0).toISOString(), records: {}, chunks: {}, tokenIndex: {}, relations: [] });
  const nodes = Object.values(store.records).map((r) => ({
    id: r.id,
    sourceType: r.sourceType,
    sourcePath: r.sourcePath,
    title: r.title,
    timestamp: new Date(r.timestampMs).toISOString(),
    day: r.day,
    projectId: r.projectId || null,
    durability: r.durability,
  }));
  const edges = (store.relations || []).map((e) => ({ id: e.id, from: e.fromId, to: e.toId, type: e.type, score: e.score }));
  return { generatedAt: store.updatedAt, nodeCount: nodes.length, edgeCount: edges.length, nodes, edges };
}

export function getRelatedMemory(workspacePath: string, recordId: string, limit = 8): MemorySearchHit[] {
  refreshMemoryIndexFromAudit(workspacePath, { minIntervalMs: 20000, maxChangedFiles: 120 });
  const { store: storePath } = idxPaths(workspacePath);
  const store = readJson<Store>(storePath, { version: INDEX_VERSION, updatedAt: new Date(0).toISOString(), records: {}, chunks: {}, tokenIndex: {}, relations: [] });
  const base = store.records[String(recordId || '').trim()]; if (!base) return [];
  const relCandidates = store.relations
    .filter((r) => r.fromId === base.id || r.toId === base.id)
    .map((r) => ({ otherId: r.fromId === base.id ? r.toId : r.fromId, score: r.score }))
    .sort((a, b) => b.score - a.score);
  const dedup = new Map<string, number>();
  for (const c of relCandidates) {
    if (!dedup.has(c.otherId) || (dedup.get(c.otherId) || 0) < c.score) dedup.set(c.otherId, c.score);
  }
  const ranked = [...dedup.entries()]
    .map(([rid, score]) => ({ rid, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(50, limit)));
  return ranked.map((x, i) => {
    const r = store.records[x.rid];
    const c = Object.values(store.chunks).find((k) => k.recordId === x.rid);
    return {
      rank: i + 1,
      score: Number(x.score.toFixed(4)),
      chunkId: c?.id || '',
      recordId: r.id,
      sourceType: r.sourceType,
      sourcePath: r.sourcePath,
      timestamp: new Date(r.timestampMs).toISOString(),
      title: r.title,
      preview: c ? preview(c.text) : '',
      projectId: r.projectId,
    };
  });
}
