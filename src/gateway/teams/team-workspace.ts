/**
 * team-workspace.ts — Shared Team Workspace
 *
 * Each managed team gets a shared workspace directory where subagents can
 * read and write files to pass data between each other.
 *
 * Storage layout:
 *   <globalWorkspace>/teams/<teamId>/workspace/   ← shared files agents read/write
 *   <globalWorkspace>/teams/<teamId>/subagents/<agentId>/ ← team-scoped agent identity files
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
import { getAgentById } from '../../config/config';
import type { ManagedTeam } from './managed-teams';
import { buildAgentIdentity, renderIdentityPrompt } from '../../agents/identity-generator.js';
import { ensureAgentPromptFile, readAgentPromptFile, writeAgentPromptFile } from '../../agents/agent-prompt-file.js';

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
 * This is where AGENT.md and agent-specific config live for that team.
 *
 * Layout: <globalWorkspace>/teams/<teamId>/subagents/<agentId>/
 *
 * This ensures an agent reused across teams acts as a completely separate entity
 * in each team — different workspace, different identity, zero context bleed.
 */
export function getTeamAgentIdentityPath(teamId: string, agentId: string): string {
  const root = getTeamWorkspaceRoot();
  return path.join(root, sanitizeId(teamId), 'subagents', sanitizeId(agentId));
}

/**
 * Ensures the per-team agent identity directory exists.
 * On first creation, bootstraps identity files from an optional source workspace
 * (copies AGENT.md, HEARTBEAT.md, and TOOLS.md if they exist).
 * After that, the team-scoped files are independent and can diverge.
 *
 * Returns the identity path.
 */
export function ensureTeamAgentIdentity(
  teamId: string,
  agentId: string,
  globalAgentWorkspace?: string,
): string {
  const identityPath = getTeamAgentIdentityPath(teamId, agentId);
  const firstTime = !fs.existsSync(identityPath);
  fs.mkdirSync(identityPath, { recursive: true });
  const sourceIsTeamScoped = !!globalAgentWorkspace && fs.existsSync(path.join(globalAgentWorkspace, '.team-identity.json'));

  // Files to sync from an optional source workspace.
  // These are identity files — copied once on first use, then re-synced if the
  // team-scoped copy is still empty/blank.
  if (globalAgentWorkspace && !sourceIsTeamScoped) {
    const sourcePrompt = readAgentPromptFile(globalAgentWorkspace, { migrateLegacy: true });
    const destinationPrompt = readAgentPromptFile(identityPath, { migrateLegacy: true });
    if (sourcePrompt?.content.trim() && (!destinationPrompt || !destinationPrompt.content.trim())) {
      try { writeAgentPromptFile(identityPath, sourcePrompt.content); } catch {}
    }
  }

  // MEMORY.md is copied once when an agent joins a team so existing personal
  // continuity is preserved. The team-scoped copy then diverges independently.
  const filesToSync = ['HEARTBEAT.md', 'TOOLS.md', 'MEMORY.md'];

  for (const filename of filesToSync) {
    if (!globalAgentWorkspace || sourceIsTeamScoped) continue;
    const src = path.join(globalAgentWorkspace, filename);
    const dst = path.join(identityPath, filename);
    if (path.resolve(src) === path.resolve(dst)) continue;

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

  bootstrapTeamAgentIdentityFiles(teamId, agentId, identityPath);

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

function bootstrapTeamAgentIdentityFiles(teamId: string, agentId: string, identityPath: string): void {
  const agent = getAgentById(agentId) as any;
  const displayName = String(agent?.name || agentId || 'Agent');
  const description = String(agent?.description || 'No description set.');
  const teamRole = String(agent?.teamRole || displayName);
  const teamAssignment = String(agent?.teamAssignment || description);
  const identity = buildAgentIdentity({
    id: agentId,
    explicitName: agent?.identity?.displayName || displayName,
    description,
    roleType: agent?.roleType,
    teamRole,
    teamAssignment,
    identity: agent?.identity,
  });

  ensureAgentPromptFile(identityPath, [
      `# ${displayName}`,
      '',
      description,
      '',
      renderIdentityPrompt(identity),
      '',
      '## Team-Specific Role',
      teamRole,
      '',
      '## Team-Specific Assignment',
      teamAssignment,
    ].join('\n'));

  const heartbeat = path.join(identityPath, 'HEARTBEAT.md');
  if (!fs.existsSync(heartbeat)) {
    fs.writeFileSync(heartbeat, [
      `# HEARTBEAT.md - ${displayName}`,
      '',
      '## Heartbeat Checklist',
      '- Review team memory and pending work for actionable follow-up.',
      '- Persist outputs to the team workspace.',
      '- If no action was taken or nothing applies, reply exactly HEARTBEAT_OK and nothing else. This is the silence token and must not notify the user.',
      '- When creating or editing any HEARTBEAT.md for yourself or another agent, always keep this HEARTBEAT_OK silence rule in that file.',
    ].join('\n'), 'utf-8');
  }

  const memory = path.join(identityPath, 'MEMORY.md');
  if (!fs.existsSync(memory)) {
    fs.writeFileSync(memory, [
      `# MEMORY.md - ${displayName}`,
      '',
      `Durable personal memory for ${displayName} inside team ${teamId}.`,
      '',
      'Keep role-specific lessons, decisions, corrections, preferences, and open threads here.',
      'Shared team truth lives in the team record (manager: manage_team_goal log_completed), not in this private file.',
    ].join('\n'), 'utf-8');
  }

  const configPath = path.join(identityPath, 'config.json');
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({
      agentId,
      teamId,
      name: displayName,
      description,
      teamRole,
      teamAssignment,
      identity,
      teamScoped: true,
      createdAt: Date.now(),
    }, null, 2), 'utf-8');
  }
}

export function claimAgentForTeamWorkspace(teamId: string, agentId: string): { identityPath: string; removedGlobalPath?: string } | null {
  const safeAgentId = sanitizeId(agentId);
  if (!safeAgentId) return null;

  const cm = getConfig();
  const cfg = cm.getConfig() as any;
  const agents = Array.isArray(cfg.agents) ? [...cfg.agents] : [];
  const idx = agents.findIndex((a: any) => sanitizeId(a?.id) === safeAgentId);
  const agent = idx >= 0 ? agents[idx] : getAgentById(safeAgentId);
  if (!agent) return null;

  const identityPath = getTeamAgentIdentityPath(teamId, safeAgentId);
  const globalPath = path.join(cm.getWorkspacePath() || process.cwd(), '.prometheus', 'subagents', safeAgentId);
  const configuredWorkspace = String((agent as any).workspace || '').trim();
  const sourceWorkspace = configuredWorkspace && path.resolve(configuredWorkspace) !== path.resolve(identityPath)
    ? configuredWorkspace
    : fs.existsSync(globalPath)
      ? globalPath
      : undefined;

  ensureTeamAgentIdentity(teamId, safeAgentId, sourceWorkspace);

  // Keep the global agent workspace canonical. Team-specific identity and
  // memory are resolved by teamId at runtime; repointing the global config to
  // one team would leak that team's private context into another team.

  // Never delete the previous global identity directory automatically. It may
  // contain personal memory or legacy files that are required for rollback.
  // Explicit archival/cleanup is a separate, user-visible operation.
  return { identityPath };
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

// ─── Team context for completion review ───────────────────────────────────────
// The team record (purpose, focus, completedWork, room state) is the source of
// truth. This only surfaces team_info.md plus the latest team notes.

export function readTeamMemoryContext(teamId: string): string {
  const wsPath = getTeamWorkspacePath(teamId);
  const parts: string[] = [];
  const info = readTextIfExists(path.join(wsPath, 'team_info.md'), 3500);
  if (info) parts.push(`[team_info.md]\n${info}`);
  try {
    const notesPath = path.join(wsPath, 'team-notes.jsonl');
    if (fs.existsSync(notesPath)) {
      const recent = fs.readFileSync(notesPath, 'utf-8').split('\n').filter(Boolean).slice(-15)
        .map((line) => {
          try {
            const n = JSON.parse(line);
            return `- ${n.timestamp} [${n.authorId}${n.tag ? `/${n.tag}` : ''}] ${String(n.content || '').replace(/\s+/g, ' ').slice(0, 400)}`;
          } catch { return ''; }
        })
        .filter(Boolean);
      if (recent.length) parts.push(`[recent team notes]\n${recent.join('\n')}`);
    }
  } catch { /* non-fatal */ }
  return parts.join('\n\n');
}


function readTextIfExists(filePath: string, maxChars = 12000): string {
  try {
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf-8').trim().slice(0, maxChars);
  } catch {
    return '';
  }
}

export function buildTeamInfoContent(team: ManagedTeam): string {
  const wsPath = getTeamWorkspacePath(team.id);
  const subagentLines = (team.subagentIds || []).map((id) => {
    const agent = getAgentById(id) as any;
    const description = String(agent?.description || '').trim() || 'No description recorded.';
    if (!agent) return `- ${id}: ${description}`;

    const roleType = String(agent.roleType || '').trim() || 'not recorded';
    const teamRole = String(agent.teamRole || agent.name || '').trim() || 'not recorded';
    const teamAssignment = String(agent.teamAssignment || agent.description || '').trim() || 'not recorded';

    return [
      `- ${agent.name || id} (id: ${id}): ${description}`,
      `  - Base preset: ${roleType}`,
      `  - Team role: ${teamRole}`,
      `  - Team assignment: ${teamAssignment}`,
    ].join('\n');
  });
  const contextRefs = Array.isArray(team.contextReferences) ? team.contextReferences : [];
  const setupCandidates = [
    path.join(wsPath, 'xpose-lead-gen-setup.md'),
    path.join(wsPath, 'KICKOFF_SUMMARY.md'),
    path.join(wsPath, 'README.md'),
  ];
  const setupBlocks = setupCandidates
    .map((p) => ({ name: path.basename(p), content: readTextIfExists(p, 6000) }))
    .filter((item) => item.content && item.name !== 'README.md');

  return [
    `# ${team.name} Team Info`,
    ``,
    `Team ID: ${team.id}`,
    `Workspace: ${wsPath}`,
    ``,
    `## Enduring Purpose / Mandate`,
    String((team as any).purpose || team.mission || team.teamContext || team.description || 'Not specified.').trim(),
    ``,
    `## Business / Project Context`,
    String(team.teamContext || team.description || 'Not specified.').trim(),
    ``,
    `## What This Team Is For`,
    String(team.mission || (team as any).purpose || team.teamContext || 'Execute the team mandate using the roster below.').trim(),
    ``,
    `## What This Team Should Not Do`,
    `- Do not start work without an explicit run/start instruction or scheduled trigger.`,
    `- Do not launch every subagent by default.`,
    `- Do not write outputs outside the team workspace unless a higher-level Prometheus flow explicitly approves it.`,
    `- Do not treat subagent results as accepted until the manager verifies them.`,
    ``,
    `## Subagent Roster and Role Rationale`,
    subagentLines.length ? subagentLines.join('\n') : '- No subagents recorded.',
    ``,
    `## Operating Style`,
    `- Dispatch only the agents relevant to the current task.`,
    `- Check existing files and memory before doing new work.`,
    `- Verify created/modified files when relevant.`,
    `- Record finished work with manage_team_goal(action="log_completed"); the team record is the single source of truth.`,
    ``,
    `## Quality Bar / Definition of Done`,
    `- Outputs are specific, evidence-backed, and usable by the team owner.`,
    `- Incomplete, vague, or placeholder subagent outputs are re-dispatched with a specific correction.`,
    `- [GOAL_COMPLETE] is used only after the current task is substantively complete and logged with log_completed.`,
    ``,
    `## Target Outputs`,
    `- Durable artifacts in this workspace or the team's project folder.`,
    `- Concise manager status in team chat.`,
    ``,
    `## Known Constraints`,
    `- Team workspace writes should stay under: ${wsPath}`,
    `- Source writes should be proposal-gated unless a narrow, low-risk path is explicitly allowed by runtime policy.`,
    ``,
    `## Useful Memory / Context Discovered During Creation`,
    contextRefs.length
      ? contextRefs.map((ref) => `### ${ref.title}\n${ref.content}`).join('\n\n')
      : 'No context reference cards recorded yet.',
    ``,
    `## Important Workspace Files`,
    `- team_info.md: durable team mandate and operating context.`,
    `- team-notes.jsonl: append-only notes written by write_note in team sessions (system-managed).`,
    setupBlocks.length ? `\n## Migrated Setup Material\n${setupBlocks.map((b) => `### ${b.name}\n${b.content}`).join('\n\n')}` : '',
    ``,
  ].filter((part) => part !== '').join('\n');
}

const LEGACY_TEAM_INFO_RE = /Update memory\.json, last_run\.json, and pending\.json|Structured run memory in memory\.json/;

export function ensureTeamInfoFile(team: ManagedTeam): string {
  const wsPath = ensureTeamWorkspace(team.id);
  const teamInfoPath = path.join(wsPath, 'team_info.md');
  let needsWrite = !fs.existsSync(teamInfoPath);
  if (!needsWrite) {
    // Older team_info.md files told the manager to maintain memory.json / last_run.json /
    // pending.json. Regenerate those so stale instructions don't survive the cleanup.
    try {
      needsWrite = LEGACY_TEAM_INFO_RE.test(fs.readFileSync(teamInfoPath, 'utf-8'));
    } catch { needsWrite = false; }
  }
  if (needsWrite) {
    fs.writeFileSync(teamInfoPath, buildTeamInfoContent(team), 'utf-8');
  }
  return teamInfoPath;
}

export function initTeamWorkspaceArtifacts(team: ManagedTeam): void {
  ensureTeamWorkspace(team.id);
  // memory.json / last_run.json / pending.json are no longer created: the team record is the goal source of truth.
  ensureTeamInfoFile(team);
}

const TEAM_NOTES_FILE = 'team-notes.jsonl';
const TEAM_NOTES_MAX_BYTES = 512 * 1024;

/**
 * Append a write_note from a team session to an append-only team-notes.jsonl.
 * Replaces the old memory.json read-modify-write (which also recreated
 * last_run.json / pending.json on every note).
 */
export function appendTeamMemoryEvent(
  teamId: string,
  event: {
    authorType: 'manager' | 'subagent' | 'system';
    authorId: string;
    taskId?: string | null;
    tag?: string;
    content: string;
    timestamp?: string;
  },
): boolean {
  try {
    const wsPath = getTeamWorkspacePath(teamId);
    fs.mkdirSync(wsPath, { recursive: true });
    const filePath = path.join(wsPath, TEAM_NOTES_FILE);
    const record = {
      timestamp: event.timestamp || new Date().toISOString(),
      authorType: event.authorType,
      authorId: event.authorId,
      taskId: event.taskId || undefined,
      tag: event.tag || undefined,
      content: String(event.content || '').slice(0, 4000),
    };
    fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf-8');
    // Keep the file bounded: once it passes the cap, keep the newest half.
    const size = fs.statSync(filePath).size;
    if (size > TEAM_NOTES_MAX_BYTES) {
      const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
      fs.writeFileSync(filePath, `${lines.slice(Math.floor(lines.length / 2)).join('\n')}\n`, 'utf-8');
    }
    return true;
  } catch (err: any) {
    console.warn(`[TeamWorkspace] appendTeamMemoryEvent failed for ${teamId}: ${err?.message || err}`);
    return false;
  }
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
