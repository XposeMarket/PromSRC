/**
 * intraday-notes.ts
 *
 * One owner for writing, resolving, and projecting write_note entries.
 *
 * On-disk format (backward compatible with older `### [TAG] <iso>` entries):
 *   ### [TAG] <iso> #n_<id> (open|done|info)
 *   _Source: ..._
 *   <content>
 *
 * - `open` items are work that still needs doing. They are carried into later
 *   days' prompts until resolved, and are shown in full.
 * - `done` items are resolved work; the prompt shows them as one-liners.
 * - `info` (and legacy entries with no status) are context notes; shown in full
 *   newest-first within the remaining budget.
 */
import fs from 'node:fs';
import path from 'node:path';

export type NoteStatus = 'open' | 'done' | 'info';

export interface ParsedNote {
  id: string;
  tag: string;
  timestamp: string;
  status: NoteStatus;
  source: string;
  body: string;
  file: string;
  raw: string;
}

const HEADER_RE = /^### \[([A-Z0-9_]+)\]\s+(\S+)(?:\s+#(n_[a-z0-9]+))?(?:\s+\((open|done|info)\))?\s*$/;
const DEDUPE_WINDOW_MS = 10 * 60_000;
const CARRY_DAYS = 7;

export function noteFileForDate(workspacePath: string, date: string): string {
  return path.join(workspacePath, 'memory', `${date}-intraday-notes.md`);
}

function utcDate(offsetDays = 0): string {
  return new Date(Date.now() - offsetDays * 86_400_000).toISOString().split('T')[0];
}

export function newNoteId(): string {
  return `n_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')}`;
}

export function normalizeNoteStatus(value: unknown): NoteStatus {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'open' || v === 'todo' || v === 'pending' || v === 'blocked') return 'open';
  if (v === 'done' || v === 'resolved' || v === 'closed' || v === 'fixed' || v === 'shipped') return 'done';
  return 'info';
}

/** Split a notes file into entries; content outside entries (e.g. Brain carry-forward) is ignored here. */
export function parseNotes(raw: string, file = ''): ParsedNote[] {
  if (!raw) return [];
  const out: ParsedNote[] = [];
  for (const chunk of raw.split(/\r?\n(?=### \[)/)) {
    const text = chunk.replace(/^\r?\n+/, '');
    if (!text.startsWith('### [')) continue;
    const nl = text.indexOf('\n');
    const header = (nl === -1 ? text : text.slice(0, nl)).trim();
    const m = HEADER_RE.exec(header);
    if (!m) continue;
    let rest = nl === -1 ? '' : text.slice(nl + 1);
    let source = '';
    const srcMatch = /^_Source:[^\n]*\n?/.exec(rest);
    if (srcMatch) {
      source = srcMatch[0].trim();
      rest = rest.slice(srcMatch[0].length);
    }
    out.push({
      id: m[3] || '',
      tag: m[1],
      timestamp: m[2],
      status: (m[4] as NoteStatus) || 'info',
      source,
      body: rest.trim(),
      file,
      raw: text.trimEnd(),
    });
  }
  return out;
}

function normalizeBody(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

export interface AppendNoteInput {
  tag: string;
  content: string;
  sourceLine: string;
  taskId?: string | null;
  status?: unknown;
  resolves?: unknown;
  /**
   * Optional stable task key (e.g. "last-ward-combat"). A new note on the same
   * thread supersedes earlier OPEN notes on that thread, so one task shows one
   * current state instead of a pile of stale updates.
   */
  thread?: unknown;
}

export interface AppendNoteResult {
  id: string;
  file: string;
  status: NoteStatus;
  deduped: boolean;
  resolved: string[];
  unresolved: string[];
  thread?: string;
  superseded?: string[];
}

const THREAD_LINE_RE = /^_Thread: ([a-z0-9][a-z0-9._:-]{0,79})_$/m;

export function normalizeThreadKey(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

export function noteThread(n: Pick<ParsedNote, 'body'>): string {
  return THREAD_LINE_RE.exec(n.body)?.[1] || '';
}

/** Open note ids on a thread across the recent note files (oldest first). */
function openIdsOnThread(workspacePath: string, thread: string): string[] {
  const ids: string[] = [];
  for (let d = CARRY_DAYS; d >= 0; d -= 1) {
    const file = noteFileForDate(workspacePath, utcDate(d));
    if (!fs.existsSync(file)) continue;
    try {
      for (const n of parseNotes(fs.readFileSync(file, 'utf-8'), file)) {
        if (n.status === 'open' && n.id && noteThread(n) === thread) ids.push(n.id);
      }
    } catch { /* unreadable file */ }
  }
  return ids;
}

/** Mark notes done by id across the recent note files. Returns ids actually flipped. */
export function resolveNotes(workspacePath: string, ids: string[]): { resolved: string[]; unresolved: string[] } {
  const wanted = new Set(ids.map((id) => String(id || '').trim()).filter((id) => /^n_[a-z0-9]+$/.test(id)));
  const resolved: string[] = [];
  if (!wanted.size) return { resolved, unresolved: ids.filter(Boolean).map(String) };
  // Recent files first, then every older note file (newest first): an explicit
  // id must be closable regardless of age, or stale open items can never be cleared.
  const files: string[] = [];
  for (let d = 0; d <= CARRY_DAYS; d += 1) files.push(noteFileForDate(workspacePath, utcDate(d)));
  try {
    const dir = path.dirname(noteFileForDate(workspacePath, utcDate(0)));
    const older = fs.readdirSync(dir)
      .filter((name) => /^\d{4}-\d{2}-\d{2}-intraday-notes\.md$/.test(name))
      .sort()
      .reverse()
      .map((name) => path.join(dir, name))
      .filter((file) => !files.includes(file));
    files.push(...older);
  } catch { /* no memory dir */ }
  for (const file of files) {
    if (!wanted.size) break;
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, 'utf-8');
    let changed = false;
    const next = raw.replace(/^(### \[[A-Z0-9_]+\]\s+\S+\s+#(n_[a-z0-9]+))(?:\s+\((open|done|info)\))?[ \t]*$/gm, (line, prefix, id) => {
      if (!wanted.has(id)) return line;
      wanted.delete(id);
      resolved.push(id);
      changed = true;
      return `${prefix} (done)`;
    });
    if (changed) fs.writeFileSync(file, next, 'utf-8');
  }
  return { resolved, unresolved: [...wanted] };
}

export function appendIntradayNote(workspacePath: string, input: AppendNoteInput): AppendNoteResult {
  const date = utcDate();
  const memDir = path.join(workspacePath, 'memory');
  if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
  const file = noteFileForDate(workspacePath, date);
  const status = normalizeNoteStatus(input.status);
  const resolveIds = (Array.isArray(input.resolves) ? input.resolves : String(input.resolves || '').split(/[\s,]+/))
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  const { resolved, unresolved } = resolveIds.length ? resolveNotes(workspacePath, resolveIds) : { resolved: [], unresolved: [] };

  // Retried turns used to write the same note twice. Skip an identical body
  // written to today's file in the last few minutes.
  const existing = fs.existsSync(file) ? parseNotes(fs.readFileSync(file, 'utf-8'), file) : [];
  const body = String(input.content || '').trim();
  const norm = normalizeBody(body);
  const now = Date.now();
  const dup = existing.slice(-20).reverse().find((n) => {
    const t = Date.parse(n.timestamp) || 0;
    return now - t <= DEDUPE_WINDOW_MS && normalizeBody(n.body.replace(/\n_Related task:.*$/m, '')) === norm;
  });
  if (dup) {
    return { id: dup.id, file, status: dup.status, deduped: true, resolved, unresolved };
  }

  const thread = normalizeThreadKey(input.thread);
  // Supersede earlier open notes on the same thread (they become done).
  const superseded = thread ? resolveNotes(workspacePath, openIdsOnThread(workspacePath, thread)).resolved : [];

  const id = newNoteId();
  const tag = String(input.tag || 'general').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_') || 'GENERAL';
  let entry = `\n### [${tag}] ${new Date(now).toISOString()} #${id} (${status})\n${input.sourceLine}\n${body}`;
  if (input.taskId) entry += `\n_Related task: ${input.taskId}_`;
  if (thread) entry += `\n_Thread: ${thread}_`;
  fs.appendFileSync(file, entry + '\n');
  return { id, file, status, deduped: false, resolved, unresolved, ...(thread ? { thread, superseded } : {}) };
}

function firstLine(body: string, max = 140): string {
  const line = body.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

function renderFull(n: ParsedNote, maxChars: number): string {
  const idPart = n.id ? ` #${n.id}` : '';
  const body = n.body.length > maxChars ? `${n.body.slice(0, maxChars)}…[truncated, ${n.body.length} chars total]` : n.body;
  return `### [${n.tag}] ${n.timestamp}${idPart} (${n.status})\n${body}`;
}

export interface RenderNotesOptions {
  /** Total character budget for the entries (carry-forward is separate). */
  budgetChars?: number;
  /** Per-entry cap for full entries. */
  maxEntryChars?: number;
  /** Include open items from earlier days. */
  carryOpen?: boolean;
}

/**
 * Prompt projection. Open items (today + carried from recent days) in full,
 * then info notes newest-first in full, then done items as one-liners, all
 * within one budget.
 */
export function renderNotesForPrompt(workspacePath: string, todayRaw: string, opts: RenderNotesOptions = {}): string {
  const budget = opts.budgetChars ?? 9_000;
  const maxEntry = opts.maxEntryChars ?? 2_000;
  const today = parseNotes(todayRaw, 'today');
  const carried: ParsedNote[] = [];
  if (opts.carryOpen !== false) {
    for (let d = 1; d <= CARRY_DAYS; d += 1) {
      const file = noteFileForDate(workspacePath, utcDate(d));
      if (!fs.existsSync(file)) continue;
      try {
        for (const n of parseNotes(fs.readFileSync(file, 'utf-8'), file)) if (n.status === 'open') carried.push(n);
      } catch { /* unreadable file */ }
    }
  }
  // Newest open note per thread wins (older ones on a thread are normally
  // already superseded on disk; this also covers hand-edited files).
  const seenThreads = new Set<string>();
  const open = [...carried, ...today.filter((n) => n.status === 'open')].reverse().filter((n) => {
    const t = noteThread(n);
    if (!t) return true;
    if (seenThreads.has(t)) return false;
    seenThreads.add(t);
    return true;
  });
  const info = today.filter((n) => n.status === 'info').reverse();
  const done = today.filter((n) => n.status === 'done').reverse();

  let used = 0;
  const openOut: string[] = [];
  const infoOut: string[] = [];
  const doneOut: string[] = [];
  let droppedOpen = 0;
  let droppedInfo = 0;
  for (const n of open) {
    const s = renderFull(n, maxEntry);
    if (used + s.length > budget) { droppedOpen += 1; continue; }
    openOut.push(s); used += s.length + 2;
  }
  for (const n of info) {
    const s = renderFull(n, maxEntry);
    if (used + s.length > budget) { droppedInfo += 1; continue; }
    infoOut.push(s); used += s.length + 2;
  }
  for (const n of done) {
    const s = `- ${n.id ? `#${n.id} ` : ''}[${n.tag}] ${firstLine(n.body)}`;
    if (used + s.length > budget) break;
    doneOut.push(s); used += s.length + 1;
  }

  const parts: string[] = [];
  if (openOut.length) parts.push(`OPEN ITEMS (newest first; resolve with write_note(status:"done", resolves:["#id"]) when finished):\n\n${openOut.join('\n\n')}`);
  if (infoOut.length) parts.push(`NOTES (newest first):\n\n${infoOut.join('\n\n')}`);
  if (doneOut.length) parts.push(`DONE TODAY:\n${doneOut.join('\n')}`);
  if (droppedOpen || droppedInfo) parts.push(`[${droppedOpen} open + ${droppedInfo} older notes omitted for budget; use memory search to read them]`);
  return parts.join('\n\n');
}
