import { payloadContainsRecognizableSecret } from '../../security/secret-format-guard';
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
import fs from 'fs';
import crypto from 'crypto';
import { getPublicWebUiRoot, hasPublicWebUiBuild, isPublicDistributionBuild, resolvePrometheusRoot } from '../../runtime/distribution.js';
import { buildGatewayCorsOptions } from '../gateway-auth';
import { isModelBusy, getLastMainSessionId } from '../comms/broadcaster';
import { listLiveRuntimes } from '../live-runtime-registry';
import { getMemoryIndexRefreshWorkerStatus } from '../memory-index/refresh-worker-client';
import { providerWebhookRawBodyMiddleware, resolveHookConfig } from '../comms/webhook-handler';
import { registerStartupAsyncRequest } from '../startup-async-diagnostics';
import { registerCreativeCompositionRoutes } from '../routes/creative-composition.routes';
import { registerVideoProjectRoutes } from '../routes/video-project.routes';
import { registerGameProjectRoutes } from '../routes/game-project.routes';
import { initVideoProjectWake } from '../video-project-wake';
import { getConfig } from '../../config/config';
import { triggerHookRawBodyMiddleware } from '../routes/triggers.router';
import { staticCacheControl } from './static-cache';
import { compressLargeJsonResponses, pickJsonResponseEncoding } from './json-response';

// Kept importable from core/app for existing callers and tests.
export { compressLargeJsonResponses, pickJsonResponseEncoding };

const startedAt = Date.now();
// Request timing is intentionally separate from the normal startup profile:
// it is useful while diagnosing a live stall, but should not add a listener to
// every HTTP response in the fast path.
const STARTUP_HTTP_PROFILE = process.env.PROMETHEUS_STARTUP_DIAGNOSTICS === '1';

function setStaticCacheHeaders(res: express.Response, filePath: string): void {
  res.setHeader('Cache-Control', staticCacheControl(filePath));
}

// Raw-module (dev) builds ship service-worker.js with the constant sentinel
// ASSET_BUILD_ID = 'source-build', so the worker bytes never change and phones
// keep serving cached /src modules across merges. Stamp a digest of the live
// web-ui sources into the worker instead: any source change produces new worker
// bytes, the browser installs it, old caches are dropped and the page reloads.
const SW_BUILD_SENTINEL = "const ASSET_BUILD_ID = 'source-build';";
const SW_DIGEST_TTL_MS = 5_000;
let swDigestCache: { root: string; at: number; digest: string } | null = null;

export function computeWebUiSourceDigest(webUiRoot: string): string {
  const hash = crypto.createHash('sha1');
  const walk = (dir: string) => {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.isFile()) continue;
      try {
        const st = fs.statSync(full);
        hash.update(`${path.relative(webUiRoot, full)}|${st.size}|${Math.floor(st.mtimeMs)}\n`);
      } catch {}
    }
  };
  walk(path.join(webUiRoot, 'src'));
  for (const name of ['index.html', 'mobile.html', 'service-worker.js']) {
    try {
      const st = fs.statSync(path.join(webUiRoot, name));
      hash.update(`${name}|${st.size}|${Math.floor(st.mtimeMs)}\n`);
    } catch {}
  }
  return `src-${hash.digest('hex').slice(0, 16)}`;
}

function webUiSourceDigest(webUiRoot: string): string {
  const now = Date.now();
  if (swDigestCache && swDigestCache.root === webUiRoot && now - swDigestCache.at < SW_DIGEST_TTL_MS) {
    return swDigestCache.digest;
  }
  const digest = computeWebUiSourceDigest(webUiRoot);
  swDigestCache = { root: webUiRoot, at: now, digest };
  return digest;
}

export function stampServiceWorkerSource(source: string, digest: string): string {
  if (!source.includes(SW_BUILD_SENTINEL)) return source;
  return source.replace(SW_BUILD_SENTINEL, `const ASSET_BUILD_ID = '${digest}';`);
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
  // Trigger webhook endpoints verify HMAC over the exact raw bytes, so they
  // also bypass the JSON parser (2 MiB cap enforced by the raw parser).
  app.use('/triggers/hook', triggerHookRawBodyMiddleware());
  // Credential bodies are deliberately small and never reflected by parser errors.
  // rawBody: owner-consent headers (PR821 I1) bind the SHA-256 of the exact bytes sent.
  const keepRawBody = (req: any, _res: any, buf: Buffer) => { req.rawBody = Buffer.from(buf); };
  app.use(['/api/secure-access', '/api/connection-secure-input', '/api/connections/credentials', '/api/auth/x-api/credentials', '/api/protected-plugins', '/api/connections-v2', '/api/connections/disconnect', '/api/auth/x-api/disconnect'], express.json({ limit: '32kb', verify: keepRawBody }));
  app.use(['/api/pairing/approve', '/api/pairing/devices', '/api/owner-consent'], express.json({ limit: '64kb', verify: keepRawBody }));
  app.use(express.json({ limit: '50mb' }));
  // Before chat admission/audit/history/model work. Never reflect rejected input.
  app.use((req, res, next) => {
    const chatWrite = req.method !== 'GET' && /^\/api\/(chat(?:\/|$)|sessions\/[^/]+\/(?:messages|history|edit-rerun-reset|steer|queue|send|edit)(?:\/|$))/.test(req.path);
    if (chatWrite && payloadContainsRecognizableSecret(req.body)) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(400).json({ error: 'PROTECTED_ENTRY_REQUIRED', message: 'Recognizable credential blocked. Remove it or use Add secret in the protected card.' }); return;
    }
    next();
  });
  // Large res.json() bodies are brotli/gzip-compressed with ETag/304 intact;
  // SSE, static files and small replies are untouched (see core/json-response.ts).
  app.use(compressLargeJsonResponses);

  // Creative video compositions are a gateway-owned workspace resource. Mount
  // the small route family at app creation so the editor and agent tools share
  // one persistent multi-clip contract instead of maintaining a UI-only bridge.
  registerCreativeCompositionRoutes(app);
  // Generative video projects (shots/takes/timeline). Server-owned, op-based.
  registerVideoProjectRoutes(app);
  registerGameProjectRoutes(app);
  try { initVideoProjectWake(getConfig().getWorkspacePath()); } catch (err: any) { console.warn('[VideoProjectWake] init failed:', err?.message || err); }

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
  app.get('/service-worker.js', (req, res, next) => {
    const swPath = path.join(webUiPath, 'service-worker.js');
    let source = '';
    try { source = fs.readFileSync(swPath, 'utf8'); } catch { return next(); }
    // Production builds already carry a content digest; only stamp raw sources.
    if (!source.includes(SW_BUILD_SENTINEL)) return next();
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Service-Worker-Allowed', '/');
    res.send(stampServiceWorkerSource(source, webUiSourceDigest(webUiPath)));
  });
  app.use(express.static(webUiPath, { etag: true, lastModified: true, setHeaders: setStaticCacheHeaders }));

  const pretextDistPath = path.join(root, 'node_modules', '@chenglou', 'pretext', 'dist');
  app.use('/vendor/pretext', express.static(pretextDistPath, { etag: true, lastModified: true, maxAge: '1d' }));

  const jsPdfDistPath = path.join(root, 'node_modules', 'jspdf', 'dist');
  app.use('/vendor/jspdf', express.static(jsPdfDistPath, { etag: true, lastModified: true, maxAge: '1d' }));

  // html2canvas is only the DOM-to-canvas input adapter for the mobile Liquid
  // Glass bridge. The optical renderer itself remains the exact vendored
  // XposeMarket/liquid-glass compositor under web-ui/src/vendor/liquid-glass.js.
  const html2CanvasDistPath = path.join(root, 'node_modules', 'html2canvas', 'dist');
  app.use('/vendor/html2canvas', express.static(html2CanvasDistPath, { etag: true, lastModified: true, maxAge: '1d' }));

  // Serve shared assets (icons, images, etc.)
  const assetsPath = path.join(root, 'assets');
  app.use('/assets', express.static(assetsPath));

  return app;
}
