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

export function createApp(): express.Application {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // Serve the web UI from web-ui/
  const webUiPath = path.join(__dirname, '..', '..', '..', 'web-ui');
  app.use(express.static(webUiPath));

  // Serve shared assets (icons, images, etc.)
  const assetsPath = path.join(__dirname, '..', '..', '..', 'assets');
  app.use('/assets', express.static(assetsPath));

  return app;
}
