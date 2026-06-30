/**
 * core/app.ts — B3 Refactor
 *
 * Express application factory: creates the app instance, applies all
 * middleware, and mounts static file serving.
 *
 * Called once by server-v2.ts. The returned `app` is the same object
 * used everywhere else — nothing changes at runtime.
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { getPublicWebUiRoot, hasPublicWebUiBuild, isPublicDistributionBuild, resolvePrometheusRoot } from '../../runtime/distribution.js';
import { buildGatewayCorsOptions } from '../gateway-auth';
import { isModelBusy, getLastMainSessionId } from '../comms/broadcaster';
import { listLiveRuntimes } from '../live-runtime-registry';

const startedAt = Date.now();

function setStaticCacheHeaders(res: express.Response, filePath: string): void {
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.endsWith('/index.html')) {
    res.setHeader('Cache-Control', 'no-cache');
    return;
  }
  if (normalized.includes('/static/') || normalized.includes('/vendor/') || normalized.includes('/assets/')) {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return;
  }
  res.setHeader('Cache-Control', 'no-cache');
}

export function createApp(): express.Application {
  const app = express();

  app.use(cors(buildGatewayCorsOptions()));
  app.use(express.json({ limit: '50mb' }));

  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      uptimeMs: Date.now() - startedAt,
      pid: process.pid,
      timestamp: Date.now(),
      modelBusy: isModelBusy(),
      lastMainSessionId: getLastMainSessionId(),
      activeRuntimes: listLiveRuntimes().map((runtime) => ({
        id: runtime.id,
        kind: runtime.kind,
        label: runtime.label,
        startedAt: runtime.startedAt,
        sessionId: runtime.sessionId,
      })),
    });
  });

  const root = resolvePrometheusRoot();
  const webUiPath = isPublicDistributionBuild() && hasPublicWebUiBuild()
    ? getPublicWebUiRoot()
    : path.join(root, 'web-ui');
  app.use(express.static(webUiPath, { etag: true, lastModified: true, setHeaders: setStaticCacheHeaders }));

  const pretextDistPath = path.join(root, 'node_modules', '@chenglou', 'pretext', 'dist');
  app.use('/vendor/pretext', express.static(pretextDistPath, { etag: true, lastModified: true, maxAge: '1d' }));

  const jsPdfDistPath = path.join(root, 'node_modules', 'jspdf', 'dist');
  app.use('/vendor/jspdf', express.static(jsPdfDistPath, { etag: true, lastModified: true, maxAge: '1d' }));

  // Serve shared assets (icons, images, etc.)
  const assetsPath = path.join(root, 'assets');
  app.use('/assets', express.static(assetsPath));

  return app;
}
