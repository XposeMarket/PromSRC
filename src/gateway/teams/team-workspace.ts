/**
 * team-workspace.ts — Shared Team Workspace
 *
 * Each managed team gets a shared workspace directory where subagents can
 * read and write files to pass data between each other.
 *
 * Storage layout:
 *   <globalWorkspace>/teams/<teamId>/workspace/   ← shared files agents read/write
 *   <globalWorkspace>/teams/<teamId>/workspace/.metadata.json ← file metadata (writtenBy, readBy, etc.)
 *
 * Design principles:
 *   - Agents write files using their normal write_file / create_file tools
 *     pointing to the team workspace path (injected via system prompt context)
 *   - Metadata is tracked separately so the UI can show which agent wrote which file
 *   - The workspace path is injected into each agent's system prompt when they run
 *   - Files are listed with size, modified time, written-by, read-by, and a short preview
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getConfig } from '../../config/config';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WorkspaceFileEntry {
  name: string;          // filename only, e.g. "news.json"
  relativePath: string;  // path relative to workspace root, e.g. "src/app/page.tsx"
  path: string;          // absolute path on disk
  size: number;          // bytes
  modifiedAt: number;    // unix ms
  createdAt: number;     // unix ms
  writtenBy?: string;    // agentId that last wrote this file
  readBy: string[];      // agentIds that have read this file (logged via touch)
  preview?: string;      // first ~200 chars of text content for UI display
  mimeHint: string;      // guessed type: json | markdown | text | csv | binary
  isDirectory?: false;   // always false for files (for type discrimination)
}

export interface WorkspaceDirEntry {
  name: string;          // directory name only, e.g. "src"
  relativePath: string;  // path relative to workspace root, e.g. "src/app"
  path: string;          // absolute path on disk
  modifiedAt: number;    // unix ms
  isDirectory: true;
  children: (WorkspaceFileEntry | WorkspaceDirEntry)[];
}

export type WorkspaceEntry = WorkspaceFileEntry | WorkspaceDirEntry;

export interface WorkspaceMetadata {
  files: Record<string, {
    writtenBy?: string;
    readBy: string[];
    createdAt: number;
  }>;
  updatedAt: number;
}

// ─── Paths ───────────────────────────────────────────────────────────────────

// ─── Per-Team Agent Identity Paths ──────────────────────────────────────────

/**
 * Returns the identity directory for a specific agent scoped to a specific team.
 * This is where system_prompt.md and agent-specific config live for that team.
 *
 * Layout: <globalWorkspace>/teams/<teamId>/agents/<agentId>/
 *
 * This ensures an agent reused across teams acts as a completely separate entity
 * in each team — different workspace, different identity, zero context bleed.
 */
export function getTeamAgentIdentityPath(teamId: string, agentId: string): string {
  const root = getTeamWorkspaceRoot();
  return path.join(root, sanitizeId(teamId), 'agents', sanitizeId(agentId));
}

/**
 * Ensures the per-team agent identity directory exists.
 * On first creation, bootstraps identity files from the global subagent workspace
 * (copies system_prompt.md, AGENTS.md, HEARTBEAT.md if they exist).
 * After that, the team-scoped files are independent and can diverge.
 *
 * Returns the identity path.
 */
export function ensureTeamAgentIdentity(
  teamId: string,
  agentId: string,
  globalAgentWorkspace: string,
): string {
  const identityPath = getTeamAgentIdentityPath(teamId, agentId);
  const firstTime = !fs.existsSync(identityPath);
  fs.mkdirSync(identityPath, { recursive: true });

  // Files to sync from the global subagent workspace.
  // These are identity files — copied once on first use, then re-synced if the
  // team-scoped copy is still empty/blank (e.g. the global file was updated after
  // the team was created, or the original copy was a blank template).
  const filesToSync = [
    'system_prompt.md',
    'AGENTS.md',
    'HEARTBEAT.md',
    'TOOLS.md',
  ];

  for (const filename of filesToSync) {
    const src = path.join(globalAgentWorkspace, filename);
    const dst = path.join(identityPath, filename);

    if (!fs.existsSync(src)) continue; // nothing to copy

    let srcContent = '';
    try { srcContent = fs.readFileSync(src, 'utf-8').trim(); } catch { continue; }
    if (!srcContent) continue; // source is blank — nothing useful to copy

    // Copy if: first time (dst doesn't exist), or dst exists but is empty/blank
    const dstMissing = !fs.existsSync(dst);
    let dstBlank = false;
    if (!dstMissing) {
      try { dstBlank = !fs.readFileSync(dst, 'utf-8').trim(); } catch { dstBlank = true; }
    }

    if (dstMissing || dstBlank) {
      try {
        fs.copyFileSync(src, dst);
      } catch {
        // Non-fatal — agent will work with whatever files exist
      }
    }
  }

  // Write/update marker so the UI/tooling can identify team-scoped identity dirs
  if (firstTime) {
    fs.writeFileSync(
      path.join(identityPath, '.team-identity.json'),
      JSON.stringify({ teamId, agentId, bootstrappedAt: Date.now() }, null, 2),
      'utf-8',
    );
  }

  return identityPath;
}

export function getTeamWorkspaceRoot(): string {
  const globalWorkspace = getConfig().getWorkspacePath() || process.cwd();
  return path.join(globalWorkspace, 'teams');
}

export function getTeamWorkspacePath(teamId: string): string {
  const root = getTeamWorkspaceRoot();
  return path.join(root, sanitizeId(teamId), 'workspace');
}

function getMetadataPath(teamId: string): string {
  return path.join(getTeamWorkspacePath(teamId), '.metadata.json');
}

function sanitizeId(id: string): string {
  return String(id || '').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 80);
}

// ─── Metadata ────────────────────────────────────────────────────────────────

export function loadWorkspaceMetadata(teamId: string): WorkspaceMetadata {
  const p = getMetadataPath(teamId);
  if (!fs.existsSync(p)) return { files: {}, updatedAt: 0 };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as WorkspaceMetadata;
  } catch {
    return { files: {}, updatedAt: 0 };
  }
}

function saveWorkspaceMetadata(teamId: string, meta: WorkspaceMetadata): void {
  const p = getMetadataPath(teamId);
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });
  meta.updatedAt = Date.now();
  const tmp = `${p}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
}

// ─── Workspace Initialization ─────────────────────────────────────────────────

// ─── Team Memory Files (purpose→task workflow) ────────────────────────────────
// Three lightweight JSON files in the team workspace that give the coordinator
// cross-run persistence without any schema changes.
//   memory.json    — accumulated knowledge across all runs
//   last_run.json  — what the most recent run did
//   pending.json   — items found but not yet acted on

export function initTeamMemoryFiles(teamId: string): void {
  const wsPath = getTeamWorkspacePath(teamId);
  fs.mkdirSync(wsPath, { recursive: true });

  const memoryPath = path.join(wsPath, 'memory.json');
  if (!fs.existsSync(memoryPath)) {
    fs.writeFileSync(memoryPath, JSON.stringify({
      _note: 'Cross-run accumulated knowledge. Add entries here so future runs build on prior work.',
      updatedAt: null,
      entries: [],
    }, null, 2), 'utf-8');
  }

  const lastRunPath = path.join(wsPath, 'last_run.json');
  if (!fs.existsSync(lastRunPath)) {
    fs.writeFileSync(lastRunPath, JSON.stringify({
      _note: 'What happened in the most recent run. Overwrite this at the end of each run.',
      runAt: null,
      task: null,
      summary: null,
      agentsUsed: [],
    }, null, 2), 'utf-8');
  }

  const pendingPath = path.join(wsPath, 'pending.json');
  if (!fs.existsSync(pendingPath)) {
    fs.writeFileSync(pendingPath, JSON.stringify({
      _note: 'Things found but not yet acted on. Add items; remove when resolved.',
      items: [],
    }, null, 2), 'utf-8');
  }
}

export function readTeamMemoryContext(teamId: string): string {
  const wsPath = getTeamWorkspacePath(teamId);
  const parts: string[] = [];
  for (const filename of ['memory.json', 'last_run.json', 'pending.json'] as const) {
    const filePath = path.join(wsPath, filename);
    if (!fs.existsSync(filePath)) continue;
    try {
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      parts.push(`[${filename}]\n${content.slice(0, 2000)}`);
    } catch { /* skip unreadable */ }
  }
  return parts.join('\n\n');
}

export function ensureTeamWorkspace(teamId: string): string {
  const wsPath = getTeamWorkspacePath(teamId);
  fs.mkdirSync(wsPath, { recursive: true });

  // Write a README the first time so agents know what this is
  const readmePath = path.join(wsPath, 'README.md');
  if (!fs.existsSync(readmePath)) {
    fs.writeFileSync(
      readmePath,
      `# Team Shared Workspace\n\nThis directory is the shared workspace for your team.\n\n` +
      `## How to use\n\n` +
      `- **Write files here** to pass data to other team members\n` +
      `- **Read files here** to consume data from other team members\n\n` +
      `## Example pipeline\n\n` +
      `1. Scraper agent writes \`news.json\` with headlines and URLs\n` +
      `2. Writer agent reads \`news.json\`, creates \`post.md\` with the draft post\n` +
      `3. Poster agent reads \`post.md\` and publishes it\n\n` +
      `## Path\n\n` +
      `\`${wsPath}\`\n`,
      'utf-8',
    );
  }
  return wsPath;
}

// ─── File Listing ─────────────────────────────────────────────────────────────

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp',
  'zip', 'gz', 'tar', 'rar', '7z',
  'exe', 'dll', 'so', 'dylib',
  'pdf', 'doc', 'docx', 'xls', 'xlsx',
  'mp3', 'mp4', 'avi', 'mov', 'mkv',
  'woff', 'woff2', 'ttf', 'eot',
]);

function guessMime(filename: string): string {
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  if (ext === 'json') return 'json';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'csv') return 'csv';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'js' || ext === 'ts' || ext === 'py' || ext === 'sh') return 'code';
  if (BINARY_EXTENSIONS.has(ext)) return 'binary';
  return 'text';
}

function safePreview(filePath: string, mimeHint: string, maxChars = 200): string | undefined {
  if (mimeHint === 'binary') return undefined;
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 1024 * 1024) return undefined; // skip >1MB files
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.slice(0, maxChars).replace(/\r\n/g, '\n');
  } catch {
    return undefined;
  }
}

/**
 * Recursively list workspace files and directories.
 * Returns a flat array of WorkspaceFileEntry (for backward compatibility)
 * where each entry includes its relative path from the workspace root.
 * Use listWorkspaceTree() for the nested tree structure.
 */
export function listWorkspaceFiles(teamId: string): WorkspaceFileEntry[] {
  const wsPath = getTeamWorkspacePath(teamId);
  if (!fs.existsSync(wsPath)) return [];
  const meta = loadWorkspaceMetadata(teamId);
  const entries: WorkspaceFileEntry[] = [];
  collectFiles(wsPath, wsPath, meta, entries);
  // Sort by most recently modified
  entries.sort((a, b) => b.modifiedAt - a.modifiedAt);
  return entries;
}

function collectFiles(
  rootPath: string,
  dirPath: string,
  meta: WorkspaceMetadata,
  out: WorkspaceFileEntry[],
): void {
  let dirEntries: fs.Dirent[];
  try {
    dirEntries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const dirent of dirEntries) {
    // Skip hidden files/dirs (.metadata.json, .gitignore, .git, etc.)
    if (dirent.name.startsWith('.')) continue;

    const fullPath = path.join(dirPath, dirent.name);
    const relPath = path.relative(rootPath, fullPath).replace(/\\/g, '/');

    if (dirent.isDirectory()) {
      // Recurse into subdirectory
      collectFiles(rootPath, fullPath, meta, out);
      continue;
    }

    if (!dirent.isFile()) continue;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }

    const mimeHint = guessMime(dirent.name);
    // Metadata is keyed by relative path for subdirectory files
    const metaKey = relPath;
    const fileMeta = meta.files[metaKey] || meta.files[dirent.name] || { readBy: [], createdAt: stat.birthtimeMs };

    out.push({
      name: dirent.name,
      relativePath: relPath,
      path: fullPath,
      size: stat.size,
      modifiedAt: stat.mtimeMs,
      createdAt: fileMeta.createdAt || stat.birthtimeMs,
      writtenBy: fileMeta.writtenBy,
      readBy: fileMeta.readBy || [],
      preview: safePreview(fullPath, mimeHint),
      mimeHint,
    });
  }
}

/**
 * Return a nested tree of the workspace for UI rendering.
 * Directories appear as WorkspaceDirEntry with a children array.
 */
export function listWorkspaceTree(teamId: string): WorkspaceEntry[] {
  const wsPath = getTeamWorkspacePath(teamId);
  if (!fs.existsSync(wsPath)) return [];
  const meta = loadWorkspaceMetadata(teamId);
  return buildTree(wsPath, wsPath, meta);
}

function buildTree(
  rootPath: string,
  dirPath: string,
  meta: WorkspaceMetadata,
): WorkspaceEntry[] {
  let dirEntries: fs.Dirent[];
  try {
    dirEntries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const entries: WorkspaceEntry[] = [];

  for (const dirent of dirEntries) {
    if (dirent.name.startsWith('.')) continue;

    const fullPath = path.join(dirPath, dirent.name);
    const relPath = path.relative(rootPath, fullPath).replace(/\\/g, '/');

    if (dirent.isDirectory()) {
      let stat: fs.Stats;
      try { stat = fs.statSync(fullPath); } catch { continue; }
      entries.push({
        name: dirent.name,
        relativePath: relPath,
        path: fullPath,
        modifiedAt: stat.mtimeMs,
        isDirectory: true,
        children: buildTree(rootPath, fullPath, meta),
      });
      continue;
    }

    if (!dirent.isFile()) continue;

    let stat: fs.Stats;
    try { stat = fs.statSync(fullPath); } catch { continue; }

    const mimeHint = guessMime(dirent.name);
    const metaKey = relPath;
    const fileMeta = meta.files[metaKey] || meta.files[dirent.name] || { readBy: [], createdAt: stat.birthtimeMs };

    entries.push({
      name: dirent.name,
      relativePath: relPath,
      path: fullPath,
      size: stat.size,
      modifiedAt: stat.mtimeMs,
      createdAt: fileMeta.createdAt || stat.birthtimeMs,
      writtenBy: fileMeta.writtenBy,
      readBy: fileMeta.readBy || [],
      preview: safePreview(fullPath, mimeHint),
      mimeHint,
      isDirectory: false,
    });
  }

  // Directories first, then files, each sorted by name
  entries.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });
  return entries;
}

// ─── Metadata Update Helpers ──────────────────────────────────────────────────

/**
 * Record that an agent wrote a file. Call this after the agent's write_file / create_file.
 */
export function recordFileWrite(teamId: string, filename: string, agentId: string): void {
  try {
    const meta = loadWorkspaceMetadata(teamId);
    if (!meta.files[filename]) {
      meta.files[filename] = { readBy: [], createdAt: Date.now() };
    }
    meta.files[filename].writtenBy = agentId;
    saveWorkspaceMetadata(teamId, meta);
  } catch (err: any) {
    console.warn(`[TeamWorkspace] recordFileWrite failed: ${err?.message}`);
  }
}

/**
 * Record that an agent read a file. Call this after read_file on a workspace file.
 */
export function recordFileRead(teamId: string, filename: string, agentId: string): void {
  try {
    const meta = loadWorkspaceMetadata(teamId);
    if (!meta.files[filename]) {
      meta.files[filename] = { readBy: [], createdAt: Date.now() };
    }
    const existing = meta.files[filename].readBy || [];
    if (!existing.includes(agentId)) {
      meta.files[filename].readBy = [...existing, agentId].slice(-20);
      saveWorkspaceMetadata(teamId, meta);
    }
  } catch (err: any) {
    console.warn(`[TeamWorkspace] recordFileRead failed: ${err?.message}`);
  }
}

// ─── Context Injection ────────────────────────────────────────────────────────

/**
 * Returns the context block to inject into a subagent's system prompt so it
 * knows about the shared workspace and what files already exist there.
 *
 * This should be appended to the agent's task prompt or system prompt when
 * the team scheduler fires the agent's run.
 */
export function buildWorkspaceContextBlock(teamId: string, agentId: string): string {
  const wsPath = ensureTeamWorkspace(teamId);
  const files = listWorkspaceFiles(teamId);

  const fileList = files.length === 0
    ? '  (no files yet — you may create the first one)'
    : files.map(f => {
        const age = Math.round((Date.now() - f.modifiedAt) / 60000);
        const ageStr = age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`;
        const writerStr = f.writtenBy ? ` [written by ${f.writtenBy}]` : '';
        const sizeStr = f.size > 1024 ? `${(f.size / 1024).toFixed(1)}KB` : `${f.size}B`;
        return `  - ${f.name} (${sizeStr}, modified ${ageStr}${writerStr})`;
      }).join('\n');

  return [
    '---',
    '## 🗂 Shared Team Workspace',
    '',
    `Your team has a shared workspace directory for passing files between agents:`,
    `**Path:** \`${wsPath}\``,
    '',
    '**Current files:**',
    fileList,
    '',
    '**Instructions:**',
    `- Read files from this directory to consume data produced by other agents`,
    `- Write files to this directory to share data with other agents`,
    `- Use the exact path above when reading or writing files`,
    `- File names should be descriptive: \`news.json\`, \`post.md\`, \`report.txt\`, etc.`,
    '---',
  ].join('\n');
}

// ─── File Operations (for write_notes equivalent) ─────────────────────────────

/**
 * Write a file to the team workspace directly (used by API for testing/seeding).
 * Agents write files via their normal file tools — this is for programmatic use.
 */
export function writeWorkspaceFile(
  teamId: string,
  filename: string,
  content: string,
  writtenBy?: string,
): string {
  const wsPath = ensureTeamWorkspace(teamId);
  const safe = path.basename(filename); // strip any path traversal
  const filePath = path.join(wsPath, safe);
  fs.writeFileSync(filePath, content, 'utf-8');
  if (writtenBy) {
    recordFileWrite(teamId, safe, writtenBy);
  }
  return filePath;
}

/**
 * Delete a file from the team workspace.
 */
export function deleteWorkspaceFile(teamId: string, filename: string): boolean {
  const wsPath = getTeamWorkspacePath(teamId);
  const safe = path.basename(filename);
  const filePath = path.join(wsPath, safe);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  // Clean up metadata entry
  try {
    const meta = loadWorkspaceMetadata(teamId);
    delete meta.files[safe];
    saveWorkspaceMetadata(teamId, meta);
  } catch {}
  return true;
}
