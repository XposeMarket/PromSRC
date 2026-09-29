/**
 * HTTP surface for Games mode. Mirrors the game_project tool.
 *
 *   GET  /api/game-projects                    list
 *   POST /api/game-projects                    create { title, pitch, genre, style, setting, multiplayer, engine }
 *   GET  /api/game-projects/:id                full project (+ summary)
 *   POST /api/game-projects/:id/action         { action, ...args } (same names as the tool)
 *   GET  /api/game-projects/:id/media?path=    project file (assets/audio/build)
 *   GET  /api/game-projects/:id/play/*         static playable build (no auth: iframe/share friendly; build/ only)
 *
 * Room relay (SSE + POST; no WebSocket upgrade wiring needed):
 *   GET  /api/game-rooms/:room/events          SSE stream (welcome/join/leave/state)
 *   POST /api/game-rooms/:room/send            { playerId, type?, data }
 *   GET  /api/game-rooms/:room                 { players }
 */
import fs from 'fs';
import path from 'path';
import type { IRouter } from 'express';
import { getConfig } from '../../config/config.js';
import { requireGatewayAuth } from '../gateway-auth.js';
import { getWorkspace, sessionExists } from '../session.js';
import { createGame, gameDir, listGames, loadGame, mutateGame, summarizeGame } from '../../games-engine/project.js';
import { designQuestions } from '../../games-engine/assets.js';
import { joinRoom, leaveRoom, relay, roomInfo, validRoom, type RoomClient } from '../../games-engine/rooms.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm', '.woff2': 'font/woff2',
};

function defaultWorkspaceFor(req: any): string {
  const sessionId = String(req.query?.sessionId || req.body?.sessionId || '').trim();
  if (sessionId && /^[a-z0-9_-]{3,120}$/i.test(sessionId) && sessionExists(sessionId)) {
    const ws = getWorkspace(sessionId);
    if (ws) return ws;
  }
  return getConfig().getWorkspacePath();
}

function sendError(res: any, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error || 'Game project request failed.');
  const status = /not found/i.test(message) ? 404 : /invalid|required|unknown|must|cannot|requires/i.test(message) ? 400 : 500;
  res.status(status).json({ success: false, error: message });
}

/** Resolve a file strictly inside root; null on traversal. */
export function safeJoin(root: string, rel: string): string | null {
  let decoded = rel;
  try { decoded = decodeURIComponent(rel); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const abs = path.resolve(root, '.' + path.posix.sep + decoded.replace(/\\/g, '/'));
  const r = path.resolve(root);
  if (abs !== r && !abs.startsWith(r + path.sep)) return null;
  return abs;
}

function serveFile(res: any, abs: string): void {
  const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(abs).on('error', () => { if (!res.headersSent) res.status(500); res.end(); }).pipe(res);
}

export function registerGameProjectRoutes(router: IRouter, opts: { workspaceFor?: (req: any) => string; auth?: boolean } = {}): void {
  const workspaceFor = opts.workspaceFor || defaultWorkspaceFor;
  // Playable build: public static (iframe + shareable LAN link); confined to build/.
  router.get(/^\/api\/game-projects\/(gp_[A-Za-z0-9_-]{3,64})\/play(\/.*)?$/, (req, res) => {
    const id = String((req.params as any)[0]);
    const tail = String((req.params as any)[1] || '/');
    if (tail === '' || !tail.startsWith('/')) { res.redirect(302, `/api/game-projects/${id}/play/`); return; }
    let buildDir: string;
    try { buildDir = path.join(gameDir(workspaceFor(req), id), 'build'); } catch { res.status(404).end(); return; }
    // Reject raw traversal attempts before normalization.
    const rawUrl = String(req.originalUrl || req.url || '');
    if (/(^|\/|%2f|\\|%5c)(\.\.|%2e%2e|%2e\.|\.%2e)(\/|%2f|\\|%5c|$|\?)/i.test(rawUrl)) { res.status(400).json({ success: false, error: 'Invalid path.' }); return; }
    const rel = tail === '/' ? 'index.html' : tail.slice(1);
    const abs = safeJoin(buildDir, rel);
    if (!abs) { res.status(400).json({ success: false, error: 'Invalid path.' }); return; }
    let target = abs;
    try { if (fs.statSync(target).isDirectory()) target = path.join(target, 'index.html'); } catch { /* missing */ }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) { res.status(404).json({ success: false, error: 'Not found.' }); return; }
    serveFile(res, target);
  });

  // Room relay (public so published/LAN games can join).
  router.get('/api/game-rooms/:room/events', (req, res) => {
    const room = String(req.params.room);
    if (!validRoom(room)) { res.status(400).json({ success: false, error: 'Invalid room.' }); return; }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    let client: RoomClient;
    try { client = joinRoom(room, (m) => { res.write(`data: ${JSON.stringify(m)}\n\n`); }); }
    catch (e) { res.write(`data: ${JSON.stringify({ type: 'error', error: (e as Error).message })}\n\n`); res.end(); return; }
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.on('close', () => { clearInterval(ping); leaveRoom(room, client.id); });
  });
  router.post('/api/game-rooms/:room/send', (req, res) => {
    try {
      const room = String(req.params.room);
      const delivered = relay(room, String(req.body?.playerId || ''), String(req.body?.type || 'state'), req.body?.data ?? null);
      res.json({ success: true, delivered });
    } catch (e) { sendError(res, e); }
  });
  router.get('/api/game-rooms/:room', (req, res) => {
    const room = String(req.params.room);
    if (!validRoom(room)) { res.status(400).json({ success: false, error: 'Invalid room.' }); return; }
    res.json({ success: true, ...roomInfo(room) });
  });

  if (opts.auth !== false) router.use('/api/game-projects', requireGatewayAuth);

  router.get('/api/game-projects', (req, res) => {
    try { res.json({ success: true, projects: listGames(workspaceFor(req)) }); } catch (e) { sendError(res, e); }
  });

  router.post('/api/game-projects', async (req, res) => {
    try {
      const ws = workspaceFor(req);
      const p = createGame(ws, req.body || {});
      const { project } = await mutateGame(ws, p.id, (x) => { x.questions = designQuestions(x.design); });
      res.json({ success: true, project, summary: summarizeGame(project) });
    } catch (e) { sendError(res, e); }
  });

  router.get('/api/game-projects/:id', (req, res) => {
    try { const p = loadGame(workspaceFor(req), req.params.id); res.json({ success: true, project: p, summary: summarizeGame(p) }); }
    catch (e) { sendError(res, e); }
  });

  router.get('/api/game-projects/:id/media', (req, res) => {
    try {
      const dir = gameDir(workspaceFor(req), req.params.id);
      const rel = String(req.query?.path || '').replace(/^.*?game-projects\/gp_[A-Za-z0-9_-]+\//, '');
      const abs = safeJoin(dir, rel);
      if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) { res.status(404).json({ success: false, error: 'Not found.' }); return; }
      serveFile(res, abs);
    } catch (e) { sendError(res, e); }
  });

  router.post('/api/game-projects/:id/action', async (req, res) => {
    try {
      const { executeGameProject } = await import('../../games-engine/tool.js');
      const { sessionId, ...rest } = req.body || {};
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const out = await executeGameProject({ ...rest, projectId: req.params.id }, { workspacePath: workspaceFor(req), sessionId: sessionId || undefined, baseUrl });
      res.json({ success: true, ...(out && typeof out === 'object' && !Array.isArray(out) ? out : { result: out }) });
    } catch (e) { sendError(res, e); }
  });
}
