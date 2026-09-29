/**
 * HTTP surface for generative video projects. Mirrors the video_project tool
 * so the editor UI, phone and Prom all drive the same server-owned document.
 *
 *   GET  /api/video-projects                         list
 *   POST /api/video-projects                         create
 *   GET  /api/video-projects/models                  catalog
 *   GET  /api/video-projects/providers               provider readiness
 *   GET  /api/video-projects/:id                     full project (+ history depth)
 *   GET  /api/video-projects/:id/summary             compact summary
 *   GET  /api/video-projects/:id/events              SSE: version bumps
 *   POST /api/video-projects/:id/ops                 { ops } -> one undo step (actor=user)
 *   POST /api/video-projects/:id/undo | /redo
 *   POST /api/video-projects/:id/estimate            { shotIds?, count?, modelId? }
 *   POST /api/video-projects/:id/generate            { shotIds?, count?, modelId?, approved? }
 *   POST /api/video-projects/:id/jobs/:jobId/cancel
 *   POST /api/video-projects/:id/render              { output? }
 *   GET  /api/video-projects/:id/media?path=...      stream a project media file
 */
import fs from 'fs';
import path from 'path';
import type { IRouter } from 'express';
import { getConfig } from '../../config/config.js';
import { requireGatewayAuth } from '../gateway-auth.js';
import { getWorkspace, sessionExists } from '../session.js';
import { listModels } from '../../media-engine/catalog.js';
import { providerStatus } from '../../media-engine/providers.js';
import {
  applyOps, createProject, historyDepth, listProjects, loadProject, onProjectChange, projectDir,
  summarizeProject, undoRedo,
} from '../../media-engine/project.js';
import { cancelJob, estimate, generateShots, renderProject, resumeJobs } from '../../media-engine/engine.js';

function workspaceFor(req: any): string {
  const sessionId = String(req.query?.sessionId || req.body?.sessionId || '').trim();
  if (sessionId && /^[a-z0-9_-]{3,120}$/i.test(sessionId) && sessionExists(sessionId)) {
    const ws = getWorkspace(sessionId);
    if (ws) return ws;
  }
  return getConfig().getWorkspacePath();
}

function sendError(res: any, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error || 'Video project request failed.');
  const status = /not found/i.test(message) ? 404 : /invalid|required|unknown|must|cannot/i.test(message) ? 400 : 500;
  res.status(status).json({ success: false, error: message });
}

const resumed = new Set<string>();
function ensureResumed(ws: string): void {
  if (resumed.has(ws)) return;
  resumed.add(ws);
  try { resumeJobs(ws); } catch { /* ignore */ }
}

export function registerVideoProjectRoutes(router: IRouter): void {
  router.use('/api/video-projects', requireGatewayAuth);

  // Resume in-flight provider jobs shortly after startup for the default workspace.
  setTimeout(() => { try { ensureResumed(getConfig().getWorkspacePath()); } catch { /* ignore */ } }, 5000).unref?.();

  router.get('/api/video-projects', (req, res) => {
    try { const ws = workspaceFor(req); ensureResumed(ws); res.json({ success: true, projects: listProjects(ws) }); }
    catch (e) { sendError(res, e); }
  });

  router.post('/api/video-projects', async (req, res) => {
    try {
      const b = req.body || {};
      const p = await createProject(workspaceFor(req), { title: b.title, brief: b.brief, target: b.target, defaults: b.defaults, budget: b.budget });
      res.json({ success: true, project: p });
    } catch (e) { sendError(res, e); }
  });

  router.get('/api/video-projects/models', (req, res) => {
    try { res.json({ success: true, models: listModels({ kind: req.query.kind as any, provider: req.query.provider as any }) }); }
    catch (e) { sendError(res, e); }
  });

  router.get('/api/video-projects/providers', async (_req, res) => {
    try { res.json({ success: true, providers: await providerStatus() }); }
    catch (e) { sendError(res, e); }
  });

  router.get('/api/video-projects/:id', (req, res) => {
    try {
      const ws = workspaceFor(req);
      res.json({ success: true, project: loadProject(ws, req.params.id), history: historyDepth(ws, req.params.id) });
    } catch (e) { sendError(res, e); }
  });

  router.get('/api/video-projects/:id/summary', (req, res) => {
    try {
      const ws = workspaceFor(req);
      res.json({ success: true, summary: summarizeProject(loadProject(ws, req.params.id), historyDepth(ws, req.params.id)) });
    } catch (e) { sendError(res, e); }
  });

  router.get('/api/video-projects/:id/events', (req, res) => {
    const ws = workspaceFor(req);
    const id = String(req.params.id);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    const off = onProjectChange((ev) => {
      if (ev.projectId !== id || ev.workspacePath !== ws) return;
      res.write(`data: ${JSON.stringify({ version: ev.version, op: ev.op })}\n\n`);
    });
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => { off(); clearInterval(ping); });
  });

  router.post('/api/video-projects/:id/ops', async (req, res) => {
    try {
      const ws = workspaceFor(req);
      const { project, summaries } = await applyOps(ws, req.params.id, req.body?.ops, 'user');
      res.json({ success: true, applied: summaries, project, history: historyDepth(ws, req.params.id) });
    } catch (e) { sendError(res, e); }
  });

  for (const dir of ['undo', 'redo'] as const) {
    router.post(`/api/video-projects/:id/${dir}`, async (req, res) => {
      try {
        const ws = workspaceFor(req);
        const out = await undoRedo(ws, req.params.id, dir, 'user');
        res.json({ success: true, applied: out.applied, project: out.project, history: historyDepth(ws, req.params.id) });
      } catch (e) { sendError(res, e); }
    });
  }

  router.post('/api/video-projects/:id/estimate', async (req, res) => {
    try { res.json({ success: true, ...(await estimate(workspaceFor(req), req.params.id, req.body || {})) }); }
    catch (e) { sendError(res, e); }
  });

  router.post('/api/video-projects/:id/generate', async (req, res) => {
    try {
      const b = req.body || {};
      // The user pressing Generate in the UI is the approval.
      res.json({ success: true, ...(await generateShots(workspaceFor(req), req.params.id, { shotIds: b.shotIds, count: b.count, modelId: b.modelId, approved: b.approved === true })) });
    } catch (e) { sendError(res, e); }
  });

  router.post('/api/video-projects/:id/jobs/:jobId/cancel', async (req, res) => {
    try { res.json({ success: true, canceled: await cancelJob(workspaceFor(req), req.params.id, req.params.jobId) }); }
    catch (e) { sendError(res, e); }
  });

  router.post('/api/video-projects/:id/render', async (req, res) => {
    try { res.json({ success: true, ...(await renderProject(workspaceFor(req), req.params.id, { output: req.body?.output })) }); }
    catch (e) { sendError(res, e); }
  });

  router.get('/api/video-projects/:id/media', (req, res) => {
    try {
      const ws = workspaceFor(req);
      const root = projectDir(ws, req.params.id);
      const rel = String(req.query.path || '');
      const abs = path.resolve(ws, rel);
      const inside = path.relative(root, abs);
      if (!rel || inside.startsWith('..') || path.isAbsolute(inside)) { res.status(400).json({ success: false, error: 'path must be inside the project.' }); return; }
      if (!fs.existsSync(abs)) { res.status(404).json({ success: false, error: 'not found' }); return; }
      res.sendFile(abs);
    } catch (e) { sendError(res, e); }
  });
}
