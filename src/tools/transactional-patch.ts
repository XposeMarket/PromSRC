import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../config/config';
import { validateFileSyntax } from './file-intelligence';

export type TransactionalPatchOperation =
  | 'find_replace'
  | 'replace_lines'
  | 'insert_after'
  | 'insert_after_anchor'
  | 'delete_lines'
  | 'write_file'
  | 'create_file';

export interface TransactionalPatchEdit {
  filename?: string;
  file?: string;
  path?: string;
  op?: string;
  action?: string;
  type?: string;
  find?: string;
  old_text?: string;
  oldText?: string;
  replace?: string;
  new_text?: string;
  newText?: string;
  replace_all?: boolean;
  start_line?: number;
  startLine?: number;
  end_line?: number;
  endLine?: number;
  after_line?: number;
  afterLine?: number;
  anchor?: string;
  content?: string;
  new_content?: string;
  expected_hash?: string;
  expected_before?: string;
}

export interface TransactionalPatchFileResult {
  filename: string;
  absolutePath: string;
  operations: number;
  beforeHash?: string;
  afterHash: string;
  created: boolean;
  changedStartLine: number;
  changedEndLine: number;
}

export interface TransactionalPatchResult {
  ok: boolean;
  transactionId?: string;
  editCount: number;
  files: TransactionalPatchFileResult[];
  error?: string;
  failedEditIndex?: number;
  recoveredTransactions?: string[];
}

export interface TransactionalPatchOptions {
  edits: TransactionalPatchEdit[];
  resolvePath: (requested: string) => string;
  checkAllowed?: (absolutePath: string) => { allowed: boolean; reason?: string };
  displayPath?: (absolutePath: string, requested: string) => string;
  beforeCommit?: (files: Array<{ absolutePath: string; displayPath: string; existed: boolean }>) => void;
  validateSyntax?: boolean;
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

interface StagedFile {
  absolutePath: string;
  displayPath: string;
  existed: boolean;
  original: string;
  next: string;
  operations: number;
  changedStartLine: number;
  changedEndLine: number;
}

interface JournalFile {
  absolutePath: string;
  displayPath: string;
  existed: boolean;
  backupPath: string;
  tempPath: string;
  swapPath: string;
}

interface TransactionJournal {
  version: 1;
  id: string;
  status: 'prepared' | 'committing' | 'rolling_back' | 'committed';
  createdAt: number;
  files: JournalFile[];
}

function transactionRoot(): string {
  return path.join(getConfig().getConfigDir(), 'work-context', 'transactions');
}

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function safeRemove(target: string): void {
  try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* best effort */ }
}

function writeJournal(dir: string, journal: TransactionJournal): void {
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'journal.json');
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(journal, null, 2), 'utf-8');
  try {
    fs.renameSync(temp, target);
  } catch {
    safeRemove(target);
    fs.renameSync(temp, target);
  }
}

function restoreJournal(journal: TransactionJournal): boolean {
  let restored = true;
  for (const file of journal.files.slice().reverse()) {
    try {
      safeRemove(file.tempPath);
      if (file.existed) {
        if (fs.existsSync(file.swapPath)) {
          safeRemove(file.absolutePath);
          fs.renameSync(file.swapPath, file.absolutePath);
        } else if (fs.existsSync(file.backupPath)) {
          fs.mkdirSync(path.dirname(file.absolutePath), { recursive: true });
          fs.copyFileSync(file.backupPath, file.absolutePath);
        }
      } else {
        safeRemove(file.absolutePath);
        safeRemove(file.swapPath);
      }
    } catch {
      // The persisted backup remains available for the next recovery pass.
      restored = false;
    }
  }
  return restored;
}

export function recoverPendingPatchTransactions(): string[] {
  const root = transactionRoot();
  if (!fs.existsSync(root)) return [];
  const recovered: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const journalPath = path.join(dir, 'journal.json');
    if (!fs.existsSync(journalPath)) continue;
    try {
      const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8')) as TransactionJournal;
      if (journal.status !== 'committed') {
        if (restoreJournal(journal)) {
          recovered.push(journal.id || entry.name);
          safeRemove(dir);
        }
      } else {
        for (const file of journal.files) {
          safeRemove(file.tempPath);
          safeRemove(file.swapPath);
        }
        safeRemove(dir);
      }
    } catch {
      // Leave an unreadable recovery record intact for manual inspection.
    }
  }
  return recovered;
}

function normalizeOp(value: unknown): TransactionalPatchOperation | '' {
  const raw = String(value || '').trim().toLowerCase();
  const aliases: Record<string, TransactionalPatchOperation> = {
    exact_replace: 'find_replace',
    replace: 'find_replace',
    replace_text: 'find_replace',
    delete_exact: 'find_replace',
    line_replace: 'replace_lines',
    insert: 'insert_after',
    insert_after_line: 'insert_after',
    full_file_write: 'write_file',
    write: 'write_file',
    create: 'create_file',
  };
  const normalized = aliases[raw] || raw;
  return ['find_replace', 'replace_lines', 'insert_after', 'insert_after_anchor', 'delete_lines', 'write_file', 'create_file'].includes(normalized)
    ? normalized as TransactionalPatchOperation
    : '';
}

function lineAtOffset(content: string, offset: number): number {
  return content.slice(0, Math.max(0, offset)).split('\n').length;
}

function applyEdit(content: string, guardContent: string, edit: TransactionalPatchEdit, op: TransactionalPatchOperation, existed: boolean): { content: string; start: number; end: number } {
  if (edit.expected_hash) {
    const expected = String(edit.expected_hash).trim().toLowerCase();
    const current = sha256(guardContent);
    if (!current.startsWith(expected)) throw new Error(`expected_hash mismatch; current sha256 starts ${current.slice(0, Math.max(12, expected.length))}`);
  }
  if (edit.expected_before && !guardContent.includes(String(edit.expected_before))) throw new Error('expected_before text was not found in the original file');

  if (op === 'create_file') {
    if (existed) throw new Error('file already exists; use write_file to overwrite');
    const next = String(edit.content ?? edit.new_content ?? '');
    return { content: next, start: 1, end: Math.max(1, next.split('\n').length) };
  }
  if (!existed) throw new Error('target file does not exist');
  if (op === 'write_file') {
    const next = String(edit.content ?? edit.new_content ?? edit.replace ?? '');
    return { content: next, start: 1, end: Math.max(1, next.split('\n').length) };
  }
  if (op === 'find_replace') {
    const find = String(edit.find ?? edit.old_text ?? edit.oldText ?? '');
    const replace = String(edit.replace ?? edit.new_text ?? edit.newText ?? edit.content ?? '');
    if (!find) throw new Error('find is required');
    const index = content.indexOf(find);
    if (index < 0) throw new Error(`text not found: "${find.replace(/\s+/g, ' ').slice(0, 100)}"`);
    const next = edit.replace_all === true ? content.split(find).join(replace) : content.replace(find, replace);
    const start = lineAtOffset(content, index);
    return { content: next, start, end: start + Math.max(0, replace.split('\n').length - 1) };
  }
  if (op === 'insert_after_anchor') {
    const anchor = String(edit.anchor ?? edit.find ?? '');
    if (!anchor) throw new Error('anchor is required');
    const matches = content.split(anchor).length - 1;
    if (matches !== 1) throw new Error(matches === 0 ? 'anchor was not found' : `anchor is ambiguous (${matches} matches)`);
    const index = content.indexOf(anchor) + anchor.length;
    const insertion = String(edit.content ?? edit.new_content ?? edit.replace ?? '');
    const next = content.slice(0, index) + insertion + content.slice(index);
    const start = lineAtOffset(content, index);
    return { content: next, start, end: start + Math.max(0, insertion.split('\n').length - 1) };
  }
  const lines = content.split('\n');
  if (op === 'replace_lines') {
    const start = Math.floor(Number(edit.start_line ?? edit.startLine));
    const end = Math.floor(Number(edit.end_line ?? edit.endLine));
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start || end > lines.length) throw new Error(`invalid line range ${start}-${end} for ${lines.length} lines`);
    const replacement = String(edit.new_content ?? edit.content ?? edit.replace ?? '');
    const replacementLines = replacement.split('\n');
    lines.splice(start - 1, end - start + 1, ...replacementLines);
    return { content: lines.join('\n'), start, end: start + Math.max(0, replacementLines.length - 1) };
  }
  if (op === 'insert_after') {
    const after = Math.floor(Number(edit.after_line ?? edit.afterLine));
    if (!Number.isFinite(after) || after < 0 || after > lines.length) throw new Error(`invalid after_line ${after} for ${lines.length} lines`);
    const insertion = String(edit.content ?? edit.new_content ?? edit.replace ?? '');
    const insertionLines = insertion.split('\n');
    lines.splice(after, 0, ...insertionLines);
    return { content: lines.join('\n'), start: after + 1, end: after + Math.max(1, insertionLines.length) };
  }
  const start = Math.floor(Number(edit.start_line ?? edit.startLine));
  const end = Math.floor(Number(edit.end_line ?? edit.endLine));
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start || end > lines.length) throw new Error(`invalid line range ${start}-${end} for ${lines.length} lines`);
  lines.splice(start - 1, end - start + 1);
  return { content: lines.join('\n'), start: Math.min(start, Math.max(1, lines.length)), end: Math.min(start, Math.max(1, lines.length)) };
}

function compactSyntaxError(displayPath: string, content: string): string | null {
  const validation = validateFileSyntax(displayPath, content);
  if (!validation.supported || validation.ok) return null;
  const diagnostics = Array.isArray((validation as any).diagnostics) ? (validation as any).diagnostics : [];
  const first = diagnostics[0];
  return first
    ? `${first.message || 'syntax error'}${first.line ? ` at ${first.line}:${first.column || 1}` : ''}`
    : 'syntax validation failed';
}

export function applyTransactionalPatchset(options: TransactionalPatchOptions): TransactionalPatchResult {
  const recoveredTransactions = recoverPendingPatchTransactions();
  const edits = Array.isArray(options.edits) ? options.edits : [];
  if (!edits.length) return { ok: false, editCount: 0, files: [], error: 'edits array is required', recoveredTransactions };
  const maxFiles = Math.max(1, Math.min(128, Number(options.maxFiles) || 32));
  const maxFileBytes = Math.max(1024, Number(options.maxFileBytes) || 32 * 1024 * 1024);
  const maxTotalBytes = Math.max(maxFileBytes, Number(options.maxTotalBytes) || 128 * 1024 * 1024);
  const staged = new Map<string, StagedFile>();
  let totalBytes = 0;

  for (let index = 0; index < edits.length; index += 1) {
    const edit = edits[index] || {};
    const requested = String(edit.filename ?? edit.file ?? edit.path ?? '').trim();
    const op = normalizeOp(edit.op ?? edit.action ?? edit.type);
    if (!requested || !op) return { ok: false, editCount: edits.length, files: [], failedEditIndex: index, error: !requested ? 'filename is required' : `unsupported operation: ${String(edit.op ?? edit.action ?? edit.type ?? '')}`, recoveredTransactions };
    let absolutePath = '';
    try {
      absolutePath = path.resolve(options.resolvePath(requested));
      const allowed = options.checkAllowed?.(absolutePath);
      if (allowed && !allowed.allowed) throw new Error(allowed.reason || 'path is not allowed');
      let file = staged.get(absolutePath);
      if (!file) {
        if (staged.size >= maxFiles) throw new Error(`patchset exceeds ${maxFiles} files`);
        const existed = fs.existsSync(absolutePath);
        if (existed && !fs.statSync(absolutePath).isFile()) throw new Error('target is not a file');
        const original = existed ? fs.readFileSync(absolutePath, 'utf-8') : '';
        if (Buffer.byteLength(original, 'utf8') > maxFileBytes) throw new Error(`file exceeds ${maxFileBytes} byte transaction limit`);
        file = {
          absolutePath,
          displayPath: options.displayPath?.(absolutePath, requested) || requested,
          existed,
          original,
          next: original,
          operations: 0,
          changedStartLine: Number.MAX_SAFE_INTEGER,
          changedEndLine: 1,
        };
        staged.set(absolutePath, file);
      }
      const applied = applyEdit(file.next, file.original, edit, op, file.existed || file.operations > 0);
      file.next = applied.content;
      file.operations += 1;
      file.changedStartLine = Math.min(file.changedStartLine, applied.start);
      file.changedEndLine = Math.max(file.changedEndLine, applied.end);
      const bytes = Buffer.byteLength(file.next, 'utf8');
      if (bytes > maxFileBytes) throw new Error(`result exceeds ${maxFileBytes} byte transaction limit`);
    } catch (error: any) {
      return { ok: false, editCount: edits.length, files: [], failedEditIndex: index, error: `${requested}: ${error?.message || String(error)}`, recoveredTransactions };
    }
  }

  for (const file of staged.values()) {
    totalBytes += Buffer.byteLength(file.next, 'utf8');
    if (totalBytes > maxTotalBytes) return { ok: false, editCount: edits.length, files: [], error: `patchset exceeds ${maxTotalBytes} total staged bytes`, recoveredTransactions };
    if (options.validateSyntax !== false) {
      const syntaxError = compactSyntaxError(file.displayPath, file.next);
      if (syntaxError) return { ok: false, editCount: edits.length, files: [], error: `${file.displayPath}: ${syntaxError}`, recoveredTransactions };
    }
  }

  try {
    options.beforeCommit?.([...staged.values()].map((file) => ({ absolutePath: file.absolutePath, displayPath: file.displayPath, existed: file.existed })));
  } catch (error: any) {
    return { ok: false, editCount: edits.length, files: [], error: `snapshot preflight failed: ${error?.message || String(error)}`, recoveredTransactions };
  }

  const transactionId = `patch_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
  const transactionDir = path.join(transactionRoot(), transactionId);
  fs.mkdirSync(transactionDir, { recursive: true });
  const journal: TransactionJournal = { version: 1, id: transactionId, status: 'prepared', createdAt: Date.now(), files: [] };
  let counter = 0;
  try {
    for (const file of staged.values()) {
      const id = String(counter++).padStart(3, '0');
      const backupPath = path.join(transactionDir, `${id}.backup`);
      const tempPath = path.join(path.dirname(file.absolutePath), `.${path.basename(file.absolutePath)}.${transactionId}.tmp`);
      const swapPath = path.join(path.dirname(file.absolutePath), `.${path.basename(file.absolutePath)}.${transactionId}.rollback`);
      fs.mkdirSync(path.dirname(file.absolutePath), { recursive: true });
      if (file.existed) fs.writeFileSync(backupPath, file.original, 'utf-8');
      fs.writeFileSync(tempPath, file.next, 'utf-8');
      journal.files.push({ absolutePath: file.absolutePath, displayPath: file.displayPath, existed: file.existed, backupPath, tempPath, swapPath });
    }
    writeJournal(transactionDir, journal);
    journal.status = 'committing';
    writeJournal(transactionDir, journal);
    for (const file of journal.files) {
      safeRemove(file.swapPath);
      if (file.existed && fs.existsSync(file.absolutePath)) fs.renameSync(file.absolutePath, file.swapPath);
      fs.renameSync(file.tempPath, file.absolutePath);
    }
    journal.status = 'committed';
    writeJournal(transactionDir, journal);
    for (const file of journal.files) safeRemove(file.swapPath);
    safeRemove(transactionDir);
  } catch (error: any) {
    journal.status = 'rolling_back';
    try { writeJournal(transactionDir, journal); } catch { /* keep original journal */ }
    const restored = restoreJournal(journal);
    if (restored) safeRemove(transactionDir);
    return { ok: false, transactionId, editCount: edits.length, files: [], error: `commit failed and was rolled back: ${error?.message || String(error)}`, recoveredTransactions };
  }

  return {
    ok: true,
    transactionId,
    editCount: edits.length,
    recoveredTransactions,
    files: [...staged.values()].map((file) => ({
      filename: file.displayPath,
      absolutePath: file.absolutePath,
      operations: file.operations,
      beforeHash: file.existed ? sha256(file.original) : undefined,
      afterHash: sha256(file.next),
      created: !file.existed,
      changedStartLine: file.changedStartLine === Number.MAX_SAFE_INTEGER ? 1 : file.changedStartLine,
      changedEndLine: file.changedEndLine,
    })),
  };
}
