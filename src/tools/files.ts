import fs from 'fs/promises';
import path from 'path';
import fsSync from 'fs';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getConfig } from '../config/config.js';
import { getActiveWorkspace, getActiveAllowedWorkspaces, hasActiveWorkspaceScope, isPathInAnyWorkspace } from './workspace-context.js';
import { ToolResult } from '../types.js';
import { createWorkspaceSnapshot, toSnapshotRef } from '../workspace-history';
import { isCanonicalPathInsideSync } from './workspace-boundary.js';
import {
  DEFAULT_FILE_TOOL_EXCLUDES,
  buildFileIntelligence,
  buildNoMatchHints,
  buildRepoMapHeader,
  collectGrepMatchesInText,
  compareGrepMatches,
  createSearchMatcher,
  formatFileIntelligence,
  formatPhysicalLineWindow,
  formatSyntaxValidationResult,
  matchesGlobList,
  parseGlobList,
  readSimpleGitignore,
  resolvePositiveLineArg,
  resolveResultCharBudget,
  shouldSkipSearchPath,
  summarizeFileForTool,
  validateFileSyntax,
  type SearchMatcher,
} from './file-intelligence';

const execFileAsync = promisify(execFile);
const PATCH_OUTPUT_MAX_CHARS = 8000;
const FILE_TOOL_DEFAULT_BATCH_FILES = 2;
const FILE_TOOL_MAX_BATCH_FILES = 8;
const FILE_TOOL_DEFAULT_BATCH_LINES = 80;
const FILE_TOOL_MAX_BATCH_LINES = 240;
const FILE_TOOL_DEFAULT_TREE_DEPTH = 2;
const FILE_TOOL_DEFAULT_TREE_ENTRIES = 180;
const FILE_TOOL_MAX_LINE_CHARS = 700;
const FILE_TOOL_BATCH_INLINE_LIMIT_CHARS = 6000;
const FILE_TOOL_READ_INLINE_LIMIT_CHARS = 12000;
const FILE_TOOL_TREE_INLINE_LIMIT_CHARS = 8000;

function trimReturnedFileLine(line: string, maxChars = FILE_TOOL_MAX_LINE_CHARS): string {
  const value = String(line ?? '');
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}...[line truncated]`;
}

function lineNumberAtOffset(content: string, offset: number): number {
  const target = Math.max(0, Math.floor(Number(offset) || 0));
  let line = 1;
  for (let index = 0; index < Math.min(target, content.length); index += 1) {
    if (content.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function formatPostEditContext(
  displayPath: string,
  content: string,
  changedStartLine: number,
  changedEndLine: number,
  summary: string,
): string {
  const lines = String(content || '').split('\n');
  const lineCount = lines.length;
  const start = Math.max(1, Math.min(Math.floor(Number(changedStartLine) || 1), Math.max(1, lineCount)));
  const end = Math.max(start, Math.min(Math.floor(Number(changedEndLine) || start), Math.max(1, lineCount)));
  const snippetStart = Math.max(1, start - 3);
  const snippetEnd = Math.min(lineCount, end + 3);
  const snippet = lines.slice(snippetStart - 1, snippetEnd)
    .map((line, index) => {
      const lineNumber = snippetStart + index;
      const marker = lineNumber >= start && lineNumber <= end ? '>' : ' ';
      return `${marker} ${lineNumber}: ${trimReturnedFileLine(line, 360)}`;
    })
    .join('\n');
  return [
    summary,
    `Changed lines: ${displayPath}:${start}-${end} (${lineCount} total lines)`,
    'Post-edit context:',
    snippet || '(empty)',
  ].join('\n');
}

async function writeToolResultOverflow(toolName: string, output: string): Promise<string | null> {
  try {
    const safeTool = String(toolName || 'tool')
      .replace(/[^a-z0-9_-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'tool';
    const dir = resolveWorkspacePath(path.join('temp', 'tool-results'));
    await fs.mkdir(dir, { recursive: true });
    const file = `${Date.now()}-${safeTool}.txt`;
    const absPath = path.join(dir, file);
    await fs.writeFile(absPath, output, 'utf-8');
    const workspaceRoot = resolveWorkspacePath('.');
    return path.relative(workspaceRoot, absPath).replace(/\\/g, '/');
  } catch {
    return null;
  }
}

async function maybeSpoolToolStdout(
  toolName: string,
  stdout: string,
  inlineLimit: number,
  opts: { allowInline?: boolean; summary?: string } = {}
): Promise<{ stdout: string; artifacts?: any[] }> {
  const text = String(stdout || '');
  if (opts.allowInline || text.length <= inlineLimit) return { stdout: text };
  const relPath = await writeToolResultOverflow(toolName, text);
  if (!relPath) {
    return {
      stdout: `${opts.summary ? `${opts.summary}\n` : ''}[TOOL_RESULT_TRUNCATED] Output was ${text.length} chars; returning first ${inlineLimit} chars because overflow artifact write failed.\n${text.slice(0, inlineLimit)}`,
    };
  }
  return {
    stdout: [
      opts.summary || `${toolName} output was ${text.length} chars, which exceeds the ${inlineLimit} char inline budget.`,
      `[TOOL_RESULT_ARTIFACT] Full output saved to ${relPath}. Read targeted ranges from that artifact only if needed.`,
    ].join('\n'),
    artifacts: [{ type: 'text', path: relPath, bytes: Buffer.byteLength(text, 'utf-8') }],
  };
}

// Helper function to check if path is allowed
function resolveWorkspacePath(targetPath: string): string {
  const config = getConfig().getConfig();
  const globalWorkspace = config.workspace.path;
  // Use the per-execution workspace context if set (subagent / team run),
  // otherwise fall back to the global workspace from config.
  const workspace = getActiveWorkspace(globalWorkspace);
  if (path.isAbsolute(targetPath)) return targetPath;
  return path.join(workspace, targetPath);
}

function resolveWorkspaceRoot(): string {
  const config = getConfig().getConfig();
  return getActiveWorkspace(config.workspace.path);
}

function snapshotBeforeMutation(absPath: string, operation: string, displayPath?: string, workspacePath = resolveWorkspaceRoot()) {
  return toSnapshotRef(createWorkspaceSnapshot({
    workspacePath,
    targetPath: absPath,
    displayPath,
    operation,
  }));
}

function withWorkspaceSnapshots<T extends ToolResult>(result: T, snapshots: Array<ReturnType<typeof snapshotBeforeMutation>>): T {
  const refs = snapshots.filter(Boolean);
  if (!refs.length) return result;
  return {
    ...result,
    data: {
      ...(result.data || {}),
      workspaceSnapshots: refs,
    },
  };
}

function isPathInside(basePath: string, targetPath: string): boolean {
  try {
    return isCanonicalPathInsideSync(basePath, targetPath);
  } catch {
    return false;
  }
}

function isPathAllowed(targetPath: string): { allowed: boolean; reason?: string } {
  const config = getConfig().getConfig();
  const permissions = config.tools.permissions.files;
  const absPath = path.resolve(String(targetPath || ''));
  const globalWorkspace = config.workspace.path;
  // Determine the active workspace for this execution context.
  // When running as a subagent or team member the AsyncLocalStorage context
  // will carry the agent-specific workspace root; otherwise we use global.
  const activeWorkspace = getActiveWorkspace(globalWorkspace);
  const activeAllowedWorkspaces = getActiveAllowedWorkspaces(globalWorkspace, permissions.allowed_paths || []);
  const isScopedRun = hasActiveWorkspaceScope();

  // ── Workspace-scoped enforcement (subagents / team members) ──────────────
  // When running inside a scoped workspace, ONLY allow paths inside it.
  // This prevents any agent from escaping its own workspace directory.
  if (isScopedRun) {
    if (!isPathInAnyWorkspace(activeAllowedWorkspaces, absPath)) {
      return {
        allowed: false,
        reason: `[WORKSPACE ISOLATION] Path "${absPath}" is outside this agent's allowed work paths (${activeAllowedWorkspaces.join(', ')}).`
      };
    }
    return { allowed: true };
  }

  // ── Global workspace mode (main session / direct tool calls) ─────────────
  // Check blocked paths
  for (const blocked of permissions.blocked_paths) {
    if (isPathInside(blocked, absPath)) {
      return {
        allowed: false,
        reason: `Path is in blocked directory: ${blocked}`
      };
    }
  }

  // Check allowed paths
  const isInAllowedPath = permissions.allowed_paths.some(allowed => 
    isPathInside(allowed, absPath)
  );

  if (!isInAllowedPath) {
    return {
      allowed: false,
      reason: `Path is not in any allowed directory. Allowed: ${permissions.allowed_paths.join(', ')}`
    };
  }

  return { allowed: true };
}

function truncateOutput(text: string): string {
  const t = String(text || '').trim();
  if (!t) return '';
  if (t.length <= PATCH_OUTPUT_MAX_CHARS) return t;
  return `${t.slice(0, PATCH_OUTPUT_MAX_CHARS)} ...[truncated]`;
}

function countSkippedPatches(text: string): number {
  const src = String(text || '')
    .replace(/\x1b\[[0-9;]*m/g, '');
  if (!src) return 0;
  const matches = src.match(/Skipped patch\b/gi);
  return matches ? matches.length : 0;
}

function parsePatchPathToken(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('"')) {
    const m = trimmed.match(/^"([^"]+)"/);
    return m?.[1] || '';
  }
  return trimmed.split(/\s+/)[0] || '';
}

function normalizePatchPath(rawPath: string): string {
  let p = String(rawPath || '').trim();
  if (!p || p === '/dev/null') return '';
  if (p.startsWith('a/') || p.startsWith('b/')) p = p.slice(2);
  return p;
}

function extractPatchTargetPaths(patchText: string): string[] {
  const paths = new Set<string>();
  const lines = String(patchText || '').split('\n');

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const m = line.match(/^diff --git\s+(?:"([^"]+)"|(\S+))\s+(?:"([^"]+)"|(\S+))/);
      const left = normalizePatchPath(m?.[1] || m?.[2] || '');
      const right = normalizePatchPath(m?.[3] || m?.[4] || '');
      if (left) paths.add(left);
      if (right) paths.add(right);
      continue;
    }

    if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      const token = parsePatchPathToken(line.slice(4));
      const normalized = normalizePatchPath(token);
      if (normalized) paths.add(normalized);
      continue;
    }

    if (line.startsWith('rename from ')) {
      const fromPath = normalizePatchPath(line.slice('rename from '.length));
      if (fromPath) paths.add(fromPath);
      continue;
    }

    if (line.startsWith('rename to ')) {
      const toPath = normalizePatchPath(line.slice('rename to '.length));
      if (toPath) paths.add(toPath);
    }
  }

  return Array.from(paths);
}

function validatePatchPaths(paths: string[], workspacePath: string): { ok: true; relativePaths: string[] } | { ok: false; error: string } {
  if (!Array.isArray(paths) || paths.length === 0) {
    return { ok: false, error: 'No target paths found in patch. Include standard unified diff headers (---/+++).' };
  }

  const unique = Array.from(new Set(paths.map(p => String(p || '').trim()).filter(Boolean)));
  for (const relPath of unique) {
    if (path.isAbsolute(relPath)) {
      return { ok: false, error: `Patch path must be relative: ${relPath}` };
    }
    const absPath = path.resolve(workspacePath, relPath);
    const pathCheck = isPathAllowed(absPath);
    if (!pathCheck.allowed) {
      return { ok: false, error: `Patch path not allowed (${relPath}): ${pathCheck.reason}` };
    }
  }

  return { ok: true, relativePaths: unique };
}

async function runGitApply(workspacePath: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const out = await execFileAsync('git', args, {
    cwd: workspacePath,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    encoding: 'utf8',
  } as any);
  return {
    stdout: String((out as any)?.stdout || ''),
    stderr: String((out as any)?.stderr || ''),
  };
}

// READ TOOL
export interface ReadToolArgs {
  path: string;
  start_line?: number;
  num_lines?: number;
  around_line?: number;
  aroundLine?: number;
  line?: number;
  line_number?: number;
  lineNumber?: number;
  physical_line?: number;
  column?: number;
  char_window?: number;
  charWindow?: number;
  full_line?: boolean;
  fullLine?: boolean;
  show_full_line?: boolean;
  showFullLine?: boolean;
  before?: number;
  after?: number;
  max_lines?: number;
  inline?: boolean;
  no_spool?: boolean;
  max_result_tokens?: number;
  hard_max_result_tokens?: number;
}

async function validateGitApplyRoot(workspacePath: string): Promise<string | null> {
  let gitRoot = '';
  try {
    const out = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
      cwd: workspacePath,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8',
    } as any);
    gitRoot = String((out as any)?.stdout || '').trim();
  } catch {
    // `git apply` also works outside a repository. The actual apply invocation
    // below remains rooted at workspacePath and will report operational errors.
  }
  if (!gitRoot) return null;
  try {
    return isCanonicalPathInsideSync(workspacePath, gitRoot)
      ? null
      : `Git worktree root is outside the active workspace: ${gitRoot}`;
  } catch (error: any) {
    return `Git worktree root could not be canonicalized safely: ${String(error?.message || error)}`;
  }
}

type RetrievalMode = 'fast' | 'standard' | 'deep';

function getLocalConfigFilePath(): string {
  const base = process.env.PROMETHEUS_DATA_DIR
    ? path.join(process.env.PROMETHEUS_DATA_DIR, '.prometheus')
    : path.join(process.cwd(), '.prometheus');
  const projectCfg = path.join(base, 'config.json');
  return fsSync.existsSync(projectCfg) ? projectCfg : path.join(os.homedir(), '.prometheus', 'config.json');
}

function getRetrievalMode(): RetrievalMode {
  try {
    const p = getLocalConfigFilePath();
    if (!fsSync.existsSync(p)) return 'standard';
    const raw = JSON.parse(fsSync.readFileSync(p, 'utf-8'));
    const mode = String(raw?.agent_policy?.retrieval_mode || 'standard').toLowerCase();
    if (mode === 'fast' || mode === 'deep') return mode;
    return 'standard';
  } catch {
    return 'standard';
  }
}

function retrievalMaxLines(mode: RetrievalMode): number {
  if (mode === 'fast') return 120;
  if (mode === 'deep') return 480;
  return 180;
}

export async function executeRead(args: ReadToolArgs): Promise<ToolResult> {
  try {
    const absPath = resolveWorkspacePath(args.path);
    const pathCheck = isPathAllowed(absPath);
    if (!pathCheck.allowed) {
      return {
        success: false,
        error: pathCheck.reason
      };
    }
    const content = await fs.readFile(absPath, 'utf-8');
    const allLines = content.split('\n');
    const exactLine = resolvePositiveLineArg(args.line ?? args.line_number ?? args.lineNumber ?? args.physical_line);
    if (exactLine != null) {
      const renderedLine = formatPhysicalLineWindow(args.path, allLines, {
        line: exactLine,
        column: args.column != null ? Number(args.column) : undefined,
        char_window: args.char_window ?? args.charWindow,
        full_line: args.full_line === true || args.fullLine === true,
        show_full_line: args.show_full_line === true || args.showFullLine === true,
      });
      const spooled = await maybeSpoolToolStdout('read_file', renderedLine, resolveResultCharBudget(args, FILE_TOOL_READ_INLINE_LIMIT_CHARS), {
        allowInline: args.inline === true || args.no_spool === true,
        summary: `${args.path} exact physical-line read exceeded inline budget. Requested line ${exactLine}.`,
      });
      return {
        success: true,
        data: {
          path: absPath,
          content: spooled.stdout,
          size: renderedLine.length,
          lines: allLines.length,
          window: {
            line: exactLine,
            column: args.column,
          },
        },
        ...(spooled.artifacts ? { artifacts: spooled.artifacts } : {}),
      };
    }
    const mode = getRetrievalMode();
    const cap = Math.max(1, Math.min(480, Math.floor(Number(args.max_lines) || retrievalMaxLines(mode))));
    const aroundLine = Math.max(0, Number(args.around_line ?? args.aroundLine) || 0);
    const before = Math.max(0, Math.min(240, Number(args.before || 40) || 40));
    const after = Math.max(0, Math.min(240, Number(args.after || 80) || 80));
    const startLine = aroundLine > 0
      ? Math.max(1, Math.floor(aroundLine - before))
      : Math.max(1, Number(args.start_line || 1) || 1);
    const requested = aroundLine > 0
      ? before + after + 1
      : Math.max(1, Number(args.num_lines || cap) || cap);
    const window = Math.min(requested, cap);
    const startIdx = Math.max(0, startLine - 1);
    const selected = allLines.slice(startIdx, startIdx + window);
    const outContent = selected.map((line, index) => `${startLine + index}: ${trimReturnedFileLine(line)}`).join('\n');
    const endLine = startLine + selected.length - 1;
    const truncated = (allLines.length > selected.length) || startLine > 1 || requested > cap;
    const spooled = await maybeSpoolToolStdout('read_file', outContent, resolveResultCharBudget(args, FILE_TOOL_READ_INLINE_LIMIT_CHARS), {
      allowInline: args.inline === true || args.no_spool === true,
      summary: `${args.path} read result exceeded inline budget. Requested window ${startLine}-${endLine}.`,
    });
    return {
      success: true,
      data: {
        path: absPath,
        content: spooled.artifacts ? spooled.stdout : outContent,
        size: outContent.length,
        lines: allLines.length,
        window: {
          start_line: startLine,
          end_line: endLine,
          truncated,
        },
      },
      ...(spooled.artifacts ? { artifacts: spooled.artifacts } : {}),
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to read file: ${error.message}`
    };
  }
}

// WRITE TOOL
export interface WriteToolArgs {
  path: string;
  content: string;
}

export async function executeWrite(args: WriteToolArgs): Promise<ToolResult> {
  try {
    if (!args || typeof args.path !== 'string' || !args.path.trim()) {
      return {
        success: false,
        error: 'path is required'
      };
    }
    if (typeof (args as any).content !== 'string') {
      return {
        success: false,
        error: 'content must be a string'
      };
    }
    const absPath = resolveWorkspacePath(args.path);
    const pathCheck = isPathAllowed(absPath);
    if (!pathCheck.allowed) {
      return {
        success: false,
        error: pathCheck.reason
      };
    }
    const snapshot = snapshotBeforeMutation(absPath, 'write_file', args.path);
    // Ensure directory exists
    const dir = path.dirname(absPath);
    await fs.mkdir(dir, { recursive: true });
    // Write file
    await fs.writeFile(absPath, args.content, 'utf-8');
    return withWorkspaceSnapshots({
      success: true,
      data: {
        path: absPath,
        size: args.content.length,
        lines: args.content.split('\n').length
      }
    }, [snapshot]);
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to write file: ${error.message}`
    };
  }
}

// EDIT TOOL (find and replace)
export interface EditToolArgs {
  path: string;
  old_str: string;
  new_str: string;
}

export async function executeEdit(args: EditToolArgs): Promise<ToolResult> {
  try {
    const absPath = resolveWorkspacePath(args.path);
    const pathCheck = isPathAllowed(absPath);
    if (!pathCheck.allowed) {
      return {
        success: false,
        error: pathCheck.reason
      };
    }
    // Read current content
    const content = await fs.readFile(absPath, 'utf-8');
    // Check if old_str exists
    if (!content.includes(args.old_str)) {
      return {
        success: false,
        error: `String not found in file: "${args.old_str.slice(0, 50)}..."`
      };
    }
    // Count occurrences
    const occurrences = (content.match(new RegExp(args.old_str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    if (occurrences > 1) {
      return {
        success: false,
        error: `String appears ${occurrences} times in file. For safety, it must appear exactly once. Please be more specific.`
      };
    }
    // Perform replacement
    const matchIndex = content.indexOf(args.old_str);
    const newContent = content.replace(args.old_str, args.new_str);
    // Write back
    const snapshot = snapshotBeforeMutation(absPath, 'edit', args.path);
    await fs.writeFile(absPath, newContent, 'utf-8');
    const startLine = lineNumberAtOffset(content, matchIndex);
    const replacementLines = Math.max(1, String(args.new_str || '').replace(/\r\n/g, '\n').split('\n').length);
    return withWorkspaceSnapshots({
      success: true,
      data: {
        path: absPath,
        replacements: 1,
      },
      stdout: formatPostEditContext(args.path, newContent, startLine, Math.max(startLine, startLine + replacementLines - 1), `Edited ${args.path}: replaced one occurrence.`),
    }, [snapshot]);
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to edit file: ${error.message}`
    };
  }
}

// LIST DIRECTORY TOOL
export interface ListToolArgs {
  path: string;
}

export async function executeList(args: ListToolArgs): Promise<ToolResult> {
  try {
    const absPath = resolveWorkspacePath(args.path);
    const pathCheck = isPathAllowed(absPath);
    if (!pathCheck.allowed) {
      return {
        success: false,
        error: pathCheck.reason
      };
    }

    const entries = await fs.readdir(absPath, { withFileTypes: true });
    
    const files = entries
      .filter(e => e.isFile())
      .map(e => e.name);
    
    const directories = entries
      .filter(e => e.isDirectory())
      .map(e => e.name);

    return {
      success: true,
      data: {
        path: absPath,
        files,
        directories,
        total: entries.length
      }
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to list directory: ${error.message}`
    };
  }
}

// Tool exports
export const readTool = {
  name: 'read',
  description: 'Read file contents (snippet-windowed by retrieval mode caps)',
  execute: executeRead,
  schema: {
    path: 'string (required) - Path to the file to read',
    start_line: 'number (optional) - 1-based starting line (default 1)',
    num_lines: 'number (optional) - number of lines to return (capped by retrieval mode)',
  }
};

export const writeTool = {
  name: 'write',
  description: 'Create or overwrite a file',
  execute: executeWrite,
  schema: {
    path: 'string (required) - Path to the file',
    content: 'string (required) - File contents'
  }
};

export const editTool = {
  name: 'edit',
  description: 'Edit a file by replacing text (string must appear exactly once)',
  execute: executeEdit,
  schema: {
    path: 'string (required) - Path to the file',
    old_str: 'string (required) - Text to find (must appear exactly once)',
    new_str: 'string (required) - Replacement text'
  }
};

export const listTool = {
  name: 'list',
  description: 'List files and directories',
  execute: executeList,
  schema: {
    path: 'string (required) - Path to directory'
  }
};

// ── DELETE ────────────────────────────────────────────────────────────────────
import { rmSync, existsSync } from 'fs';

async function executeDelete(args: { path: string; recursive?: boolean }): Promise<ToolResult> {
  if (!args.path?.trim()) return { success: false, error: 'path is required' };
  const absPath = resolveWorkspacePath(args.path);
  const pathCheck = isPathAllowed(absPath);
  if (!pathCheck.allowed) return { success: false, error: pathCheck.reason };
  if (!existsSync(absPath)) return { success: false, error: `Path does not exist: ${absPath}` };
  try {
    const snapshot = snapshotBeforeMutation(absPath, 'delete', args.path);
    rmSync(absPath, { recursive: args.recursive ?? false, force: true });
    return withWorkspaceSnapshots({ success: true, stdout: `Deleted: ${absPath}` }, [snapshot]);
  } catch (err: any) {
    return { success: false, error: `Delete failed: ${err.message}` };
  }
}

export const deleteTool = {
  name: 'delete',
  description: 'Delete a file or directory',
  execute: executeDelete,
  schema: {
    path: 'string (required) - Path to delete',
    recursive: 'boolean (optional) - Delete directories recursively (default false)'
  }
};

// ── RENAME / MOVE ───────────────────────────────────────────────────────────
export interface RenameArgs {
  path: string;
  new_path: string;
}
export async function executeRename(args: RenameArgs): Promise<ToolResult> {
  try {
    const src = resolveWorkspacePath(args.path);
    const dest = resolveWorkspacePath(args.new_path);
    const srcCheck = isPathAllowed(src);
    const destCheck = isPathAllowed(dest);
    if (!srcCheck.allowed) return { success: false, error: srcCheck.reason };
    if (!destCheck.allowed) return { success: false, error: destCheck.reason };
    // Ensure source exists
    if (!(await fs.stat(src).catch(() => null))) {
      return { success: false, error: `Source does not exist: ${src}` };
    }
    const snapshots = [
      snapshotBeforeMutation(src, 'rename:source', args.path),
      snapshotBeforeMutation(dest, 'rename:destination', args.new_path),
    ];
    // Ensure destination dir
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rename(src, dest);
    return withWorkspaceSnapshots({ success: true, data: { from: src, to: dest } }, snapshots);
  } catch (err: any) {
    return { success: false, error: `Rename failed: ${err.message}` };
  }
}

export const renameTool = {
  name: 'rename',
  description: 'Rename or move a file/directory',
  execute: executeRename,
  schema: {
    path: 'string (required) - Existing path',
    new_path: 'string (required) - New path'
  }
};

// ── COPY ─────────────────────────────────────────────────────────────────────
export interface CopyArgs {
  path: string;
  dest: string;
}
export async function executeCopy(args: CopyArgs): Promise<ToolResult> {
  try {
    const src = resolveWorkspacePath(args.path);
    const dest = resolveWorkspacePath(args.dest);
    const srcCheck = isPathAllowed(src);
    const destCheck = isPathAllowed(dest);
    if (!srcCheck.allowed) return { success: false, error: srcCheck.reason };
    if (!destCheck.allowed) return { success: false, error: destCheck.reason };
    const snapshot = snapshotBeforeMutation(dest, 'copy:destination', args.dest);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
    return withWorkspaceSnapshots({ success: true, data: { from: src, to: dest } }, [snapshot]);
  } catch (err: any) {
    return { success: false, error: `Copy failed: ${err.message}` };
  }
}

export const copyTool = {
  name: 'copy',
  description: 'Copy a file',
  execute: executeCopy,
  schema: {
    path: 'string (required) - Source file',
    dest: 'string (required) - Destination path'
  }
};

// ── MKDIR ────────────────────────────────────────────────────────────────────
export interface MkdirArgs {
  path: string;
  recursive?: boolean;
}
export async function executeMkdir(args: MkdirArgs): Promise<ToolResult> {
  try {
    const abs = resolveWorkspacePath(args.path);
    const pathCheck = isPathAllowed(abs);
    if (!pathCheck.allowed) return { success: false, error: pathCheck.reason };
    const snapshot = snapshotBeforeMutation(abs, 'mkdir', args.path);
    await fs.mkdir(abs, { recursive: args.recursive ?? true });
    return withWorkspaceSnapshots({ success: true, data: { path: abs } }, [snapshot]);
  } catch (err: any) {
    return { success: false, error: `Mkdir failed: ${err.message}` };
  }
}

export const mkdirTool = {
  name: 'mkdir',
  description: 'Create a directory',
  execute: executeMkdir,
  schema: {
    path: 'string (required) - Directory path',
    recursive: 'boolean (optional) - Create parents'
  }
};

// ── STAT / INFO ──────────────────────────────────────────────────────────────
export interface StatArgs {
  path: string;
}
export async function executeStat(args: StatArgs): Promise<ToolResult> {
  try {
    const abs = resolveWorkspacePath(args.path);
    const pathCheck = isPathAllowed(abs);
    if (!pathCheck.allowed) return { success: false, error: pathCheck.reason };
    const st = await fs.stat(abs);
    return { success: true, data: { path: abs, size: st.size, mtime: st.mtime, isFile: st.isFile(), isDirectory: st.isDirectory() } };
  } catch (err: any) {
    return { success: false, error: `Stat failed: ${err.message}` };
  }
}

export const statTool = {
  name: 'stat',
  description: 'Get file info',
  execute: executeStat,
  schema: {
    path: 'string (required) - Path to file or directory'
  }
};

// ── APPEND ───────────────────────────────────────────────────────────────────
export interface AppendArgs {
  path: string;
  content: string;
}
export async function executeAppend(args: AppendArgs): Promise<ToolResult> {
  try {
    const abs = resolveWorkspacePath(args.path);
    const pathCheck = isPathAllowed(abs);
    if (!pathCheck.allowed) return { success: false, error: pathCheck.reason };
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.appendFile(abs, args.content, 'utf-8');
    return { success: true, data: { path: abs } };
  } catch (err: any) {
    return { success: false, error: `Append failed: ${err.message}` };
  }
}

export const appendTool = {
  name: 'append',
  description: 'Append text to a file (creates file if missing)',
  execute: executeAppend,
  schema: {
    path: 'string (required) - Path to file',
    content: 'string (required) - Text to append'
  }
};

// ── GREP FILE (single-file search) ───────────────────────────────────────────
export interface GrepFileArgs {
  path: string;
  pattern: string;
  context_lines?: number;
  case_insensitive?: boolean;
  max_results?: number;
  regex?: boolean;
  literal?: boolean;
  before?: number;
  after?: number;
  char_before?: number;
  char_after?: number;
  char_window?: number;
}
export async function executeGrepFile(args: GrepFileArgs): Promise<ToolResult> {
  try {
    const abs = resolveWorkspacePath(args.path);
    const pathCheck = isPathAllowed(abs);
    if (!pathCheck.allowed) return { success: false, error: pathCheck.reason };
    const content = await fs.readFile(abs, 'utf-8');
    let matcher: SearchMatcher;
    try {
      matcher = createSearchMatcher(args.pattern, {
        regex: args.regex === true,
        literal: args.literal === true,
        caseInsensitive: args.case_insensitive === true,
      });
    }
    catch { return { success: false, error: `Invalid regex pattern: ${args.pattern}` }; }
    const requestedMaxResults = Math.floor(Number(args.max_results || 50));
    const ctx = Math.max(0, Math.min(3, Number(args.context_lines || 0)));
    const maxResults = Math.min(80, Math.max(1, requestedMaxResults));
    const grep = collectGrepMatchesInText(args.path, content, matcher, {
      maxResults,
      contextLines: ctx,
      before: Number(args.before) || 40,
      after: Number(args.after) || 80,
      charBefore: Number(args.char_before) || undefined,
      charAfter: Number(args.char_after) || undefined,
      charWindow: Number(args.char_window) || undefined,
    });
    return {
      success: true,
      data: {
        path: abs,
        pattern: args.pattern,
        search_mode: matcher.mode,
        match_count: grep.totalMatches,
        returned_count: grep.matches.length,
        truncated_count: grep.truncatedCount,
        result_limit: {
          requested: requestedMaxResults,
          applied: maxResults,
          context_lines: ctx,
          limit_reached: grep.limitReached,
          note: 'Result payloads are hard-clamped. Narrow the pattern or read a targeted file window for more context.',
        },
        no_match_hints: grep.totalMatches === 0 ? buildNoMatchHints({ pattern: args.pattern, searched: args.path, mode: matcher.mode }) : undefined,
        matches: grep.matches,
      },
    };
  } catch (err: any) {
    return { success: false, error: `grep_file failed: ${err.message}` };
  }
}

export const grepFileTool = {
  name: 'grep_file',
  description: 'Search a single workspace file for a regex or literal pattern. Returns matching lines with line numbers and optional surrounding context.',
  execute: executeGrepFile,
  schema: {
    path: 'string (required) - File to search',
    pattern: 'string (required) - Regex or literal pattern',
    context_lines: 'number (optional) - Lines of context around each match (default 0, hard cap 3)',
    char_window: 'number (optional) - Character window around each match for long/minified physical lines',
    case_insensitive: 'boolean (optional) - Case-insensitive match (default false)',
    max_results: 'number (optional) - Max matches to return (default 50, hard cap 80)',
  },
};

// ── SEARCH FILES (multi-file grep across directory) ──────────────────────────
export interface SearchFilesArgs {
  directory?: string;
  pattern: string;
  file_glob?: string;
  context_lines?: number;
  case_insensitive?: boolean;
  max_results?: number;
  regex?: boolean;
  literal?: boolean;
  before?: number;
  after?: number;
  char_before?: number;
  char_after?: number;
  char_window?: number;
  exclude?: string;
  gitignore?: boolean;
  respect_gitignore?: boolean;
  include_lockfiles?: boolean;
}
export async function executeSearchFiles(args: SearchFilesArgs): Promise<ToolResult> {
  try {
    const dirAbs = resolveWorkspacePath(args.directory || '.');
    const pathCheck = isPathAllowed(dirAbs);
    if (!pathCheck.allowed) return { success: false, error: pathCheck.reason };
    let matcher: SearchMatcher;
    try {
      matcher = createSearchMatcher(args.pattern, {
        regex: args.regex === true,
        literal: args.literal === true,
        caseInsensitive: args.case_insensitive === true,
      });
    }
    catch { return { success: false, error: `Invalid regex pattern: ${args.pattern}` }; }
    const globs = parseGlobList(args.file_glob);
    const requestedMaxResults = Math.floor(Number(args.max_results || 50));
    const maxResults = Math.min(80, Math.max(1, requestedMaxResults));
    const ctx = Math.max(0, Math.min(3, Number(args.context_lines || 0)));
    const storeLimit = Math.max(maxResults, Math.min(240, maxResults * 3));
    const excludes = new Set<string>([
      ...DEFAULT_FILE_TOOL_EXCLUDES,
      ...String(args.exclude || '').split(',').map((item: string) => item.trim()).filter(Boolean),
    ]);
    const gitignoreRules = args.gitignore === false || args.respect_gitignore === false ? [] : readSimpleGitignore(dirAbs);
    const results: any[] = [];
    let totalMatches = 0;
    let filesSearched = 0;
    let filesSkipped = 0;

    async function walk(dir: string): Promise<void> {
      let entries: fsSync.Dirent[];
      try { entries = fsSync.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(dirAbs, full).replace(/\\/g, '/');
        if (entry.isDirectory()) {
          if (shouldSkipSearchPath(rel, entry.name, { excludes, gitignoreRules })) { filesSkipped += 1; continue; }
          await walk(full);
        } else if (entry.isFile()) {
          if (shouldSkipSearchPath(rel, entry.name, { excludes, gitignoreRules })) { filesSkipped += 1; continue; }
          if (!args.include_lockfiles && /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/i.test(rel)) { filesSkipped += 1; continue; }
          if (!matchesGlobList(rel, globs)) continue;
          let content: string;
          try { content = await fs.readFile(full, 'utf-8'); } catch { continue; }
          filesSearched += 1;
          const grep = collectGrepMatchesInText(rel || entry.name, content, matcher, {
            maxResults: Math.max(1, storeLimit - results.length),
            contextLines: ctx,
            before: Number(args.before) || 40,
            after: Number(args.after) || 80,
            charBefore: Number(args.char_before) || undefined,
            charAfter: Number(args.char_after) || undefined,
            charWindow: Number(args.char_window) || undefined,
          });
          totalMatches += grep.totalMatches;
          if (results.length < storeLimit) {
            results.push(...grep.matches.slice(0, Math.max(0, storeLimit - results.length)));
          }
        }
      }
    }

    await walk(dirAbs);
    const sorted = results.sort(compareGrepMatches(args.pattern)).slice(0, maxResults);
    return {
      success: true,
      data: {
        directory: dirAbs,
        pattern: args.pattern,
        search_mode: matcher.mode,
        files_searched: filesSearched,
        files_skipped: filesSkipped,
        match_count: totalMatches,
        returned_count: sorted.length,
        truncated_count: Math.max(0, totalMatches - sorted.length),
        result_limit: {
          requested: requestedMaxResults,
          applied: maxResults,
          context_lines: ctx,
          limit_reached: totalMatches > sorted.length,
          note: 'Result payloads are hard-clamped. Narrow directory, glob, or pattern to inspect more matches.',
        },
        no_match_hints: totalMatches === 0 ? buildNoMatchHints({ pattern: args.pattern, searched: args.directory || '.', mode: matcher.mode, excluded: Array.from(excludes) }) : undefined,
        matches: sorted,
      },
    };
  } catch (err: any) {
    return { success: false, error: `search_files failed: ${err.message}` };
  }
}

export const searchFilesTool = {
  name: 'search_files',
  description: 'Multi-file grep across a workspace directory. Finds all files containing a pattern. Critical for finding all callers of a function before changing it.',
  execute: executeSearchFiles,
  schema: {
    directory: 'string (optional) - Directory to search (default: workspace root)',
    pattern: 'string (required) - Regex or literal pattern',
    file_glob: 'string (optional) - Comma-separated file globs e.g. "*.md,*.ts" (default: all files)',
    context_lines: 'number (optional) - Lines of context around each match (default 0, hard cap 3)',
    char_window: 'number (optional) - Character window around each match for long/minified physical lines',
    case_insensitive: 'boolean (optional) - Case-insensitive match (default false)',
    max_results: 'number (optional) - Max total matches (default 50, hard cap 80)',
  },
};

// ── FILE STATS ────────────────────────────────────────────────────────────────
export interface FileStatsArgs { path: string; query?: string; }
export async function executeFileStats(args: FileStatsArgs): Promise<ToolResult> {
  try {
    const abs = resolveWorkspacePath(args.path);
    const pathCheck = isPathAllowed(abs);
    if (!pathCheck.allowed) return { success: false, error: pathCheck.reason };
    const st = await fs.stat(abs);
    if (!st.isFile()) return { success: false, error: `Not a file: ${abs}` };
    const content = await fs.readFile(abs, 'utf-8');
    const mode = getRetrievalMode();
    const cap = retrievalMaxLines(mode);
    const info = buildFileIntelligence(args.path, content, st, {
      readCap: cap,
      query: args.query ? String(args.query) : undefined,
    });
    return {
      success: true,
      data: { path: abs, ...info },
      stdout: formatFileIntelligence(info),
    };
  } catch (err: any) {
    return { success: false, error: `file_stats failed: ${err.message}` };
  }
}

export const fileStatsTool = {
  name: 'file_stats',
  description: 'Get metadata for a workspace file: line count, byte size, last modified. Use before read_file on unknown files to decide whether to read all at once or in chunks.',
  execute: executeFileStats,
  schema: {
    path: 'string (required) - Path to the file',
  },
};

// ── VALIDATE FILE SYNTAX ─────────────────────────────────────────────────────
export interface ValidateFileSyntaxArgs { path?: string; filename?: string; file?: string; }
export async function executeValidateFileSyntax(args: ValidateFileSyntaxArgs): Promise<ToolResult> {
  try {
    const inputPath = String(args.path || args.filename || args.file || '').trim();
    if (!inputPath) return { success: false, error: 'path is required' };
    const abs = resolveWorkspacePath(inputPath);
    const pathCheck = isPathAllowed(abs);
    if (!pathCheck.allowed) return { success: false, error: pathCheck.reason };
    const st = await fs.stat(abs);
    if (!st.isFile()) return { success: false, error: `Not a file: ${abs}` };
    const content = await fs.readFile(abs, 'utf-8');
    const validation = validateFileSyntax(inputPath, content);
    return {
      success: validation.supported ? validation.ok : true,
      data: validation,
      stdout: formatSyntaxValidationResult(validation),
      error: validation.supported && !validation.ok ? 'Syntax validation failed' : undefined,
    };
  } catch (err: any) {
    return { success: false, error: `validate_file failed: ${err.message}` };
  }
}

export const validateFileSyntaxTool = {
  name: 'validate_file',
  description: 'Syntax-validate a workspace HTML/JS/TS file. For HTML, extracts inline <script> blocks and reports parse errors at original file line/column coordinates.',
  execute: executeValidateFileSyntax,
  schema: {
    path: 'string (required) - Path to the file',
  },
};

// ── GREP FILES (legacy alias → search_files) ─────────────────────────────────
// grep_files was defined in tool defs but never implemented. Route it through
// executeSearchFiles so existing references and subagent profiles still work.
export async function executeGrepFiles(args: {
  pattern: string;
  path?: string;
  glob?: string;
  case_insensitive?: boolean;
  context?: number;
  max_results?: number;
  regex?: boolean;
  literal?: boolean;
  before?: number;
  after?: number;
  exclude?: string;
  gitignore?: boolean;
  respect_gitignore?: boolean;
  include_lockfiles?: boolean;
}): Promise<ToolResult> {
  return executeSearchFiles({
    directory: args.path,
    pattern: args.pattern,
    file_glob: args.glob,
    case_insensitive: args.case_insensitive,
    context_lines: args.context,
    max_results: args.max_results,
    regex: args.regex,
    literal: args.literal,
    before: args.before,
    after: args.after,
    exclude: args.exclude,
    gitignore: args.gitignore,
    respect_gitignore: args.respect_gitignore,
    include_lockfiles: args.include_lockfiles,
  });
}

export const grepFilesTool = {
  name: 'grep_files',
  description: 'Multi-file search across workspace (alias for search_files). Use search_files for new code.',
  execute: executeGrepFiles,
  schema: {
    pattern: 'string (required) - Regex or literal pattern',
    path: 'string (optional) - Subdirectory to search',
    glob: 'string (optional) - File glob filter e.g. "*.md"',
    case_insensitive: 'boolean (optional)',
    context: 'number (optional) - Context lines around match',
    max_results: 'number (optional)',
  },
};

// ── APPLY PATCH ────────────────────────────────────────────────────────────────
export interface ApplyPatchArgs {
  patch: string;
  check?: boolean;
}

export async function executeApplyPatch(args: ApplyPatchArgs): Promise<ToolResult> {
  const patchText = String(args?.patch || '');
  if (!patchText.trim()) {
    return { success: false, error: 'patch is required (unified diff string).' };
  }

  const workspacePath = resolveWorkspaceRoot();
  const targetPaths = extractPatchTargetPaths(patchText);
  const validation = validatePatchPaths(targetPaths, workspacePath);
  if (!validation.ok) return { success: false, error: validation.error };
  const gitRootError = await validateGitApplyRoot(workspacePath);
  if (gitRootError) return { success: false, error: `apply_patch refused: ${gitRootError}` };

  const tempPatchPath = path.join(
    os.tmpdir(),
    `prometheus-apply-${Date.now()}-${Math.random().toString(36).slice(2)}.patch`
  );

  try {
    await fs.writeFile(tempPatchPath, patchText, 'utf-8');
    const checked = await runGitApply(workspacePath, ['apply', '--check', '--whitespace=nowarn', '--recount', '--verbose', tempPatchPath]);
    const checkedOutput = [checked.stdout, checked.stderr].filter(Boolean).join('\n');
    const skippedOnCheck = countSkippedPatches(checkedOutput);
    if (skippedOnCheck >= validation.relativePaths.length) {
      const msg = truncateOutput(checkedOutput) || 'Patch check skipped all target files.';
      return { success: false, error: `apply_patch check failed: ${msg}` };
    }

    if (args.check === true) {
      return {
        success: true,
        data: {
          checked_only: true,
          files: validation.relativePaths,
          file_count: validation.relativePaths.length,
        },
        stdout: `Patch check passed for ${validation.relativePaths.length} file(s).`,
      };
    }

    // Recheck immediately before mutation so a link introduced between the
    // initial validation and `git apply --check` cannot silently redirect it.
    const finalValidation = validatePatchPaths(targetPaths, workspacePath);
    if (!finalValidation.ok) {
      return { success: false, error: `apply_patch refused before mutation: ${finalValidation.error}` };
    }

    const snapshots = validation.relativePaths.map((relPath) => {
      const absPath = path.resolve(workspacePath, relPath);
      return snapshotBeforeMutation(absPath, 'apply_patch', relPath, workspacePath);
    });
    const applied = await runGitApply(workspacePath, ['apply', '--whitespace=nowarn', '--recount', '--verbose', tempPatchPath]);
    const rawOutput = [applied.stdout, applied.stderr].filter(Boolean).join('\n');
    const skippedOnApply = countSkippedPatches(rawOutput);
    if (skippedOnApply >= validation.relativePaths.length) {
      const msg = truncateOutput(rawOutput) || 'Patch apply skipped all target files.';
      return { success: false, error: `apply_patch failed: ${msg}` };
    }
    const output = truncateOutput(rawOutput);

    return withWorkspaceSnapshots({
      success: true,
      data: {
        files: validation.relativePaths,
        file_count: validation.relativePaths.length,
      },
      stdout: output || `Patch applied to ${validation.relativePaths.length} file(s).`,
    }, snapshots);
  } catch (err: any) {
    const details = truncateOutput(String(err?.stderr || err?.stdout || err?.message || err || 'unknown error'));
    return { success: false, error: `apply_patch failed: ${details}` };
  } finally {
    await fs.unlink(tempPatchPath).catch(() => {});
  }
}

export const applyPatchTool = {
  name: 'apply_patch',
  description: 'Apply a unified diff patch to workspace files',
  execute: executeApplyPatch,
  schema: {
    patch: 'string (required) - Unified diff patch text',
    check: 'boolean (optional) - Validate patch only without applying it',
  }
};

// ── READ FILES BATCH ──────────────────────────────────────────────────────────
export interface ReadFilesBatchEntry {
  filename: string;
  start_line?: number;
  num_lines?: number;
  full?: boolean;
  allow_large?: boolean;
}
export interface ReadFilesBatchArgs {
  files: ReadFilesBatchEntry[];
  max_files?: number;
  max_lines_per_file?: number;
  num_lines?: number;
  full?: boolean;
  allow_large?: boolean;
  content?: boolean;
  include_content?: boolean;
  mode?: 'summary' | 'content';
  query?: string;
  inline?: boolean;
  no_spool?: boolean;
}

export async function executeReadFilesBatch(args: ReadFilesBatchArgs): Promise<ToolResult> {
  if (!Array.isArray(args.files) || !args.files.length) {
    return { success: false, error: 'files array is required and must not be empty' };
  }
  const maxFiles = Math.max(1, Math.min(FILE_TOOL_MAX_BATCH_FILES, Math.floor(Number(args.max_files) || FILE_TOOL_DEFAULT_BATCH_FILES)));
  const cap = Math.max(1, Math.min(FILE_TOOL_MAX_BATCH_LINES, Math.floor(Number(args.max_lines_per_file) || Number(args.num_lines) || FILE_TOOL_DEFAULT_BATCH_LINES)));
  const metadata: Array<{ filename: string; line_count?: number; truncated?: boolean; next_start_line?: number; error?: string }> = [];
  const chunks: string[] = [];
  const summaryLines: string[] = [];
  const forceContent = args.content === true || args.include_content === true || String(args.mode || '').toLowerCase() === 'content';
  const forceSummary = args.content === false || String(args.mode || '').toLowerCase() === 'summary';
  for (const entry of args.files.slice(0, maxFiles)) {
    const filename = entry?.filename || (entry as any)?.name;
    if (!filename) {
      metadata.push({ filename: String(filename || ''), error: 'filename is required' });
      chunks.push('--- [missing filename] ---\nERROR: filename is required');
      summaryLines.push('missing filename: error');
      continue;
    }
    try {
      const absPath = resolveWorkspacePath(String(filename));
      const pathCheck = isPathAllowed(absPath);
      if (!pathCheck.allowed) {
        metadata.push({ filename: String(filename), error: pathCheck.reason });
        chunks.push(`--- ${String(filename)} ---\nERROR: ${pathCheck.reason}`);
        summaryLines.push(`${String(filename)}: error`);
        continue;
      }
      const stat = await fs.stat(absPath);
      if (stat.isDirectory()) {
        metadata.push({ filename: String(filename), error: 'batch_read only reads files' });
        chunks.push(`${String(filename)}/ [directory; batch_read only reads files]`);
        summaryLines.push(`${String(filename)}: directory`);
        continue;
      }
      const content = await fs.readFile(absPath, 'utf-8');
      const allLines = content.split('\n');
      const startLine = Math.max(1, Number(entry.start_line || 1) || 1);
      const allowFull = entry.full === true || entry.allow_large === true || args.full === true || args.allow_large === true;
      const hasWindow = entry.start_line !== undefined || entry.num_lines !== undefined || args.num_lines !== undefined;
      const summaryOnly = forceSummary || (!forceContent && !hasWindow && !allowFull);
      if (summaryOnly) {
        metadata.push({ filename: String(filename), line_count: allLines.length, truncated: false });
        chunks.push(summarizeFileForTool(String(filename), absPath, {
          readCap: cap,
          query: args.query ? String(args.query) : undefined,
        }));
        summaryLines.push(`${String(filename)}: summary`);
        continue;
      }
      const requested = Math.max(1, Number(entry.num_lines || (allowFull ? allLines.length : cap)) || cap);
      const window = allowFull ? requested : Math.min(requested, cap);
      const startIdx = Math.max(0, startLine - 1);
      const selected = allLines.slice(startIdx, startIdx + window);
      const numbered = selected.map((l, i) => `${startLine + i}: ${trimReturnedFileLine(l)}`).join('\n');
      const endLine = startLine + selected.length - 1;
      const truncated = endLine < allLines.length;
      const header = `--- ${filename} (${allLines.length} lines)` +
        (startLine > 1 || truncated ? ` [lines ${startLine}-${endLine}${truncated ? ', truncated' : ''}]` : '') + ' ---';
      metadata.push({ filename: String(filename), line_count: allLines.length, truncated, next_start_line: truncated ? endLine + 1 : undefined });
      chunks.push(`${header}\n${numbered}${truncated ? `\n[READ_DEFAULT_CAP] Batch reads default to ${cap} lines per file. Use start_line:${endLine + 1}, num_lines:${cap} for the next chunk, or full:true only when needed.` : ''}`);
      summaryLines.push(`${String(filename)}: lines ${startLine}-${endLine}${truncated ? ' truncated' : ''}`);
    } catch (err: any) {
      metadata.push({ filename: String(filename), error: err.message });
      chunks.push(`--- ${String(filename)} ---\nERROR: ${err.message}`);
      summaryLines.push(`${String(filename)}: error`);
    }
  }
  if (args.files.length > maxFiles) {
    metadata.push({ filename: '[batch truncated]', error: `Only first ${maxFiles} files read. Re-run with remaining files if needed.` });
    chunks.push(`--- [batch truncated] ---\nOnly first ${maxFiles} files read. Re-run with remaining files if needed.`);
    summaryLines.push(`[batch truncated]: ${args.files.length - maxFiles} file(s) omitted`);
  }
  const rendered = chunks.join('\n\n');
  const spooled = await maybeSpoolToolStdout('read_files_batch', rendered, resolveResultCharBudget(args, FILE_TOOL_BATCH_INLINE_LIMIT_CHARS), {
    allowInline: args.inline === true || args.no_spool === true,
    summary: `read_files_batch returned ${Math.min(args.files.length, maxFiles)} file entry result(s):\n${summaryLines.join('\n')}`,
  });
  return {
    success: true,
    data: { file_count: metadata.length, results: metadata },
    stdout: spooled.stdout,
    ...(spooled.artifacts ? { artifacts: spooled.artifacts } : {}),
  };
}

export const readFilesBatchTool = {
  name: 'read_files_batch',
  description: 'Read multiple workspace files cheaply. Summary-first by default; pass exact line windows or content:true for capped content. Defaults to first 80 lines per content file and first 2 files.',
  execute: executeReadFilesBatch,
  schema: {
    files: 'array (required) - Each item: { filename: string, start_line?: number, num_lines?: number }',
    max_files: 'number (optional) - Default 2, max 8',
    max_lines_per_file: 'number (optional) - Default 80, max 240',
    content: 'boolean (optional) - Return capped content for entries without explicit windows. Default false/summary-only.',
    mode: 'string (optional) - summary or content',
    inline: 'boolean (optional) - Keep large output inline instead of saving a temp artifact',
  },
};

// ── APPLY WORKSPACE PATCHSET ─────────────────────────────────────────────────
export interface WorkspacePatchEdit {
  filename: string;
  op: 'find_replace' | 'replace_lines' | 'insert_after' | 'delete_lines' | 'write_file' | 'create_file';
  find?: string;
  replace?: string;
  replace_all?: boolean;
  start_line?: number;
  end_line?: number;
  new_content?: string;
  after_line?: number;
  content?: string;
}
export interface ApplyWorkspacePatchsetArgs {
  edits: WorkspacePatchEdit[];
}

function normalizeWorkspacePatchOp(value: unknown): WorkspacePatchEdit['op'] | string {
  const op = String(value || '').trim().toLowerCase();
  const aliases: Record<string, WorkspacePatchEdit['op'] | string> = {
    create: 'create_file',
    create_file: 'create_file',
    write: 'write_file',
    write_file: 'write_file',
    overwrite: 'write_file',
    find_replace: 'find_replace',
    replace: 'find_replace',
    replace_text: 'find_replace',
    replace_lines: 'replace_lines',
    line_replace: 'replace_lines',
    insert_after: 'insert_after',
    insert: 'insert_after',
    delete_lines: 'delete_lines',
    delete: 'delete_lines',
    remove_lines: 'delete_lines',
  };
  return aliases[op] || op;
}

export async function executeApplyWorkspacePatchset(args: ApplyWorkspacePatchsetArgs): Promise<ToolResult> {
  if (!Array.isArray(args.edits) || !args.edits.length) {
    return { success: false, error: 'edits array is required and must not be empty' };
  }
  const results: Array<{ filename: string; op: string; ok: boolean; result?: string; error?: string }> = [];
  const snapshots: Array<ReturnType<typeof snapshotBeforeMutation>> = [];
  for (const rawEdit of args.edits) {
    const edit: any = rawEdit && typeof rawEdit === 'object' ? rawEdit : {};
    const filename = edit?.filename ?? edit?.path ?? edit?.file ?? edit?.name;
    const op = normalizeWorkspacePatchOp(edit?.op ?? edit?.action ?? edit?.type);
    if (!filename || !op) { results.push({ filename: String(filename || ''), op, ok: false, error: 'filename and op are required' }); continue; }
    try {
      const absPath = resolveWorkspacePath(String(filename));
      const pathCheck = isPathAllowed(absPath);
      if (!pathCheck.allowed) { results.push({ filename: String(filename), op, ok: false, error: pathCheck.reason }); continue; }

      if (op === 'create_file') {
        const c = String(edit.content ?? '');
        if (fsSync.existsSync(absPath)) { results.push({ filename: String(filename), op, ok: false, error: `File already exists. Use write_file to overwrite.` }); continue; }
        snapshots.push(snapshotBeforeMutation(absPath, 'patchset:create_file', String(filename)));
        await fs.mkdir(path.dirname(absPath), { recursive: true });
        await fs.writeFile(absPath, c, 'utf-8');
        results.push({ filename: String(filename), op, ok: true, result: formatPostEditContext(String(filename), c, 1, Math.max(1, c.split('\n').length), `Created ${filename}.`) });

      } else if (op === 'write_file') {
        const c = String(edit.content ?? '');
        snapshots.push(snapshotBeforeMutation(absPath, 'patchset:write_file', String(filename)));
        await fs.mkdir(path.dirname(absPath), { recursive: true });
        await fs.writeFile(absPath, c, 'utf-8');
        results.push({ filename: String(filename), op, ok: true, result: formatPostEditContext(String(filename), c, 1, Math.max(1, Math.min(8, c.split('\n').length)), `Wrote ${filename}.`) });

      } else if (op === 'find_replace') {
        const findStr = String(edit.find ?? edit.old_text ?? edit.oldText ?? '');
        const replaceStr = String(edit.replace ?? edit.new_text ?? edit.newText ?? '');
        if (!findStr) { results.push({ filename: String(filename), op, ok: false, error: 'find is required' }); continue; }
        const content = await fs.readFile(absPath, 'utf-8');
        if (!content.includes(findStr)) { results.push({ filename: String(filename), op, ok: false, error: `Text not found: "${findStr.slice(0, 60)}"` }); continue; }
        const newContent = edit.replace_all
          ? content.split(findStr).join(replaceStr)
          : content.replace(findStr, replaceStr);
        snapshots.push(snapshotBeforeMutation(absPath, 'patchset:find_replace', String(filename)));
        await fs.writeFile(absPath, newContent, 'utf-8');
        const startLine = lineNumberAtOffset(content, content.indexOf(findStr));
        const replacementLines = Math.max(1, replaceStr.replace(/\r\n/g, '\n').split('\n').length);
        results.push({ filename: String(filename), op, ok: true, result: formatPostEditContext(String(filename), newContent, startLine, Math.max(startLine, startLine + replacementLines - 1), `Updated ${filename}: find_replace applied.`) });

      } else if (op === 'replace_lines') {
        const startL = Math.max(1, Number(edit.start_line ?? edit.startLine) || 1);
        const endL = Math.max(startL, Number(edit.end_line ?? edit.endLine) || startL);
        const newContent = String(edit.new_content ?? edit.content ?? '');
        const content = await fs.readFile(absPath, 'utf-8');
        const lines = content.split('\n');
        const newLines = newContent.split('\n');
        lines.splice(startL - 1, endL - startL + 1, ...newLines);
        const updated = lines.join('\n');
        snapshots.push(snapshotBeforeMutation(absPath, 'patchset:replace_lines', String(filename)));
        await fs.writeFile(absPath, updated, 'utf-8');
        results.push({ filename: String(filename), op, ok: true, result: formatPostEditContext(String(filename), updated, startL, Math.max(startL, startL + newLines.length - 1), `Updated ${filename}: replaced lines ${startL}-${endL}.`) });

      } else if (op === 'insert_after') {
        const afterL = Math.max(0, Number(edit.after_line ?? edit.afterLine) || 0);
        const ins = String(edit.content ?? edit.new_content ?? '');
        const content = await fs.readFile(absPath, 'utf-8');
        const lines = content.split('\n');
        const newLines = ins.split('\n');
        lines.splice(afterL, 0, ...newLines);
        const updated = lines.join('\n');
        snapshots.push(snapshotBeforeMutation(absPath, 'patchset:insert_after', String(filename)));
        await fs.writeFile(absPath, updated, 'utf-8');
        results.push({ filename: String(filename), op, ok: true, result: formatPostEditContext(String(filename), updated, afterL + 1, Math.max(afterL + 1, afterL + newLines.length), `Updated ${filename}: inserted after line ${afterL}.`) });

      } else if (op === 'delete_lines') {
        const startL = Math.max(1, Number(edit.start_line ?? edit.startLine) || 1);
        const endL = Math.max(startL, Number(edit.end_line ?? edit.endLine) || startL);
        const content = await fs.readFile(absPath, 'utf-8');
        const lines = content.split('\n');
        lines.splice(startL - 1, endL - startL + 1);
        const updated = lines.join('\n');
        snapshots.push(snapshotBeforeMutation(absPath, 'patchset:delete_lines', String(filename)));
        await fs.writeFile(absPath, updated, 'utf-8');
        results.push({ filename: String(filename), op, ok: true, result: formatPostEditContext(String(filename), updated, Math.min(startL, Math.max(1, lines.length)), Math.min(startL, Math.max(1, lines.length)), `Updated ${filename}: deleted lines ${startL}-${endL}.`) });

      } else {
        results.push({ filename: String(filename), op, ok: false, error: `Unknown op: ${op}` });
      }
    } catch (err: any) {
      results.push({ filename: String(filename), op, ok: false, error: err.message });
    }
  }
  const failed = results.filter(r => !r.ok);
  return withWorkspaceSnapshots({
    success: failed.length === 0,
    data: { edit_count: results.length, results },
    stdout: results.map(r => r.ok
      ? `✅ [${r.op}] ${r.filename}\n${r.result || ''}`.trim()
      : `❌ [${r.op}] ${r.filename}${r.error ? ': ' + r.error : ''}`
    ).join('\n\n'),
    ...(failed.length ? { error: `${failed.length}/${results.length} edits failed` } : {}),
  }, failed.length === 0 ? snapshots : []);
}

export const applyWorkspacePatchsetTool = {
  name: 'apply_workspace_patchset',
  description: 'Apply multiple file edits atomically. Supports find_replace, replace_lines, insert_after, delete_lines, write_file, create_file. Returns per-edit results.',
  execute: executeApplyWorkspacePatchset,
  schema: {
    edits: 'array (required) - Each: { filename, op, ...op-specific fields }',
  },
};

// ── FILE TREE ─────────────────────────────────────────────────────────────────
export interface FileTreeArgs {
  path?: string;
  max_depth?: number;
  max_entries?: number;
  glob?: string;
  exclude?: string;
  map?: boolean;
  max_result_tokens?: number;
  hard_max_result_tokens?: number;
  inline?: boolean;
  no_spool?: boolean;
}

export async function executeFileTree(args: FileTreeArgs): Promise<ToolResult> {
  try {
    const rootAbs = resolveWorkspacePath(args.path || '.');
    const pathCheck = isPathAllowed(rootAbs);
    if (!pathCheck.allowed) return { success: false, error: pathCheck.reason };
    const maxDepth = Math.max(1, Math.min(8, Number(args.max_depth || FILE_TOOL_DEFAULT_TREE_DEPTH) || FILE_TOOL_DEFAULT_TREE_DEPTH));
    const maxEntries = Math.max(1, Math.min(1000, Number(args.max_entries || FILE_TOOL_DEFAULT_TREE_ENTRIES) || FILE_TOOL_DEFAULT_TREE_ENTRIES));
    const defaultExclude = DEFAULT_FILE_TOOL_EXCLUDES;
    const excludeRaw = String(args.exclude || '').trim();
    const excludeNames = new Set<string>([
      ...defaultExclude,
      ...(excludeRaw ? excludeRaw.split(',').map((s: string) => s.trim()).filter(Boolean) : []),
    ]);
    const globRaw = String(args.glob || '').trim().toLowerCase();
    const globs = globRaw ? globRaw.split(',').map((g: string) => g.trim()).filter(Boolean) : [];

    function matchesGlob(name: string): boolean {
      if (!globs.length) return true;
      const low = name.toLowerCase();
      return globs.some((g: string) => {
        if (g.startsWith('*.')) return low.endsWith(g.slice(1));
        if (g.includes('*')) return low.includes(g.replace(/\*/g, ''));
        return low === g;
      });
    }

    const lines: string[] = [];
    const rootLabel = args.path || '.';
    lines.push(rootLabel + '/');
    let entryCount = 0;
    let truncated = false;
    const pushEntry = (line: string): boolean => {
      if (entryCount >= maxEntries) {
        truncated = true;
        return false;
      }
      lines.push(line);
      entryCount += 1;
      return true;
    };

    function walk(dir: string, depth: number, prefix: string): void {
      if (depth > maxDepth) return;
      let entries: fsSync.Dirent[];
      try { entries = fsSync.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      entries = entries.filter(e => !excludeNames.has(e.name));
      entries.sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      for (let i = 0; i < entries.length; i++) {
        if (truncated) return;
        const e = entries[i];
        const isLast = i === entries.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        const childPrefix = isLast ? '    ' : '│   ';
        if (e.isDirectory()) {
          if (!pushEntry(`${prefix}${connector}${e.name}/`)) return;
          walk(path.join(dir, e.name), depth + 1, prefix + childPrefix);
        } else {
          if (!globs.length || matchesGlob(e.name)) {
            if (!pushEntry(`${prefix}${connector}${e.name}`)) return;
          }
        }
      }
    }

    walk(rootAbs, 1, '');
    if (truncated) {
      lines.push(`[TREE_TRUNCATED] Returned first ${entryCount} entries. Narrow path/glob or pass max_depth/max_entries when you truly need more.`);
    }
    const repoHeader = args.map === false ? '' : buildRepoMapHeader(rootAbs, String(rootLabel || '.'), { excludes: Array.from(excludeNames) });
    const rendered = `${repoHeader ? `${repoHeader}\n\n` : ''}${lines.join('\n')}`;
    const spooled = await maybeSpoolToolStdout('file_tree', rendered, resolveResultCharBudget(args, FILE_TOOL_TREE_INLINE_LIMIT_CHARS), {
      allowInline: args.inline === true || args.no_spool === true,
      summary: `file_tree ${args.path || '.'} returned ${entryCount} entries and exceeded inline budget.`,
    });
    return {
      success: true,
      stdout: spooled.stdout,
      data: { root: rootAbs, max_depth: maxDepth, max_entries: maxEntries, truncated },
      ...(spooled.artifacts ? { artifacts: spooled.artifacts } : {}),
    };
  } catch (err: any) {
    return { success: false, error: `file_tree failed: ${err.message}` };
  }
}

export const fileTreeTool = {
  name: 'file_tree',
  description: 'Return a compact indented tree of files and folders. Cleaner than list_directory for orientation.',
  execute: executeFileTree,
  schema: {
    path: 'string (optional) - Root path (default workspace root)',
    max_depth: 'number (optional) - Max recursion depth (default 2, max 8)',
    max_entries: 'number (optional) - Max entries returned (default 180, max 1000)',
    glob: 'string (optional) - Comma-separated file globs to filter output',
    exclude: 'string (optional) - Comma-separated names to exclude (defaults include node_modules,.git,dist,build,generated,temp,logs)',
  },
};
