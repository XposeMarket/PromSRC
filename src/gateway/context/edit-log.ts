// ── Cross-turn edit log ─────────────────────────────────────────────────────
// Prior-turn context packets only carry "find_replace: ok (file.ts)". When a
// follow-up turn says "that didn't work", the model knows *which* file it
// touched but not *where* or *what*, so it re-reads the file first. That is a
// full provider round (and often several) of pure rediscovery.
//
// This module keeps a compact, bounded record of recent file mutations per
// session: file, approximate line range, and a short removed/added diff. It is
// injected into the next few turns' context so the model can go straight back
// to the exact edit site.
//
// Bounds: newest EDIT_LOG_MAX_ENTRIES entries, each diff side capped at
// EDIT_LOG_SNIPPET_CHARS, whole prompt block capped at EDIT_LOG_PROMPT_MAX_CHARS.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { getConfig } from '../../config/config';

export const EDIT_LOG_MAX_ENTRIES = 40;
export const EDIT_LOG_PROMPT_ENTRIES = 16;
export const EDIT_LOG_SNIPPET_CHARS = 360;
export const EDIT_LOG_PROMPT_MAX_CHARS = 7_000;

export interface EditLogEntry {
  at: number;
  turnId: string;
  tool: string;
  action?: string;
  file: string;
  lines?: string;
  removed?: string;
  added?: string;
  ok: boolean;
}

const memoryCache = new Map<string, EditLogEntry[]>();

function editLogDir(): string {
  let base = '';
  try { base = String((getConfig() as any).getConfigDir?.() || ''); } catch {}
  if (!base) base = process.env.PROMETHEUS_CONFIG_DIR || path.join(process.cwd(), '.prometheus');
  return path.join(base, 'edit-logs');
}

function safeId(sessionId: string): string {
  return String(sessionId || '').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 160) || 'unknown';
}

function logPath(sessionId: string): string {
  return path.join(editLogDir(), `${safeId(sessionId)}.json`);
}

function clip(value: unknown, max = EDIT_LOG_SNIPPET_CHARS): string {
  const text = String(value ?? '').replace(/\r\n/g, '\n');
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}…[+${text.length - max} chars]` : text;
}

export function readEditLog(sessionId: string): EditLogEntry[] {
  const key = safeId(sessionId);
  const cached = memoryCache.get(key);
  if (cached) return cached;
  let entries: EditLogEntry[] = [];
  try {
    const raw = JSON.parse(fs.readFileSync(logPath(sessionId), 'utf8'));
    if (Array.isArray(raw)) entries = raw.filter((e) => e && typeof e === 'object' && e.file);
  } catch {}
  memoryCache.set(key, entries);
  return entries;
}

function writeEditLog(sessionId: string, entries: EditLogEntry[]): void {
  memoryCache.set(safeId(sessionId), entries);
  try {
    fs.mkdirSync(editLogDir(), { recursive: true });
    const target = logPath(sessionId);
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(entries));
    fs.renameSync(tmp, target);
  } catch (err: any) {
    console.warn('[edit-log] persist failed:', err?.message || err);
  }
}

function parseArgs(args: any): any {
  if (typeof args === 'string') {
    try { return JSON.parse(args); } catch { return {}; }
  }
  return args && typeof args === 'object' ? args : {};
}

function fileOf(a: any): string {
  return String(a?.path || a?.filename || a?.file || a?.target || a?.destination || '').trim();
}

/** Pull "Changed lines: <file>:12-18" style ranges out of the tool result text. */
function linesFromResult(result: unknown, file: string): string {
  const text = typeof result === 'string' ? result : (() => { try { return JSON.stringify(result); } catch { return ''; } })();
  const base = path.basename(file || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = base
    ? new RegExp(`${base}:(\\d+(?:-\\d+)?)`, 'g')
    : /Changed lines:[^\n]*?:(\d+(?:-\d+)?)/g;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && found.size < 4) found.add(m[1]);
  return Array.from(found).join(',');
}

function entriesFromEdit(tool: string, rawArgs: any, result: unknown, ok: boolean, turnId: string): EditLogEntry[] {
  const a = parseArgs(rawArgs);
  const at = Date.now();
  const action = String(a.action || a.op || '').trim() || undefined;
  const out: EditLogEntry[] = [];
  const push = (e: any, file: string) => {
    if (!file) return;
    const op = String(e?.op || e?.action || action || '').trim();
    let removed = '';
    let added = '';
    let lines = '';
    if (e?.find !== undefined || e?.replace !== undefined) {
      removed = clip(e.find);
      added = clip(e.replace);
    } else if (e?.new_content !== undefined) {
      added = clip(e.new_content);
      if (e.start_line) lines = `${e.start_line}-${e.end_line || e.start_line}`;
    } else if (e?.content !== undefined) {
      added = clip(e.content);
      if (e.after_line) lines = `after ${e.after_line}`;
    } else if (e?.start_line) {
      lines = `${e.start_line}-${e.end_line || e.start_line}`;
    }
    out.push({
      at, turnId, tool, action: op || undefined, file,
      lines: lines || linesFromResult(result, file) || undefined,
      removed: removed || undefined,
      added: added || undefined,
      ok,
    });
  };
  if (Array.isArray(a.edits) && a.edits.length) {
    for (const e of a.edits.slice(0, 12)) push(e, fileOf(e) || fileOf(a));
  } else if (typeof a.patch === 'string' && a.patch) {
    const files: string[] = Array.from(new Set<string>((a.patch.match(/^\+\+\+ (?:b\/)?(.+)$/gm) || []).map((l: string) => l.replace(/^\+\+\+ (?:b\/)?/, '').trim())));
    for (const file of (files.length ? files : [fileOf(a) || '(patch)']).slice(0, 8)) {
      out.push({ at, turnId, tool, action, file, added: clip(a.patch, EDIT_LOG_SNIPPET_CHARS * 2), ok });
    }
  } else {
    push(a, fileOf(a));
  }
  return out;
}

/** Record one file-mutation tool call. Never throws. */
export function recordEditLogEntry(input: {
  sessionId: string;
  turnId: string;
  tool: string;
  args: any;
  result?: unknown;
  error?: unknown;
}): void {
  try {
    if (!input.sessionId || !input.tool) return;
    const fresh = entriesFromEdit(input.tool, input.args, input.result, !input.error, String(input.turnId || ''));
    if (!fresh.length) return;
    const next = [...readEditLog(input.sessionId), ...fresh].slice(-EDIT_LOG_MAX_ENTRIES);
    writeEditLog(input.sessionId, next);
  } catch (err: any) {
    console.warn('[edit-log] record failed:', err?.message || err);
  }
}

// ── Shell-driven edits ───────────────────────────────────────────────────────
// Edits made through workspace_run/run_command (PowerShell -replace,
// WriteAllText, Set-Content, sed -i, git apply, ...) never pass through the
// file-mutation tools, so they were invisible to the edit log. Detect
// mutating commands, pull out the file paths they name, and record the real
// changed hunks from `git diff -U0` when the file lives in a git repo.

const SHELL_MUTATION_RE = /(WriteAllText|WriteAllLines|AppendAllText|Set-Content|Add-Content|Out-File|New-Item\b[^|;]*-ItemType\s+File|Copy-Item|Move-Item|Rename-Item|Remove-Item|\bsed\s+-i|\bperl\s+-pi|\bgit\s+(apply|checkout\s+--|restore)\b|>\s*["']?[\w.\\/:-]+\.\w{1,6})/i;
const SHELL_PATH_RE = /["']?((?:[A-Za-z]:)?[\w.\-\\/ ]*?[\w\-]+\.(?:ts|tsx|js|mjs|cjs|jsx|json|css|scss|html|md|py|ps1|yml|yaml|toml|txt))["']?/g;

export function commandLooksLikeFileMutation(command: string): boolean {
  return SHELL_MUTATION_RE.test(String(command || ''));
}

function shellCwd(command: string, cwd: string): string {
  const m = String(command || '').match(/(?:^|;|&&)\s*(?:cd|Set-Location|pushd)\s+["']?([^;"'&|]+?)["']?\s*(?:;|&&|$)/i);
  const target = m?.[1]?.trim();
  if (target) return path.isAbsolute(target) ? target : path.resolve(cwd || process.cwd(), target);
  return cwd || process.cwd();
}

export function extractShellEditPaths(command: string, cwd: string): string[] {
  const base = shellCwd(command, cwd);
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(SHELL_PATH_RE.source, 'g');
  while ((m = re.exec(String(command || ''))) && found.size < 12) {
    const raw = m[1].trim().replace(/^\.[\\/]/, '');
    if (!raw || /^\d+(\.\d+)+$/.test(raw)) continue;
    const abs = path.isAbsolute(raw) ? raw : path.resolve(base, raw);
    try { if (fs.statSync(abs).isFile()) found.add(abs); } catch {}
  }
  return Array.from(found).slice(0, 6);
}

function gitHunksFor(file: string): { lines: string; removed: string; added: string } | null {
  try {
    const dir = path.dirname(file);
    const out = execFileSync('git', ['diff', '-U0', '--no-color', '--', path.basename(file)], {
      cwd: dir, encoding: 'utf8', timeout: 3000, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
    });
    if (!out) return null;
    const ranges: string[] = [];
    const removed: string[] = [];
    const added: string[] = [];
    for (const line of out.split(/\r?\n/)) {
      const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (h) {
        const start = Number(h[1]);
        const count = h[2] === undefined ? 1 : Number(h[2]);
        if (ranges.length < 6) ranges.push(count > 1 ? `${start}-${start + count - 1}` : String(start));
        continue;
      }
      if (line.startsWith('---') || line.startsWith('+++')) continue;
      if (line.startsWith('-')) removed.push(line.slice(1));
      else if (line.startsWith('+')) added.push(line.slice(1));
    }
    if (!ranges.length) return null;
    return { lines: ranges.join(','), removed: clip(removed.join('\n')), added: clip(added.join('\n')) };
  } catch {
    return null;
  }
}

/** Record file edits performed through a shell command. Never throws. */
export function recordShellEditLogEntry(input: {
  sessionId: string;
  turnId: string;
  tool: string;
  command: string;
  cwd?: string;
  error?: unknown;
}): void {
  try {
    const command = String(input.command || '');
    if (!input.sessionId || !command || !commandLooksLikeFileMutation(command)) return;
    const files = extractShellEditPaths(command, String(input.cwd || ''));
    const at = Date.now();
    const ok = !input.error;
    const fresh: EditLogEntry[] = files.length
      ? files.map((file) => {
        const hunks = gitHunksFor(file);
        return {
          at, turnId: String(input.turnId || ''), tool: input.tool, action: 'shell', file,
          lines: hunks?.lines || undefined,
          removed: hunks?.removed || undefined,
          added: hunks?.added || clip(command),
          ok,
        };
      })
      : [{ at, turnId: String(input.turnId || ''), tool: input.tool, action: 'shell', file: '(shell command)', added: clip(command), ok }];
    const next = [...readEditLog(input.sessionId), ...fresh].slice(-EDIT_LOG_MAX_ENTRIES);
    writeEditLog(input.sessionId, next);
  } catch (err: any) {
    console.warn('[edit-log] shell record failed:', err?.message || err);
  }
}

function formatEntry(e: EditLogEntry): string {
  const when = new Date(e.at).toISOString().slice(11, 19);
  const head = `- ${when} ${e.tool}${e.action ? `/${e.action}` : ''}${e.ok ? '' : ' (FAILED)'} ${e.file}${e.lines ? `:${e.lines}` : ''}`;
  const parts = [head];
  if (e.removed) parts.push(`  - removed: ${e.removed.replace(/\n/g, '\n    ')}`);
  if (e.added) parts.push(`  + added: ${e.added.replace(/\n/g, '\n    ')}`);
  return parts.join('\n');
}

/**
 * Prompt block of the most recent edits, newest last. Excludes the in-flight
 * turn (it already has the full tool results verbatim).
 */
export function formatEditLogForPrompt(sessionId: string, options: { excludeTurnId?: string; excludeSince?: number; maxChars?: number } = {}): string {
  // excludeSince: only this run's own edits are excluded. After a mid-turn
  // gateway restart the resumed run shares the root turn id but no longer has
  // the pre-restart tool results verbatim, so those edits must stay visible.
  const since = Number(options.excludeSince) || 0;
  const entries = readEditLog(sessionId)
    .filter((e) => !options.excludeTurnId || e.turnId !== options.excludeTurnId || (since > 0 && e.at < since))
    .slice(-EDIT_LOG_PROMPT_ENTRIES);
  if (!entries.length) return '';
  const maxChars = Math.max(1_000, Number(options.maxChars) || EDIT_LOG_PROMPT_MAX_CHARS);
  const header = '[RECENT_EDIT_LOG oldest->newest — exact files/lines you changed in earlier turns; go straight to these sites instead of re-reading to rediscover them. Snippets are truncated; re-read only if you need surrounding code.]';
  const footer = '[/RECENT_EDIT_LOG]';
  const lines: string[] = [];
  let used = header.length + footer.length + 2;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const line = formatEntry(entries[i]);
    if (used + line.length + 1 > maxChars) break;
    lines.unshift(line);
    used += line.length + 1;
  }
  if (!lines.length) return '';
  return `${header}\n${lines.join('\n')}\n${footer}`;
}

export function __resetEditLogCacheForTests(): void {
  memoryCache.clear();
}
