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

export function createApp(): express.Application {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  const root = resolvePrometheusRoot();
  const webUiPath = isPublicDistributionBuild() && hasPublicWebUiBuild()
    ? getPublicWebUiRoot()
    : path.join(root, 'web-ui');
  app.use(express.static(webUiPath, { etag: false, lastModified: false, setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store');
  } }));

  // Serve shared assets (icons, images, etc.)
  const assetsPath = path.join(root, 'assets');
  app.use('/assets', express.static(assetsPath));

  return app;
}
