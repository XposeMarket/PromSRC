import fs from 'fs';
import path from 'path';
import type { Router } from 'express';

import { getConfig } from '../../config/config.js';
import {
  addClip,
  addTrack,
  createEmptyComposition,
  deleteClip,
  lintComposition,
  moveClip,
  selectClip,
  setTransition,
  splitClip,
  trimClip,
} from '../creative/composition.js';
import { normalizeCreativeComposition, type CreativeComposition, type CreativeTrackKind } from '../creative/contracts.js';
import { renderComposition } from '../creative/renderers/composition_renderer.js';
import { getWorkspace, sessionExists } from '../session.js';
import { assertSafeStorageId, isStorageBoundaryError } from '../storage/storage-paths.js';

function sessionIdFrom(value: unknown): string {
  const sessionId = assertSafeStorageId(String(value || '').trim(), 'session');
  if (!sessionExists(sessionId)) throw new Error('Creative session not found.');
  return sessionId;
}

function compositionRoot(sessionId: string): string {
  const workspacePath = getWorkspace(sessionId) || getConfig().getWorkspacePath();
  const root = path.join(workspacePath, 'creative-projects', sessionId);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function compositionPath(sessionId: string): string {
  return path.join(compositionRoot(sessionId), 'composition.json');
}

function defaultComposition(): CreativeComposition {
  const composition = createEmptyComposition();
  addTrack(composition, 'video', 'V1');
  return composition;
}

function loadComposition(sessionId: string): CreativeComposition {
  const filePath = compositionPath(sessionId);
  if (!fs.existsSync(filePath)) return defaultComposition();
  try {
    return normalizeCreativeComposition(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return defaultComposition();
  }
}

function saveComposition(sessionId: string, composition: CreativeComposition): CreativeComposition {
  const normalized = normalizeCreativeComposition(composition);
  const filePath = compositionPath(sessionId);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(normalized, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
  return normalized;
}

function sendError(res: any, error: unknown, fallback: string): void {
  const message = error instanceof Error ? error.message : String(error || fallback);
  res.status(isStorageBoundaryError(error) ? 400 : 500).json({ success: false, error: message || fallback });
}

export function registerCreativeCompositionRoutes(router: Router): void {
  router.get('/api/canvas/composition', (req, res) => {
    try {
      const sessionId = sessionIdFrom(req.query.sessionId);
      const composition = loadComposition(sessionId);
      res.json({ success: true, composition, lint: lintComposition(composition) });
    } catch (error) {
      sendError(res, error, 'Could not load Creative video composition.');
    }
  });

  router.post('/api/canvas/composition', (req, res) => {
    try {
      const sessionId = sessionIdFrom(req.body?.sessionId);
      let composition = req.body?.composition
        ? normalizeCreativeComposition(req.body.composition)
        : loadComposition(sessionId);
      const action = String(req.body?.action || (req.body?.composition ? 'save' : '')).trim().toLowerCase();

      switch (action) {
        case 'save':
          break;
        case 'add_track':
          addTrack(composition, String(req.body?.kind || 'video') as CreativeTrackKind, req.body?.label ? String(req.body.label) : undefined);
          break;
        case 'add_clip':
          addClip(composition, req.body?.clip || req.body || {});
          break;
        case 'select_clip':
          selectClip(composition, req.body?.clipId == null ? null : String(req.body.clipId));
          break;
        case 'move_clip':
          moveClip(composition, String(req.body?.clipId || ''), {
            trackId: req.body?.trackId ? String(req.body.trackId) : undefined,
            atMs: Number.isFinite(Number(req.body?.atMs)) ? Number(req.body.atMs) : undefined,
            deltaMs: Number.isFinite(Number(req.body?.deltaMs)) ? Number(req.body.deltaMs) : undefined,
          });
          break;
        case 'trim_clip':
          trimClip(composition, String(req.body?.clipId || ''), req.body?.edge === 'head' ? 'head' : 'tail', Number(req.body?.toMs));
          break;
        case 'split_at':
          splitClip(composition, String(req.body?.clipId || composition.selectedClipId || ''), Number(req.body?.atMs));
          break;
        case 'delete_clip':
          deleteClip(composition, String(req.body?.clipId || composition.selectedClipId || ''), { ripple: req.body?.ripple === true });
          break;
        case 'set_transition':
          setTransition(composition, String(req.body?.clipId || composition.selectedClipId || ''), req.body?.edge === 'in' ? 'in' : 'out', req.body?.transition || null);
          break;
        default:
          return res.status(400).json({ success: false, error: 'Unknown composition action.' });
      }

      composition = saveComposition(sessionId, composition);
      res.json({ success: true, composition, lint: lintComposition(composition) });
    } catch (error) {
      sendError(res, error, 'Could not update Creative video composition.');
    }
  });

  router.post('/api/canvas/composition/lint', (req, res) => {
    try {
      const sessionId = sessionIdFrom(req.body?.sessionId);
      const composition = req.body?.composition
        ? normalizeCreativeComposition(req.body.composition)
        : loadComposition(sessionId);
      res.json({ success: true, ...lintComposition(composition) });
    } catch (error) {
      sendError(res, error, 'Could not lint Creative video composition.');
    }
  });

  router.post('/api/canvas/composition/render', async (req, res) => {
    try {
      const sessionId = sessionIdFrom(req.body?.sessionId);
      const workspacePath = getWorkspace(sessionId) || getConfig().getWorkspacePath();
      const composition = req.body?.composition
        ? saveComposition(sessionId, normalizeCreativeComposition(req.body.composition))
        : loadComposition(sessionId);
      const lint = lintComposition(composition);
      if (!lint.ok) return res.status(400).json({ success: false, error: 'Composition has blocking lint errors.', lint });

      const format = String(req.body?.format || 'mp4').toLowerCase() === 'webm' ? 'webm' : 'mp4';
      const exportDir = path.join(compositionRoot(sessionId), 'exports');
      fs.mkdirSync(exportDir, { recursive: true });
      const requestedName = String(req.body?.filename || `video-${Date.now()}.${format}`);
      const safeName = path.basename(requestedName).replace(/[^a-zA-Z0-9._-]/g, '_') || `video-${Date.now()}.${format}`;
      const outputPath = path.join(exportDir, safeName.toLowerCase().endsWith(`.${format}`) ? safeName : `${safeName}.${format}`);
      const result = await renderComposition({ composition, workspacePath, outputPath, format });
      res.json({
        success: true,
        result,
        path: path.relative(workspacePath, result.outputPath).replace(/\\/g, '/'),
        lint,
      });
    } catch (error) {
      sendError(res, error, 'Could not render Creative video composition.');
    }
  });
}
