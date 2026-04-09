import fs from 'fs/promises';
import path from 'path';
import fsSync from 'fs';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getConfig } from '../config/config.js';
import { getActiveWorkspace, isPathInWorkspace } from './workspace-context.js';
import { ToolResult } from '../types.js';

const execFileAsync = promisify(execFile);
const PATCH_OUTPUT_MAX_CHARS = 8000;

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

function normalizePathForCompare(p: string): string {
  const resolved = path.resolve(String(p || ''));
  if (process.platform === 'win32') return resolved.toLowerCase();
  return resolved;
}

function isPathInside(basePath: string, targetPath: string): boolean {
  const base = normalizePathForCompare(basePath);
  const target = normalizePathForCompare(targetPath);
  if (!base || !target) return false;
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
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
  const isScopedRun = activeWorkspace !== path.resolve(globalWorkspace);

  // ── Workspace-scoped enforcement (subagents / team members) ──────────────
  // When running inside a scoped workspace, ONLY allow paths inside it.
  // This prevents any agent from escaping its own workspace directory.
  if (isScopedRun) {
    if (!isPathInWorkspace(activeWorkspace, absPath)) {
      return {
        allowed: false,
        reason: `[WORKSPACE ISOLATION] Path "${absPath}" is outside this agent's workspace (${activeWorkspace}). Agents may only read/write within their own workspace.`
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

function validatePatchPaths(paths: string[]): { ok: true; relativePaths: string[] } | { ok: false; error: string } {
  if (!Array.isArray(paths) || paths.length === 0) {
    return { ok: false, error: 'No target paths found in patch. Include standard unified diff headers (---/+++).' };
  }

  const unique = Array.from(new Set(paths.map(p => String(p || '').trim()).filter(Boolean)));
  for (const relPath of unique) {
    if (path.isAbsolute(relPath)) {
      return { ok: false, error: `Patch path must be relative: ${relPath}` };
    }
    const absPath = resolveWorkspacePath(relPath);
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
}

type RetrievalMode = 'fast' | 'standard' | 'deep';

function getLocalConfigFilePath(): string {
  const projectCfg = path.join(process.cwd(), '.prometheus', 'config.json');
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
  return 240;
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
    const mode = getRetrievalMode();
    const cap = retrievalMaxLines(mode);
    const startLine = Math.max(1, Number(args.start_line || 1) || 1);
    const requested = Math.max(1, Number(args.num_lines || cap) || cap);
    const window = Math.min(requested, cap);
    const startIdx = Math.max(0, startLine - 1);
    const selected = allLines.slice(startIdx, startIdx + window);
    const outContent = selected.join('\n');
    const endLine = startLine + selected.length - 1;
    const truncated = (allLines.length > selected.length) || startLine > 1 || requested > cap;
    return {
      success: true,
      data: {
        path: absPath,
        content: outContent,
        size: outContent.length,
        lines: allLines.length,
        window: {
          retrieval_mode: mode,
          start_line: startLine,
          end_line: endLine,
          returned_lines: selected.length,
          max_lines_cap: cap,
          truncated,
        },
      }
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
    // Ensure directory exists
    const dir = path.dirname(absPath);
    await fs.mkdir(dir, { recursive: true });
    // Write file
    await fs.writeFile(absPath, args.content, 'utf-8');
    return {
      success: true,
      data: {
        path: absPath,
        size: args.content.length,
        lines: args.content.split('\n').length
      }
    };
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
    const newContent = content.replace(args.old_str, args.new_str);
    // Write back
    await fs.writeFile(absPath, newContent, 'utf-8');
    return {
      success: true,
      data: {
        path: absPath,
        replacements: 1,
        old_length: content.length,
        new_length: newContent.length,
        diff: newContent.length - content.length
      }
    };
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
  if (!existsSync(absPath)) return { success: false, error: `Path does not exist: ${absPath}` };
  try {
    rmSync(absPath, { recursive: args.recursive ?? false, force: true });
    return { success: true, stdout: `Deleted: ${absPath}` };
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
    // Ensure destination dir
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rename(src, dest);
    return { success: true, data: { from: src, to: dest } };
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
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
    return { success: true, data: { from: src, to: dest } };
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
    await fs.mkdir(abs, { recursive: args.recursive ?? true });
    return { success: true, data: { path: abs } };
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
}
export async function executeGrepFile(args: GrepFileArgs): Promise<ToolResult> {
  try {
    const abs = resolveWorkspacePath(args.path);
    const pathCheck = isPathAllowed(abs);
    if (!pathCheck.allowed) return { success: false, error: pathCheck.reason };
    const content = await fs.readFile(abs, 'utf-8');
    const lines = content.split('\n');
    const flags = args.case_insensitive ? 'gi' : 'g';
    let regex: RegExp;
    try { regex = new RegExp(args.pattern, flags); }
    catch { return { success: false, error: `Invalid regex pattern: ${args.pattern}` }; }
    const ctx = Math.max(0, Math.min(10, Number(args.context_lines || 0)));
    const maxResults = Math.min(200, Math.max(1, Number(args.max_results || 100)));
    const matches: Array<{ line_number: number; line: string; context_before?: string[]; context_after?: string[] }> = [];
    for (let i = 0; i < lines.length; i++) {
      if (matches.length >= maxResults) break;
      // Reset lastIndex for global regex between test calls
      regex.lastIndex = 0;
      if (regex.test(lines[i])) {
        matches.push({
          line_number: i + 1,
          line: lines[i],
          ...(ctx > 0 ? {
            context_before: lines.slice(Math.max(0, i - ctx), i),
            context_after: lines.slice(i + 1, Math.min(lines.length, i + 1 + ctx)),
          } : {}),
        });
      }
    }
    return {
      success: true,
      data: { path: abs, pattern: args.pattern, match_count: matches.length, matches },
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
    context_lines: 'number (optional) - Lines of context around each match (default 0, max 10)',
    case_insensitive: 'boolean (optional) - Case-insensitive match (default false)',
    max_results: 'number (optional) - Max matches to return (default 100, max 200)',
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
}
export async function executeSearchFiles(args: SearchFilesArgs): Promise<ToolResult> {
  try {
    const dirAbs = resolveWorkspacePath(args.directory || '.');
    const pathCheck = isPathAllowed(dirAbs);
    if (!pathCheck.allowed) return { success: false, error: pathCheck.reason };
    const flags = args.case_insensitive ? 'gi' : 'g';
    let regex: RegExp;
    try { regex = new RegExp(args.pattern, flags); }
    catch { return { success: false, error: `Invalid regex pattern: ${args.pattern}` }; }
    const globPattern = (args.file_glob || '').toLowerCase().trim();
    const maxResults = Math.min(500, Math.max(1, Number(args.max_results || 100)));
    const ctx = Math.max(0, Math.min(5, Number(args.context_lines || 0)));
    const results: Array<{ file: string; line_number: number; line: string; context_before?: string[]; context_after?: string[] }> = [];

    function matchesGlob(filename: string): boolean {
      if (!globPattern) return true;
      const globs = globPattern.split(',').map((g: string) => g.trim()).filter(Boolean);
      return globs.some((g: string) => {
        if (g.startsWith('*.')) return filename.toLowerCase().endsWith(g.slice(1));
        return filename.toLowerCase().includes(g.replace(/\*/g, ''));
      });
    }

    async function walk(dir: string): Promise<void> {
      if (results.length >= maxResults) return;
      let entries: fsSync.Dirent[];
      try { entries = fsSync.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (results.length >= maxResults) break;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // Skip hidden dirs and node_modules
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          await walk(full);
        } else if (entry.isFile() && matchesGlob(entry.name)) {
          let content: string;
          try { content = await fs.readFile(full, 'utf-8'); } catch { continue; }
          const lines = content.split('\n');
          for (let i = 0; i < lines.length && results.length < maxResults; i++) {
            regex.lastIndex = 0;
            if (regex.test(lines[i])) {
              results.push({
                file: full,
                line_number: i + 1,
                line: lines[i],
                ...(ctx > 0 ? {
                  context_before: lines.slice(Math.max(0, i - ctx), i),
                  context_after: lines.slice(i + 1, Math.min(lines.length, i + 1 + ctx)),
                } : {}),
              });
            }
          }
        }
      }
    }

    await walk(dirAbs);
    return {
      success: true,
      data: { directory: dirAbs, pattern: args.pattern, match_count: results.length, matches: results },
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
    context_lines: 'number (optional) - Lines of context around each match (default 0, max 5)',
    case_insensitive: 'boolean (optional) - Case-insensitive match (default false)',
    max_results: 'number (optional) - Max total matches (default 100, max 500)',
  },
};

// ── FILE STATS ────────────────────────────────────────────────────────────────
export interface FileStatsArgs { path: string; }
export async function executeFileStats(args: FileStatsArgs): Promise<ToolResult> {
  try {
    const abs = resolveWorkspacePath(args.path);
    const pathCheck = isPathAllowed(abs);
    if (!pathCheck.allowed) return { success: false, error: pathCheck.reason };
    const st = await fs.stat(abs);
    if (!st.isFile()) return { success: false, error: `Not a file: ${abs}` };
    const content = await fs.readFile(abs, 'utf-8');
    const lineCount = content.split('\n').length;
    const mode = getRetrievalMode();
    const cap = retrievalMaxLines(mode);
    return {
      success: true,
      data: {
        path: abs,
        line_count: lineCount,
        bytes: st.size,
        last_modified: st.mtime.toISOString(),
        is_large: lineCount > cap,
        read_hint: lineCount > cap
          ? `File has ${lineCount} lines (cap=${cap}). Use read_file(path, start_line, num_lines) to read in chunks.`
          : `File fits in one read_file call (${lineCount} lines, cap=${cap}).`,
      },
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
}): Promise<ToolResult> {
  return executeSearchFiles({
    directory: args.path,
    pattern: args.pattern,
    file_glob: args.glob,
    case_insensitive: args.case_insensitive,
    context_lines: args.context,
    max_results: args.max_results,
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

  const targetPaths = extractPatchTargetPaths(patchText);
  const validation = validatePatchPaths(targetPaths);
  if (!validation.ok) return { success: false, error: validation.error };

  const workspacePath = getConfig().getConfig().workspace.path;
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

    const applied = await runGitApply(workspacePath, ['apply', '--whitespace=nowarn', '--recount', '--verbose', tempPatchPath]);
    const rawOutput = [applied.stdout, applied.stderr].filter(Boolean).join('\n');
    const skippedOnApply = countSkippedPatches(rawOutput);
    if (skippedOnApply >= validation.relativePaths.length) {
      const msg = truncateOutput(rawOutput) || 'Patch apply skipped all target files.';
      return { success: false, error: `apply_patch failed: ${msg}` };
    }
    const output = truncateOutput(rawOutput);

    return {
      success: true,
      data: {
        files: validation.relativePaths,
        file_count: validation.relativePaths.length,
      },
      stdout: output || `Patch applied to ${validation.relativePaths.length} file(s).`,
    };
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
