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
import { getMemoryIndexRefreshWorkerStatus } from '../memory-index/refresh-worker-client';
import { providerWebhookRawBodyMiddleware, resolveHookConfig } from '../comms/webhook-handler';
import { registerStartupAsyncRequest } from '../startup-async-diagnostics';

const startedAt = Date.now();
// Request timing is intentionally separate from the normal startup profile:
// it is useful while diagnosing a live stall, but should not add a listener to
// every HTTP response in the fast path.
const STARTUP_HTTP_PROFILE = process.env.PROMETHEUS_STARTUP_DIAGNOSTICS === '1';

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

  app.use((req, _res, next) => {
    registerStartupAsyncRequest(`${req.method} ${req.path || '/'}`);
    if (STARTUP_HTTP_PROFILE) {
      const requestStartedAt = Date.now();
      _res.once('finish', () => {
        const elapsedMs = Date.now() - requestStartedAt;
        if (elapsedMs >= 500) {
          try { process.stderr.write(`[startup-http] ${req.method} ${req.path || '/'} status=${_res.statusCode} durationMs=${elapsedMs}\n`); } catch {}
        }
      });
    }
    next();
  });
  // CORS is request-aware so the mobile hub bridge can be allowed narrowly
  // for pairing claim/poll, gateway catalog reads, and paired-device
  // execution requests carrying a target-scoped grant.
  app.use((req, res, next) => cors(buildGatewayCorsOptions(req))(req, res, next));
  // Provider routes must enforce their smaller limit before the general JSON
  // parser buffers or parses the request. The raw parser preserves exact HMAC bytes.
  const hookPath = resolveHookConfig().path;
  app.use(`${hookPath}/provider/:provider`, providerWebhookRawBodyMiddleware());
  app.use(express.json({ limit: '50mb' }));

  app.get('/api/health', (_req, res) => {
    const memoryMaintenance = getMemoryIndexRefreshWorkerStatus();
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
      memoryMaintenance: {
        isolation: memoryMaintenance.isolation,
        state: memoryMaintenance.broker.state,
        pid: memoryMaintenance.broker.pid,
        active: !!memoryMaintenance.runningWorkspace,
        activeKind: memoryMaintenance.runningKind,
        queuedWorkspaces: memoryMaintenance.queuedWorkspaces,
        queuedJobs: memoryMaintenance.queuedJobs,
        lastRunStartedAt: memoryMaintenance.lastRunStartedAt,
        lastRunCompletedAt: memoryMaintenance.lastRunCompletedAt,
      },
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
