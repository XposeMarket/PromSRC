import fs from 'fs';
import path from 'path';

import { getConfig } from '../../config/config';
import type { ImportDiscoveryOptions } from './import-discovery';
import {
  isSafeAgentTranscriptName,
  listAgentIndexedFiles,
  messageOf,
  readHeadFacts,
  type AgentChatEntry,
  type AgentIndexedFile,
} from './import-agents';

/**
 * Stage 2 of the Agents & imports page: search an opened agent's chats.
 *
 * Title search: works on every chat of the agent (not just loaded pages). It
 * uses the same bounded head read stage 1 uses for titles and keeps titles in
 * process memory only (path + size + mtime keyed). Nothing is written to disk.
 *
 * Message search: an explicit, per-agent opt-in. It keeps a local SQLite FTS5
 * index of user and assistant message TEXT in its own database file
 * `<data dir>/imports/import-search.sqlite`. Nothing else is indexed (no tool
 * output, command output, file contents, system/developer prompts, reasoning
 * or base64). The index is never sent to a model, never part of memory or a
 * session, and query text and snippets are never logged. Turning the switch
 * off deletes that agent's rows; deleting all removes the database file.
 */

export const MAX_MESSAGE_CHARS = 8_000;
export const MAX_CHAT_CHARS = 400_000;
/** Bytes read from one transcript before the rest is left out (noted as truncated). */
export const MAX_FILE_READ_BYTES = 64 * 1024 * 1024;
const READ_CHUNK_BYTES = 1024 * 1024;
/** Bytes read between yields to the event loop. */
export const MAX_BYTES_PER_TICK = 16 * 1024 * 1024;
const MAX_QUERY_CHARS = 200;
const MAX_QUERY_TERMS = 12;
const MAX_SEARCH_PAGE = 100;
export const SNIPPET_MAX_CHARS = 160;
const TITLE_CACHE_LIMIT = 20_000;
const HIT_OPEN = '\u0002';
const HIT_CLOSE = '\u0003';
const SYSTEM_TEXT = /^\s*<(environment_context|recommended_plugins|user_instructions|permissions|system|developer|instructions)/i;

type SqliteDatabase = any;

// ---- FTS5 availability (runtime probe; tests can inject a result) ---------
let ftsProbe: (() => { ok: boolean; reason?: string }) | null = null;
let ftsResult: { ok: boolean; reason?: string } | null = null;

function loadSqlite(): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('better-sqlite3');
}

function defaultFtsProbe(): { ok: boolean; reason?: string } {
  let db: SqliteDatabase | null = null;
  try {
    const Database = loadSqlite();
    db = new Database(':memory:');
    db.exec('CREATE VIRTUAL TABLE fts_probe USING fts5(x)');
    return { ok: true };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: /fts5/i.test(text) ? 'The bundled SQLite has no full-text search (FTS5).' : 'The local database engine could not be loaded.' };
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

export function messageSearchAvailability(): { ok: boolean; reason?: string } {
  if (!ftsResult) ftsResult = (ftsProbe || defaultFtsProbe)();
  return ftsResult;
}

/** Test hook: replace the FTS5 probe (null restores the real one). */
export function setFtsProbeForTest(probe: (() => { ok: boolean; reason?: string }) | null): void {
  ftsProbe = probe;
  ftsResult = null;
}

// ---- database ----------------------------------------------------------------
let dbHandle: SqliteDatabase | null = null;
let dbHandlePath = '';

export function importSearchDbPath(): string {
  return path.join(getConfig().getConfigDir(), 'imports', 'import-search.sqlite');
}

function openDb(create: boolean): SqliteDatabase | null {
  const file = importSearchDbPath();
  if (dbHandle && dbHandlePath === file) return dbHandle;
  if (dbHandle) closeDb();
  if (!messageSearchAvailability().ok) return null;
  if (!create && !fs.existsSync(file)) return null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const Database = loadSqlite();
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      agent_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS files (
      agent_id TEXT NOT NULL,
      file_id TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime REAL NOT NULL,
      chars INTEGER NOT NULL DEFAULT 0,
      truncated INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (agent_id, file_id)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS messages USING fts5(
      agent_id UNINDEXED, file_id UNINDEXED, role UNINDEXED, text,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `);
  dbHandle = db;
  dbHandlePath = file;
  return db;
}

function closeDb(): void {
  try { dbHandle?.close(); } catch { /* ignore */ }
  dbHandle = null;
  dbHandlePath = '';
}

/** Test hook: close the database handle (for example before removing a temp dir). */
export function closeImportSearchDb(): void { closeDb(); }

function dbBytesOnDisk(): number {
  const file = importSearchDbPath();
  let total = 0;
  for (const suffix of ['', '-wal', '-shm']) {
    try { total += fs.statSync(file + suffix).size; } catch { /* missing */ }
  }
  return total;
}

function isEnabled(db: SqliteDatabase | null, agentId: string): boolean {
  if (!db) return false;
  const row = db.prepare('SELECT enabled FROM agents WHERE agent_id = ?').get(agentId);
  return !!row?.enabled;
}

// ---- titles (memory only) ------------------------------------------------------
const titleCache = new Map<string, { size: number; mtime: number; title: string }>();

function fallbackTitle(fileId: string): string {
  const base = fileId.split('/').pop() || fileId;
  return base.replace(/\.(jsonl|json|md)$/i, '');
}

function titleFor(file: AgentIndexedFile, adapter: Parameters<typeof readHeadFacts>[1]): string {
  const cached = titleCache.get(file.absolutePath);
  if (cached && cached.size === file.bytes && cached.mtime === file.updatedAt) return cached.title;
  // Same bounded head read stage 1 does for titles of an opened row.
  const title = readHeadFacts(file.absolutePath, adapter, true).title || fallbackTitle(file.id);
  if (titleCache.size >= TITLE_CACHE_LIMIT) titleCache.clear();
  titleCache.set(file.absolutePath, { size: file.bytes, mtime: file.updatedAt, title });
  return title;
}

/** Test hook / privacy: forget in-memory titles. */
export function clearTitleCache(): void { titleCache.clear(); }

// ---- query building ------------------------------------------------------------
/** Lower-cased title terms (substring match, every term must appear). */
export function titleTerms(query: string): string[] {
  return String(query || '').slice(0, MAX_QUERY_CHARS).toLowerCase().split(/\s+/).map((t) => t.trim()).filter(Boolean).slice(0, MAX_QUERY_TERMS);
}

/**
 * FTS5 MATCH expression from user text: word tokens only, each one a quoted
 * string, the last one a prefix match. Every FTS operator or quote in the user
 * text is dropped, so the expression is always well-formed. It is passed to
 * SQLite as a bound parameter, never concatenated into SQL.
 */
export function buildFtsQuery(query: string): string {
  const words = String(query || '').slice(0, MAX_QUERY_CHARS).match(/[\p{L}\p{N}_]+/gu) || [];
  const terms = words.slice(0, MAX_QUERY_TERMS).map((word) => `"${word.replace(/"/g, '""')}"`);
  if (!terms.length) return '';
  terms[terms.length - 1] = `${terms[terms.length - 1]}*`;
  return terms.join(' ');
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));
}

/**
 * Turns an FTS snippet with \u0002/\u0003 hit markers into safe HTML: at most
 * SNIPPET_MAX_CHARS visible characters, everything escaped, only the matched
 * words wrapped in <b>.
 */
export function snippetToHtml(raw: string): string {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  let out = '';
  let visible = 0;
  let open = false;
  let piece = '';
  const flush = () => { out += escapeHtml(piece); piece = ''; };
  for (const ch of text) {
    if (ch === HIT_OPEN) { flush(); if (!open) { out += '<b>'; open = true; } continue; }
    if (ch === HIT_CLOSE) { flush(); if (open) { out += '</b>'; open = false; } continue; }
    if (visible >= SNIPPET_MAX_CHARS) break;
    piece += ch;
    visible += 1;
  }
  flush();
  if (open) out += '</b>';
  return out.replace(/<b><\/b>/g, '');
}

// ---- search ----------------------------------------------------------------------
export interface AgentSearchHit extends AgentChatEntry {
  match: 'title' | 'message';
  /** Escaped HTML, max 160 visible chars, only the match wrapped in <b>. Message hits only. */
  snippetHtml?: string;
}

export interface AgentSearchResult {
  agentId: string;
  query: string;
  scope: 'title' | 'all';
  results: AgentSearchHit[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  totalChats: number;
  messageSearch: {
    state: 'off' | 'unavailable' | 'building' | 'ready' | 'partial';
    reason?: string;
    indexedChats: number;
  };
}

export interface AgentSearchOptions extends ImportDiscoveryOptions {
  q?: string;
  scope?: 'title' | 'all';
  offset?: number;
  limit?: number;
}

export async function searchAgentChats(agentId: string, options: AgentSearchOptions = {}): Promise<AgentSearchResult> {
  const listing = listAgentIndexedFiles(agentId, options);
  const query = String(options.q || '').slice(0, MAX_QUERY_CHARS);
  const scope = options.scope === 'all' ? 'all' : 'title';
  const offset = Math.max(0, Math.floor(Number(options.offset) || 0));
  const limit = Math.max(1, Math.min(MAX_SEARCH_PAGE, Math.floor(Number(options.limit) || 50)));
  const terms = titleTerms(query);
  const titles = new Map<string, string>();
  const titleHits = new Set<string>();
  if (terms.length) {
    let uncached = 0;
    for (const file of listing.files) {
      const cached = titleCache.get(file.absolutePath);
      const fromCache = !!cached && cached.size === file.bytes && cached.mtime === file.updatedAt;
      const title = titleFor(file, listing.adapter);
      // Cold titles read and parse up to 96 KB each: yield every 24 so the event loop keeps running.
      if (!fromCache && ++uncached % 24 === 0) await yieldTick();
      titles.set(file.id, title);
      const lower = title.toLowerCase();
      if (terms.every((term) => lower.includes(term))) titleHits.add(file.id);
    }
  }

  const availability = messageSearchAvailability();
  const db = availability.ok ? openDb(false) : null;
  const enabled = isEnabled(db, listing.agentId);
  const indexedChats = enabled ? countIndexed(db, listing.agentId) : 0;
  const building = jobs.has(listing.agentId);
  const messageSearch: AgentSearchResult['messageSearch'] = !availability.ok
    ? { state: 'unavailable', reason: availability.reason, indexedChats: 0 }
    : !enabled ? { state: 'off', indexedChats: 0 }
      : { state: building ? 'building' : indexedChats < listing.files.length ? 'partial' : 'ready', indexedChats };

  const messageHits = new Set<string>();
  const fts = scope === 'all' && enabled && db ? buildFtsQuery(query) : '';
  if (fts) {
    const current = new Set(listing.files.map((file) => file.id));
    try {
      const rows = db.prepare('SELECT DISTINCT file_id FROM messages WHERE messages MATCH ? AND agent_id = ?').all(fts, listing.agentId);
      // Only chats that are in this agent row right now; never a vanished file.
      for (const row of rows) if (current.has(String(row.file_id))) messageHits.add(String(row.file_id));
    } catch {
      // A malformed expression returns no message hits, not an error.
    }
  }

  const matched = listing.files.filter((file) => titleHits.has(file.id) || messageHits.has(file.id));
  const page = matched.slice(offset, offset + limit);
  const snippetStmt = fts && db
    ? db.prepare(`SELECT snippet(messages, 3, char(2), char(3), '…', 20) AS s FROM messages WHERE messages MATCH ? AND agent_id = ? AND file_id = ? LIMIT 1`)
    : null;
  const results = page.map((file): AgentSearchHit => {
    const inTitle = titleHits.has(file.id);
    let snippetHtml: string | undefined;
    if (!inTitle && snippetStmt) {
      try { snippetHtml = snippetToHtml(String(snippetStmt.get(fts, listing.agentId, file.id)?.s || '')); } catch { snippetHtml = undefined; }
    }
    return {
      id: file.id,
      bytes: file.bytes,
      updatedAt: file.updatedAt,
      title: titles.get(file.id) || titleFor(file, listing.adapter),
      ...(file.group ? { groupKey: file.group.key, groupLabel: file.group.label, groupKind: file.group.kind } : {}),
      ...(file.sourceConversationId ? { sourceConversationId: file.sourceConversationId } : {}),
      match: inTitle ? 'title' : 'message',
      ...(snippetHtml ? { snippetHtml } : {}),
    };
  });
  return {
    agentId: listing.agentId,
    query,
    scope,
    results,
    total: matched.length,
    offset,
    limit,
    hasMore: offset + page.length < matched.length,
    totalChats: listing.files.length,
    messageSearch,
  };
}

function countIndexed(db: SqliteDatabase | null, agentId: string): number {
  if (!db) return 0;
  return Number(db.prepare('SELECT COUNT(*) AS n FROM files WHERE agent_id = ?').get(agentId)?.n || 0);
}

// ---- index build -----------------------------------------------------------------
interface BuildJob {
  agentId: string;
  total: number;
  done: number;
  cancelled: boolean;
  promise: Promise<void>;
  error?: string;
}

const jobs = new Map<string, BuildJob>();
const BASE64_RUN = /(?:data:[\w/+.-]+;base64,)?[A-Za-z0-9+/=]{200,}/g;

/** Test hook: counts transcript files opened by the index builder. */
export const indexReadCounter = { files: 0, bytes: 0 };

function yieldTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** User/assistant text only, via the stage 1 `messageOf`; everything else is skipped. */
export function indexableMessage(record: any): { role: string; text: string } | null {
  const message = messageOf(record);
  if (!message || (message.role !== 'user' && message.role !== 'assistant')) return null;
  let text = String(message.text || '');
  if (!text.trim() || SYSTEM_TEXT.test(text)) return null;
  text = text.replace(BASE64_RUN, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return { role: message.role, text: text.slice(0, MAX_MESSAGE_CHARS) };
}

function insideRoot(root: string, file: string): boolean {
  try {
    const realRoot = fs.realpathSync(root);
    const realFile = fs.realpathSync(file);
    const rel = path.relative(realRoot, realFile);
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  } catch {
    return false;
  }
}

/** Reads one transcript in bounded async chunks and returns its indexable messages. */
async function readMessages(file: string, budget: { tickBytes: number }, isCancelled: () => boolean): Promise<{ messages: Array<{ role: string; text: string }>; chars: number; truncated: boolean }> {
  const messages: Array<{ role: string; text: string }> = [];
  let chars = 0;
  let truncated = false;
  const handle = await fs.promises.open(file, 'r');
  indexReadCounter.files += 1;
  try {
    const size = (await handle.stat()).size;
    const limit = Math.min(size, MAX_FILE_READ_BYTES);
    if (size > MAX_FILE_READ_BYTES) truncated = true;
    let position = 0;
    let rest = '';
    const buffer = Buffer.alloc(READ_CHUNK_BYTES);
    const takeLine = (line: string): boolean => {
      const trimmed = line.trim();
      if (!trimmed || trimmed[0] !== '{') return true;
      let record: any;
      try { record = JSON.parse(trimmed); } catch { return true; }
      const message = indexableMessage(record);
      if (!message) return true;
      const room = MAX_CHAT_CHARS - chars;
      if (room <= 0) { truncated = true; return false; }
      const text = message.text.length > room ? message.text.slice(0, room) : message.text;
      if (text.length < message.text.length) truncated = true;
      messages.push({ role: message.role, text });
      chars += text.length;
      return chars < MAX_CHAT_CHARS;
    };
    let keepGoing = true;
    while (keepGoing && position < limit) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(READ_CHUNK_BYTES, limit - position), position);
      if (!bytesRead) break;
      position += bytesRead;
      indexReadCounter.bytes += bytesRead;
      budget.tickBytes += bytesRead;
      // utf8 split at chunk edges is handled by keeping the partial last line.
      const text = rest + buffer.subarray(0, bytesRead).toString('latin1');
      const lines = text.split('\n');
      rest = lines.pop() || '';
      if (rest.length > 16 * 1024 * 1024) rest = ''; // one absurd line (e.g. an image) is skipped
      for (const line of lines) {
        if (!takeLine(Buffer.from(line, 'latin1').toString('utf8'))) { keepGoing = false; break; }
      }
      if (budget.tickBytes >= MAX_BYTES_PER_TICK) { budget.tickBytes = 0; await yieldTick(); }
      if (isCancelled() && keepGoing && position < limit) { /* finish the current file; cancel applies between files */ }
    }
    if (keepGoing && rest) takeLine(Buffer.from(rest, 'latin1').toString('utf8'));
    if (position < size && keepGoing && size > MAX_FILE_READ_BYTES) truncated = true;
  } finally {
    await handle.close();
  }
  return { messages, chars, truncated };
}

async function runBuild(job: BuildJob, options: ImportDiscoveryOptions): Promise<void> {
  await yieldTick(); // never run on the request path
  const listing = listAgentIndexedFiles(job.agentId, options);
  const db = openDb(true);
  if (!db) throw new Error(messageSearchAvailability().reason || 'Message search is unavailable.');
  job.total = listing.files.length;
  const known = new Map<string, { size: number; mtime: number }>();
  for (const row of db.prepare('SELECT file_id, size, mtime FROM files WHERE agent_id = ?').all(job.agentId)) {
    known.set(String(row.file_id), { size: Number(row.size), mtime: Number(row.mtime) });
  }
  const current = new Set(listing.files.map((file) => file.id));
  const removeFile = db.transaction((fileId: string) => {
    db.prepare('DELETE FROM messages WHERE agent_id = ? AND file_id = ?').run(job.agentId, fileId);
    db.prepare('DELETE FROM files WHERE agent_id = ? AND file_id = ?').run(job.agentId, fileId);
  });
  // Files that vanished from disk leave the index.
  for (const fileId of known.keys()) if (!current.has(fileId)) removeFile(fileId);
  const writeFile = db.transaction((file: AgentIndexedFile, result: { messages: Array<{ role: string; text: string }>; chars: number; truncated: boolean }) => {
    db.prepare('DELETE FROM messages WHERE agent_id = ? AND file_id = ?').run(job.agentId, file.id);
    const insert = db.prepare('INSERT INTO messages (agent_id, file_id, role, text) VALUES (?, ?, ?, ?)');
    for (const message of result.messages) insert.run(job.agentId, file.id, message.role, message.text);
    db.prepare('INSERT OR REPLACE INTO files (agent_id, file_id, size, mtime, chars, truncated) VALUES (?, ?, ?, ?, ?, ?)')
      .run(job.agentId, file.id, file.bytes, file.updatedAt, result.chars, result.truncated ? 1 : 0);
  });
  const budget = { tickBytes: 0 };
  let sinceYield = 0;
  for (const file of listing.files) {
    if (job.cancelled) break;
    // Switch turned off (or index deleted) mid-build: stop and write nothing more.
    if (!isEnabled(dbHandle, job.agentId)) break;
    const prior = known.get(file.id);
    if (prior && prior.size === file.bytes && prior.mtime === file.updatedAt) { job.done += 1; continue; }
    if (!isSafeAgentTranscriptName(file.id) || !insideRoot(listing.root, file.absolutePath)) { job.done += 1; continue; }
    let result;
    try {
      result = await readMessages(file.absolutePath, budget, () => job.cancelled);
    } catch {
      job.done += 1;
      continue; // unreadable file: skipped, retried next build
    }
    if (!dbHandle || !isEnabled(dbHandle, job.agentId)) break;
    writeFile(file, result);
    job.done += 1;
    sinceYield += 1;
    if (sinceYield >= 4) { sinceYield = 0; await yieldTick(); }
  }
}

function setEnabled(db: SqliteDatabase, agentId: string, enabled: boolean): void {
  db.prepare('INSERT INTO agents (agent_id, enabled, updated_at) VALUES (?, ?, ?) ON CONFLICT(agent_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at')
    .run(agentId, enabled ? 1 : 0, Date.now());
}

/**
 * Turns message search on for one agent (explicit user action) and starts or
 * joins its index build. Returns immediately; poll `searchIndexStatus`.
 */
export function startSearchIndex(agentId: string, options: ImportDiscoveryOptions = {}): SearchIndexStatus {
  const availability = messageSearchAvailability();
  if (!availability.ok) throw new Error(availability.reason || 'Message search is unavailable.');
  const listing = listAgentIndexedFiles(agentId, options); // validates the agent
  const id = listing.agentId;
  const db = openDb(true);
  if (!db) throw new Error('Message search is unavailable.');
  setEnabled(db, id, true);
  if (!jobs.has(id)) {
    const job: BuildJob = { agentId: id, total: listing.files.length, done: 0, cancelled: false, promise: Promise.resolve() };
    job.promise = runBuild(job, options)
      .catch((error) => { job.error = error instanceof Error ? error.message : String(error); lastErrors.set(id, job.error); })
      .finally(() => { if (jobs.get(id) === job) jobs.delete(id); });
    lastErrors.delete(id);
    jobs.set(id, job);
  }
  return searchIndexStatus(id, options, listing.files.length);
}

const lastErrors = new Map<string, string>();

/** Test hook: wait for an agent's running build. */
export async function waitForSearchIndex(agentId: string): Promise<void> {
  await jobs.get(agentId)?.promise;
}

/** Stops the running build after the current file. The partial index stays usable. */
export function cancelSearchIndex(agentId: string): { cancelled: boolean } {
  const job = jobs.get(String(agentId || ''));
  if (!job) return { cancelled: false };
  job.cancelled = true;
  return { cancelled: true };
}

// ---- status and delete -----------------------------------------------------------
export interface SearchIndexStatus {
  agentId: string;
  messageSearch: 'off' | 'unavailable' | 'building' | 'ready' | 'partial';
  reason?: string;
  enabled: boolean;
  building: boolean;
  cancelling: boolean;
  indexedChats: number;
  totalChats: number;
  truncatedChats: number;
  /** Size of the whole search database on disk (all agents), bytes. */
  indexBytes: number;
  /** Rough share of the database used by this agent, bytes. */
  agentBytes: number;
  progress?: { done: number; total: number };
  error?: string;
}

/**
 * Status for one agent. Does not require the agent to still be detected, so a
 * vanished agent's index stays reachable and deletable.
 */
export function searchIndexStatus(agentId: string, options: ImportDiscoveryOptions = {}, knownTotal?: number): SearchIndexStatus {
  const id = String(agentId || '').trim().toLowerCase();
  const availability = messageSearchAvailability();
  let totalChats = knownTotal ?? -1;
  if (totalChats < 0) {
    try { totalChats = listAgentIndexedFiles(id, options).files.length; } catch { totalChats = 0; }
  }
  if (!availability.ok) {
    return { agentId: id, messageSearch: 'unavailable', reason: availability.reason, enabled: false, building: false, cancelling: false, indexedChats: 0, totalChats, truncatedChats: 0, indexBytes: 0, agentBytes: 0 };
  }
  const db = openDb(false);
  const enabled = isEnabled(db, id);
  const job = jobs.get(id);
  const indexedChats = db ? countIndexed(db, id) : 0;
  const truncatedChats = db ? Number(db.prepare('SELECT COUNT(*) AS n FROM files WHERE agent_id = ? AND truncated = 1').get(id)?.n || 0) : 0;
  let agentBytes = 0;
  if (db) {
    const mine = Number(db.prepare('SELECT COALESCE(SUM(chars), 0) AS n FROM files WHERE agent_id = ?').get(id)?.n || 0);
    const all = Number(db.prepare('SELECT COALESCE(SUM(chars), 0) AS n FROM files').get()?.n || 0);
    agentBytes = all > 0 ? Math.round(dbBytesOnDisk() * (mine / all)) : 0;
  }
  const state: SearchIndexStatus['messageSearch'] = !enabled ? 'off' : job ? 'building' : indexedChats < totalChats ? 'partial' : 'ready';
  return {
    agentId: id,
    messageSearch: state,
    enabled,
    building: !!job,
    cancelling: !!job?.cancelled,
    indexedChats,
    totalChats,
    truncatedChats,
    indexBytes: db ? dbBytesOnDisk() : 0,
    agentBytes,
    ...(job ? { progress: { done: job.done, total: job.total } } : {}),
    ...(lastErrors.has(id) ? { error: lastErrors.get(id) } : {}),
  };
}

/** Switch off: stop any build and delete this agent's rows. */
export function deleteAgentSearchIndex(agentId: string): { agentId: string; deleted: boolean; removedChats: number } {
  const id = String(agentId || '').trim().toLowerCase();
  const job = jobs.get(id);
  if (job) job.cancelled = true;
  lastErrors.delete(id);
  if (!messageSearchAvailability().ok) return { agentId: id, deleted: false, removedChats: 0 };
  const db = openDb(false);
  if (!db) return { agentId: id, deleted: true, removedChats: 0 };
  const removedChats = countIndexed(db, id);
  db.transaction(() => {
    db.prepare('DELETE FROM messages WHERE agent_id = ?').run(id);
    db.prepare('DELETE FROM files WHERE agent_id = ?').run(id);
    db.prepare('DELETE FROM agents WHERE agent_id = ?').run(id);
  })();
  const left = Number(db.prepare('SELECT COUNT(*) AS n FROM agents').get()?.n || 0);
  if (!left) {
    removeDbFiles();
  } else {
    try { db.exec("INSERT INTO messages(messages) VALUES('optimize')"); db.pragma('wal_checkpoint(TRUNCATE)'); db.exec('VACUUM'); } catch { /* best effort */ }
  }
  return { agentId: id, deleted: true, removedChats };
}

function removeDbFiles(): void {
  closeDb();
  const file = importSearchDbPath();
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { fs.rmSync(file + suffix, { force: true }); } catch { /* ignore */ }
  }
}

/** "Delete search index" in the tools area: every agent, the whole file. */
export function deleteAllSearchIndexes(): { deleted: boolean; agents: string[] } {
  for (const job of jobs.values()) job.cancelled = true;
  lastErrors.clear();
  let agents: string[] = [];
  if (messageSearchAvailability().ok) {
    const db = openDb(false);
    if (db) {
      try { agents = db.prepare('SELECT agent_id FROM agents').all().map((row: any) => String(row.agent_id)); } catch { agents = []; }
    }
  }
  removeDbFiles();
  return { deleted: true, agents };
}

/** Agents that have an index on disk, detected or not (so nothing is unreachable). */
export function listIndexedAgents(): { agents: Array<{ agentId: string; enabled: boolean; indexedChats: number }>; indexBytes: number; messageSearch: 'available' | 'unavailable'; reason?: string } {
  const availability = messageSearchAvailability();
  if (!availability.ok) return { agents: [], indexBytes: 0, messageSearch: 'unavailable', reason: availability.reason };
  const db = openDb(false);
  if (!db) return { agents: [], indexBytes: 0, messageSearch: 'available' };
  const agents = db.prepare('SELECT a.agent_id AS agentId, a.enabled AS enabled, (SELECT COUNT(*) FROM files f WHERE f.agent_id = a.agent_id) AS n FROM agents a').all()
    .map((row: any) => ({ agentId: String(row.agentId), enabled: !!row.enabled, indexedChats: Number(row.n || 0) }));
  return { agents, indexBytes: dbBytesOnDisk(), messageSearch: 'available' };
}
