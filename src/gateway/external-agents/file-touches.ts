/**
 * Makes a harness turn end like a Prometheus turn: the files it changed become
 * the same end-of-turn file card (TurnFileChanges), and the reply is the closing
 * answer only, because what the agent said before each tool call already sits
 * in the work stream as commentary.
 */
import fs from 'fs';
import path from 'path';

import { collectTurnFileChanges, type TurnFileChange, type TurnFileChanges } from '../file-change-summary';
import type { ExternalFileTouch } from './types';

const MAX_FILES = 80;
const MAX_UNDIFFED_FILES = 40;
const MAX_DIFF_CHARS = 12_000;
/** Marks the start of diff lines so a changed line that begins with "-- " is never read as a file header. */
const HUNK = '@@';

function textLines(value: unknown): string[] {
  const out = String(value ?? '').replace(/\r\n/g, '\n').split('\n');
  if (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

function prefixed(value: unknown, sign: '+' | '-'): string[] {
  return textLines(value).map((line) => `${sign}${line}`);
}

/** A replacement shown as removed lines, then added lines. */
export function replaceDiff(oldText: unknown, newText: unknown): string {
  return [HUNK, ...prefixed(oldText, '-'), ...prefixed(newText, '+')].join('\n');
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

/** Codex `fileChange` item: one entry per changed path, with the diff Codex applied. */
export function codexFileTouches(item: unknown): ExternalFileTouch[] {
  const changes = record(item).changes;
  const out: ExternalFileTouch[] = [];
  for (const raw of Array.isArray(changes) ? changes : []) {
    const change = record(raw);
    const filePath = str(change.path);
    if (!filePath) continue;
    const kind = (str(change.kind) || str(record(change.kind).type)).toLowerCase();
    const status: ExternalFileTouch['status'] = kind === 'add' ? 'added' : kind === 'delete' ? 'deleted' : 'modified';
    const text = str(change.diff);
    // Codex sends a unified diff for an update and the whole content for an add or a delete.
    const diff = !text ? ''
      : status === 'modified' || /^@@/m.test(text) ? text
        : [HUNK, ...prefixed(text, status === 'deleted' ? '-' : '+')].join('\n');
    out.push({ path: filePath, status, ...(diff ? { diff } : {}) });
  }
  return out;
}

/** Claude Code file tools. Write has no "before" to compare with, so it carries no diff. */
export function claudeFileTouch(name: unknown, input: unknown): ExternalFileTouch | null {
  const args = record(input);
  const filePath = str(args.file_path);
  switch (String(name || '')) {
    case 'Write':
      return filePath ? { path: filePath } : null;
    case 'Edit':
      return filePath ? { path: filePath, status: 'modified', diff: replaceDiff(args.old_string, args.new_string) } : null;
    case 'MultiEdit': {
      if (!filePath) return null;
      const diffs = (Array.isArray(args.edits) ? args.edits : []).map((edit) => replaceDiff(record(edit).old_string, record(edit).new_string));
      return { path: filePath, status: 'modified', ...(diffs.length ? { diff: diffs.join('\n') } : {}) };
    }
    case 'NotebookEdit': {
      const notebook = str(args.notebook_path);
      return notebook ? { path: notebook } : null;
    }
    default:
      return null;
  }
}

/**
 * ACP agents (Hermes, Cursor, OpenClaw) report an edit across `tool_call` and
 * `tool_call_update` messages. Feed every session update in; the files come back
 * once, when that tool call completes.
 */
export function createAcpFileTracker(): (update: unknown) => ExternalFileTouch[] {
  const pending = new Map<string, { edits: boolean; files: Map<string, ExternalFileTouch> }>();
  return (raw) => {
    const update = record(raw);
    if (update.sessionUpdate !== 'tool_call' && update.sessionUpdate !== 'tool_call_update') return [];
    const id = String(update.toolCallId ?? '');
    if (!id) return [];
    const entry = pending.get(id) || { edits: false, files: new Map<string, ExternalFileTouch>() };
    pending.set(id, entry);
    const kind = str(update.kind);
    if (kind === 'edit' || kind === 'delete' || kind === 'move') entry.edits = true;
    for (const rawPart of Array.isArray(update.content) ? update.content : []) {
      const part = record(rawPart);
      const filePath = str(part.path);
      if (part.type !== 'diff' || !filePath) continue;
      const added = part.oldText == null;
      entry.files.set(filePath, { path: filePath, status: added ? 'added' : 'modified', diff: replaceDiff(added ? '' : part.oldText, part.newText) });
    }
    if (entry.edits) {
      for (const rawLocation of Array.isArray(update.locations) ? update.locations : []) {
        const filePath = str(record(rawLocation).path);
        if (filePath && !entry.files.has(filePath)) entry.files.set(filePath, { path: filePath, ...(kind === 'delete' ? { status: 'deleted' as const } : {}) });
      }
    }
    if (update.status === 'completed') { pending.delete(id); return [...entry.files.values()]; }
    if (update.status === 'failed') pending.delete(id);
    return [];
  };
}

function countDiff(diff: string): { insertions: number; deletions: number } {
  let insertions = 0;
  let deletions = 0;
  let inHunk = false;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith(HUNK)) { inHunk = true; continue; }
    if (!inHunk && /^(\+\+\+|---) /.test(line)) continue;
    if (line.startsWith('+')) insertions += 1;
    else if (line.startsWith('-')) deletions += 1;
  }
  return { insertions, deletions };
}

function displayPath(absPath: string, root: string): string {
  const rel = path.relative(root, absPath).replace(/\\/g, '/');
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : absPath.replace(/\\/g, '/');
}

/**
 * Files the agent reported changing, as the end-of-turn file card expects them.
 * A file whose diff the agent supplied uses that diff (exactly this turn's change).
 * Any other file is compared the way a Prometheus turn compares it (git when the
 * folder is a repository).
 */
export function buildHarnessFileChanges(touches: ExternalFileTouch[], cwd: string): TurnFileChanges | undefined {
  const root = path.resolve(cwd || process.cwd());
  const keyOf = (absPath: string) => (process.platform === 'win32' ? absPath.toLowerCase() : absPath);
  const merged = new Map<string, { abs: string; status?: ExternalFileTouch['status']; diffs: string[] }>();
  for (const touch of Array.isArray(touches) ? touches : []) {
    const raw = str(touch?.path);
    if (!raw.trim()) continue;
    const abs = path.resolve(path.isAbsolute(raw) ? raw : path.join(root, raw));
    let entry = merged.get(keyOf(abs));
    if (!entry) {
      if (merged.size >= MAX_FILES) continue;
      entry = { abs, diffs: [] };
      merged.set(keyOf(abs), entry);
    }
    if (touch.status === 'deleted') entry.status = 'deleted';
    else if (entry.status === 'deleted') entry.status = 'modified';
    else if (touch.status && !entry.status) entry.status = touch.status;
    if (touch.diff) entry.diffs.push(touch.diff);
  }

  const files: TurnFileChange[] = [];
  const undiffed: string[] = [];
  for (const entry of merged.values()) {
    if (!entry.diffs.length) { if (undiffed.length < MAX_UNDIFFED_FILES) undiffed.push(entry.abs); continue; }
    const status = entry.status || 'modified';
    if (!fs.existsSync(entry.abs) && status !== 'deleted') continue;
    const diff = entry.diffs.join('\n');
    files.push({
      path: entry.abs,
      displayPath: displayPath(entry.abs, root),
      status,
      ...countDiff(diff),
      diffPreview: diff.slice(0, MAX_DIFF_CHARS),
      baselineKind: 'none',
    });
  }
  if (undiffed.length) {
    try {
      const collected = collectTurnFileChanges(undiffed.map((filePath) => ({ name: 'write_file', args: { path: filePath }, error: false })), root);
      for (const file of collected?.files || []) files.push(file);
    } catch { /* the card is best effort; the turn itself already finished */ }
  }
  if (!files.length) return undefined;
  files.sort((a, b) => a.displayPath.localeCompare(b.displayPath));
  return {
    summary: {
      fileCount: files.length,
      insertions: files.reduce((sum, file) => sum + Math.max(0, Number(file.insertions) || 0), 0),
      deletions: files.reduce((sum, file) => sum + Math.max(0, Number(file.deletions) || 0), 0),
    },
    files,
    generatedAt: Date.now(),
  };
}

/**
 * The reply bubble shows what the agent said after its last tool call. Text it
 * said before a tool call is commentary and is already in the work stream, so
 * it is taken off the front of the agent's full text here.
 */
export function closingAnswer(fullText: unknown, commentary: string[]): string {
  let rest = String(fullText ?? '').trim();
  for (const part of commentary) {
    const said = String(part ?? '').trim();
    if (!said) continue;
    if (!rest.startsWith(said)) break;
    rest = rest.slice(said.length).trim();
  }
  if (rest) return rest;
  // The agent ended on a tool call with nothing after it: keep its last words rather than an empty reply.
  for (let i = commentary.length - 1; i >= 0; i -= 1) {
    const said = String(commentary[i] ?? '').trim();
    if (said) return said;
  }
  return '';
}
