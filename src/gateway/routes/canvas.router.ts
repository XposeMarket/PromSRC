/**
 * canvas.router.ts — B2 Refactor
 *
 * Canvas File API + Preview + Utility routes.
 * Extracted verbatim from server-v2.ts (was L5279-L5558).
 *
 * GET  /api/canvas/file           — read a workspace file for the canvas
 * POST /api/canvas/file           — write canvas edits back to workspace
 * POST /api/canvas/upload         — copy an uploaded file into workspace/uploads/
 * GET  /api/canvas/files          — list workspace files for the file browser
 * POST /api/canvas/open           — register a file as open in canvas
 * POST /api/canvas/close          — remove a file from canvas tracking
 * GET  /preview                   — serve a workspace file as renderable HTML
 * GET  /api/preview/screenshot    — take a screenshot of the preview route
 * GET  /api/open-path             — open a path in the OS file manager
 * POST /api/clear-history         — clear chat history for a session
 */

import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { getConfig } from '../../config/config';
import { getSession, clearHistory, getWorkspace } from '../session';
import { hookBus } from '../hooks';
import { browserPreviewScreenshot } from '../browser-tools';
import { sessionCanvasFiles, addCanvasFile, removeCanvasFile } from './canvas-state';

export const router = Router();

let _requireGatewayAuth: any;
let _broadcastWS: (msg: any) => void = () => {};

export function initCanvasRouter(deps: {
  requireGatewayAuth: any;
  broadcastWS: (msg: any) => void;
}): void {
  _requireGatewayAuth = deps.requireGatewayAuth;
  _broadcastWS = deps.broadcastWS;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/canvas/file?path=<workspace-relative-path>
// Returns file content from the workspace for the canvas to display.
router.get('/api/canvas/file', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const relPath = String(req.query.path || '').trim();
  if (!relPath) { res.status(400).json({ success: false, error: 'path query param required' }); return; }
  const workspacePath = getConfig().getWorkspacePath();
  const absPath = relPath.startsWith(workspacePath) ? relPath : path.join(workspacePath, relPath);
  // Block path traversal outside workspace
  const rel = path.relative(workspacePath, absPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    res.status(403).json({ success: false, error: 'Path outside workspace' }); return;
  }
  try {
    if (!fs.existsSync(absPath)) { res.status(404).json({ success: false, error: 'File not found' }); return; }
    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) { res.status(400).json({ success: false, error: 'Path is a directory' }); return; }
    // Detect image files — return as base64 instead of trying to read as utf-8
    const ext = path.extname(absPath).toLowerCase().slice(1);
    const IMAGE_EXTS: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
      ico: 'image/x-icon', svg: 'image/svg+xml',
      tiff: 'image/tiff', tif: 'image/tiff',
    };
    if (IMAGE_EXTS[ext]) {
      const buffer = fs.readFileSync(absPath);
      const base64 = buffer.toString('base64');
      const mimeType = IMAGE_EXTS[ext];
      res.json({ success: true, path: relPath, absPath, isImage: true, base64, mimeType, size: stat.size, mtime: stat.mtime });
      return;
    }
    const content = fs.readFileSync(absPath, 'utf-8');
    res.json({ success: true, path: relPath, absPath, content, size: stat.size, mtime: stat.mtime });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/canvas/file  body: { path, content }
// Writes content back to the workspace file from the canvas.
router.post('/api/canvas/file', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const relPath = String(req.body?.path || '').trim();
  const content = req.body?.content;
  if (!relPath) { res.status(400).json({ success: false, error: 'path required' }); return; }
  if (typeof content !== 'string') { res.status(400).json({ success: false, error: 'content must be a string' }); return; }
  const workspacePath = getConfig().getWorkspacePath();
  const absPath = relPath.startsWith(workspacePath) ? relPath : path.join(workspacePath, relPath);
  const rel = path.relative(workspacePath, absPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    res.status(403).json({ success: false, error: 'Path outside workspace' }); return;
  }
  try {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, 'utf-8');
    _broadcastWS({ type: 'canvas_saved', path: relPath, absPath, size: content.length });
    res.json({ success: true, path: relPath, absPath, size: content.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/canvas/upload  body: { filename, content (text) }
// Copies a user-uploaded file into workspace/uploads/ so the AI can work on it
// without touching the user's original. Returns the workspace path for canvas.
router.post('/api/canvas/upload', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const rawName = String(req.body?.filename || '').trim().replace(/[^a-zA-Z0-9._\-() ]/g, '_');
  const content  = req.body?.content;
  if (!rawName) { res.status(400).json({ success: false, error: 'filename required' }); return; }
  if (typeof content !== 'string') { res.status(400).json({ success: false, error: 'content must be a string' }); return; }
  const workspacePath = getConfig().getWorkspacePath();
  const uploadsDir = path.join(workspacePath, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  // Deduplicate: if file exists, prefix with timestamp
  let finalName = rawName;
  if (fs.existsSync(path.join(uploadsDir, finalName))) {
    const ts = Date.now();
    const dot = rawName.lastIndexOf('.');
    finalName = dot > 0 ? rawName.slice(0, dot) + '_' + ts + rawName.slice(dot) : rawName + '_' + ts;
  }
  const absPath = path.join(uploadsDir, finalName);
  const relPath = path.relative(workspacePath, absPath);
  try {
    fs.writeFileSync(absPath, content, 'utf-8');
    res.json({ success: true, filename: finalName, relPath, absPath });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/canvas/upload-binary  body: { filename, base64, mimeType }
// Saves a binary file (image, pdf, docx, xls…) from base64 into workspace/uploads/
router.post('/api/canvas/upload-binary', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const rawName = String(req.body?.filename || '').trim().replace(/[^a-zA-Z0-9._\-() ]/g, '_');
  const base64  = req.body?.base64;
  if (!rawName) { res.status(400).json({ success: false, error: 'filename required' }); return; }
  if (typeof base64 !== 'string' || !base64) { res.status(400).json({ success: false, error: 'base64 required' }); return; }
  const workspacePath = getConfig().getWorkspacePath();
  const uploadsDir = path.join(workspacePath, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  let finalName = rawName;
  if (fs.existsSync(path.join(uploadsDir, finalName))) {
    const ts = Date.now();
    const dot = rawName.lastIndexOf('.');
    finalName = dot > 0 ? rawName.slice(0, dot) + '_' + ts + rawName.slice(dot) : rawName + '_' + ts;
  }
  const absPath = path.join(uploadsDir, finalName);
  const relPath = path.relative(workspacePath, absPath);
  try {
    // Strip data URL prefix if present (e.g. "data:image/png;base64,...")
    const pureBase64 = base64.replace(/^data:[^;]+;base64,/, '');
    fs.writeFileSync(absPath, Buffer.from(pureBase64, 'base64'));
    res.json({ success: true, filename: finalName, relPath, absPath });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/canvas/files  — lists workspace files for the canvas file browser
router.get('/api/canvas/files', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (_req: any, res: any) => {
  const workspacePath = getConfig().getWorkspacePath();
  function walk(dir: string, base: string): any[] {
    const results: any[] = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const relPath = base ? `${base}/${e.name}` : e.name;
        if (e.isDirectory()) {
          results.push({ type: 'dir', name: e.name, path: relPath, children: walk(path.join(dir, e.name), relPath) });
        } else {
          results.push({ type: 'file', name: e.name, path: relPath });
        }
      }
    } catch {}
    return results;
  }
  res.json({ success: true, files: walk(workspacePath, '') });
});

// POST /api/canvas/open  body: { sessionId, path }
// Registers a file as open in the canvas so the AI knows its exact path.
router.post('/api/canvas/open', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), (req: any, res: any) => {
  const { sessionId = 'default', path: filePath } = req.body;
  if (!filePath) { res.status(400).json({ error: 'path required' }); return; }
  const workspacePath = getConfig().getWorkspacePath();
  const absPath = require('path').isAbsolute(filePath)
    ? filePath
    : require('path').join(workspacePath, filePath);
  addCanvasFile(String(sessionId), absPath);
  res.json({ success: true, tracked: sessionCanvasFiles.get(String(sessionId)) || [] });
});

// POST /api/canvas/close  body: { sessionId, path }
// Removes a file from the canvas tracking when the user closes its tab.
router.post('/api/canvas/close', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), (req: any, res: any) => {
  const { sessionId = 'default', path: filePath } = req.body;
  if (!filePath) { res.status(400).json({ error: 'path required' }); return; }
  const workspacePath = getConfig().getWorkspacePath();
  const absPath = require('path').isAbsolute(filePath)
    ? filePath
    : require('path').join(workspacePath, filePath);
  removeCanvasFile(String(sessionId), absPath);
  res.json({ success: true, tracked: sessionCanvasFiles.get(String(sessionId)) || [] });
});

// ─── File Preview Routes (used by Telegram /browse preview feature) ─────────────────────
// These routes are ONLY called by the Telegram channel's file browser.
// They do not touch handleChat, sessions, SSE streams, or any main chat state.

// GET /preview?path=<rel>&token=<tok>
// Serves any workspace file as renderable HTML. HTML files are served as-is;
// other text types are wrapped in a clean styled HTML template.
router.get('/preview', async (req: any, res: any) => {
  const cfg = getConfig().getConfig() as any;
  const configuredToken = String(cfg?.gateway?.auth_token || '').trim();
  if (configuredToken) {
    const provided = String(req.query.token || '').trim();
    if (!provided || provided !== configuredToken) {
      res.status(401).send('<h1>Unauthorized</h1>');
      return;
    }
  } else {
    const remoteIp = String(req.ip || req.socket?.remoteAddress || '');
    const isLocal = remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1';
    if (!isLocal) { res.status(401).send('<h1>Unauthorized</h1>'); return; }
  }

  const relPath = String(req.query.path || '').trim();
  if (!relPath) { res.status(400).send('<h1>path required</h1>'); return; }
  const workspacePath = getConfig().getWorkspacePath();
  const absPath = relPath.startsWith(workspacePath) ? relPath : path.join(workspacePath, relPath);
  const rel = path.relative(workspacePath, absPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) { res.status(403).send('<h1>Forbidden</h1>'); return; }
  if (!fs.existsSync(absPath)) { res.status(404).send('<h1>File not found</h1>'); return; }

  const ext = path.extname(absPath).toLowerCase().slice(1);
  const content = fs.readFileSync(absPath, 'utf-8');
  const fileName = path.basename(absPath);

  // HTML — serve directly
  if (ext === 'html' || ext === 'htm') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(content);
    return;
  }

  // SVG — serve directly
  if (ext === 'svg') {
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.send(content);
    return;
  }

  // JSON — syntax-highlighted HTML
  if (ext === 'json') {
    let pretty = content;
    try { pretty = JSON.stringify(JSON.parse(content), null, 2); } catch {}
    const escaped = pretty.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${fileName}</title>
<style>*{box-sizing:border-box}body{margin:0;background:#1e1e2e;color:#cdd6f4;font-family:'Cascadia Code','Fira Code','Consolas',monospace;font-size:13px;line-height:1.6;padding:20px}pre{white-space:pre-wrap;word-break:break-word}h2{color:#89b4fa;margin:0 0 12px;font-size:14px;font-weight:600}</style>
</head><body><h2>📄 ${fileName}</h2><pre>${escaped}</pre></body></html>`);
    return;
  }

  // Markdown — render with a simple inline renderer
  if (ext === 'md' || ext === 'markdown') {
    const html = content
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^```[\s\S]*?^```/gm, (m) => `<pre><code>${m.slice(m.indexOf('\n')+1, m.lastIndexOf('```')).trim()}</code></pre>`)
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
      .replace(/^(?!<[hul]|$)(.+)$/gm, '<p>$1</p>')
      .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${fileName}</title>
<style>*{box-sizing:border-box}body{margin:0;background:#fff;color:#1a1a1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.7;max-width:860px;margin:0 auto;padding:32px 24px}h1,h2,h3{color:#111;margin-top:1.5em}code{background:#f3f4f6;padding:2px 6px;border-radius:4px;font-family:monospace;font-size:13px}pre{background:#f3f4f6;padding:16px;border-radius:8px;overflow-x:auto}pre code{background:none;padding:0}a{color:#2563eb}li{margin:4px 0}p{margin:0.8em 0}</style>
</head><body>${html}</body></html>`);
    return;
  }

  // CSV — render as styled table
  if (ext === 'csv' || ext === 'tsv') {
    const sep = ext === 'tsv' ? '\t' : ',';
    const rows = content.split('\n').filter(Boolean).map(r => r.split(sep).map(c => c.replace(/^["']|["']$/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')));
    const thead = rows[0]?.map(c => `<th>${c}</th>`).join('') || '';
    const tbody = rows.slice(1).map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${fileName}</title>
<style>*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;background:#f9fafb;padding:16px}h2{color:#374151;font-size:14px;margin:0 0 10px}table{border-collapse:collapse;width:100%;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)}th{background:#374151;color:#fff;padding:8px 12px;text-align:left;font-weight:600}td{padding:7px 12px;border-bottom:1px solid #e5e7eb;color:#111}tr:last-child td{border-bottom:none}tr:nth-child(even) td{background:#f9fafb}</style>
</head><body><h2>📊 ${fileName}</h2><table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></body></html>`);
    return;
  }

  // All other text types (ts, js, py, txt, yaml, etc.) — syntax-highlighted code view
  const escaped = content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const langClass = ['ts','js','py','sh','rs','go','java','cpp','c','css'].includes(ext) ? ext : 'text';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${fileName}</title>
<style>*{box-sizing:border-box}body{margin:0;background:#1e1e2e;color:#cdd6f4;font-family:'Cascadia Code','Fira Code','Consolas',monospace;font-size:13px;line-height:1.6}header{background:#181825;padding:10px 20px;color:#89b4fa;font-size:13px;font-weight:600;border-bottom:1px solid #313244;position:sticky;top:0;z-index:10}pre{margin:0;padding:20px;white-space:pre-wrap;word-break:break-word}.line-num{color:#585b70;user-select:none;display:inline-block;min-width:3em;text-align:right;margin-right:16px;font-size:11px}</style>
</head><body><header>💻 ${fileName} &nbsp;<span style="color:#585b70;font-weight:400">.${ext}</span></header><pre>${
  escaped.split('\n').map((line, i) => `<span class="line-num">${i+1}</span>${line}`).join('\n')
}</pre></body></html>`);
});

// GET /api/preview/screenshot?path=<rel>&token=<tok>
// Takes a full-page screenshot of the /preview route for a given file and
// returns the chunks as base64-encoded PNGs. Called only by Telegram.
router.get('/api/preview/screenshot', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const relPath = String(req.query.path || '').trim();
  if (!relPath) { res.status(400).json({ error: 'path required' }); return; }

  const cfg = getConfig().getConfig() as any;
  const token = String(cfg?.gateway?.auth_token || '').trim();
  const port = Number(cfg?.gateway?.port || 18789);
  const host = '127.0.0.1'; // always localhost — preview is internal only
  const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
  const previewUrl = `http://${host}:${port}/preview?path=${encodeURIComponent(relPath)}${tokenParam}`;

  try {
    const chunks = await browserPreviewScreenshot(previewUrl, 1200, 10);
    res.json({ success: true, chunks, total: chunks.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/open-path — open a path in the OS file manager / shell
router.get('/api/open-path', async (req: any, res: any) => {
  const fp = req.query.path as string;
  if (!fp) { res.status(400).json({ error: 'Path required' }); return; }
  try {
    const { exec } = await import('child_process');
    const cmd = process.platform === 'win32' ? `start "" "${fp}"` : process.platform === 'darwin' ? `open "${fp}"` : `xdg-open "${fp}"`;
    exec(cmd, (err) => { err ? res.status(500).json({ error: err.message }) : res.json({ success: true }); });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /api/clear-history — clear chat history for a session
router.post('/api/clear-history', async (req: any, res: any) => {
  const sid = req.body.sessionId || 'default';
  const ws = getWorkspace(sid) || (getConfig().getConfig() as any).workspace?.path || '';
  if (ws) {
    await hookBus.fire({
      type: 'command:reset',
      sessionId: sid,
      workspacePath: ws,
      timestamp: Date.now(),
    });
    await hookBus.fire({
      type: 'command:new',
      sessionId: sid,
      workspacePath: ws,
      timestamp: Date.now(),
    });
  }
  clearHistory(sid);
  res.json({ success: true });
});
