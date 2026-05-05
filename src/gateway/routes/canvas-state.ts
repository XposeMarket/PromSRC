/**
 * canvas-state.ts - Shared canvas session file tracking state
 *
 * Tracks open files in memory and reads persisted project-root metadata from
 * the session store so the chat runtime can inject a richer canvas context.
 */

import fs from 'fs';
import path from 'path';
import { getCanvasProjectLabel, getCanvasProjectLink, getCanvasProjectRoot, getCreativeMode, getWorkspace } from '../session';

export const sessionCanvasFiles: Map<string, string[]> = new Map();

export function addCanvasFile(sessionId: string, absPath: string): void {
  const sid = String(sessionId || 'default');
  const existing = sessionCanvasFiles.get(sid) || [];
  if (!existing.includes(absPath)) {
    existing.push(absPath);
    sessionCanvasFiles.set(sid, existing);
  }
}

export function removeCanvasFile(sessionId: string, absPath: string): void {
  const sid = String(sessionId || 'default');
  const existing = sessionCanvasFiles.get(sid) || [];
  sessionCanvasFiles.set(sid, existing.filter(p => p !== absPath));
}

function listProjectEntries(absRoot: string, maxEntries = 30): string[] {
  const items: string[] = [];
  const visit = (dir: string, depth: number): void => {
    if (items.length >= maxEntries || depth > 3) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const sorted = entries
      .filter((entry) => !entry.name.startsWith('.'))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    for (const entry of sorted) {
      if (items.length >= maxEntries) break;
      const absPath = path.join(dir, entry.name);
      const relPath = path.relative(absRoot, absPath).replace(/\\/g, '/');
      if (!relPath) continue;
      if (entry.isDirectory()) {
        items.push(`${'  '.repeat(depth)}- ${relPath}/`);
        visit(absPath, depth + 1);
      } else {
        items.push(`${'  '.repeat(depth)}- ${relPath}`);
      }
    }
  };
  visit(absRoot, 0);
  return items;
}

function sanitizeCreativeStorageSegment(raw: string, fallback = 'default'): string {
  const cleaned = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

function getDefaultCreativeStorageRoot(sessionId: string): string {
  const workspace = getWorkspace(sessionId) || process.cwd();
  return path.join(workspace, 'creative-projects', sanitizeCreativeStorageSegment(sessionId, 'default'));
}

export function getCanvasContextBlock(sessionId: string): string {
  const sid = String(sessionId || 'default');
  const files = sessionCanvasFiles.get(sid) || [];
  const projectRoot = getCanvasProjectRoot(sid);
  const projectLabel = getCanvasProjectLabel(sid);
  const projectLink = getCanvasProjectLink(sid);
  const creativeMode = getCreativeMode(sid);
  const parts: string[] = [];

  if (projectRoot) {
    const header = [
      '[CANVAS - active project root]',
      `root: ${projectRoot}`,
      projectLabel ? `label: ${projectLabel}` : undefined,
      'Treat this folder as the primary working directory for canvas-related tasks unless the user says otherwise.',
    ].filter(Boolean).join('\n');
    parts.push(header);

    if (fs.existsSync(projectRoot)) {
      const entries = listProjectEntries(projectRoot, 30);
      if (entries.length > 0) {
        parts.push(`[CANVAS - project file snapshot]\n${entries.join('\n')}`);
      }
    }
  }

  if (files.length > 0) {
    const list = files.map(f => `  - ${f}`).join('\n');
    parts.push(`[CANVAS - files currently open in the editor]\n${list}\nWhen reading or editing these files use the exact paths above.`);
  }

  if (projectLink && (projectLink.github || projectLink.vercel)) {
    const linkLines = ['[CANVAS - linked publishing surfaces]'];
    if (projectLink.github?.repoFullName || projectLink.github?.remoteUrl) {
      linkLines.push(`github_repo: ${projectLink.github.repoFullName || '(unresolved)'}`);
      if (projectLink.github.remoteUrl) linkLines.push(`github_remote: ${projectLink.github.remoteUrl}`);
      if (projectLink.github.branch) linkLines.push(`github_branch: ${projectLink.github.branch}`);
    }
    if (projectLink.vercel?.projectId || projectLink.vercel?.projectName) {
      linkLines.push(`vercel_project: ${projectLink.vercel.projectName || projectLink.vercel.projectId || '(unresolved)'}`);
      if (projectLink.vercel.deploymentUrl) linkLines.push(`vercel_live_url: ${projectLink.vercel.deploymentUrl}`);
    }
    parts.push(linkLines.join('\n'));
  }

  if (creativeMode === 'image' || creativeMode === 'canvas' || creativeMode === 'video') {
    const creativeRoot = projectRoot || getDefaultCreativeStorageRoot(sid);
    const creativeLines = [
      '[CANVAS - creative asset storage]',
      `mode: ${creativeMode}`,
      `root: ${creativeRoot}`,
      'Use this folder for saved scene JSON, rendered exports, and any supporting creative assets for Image/Video work.',
    ];
    const creativeMetaRoot = path.join(creativeRoot, 'prometheus-creative');
    if (fs.existsSync(creativeMetaRoot)) {
      const entries = listProjectEntries(creativeMetaRoot, 20);
      if (entries.length > 0) {
        creativeLines.push('saved_assets:');
        creativeLines.push(...entries);
      }
    }
    parts.push(creativeLines.join('\n'));
  }

  return parts.join('\n\n');
}
