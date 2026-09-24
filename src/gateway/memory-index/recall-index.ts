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

// Bump when extraction or tokenisation rules change: the index is rebuilt so
// stale rows (e.g. ideas captured by looser rules) are cleared.
const RECALL_INDEX_VERSION = '2';

// Trigger phrases must be followed by a concrete object (see extractIdeaText).
const IDEA_PATTERN = /\b(we should (?:add|build|make|create|have|hook|wire|let|support|show|move|turn)|we could (?:add|build|make|create|have)|can we (?:add|build|make|create|hook|wire|get|have)|could we (?:add|build|make|create|have)|lets? (?:add|build|make|create|wire|hook up)|i want (?:to add|to build|you to build|to make|a |an )|i(?:'d| would) like (?:to add|to build|to make|a |an )|would be (?:cool|nice|sick|dope) (?:if|to)|new (?:idea|feature)[:,-]|idea:)/i;

// Objects that make a trigger generic ("lets do all of these", "can we get it").
const IDEA_GENERIC_WORDS = new Set([
  'all', 'these', 'those', 'this', 'that', 'it', 'them', 'everything', 'something', 'anything', 'ahead', 'back', 'more',
  'some', 'stuff', 'thing', 'things', 'one', 'ones', 'fixes', 'fix', 'same', 'too', 'also', 'now', 'here', 'work', 'going',
  'started', 'done', 'sure', 'okay', 'ok', 'lol', 'lmao',
]);

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

/** Shared handle for sibling modules (recall-embeddings). */
export function getRecallDb(workspacePath: string): any | null { return openDb(workspacePath); }

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
  const version = (db.prepare("SELECT value FROM recall_meta WHERE key = 'index_version'").get() as any)?.value;
  if (version !== RECALL_INDEX_VERSION) {
    db.exec("DELETE FROM recall_fts; DELETE FROM recall_files; DELETE FROM recall_ideas; DELETE FROM recall_meta WHERE key = 'backfill_complete_at';");
    db.prepare("INSERT OR REPLACE INTO recall_meta(key, value) VALUES ('index_version', ?)").run(RECALL_INDEX_VERSION);
  }
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
  // MEMORY-archive.md holds entries moved out of MEMORY.md (not injected every
  // turn) so they stay searchable through recall.
  for (const name of ['MEMORY.md', 'USER.md', 'IDEAS.md', 'MEMORY-archive.md']) {
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

/**
 * Extract a "we should build X" idea from a user message, or null.
 * Pasted material (quoted text, upload manifests, code, restart packets) is
 * ignored, and a trigger only counts when a concrete object follows it.
 */
export function extractIdeaText(content: string): string | null {
  let text = String(content || '');
  if (text.trim().length < 12) return null;
  text = text
    .replace(/\[UPLOADED FILES\][\s\S]*$/i, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/"[^"]{40,}"/g, ' ')
    .replace(/[\u201c][^\u201d]{40,}[\u201d]/g, ' ')
    .replace(/^\s*>.*$/gm, ' ');
  // Heavily pasted messages (long, few of the user's own words) are skipped.
  if (text.length > 4000) text = text.slice(0, 1500);
  const sentences = text.split(/(?<=[.!?])\s+|\n+/);
  for (const raw of sentences) {
    const sentence = raw.replace(/\s+/g, ' ').trim();
    if (sentence.length < 12 || /^(\[|#|-{2,}|\|)/.test(sentence)) continue;
    const match = IDEA_PATTERN.exec(sentence);
    if (!match) continue;
    const rest = sentence.slice(match.index + match[0].length).toLowerCase();
    const words = rest.split(/[^a-z0-9']+/).filter(Boolean);
    if (!words.length || IDEA_GENERIC_WORDS.has(words[0]) || (words[0] === 'the' && IDEA_GENERIC_WORDS.has(words[1] || ''))) continue;
    const content = words.filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !IDEA_GENERIC_WORDS.has(w));
    if (content.length < 2) continue;
    return sentence.slice(0, 300);
  }
  return null;
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
    const noteStatus = /\((open|done|info)\)\s*$/m.exec(entry.split('\n')[0] || '')?.[1] || '';
    if (body) ctx.insertDoc.run(clip(body), `note ${head[1].toLowerCase()}${noteStatus ? ' ' + noteStatus : ''}`, 'note', session, 'note', ts, rel);
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
function dropVectorsForPath(db: any, rel: string): void {
  try { db.prepare('DELETE FROM recall_vec WHERE path = ?').run(rel); } catch { /* table created lazily by recall-embeddings */ }
  try { require('./recall-embeddings').invalidateRecallVectorCache(); } catch { /* optional */ }
}

function indexFile(db: any, workspacePath: string, abs: string, ctx: InsertCtx): boolean {
  let st: fs.Stats;
  const rel = relKey(workspacePath, abs);
  try { st = fs.statSync(abs); } catch {
    db.prepare('DELETE FROM recall_fts WHERE path = ?').run(rel);
    dropVectorsForPath(db, rel);
    db.prepare('DELETE FROM recall_files WHERE path = ?').run(rel);
    return true;
  }
  const prev = db.prepare('SELECT size, mtime, offset FROM recall_files WHERE path = ?').get(rel) as any;
  if (prev && prev.size === st.size && prev.mtime === st.mtimeMs) return false;
  const isJsonl = abs.endsWith('.jsonl');
  if (isJsonl) {
    let offset = prev && st.size >= prev.offset ? Number(prev.offset) : 0;
    if (offset === 0 && prev) { db.prepare('DELETE FROM recall_fts WHERE path = ?').run(rel); dropVectorsForPath(db, rel); }
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
  dropVectorsForPath(db, rel);
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
    else { try { require('./recall-embeddings').scheduleRecallEmbedding(workspacePath); } catch { /* optional */ } }
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

/**
 * Make sure a search isn't answered from an empty or half-built index. Runs
 * pending indexing synchronously for up to budgetMs (the full backfill of ~4k
 * files takes ~5s), then lets the background slices finish the rest.
 */
export function ensureRecallIndexWarm(workspacePath: string, budgetMs = 2_500): void {
  if (!workspacePath || process.env.PROMETHEUS_DISABLE_RECALL_INDEX === '1') return;
  const db = openDb(workspacePath);
  if (!db) return;
  const s = stateFor(workspacePath);
  const persisted = db.prepare("SELECT value FROM recall_meta WHERE key = 'backfill_complete_at'").get() as any;
  if (s.backfillComplete || persisted?.value) {
    if (s.dirty.size && !s.running) {
      s.running = true;
      try { runRecallIndexSlice(workspacePath, 200); } finally { s.running = false; }
    }
    return;
  }
  if (s.running) return;
  if (s.timer) { clearTimeout(s.timer); s.timer = null; }
  if (!s.queue.length) s.lastFullScanAt = 0;
  const started = Date.now();
  s.running = true;
  let done = false;
  try {
    while (!done && Date.now() - started < budgetMs) done = runRecallIndexSlice(workspacePath, Math.min(400, budgetMs));
  } catch (err: any) {
    console.warn('[recall-index] warm-up failed:', String(err?.message || err).slice(0, 300));
  } finally { s.running = false; }
  if (!done) scheduleSlices(workspacePath, 0);
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

/**
 * Word-boundary term matching plus proximity. Returns how many query terms
 * occur as words (prefix match on a light stem) and the smallest window of
 * words containing one occurrence of each matched term.
 */
export function scoreRecallBody(body: string, terms: string[]): { matched: number; span: number } {
  const words = String(body || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const stems = terms.map(termStem);
  const hits: Array<{ pos: number; term: number }> = [];
  for (let i = 0; i < words.length; i += 1) {
    for (let t = 0; t < stems.length; t += 1) {
      if (words[i].startsWith(stems[t])) { hits.push({ pos: i, term: t }); break; }
    }
  }
  const present = new Set(hits.map((h) => h.term));
  const matched = present.size;
  if (matched <= 1) return { matched, span: matched };
  // Sliding window over hit positions covering every present term.
  const counts = new Map<number, number>();
  let have = 0;
  let best = Number.POSITIVE_INFINITY;
  let left = 0;
  for (let right = 0; right < hits.length; right += 1) {
    const tr = hits[right].term;
    counts.set(tr, (counts.get(tr) || 0) + 1);
    if (counts.get(tr) === 1) have += 1;
    while (have === matched) {
      best = Math.min(best, hits[right].pos - hits[left].pos + 1);
      const tl = hits[left].term;
      counts.set(tl, (counts.get(tl) || 0) - 1);
      if (counts.get(tl) === 0) have -= 1;
      left += 1;
    }
  }
  return { matched, span: best };
}

/** Confidence from coverage + proximity. Loose co-occurrence is never strong. */
export function recallConfidence(terms: number, matched: number, span: number): { confidence: 'strong' | 'partial' | 'weak'; coverage: number; tight: boolean } {
  const coverage = terms ? matched / terms : 0;
  // Allow a few filler words between each query term ("needs *you* card").
  const tight = matched >= 2 ? span <= matched * 3 + 1 : matched === 1 && terms === 1;
  let confidence: 'strong' | 'partial' | 'weak' = 'weak';
  if (coverage === 1 && tight) confidence = 'strong';
  else if (coverage >= 0.75 && tight && terms >= 4) confidence = 'strong';
  else if (coverage >= 0.5 && (tight || coverage === 1)) confidence = 'partial';
  return { confidence, coverage, tight };
}

function parseDate(value: string | undefined, endOfDay = false): number | null {
  if (!value) return null;
  const v = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T${endOfDay ? '23:59:59' : '00:00:00'}` : value;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

export function searchRecall(workspacePath: string, params: RecallSearchParams): RecallSearchResult {
  ensureRecallIndexWarm(workspacePath);
  const stats = getRecallIndexStats(workspacePath);
  const terms = recallQueryTerms(params.query);
  const empty: RecallSearchResult = { query: params.query, terms, best: 'none', hits: [], stats };
  if (!stats.available || !terms.length) return empty;
  const db = openDb(workspacePath);
  let hits: RecallHit[];
  try {
    hits = searchRecallCore(db, { ...params, terms });
  } catch (err: any) {
    return { ...empty, stats: { ...stats, error: String(err?.message || err) } };
  }
  const best = hits.some((h) => h.confidence === 'strong') ? 'strong' : hits.some((h) => h.confidence === 'partial') ? 'partial' : 'none';
  return { query: params.query, terms, best, hits, stats };
}

/** Ranked search over an open index. No warm-up, no stats: callers own that. */
function searchRecallCore(db: any, params: RecallSearchParams & { terms: string[] }): RecallHit[] {
  const terms = params.terms;
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
  // Proximity candidates first so tight matches aren't crowded out by bm25 on
  // long documents that merely mention every term somewhere.
  try { if (terms.length > 1) rows.push(...run(`NEAR(${quoted.join(' ')}, ${terms.length * 3})`, true)); } catch { /* NEAR syntax edge */ }
  rows.push(...run(quoted.join(' OR '), false));

  const seenDoc = new Set<string>();
  const perSession = new Map<string, number>();
  const hits: RecallHit[] = [];
  const nowMs = Date.now();
  const scored = rows
    .filter((r) => !exclude || r.session_id !== exclude)
    .filter((r) => !sources.length || sources.includes(r.source))
    .filter((r) => (from === null || Number(r.ts) >= from) && (to === null || Number(r.ts) <= to))
    .map((r) => {
      const { matched, span } = scoreRecallBody(String(r.body || ''), terms);
      const { confidence, coverage, tight } = recallConfidence(terms.length, matched, span);
      const ageDays = Math.max(0, (nowMs - Number(r.ts || 0)) / 86_400_000);
      const recency = Number(r.ts) ? Math.max(0, 0.05 - ageDays * 0.0005) : 0;
      const sourceBoost = r.source === 'idea' || r.source === 'memory' ? 0.04 : r.source === 'note' ? 0.02 : 0;
      const proximity = matched >= 2 && Number.isFinite(span) ? Math.min(1, (matched * 2) / span) : (tight ? 1 : 0);
      const score = coverage * 0.55 + proximity * 0.3 + recency + sourceBoost + Math.min(0.05, -Number(r.rank) / 400);
      return { r: { ...r, phrase: tight && matched >= 2 }, coverage, score, confidence };
    })
    .sort((a, b) => b.score - a.score);

  for (const { r, coverage, score, confidence } of scored) {
    const key = `${r.path}:${r.ts}:${String(r.body).slice(0, 80)}`;
    if (seenDoc.has(key)) continue;
    seenDoc.add(key);
    const sess = String(r.session_id || r.path);
    const count = perSession.get(sess) || 0;
    if (count >= 2) continue;
    perSession.set(sess, count + 1);
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
  return hits;
}

export interface SemanticRecallSection { model: string; coverage: number; hits: RecallHit[] }

/**
 * Meaning-based matches that keyword search missed. Only rows above a
 * similarity floor, deduped against the keyword hits, same exclusions/filters.
 * Never throws; returns null when embeddings aren't available yet.
 */
export async function searchRecallSemantic(
  workspacePath: string,
  params: RecallSearchParams,
  keywordHits: RecallHit[] = [],
): Promise<SemanticRecallSection | null> {
  let sem: { hits: Array<{ rowid: number; similarity: number }>; model: string; coverage: number };
  try { sem = await require('./recall-embeddings').semanticRecallSearch(workspacePath, params.query, 40); } catch { return null; }
  if (!sem.hits.length) return null;
  const db = openDb(workspacePath);
  if (!db) return null;
  const limit = Math.max(1, Math.min(10, Number(params.limit || 5)));
  const sources = (params.sources || []).filter(Boolean);
  const from = parseDate(params.dateFrom);
  const to = parseDate(params.dateTo, true);
  const exclude = String(params.excludeSessionId || '');
  const seen = new Set<string>(keywordHits.map((h) => `${h.path}:${h.ts}`));
  const perSession = new Map<string, number>();
  const get = db.prepare('SELECT source, session_id, role, ts, path, title, body FROM recall_fts WHERE rowid = ?');
  const out: RecallHit[] = [];
  // nomic-embed-text similarities: ~0.55+ is on-topic, ~0.65+ is a close match.
  const FLOOR = 0.55;
  for (const h of sem.hits) {
    if (h.similarity < FLOOR) break;
    const r = get.get(h.rowid) as any;
    if (!r) continue;
    if (exclude && r.session_id === exclude) continue;
    if (sources.length && !sources.includes(r.source)) continue;
    if ((from !== null && Number(r.ts) < from) || (to !== null && Number(r.ts) > to)) continue;
    const key = `${r.path}:${r.ts}`;
    // The same message is often stored twice (retries, restart re-appends);
    // dedupe by content too so one hit doesn't fill two slots.
    const bodyKey = String(r.body || '').replace(/\s+/g, ' ').trim().slice(0, 160).toLowerCase();
    if (seen.has(key) || seen.has(bodyKey)) continue;
    seen.add(key);
    seen.add(bodyKey);
    const sess = String(r.session_id || r.path);
    const n = perSession.get(sess) || 0;
    if (n >= 2) continue;
    perSession.set(sess, n + 1);
    out.push({
      source: r.source,
      sessionId: String(r.session_id || ''),
      role: String(r.role || ''),
      ts: Number(r.ts) || 0,
      title: String(r.title || ''),
      path: String(r.path || ''),
      snippet: String(r.body || '').replace(/\s+/g, ' ').slice(0, 320),
      coverage: 0,
      phrase: false,
      confidence: h.similarity >= 0.68 ? 'strong' : h.similarity >= 0.6 ? 'partial' : 'weak',
      score: Math.round(h.similarity * 1000) / 1000,
    });
    if (out.length >= limit) break;
  }
  return out.length ? { model: sem.model, coverage: sem.coverage, hits: out } : null;
}

export function formatSemanticRecallSection(section: SemanticRecallSection | null): string {
  if (!section) return '';
  const pct = Math.round(section.coverage * 100);
  const lines = [`SEMANTIC MATCHES (by meaning, not exact words; ${section.model}, ${pct}% of history embedded):`];
  for (const h of section.hits) {
    const when = h.ts ? new Date(h.ts).toISOString().slice(0, 16).replace('T', ' ') : '';
    const who = h.source === 'transcript' ? `transcript/${h.role}` : h.source;
    lines.push(`- [${h.confidence} sim ${h.score.toFixed(2)}] ${who} ${when} ${h.sessionId ? `[${h.sessionId}]` : h.path}`);
    lines.push(`  ${h.snippet}`);
  }
  return lines.join('\n');
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
  const coverageNote = s.backfillComplete ? '' : ` (index still building, ${s.pendingFiles} files pending: older history may be missing)`;
  if (!s.backfillComplete && s.docs === 0) {
    lines.push(`RECALL "${result.query}": the index is still being built after startup (0 docs yet, ${s.pendingFiles} files pending). This is NOT a "not found" result. Retry in a few seconds.`);
    return lines.join('\n');
  }
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

// ── Automatic per-turn recall ────────────────────────────────────────────────
// Runs before every interactive turn, so it must be fast, capped and quiet:
// it never warms the index (no blocking backfill), uses the rarest terms of the
// message (IDF) so long casual messages still find their topic, and injects
// only tight, well-covered matches. Returns '' when nothing clears the bar.

export interface AutoRecallOptions {
  excludeSessionId?: string;
  maxHits?: number;
  maxChars?: number;
  /** Extra per-message stop terms (e.g. assistant name). */
  ignoreTerms?: string[];
}

export interface AutoRecallResult {
  text: string;
  hits: number;
  candidates: number;
  terms: string[];
  ms: number;
  skipped?: string;
}

const AUTO_EXTRA_STOP = new Set([
  'now', 'look', 'looking', 'get', 'got', 'lets', 'let', 'sort', 'etc', 'okay', 'ok', 'go', 'ahead', 'make', 'making',
  'could', 'would', 'should', 'also', 'really', 'want', 'wanna', 'need', 'thing', 'things', 'stuff', 'something', 'every',
  'more', 'much', 'way', 'well', 'good', 'better', 'still', 'too', 'yes', 'yup', 'nah', 'idk', 'lol', 'lmao', 'bro', 'bruh',
  'here', 'thanks', 'thx', 'one', 'some', 'any', 'all', 'try', 'see', 'know', 'think', 'use', 'using', 'done', 'fix', 'again',
  'prom', 'prometheus', 'hey', 'yo', 'cool', 'nice', 'alright', 'right', 'ill', 'im', 'its', 'dont', 'cant', 'thats', 'whats',
]);

const AUTO_MAX_DF_RATIO = 0.08; // terms in >8% of docs carry little topical signal

export function buildAutoRecallContext(workspacePath: string, message: string, options: AutoRecallOptions = {}): AutoRecallResult {
  const started = Date.now();
  const done = (partial: Partial<AutoRecallResult>): AutoRecallResult => ({
    text: '', hits: 0, candidates: 0, terms: [], ...partial, ms: Date.now() - started,
  });
  if (!workspacePath || process.env.PROMETHEUS_DISABLE_AUTO_RECALL === '1') return done({ skipped: 'disabled' });
  const db = openDb(workspacePath);
  if (!db) return done({ skipped: 'unavailable' });
  const s = stateFor(workspacePath);
  const persisted = db.prepare("SELECT value FROM recall_meta WHERE key = 'backfill_complete_at'").get() as any;
  if (!s.backfillComplete && !persisted?.value) return done({ skipped: 'index_building' });

  const ignore = new Set((options.ignoreTerms || []).map((t) => t.toLowerCase()));
  const raw = recallQueryTerms(String(message || '').slice(0, 2_000))
    .filter((t) => !AUTO_EXTRA_STOP.has(t) && !ignore.has(t) && t.length >= 3 && !/^\d+$/.test(t));
  if (!raw.length) return done({ skipped: 'no_terms' });

  const totalDocs = Number((db.prepare('SELECT COUNT(*) AS n FROM recall_fts').get() as any)?.n || 0) || 1;
  const dfStmt = db.prepare('SELECT COUNT(*) AS n FROM recall_fts WHERE recall_fts MATCH ?');
  const withDf: Array<{ t: string; df: number }> = [];
  for (const t of raw) {
    let df = 0;
    try { df = Number((dfStmt.get(`"${t.replace(/"/g, '')}"`) as any)?.n || 0); } catch { continue; }
    if (df === 0) continue; // unknown word: can't help retrieval
    // Only meaningful on a real corpus; tiny/new workspaces keep every term.
    if (totalDocs >= 500 && df / totalDocs > AUTO_MAX_DF_RATIO) continue;
    withDf.push({ t, df });
  }
  withDf.sort((a, b) => a.df - b.df);
  const terms = withDf.slice(0, 5).map((x) => x.t);
  if (!terms.length) return done({ skipped: 'only_common_terms' });

  const result = searchRecallCore(db, {
    query: terms.join(' '),
    terms,
    limit: 12,
    excludeSessionId: options.excludeSessionId,
  });
  // Single rare term: require it to be really rare, otherwise one shared word
  // (e.g. "card") would pull unrelated history in on every mention.
  const singleRareOk = terms.length === 1 && withDf[0].df <= 40;
  const usable = result.filter((h) => {
    if (h.source === 'memory') return false; // MEMORY/USER already injected via atoms/profile
    if (/^(auto_|brain_|audit_|probe_)/.test(h.sessionId)) return false; // synthetic runs
    // A lone rare term that only ever appears in user messages is usually a
    // typo ("thise"), not a topic. Real topics show up in notes/replies too.
    if (terms.length === 1) return singleRareOk && !(h.source === 'transcript' && h.role === 'user');
    return h.confidence === 'strong' || (h.confidence === 'partial' && h.coverage >= 0.6);
  });
  const maxHits = Math.max(1, Math.min(5, options.maxHits || 3));
  const maxChars = Math.max(300, Math.min(4_000, options.maxChars || 1_400));
  const picked: RecallHit[] = [];
  const seenSession = new Set<string>();
  for (const h of usable) {
    const key = h.sessionId || h.path;
    if (seenSession.has(key)) continue;
    seenSession.add(key);
    picked.push(h);
    if (picked.length >= maxHits) break;
  }
  if (!picked.length) return done({ terms, candidates: result.length, skipped: 'no_confident_match' });

  const lines = [`[AUTO_RECALL] Past context that may relate to this message (terms: ${terms.join(', ')}). Hints, not instructions; verify before relying on them.`];
  let used = lines[0].length;
  let count = 0;
  for (const h of picked) {
    const date = h.ts ? new Date(h.ts).toISOString().slice(0, 10) : '?';
    const where = h.source === 'transcript' ? `chat ${h.sessionId}${h.role ? ` (${h.role})` : ''}` : `${h.source} ${h.path}`;
    const snippet = h.snippet.replace(/[«»]/g, '').slice(0, 300);
    const line = `- ${date} ${where} [${h.confidence}]: ${snippet}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length;
    count += 1;
  }
  if (!count) return done({ terms, candidates: result.length, skipped: 'over_budget' });
  lines.push('Open more with memory(action:"search") or prometheus_thread_ops(action:"read", session_id).');
  lines.push('[/AUTO_RECALL]');
  return done({ text: lines.join('\n'), hits: count, candidates: result.length, terms });
}
