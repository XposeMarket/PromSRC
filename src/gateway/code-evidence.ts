import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../config/config';
import type { WorkspaceSnapshotRef } from '../workspace-history';
import type { ToolResult } from './tool-builder';

export const CODE_EVIDENCE_VERSION = 1 as const;

export type CodeEvidenceOperation = 'read' | 'create' | 'update' | 'delete' | 'move' | 'copy';

export interface CodeEvidenceRange {
  before_start_line: number | null;
  before_end_line: number | null;
  after_start_line: number | null;
  after_end_line: number | null;
}

export interface CodeEvidenceWindow {
  start_line: number;
  end_line: number;
  changed_start_line: number;
  changed_end_line: number;
  content: string;
  truncated: boolean;
}

export interface CodeEvidenceFile {
  path: string;
  previous_path?: string;
  operation: CodeEvidenceOperation;
  exists_after: boolean;
  authoritative_content_sha256?: string;
  size_bytes?: number;
  line_count?: number;
  binary?: boolean;
  changed_ranges: CodeEvidenceRange[];
  post_edit_windows: CodeEvidenceWindow[];
  evidence_complete: boolean;
  required_reread_reason?: string;
  observed_at: string;
  provenance: string;
}

export interface CodeEvidenceEnvelope {
  version: typeof CODE_EVIDENCE_VERSION;
  kind: 'code_evidence';
  tool_name: string;
  operation: 'read' | 'mutation';
  generated_at: string;
  generation_ms: number;
  files: CodeEvidenceFile[];
  truncated: boolean;
}

const READ_TOOLS = new Set([
  'read_file', 'read_source', 'read_webui_source', 'read_prom_file',
]);
const MUTATION_TOOLS = new Set([
  'workspace_edit', 'dev_source_edit', 'create_file', 'write_file', 'append_file', 'replace_lines',
  'find_replace', 'insert_after', 'delete_lines', 'delete_file', 'rename_file', 'copy_file', 'move_file',
  'apply_patch', 'apply_patchset', 'apply_workspace_patchset', 'apply_dev_source_patchset',
  'write_source', 'find_replace_source', 'replace_lines_source', 'insert_after_source', 'delete_lines_source', 'delete_source',
  'write_webui_source', 'find_replace_webui_source', 'replace_lines_webui_source', 'insert_after_webui_source', 'delete_lines_webui_source', 'delete_webui_source',
  'write_prom_file', 'find_replace_prom', 'replace_lines_prom', 'insert_after_prom', 'delete_lines_prom', 'delete_prom_file',
]);
const MAX_FILES = 16;
const MAX_FILE_BYTES_FOR_TEXT = 2 * 1024 * 1024;
const MAX_FILE_BYTES_FOR_HASH = 64 * 1024 * 1024;
const MAX_LINE_CHARS = 360;
const MAX_WINDOW_CHARS = 2_400;
const CONTEXT_LINES = 3;

function normalizeToolName(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function isMutationTool(toolName: string, args: Record<string, any>): boolean {
  if (MUTATION_TOOLS.has(toolName)) {
    const action = String(args.action || args.operation || '').trim().toLowerCase();
    if (toolName === 'workspace_edit' && ['', 'preview_patch'].includes(action)) return false;
    if (toolName === 'dev_source_edit' && ['', 'await_files', 'await_handoff', 'verify', 'verify_only'].includes(action)) return false;
    return true;
  }
  return false;
}

function isReadTool(toolName: string, args: Record<string, any>): boolean {
  if (READ_TOOLS.has(toolName)) return true;
  const action = String(args.action || args.operation || '').trim().toLowerCase();
  return (toolName === 'workspace_read' || toolName === 'dev_source_read') && action === 'read';
}

function hasPrometheusShape(root: string): boolean {
  try {
    return fs.existsSync(path.join(root, 'package.json'))
      && fs.existsSync(path.join(root, 'src'))
      && fs.existsSync(path.join(root, 'web-ui'));
  } catch {
    return false;
  }
}

function resolveProjectRoot(workspacePath: string): string {
  const configured = String(getConfig().getWorkspacePath() || '').trim();
  const candidates = [
    process.cwd(), workspacePath, path.dirname(workspacePath), configured, configured ? path.dirname(configured) : '',
  ].filter(Boolean).map((candidate) => path.resolve(candidate));
  return candidates.find(hasPrometheusShape) || path.resolve(workspacePath);
}

function inside(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function displayPath(projectRoot: string, workspacePath: string, absPath: string): string {
  for (const root of [projectRoot, workspacePath]) {
    if (!inside(root, absPath)) continue;
    const rel = path.relative(root, absPath).replace(/\\/g, '/');
    if (rel) return rel;
  }
  return path.resolve(absPath).replace(/\\/g, '/');
}

function resolveArgumentPath(toolName: string, workspacePath: string, raw: unknown): string {
  const value = String(raw || '').trim().replace(/\\/g, '/');
  if (!value || value === '/dev/null') return '';
  if (path.isAbsolute(value)) return path.resolve(value);
  const projectRoot = resolveProjectRoot(workspacePath);
  if (/webui/i.test(toolName)) return path.resolve(projectRoot, 'web-ui', value.replace(/^web-ui\//i, ''));
  if (/(?:^|_)source(?:_|$)/i.test(toolName) && !/webui/i.test(toolName)) {
    return path.resolve(projectRoot, 'src', value.replace(/^src\//i, ''));
  }
  if (/prom/i.test(toolName) && !/prompt/i.test(toolName)) return path.resolve(projectRoot, value);
  if (/^(?:src|web-ui)\//i.test(value) && hasPrometheusShape(projectRoot)) return path.resolve(projectRoot, value);
  return path.resolve(workspacePath, value);
}

function snapshotRefs(result: ToolResult): WorkspaceSnapshotRef[] {
  const refs = [
    ...(Array.isArray(result.extra?.workspaceSnapshots) ? result.extra.workspaceSnapshots : []),
    ...(Array.isArray(result.data?.workspaceSnapshots) ? result.data.workspaceSnapshots : []),
  ];
  const seen = new Set<string>();
  return refs.filter((ref: any) => {
    const id = String(ref?.id || '').trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, MAX_FILES);
}

function snapshotContent(workspacePath: string, ref: WorkspaceSnapshotRef): Buffer | null {
  if (!ref.id || ref.existed !== true || ref.kind !== 'file') return null;
  const candidate = path.join(path.resolve(workspacePath), '.prometheus', 'history', 'snapshots', ref.id, 'content');
  try {
    if (fs.statSync(candidate).size > MAX_FILE_BYTES_FOR_TEXT) return null;
    return fs.readFileSync(candidate);
  } catch {
    return null;
  }
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(256 * 1024);
    let read = 0;
    do {
      read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (read > 0) hash.update(buffer.subarray(0, read));
    } while (read > 0);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(buffer.length, 8_192)).includes(0);
}

function readFileSample(filePath: string, maxBytes = 8_192): Buffer {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(maxBytes);
    const bytesRead = fs.readSync(fd, buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

function normalizedLines(buffer: Buffer | null): string[] | null {
  if (!buffer || buffer.length > MAX_FILE_BYTES_FOR_TEXT || looksBinary(buffer)) return null;
  return buffer.toString('utf8').replace(/\r\n/g, '\n').split('\n');
}

function changedRange(before: string[] | null, after: string[] | null): CodeEvidenceRange[] {
  if (!after && !before) return [];
  if (!before) return [{ before_start_line: null, before_end_line: null, after_start_line: 1, after_end_line: Math.max(1, after?.length || 1) }];
  if (!after) return [{ before_start_line: 1, before_end_line: Math.max(1, before.length), after_start_line: null, after_end_line: null }];
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  if (prefix === before.length && prefix === after.length) return [];
  const beforeCount = Math.max(0, before.length - prefix - suffix);
  const afterCount = Math.max(0, after.length - prefix - suffix);
  return [{
    before_start_line: beforeCount ? prefix + 1 : null,
    before_end_line: beforeCount ? prefix + beforeCount : null,
    after_start_line: afterCount ? prefix + 1 : Math.max(1, Math.min(after.length, prefix + 1)),
    after_end_line: afterCount ? prefix + afterCount : Math.max(1, Math.min(after.length, prefix + 1)),
  }];
}

function scrubLine(line: string): string {
  const value = String(line || '');
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{16,}\b/i.test(value)) {
    return '[REDACTED SENSITIVE LINE]';
  }
  return value
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi, '$1***')
    .replace(/(["']?(?:password|token|secret|api[_-]?key|credential|private[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)["']?\s*[:=]\s*["']?)[^"'\r\n,;}\s]+/gi, '$1***')
    .slice(0, MAX_LINE_CHARS);
}

function oneWindow(lines: string[], changedStart: number, changedEnd: number): CodeEvidenceWindow {
  const start = Math.max(1, changedStart - CONTEXT_LINES);
  const end = Math.min(lines.length, changedEnd + CONTEXT_LINES);
  let content = lines.slice(start - 1, end).map((line, index) => {
    const lineNo = start + index;
    return `${lineNo >= changedStart && lineNo <= changedEnd ? '>' : ' '} ${lineNo}: ${scrubLine(line)}`;
  }).join('\n');
  const truncated = content.length > MAX_WINDOW_CHARS;
  if (truncated) content = `${content.slice(0, MAX_WINDOW_CHARS)}\n...[window truncated]`;
  return { start_line: start, end_line: end, changed_start_line: changedStart, changed_end_line: changedEnd, content, truncated };
}

function windowsFor(lines: string[] | null, ranges: CodeEvidenceRange[]): CodeEvidenceWindow[] {
  if (!lines?.length) return [];
  const range = ranges[0];
  const changedStart = Math.max(1, range?.after_start_line || 1);
  const changedEnd = Math.max(changedStart, range?.after_end_line || changedStart);
  if (changedEnd - changedStart <= 16) return [oneWindow(lines, changedStart, changedEnd)];
  return [oneWindow(lines, changedStart, Math.min(changedEnd, changedStart + 5)), oneWindow(lines, Math.max(changedStart, changedEnd - 5), changedEnd)];
}

function operationFromSnapshot(ref: WorkspaceSnapshotRef, existsAfter: boolean): CodeEvidenceOperation {
  const op = String(ref.operation || '').toLowerCase();
  if (!existsAfter) return /(?:rename|move)/.test(op) ? 'move' : 'delete';
  if (/copy/.test(op)) return 'copy';
  if (/(?:rename|move)/.test(op)) return 'move';
  if (ref.existed === false) return 'create';
  return 'update';
}

function fallbackOperation(toolName: string, args: Record<string, any>, resultText: string, existsAfter: boolean): CodeEvidenceOperation {
  if (!existsAfter) return /(?:move|rename)/.test(toolName) ? 'move' : 'delete';
  if (/copy/.test(toolName)) return 'copy';
  if (/(?:move|rename)/.test(toolName)) return 'move';
  if (/create/.test(toolName) || (/write/.test(toolName) && (args.overwrite === false || /\bcreated\b/i.test(resultText)))) return 'create';
  return 'update';
}

function evidenceForPath(input: {
  absPath: string;
  previousBuffer?: Buffer | null;
  operation: CodeEvidenceOperation;
  projectRoot: string;
  workspacePath: string;
  provenance: string;
  observedAt: string;
}): CodeEvidenceFile {
  const existsAfter = fs.existsSync(input.absPath) && fs.statSync(input.absPath).isFile();
  const afterStat = existsAfter ? fs.statSync(input.absPath) : null;
  const afterBuffer = afterStat && afterStat.size <= MAX_FILE_BYTES_FOR_TEXT ? fs.readFileSync(input.absPath) : null;
  const afterSample = existsAfter ? (afterBuffer || readFileSample(input.absPath)) : null;
  const beforeLines = normalizedLines(input.previousBuffer || null);
  const afterLines = normalizedLines(afterBuffer);
  const ranges = changedRange(beforeLines, afterLines);
  const binary = !!afterSample && looksBinary(afterSample);
  const tooLarge = !!afterStat && afterStat.size > MAX_FILE_BYTES_FOR_TEXT;
  const hashAvailable = !!afterStat && afterStat.size <= MAX_FILE_BYTES_FOR_HASH;
  return {
    path: displayPath(input.projectRoot, input.workspacePath, input.absPath),
    operation: input.operation,
    exists_after: existsAfter,
    ...(existsAfter ? { ...(hashAvailable ? { authoritative_content_sha256: sha256File(input.absPath) } : {}), size_bytes: afterStat!.size } : {}),
    ...(afterLines ? { line_count: afterLines.length } : {}),
    ...(binary ? { binary: true } : {}),
    changed_ranges: ranges,
    post_edit_windows: windowsFor(afterLines, ranges),
    evidence_complete: !existsAfter || (!binary && !tooLarge && hashAvailable),
    ...((existsAfter && (binary || tooLarge || !hashAvailable)) ? { required_reread_reason: binary ? 'Binary files do not include content windows.' : !hashAvailable ? 'File exceeds the authoritative evidence hash limit.' : 'File exceeds the bounded evidence text limit.' } : {}),
    observed_at: input.observedAt,
    provenance: input.provenance,
  };
}

function argumentPaths(toolName: string, args: Record<string, any>, workspacePath: string): string[] {
  const raw: unknown[] = [];
  const add = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(add);
    if (value && typeof value === 'object') {
      const item = value as Record<string, unknown>;
      add(item.path ?? item.filename ?? item.file ?? item.name);
      return;
    }
    if (value !== undefined && value !== null) raw.push(value);
  };
  for (const key of ['path', 'filename', 'file', 'name', 'target', 'old_path', 'oldPath', 'new_path', 'newPath', 'source', 'destination']) add(args[key]);
  for (const key of ['paths', 'files', 'edits']) add(args[key]);
  return Array.from(new Set(raw.map((value) => resolveArgumentPath(toolName, workspacePath, value)).filter(Boolean))).slice(0, MAX_FILES);
}

function readRangeFromArgs(args: Record<string, any>, lineCount: number): { start: number; end: number } {
  const start = Math.max(1, Math.floor(Number(args.start_line ?? args.startLine) || 1));
  const count = Math.max(1, Math.min(24, Math.floor(Number(args.num_lines ?? args.max_lines) || 12)));
  if (args.tail !== undefined) {
    const tail = Math.max(1, Math.min(24, Math.floor(Number(args.tail) || count)));
    return { start: Math.max(1, lineCount - tail + 1), end: lineCount };
  }
  return { start: Math.min(start, Math.max(1, lineCount)), end: Math.min(lineCount, start + count - 1) };
}

function applyMutationArgumentRange(file: CodeEvidenceFile, args: Record<string, any>, absPath: string, resultText: string): void {
  if (!file.exists_after || file.binary) return;
  let lines: string[];
  try {
    if (fs.statSync(absPath).size > MAX_FILE_BYTES_FOR_TEXT) return;
    const buffer = fs.readFileSync(absPath);
    const parsed = normalizedLines(buffer);
    if (!parsed) return;
    lines = parsed;
  } catch {
    return;
  }
  const action = String(args.action || args.operation || '').toLowerCase();
  const startArg = Number(args.start_line ?? args.startLine);
  const endArg = Number(args.end_line ?? args.endLine);
  const afterArg = Number(args.after_line ?? args.afterLine);
  let start = 0;
  let end = 0;
  let beforeStart: number | null = null;
  let beforeEnd: number | null = null;
  if (Number.isInteger(startArg) && startArg > 0) {
    start = startArg;
    const inserted = String(args.new_content ?? args.content ?? '').replace(/\r\n/g, '\n').split('\n').length;
    end = /delete/.test(action) || (args.new_content === undefined && /delete/i.test(resultText)) ? start : start + Math.max(1, inserted) - 1;
    beforeStart = start;
    beforeEnd = Number.isInteger(endArg) && endArg >= start ? endArg : start;
  } else if (Number.isInteger(afterArg) && afterArg >= 0) {
    start = afterArg + 1;
    const inserted = String(args.content ?? args.new_content ?? '').replace(/\r\n/g, '\n').split('\n').length;
    end = start + Math.max(1, inserted) - 1;
    beforeStart = null;
    beforeEnd = null;
  } else {
    const renderedRange = String(resultText || '').match(/Changed lines:\s+[^:\r\n]+:(\d+)-(\d+)/i);
    if (renderedRange) {
      start = Number(renderedRange[1]);
      end = Number(renderedRange[2]);
    } else {
      const replacement = String(args.replace ?? '');
      if (replacement) {
        const normalized = replacement.replace(/\r\n/g, '\n');
        const content = lines.join('\n');
        const offset = content.indexOf(normalized);
        if (offset >= 0) {
          start = content.slice(0, offset).split('\n').length;
          end = start + normalized.split('\n').length - 1;
        }
      }
    }
    beforeStart = start || null;
    beforeEnd = end || start || null;
  }
  if (!start) return;
  start = Math.max(1, Math.min(lines.length, start));
  end = Math.max(start, Math.min(lines.length, end || start));
  file.changed_ranges = [{ before_start_line: beforeStart, before_end_line: beforeEnd, after_start_line: start, after_end_line: end }];
  file.post_edit_windows = windowsFor(lines, file.changed_ranges);
}

export function attachCodeEvidenceToToolResult(
  toolResult: ToolResult,
  options: { workspacePath: string; toolName?: string; args?: Record<string, any>; now?: number },
): ToolResult {
  if (!toolResult || toolResult.extra?.codeEvidence) return toolResult;
  if (toolResult.error === true) return toolResult;
  const started = Date.now();
  const toolName = normalizeToolName(options.toolName || toolResult.name);
  const args = (options.args || toolResult.args || {}) as Record<string, any>;
  if (args.dry_run === true || args.check === true) return toolResult;
  const mutation = isMutationTool(toolName, args);
  const read = isReadTool(toolName, args);
  if (!mutation && !read) return toolResult;
  const workspacePath = path.resolve(options.workspacePath);
  const projectRoot = resolveProjectRoot(workspacePath);
  const observedAt = new Date(options.now || Date.now()).toISOString();
  const files: CodeEvidenceFile[] = [];

  if (mutation) {
    const refs = snapshotRefs(toolResult);
    for (const ref of refs) {
      const absPath = String(ref.targetPath || '').trim();
      if (!absPath) continue;
      const existsAfter = fs.existsSync(absPath) && fs.statSync(absPath).isFile();
      files.push(evidenceForPath({
        absPath,
        previousBuffer: snapshotContent(workspacePath, ref),
        operation: operationFromSnapshot(ref, existsAfter),
        projectRoot,
        workspacePath,
        provenance: `tool:${toolName}:workspace_snapshot`,
        observedAt,
      }));
    }
    if (/(?:copy|move|rename)/.test(toolName)) {
      const rawSource = args.source ?? args.from ?? args.old_path ?? args.oldPath ?? args.filename;
      const rawDestination = args.destination ?? args.dest ?? args.to ?? args.new_path ?? args.newPath ?? args.path;
      const sourceAbs = resolveArgumentPath(toolName, workspacePath, rawSource);
      const destinationAbs = resolveArgumentPath(toolName, workspacePath, rawDestination);
      const sourceDisplay = sourceAbs ? displayPath(projectRoot, workspacePath, sourceAbs) : '';
      const destinationDisplay = destinationAbs ? displayPath(projectRoot, workspacePath, destinationAbs) : '';
      for (const file of files) {
        if (sourceDisplay && (file.path === destinationDisplay || (file.operation === 'move' && file.exists_after))) {
          file.previous_path = sourceDisplay;
        }
      }
    }
    if (!files.length) {
      for (const absPath of argumentPaths(toolName, args, workspacePath)) {
        try {
          const existsAfter = fs.existsSync(absPath) && fs.statSync(absPath).isFile();
          const fallbackEvidence = evidenceForPath({
            absPath,
            operation: fallbackOperation(toolName, args, String(toolResult.result || ''), existsAfter),
            projectRoot,
            workspacePath,
            provenance: `tool:${toolName}:post_operation_fallback`,
            observedAt,
          });
          applyMutationArgumentRange(fallbackEvidence, args, absPath, String(toolResult.result || ''));
          files.push(fallbackEvidence);
        } catch {}
      }
    }
  } else {
    for (const absPath of argumentPaths(toolName, args, workspacePath).slice(0, 1)) {
      try {
        if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) continue;
        const stat = fs.statSync(absPath);
        const buffer = stat.size <= MAX_FILE_BYTES_FOR_TEXT ? fs.readFileSync(absPath) : null;
        const sample = buffer || readFileSample(absPath);
        const lines = normalizedLines(buffer);
        const range = readRangeFromArgs(args, lines?.length || 1);
        const ranges: CodeEvidenceRange[] = [{ before_start_line: null, before_end_line: null, after_start_line: range.start, after_end_line: range.end }];
        files.push({
          path: displayPath(projectRoot, workspacePath, absPath),
          operation: 'read',
          exists_after: true,
          ...(stat.size <= MAX_FILE_BYTES_FOR_HASH ? { authoritative_content_sha256: sha256File(absPath) } : {}),
          size_bytes: stat.size,
          ...(lines ? { line_count: lines.length } : {}),
          ...(looksBinary(sample) ? { binary: true } : {}),
          changed_ranges: [],
          post_edit_windows: windowsFor(lines, ranges),
          evidence_complete: !!lines && stat.size <= MAX_FILE_BYTES_FOR_HASH,
          ...(!lines || stat.size > MAX_FILE_BYTES_FOR_HASH ? { required_reread_reason: 'Read evidence content window unavailable for a binary or oversized file.' } : {}),
          observed_at: observedAt,
          provenance: `tool:${toolName}:authoritative_read`,
        });
      } catch {}
    }
  }

  if (!files.length) return toolResult;
  const envelope: CodeEvidenceEnvelope = {
    version: CODE_EVIDENCE_VERSION,
    kind: 'code_evidence',
    tool_name: toolName,
    operation: mutation ? 'mutation' : 'read',
    generated_at: observedAt,
    generation_ms: Math.max(0, Date.now() - started),
    files: files.slice(0, MAX_FILES),
    truncated: files.length > MAX_FILES,
  };
  return {
    ...toolResult,
    extra: { ...(toolResult.extra || {}), codeEvidence: envelope },
  };
}
