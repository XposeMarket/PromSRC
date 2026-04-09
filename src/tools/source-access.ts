/**
 * source-access.ts — Read-Only Access to Prometheus Source Code
 *
 * Gives the AI the ability to read its own source files for error analysis
 * and self-repair planning. Deliberately READ-ONLY — no writes, no deletes.
 *
 * All paths are resolved relative to src/ and clamped there (no traversal).
 * These tools are registered in registry.ts alongside all other tools.
 */

import fs from 'fs';
import path from 'path';
import { ToolResult } from '../types.js';

// ─── Path Resolution ──────────────────────────────────────────────────────────

function resolveSourceRoot(): string {
  // Works from both src/ (dev) and dist/ (compiled) contexts
  return path.resolve(__dirname, '..', '..', 'src');
}

function resolveSourcePath(relPath: string): string | null {
  const srcRoot = resolveSourceRoot();
  const resolved = path.resolve(srcRoot, relPath);
  // Security: clamp strictly inside src/
  if (!resolved.startsWith(srcRoot + path.sep) && resolved !== srcRoot) return null;
  return resolved;
}

function resolveWebUiRoot(): string {
  // Works from both src/ (dev) and dist/ (compiled) contexts
  return path.resolve(__dirname, '..', '..', 'web-ui');
}

function resolveWebUiPath(relPath: string): string | null {
  const webUiRoot = resolveWebUiRoot();
  const resolved = path.resolve(webUiRoot, relPath);
  // Security: clamp strictly inside web-ui/
  if (!resolved.startsWith(webUiRoot + path.sep) && resolved !== webUiRoot) return null;
  return resolved;
}

function formatSize(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

// ─── read_source ──────────────────────────────────────────────────────────────

export interface ReadSourceArgs {
  path: string;         // relative to src/ e.g. "gateway/telegram-channel.ts"
  start_line?: number;  // 1-based, default 1
  num_lines?: number;   // default 120, max 300
}

export async function executeReadSource(args: ReadSourceArgs): Promise<ToolResult> {
  if (!args?.path?.trim()) {
    return { success: false, error: 'path is required (relative to src/, e.g. "gateway/server-v2.ts")' };
  }

  const absPath = resolveSourcePath(args.path.trim());
  if (!absPath) {
    return { success: false, error: `Path escapes src/ directory: ${args.path}` };
  }

  if (!fs.existsSync(absPath)) {
    return { success: false, error: `Source file not found: src/${args.path}` };
  }

  const stat = fs.statSync(absPath);
  if (!stat.isFile()) {
    return { success: false, error: `Not a file: src/${args.path} — use list_source to browse directories` };
  }

  let content: string;
  try {
    content = fs.readFileSync(absPath, 'utf-8');
  } catch (err: any) {
    return { success: false, error: `Failed to read file: ${err.message}` };
  }

  const allLines = content.split('\n');
  const totalLines = allLines.length;
  const MAX_LINES = 300;
  const DEFAULT_LINES = 120;

  const startLine = Math.max(1, Number(args.start_line || 1) || 1);
  const numLines = Math.min(MAX_LINES, Math.max(1, Number(args.num_lines || DEFAULT_LINES) || DEFAULT_LINES));
  const startIdx = startLine - 1;
  const slice = allLines.slice(startIdx, startIdx + numLines);

  // Format with line numbers (matches how read_file works in workspace)
  const numbered = slice.map((line, i) => `${String(startLine + i).padStart(4)} | ${line}`).join('\n');

  return {
    success: true,
    data: {
      path: `src/${args.path}`,
      abs_path: absPath,
      total_lines: totalLines,
      file_size: formatSize(stat.size),
      window: {
        start_line: startLine,
        end_line: startLine + slice.length - 1,
        returned_lines: slice.length,
        truncated: totalLines > (startLine - 1 + numLines),
      },
      content: numbered,
    },
  };
}

export const readSourceTool = {
  name: 'read_source',
  description:
    'Read a Prometheus source file (READ-ONLY, src/ only). ' +
    'WHEN TO USE: Only when diagnosing a Prometheus error or planning a src/ change, and only after reading workspace/SELF.md first. ' +
    'DO NOT call this for general workspace file requests, user file tasks, or anything unrelated to Prometheus source code. ' +
    'Paths are relative to src/ e.g. "gateway/server-v2.ts". Returns numbered lines. Use start_line + num_lines to paginate.',
  execute: executeReadSource,
  schema: {
    path: 'string (required) — path relative to src/, e.g. "gateway/server-v2.ts" or "tools/files.ts"',
    start_line: 'number (optional) — 1-based start line, default 1',
    num_lines: 'number (optional) — lines to return, default 120, max 300',
  },
  jsonSchema: {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string', description: 'Path relative to src/, e.g. "gateway/server-v2.ts"' },
      start_line: { type: 'number', description: '1-based start line (default 1)' },
      num_lines: { type: 'number', description: 'Lines to return (default 120, max 300)' },
    },
    additionalProperties: false,
  },
};

// ─── list_source ──────────────────────────────────────────────────────────────

export interface ListSourceArgs {
  path?: string; // relative to src/, default "" = root of src/
}

export async function executeListSource(args: ListSourceArgs): Promise<ToolResult> {
  const relPath = (args?.path || '').trim();
  const absPath = relPath ? resolveSourcePath(relPath) : resolveSourceRoot();

  if (!absPath) {
    return { success: false, error: `Path escapes src/ directory: ${relPath}` };
  }

  if (!fs.existsSync(absPath)) {
    return { success: false, error: `Directory not found: src/${relPath || ''}` };
  }

  const stat = fs.statSync(absPath);
  if (!stat.isFile() && !stat.isDirectory()) {
    return { success: false, error: `Not a file or directory: src/${relPath}` };
  }

  // If it's actually a file, just describe it
  if (stat.isFile()) {
    return {
      success: true,
      data: {
        path: `src/${relPath}`,
        type: 'file',
        size: formatSize(stat.size),
        note: 'Use read_source to read this file',
      },
    };
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absPath, { withFileTypes: true });
  } catch (err: any) {
    return { success: false, error: `Failed to list directory: ${err.message}` };
  }

  const dirs = entries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort();

  const files = entries
    .filter(e => e.isFile())
    .map(e => {
      const size = formatSize(fs.statSync(path.join(absPath, e.name)).size);
      return { name: e.name, size };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const srcRoot = resolveSourceRoot();
  const displayPath = `src/${path.relative(srcRoot, absPath).replace(/\\/g, '/') || ''}`.replace(/\/$/, '');

  return {
    success: true,
    data: {
      path: displayPath,
      directories: dirs,
      files: files.map(f => `${f.name} (${f.size})`),
      total_entries: entries.length,
    },
  };
}

export const listSourceTool = {
  name: 'list_source',
  description:
    'List files and directories inside the Prometheus src/ folder (READ-ONLY, src/ only). ' +
    'WHEN TO USE: Only when diagnosing a Prometheus error or planning a src/ change, and only after reading workspace/SELF.md first. ' +
    'DO NOT call this for general workspace file requests or anything unrelated to Prometheus source code.',
  execute: executeListSource,
  schema: {
    path: 'string (optional) — subdirectory relative to src/, e.g. "gateway" or "tools". Omit for root.',
  },
  jsonSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Subdirectory relative to src/ (omit for root listing)' },
    },
    additionalProperties: false,
  },
};

// ─── source_stats ─────────────────────────────────────────────────────────────

export interface SourceStatsArgs {
  path: string; // relative to src/ e.g. "gateway/server-v2.ts"
}

export async function executeSourceStats(args: SourceStatsArgs): Promise<ToolResult> {
  if (!args?.path?.trim()) {
    return { success: false, error: 'path is required (relative to src/, e.g. "gateway/server-v2.ts")' };
  }

  const relPath = args.path.trim();
  const absPath = resolveSourcePath(relPath);
  if (!absPath) {
    return { success: false, error: `Path escapes src/ directory: ${relPath}` };
  }

  if (!fs.existsSync(absPath)) {
    return { success: false, error: `Source file not found: src/${relPath}` };
  }

  const stat = fs.statSync(absPath);
  if (!stat.isFile()) {
    return { success: false, error: `Not a file: src/${relPath}` };
  }

  let content: string;
  try {
    content = fs.readFileSync(absPath, 'utf-8');
  } catch (err: any) {
    return { success: false, error: `Failed to read file: ${err.message}` };
  }

  const lineCount = content.split('\n').length;
  const readCap = 300;

  return {
    success: true,
    data: {
      path: `src/${relPath}`,
      abs_path: absPath,
      line_count: lineCount,
      bytes: stat.size,
      file_size: formatSize(stat.size),
      last_modified: stat.mtime.toISOString(),
      is_large: lineCount > readCap,
      read_hint: lineCount > readCap
        ? `File has ${lineCount} lines (cap=${readCap}). Use read_source(path, start_line, num_lines) to read in chunks.`
        : `File fits in one read_source call (${lineCount} lines, cap=${readCap}).`,
    },
  };
}

export const sourceStatsTool = {
  name: 'source_stats',
  description:
    'Get metadata for a src/ file (READ-ONLY): line count, byte size, last modified, and whether chunked reads are recommended.',
  execute: executeSourceStats,
  schema: {
    path: 'string (required) — path relative to src/, e.g. "gateway/server-v2.ts"',
  },
  jsonSchema: {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string', description: 'Path relative to src/, e.g. "gateway/server-v2.ts"' },
    },
    additionalProperties: false,
  },
};

// ─── webui_source_stats ───────────────────────────────────────────────────────

export interface WebUiSourceStatsArgs {
  path: string; // relative to web-ui/ e.g. "src/pages/ChatPage.js"
}

export async function executeWebUiSourceStats(args: WebUiSourceStatsArgs): Promise<ToolResult> {
  if (!args?.path?.trim()) {
    return { success: false, error: 'path is required (relative to web-ui/, e.g. "src/pages/ChatPage.js")' };
  }

  const relPath = args.path.trim();
  const absPath = resolveWebUiPath(relPath);
  if (!absPath) {
    return { success: false, error: `Path escapes web-ui/ directory: ${relPath}` };
  }

  if (!fs.existsSync(absPath)) {
    return { success: false, error: `Web UI source file not found: web-ui/${relPath}` };
  }

  const stat = fs.statSync(absPath);
  if (!stat.isFile()) {
    return { success: false, error: `Not a file: web-ui/${relPath}` };
  }

  let content: string;
  try {
    content = fs.readFileSync(absPath, 'utf-8');
  } catch (err: any) {
    return { success: false, error: `Failed to read file: ${err.message}` };
  }

  const lineCount = content.split('\n').length;
  const readCap = 300;

  return {
    success: true,
    data: {
      path: `web-ui/${relPath}`,
      abs_path: absPath,
      line_count: lineCount,
      bytes: stat.size,
      file_size: formatSize(stat.size),
      last_modified: stat.mtime.toISOString(),
      is_large: lineCount > readCap,
      read_hint: lineCount > readCap
        ? `File has ${lineCount} lines (cap=${readCap}). Use read_webui_source(file, head/tail) or windowed reads.`
        : `File fits in one read_webui_source call (${lineCount} lines, cap=${readCap}).`,
    },
  };
}

export const webUiSourceStatsTool = {
  name: 'webui_source_stats',
  description:
    'Get metadata for a web-ui/ file (READ-ONLY): line count, byte size, last modified, and whether chunked reads are recommended.',
  execute: executeWebUiSourceStats,
  schema: {
    path: 'string (required) — path relative to web-ui/, e.g. "src/pages/ChatPage.js"',
  },
  jsonSchema: {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string', description: 'Path relative to web-ui/, e.g. "src/pages/ChatPage.js"' },
    },
    additionalProperties: false,
  },
};
