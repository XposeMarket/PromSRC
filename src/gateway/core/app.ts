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
import zlib from 'zlib';
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

const JSON_COMPRESSION_MIN_BYTES = 16 * 1024;

export function pickJsonResponseEncoding(acceptEncoding: unknown): 'br' | 'gzip' | null {
  const header = String(acceptEncoding || '').trim().toLowerCase();
  if (!header) return null;
  const q = new Map<string, number>();
  let wildcard: number | undefined;
  for (const part of header.split(',')) {
    const [rawToken, ...params] = part.trim().split(';');
    const token = rawToken.trim();
    if (!token) continue;
    let value = 1;
    for (const param of params) {
      const [key, raw] = param.split('=');
      if (String(key || '').trim() !== 'q') continue;
      const parsed = Number(String(raw || '').trim());
      value = Number.isFinite(parsed) ? parsed : 1;
    }
    if (token === '*') wildcard = value;
    else q.set(token, value);
  }
  const ok = (token: string) => {
    const value = q.has(token) ? q.get(token)! : wildcard;
    return value !== undefined && value > 0;
  };
  if (ok('br')) return 'br';
  if (ok('gzip')) return 'gzip';
  return null;
}

export function compressLargeJsonResponses(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const encoding = pickJsonResponseEncoding(req.headers['accept-encoding']);
  if (!encoding || req.method === 'HEAD') { next(); return; }
  const originalJson = res.json.bind(res);
  res.json = ((body: any) => {
    let text: string;
    try { text = JSON.stringify(body); } catch { return originalJson(body); }
    if (text === undefined || Buffer.byteLength(text) < JSON_COMPRESSION_MIN_BYTES || res.headersSent || res.getHeader('Content-Encoding')) {
      return originalJson(body);
    }
    const raw = Buffer.from(text, 'utf8');
    const done = (err: Error | null, compressed?: Buffer) => {
      if (res.headersSent || res.writableEnded) return;
      if (err || !compressed || compressed.length >= raw.length) {
        if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(raw);
        return;
      }
      if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Encoding', encoding);
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Content-Length', String(compressed.length));
      res.end(compressed);
    };
    if (encoding === 'br') {
      zlib.brotliCompress(raw, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
        },
      }, done);
    } else {
      zlib.gzip(raw, { level: 5 }, done);
    }
    return res;
  }) as any;
  next();
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
  // Large JSON API responses (chat history pages reach several MB, mostly
  // repetitive trace JSON) were sent uncompressed. Over LAN/Tailscale that is
  // the dominant cost of opening a thread on mobile: 3.5 MB -> ~340 KB with
  // brotli q4 in ~20 ms. Only res.json() bodies are touched, so SSE streams,
  // static files (compressed separately in core/server.ts) and small replies
  // keep their existing behavior. Compression runs async off the event loop.
  app.use(compressLargeJsonResponses);

  // Creative video compositions are a gateway-owned workspace resource. Mount
  // the small route family at app creation so the editor and agent tools share
  // one persistent multi-clip contract instead of maintaining a UI-only bridge.
  registerCreativeCompositionRoutes(app);

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
