/**
 * recall-index.ts
 *
 * A dedicated, incremental full-text recall index over everything Prometheus
 * remembers in raw form: every chat transcript message, every intraday note,
 * MEMORY.md / USER.md bullets, and "ideas" auto-extracted from user messages.
 *
 * Why this exists next to the main memory index:
 * - The main index is bounded (25k chunks) and batch-refreshed behind the
 *   maintenance gate. Once it hit the cap it silently stopped absorbing
 *   transcripts (2.8k of 7.6k indexed), and searches queued behind
 *   maintenance could time out.
 * - This index is append-only per transcript (byte offsets), refreshes in
 *   small time-sliced batches on the gateway, never takes the maintenance
 *   gate, and reports honest confidence including "no strong match".
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type RecallSource = 'transcript' | 'note' | 'memory' | 'idea';

export interface RecallSearchParams {
  query: string;
  limit?: number;
  sources?: RecallSource[];
  excludeSessionId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface RecallHit {
  source: RecallSource;
  sessionId: string;
  role: string;
  ts: number;
  title: string;
  path: string;
  snippet: string;
  coverage: number;
  phrase: boolean;
  confidence: 'strong' | 'partial' | 'weak';
  score: number;
}

export interface RecallSearchResult {
  query: string;
  terms: string[];
  best: 'strong' | 'partial' | 'none';
  hits: RecallHit[];
  stats: RecallIndexStats;
}

export interface RecallIndexStats {
  available: boolean;
  docs: number;
  files: number;
  pendingFiles: number;
  backfillComplete: boolean;
  error?: string;
}

const MAX_DOC_CHARS = 20_000;
const SLICE_BUDGET_MS = 120;
const SLICE_GAP_MS = 40;
const FULL_SCAN_INTERVAL_MS = 10 * 60_000;

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'did', 'do', 'does', 'for', 'from', 'had', 'has',
  'have', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'me', 'my', 'no', 'not', 'of', 'on', 'or', 'our', 'so',
  'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'to', 'up', 'us', 'was', 'we', 'were',
  'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'you', 'your', 'about', 'abt', 'yea', 'yeah',
  'just', 'like', 'pls', 'please', 'remember', 'spoke', 'talked', 'before', 'earlier',
]);

const IDEA_PATTERN = /\b(we should|we need to|we could|can we (?:add|build|make|get|have|do|hook|create)|could we (?:add|build|make)|lets? (?:add|build|make|create|do)|i want (?:to add|to build|you to build|a |an |it to )|i(?:'d| would) like (?:to|a|an)|would be (?:cool|nice|sick) (?:if|to)|note (?:this|that|all this)|add (?:that|this|it) to the (?:list|backlog|notes)|new (?:idea|feature)|idea:)/i;

let DatabaseCtor: any = null;
let loadError = '';
const dbByWorkspace = new Map<string, any>();

interface WorkspaceState {
  dirty: Set<string>;
  queue: string[];
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  lastFullScanAt: number;
  backfillComplete: boolean;
}
const states = new Map<string, WorkspaceState>();

function loadSqlite(): any | null {
  if (DatabaseCtor) return DatabaseCtor;
  if (loadError) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    DatabaseCtor = require('better-sqlite3');
    return DatabaseCtor;
  } catch (err: any) {
    loadError = String(err?.message || err);
    return null;
  }
}

export function recallIndexPath(workspacePath: string): string {
  return path.join(workspacePath, 'audit', '_index', 'recall', 'recall.sqlite');
}

function openDb(workspacePath: string): any | null {
  const key = path.resolve(workspacePath);
  const cached = dbByWorkspace.get(key);
  if (cached) return cached;
  const Database = loadSqlite();
  if (!Database) return null;
  const dbPath = recallIndexPath(workspacePath);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS recall_files (
      path TEXT PRIMARY KEY,
      size INTEGER NOT NULL,
      mtime REAL NOT NULL,
      offset INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS recall_meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS recall_ideas (
      hash TEXT PRIMARY KEY,
      session_id TEXT,
      ts INTEGER,
      text TEXT
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS recall_fts USING fts5(
      body, title,
      source UNINDEXED, session_id UNINDEXED, role UNINDEXED, ts UNINDEXED, path UNINDEXED,
      tokenize = 'porter unicode61'
    );
  `);
  dbByWorkspace.set(key, db);
  return db;
}

function stateFor(workspacePath: string): WorkspaceState {
  const key = path.resolve(workspacePath);
  let s = states.get(key);
  if (!s) {
    s = { dirty: new Set(), queue: [], timer: null, running: false, lastFullScanAt: 0, backfillComplete: false };
    states.set(key, s);
  }
  return s;
}

function relKey(workspacePath: string, abs: string): string {
  return path.relative(workspacePath, abs).replace(/\\/g, '/');
}

function listCandidateFiles(workspacePath: string): string[] {
  const out: Array<{ abs: string; mtime: number }> = [];
  const push = (abs: string) => {
    try { out.push({ abs, mtime: fs.statSync(abs).mtimeMs }); } catch { /* vanished */ }
  };
  const transcripts = path.join(workspacePath, 'audit', 'chats', 'transcripts');
  try {
    for (const name of fs.readdirSync(transcripts)) if (name.endsWith('.jsonl')) push(path.join(transcripts, name));
  } catch { /* no transcripts yet */ }
  const memDir = path.join(workspacePath, 'memory');
  try {
    for (const name of fs.readdirSync(memDir)) if (/-intraday-notes\.md$/.test(name)) push(path.join(memDir, name));
  } catch { /* no notes yet */ }
  for (const name of ['MEMORY.md', 'USER.md', 'IDEAS.md']) {
    const abs = path.join(workspacePath, name);
    if (fs.existsSync(abs)) push(abs);
  }
  // Newest first so recent conversations become searchable before history.
  return out.sort((a, b) => b.mtime - a.mtime).map((f) => f.abs);
}

function clip(text: string): string {
  const t = String(text || '');
  return t.length > MAX_DOC_CHARS ? `${t.slice(0, MAX_DOC_CHARS)}…` : t;
}

export function extractIdeaText(content: string): string | null {
  const text = String(content || '').trim();
  if (text.length < 12) return null;
  const match = IDEA_PATTERN.exec(text);
  if (!match) return null;
  const start = Math.max(0, text.lastIndexOf('\n', match.index) + 1);
  return text.slice(start, start + 400).replace(/\s+/g, ' ').trim();
}

interface InsertCtx {
  insertDoc: any;
  insertIdea: any;
}

function indexTranscriptLines(ctx: InsertCtx, rel: string, chunk: string): void {
  for (const line of chunk.split('\n')) {
    if (!line.trim()) continue;
    let row: any;
    try { row = JSON.parse(line); } catch { continue; }
    if (row?.synthetic === true) continue;
    const role = String(row?.role || '');
    if (role !== 'user' && role !== 'assistant') continue;
    const content = String(row?.content || '').trim();
    if (!content) continue;
    const sessionId = String(row?.sessionId || path.basename(rel, '.jsonl'));
    const ts = Number(row?.timestamp) || Date.parse(String(row?.timestampIso || '')) || 0;
    ctx.insertDoc.run(clip(content), '', 'transcript', sessionId, role, ts, rel);
    if (role === 'user') {
      const idea = extractIdeaText(content);
      if (idea) {
        const hash = crypto.createHash('sha1').update(`${sessionId}:${idea}`).digest('hex').slice(0, 20);
        const inserted = ctx.insertIdea.run(hash, sessionId, ts, idea);
        if (inserted.changes > 0) ctx.insertDoc.run(idea, 'idea', 'idea', sessionId, 'user', ts, rel);
      }
    }
  }
}

function indexNotesFile(ctx: InsertCtx, rel: string, text: string): void {
  const entries = text.split(/^(?=### \[)/m);
  for (const entry of entries) {
    const head = /^### \[([A-Z_]+)\]\s+(\S+)/.exec(entry);
    if (!head) continue;
    const ts = Date.parse(head[2]) || 0;
    const session = /session:\s*([A-Za-z0-9_.:-]+)/.exec(entry)?.[1] || '';
    const body = entry.replace(/^### .*\n/, '').replace(/^_Source:.*\n/m, '').trim();
    if (body) ctx.insertDoc.run(clip(body), `note ${head[1].toLowerCase()}`, 'note', session, 'note', ts, rel);
  }
}

function indexMarkdownBullets(ctx: InsertCtx, rel: string, text: string, mtime: number): void {
  let section = '';
  for (const line of text.split(/\r?\n/)) {
    const h = /^#{1,3}\s+(.+)$/.exec(line);
    if (h) { section = h[1].trim(); continue; }
    const b = /^\s*[-*]\s+(.+)$/.exec(line);
    if (!b || b[1].trim().length < 8) continue;
    ctx.insertDoc.run(clip(b[1].trim()), `${path.basename(rel)} ${section}`.trim(), rel === 'IDEAS.md' ? 'idea' : 'memory', '', 'memory', Math.floor(mtime), rel);
  }
}

/** Index (or append-index) one file. Returns true if work was done. */
function indexFile(db: any, workspacePath: string, abs: string, ctx: InsertCtx): boolean {
  let st: fs.Stats;
  const rel = relKey(workspacePath, abs);
  try { st = fs.statSync(abs); } catch {
    db.prepare('DELETE FROM recall_fts WHERE path = ?').run(rel);
    db.prepare('DELETE FROM recall_files WHERE path = ?').run(rel);
    return true;
  }
  const prev = db.prepare('SELECT size, mtime, offset FROM recall_files WHERE path = ?').get(rel) as any;
  if (prev && prev.size === st.size && prev.mtime === st.mtimeMs) return false;
  const isJsonl = abs.endsWith('.jsonl');
  if (isJsonl) {
    let offset = prev && st.size >= prev.offset ? Number(prev.offset) : 0;
    if (offset === 0 && prev) db.prepare('DELETE FROM recall_fts WHERE path = ?').run(rel);
    const length = st.size - offset;
    if (length > 0) {
      const fd = fs.openSync(abs, 'r');
      try {
        const buf = Buffer.alloc(length);
        fs.readSync(fd, buf, 0, length, offset);
        const lastNl = buf.lastIndexOf(0x0a);
        if (lastNl >= 0) {
          indexTranscriptLines(ctx, rel, buf.subarray(0, lastNl).toString('utf8'));
          offset += lastNl + 1;
        }
      } finally { fs.closeSync(fd); }
    }
    db.prepare('INSERT OR REPLACE INTO recall_files(path, size, mtime, offset) VALUES (?, ?, ?, ?)').run(rel, st.size, st.mtimeMs, offset);
    return true;
  }
  const text = fs.readFileSync(abs, 'utf8');
  db.prepare('DELETE FROM recall_fts WHERE path = ?').run(rel);
  if (/-intraday-notes\.md$/.test(abs)) indexNotesFile(ctx, rel, text);
  else indexMarkdownBullets(ctx, rel, text, st.mtimeMs);
  db.prepare('INSERT OR REPLACE INTO recall_files(path, size, mtime, offset) VALUES (?, ?, ?, ?)').run(rel, st.size, st.mtimeMs, st.size);
  return true;
}

/** Run one bounded slice of indexing work. Returns true when nothing is left. */
export function runRecallIndexSlice(workspacePath: string, budgetMs = SLICE_BUDGET_MS): boolean {
  const db = openDb(workspacePath);
  if (!db) return true;
  const s = stateFor(workspacePath);
  const now = Date.now();
  if (!s.queue.length && (now - s.lastFullScanAt > FULL_SCAN_INTERVAL_MS)) {
    s.queue = listCandidateFiles(workspacePath);
    s.lastFullScanAt = now;
  }
  const started = Date.now();
  const ctx: InsertCtx = {
    insertDoc: db.prepare('INSERT INTO recall_fts(body, title, source, session_id, role, ts, path) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    insertIdea: db.prepare('INSERT OR IGNORE INTO recall_ideas(hash, session_id, ts, text) VALUES (?, ?, ?, ?)'),
  };
  const work = db.transaction(() => {
    // Dirty files (just written turns/notes) jump the backfill queue.
    for (const abs of Array.from(s.dirty)) {
      s.dirty.delete(abs);
      indexFile(db, workspacePath, abs, ctx);
      if (Date.now() - started > budgetMs) return;
    }
    while (s.queue.length && Date.now() - started <= budgetMs) {
      indexFile(db, workspacePath, s.queue.shift() as string, ctx);
    }
  });
  work();
  const done = s.dirty.size === 0 && s.queue.length === 0;
  if (done && !s.backfillComplete) {
    s.backfillComplete = true;
    db.prepare("INSERT OR REPLACE INTO recall_meta(key, value) VALUES ('backfill_complete_at', ?)").run(new Date().toISOString());
  }
  return done;
}

function scheduleSlices(workspacePath: string, delayMs: number): void {
  const s = stateFor(workspacePath);
  if (s.timer || s.running) return;
  s.timer = setTimeout(() => {
    s.timer = null;
    s.running = true;
    let done = true;
    try { done = runRecallIndexSlice(workspacePath); } catch (err: any) {
      console.warn('[recall-index] slice failed:', String(err?.message || err).slice(0, 300));
    } finally { s.running = false; }
    if (!done) scheduleSlices(workspacePath, SLICE_GAP_MS);
  }, Math.max(0, delayMs));
  (s.timer as any)?.unref?.();
}

/** Mark a transcript/note file as changed; it is indexed within a few seconds. */
export function markRecallDirty(workspacePath: string, absPath: string, delayMs = 3000): void {
  if (!workspacePath || !absPath || process.env.PROMETHEUS_DISABLE_RECALL_INDEX === '1') return;
  stateFor(workspacePath).dirty.add(path.resolve(absPath));
  scheduleSlices(workspacePath, delayMs);
}

/** Start the background backfill + periodic rescan for a workspace. */
export function startRecallIndex(workspacePath: string, initialDelayMs = 15_000): void {
  if (!workspacePath || process.env.PROMETHEUS_DISABLE_RECALL_INDEX === '1') return;
  const s = stateFor(workspacePath);
  s.lastFullScanAt = 0;
  scheduleSlices(workspacePath, initialDelayMs);
  const interval = setInterval(() => {
    stateFor(workspacePath).lastFullScanAt = 0;
    scheduleSlices(workspacePath, 0);
  }, FULL_SCAN_INTERVAL_MS);
  (interval as any).unref?.();
}

export function getRecallIndexStats(workspacePath: string): RecallIndexStats {
  const s = stateFor(workspacePath);
  try {
    const db = openDb(workspacePath);
    if (!db) return { available: false, docs: 0, files: 0, pendingFiles: 0, backfillComplete: false, error: loadError || 'sqlite unavailable' };
    const docs = Number((db.prepare('SELECT COUNT(*) AS n FROM recall_fts').get() as any)?.n || 0);
    const files = Number((db.prepare('SELECT COUNT(*) AS n FROM recall_files').get() as any)?.n || 0);
    const persisted = db.prepare("SELECT value FROM recall_meta WHERE key = 'backfill_complete_at'").get() as any;
    return { available: true, docs, files, pendingFiles: s.queue.length + s.dirty.size, backfillComplete: s.backfillComplete || !!persisted?.value };
  } catch (err: any) {
    return { available: false, docs: 0, files: 0, pendingFiles: 0, backfillComplete: false, error: String(err?.message || err) };
  }
}

export function recallQueryTerms(query: string): string[] {
  const seen = new Set<string>();
  for (const raw of String(query || '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || STOPWORDS.has(raw)) continue;
    seen.add(raw);
  }
  return Array.from(seen).slice(0, 12);
}

function termStem(term: string): string {
  return term.length > 5 ? term.slice(0, Math.max(5, term.length - 2)) : term;
}

function parseDate(value: string | undefined, endOfDay = false): number | null {
  if (!value) return null;
  const v = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T${endOfDay ? '23:59:59' : '00:00:00'}` : value;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

export function searchRecall(workspacePath: string, params: RecallSearchParams): RecallSearchResult {
  const stats = getRecallIndexStats(workspacePath);
  const terms = recallQueryTerms(params.query);
  const empty: RecallSearchResult = { query: params.query, terms, best: 'none', hits: [], stats };
  if (!stats.available || !terms.length) return empty;
  const db = openDb(workspacePath);
  const limit = Math.max(1, Math.min(30, Number(params.limit || 8)));
  const sources = (params.sources || []).filter(Boolean);
  const from = parseDate(params.dateFrom);
  const to = parseDate(params.dateTo, true);
  const exclude = String(params.excludeSessionId || '');

  const run = (match: string, phrase: boolean) => db.prepare(`
    SELECT source, session_id, role, ts, path, title, body,
           snippet(recall_fts, 0, '«', '»', '…', 40) AS snip,
           bm25(recall_fts, 1.0, 0.4) AS rank
    FROM recall_fts WHERE recall_fts MATCH ?
    ORDER BY rank LIMIT ?`).all(match, limit * 25).map((r: any) => ({ ...r, phrase }));

  const rows: any[] = [];
  const quoted = terms.map((t) => `"${t.replace(/"/g, '')}"`);
  try { if (terms.length > 1) rows.push(...run(`"${terms.join(' ')}"`, true)); } catch { /* phrase syntax edge */ }
  try { rows.push(...run(quoted.join(' OR '), false)); } catch (err: any) {
    return { ...empty, stats: { ...stats, error: String(err?.message || err) } };
  }

  const seenDoc = new Set<string>();
  const perSession = new Map<string, number>();
  const hits: RecallHit[] = [];
  const nowMs = Date.now();
  const scored = rows
    .filter((r) => !exclude || r.session_id !== exclude)
    .filter((r) => !sources.length || sources.includes(r.source))
    .filter((r) => (from === null || Number(r.ts) >= from) && (to === null || Number(r.ts) <= to))
    .map((r) => {
      const body = String(r.body || '').toLowerCase();
      const matched = terms.filter((t) => body.includes(termStem(t))).length;
      const coverage = matched / terms.length;
      const ageDays = Math.max(0, (nowMs - Number(r.ts || 0)) / 86_400_000);
      const recency = Number(r.ts) ? Math.max(0, 0.05 - ageDays * 0.0005) : 0;
      const sourceBoost = r.source === 'idea' || r.source === 'memory' ? 0.04 : r.source === 'note' ? 0.02 : 0;
      const score = coverage * 0.7 + (r.phrase ? 0.25 : 0) + recency + sourceBoost + Math.min(0.05, -Number(r.rank) / 400);
      return { r, coverage, score };
    })
    .sort((a, b) => b.score - a.score);

  for (const { r, coverage, score } of scored) {
    const key = `${r.path}:${r.ts}:${String(r.body).slice(0, 80)}`;
    if (seenDoc.has(key)) continue;
    seenDoc.add(key);
    const sess = String(r.session_id || r.path);
    const count = perSession.get(sess) || 0;
    if (count >= 2) continue;
    perSession.set(sess, count + 1);
    const confidence: RecallHit['confidence'] = (r.phrase && coverage >= 0.6) || coverage >= 0.85 ? 'strong' : coverage >= 0.5 ? 'partial' : 'weak';
    hits.push({
      source: r.source,
      sessionId: String(r.session_id || ''),
      role: String(r.role || ''),
      ts: Number(r.ts) || 0,
      title: String(r.title || ''),
      path: String(r.path || ''),
      snippet: String(r.snip || '').replace(/\s+/g, ' ').slice(0, 420),
      coverage: Math.round(coverage * 100) / 100,
      phrase: !!r.phrase,
      confidence,
      score: Math.round(score * 1000) / 1000,
    });
    if (hits.length >= limit) break;
  }
  const best = hits.some((h) => h.confidence === 'strong') ? 'strong' : hits.some((h) => h.confidence === 'partial') ? 'partial' : 'none';
  return { query: params.query, terms, best, hits, stats };
}

export function listRecallIdeas(workspacePath: string, limit = 20): Array<{ sessionId: string; ts: number; text: string }> {
  const db = openDb(workspacePath);
  if (!db) return [];
  return (db.prepare('SELECT session_id, ts, text FROM recall_ideas ORDER BY ts DESC LIMIT ?').all(Math.max(1, Math.min(100, limit))) as any[])
    .map((r) => ({ sessionId: String(r.session_id || ''), ts: Number(r.ts) || 0, text: String(r.text || '') }));
}

export function formatRecallResult(result: RecallSearchResult): string {
  const lines: string[] = [];
  const s = result.stats;
  if (!s.available) return `recall unavailable: ${s.error || 'index not ready'}`;
  if (!result.terms.length) return 'recall: query has no searchable terms (only stopwords).';
  const coverageNote = s.backfillComplete ? '' : ` (backfill in progress, ${s.pendingFiles} files pending: older history may be missing)`;
  lines.push(`RECALL "${result.query}" terms=[${result.terms.join(', ')}] best=${result.best === 'none' ? 'NO STRONG MATCH' : result.best} index=${s.docs} docs/${s.files} files${coverageNote}`);
  if (!result.hits.length) {
    lines.push('No matches outside the current chat. Treat this as "not found", not as evidence it never happened.');
    return lines.join('\n');
  }
  for (const h of result.hits) {
    const when = h.ts ? new Date(h.ts).toISOString().replace('T', ' ').slice(0, 16) : 'undated';
    const where = h.source === 'transcript' || h.source === 'idea' ? `session=${h.sessionId}` : h.path;
    lines.push(`- [${h.confidence} ${Math.round(h.coverage * 100)}%${h.phrase ? ' phrase' : ''}] ${h.source}${h.role && h.source === 'transcript' ? `/${h.role}` : ''} ${when} ${where}${h.title && h.source !== 'transcript' ? ` (${h.title})` : ''}\n  ${h.snippet}`);
  }
  if (result.best !== 'strong') lines.push('No strong match: every hit misses some query terms. Say so rather than presenting these as the answer.');
  lines.push('Open a transcript hit with prometheus_thread_ops(action:"read", session_id) or read audit/chats/transcripts/<session>.jsonl.');
  return lines.join('\n');
}

/** Test/maintenance helper: drain all pending work synchronously. */
export function drainRecallIndex(workspacePath: string, maxSlices = 100_000): RecallIndexStats {
  const s = stateFor(workspacePath);
  s.lastFullScanAt = 0;
  for (let i = 0; i < maxSlices; i += 1) if (runRecallIndexSlice(workspacePath, 2_000)) break;
  return getRecallIndexStats(workspacePath);
}

export function closeRecallIndex(workspacePath: string): void {
  const key = path.resolve(workspacePath);
  const db = dbByWorkspace.get(key);
  if (db) { try { db.close(); } catch { /* ignore */ } dbByWorkspace.delete(key); }
  const s = states.get(key);
  if (s?.timer) clearTimeout(s.timer);
  states.delete(key);
}
