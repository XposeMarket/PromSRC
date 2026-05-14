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
 * (copies system_prompt.md, HEARTBEAT.md, and TOOLS.md if they exist).
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

  // Files to sync from an optional source workspace.
  // These are identity files — copied once on first use, then re-synced if the
  // team-scoped copy is still empty/blank.
  const filesToSync = [
    'system_prompt.md',
    'HEARTBEAT.md',
    'TOOLS.md',
  ];

  for (const filename of filesToSync) {
    if (!globalAgentWorkspace) continue;
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

  const agentsMd = path.join(identityPath, 'AGENTS.md');
  if (!fs.existsSync(agentsMd)) {
    fs.writeFileSync(agentsMd, [
      `# AGENTS.md - ${displayName}`,
      '',
      '## Role',
      description,
      '',
      '## Team Assignment',
      teamAssignment,
      '',
      renderIdentityPrompt(identity),
      '',
      '## Output Format',
      'Return a concise summary of what was accomplished.',
    ].join('\n'), 'utf-8');
  }

  const systemPrompt = path.join(identityPath, 'system_prompt.md');
  if (!fs.existsSync(systemPrompt)) {
    fs.writeFileSync(systemPrompt, [
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
    ].join('\n'), 'utf-8');
  }

  const heartbeat = path.join(identityPath, 'HEARTBEAT.md');
  if (!fs.existsSync(heartbeat)) {
    fs.writeFileSync(heartbeat, [
      `# HEARTBEAT.md - ${displayName}`,
      '',
      '## Heartbeat Checklist',
      '- Review team memory and pending work for actionable follow-up.',
      '- Persist outputs to the team workspace.',
      '- If nothing is actionable, reply with HEARTBEAT_OK.',
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

function isGlobalSubagentPath(candidate: string, agentId: string): boolean {
  try {
    const workspace = getConfig().getWorkspacePath() || process.cwd();
    const expected = path.join(workspace, '.prometheus', 'subagents', sanitizeId(agentId));
    return path.resolve(candidate) === path.resolve(expected);
  } catch {
    return false;
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

  if (idx >= 0) {
    agents[idx] = {
      ...agents[idx],
      workspace: identityPath,
    };
    cm.updateConfig({ agents } as any);
  }

  let removedGlobalPath: string | undefined;
  if (sourceWorkspace && isGlobalSubagentPath(sourceWorkspace, safeAgentId) && path.resolve(sourceWorkspace) !== path.resolve(identityPath)) {
    try {
      if (fs.existsSync(sourceWorkspace)) {
        fs.rmSync(sourceWorkspace, { recursive: true, force: true });
        removedGlobalPath = sourceWorkspace;
      }
    } catch {
      // Non-fatal; config now points at the team identity path.
    }
  }

  return { identityPath, removedGlobalPath };
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
      _note: 'Cross-run accumulated team knowledge and structured manager/subagent notes.',
      updatedAt: null,
      entries: [],
      events: [],
      runSummaries: [],
      acceptedOutputs: [],
      decisions: [],
    }, null, 2), 'utf-8');
  }

  const lastRunPath = path.join(wsPath, 'last_run.json');
  if (!fs.existsSync(lastRunPath)) {
    fs.writeFileSync(lastRunPath, JSON.stringify({
      _note: 'What happened in the most recent manager run. Overwrite this at the end of each run.',
      runId: null,
      timestamp: null,
      runAt: null,
      task: null,
      managerSummary: null,
      dispatchesMade: [],
      subagentResults: [],
      verificationDecisions: [],
      filesCreatedOrModified: [],
      writeNotes: [],
      unresolvedItems: [],
      agentsUsed: [],
    }, null, 2), 'utf-8');
  }

  const pendingPath = path.join(wsPath, 'pending.json');
  if (!fs.existsSync(pendingPath)) {
    fs.writeFileSync(pendingPath, JSON.stringify({
      _note: 'Unresolved blockers, incomplete work, follow-up dispatches, questions, and verification failures.',
      items: [],
      blockers: [],
      followUpDispatches: [],
      awaitingMainAgentOrUser: [],
      verificationFailures: [],
    }, null, 2), 'utf-8');
  }
}

export function readTeamMemoryContext(teamId: string): string {
  const wsPath = getTeamWorkspacePath(teamId);
  const parts: string[] = [
    `The following file snapshots were read by the system before this manager turn.`,
    `Treat them as the current contents of the memory files; do not call file_stats or read_file on these files just to inspect them.`,
    `If you need to update memory.json, last_run.json, or pending.json, use these snapshots as your base and write the updated file directly.`,
  ];
  for (const filename of ['team_info.md', 'memory.json', 'last_run.json', 'pending.json'] as const) {
    const filePath = path.join(wsPath, filename);
    if (!fs.existsSync(filePath)) continue;
    try {
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      const lineCount = content ? content.split(/\r?\n/).length : 0;
      const bytes = Buffer.byteLength(content, 'utf-8');
      const truncated = content.length > 8000;
      parts.push([
        `[${filename}]`,
        `path: ${filePath}`,
        `lines: ${lineCount}, bytes: ${bytes}${truncated ? ', truncated to first 8000 chars' : ''}`,
        content.slice(0, 8000),
      ].join('\n'));
    } catch { /* skip unreadable */ }
  }
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
    `- Update memory.json, last_run.json, and pending.json at the end of meaningful runs.`,
    ``,
    `## Quality Bar / Definition of Done`,
    `- Outputs are specific, evidence-backed, and usable by the team owner.`,
    `- Incomplete, vague, or placeholder subagent outputs are re-dispatched with a specific correction.`,
    `- [GOAL_COMPLETE] is used only after the current task is substantively complete and team memory files are updated.`,
    ``,
    `## Target Outputs`,
    `- Durable artifacts in this workspace.`,
    `- Structured run memory in memory.json, last_run.json, and pending.json.`,
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
    `- memory.json: cumulative team knowledge and structured note events.`,
    `- last_run.json: latest manager-run summary and verification decisions.`,
    `- pending.json: unresolved blockers, follow-ups, and questions.`,
    setupBlocks.length ? `\n## Migrated Setup Material\n${setupBlocks.map((b) => `### ${b.name}\n${b.content}`).join('\n\n')}` : '',
    ``,
  ].filter((part) => part !== '').join('\n');
}

export function ensureTeamInfoFile(team: ManagedTeam): string {
  const wsPath = ensureTeamWorkspace(team.id);
  const teamInfoPath = path.join(wsPath, 'team_info.md');
  if (!fs.existsSync(teamInfoPath)) {
    fs.writeFileSync(teamInfoPath, buildTeamInfoContent(team), 'utf-8');
  }
  return teamInfoPath;
}

export function initTeamWorkspaceArtifacts(team: ManagedTeam): void {
  ensureTeamWorkspace(team.id);
  initTeamMemoryFiles(team.id);
  ensureTeamInfoFile(team);
}

function safeJsonRead(filePath: string, fallback: any): any {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function safeJsonWrite(filePath: string, value: any): void {
  const tmp = `${filePath}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}

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
    initTeamMemoryFiles(teamId);
    const filePath = path.join(getTeamWorkspacePath(teamId), 'memory.json');
    const memory = safeJsonRead(filePath, {
      _note: 'Cross-run accumulated team knowledge and structured manager/subagent notes.',
      updatedAt: null,
      entries: [],
      events: [],
    });
    const timestamp = event.timestamp || new Date().toISOString();
    const record = {
      timestamp,
      authorType: event.authorType,
      authorId: event.authorId,
      taskId: event.taskId || undefined,
      tag: event.tag || undefined,
      content: String(event.content || '').slice(0, 4000),
    };
    memory.updatedAt = timestamp;
    memory.events = Array.isArray(memory.events) ? [...memory.events, record].slice(-500) : [record];
    memory.entries = Array.isArray(memory.entries) ? memory.entries : [];
    safeJsonWrite(filePath, memory);
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
