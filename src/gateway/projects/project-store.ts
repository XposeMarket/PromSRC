/**
 * project-store.ts — Projects System Data Layer
 *
 * Manages persistent Project records stored in:
 *   .prometheus/projects/<id>.json
 *
 * Each project owns:
 *   - Metadata (name, instructions, memorySnapshot)
 *   - A list of session IDs scoped to this project
 *   - A knowledge folder: workspace/projects/<id>/knowledge/
 *   - A CONTEXT.md seed file: workspace/projects/<id>/CONTEXT.md
 *
 * Sessions are regular Prometheus sessions (keyed by UUID in .prometheus/sessions/).
 * The project record just tracks which session IDs belong to it.
 *
 * File layout:
 *   .prometheus/projects/<id>.json          ← project metadata
 *   workspace/projects/<id>/                ← project workspace folder
 *   workspace/projects/<id>/CONTEXT.md      ← living context/knowledge seed
 *   workspace/projects/<id>/knowledge/      ← uploaded knowledge files
 *
 * INSTALL: Place at src/gateway/projects/project-store.ts
 *          (create the projects/ directory first)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getConfig } from '../../config/config.js';
import { deleteSession } from '../session.js';
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

export interface Project {
  id: string;
  name: string;
  instructions: string;
  memorySnapshot: string;
  sessions: ProjectSession[];
  knowledge: ProjectKnowledgeFile[];
  createdAt: number;
  updatedAt: number;
}

// ─── Paths ────────────────────────────────────────────────────────────────────

function getProjectsDir(): string {
  return resolveConfinedStoragePath(getConfig().getConfigDir(), 'projects', { label: 'projects directory' });
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

function saveProject(project: Project): void {
  project.id = assertSafeStorageId(project.id, 'project id');
  ensureProjectDirs(project.id);
  fs.writeFileSync(getProjectFile(project.id), JSON.stringify(project, null, 2), 'utf-8');
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
    if (p) projects.push(p);
  }
  return projects.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getProject(id: string): Project | null {
  return loadProjectFromDisk(id);
}

export function createProject(name: string): Project {
  const id = generateId();
  const now = Date.now();
  ensureProjectDirs(id);

  // Seed CONTEXT.md
  const contextPath = resolveConfinedStoragePath(getProjectWorkspaceDir(id), 'CONTEXT.md', { label: 'project context file' });
  if (!fs.existsSync(contextPath)) {
    fs.writeFileSync(contextPath, [
      `# ${name}`,
      '',
      '> This file is automatically maintained by Prometheus as the living context for this project.',
      '> It is injected into every chat session within this project.',
      '',
      '## Overview',
      '',
      '*(Prometheus will fill this in after your first conversation.)*',
      '',
      '## Goals',
      '',
      '## Key People & Entities',
      '',
      '## Tech Stack & Tools',
      '',
      '## Timeline & Milestones',
      '',
      '## Notes',
      '',
    ].join('\n'), 'utf-8');
  }

  const project: Project = {
    id, name,
    instructions: '',
    memorySnapshot: '',
    sessions: [],
    knowledge: [],
    createdAt: now,
    updatedAt: now,
  };
  saveProject(project);
  console.log(`[ProjectStore] Created project "${name}" (${id})`);
  return project;
}

export function updateProject(
  id: string,
  updates: Partial<Pick<Project, 'name' | 'instructions' | 'memorySnapshot'>>
): Project | null {
  const project = loadProjectFromDisk(id);
  if (!project) return null;

  if (updates.name !== undefined) project.name = updates.name;
  if (updates.instructions !== undefined) project.instructions = updates.instructions;
  if (updates.memorySnapshot !== undefined) {
    project.memorySnapshot = updates.memorySnapshot;
    // Mirror into CONTEXT.md Memory Snapshot section
    const contextPath = resolveConfinedStoragePath(getProjectWorkspaceDir(id), 'CONTEXT.md', { label: 'project context file' });
    try {
      const existing = fs.existsSync(contextPath) ? fs.readFileSync(contextPath, 'utf-8') : '';
      const marker = '## Memory Snapshot';
      const newSection = `${marker}\n\n${updates.memorySnapshot}\n`;
      const updated = existing.includes(marker)
        ? existing.replace(new RegExp(`${marker}[\\s\\S]*?(?=\n##\\s|$)`), newSection)
        : existing + '\n' + newSection;
      fs.writeFileSync(contextPath, updated, 'utf-8');
    } catch (e: any) {
      console.warn(`[ProjectStore] CONTEXT.md update failed for ${id}:`, e?.message);
    }
  }

  project.updatedAt = Date.now();
  saveProject(project);
  return project;
}

export function deleteProject(id: string): boolean {
  const project = loadProjectFromDisk(id);
  if (!project) return false;

  // Delete all owned session files
  for (const sess of project.sessions) {
    try { deleteSession(sess.id); } catch {}
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

export function removeSessionFromProject(
  projectId: string,
  sessionId: string
): Project | null {
  assertSafeStorageId(projectId, 'project id');
  const safeSessionId = assertSafeStorageId(sessionId, 'session id');
  const project = loadProjectFromDisk(projectId);
  if (!project) return null;
  if (!project.sessions.some((session) => session.id === safeSessionId)) return null;
  project.sessions = project.sessions.filter(s => s.id !== safeSessionId);
  project.updatedAt = Date.now();
  saveProject(project);
  deleteSession(safeSessionId);
  return project;
}

export function findProjectBySessionId(sessionId: string): Project | null {
  if (!isSafeStorageId(sessionId)) return null;
  return listProjects().find(p => p.sessions.some(s => s.id === sessionId)) || null;
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
  const project = findProjectBySessionId(sessionId);
  if (!project) return null;

  const lines: string[] = [`[PROJECT: ${project.name}]`, ''];

  if (project.instructions?.trim()) {
    lines.push('## Project Instructions');
    lines.push(project.instructions.trim());
    lines.push('');
  }

  if (project.memorySnapshot?.trim()) {
    lines.push('## Project Memory');
    lines.push(project.memorySnapshot.trim());
    lines.push('');
  }

  // CONTEXT.md
  const contextPath = resolveConfinedStoragePath(getProjectWorkspaceDir(project.id), 'CONTEXT.md', { label: 'project context file' });
  if (fs.existsSync(contextPath)) {
    try {
      const content = fs.readFileSync(contextPath, 'utf-8').trim();
      if (content) {
        lines.push('## Project Context');
        lines.push(content.length > 2000 ? content.slice(0, 2000) + '\n... (truncated)' : content);
        lines.push('');
      }
    } catch {}
  }

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

  // ── MANDATORY project context writing rule (injected at top of system context) ──
  // This is intentionally terse and imperative — buried instructions get ignored.
  // (contextPath is already declared above — reuse it)
  const isFirstSession = project.sessions.length <= 1;
  lines.unshift('');  // blank line after rule
  lines.unshift(`MANDATORY RULE — PROJECT CONTEXT: After EVERY turn where the user shares anything about this project (goals, people, tools, clients, deadlines, decisions), you MUST call create_file or find_replace to update the file at: ${contextPath} — Update the relevant sections (Overview, Goals, Key People & Entities, Tech Stack & Tools, Timeline & Milestones). Do this in the SAME turn, before replying. Never skip this. Never leave placeholder text in the file.`);
  if (isFirstSession) {
    lines.unshift('This is the FIRST session for this project. The user has not described it yet. Your first message must ask what the project is about.');
  }

  return lines.join('\n');
}
