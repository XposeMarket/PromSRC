/**
 * projects.router.ts — Projects REST API
 *
 * No external dependencies beyond express (already installed).
 * File uploads use the same base64 JSON pattern as canvas.router.ts.
 *
 * Endpoints:
 *   GET    /api/projects
 *   POST   /api/projects                            { name }
 *   GET    /api/projects/:id
 *   PATCH  /api/projects/:id                        { name?, instructions?, memorySnapshot? }
 *   DELETE /api/projects/:id?deleteSessions=true|false   (default false: chats are kept, only membership is removed)
 *   POST   /api/projects/:id/sessions               { isOnboarding? }
 *   POST   /api/projects/:id/sessions/attach        { sessionId } (moves an existing chat in; leaves any other project)
 *   DELETE /api/projects/:id/sessions/:sessionId?deleteChat=true|false   (default false: detach only)
 *   GET    /api/projects/:id/files
 *   POST   /api/projects/:id/files                  { filename, content?, base64?, mimeType? }
 *   GET    /api/projects/:id/files/:fileId/content
 *   DELETE /api/projects/:id/files/:fileId
 *
 * Mounted by the gateway route index. Business logic lives in ../projects/project-store.ts.
 */

import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  addSessionToProject,
  attachSessionToProject,
  detachSessionFromProject,
  deleteSessionFromProject,
  resolveAllowedProjectDirectory,
  addKnowledgeFile,
  removeKnowledgeFile,
  listKnowledgeFiles,
  getKnowledgeFileContent,
  getProjectKnowledgeFilePath,
  getProjectContextContent,
} from '../projects/project-store.js';
import { refreshProjectContextFromLatestPriorSession } from '../projects/project-learning.js';
import { getSession, sessionExists } from '../session.js';
import { isStorageBoundaryError } from '../storage/storage-paths.js';

const router = Router();

function sendProjectError(res: Response, err: any, fallback: string): void {
  res.status(isStorageBoundaryError(err) ? 400 : 500).json({ error: err?.message || fallback });
}

/** Strict boolean query parsing: only "true" or "false" are accepted. Returns null when invalid. */
function parseStrictBooleanQuery(value: unknown, fallback: boolean): boolean | null {
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function hydrateProjectSessions(project: any): any {
  const sessions = Array.isArray(project?.sessions) ? project.sessions : [];
  return {
    ...project,
    sessions: sessions.map((stored: any) => {
      try {
        const sessionId = String(stored.id || '');
        if (!sessionExists(sessionId)) return stored;
        const session = getSession(sessionId);
        const firstUserMsg = session.history?.find((m: any) => m.role === 'user');
        const title = session.externalImport?.source
          ? (session.title || firstUserMsg?.content || stored.title || 'New chat')
          : firstUserMsg?.content
          ? String(firstUserMsg.content).slice(0, 60)
          : (stored.title || 'New chat');
        const lastHistoryMessage = session.history?.[session.history.length - 1];
        return {
          ...stored,
          title,
          createdAt: session.createdAt || stored.createdAt,
          updatedAt: session.lastActiveAt || stored.updatedAt,
          messageCount: session.history?.length || 0,
          preview: String(session.history?.slice().reverse().find((message: any) => (message?.role === 'user' || message?.role === 'assistant') && String(message?.content || '').trim())?.content || '').replace(/\s+/g, ' ').trim().slice(0, 240),
          lastMessageAt: Number(lastHistoryMessage?.timestamp || session.lastActiveAt || stored.updatedAt || 0) || undefined,
        };
      } catch {
        return stored;
      }
    }),
  };
}

router.get('/api/projects', (_req: Request, res: Response) => {
  try { res.json(listProjects().map(hydrateProjectSessions)); }
  catch (err: any) { sendProjectError(res, err, 'Failed to list projects'); }
});

router.post('/api/projects', (req: Request, res: Response) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    res.status(201).json(createProject(name, resolveAllowedProjectDirectory(req.body?.workspacePath)));
  } catch (err: any) { sendProjectError(res, err, 'Failed to create project'); }
});

router.get('/api/projects/:id', (req: Request, res: Response) => {
  try {
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(hydrateProjectSessions(project));
  } catch (err: any) { sendProjectError(res, err, 'Failed to get project'); }
});

router.get('/api/projects/:id/context', (req: Request, res: Response) => {
  try {
    const content = getProjectContextContent(req.params.id);
    if (content === null) return res.status(404).json({ error: 'Project context not found' });
    res.json({ filename: 'CONTEXT.md', content });
  } catch (err: any) { sendProjectError(res, err, 'Failed to read project context'); }
});

router.patch('/api/projects/:id', (req: Request, res: Response) => {
  try {
    const updates: any = {};
    if (req.body?.name !== undefined) updates.name = String(req.body.name).trim();
    if (req.body?.workspacePath !== undefined) updates.workspacePath = resolveAllowedProjectDirectory(req.body.workspacePath);
    if (req.body?.instructions !== undefined) updates.instructions = String(req.body.instructions);
    if (req.body?.memorySnapshot !== undefined) updates.memorySnapshot = String(req.body.memorySnapshot);
    if (req.body?.pinned !== undefined) updates.pinnedAt = req.body.pinned === true ? Date.now() : undefined;
    const project = updateProject(req.params.id, updates);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (err: any) { sendProjectError(res, err, 'Failed to update project'); }
});

// DELETE /api/projects/:id?deleteSessions=true|false (default false: chats are kept and only lose membership)
router.delete('/api/projects/:id', (req: Request, res: Response) => {
  try {
    const deleteSessions = parseStrictBooleanQuery(req.query.deleteSessions, false);
    if (deleteSessions === null) return res.status(400).json({ error: 'deleteSessions must be true or false' });
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const chatCount = project.sessions.length;
    if (!deleteProject(req.params.id, { keepSessions: !deleteSessions })) return res.status(404).json({ error: 'Project not found' });
    res.json({
      success: true,
      deletedSessions: deleteSessions ? chatCount : 0,
      keptSessions: deleteSessions ? 0 : chatCount,
    });
  } catch (err: any) { sendProjectError(res, err, 'Failed to delete project'); }
});

router.post('/api/projects/:id/sessions', (req: Request, res: Response) => {
  try {
    if (!getProject(req.params.id)) return res.status(404).json({ error: 'Project not found' });
    const sessionId = crypto.randomUUID();
    const isOnboarding = req.body?.isOnboarding === true;
    addSessionToProject(req.params.id, sessionId, isOnboarding ? 'Getting started' : 'New chat');
    void refreshProjectContextFromLatestPriorSession(req.params.id, sessionId).catch((err: any) => {
      console.warn(`[Projects] Prior-session project context refresh failed for ${req.params.id}:`, err?.message || err);
    });
    res.status(201).json({ sessionId, projectId: req.params.id });
  } catch (err: any) { sendProjectError(res, err, 'Failed to create session'); }
});

// POST /api/projects/:id/sessions/attach — move an EXISTING chat into this project (removes it from any other project).
router.post('/api/projects/:id/sessions/attach', (req: Request, res: Response) => {
  try {
    const sessionId = String(req.body?.sessionId || '').trim();
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
    const project = attachSessionToProject(req.params.id, sessionId);
    if (!project) return res.status(404).json({ error: 'Project or session not found' });
    res.json({ success: true, projectId: project.id, sessionId });
  } catch (err: any) { sendProjectError(res, err, 'Failed to attach session'); }
});

// DELETE /api/projects/:id/sessions/:sessionId?deleteChat=true|false (default false: detach only; chat is kept)
router.delete('/api/projects/:id/sessions/:sessionId', (req: Request, res: Response) => {
  try {
    const deleteChat = parseStrictBooleanQuery(req.query.deleteChat, false);
    if (deleteChat === null) return res.status(400).json({ error: 'deleteChat must be true or false' });
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!project.sessions.some((sess) => sess.id === req.params.sessionId))
      return res.status(404).json({ error: 'Session not found in project' });
    if (deleteChat) {
      const deleted = deleteSessionFromProject(req.params.id, req.params.sessionId);
      return res.json({ success: true, deleted });
    }
    detachSessionFromProject(req.params.id, req.params.sessionId);
    res.json({ success: true, deleted: false });
  } catch (err: any) { sendProjectError(res, err, 'Failed to remove session from project'); }
});

router.get('/api/projects/:id/files', (req: Request, res: Response) => {
  try {
    if (!getProject(req.params.id)) return res.status(404).json({ error: 'Project not found' });
    res.json(listKnowledgeFiles(req.params.id));
  } catch (err: any) { sendProjectError(res, err, 'Failed to list files'); }
});

// POST /api/projects/:id/files — JSON body: { filename, content? } or { filename, base64, mimeType? }
// This mirrors the canvas upload pattern — no multer needed.
router.post('/api/projects/:id/files', (req: Request, res: Response) => {
  try {
    if (!getProject(req.params.id)) return res.status(404).json({ error: 'Project not found' });
    const filename = String(req.body?.filename || '').trim();
    if (!filename) return res.status(400).json({ error: 'filename is required' });

    const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._\-]/g, '_');
    if (!safeName || safeName === '.' || safeName === '..') return res.status(400).json({ error: 'filename is invalid' });
    const absPath = getProjectKnowledgeFilePath(req.params.id, safeName);
    let sizeBytes = 0;

    if (req.body?.base64) {
      const buf = Buffer.from(String(req.body.base64), 'base64');
      fs.writeFileSync(absPath, buf);
      sizeBytes = buf.length;
    } else if (req.body?.content !== undefined) {
      const content = String(req.body.content);
      fs.writeFileSync(absPath, content, 'utf-8');
      sizeBytes = Buffer.byteLength(content, 'utf-8');
    } else {
      return res.status(400).json({ error: 'Either content or base64 is required' });
    }

    const kf = addKnowledgeFile(req.params.id, safeName, absPath, sizeBytes);
    if (!kf) return res.status(500).json({ error: 'Failed to register file' });
    res.status(201).json(kf);
  } catch (err: any) { sendProjectError(res, err, 'Failed to upload file'); }
});

router.get('/api/projects/:id/files/:fileId/content', (req: Request, res: Response) => {
  try {
    const content = getKnowledgeFileContent(req.params.id, req.params.fileId);
    if (content === null) return res.status(404).json({ error: 'File not found' });
    res.json({ content });
  } catch (err: any) { sendProjectError(res, err, 'Failed to read file'); }
});

router.delete('/api/projects/:id/files/:fileId', (req: Request, res: Response) => {
  try {
    if (!removeKnowledgeFile(req.params.id, req.params.fileId))
      return res.status(404).json({ error: 'File not found' });
    res.json({ success: true });
  } catch (err: any) { sendProjectError(res, err, 'Failed to delete file'); }
});

export { router };
