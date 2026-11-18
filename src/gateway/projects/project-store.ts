/**
 * project-store.ts — Projects System Data Layer
 *
 * Manages persistent Project records stored in:
 *   .prometheus/projects/<id>.json
 *
 * Each project owns:
 *   - Metadata (name, optional linked folder, Instructions)
 *   - A list of session IDs scoped to this project
 *   - A knowledge folder: workspace/projects/<id>/knowledge/
 *   - Notes: workspace/projects/<id>/CONTEXT.md, short notes the model keeps
 *
 * Instructions are the user's and are always injected in full; the model never
 * edits them. Notes are the model's. A linked folder's AGENTS.md / CLAUDE.md is
 * injected too, so every agent working in that folder follows the same rules.
 *
 * Sessions are regular Prometheus sessions (keyed by UUID in .prometheus/sessions/).
 * The project record just tracks which session IDs belong to it.
 *
 * File layout:
 *   .prometheus/projects/<id>.json          ← project metadata
 *   workspace/projects/<id>/                ← project workspace folder
 *   workspace/projects/<id>/CONTEXT.md      ← project notes (model-maintained)
 *   workspace/projects/<id>/knowledge/      ← uploaded knowledge files
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getConfig } from '../../config/config.js';
import { deleteSession, getSession, listSessionSummaries, sessionExists } from '../session.js';
import {
  assertSafeStorageId,
  isSafeStorageId,
  resolveConfinedStoragePath,
  storageFilePath,
} from '../storage/storage-paths.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProjectSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectKnowledgeFile {
  id: string;
  name: string;
  path: string;       // derived absolute path on disk (legacy metadata is never trusted directly)
  relPath: string;    // relative to project knowledge dir
  sizeBytes: number;
  tokens: number;     // estimated token count
  addedAt: number;
}

export interface ProjectExternalImportBinding {
  version: 1;
  jobId: string;
  dedupeKey: string;
  provider: string;
  adapter: string;
  sourceLabel: string;
  sourceProjectId: string;
  sourcePath?: string;
  importedAt: string;
  /** A source path is informational until it passes Prometheus path policy. */
  linkState: 'linked' | 'permission_required' | 'unavailable';
}

export interface Project {
  id: string;
  name: string;
  /** Optional user-selected directory that scopes this project's work. */
  workspacePath?: string;
  /** The user's project instructions. Injected in full; the model never edits them. */
  instructions: string;
  /** Legacy field, kept for old clients. Folded into the notes by the v2 cleanup. */
  memorySnapshot: string;
  /** 2 = instructions/notes split done (CONTEXT.md is notes only). */
  contextVersion?: number;
  sessions: ProjectSession[];
  knowledge: ProjectKnowledgeFile[];
  externalImport?: ProjectExternalImportBinding;
  /** Durable sidebar pin timestamp, shared by desktop and mobile clients. */
  pinnedAt?: number;
  createdAt: number;
  updatedAt: number;
}

// ─── Paths ────────────────────────────────────────────────────────────────────

let legacyProjectMigrationComplete = false;

function copyMissingTree(sourceDir: string, targetDir: string): number {
  if (!fs.existsSync(sourceDir)) return 0;
  fs.mkdirSync(targetDir, { recursive: true });
  let copied = 0;
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copied += copyMissingTree(source, target);
    } else if (!fs.existsSync(target)) {
      fs.copyFileSync(source, target);
      copied += 1;
    }
  }
  return copied;
}

/**
 * The canonical PromSRC dev gateway runs in `.prometheus-instances/port-*` so
 * it cannot collide with Electron. The old source checkout data lives in the
 * sibling `.prometheus` directory. Import only that explicit instance shape;
 * Electron and ordinary gateways must never read another gateway's store.
 */
function migrateLegacyDevProjects(currentProjectsDir: string): void {
  if (legacyProjectMigrationComplete) return;
  legacyProjectMigrationComplete = true;
  sessionOwnerIndex = null; // migrated project files are copied straight to disk; rebuild the index lazily

  const dataRoot = String(process.env.PROMETHEUS_DATA_DIR || '').trim();
  if (!dataRoot) return;
  const resolvedDataRoot = path.resolve(dataRoot);
  const parentName = path.basename(path.dirname(resolvedDataRoot)).toLowerCase();
  const instanceName = path.basename(resolvedDataRoot).toLowerCase();
  if (parentName !== '.prometheus-instances' || !instanceName.startsWith('port-')) return;

  const currentConfigDir = path.resolve(getConfig().getConfigDir());
  const legacyConfigDir = path.join(path.dirname(path.dirname(resolvedDataRoot)), '.prometheus');
  if (path.resolve(legacyConfigDir) === currentConfigDir) return;
  const legacyProjectsDir = path.join(legacyConfigDir, 'projects');
  if (!fs.existsSync(legacyProjectsDir)) return;

  const currentSessionDir = path.join(currentConfigDir, 'sessions');
  const legacySessionDir = path.join(legacyConfigDir, 'sessions');
  const currentWorkspaceProjectsDir = path.join(getConfig().getWorkspacePath(), 'projects');
  const legacyWorkspaceProjectsDir = path.join(legacyConfigDir, '..', 'workspace', 'projects');
  let projectsCopied = 0;
  let sessionsCopied = 0;
  let workspaceFilesCopied = 0;

  for (const entry of fs.readdirSync(legacyProjectsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const id = entry.name.slice(0, -5);
    if (!isSafeStorageId(id)) continue;
    const sourceProjectFile = path.join(legacyProjectsDir, entry.name);
    const targetProjectFile = path.join(currentProjectsDir, entry.name);
    try {
      const parsed = JSON.parse(fs.readFileSync(sourceProjectFile, 'utf-8')) as Project;
      if (!fs.existsSync(targetProjectFile)) {
        fs.mkdirSync(currentProjectsDir, { recursive: true });
        fs.copyFileSync(sourceProjectFile, targetProjectFile);
        projectsCopied += 1;
      }

      for (const session of Array.isArray(parsed.sessions) ? parsed.sessions : []) {
        const sessionId = String(session?.id || '').trim();
        if (!isSafeStorageId(sessionId)) continue;
        const sourceSessionFile = path.join(legacySessionDir, `${sessionId}.json`);
        const targetSessionFile = path.join(currentSessionDir, `${sessionId}.json`);
        if (fs.existsSync(sourceSessionFile) && !fs.existsSync(targetSessionFile)) {
          fs.mkdirSync(currentSessionDir, { recursive: true });
          fs.copyFileSync(sourceSessionFile, targetSessionFile);
          sessionsCopied += 1;
        }
      }

      const sourceWorkspace = path.join(legacyWorkspaceProjectsDir, id);
      const targetWorkspace = path.join(currentWorkspaceProjectsDir, id);
      workspaceFilesCopied += copyMissingTree(sourceWorkspace, targetWorkspace);
    } catch (error: any) {
      console.warn(`[ProjectStore] Could not import legacy dev project ${id}:`, error?.message || error);
    }
  }

  if (projectsCopied || sessionsCopied || workspaceFilesCopied) {
    console.log(`[ProjectStore] Imported legacy dev data: ${projectsCopied} project(s), ${sessionsCopied} session(s), ${workspaceFilesCopied} workspace file(s).`);
  }
}

function getProjectsDir(): string {
  const dir = resolveConfinedStoragePath(getConfig().getConfigDir(), 'projects', { label: 'projects directory' });
  migrateLegacyDevProjects(dir);
  return dir;
}

function getProjectFile(id: string): string {
  return storageFilePath(getProjectsDir(), id, '.json', 'project id');
}

export function getProjectWorkspaceDir(id: string): string {
  const projectId = assertSafeStorageId(id, 'project id');
  const projectsRoot = resolveConfinedStoragePath(getConfig().getWorkspacePath(), 'projects', { label: 'project workspace root' });
  fs.mkdirSync(projectsRoot, { recursive: true });
  return resolveConfinedStoragePath(projectsRoot, projectId, { label: 'project workspace' });
}

export function getProjectKnowledgeDir(id: string): string {
  const workspaceDir = getProjectWorkspaceDir(id);
  fs.mkdirSync(workspaceDir, { recursive: true });
  return resolveConfinedStoragePath(workspaceDir, 'knowledge', { label: 'project knowledge directory' });
}

export function getProjectKnowledgeFilePath(projectId: string, relativeName: string): string {
  return resolveConfinedStoragePath(getProjectKnowledgeDir(projectId), relativeName, {
    label: 'project knowledge file',
  });
}

export function getProjectContextFilePath(projectId: string): string {
  return resolveConfinedStoragePath(getProjectWorkspaceDir(projectId), 'CONTEXT.md', {
    label: 'project context file',
  });
}

function ensureProjectDirs(id: string): void {
  for (const dir of [getProjectsDir(), getProjectWorkspaceDir(id), getProjectKnowledgeDir(id)]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return 'proj_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

export const NOTES_REVIEW_HEADING = 'Auto-captured (review)';
const NOTES_PROMPT_MAX_LINES = 200;
const NOTES_PROMPT_MAX_CHARS = 8000;
const INSTRUCTIONS_PROMPT_MAX_CHARS = 12000;
const FOLDER_FILE_PROMPT_MAX_CHARS = 6000;
const FOLDER_INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md'];
/** Lines the old keyword learner appended end with a date comment. */
const LEGACY_AUTO_LINE = /\s*<!--\s*\d{4}-\d{2}-\d{2}\s*-->\s*$/;
const LEGACY_NOISE_LINE = /^(\*\(Prometheus will fill this in[^)]*\)\*|>\s*This file is the living context.*|>\s*Last updated:.*)$/i;

function notesSeed(name: string): string {
  return `# ${name}\n\n<!-- Project notes. Prometheus keeps short notes here: decisions, status, key facts. Your Instructions are separate and are never edited here. -->\n`;
}

function clipText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}\n... (truncated)` : text;
}

function ensureProjectContextFile(project: Project): string {
  const contextPath = getProjectContextFilePath(project.id);
  if (!fs.existsSync(contextPath)) fs.writeFileSync(contextPath, notesSeed(project.name), 'utf-8');
  return contextPath;
}

/**
 * One-time cleanup of a v1 CONTEXT.md (instructions, memory, notes and keyword-learner
 * output all mixed in one file). Pure: returns the new notes and instructions.
 * - "Project Instructions" section -> Instructions (appended if not already there)
 * - keyword-learner lines ("<!-- YYYY-MM-DD -->") -> a review section the model never sees
 * - template placeholders and empty sections are dropped; everything else is kept as notes
 */
export function migrateLegacyProjectContext(
  content: string,
  projectName: string,
  instructions: string,
  memorySnapshot = '',
): { notes: string; instructions: string; reviewLines: number } {
  let title = projectName;
  const preamble: string[] = [];
  const sections: Array<{ heading: string; lines: string[] }> = [];
  for (const line of String(content || '').replace(/\r\n/g, '\n').split('\n')) {
    const h1 = /^#\s+(.+?)\s*$/.exec(line);
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h1 && !sections.length && !preamble.some((l) => l.trim())) { title = h1[1]; continue; }
    if (h2) { sections.push({ heading: h2[1], lines: [] }); continue; }
    (sections.length ? sections[sections.length - 1].lines : preamble).push(line);
  }
  const clean = (lines: string[]) => {
    const kept = lines.filter((l) => !LEGACY_NOISE_LINE.test(l.trim()));
    while (kept.length && !kept[0].trim()) kept.shift();
    while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
    return kept;
  };
  let nextInstructions = String(instructions || '').trim();
  const out: string[] = [`# ${title}`, ''];
  const pre = clean(preamble);
  if (pre.length) out.push(...pre, '');
  const review: string[] = [];
  for (const section of sections) {
    const heading = section.heading.trim();
    if (/^project instructions$/i.test(heading)) {
      const text = clean(section.lines).join('\n').trim();
      if (text && !nextInstructions.includes(text)) nextInstructions = nextInstructions ? `${nextInstructions}\n\n${text}` : text;
      continue;
    }
    if (heading.toLowerCase() === NOTES_REVIEW_HEADING.toLowerCase()) {
      review.push(...clean(section.lines).filter((l) => l.trim() && !/^<!--/.test(l.trim())));
      continue;
    }
    const keep: string[] = [];
    for (const line of section.lines) {
      if (LEGACY_AUTO_LINE.test(line)) {
        const text = line.replace(LEGACY_AUTO_LINE, '').replace(/^\s*[-*]\s*/, '').trim();
        if (text) review.push(`- ${text} _(was under ${heading})_`);
      } else keep.push(line);
    }
    const body = clean(keep);
    if (body.some((l) => l.trim())) out.push(`## ${/^project memory$|^memory snapshot$/i.test(heading) ? 'Memory' : heading}`, '', ...body, '');
  }
  const memory = String(memorySnapshot || '').trim();
  if (memory && !out.join('\n').includes(memory)) out.push('## Memory', '', memory, '');
  if (review.length) {
    out.push(
      `## ${NOTES_REVIEW_HEADING}`,
      '<!-- Saved by the old automatic learner, which often grabbed sentence fragments. Prometheus does not read this section. Move anything useful above, then delete the rest. -->',
      ...review,
      '',
    );
  }
  return { notes: `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`, instructions: nextInstructions, reviewLines: review.length };
}

/** Notes as the model sees them: no review section, no HTML comments, first 200 lines / 8k chars. */
export function projectNotesForPrompt(content: string): string {
  let text = String(content || '').replace(/\r\n/g, '\n');
  const review = new RegExp(`^##\\s+${NOTES_REVIEW_HEADING.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$[\\s\\S]*?(?=^##\\s|(?![\\s\\S]))`, 'mi');
  text = text.replace(review, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!text.replace(/^#\s+.*$/m, '').trim()) return '';
  const lines = text.split('\n');
  const clipped = lines.length > NOTES_PROMPT_MAX_LINES ? `${lines.slice(0, NOTES_PROMPT_MAX_LINES).join('\n')}\n... (truncated: keep notes under ${NOTES_PROMPT_MAX_LINES} lines)` : text;
  return clipText(clipped, NOTES_PROMPT_MAX_CHARS);
}

/** AGENTS.md / CLAUDE.md in a linked folder (same files Codex and Claude Code read). */
export function readFolderInstructionFiles(folder: string): Array<{ name: string; content: string }> {
  const out: Array<{ name: string; content: string }> = [];
  const seen = new Set<string>();
  const root = String(folder || '').trim();
  if (!root) return out;
  for (const name of FOLDER_INSTRUCTION_FILES) {
    try {
      const file = path.join(root, name);
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size === 0) continue;
      let text: string;
      if (stat.size > 256 * 1024) {
        const fd = fs.openSync(file, 'r');
        try { const buf = Buffer.alloc(64 * 1024); text = buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, 0)).toString('utf-8'); } finally { fs.closeSync(fd); }
      } else text = fs.readFileSync(file, 'utf-8');
      text = text.trim();
      const key = text.replace(/\s+/g, ' ');
      if (!text || seen.has(key)) continue;
      seen.add(key);
      out.push({ name, content: clipText(text, FOLDER_FILE_PROMPT_MAX_CHARS) });
    } catch { /* missing or unreadable: skip */ }
  }
  return out;
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    const resolved = path.resolve(String(p || '').trim()).replace(/[\\/]+$/, '');
    return process.platform === 'win32' || process.platform === 'darwin' ? resolved.toLowerCase() : resolved;
  };
  return !!String(a || '').trim() && !!String(b || '').trim() && norm(a) === norm(b);
}

/** Run the v1 -> v2 instructions/notes split once per project. Keeps a backup of the old file. */
export function ensureProjectContextV2(project: Project): Project {
  if (project.contextVersion === 2) return project;
  try {
    ensureProjectDirs(project.id);
    const contextPath = getProjectContextFilePath(project.id);
    if (fs.existsSync(contextPath)) {
      const original = fs.readFileSync(contextPath, 'utf-8');
      const backup = path.join(path.dirname(contextPath), 'CONTEXT.v1-backup.md');
      if (!fs.existsSync(backup)) fs.writeFileSync(backup, original, 'utf-8');
      const migrated = migrateLegacyProjectContext(original, project.name, project.instructions || '', project.memorySnapshot || '');
      fs.writeFileSync(contextPath, migrated.notes, 'utf-8');
      project.instructions = migrated.instructions;
    } else {
      fs.writeFileSync(contextPath, notesSeed(project.name), 'utf-8');
    }
    project.contextVersion = 2;
    saveProject(project);
    if (project.workspacePath && fileHarnessChatsIntoProject(project.id)) return loadProjectFromDisk(project.id) || project;
  } catch (e: any) {
    console.warn(`[ProjectStore] notes cleanup failed for ${project.id}:`, e?.message);
  }
  return project;
}

/** Replace the project notes (CONTEXT.md). The user can edit notes from the project panel. */
export function writeProjectNotes(projectId: string, content: string): boolean {
  const project = loadProjectFromDisk(projectId);
  if (!project) return false;
  ensureProjectDirs(project.id);
  fs.writeFileSync(getProjectContextFilePath(project.id), String(content || '').replace(/\r\n/g, '\n'), 'utf-8');
  return true;
}

export function getProjectContextContent(projectId: string): string | null {
  const project = loadProjectFromDisk(projectId);
  if (!project) return null;
  const contextPath = ensureProjectContextFile(project);
  try { return fs.readFileSync(contextPath, 'utf-8'); } catch { return null; }
}

// sessionId -> projectId. Built lazily from disk, then kept in step by every project write.
// No watcher and no persisted index: any write that changes a project's sessions goes through saveProject.
let sessionOwnerIndex: Map<string, string> | null = null;

function ensureSessionOwnerIndex(): Map<string, string> {
  if (sessionOwnerIndex) return sessionOwnerIndex;
  const index = new Map<string, string>();
  const dir = getProjectsDir();
  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const id = file.slice(0, -5);
      if (!isSafeStorageId(id)) continue;
      for (const sess of loadProjectFromDisk(id)?.sessions || []) index.set(sess.id, id);
    }
  }
  sessionOwnerIndex = index;
  return index;
}

function indexProjectSessions(projectId: string, sessionIds: string[]): void {
  if (!sessionOwnerIndex) return; // not built yet: the next lookup reads disk, which already has this write
  for (const [sid, pid] of sessionOwnerIndex) {
    if (pid === projectId) sessionOwnerIndex.delete(sid);
  }
  for (const sid of sessionIds) sessionOwnerIndex.set(sid, projectId);
}

function saveProject(project: Project): void {
  project.id = assertSafeStorageId(project.id, 'project id');
  ensureProjectDirs(project.id);
  fs.writeFileSync(getProjectFile(project.id), JSON.stringify(project, null, 2), 'utf-8');
  indexProjectSessions(project.id, project.sessions.map((sess) => sess.id));
}

function loadProjectFromDisk(id: string): Project | null {
  const projectId = assertSafeStorageId(id, 'project id');
  const file = getProjectFile(projectId);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Project;
    return {
      ...parsed,
      id: projectId,
      sessions: Array.isArray(parsed.sessions)
        ? parsed.sessions.filter((session) => isSafeStorageId(session?.id))
        : [],
      knowledge: Array.isArray(parsed.knowledge) ? parsed.knowledge : [],
    };
  } catch (e: any) {
    console.error(`[ProjectStore] Failed to load project ${id}:`, e?.message);
    return null;
  }
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export function listProjects(): Project[] {
  const dir = getProjectsDir();
  if (!fs.existsSync(dir)) return [];
  const projects: Project[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const id = file.slice(0, -5);
    if (!isSafeStorageId(id)) continue;
    const p = loadProjectFromDisk(id);
    if (p) projects.push(ensureProjectContextV2(p));
  }
  return projects.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getProject(id: string): Project | null {
  const project = loadProjectFromDisk(id);
  return project ? ensureProjectContextV2(project) : null;
}

/** The project linked to this folder, if any. */
export function findProjectByFolder(folder: string): Project | null {
  if (!String(folder || '').trim()) return null;
  return listProjects().find((p) => p.workspacePath && samePath(p.workspacePath, folder)) || null;
}

/**
 * One project, any agent: harness chats (Codex, Claude Code, ...) running in a
 * project's linked folder belong to that project. Chats already in a project stay put.
 */
export function fileHarnessChatsIntoProject(projectId: string): number {
  const project = loadProjectFromDisk(projectId);
  if (!project?.workspacePath) return 0;
  let added = 0;
  let summaries: any[] = [];
  try { summaries = listSessionSummaries() as any[]; } catch { return 0; }
  for (const s of summaries) {
    const cwd = String(s?.externalAgent?.cwd || '').trim();
    if (!cwd || !isSafeStorageId(s?.id) || !samePath(cwd, project.workspacePath)) continue;
    if (project.sessions.some((sess) => sess.id === s.id) || findProjectBySessionId(s.id)) continue;
    const at = Number(s.lastMessageAt || s.updatedAt || s.createdAt || Date.now()) || Date.now();
    project.sessions.push({ id: s.id, title: String(s.title || 'New chat'), createdAt: Number(s.createdAt) || at, updatedAt: at });
    added += 1;
  }
  if (added) {
    project.sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    project.updatedAt = Date.now();
    saveProject(project);
  }
  return added;
}

/** File a harness chat into the project linked to its folder (no-op if none or already filed). */
export function fileSessionIntoFolderProject(sessionId: string, folder: string): Project | null {
  if (!isSafeStorageId(sessionId) || !String(folder || '').trim() || findProjectBySessionId(sessionId)) return null;
  const project = findProjectByFolder(folder);
  if (!project) return null;
  let title = 'New chat';
  try { title = String(getSession(sessionId)?.title || '').trim() || title; } catch { /* new chat */ }
  return addSessionToProject(project.id, sessionId, title);
}

const UNSTARTED_CHAT_GRACE_MS = 2 * 60_000;

/**
 * A project chat row is created right before the first message is sent. If that
 * send never lands (failed request, closed app), no chat exists: drop the row.
 */
export function pruneUnstartedProjectChats<T extends { id: string; sessions?: ProjectSession[] }>(project: T, now = Date.now()): T {
  const sessions = Array.isArray(project?.sessions) ? project.sessions : [];
  const kept = sessions.filter((s) => sessionExists(s.id) || now - Number(s.createdAt || 0) < UNSTARTED_CHAT_GRACE_MS);
  if (kept.length === sessions.length) return project;
  const stored = loadProjectFromDisk(project.id);
  if (stored) {
    const keepIds = new Set(kept.map((s) => s.id));
    stored.sessions = stored.sessions.filter((s) => keepIds.has(s.id) || !sessions.some((old) => old.id === s.id));
    saveProject(stored);
  }
  return { ...project, sessions: kept };
}

export function createProject(name: string, workspacePath = ''): Project {
  const id = generateId();
  const now = Date.now();
  ensureProjectDirs(id);

  const project: Project = {
    id, name,
    ...(workspacePath ? { workspacePath: path.resolve(workspacePath) } : {}),
    instructions: '',
    memorySnapshot: '',
    contextVersion: 2,
    sessions: [],
    knowledge: [],
    createdAt: now,
    updatedAt: now,
  };
  ensureProjectContextFile(project);
  saveProject(project);
  console.log(`[ProjectStore] Created project "${name}" (${id})`);
  if (project.workspacePath && fileHarnessChatsIntoProject(project.id)) return loadProjectFromDisk(project.id) || project;
  return project;
}

/** Create a normal Prometheus project while retaining source provenance. */
export function createImportedProject(
  name: string,
  workspacePath: string,
  externalImport: ProjectExternalImportBinding,
): Project {
  const project = createProject(name, workspacePath);
  project.externalImport = externalImport;
  project.updatedAt = Date.now();
  saveProject(project);
  return project;
}

export function findProjectByExternalImportDedupeKey(dedupeKey: string): Project | null {
  const key = String(dedupeKey || '').trim();
  if (!key) return null;
  return listProjects().find((project) => project.externalImport?.dedupeKey === key) || null;
}

export function updateProject(
  id: string,
  updates: Partial<Pick<Project, 'name' | 'workspacePath' | 'instructions' | 'memorySnapshot' | 'pinnedAt'>>
): Project | null {
  const project = loadProjectFromDisk(id);
  if (!project) return null;

  if (updates.name !== undefined) project.name = updates.name;
  if (updates.workspacePath !== undefined) project.workspacePath = updates.workspacePath ? path.resolve(updates.workspacePath) : undefined;
  if (updates.instructions !== undefined) project.instructions = updates.instructions;
  if (updates.memorySnapshot !== undefined) project.memorySnapshot = updates.memorySnapshot;
  if (updates.pinnedAt !== undefined) project.pinnedAt = updates.pinnedAt ? Number(updates.pinnedAt) : undefined;
  // Instructions live only on the project record now; they are no longer copied into CONTEXT.md (notes).

  project.updatedAt = Date.now();
  saveProject(project);
  if (updates.workspacePath && project.workspacePath && fileHarnessChatsIntoProject(project.id)) {
    return loadProjectFromDisk(project.id) || project;
  }
  return project;
}

export interface DeleteProjectOptions {
  /** Default true: chats survive and only lose project membership. Pass false to also delete the chats. */
  keepSessions?: boolean;
}

export function deleteProject(id: string, options: DeleteProjectOptions = {}): boolean {
  const project = loadProjectFromDisk(id);
  if (!project) return false;

  const keepSessions = options.keepSessions !== false;
  if (!keepSessions) {
    for (const sess of project.sessions) {
      try { deleteSession(sess.id); } catch {}
    }
  }

  // Delete workspace folder
  const workspaceDir = getProjectWorkspaceDir(id);
  if (fs.existsSync(workspaceDir)) {
    try { fs.rmSync(workspaceDir, { recursive: true, force: true }); } catch (e: any) {
      console.warn(`[ProjectStore] workspace delete failed for ${id}:`, e?.message);
    }
  }

  // Delete metadata file
  const projectFile = getProjectFile(id);
  if (fs.existsSync(projectFile)) { try { fs.unlinkSync(projectFile); } catch {} }
  indexProjectSessions(id, []);

  console.log(`[ProjectStore] Deleted project ${id}`);
  return true;
}

// ─── Session Management ───────────────────────────────────────────────────────

export function addSessionToProject(
  projectId: string,
  sessionId: string,
  title: string = 'New chat'
): Project | null {
  assertSafeStorageId(projectId, 'project id');
  const safeSessionId = assertSafeStorageId(sessionId, 'session id');
  const project = loadProjectFromDisk(projectId);
  if (!project) return null;
  if (project.sessions.some(s => s.id === safeSessionId)) return project;
  const now = Date.now();
  project.sessions.unshift({ id: safeSessionId, title, createdAt: now, updatedAt: now });
  project.updatedAt = now;
  saveProject(project);
  return project;
}

export function updateProjectSessionTitle(
  projectId: string,
  sessionId: string,
  title: string
): void {
  assertSafeStorageId(projectId, 'project id');
  const safeSessionId = assertSafeStorageId(sessionId, 'session id');
  const project = loadProjectFromDisk(projectId);
  if (!project) return;
  const sess = project.sessions.find(s => s.id === safeSessionId);
  if (sess) {
    sess.title = title;
    sess.updatedAt = Date.now();
    project.updatedAt = Date.now();
    saveProject(project);
  }
}

/**
 * Move an EXISTING session into this project. A chat has at most one owner, so it is
 * removed from any other project first. Idempotent. Never creates a session.
 * Returns null (nothing written) when the project or the session does not exist.
 */
export function attachSessionToProject(projectId: string, sessionId: string): Project | null {
  assertSafeStorageId(projectId, 'project id');
  const safeSessionId = assertSafeStorageId(sessionId, 'session id');
  if (!sessionExists(safeSessionId)) return null;
  const target = loadProjectFromDisk(projectId);
  if (!target) return null;

  const owner = findProjectBySessionId(safeSessionId);
  if (owner && owner.id !== target.id) {
    owner.sessions = owner.sessions.filter(s => s.id !== safeSessionId);
    owner.updatedAt = Date.now();
    saveProject(owner);
  }
  if (target.sessions.some(s => s.id === safeSessionId)) return target;

  const now = Date.now();
  const title = String(getSession(safeSessionId)?.title || '').trim() || 'New chat';
  target.sessions.unshift({ id: safeSessionId, title, createdAt: now, updatedAt: now });
  target.updatedAt = now;
  saveProject(target);
  return target;
}

/** Remove project membership only. The chat record is never deleted. */
export function detachSessionFromProject(projectId: string, sessionId: string): boolean {
  assertSafeStorageId(projectId, 'project id');
  const safeSessionId = assertSafeStorageId(sessionId, 'session id');
  const project = loadProjectFromDisk(projectId);
  if (!project) return false;
  if (!project.sessions.some((session) => session.id === safeSessionId)) return false;
  project.sessions = project.sessions.filter(s => s.id !== safeSessionId);
  project.updatedAt = Date.now();
  saveProject(project);
  return true;
}

/** Explicit destructive path: detach membership, then delete the chat record. Callers must opt in. */
export function deleteSessionFromProject(projectId: string, sessionId: string): boolean {
  const safeSessionId = assertSafeStorageId(sessionId, 'session id');
  detachSessionFromProject(projectId, safeSessionId);
  return deleteSession(safeSessionId);
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Validate a user/agent-supplied project directory against the configured workspace
 * and allowed_paths. Shared by the REST router and prometheus_thread_ops.
 * Returns '' when no directory was supplied.
 */
export function resolveAllowedProjectDirectory(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const selected = path.resolve(raw);
  const cfg = getConfig().getConfig() as any;
  const allowedRoots = [cfg?.workspace?.path, ...(Array.isArray(cfg?.tools?.permissions?.files?.allowed_paths)
    ? cfg.tools.permissions.files.allowed_paths
    : [])]
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
  if (!allowedRoots.some((root) => isPathInside(root, selected))) {
    const error: any = new Error('Project directory is outside the configured workspace paths. Add it to Settings before linking it.');
    error.code = 'PROJECT_DIR_NOT_ALLOWED';
    throw error;
  }
  return selected;
}

export function findProjectBySessionId(sessionId: string): Project | null {
  if (!isSafeStorageId(sessionId)) return null;
  const ownerId = ensureSessionOwnerIndex().get(sessionId);
  if (!ownerId) return null;
  const owner = loadProjectFromDisk(ownerId);
  if (owner && owner.sessions.some(s => s.id === sessionId)) return owner;
  // Stale entry (file changed outside the store): rebuild from disk once and retry.
  sessionOwnerIndex = null;
  const rebuiltOwnerId = ensureSessionOwnerIndex().get(sessionId);
  return rebuiltOwnerId ? loadProjectFromDisk(rebuiltOwnerId) : null;
}

// ─── Knowledge Files ─────────────────────────────────────────────────────────

function resolveKnowledgeFilePath(
  projectId: string,
  file: ProjectKnowledgeFile,
): { path: string; relPath: string } | null {
  const knowledgeDir = getProjectKnowledgeDir(projectId);
  const candidates: string[] = [];
  if (typeof file?.relPath === 'string' && file.relPath.trim()) candidates.push(file.relPath.trim());
  if (typeof file?.path === 'string' && file.path.trim()) {
    candidates.push(path.relative(knowledgeDir, path.resolve(file.path)));
  }
  for (const relative of candidates) {
    try {
      const resolved = resolveConfinedStoragePath(knowledgeDir, relative, { label: 'project knowledge file' });
      return { path: resolved, relPath: path.relative(knowledgeDir, resolved).split(path.sep).join('/') };
    } catch {
      // Ignore tampered/legacy candidates that are not confined to this project.
    }
  }
  return null;
}

export function addKnowledgeFile(
  projectId: string,
  name: string,
  absPath: string,
  sizeBytes: number
): ProjectKnowledgeFile | null {
  assertSafeStorageId(projectId, 'project id');
  const project = loadProjectFromDisk(projectId);
  if (!project) return null;

  const knowledgeDir = getProjectKnowledgeDir(projectId);
  const relPath = path.relative(knowledgeDir, path.resolve(absPath));
  const resolvedPath = resolveConfinedStoragePath(knowledgeDir, relPath, { label: 'project knowledge file' });

  let tokens = 0;
  try { tokens = estimateTokens(fs.readFileSync(resolvedPath, 'utf-8')); }
  catch { tokens = Math.ceil(sizeBytes / 4); }

  const kf: ProjectKnowledgeFile = {
    id: 'kf_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12),
    name: path.basename(name),
    path: resolvedPath,
    relPath: relPath.split(path.sep).join('/'),
    sizeBytes,
    tokens,
    addedAt: Date.now(),
  };

  project.knowledge = project.knowledge.filter(f => f.name !== name);
  project.knowledge.push(kf);
  project.updatedAt = Date.now();
  saveProject(project);
  console.log(`[ProjectStore] Added knowledge file "${name}" to ${projectId} (~${tokens} tokens)`);
  return kf;
}

export function removeKnowledgeFile(projectId: string, fileId: string): boolean {
  const project = loadProjectFromDisk(projectId);
  if (!project) return false;
  const file = project.knowledge.find(f => f.id === fileId);
  if (!file) return false;
  const resolved = resolveKnowledgeFilePath(projectId, file);
  if (!resolved) return false;
  if (fs.existsSync(resolved.path)) { try { fs.unlinkSync(resolved.path); } catch {} }
  project.knowledge = project.knowledge.filter(f => f.id !== fileId);
  project.updatedAt = Date.now();
  saveProject(project);
  return true;
}

export function listKnowledgeFiles(projectId: string): ProjectKnowledgeFile[] {
  const project = loadProjectFromDisk(projectId);
  if (!project) return [];
  return project.knowledge.flatMap((file) => {
    const resolved = resolveKnowledgeFilePath(projectId, file);
    if (!resolved || !fs.existsSync(resolved.path)) return [];
    return [{ ...file, path: resolved.path, relPath: resolved.relPath }];
  });
}

export function getKnowledgeFileContent(projectId: string, fileId: string): string | null {
  const project = loadProjectFromDisk(projectId);
  if (!project) return null;
  const file = project.knowledge.find(f => f.id === fileId);
  if (!file) return null;
  const resolved = resolveKnowledgeFilePath(projectId, file);
  if (!resolved || !fs.existsSync(resolved.path)) return null;
  try { return fs.readFileSync(resolved.path, 'utf-8'); } catch { return null; }
}

// ─── Context Injection ────────────────────────────────────────────────────────

/**
 * Build the project context block injected into every session prompt for this project.
 * Called from prompt-context.ts → buildPersonalityContext().
 * Returns null if sessionId doesn't belong to any project.
 */
export function buildProjectContextBlock(sessionId: string): string | null {
  const found = findProjectBySessionId(sessionId);
  if (!found) return null;
  const project = ensureProjectContextV2(found);

  const lines: string[] = [`[PROJECT: ${project.name}]`, ''];

  const instructions = String(project.instructions || '').trim();
  if (instructions) {
    lines.push('## Project instructions (written by the user; follow them)');
    lines.push(clipText(instructions, INSTRUCTIONS_PROMPT_MAX_CHARS));
    lines.push('');
  }

  const folder = project.workspacePath?.trim() || '';
  if (folder) {
    lines.push('## Linked folder');
    lines.push(folder);
    lines.push('Use this folder as the project workspace. Keep file reads, edits, and commands scoped to it unless the user explicitly asks otherwise.');
    lines.push('');
    for (const file of readFolderInstructionFiles(folder)) {
      lines.push(`## ${file.name} (from the linked folder; follow it like Codex and Claude Code do)`);
      lines.push(file.content);
      lines.push('');
    }
  }

  const contextPath = getProjectContextFilePath(project.id);
  try {
    const notes = projectNotesForPrompt(getProjectContextContent(project.id) || '');
    if (notes) {
      lines.push(`## Project notes (${contextPath})`);
      lines.push(notes);
      lines.push('');
    }
  } catch {}

  // Knowledge files listing
  const knowledgeFiles = listKnowledgeFiles(project.id);
  if (knowledgeFiles.length > 0) {
    lines.push(`## Knowledge Files (${knowledgeFiles.length})`);
    for (const f of knowledgeFiles) {
      lines.push(`- ${f.name} (~${f.tokens} tokens) → ${f.path}`);
    }
    lines.push('');
    lines.push('Use read_file to access any knowledge file above.');
    lines.push('');
  }

  // Notes maintenance: the model owns the notes file, never the Instructions.
  lines.push(`PROJECT NOTES: ${contextPath} holds short notes you keep for this project (decisions, current status, key facts). Update it in the same turn only when something durable changes; revise existing entries instead of appending duplicates, and keep it under about ${NOTES_PROMPT_MAX_LINES} lines. Never copy the user's instructions into it and never edit the project instructions. Leave the "${NOTES_REVIEW_HEADING}" section alone unless the user asks.`);

  return lines.join('\n');
}
