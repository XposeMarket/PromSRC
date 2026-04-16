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
 *   DELETE /api/projects/:id
 *   POST   /api/projects/:id/sessions               { isOnboarding? }
 *   DELETE /api/projects/:id/sessions/:sessionId
 *   GET    /api/projects/:id/files
 *   POST   /api/projects/:id/files                  { filename, content?, base64?, mimeType? }
 *   GET    /api/projects/:id/files/:fileId/content
 *   DELETE /api/projects/:id/files/:fileId
 *
 * INSTALL:
 *   1. Create folder:  D:\Prometheus\src\gateway\projects\
 *   2. Place project-store.ts in that folder
 *   3. Place this file at  D:\Prometheus\src\gateway\routes\projects.router.ts
 *   4. In server-v2.ts, add import + mount (see bottom of file)
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
  removeSessionFromProject,
  addKnowledgeFile,
  removeKnowledgeFile,
  listKnowledgeFiles,
  getKnowledgeFileContent,
  getProjectKnowledgeDir,
} from '../projects/project-store.js';
import { refreshProjectContextFromLatestPriorSession } from '../projects/project-learning.js';
import { getSession, sessionExists } from '../session.js';

const router = Router();

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
        const title = firstUserMsg?.content
          ? String(firstUserMsg.content).slice(0, 60)
          : (stored.title || 'New chat');
        return {
          ...stored,
          title,
          createdAt: session.createdAt || stored.createdAt,
          updatedAt: session.lastActiveAt || stored.updatedAt,
          messageCount: session.history?.length || 0,
        };
      } catch {
        return stored;
      }
    }),
  };
}

router.get('/api/projects', (_req: Request, res: Response) => {
  try { res.json(listProjects().map(hydrateProjectSessions)); }
  catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to list projects' }); }
});

router.post('/api/projects', (req: Request, res: Response) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    res.status(201).json(createProject(name));
  } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to create project' }); }
});

router.get('/api/projects/:id', (req: Request, res: Response) => {
  try {
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(hydrateProjectSessions(project));
  } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to get project' }); }
});

router.patch('/api/projects/:id', (req: Request, res: Response) => {
  try {
    const updates: any = {};
    if (req.body?.name !== undefined) updates.name = String(req.body.name).trim();
    if (req.body?.instructions !== undefined) updates.instructions = String(req.body.instructions);
    if (req.body?.memorySnapshot !== undefined) updates.memorySnapshot = String(req.body.memorySnapshot);
    const project = updateProject(req.params.id, updates);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to update project' }); }
});

router.delete('/api/projects/:id', (req: Request, res: Response) => {
  try {
    if (!deleteProject(req.params.id)) return res.status(404).json({ error: 'Project not found' });
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to delete project' }); }
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
  } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to create session' }); }
});

router.delete('/api/projects/:id/sessions/:sessionId', (req: Request, res: Response) => {
  try {
    if (!removeSessionFromProject(req.params.id, req.params.sessionId))
      return res.status(404).json({ error: 'Project or session not found' });
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to delete session' }); }
});

router.get('/api/projects/:id/files', (req: Request, res: Response) => {
  try {
    if (!getProject(req.params.id)) return res.status(404).json({ error: 'Project not found' });
    res.json(listKnowledgeFiles(req.params.id));
  } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to list files' }); }
});

// POST /api/projects/:id/files — JSON body: { filename, content? } or { filename, base64, mimeType? }
// This mirrors the canvas upload pattern — no multer needed.
router.post('/api/projects/:id/files', (req: Request, res: Response) => {
  try {
    if (!getProject(req.params.id)) return res.status(404).json({ error: 'Project not found' });
    const filename = String(req.body?.filename || '').trim();
    if (!filename) return res.status(400).json({ error: 'filename is required' });

    const knowledgeDir = getProjectKnowledgeDir(req.params.id);
    if (!fs.existsSync(knowledgeDir)) fs.mkdirSync(knowledgeDir, { recursive: true });

    const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._\-]/g, '_');
    const absPath = path.join(knowledgeDir, safeName);
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
  } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to upload file' }); }
});

router.get('/api/projects/:id/files/:fileId/content', (req: Request, res: Response) => {
  try {
    const content = getKnowledgeFileContent(req.params.id, req.params.fileId);
    if (content === null) return res.status(404).json({ error: 'File not found' });
    res.json({ content });
  } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to read file' }); }
});

router.delete('/api/projects/:id/files/:fileId', (req: Request, res: Response) => {
  try {
    if (!removeKnowledgeFile(req.params.id, req.params.fileId))
      return res.status(404).json({ error: 'File not found' });
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to delete file' }); }
});

export { router };

/*
 * ─── server-v2.ts WIRING ─────────────────────────────────────────────────────
 *
 * Add this import alongside the other router imports:
 *   import { router as projectsRouter } from './routes/projects.router';
 *
 * Add this mount alongside the other app.use() calls:
 *   app.use('/', projectsRouter);
 *
 * ─── prompt-context.ts WIRING ────────────────────────────────────────────────
 *
 * In buildPersonalityContext(), after EACH of the 3 lines:
 *   const business = loadWorkspaceFile(workspacePath, 'BUSINESS.md', 1200);
 *
 * Add:
 *   let projectContextBlock = '';
 *   try {
 *     const { buildProjectContextBlock } = await import('./projects/project-store.js');
 *     projectContextBlock = buildProjectContextBlock(sessionId) || '';
 *   } catch {}
 *
 * Then in each parts[] array, after the business entry, add:
 *   projectContextBlock ? `[PROJECT_CONTEXT]\n${projectContextBlock}` : '',
 */
