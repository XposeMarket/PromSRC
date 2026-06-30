/**
 * core/server.ts — B3 Refactor
 *
 * HTTP + WebSocket server factory.
 * Creates the http.Server and WebSocketServer, wires the WS event handlers,
 * and attaches error listeners that exit on EADDRINUSE.
 *
 * Called once by server-v2.ts immediately after createApp().
 * Returns { server, wss } — the same objects used everywhere else.
 */

import http from 'http';
import https from 'https';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { getConfig } from '../../config/config';
import { getPublicWebUiRoot, hasPublicWebUiBuild, isPublicDistributionBuild, resolvePrometheusRoot } from '../../runtime/distribution.js';
import { setWss } from '../comms/broadcaster';
import { hookBus } from '../hooks';
import { listPendingStartupNotifications, markStartupNotificationDelivered } from '../lifecycle';
import {
  browserHandleUserInput,
  browserInspectPoint,
  browserGetInteractableMap,
  setBrowserLiveSelectionFromPack,
  clearBrowserLiveSelectionTracker,
  getBrowserNamedElementsForSession,
  saveBrowserNamedElement,
  saveBrowserTeachSessionSnapshot,
  clearBrowserTeachSessionSnapshot,
  browserReopenSession,
  browserNavigateControl,
  startBrowserLiveStream,
  stopBrowserLiveStream,
  setBrowserControlCaptureState,
  setBrowserInteractionModeState,
} from '../browser-tools';
import { evaluateGatewayRequest } from '../gateway-auth';
import { getSessionStatus } from '../routes/account.router';
import { handleCreativeCommandResult } from '../creative/command-bus';
import { isProviderStatusChecking, readProviderStatusCache } from '../provider-status';
import { readCachedGpuInfo } from '../gpu-detector';

function readModelRuntimeStatus(): any | null {
  try {
    const filePath = path.join(getConfig().getConfigDir(), 'model-runtime-status.json');
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

export interface ServerBundle {
  server: http.Server | https.Server;
  wss: WebSocketServer;
}

function sendRawJson(res: http.ServerResponse, body: any): void {
  const json = JSON.stringify(body);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', Buffer.byteLength(json));
  res.end(json);
}

const STATIC_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const RAW_FILE_BUFFER_LIMIT_BYTES = 2 * 1024 * 1024;

function getRawStaticCacheControl(req: http.IncomingMessage, filePath: string): string {
  const rawUrl = String(req.url || '/');
  let pathname = '/';
  try {
    pathname = new URL(rawUrl, 'http://localhost').pathname || '/';
  } catch {}
  if (pathname === '/' || pathname === '/index.html' || pathname === '/mobile' || pathname.startsWith('/mobile/')) {
    return 'no-cache';
  }
  if (pathname.startsWith('/static/') || pathname.startsWith('/vendor/') || pathname.startsWith('/assets/')) {
    return 'public, max-age=86400';
  }
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.js' || ext === '.css' || ext === '.woff' || ext === '.woff2') return 'no-cache';
  return 'no-cache';
}

function isStreamingHttpRequest(req: http.IncomingMessage): boolean {
  const method = String(req.method || '').toUpperCase();
  const rawUrl = String(req.url || '/');
  const pathname = rawUrl.split('?')[0];
  const accept = String(req.headers.accept || '').toLowerCase();

  if (accept.includes('text/event-stream')) return true;
  if (method === 'POST' && pathname === '/api/chat') return true;
  if (method === 'POST' && pathname === '/api/voice-agent/input') return true;
  if (method === 'POST' && /^\/api\/teams\/[^/]+\/chat$/.test(pathname)) return true;
  if (method === 'GET' && /^\/api\/bg-tasks\/[^/]+\/stream$/.test(pathname)) return true;
  if (method === 'GET' && (pathname === '/api/teams/events' || /^\/api\/teams\/[^/]+\/events$/.test(pathname))) return true;

  return false;
}

function isInsideRoot(filePath: string, root: string): boolean {
  const resolved = path.resolve(filePath);
  const resolvedRoot = path.resolve(root);
  return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`);
}

function sendRawFile(req: http.IncomingMessage, res: http.ServerResponse, filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    res.statusCode = 200;
    res.setHeader('Content-Type', STATIC_MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
    const etag = `W/"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
    res.setHeader('Cache-Control', getRawStaticCacheControl(req, filePath));
    res.setHeader('Last-Modified', stat.mtime.toUTCString());
    res.setHeader('ETag', etag);
    res.setHeader('Content-Length', stat.size);
    const ifNoneMatch = String(req.headers['if-none-match'] || '');
    const ifModifiedSince = String(req.headers['if-modified-since'] || '');
    if (
      ifNoneMatch === etag
      || (ifModifiedSince && Number(new Date(ifModifiedSince)) >= Math.floor(stat.mtimeMs / 1000) * 1000)
    ) {
      res.statusCode = 304;
      res.removeHeader('Content-Length');
      res.end();
      return true;
    }
    if (String(req.method || 'GET').toUpperCase() === 'HEAD') {
      res.end();
      return true;
    }
    if (stat.size <= RAW_FILE_BUFFER_LIMIT_BYTES) {
      res.end(fs.readFileSync(filePath));
      return true;
    }
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      if (!res.headersSent) res.statusCode = 500;
      try { res.end(); } catch {}
    });
    stream.pipe(res);
    return true;
  } catch {
    return false;
  }
}

function tryRawWebStaticFastPath(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return false;
  const rawUrl = String(req.url || '/');
  if (rawUrl.startsWith('/api/') || rawUrl === '/ws') return false;

  let pathname = '/';
  try {
    pathname = decodeURIComponent(new URL(rawUrl, 'http://localhost').pathname || '/');
  } catch {
    return false;
  }
  if (pathname.includes('\0')) return false;

  const root = resolvePrometheusRoot();
  const webUiRoot = isPublicDistributionBuild() && hasPublicWebUiBuild()
    ? getPublicWebUiRoot()
    : path.join(root, 'web-ui');
  const publicRoot = getPublicWebUiRoot();
  const candidates: Array<{ root: string; file: string }> = [];

  const push = (candidateRoot: string, relPath: string) => {
    const file = path.join(candidateRoot, relPath.replace(/^\/+/, ''));
    if (isInsideRoot(file, candidateRoot)) candidates.push({ root: candidateRoot, file });
  };

  if (pathname === '/' || pathname === '/index.html' || pathname === '/mobile' || pathname.startsWith('/mobile/')) {
    push(webUiRoot, 'index.html');
  } else if (pathname.startsWith('/src/')) {
    push(webUiRoot, pathname);
  } else if (pathname.startsWith('/static/')) {
    push(publicRoot, pathname);
    push(webUiRoot, pathname);
  } else if (pathname.startsWith('/assets/')) {
    push(path.join(root, 'assets'), pathname.slice('/assets/'.length));
  } else if (pathname.startsWith('/vendor/pretext/')) {
    push(path.join(root, 'node_modules', '@chenglou', 'pretext', 'dist'), pathname.slice('/vendor/pretext/'.length));
  } else if (pathname.startsWith('/vendor/jspdf/')) {
    push(path.join(root, 'node_modules', 'jspdf', 'dist'), pathname.slice('/vendor/jspdf/'.length));
  } else {
    push(webUiRoot, pathname);
  }

  for (const item of candidates) {
    if (fs.existsSync(item.file) && sendRawFile(req, res, item.file)) return true;
  }
  return false;
}

function tryHttpsRedirect(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  httpsPort?: number,
): boolean {
  if (!httpsPort) return false;
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return false;
  const rawUrl = String(req.url || '/');
  if (rawUrl.startsWith('/api/') || rawUrl === '/ws') return false;

  // If the request reached us through an HTTPS-terminating proxy (e.g.
  // Tailscale Funnel), the public-facing connection is already https and
  // redirecting to our local httpsPort would point the client at an
  // internal port it can't reach. Trust the standard forwarded header.
  const xfProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (xfProto === 'https') return false;

  const hostHeader = String(req.headers.host || '').trim();
  const hostname = hostHeader.startsWith('[')
    ? hostHeader.slice(0, hostHeader.indexOf(']') + 1)
    : (hostHeader.split(':')[0] || 'localhost');
  const location = `https://${hostname}:${httpsPort}${rawUrl || '/'}`;
  res.statusCode = 307;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
  return true;
}

function tryRawGatewayFastPath(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return false;
  const pathname = String(req.url || '').split('?')[0];
  if (pathname !== '/api/health' && pathname !== '/api/status' && pathname !== '/api/system-stats') return false;

  if (method === 'HEAD') {
    res.statusCode = 200;
    res.setHeader('Cache-Control', 'no-store');
    res.end();
    return true;
  }

  if (pathname === '/api/health') {
    sendRawJson(res, {
      ok: true,
      pid: process.pid,
      timestamp: Date.now(),
      fastPath: true,
    });
    return true;
  }

  const rawCfg = getConfig().getConfig() as any;
  const provider = String(rawCfg.llm?.provider || 'ollama');
  const isCloudProvider = provider === 'openai' || provider === 'openai_codex' || provider === 'anthropic' || provider === 'perplexity' || provider === 'gemini';
  const providerCfg = rawCfg.llm?.providers?.[provider] || {};
  const currentModel = providerCfg.model || rawCfg.models?.primary || 'unknown';
  const cachedProviderStatus = readProviderStatusCache();
  const modelRuntime = readModelRuntimeStatus();
  const activeModelRuntime = modelRuntime?.provider === provider ? modelRuntime : null;

  if (pathname === '/api/status') {
    const connected = isCloudProvider ? true : !!cachedProviderStatus?.connected;
    sendRawJson(res, {
      status: 'ok',
      version: 'v2-tools',
      ollama: connected,
      providerOnline: connected,
      providerChecking: !isCloudProvider && !cachedProviderStatus && isProviderStatusChecking(),
      provider,
      currentModel,
      configuredModel: activeModelRuntime?.configuredModel || currentModel,
      requestedModel: activeModelRuntime?.requestedModel || currentModel,
      actualModel: activeModelRuntime?.actualModel || currentModel,
      modelFallback: activeModelRuntime?.fallback === true,
      fallbackFrom: activeModelRuntime?.fallbackFrom,
      fallbackReason: activeModelRuntime?.fallbackReason,
      workspace: rawCfg.workspace?.path || '',
      search: rawCfg.search?.tinyfish_api_key ? 'tinyfish' : rawCfg.search?.google_api_key ? 'google' : (rawCfg.search?.tavily_api_key ? 'tavily' : 'none'),
      fastPath: true,
    });
    return true;
  }

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const gpuInfo = readCachedGpuInfo();
  const gpuAvailable = !!(gpuInfo?.nvidiaAvailable || gpuInfo?.amdAvailable || gpuInfo?.appleSilicon);
  sendRawJson(res, {
    system: {
      cpu_percent: 0,
      memory_percent: totalMem > 0 ? (usedMem / totalMem) * 100 : 0,
      memory_used_gb: usedMem / (1024 ** 3),
      memory_total_gb: totalMem / (1024 ** 3),
    },
    gpu: { available: gpuAvailable, gpu_util_percent: 0, vram_used_percent: 0, vram_used_gb: 0, vram_total_gb: 0, name: gpuInfo?.name || '' },
    ollama_process: { running: isCloudProvider ? true : !!cachedProviderStatus?.connected, process_count: 0, total_memory_mb: 0 },
    gateway_process: { rss_mb: process.memoryUsage().rss / (1024 * 1024) },
    active_provider: provider,
    active_model: currentModel,
    configured_model: activeModelRuntime?.configuredModel || currentModel,
    requested_model: activeModelRuntime?.requestedModel || currentModel,
    actual_model: activeModelRuntime?.actualModel || currentModel,
    model_fallback: activeModelRuntime?.fallback === true,
    fallback_from: activeModelRuntime?.fallbackFrom,
    fallback_reason: activeModelRuntime?.fallbackReason,
    timestamp: new Date().toISOString(),
    fastPath: true,
  });
  return true;
}

export function createServer(
  app: http.RequestListener,
  port: number,
  host: string,
  tlsOptions?: https.ServerOptions,
  redirectHttpsPort?: number,
): ServerBundle {
  const requestHandler = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const isStreamingRequest = isStreamingHttpRequest(req);
    const destroyRequestSocket = () => {
      if (isStreamingRequest) return;
      setImmediate(() => {
        if (req.socket.destroyed) return;
        if (req.socket.readableEnded || req.socket.writableEnded) {
          try { req.socket.destroy(); } catch {}
        }
      });
    };
    req.on('aborted', destroyRequestSocket);
    req.on('error', destroyRequestSocket);
    res.on('close', destroyRequestSocket);
    if (tryRawGatewayFastPath(req, res)) return;
    if (!tlsOptions && tryHttpsRedirect(req, res, redirectHttpsPort)) return;
    if (tryRawWebStaticFastPath(req, res)) return;
    app(req, res);
  };
  const server = tlsOptions
    ? https.createServer(tlsOptions, requestHandler)
    : http.createServer(requestHandler);
  const httpSockets = new Set<any>();
  const socketSweeper = setInterval(() => {
    for (const socket of httpSockets) {
      if (socket.destroyed || socket.readyState !== 'open' || socket.readableEnded || socket.writableEnded) {
        httpSockets.delete(socket);
        try { socket.destroy(); } catch {}
      }
    }
  }, 2_000);
  socketSweeper.unref?.();
  server.on('close', () => clearInterval(socketSweeper));
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;
  server.keepAliveTimeout = 65_000;
  server.maxRequestsPerSocket = 0;
  server.on('connection', (socket) => {
    httpSockets.add(socket);
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 30_000);
    socket.setTimeout(0);
    const destroyEndedHttpSocket = () => setImmediate(() => {
      if (socket.readableEnded || socket.writableEnded) {
        try { socket.destroy(); } catch {}
      }
    });
    socket.on('end', destroyEndedHttpSocket);
    socket.on('close', () => httpSockets.delete(socket));
    socket.on('error', () => {});
  });
  server.on('upgrade', (req, socket, head) => {
    httpSockets.delete(socket);
    socket.listeners('end').forEach((listener) => {
      if (listener.name === 'destroyEndedHttpSocket') socket.off('end', listener as any);
    });
    let pathname = '';
    try {
      pathname = new URL(String(req.url || ''), 'http://localhost').pathname;
    } catch {}
    if (pathname !== '/ws') return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });
  const wss = new WebSocketServer({ noServer: true });
  const wsSweeper = setInterval(() => {
    wss.clients.forEach((client: any) => {
      const socket = client?._socket;
      if (
        client.readyState !== WebSocket.OPEN
        || socket?.destroyed
        || socket?.readyState !== 'open'
        || socket?.readableEnded
        || socket?.writableEnded
      ) {
        try { client.terminate(); } catch {}
      }
    });
  }, 2_000);
  wsSweeper.unref?.();
  server.on('close', () => clearInterval(wsSweeper));

  // Register wss with the broadcaster so broadcastWS() works everywhere
  setWss(wss);

  wss.on('error', (err: any) => {
    if (err?.code === 'EADDRINUSE') {
      console.error(`[Gateway] Port ${host}:${port} is already in use.`);
      console.error('[Gateway] Another gateway instance is likely already running.');
      console.error('[Gateway] Use one instance only, then open http://127.0.0.1:18789');
      process.exit(1);
      return;
    }
    console.error('[Gateway] WebSocket error:', err?.message || err);
    process.exit(1);
  });

  server.on('error', (err: any) => {
    if (err?.code === 'EADDRINUSE') {
      console.error(`[Gateway] Port ${host}:${port} is already in use.`);
      console.error('[Gateway] Another gateway instance is likely already running or the port is stuck.');
      console.error('[Gateway] Close the other process or run: prom gateway stop');
      process.exit(1);
      return;
    }
    console.error('[Gateway] HTTP server error:', err?.message || err);
    process.exit(1);
  });

  wss.on('connection', (ws: WebSocket, req) => {
    let heartbeatTimer: NodeJS.Timeout | null = null;
    let missedPongs = 0;
    const clearHeartbeat = () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    };

    const auth = evaluateGatewayRequest({
      headers: req.headers as Record<string, any>,
      socket: { remoteAddress: req.socket.remoteAddress },
      url: req.url || '',
    });
    if (!auth.ok) {
      try { ws.close(1008, auth.message); } catch {}
      return;
    }
    const account = getSessionStatus();
    if (!account.authenticated) {
      try { ws.close(1008, 'Account login required'); } catch {}
      return;
    }
    console.log('[Prom] WS connected');
    ws.on('pong', () => { missedPongs = 0; });
    ws.on('message', () => { missedPongs = 0; });
    heartbeatTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        clearHeartbeat();
        return;
      }
      if (missedPongs >= 2) {
        try { ws.terminate(); } catch {}
        clearHeartbeat();
        return;
      }
      missedPongs++;
      try { ws.ping(); } catch { try { ws.terminate(); } catch {} }
    }, 30_000);
    if (typeof (heartbeatTimer as any).unref === 'function') (heartbeatTimer as any).unref();
    req.socket.on('end', () => {
      clearHeartbeat();
      try { ws.terminate(); } catch {}
    });
    req.socket.on('error', () => {
      clearHeartbeat();
      try { ws.terminate(); } catch {}
    });

    const pending = listPendingStartupNotifications().filter((n) => !n.delivered?.web);
    const sendStartupNotification = (item: any) => {
      const payload = {
        type: 'session_notification',
        notificationId: item.id,
        sessionId: item.sessionId,
        text: item.text,
        title: item.title,
        source: item.source,
        automatedSession: item.automatedSession,
        previousSessionId: item.previousSessionId,
      };
      try {
        ws.send(JSON.stringify(payload));
        console.log(`[Prom] Sent startup notification ${item.id} -> session ${item.sessionId}`);
        if (item.source === 'hot_restart' || item.devReload?.enabled) {
          const delayMs = Number.isFinite(Number(item.devReload?.delayMs)) ? Math.max(250, Number(item.devReload.delayMs)) : 1200;
          setTimeout(() => {
            try {
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({
                  type: 'dev_reload_requested',
                  target: 'all',
                  source: 'hot_restart',
                  reason: item.devReload?.reason || item.title || 'Prometheus restart complete',
                  surfaces: item.devReload?.surfaces || ['restart'],
                  timestamp: Date.now(),
                }));
              }
            } catch {}
          }, delayMs);
        }
      } catch (err: any) {
        console.warn(`[Prom] Failed to send startup notification ${item.id}: ${err?.message || err}`);
      }
    };
    for (const item of pending) {
      sendStartupNotification(item);
      // Retry once in case frontend handlers are not ready yet.
      setTimeout(() => {
        try {
          const stillPending = listPendingStartupNotifications().some((n) => n.id === item.id && !n.delivered?.web);
          if (stillPending && ws.readyState === 1) sendStartupNotification(item);
        } catch {}
      }, 4000);
    }

    ws.on('message', (d) => {
      try {
        const msg = JSON.parse(d.toString());
        const broadcastPayload = (payload: any) => {
          wss.clients.forEach((client: any) => {
            if (client.readyState === 1) {
              try { client.send(JSON.stringify(payload)); } catch {}
            }
          });
        };
        if (msg?.type === 'startup_notification_ack' && msg?.notificationId) {
          const notificationId = String(msg.notificationId);
          const item = listPendingStartupNotifications().find((n: any) => String(n?.id || '') === notificationId);
          const targetSessionId = String(item?.previousSessionId || item?.sessionId || '').trim();
          const ackSurface = String(msg.surface || msg.client || '').trim().toLowerCase();
          const mobileTarget = targetSessionId.startsWith('mobile_') || targetSessionId === 'mobile_default';
          if (mobileTarget && ackSurface !== 'mobile') return;
          markStartupNotificationDelivered(notificationId, 'web');
          return;
        }
        if (msg?.type === 'creative_command_result' && msg?.commandId) {
          handleCreativeCommandResult(msg);
          return;
        }
        if (msg?.type === 'browser:mode:set' && msg?.sessionId) {
          const interactionState = setBrowserInteractionModeState(String(msg.sessionId || ''), msg.mode);
          const payload = {
            type: 'browser:mode',
            sessionId: String(msg.sessionId || ''),
            mode: interactionState.mode,
            captured: interactionState.captured,
            controlOwner: interactionState.controlOwner,
            timestamp: Date.now(),
          };
          broadcastPayload(payload);
          return;
        }
        if (msg?.type === 'browser:control:set' && msg?.sessionId) {
          const interactionState = setBrowserControlCaptureState(String(msg.sessionId || ''), {
            captured: msg.captured === true,
            owner: String(msg.owner || '').trim().toLowerCase() === 'agent' ? 'agent' : 'user',
            reason: String(msg.reason || '').trim(),
          });
          const payload = {
            type: 'browser:control',
            sessionId: String(msg.sessionId || ''),
            mode: interactionState.mode,
            captured: interactionState.captured,
            controlOwner: interactionState.controlOwner,
            statusLabel: interactionState.lastActorSummary,
            timestamp: Date.now(),
          };
          broadcastPayload(payload);
          return;
        }
        if (msg?.type === 'browser:stream:set' && msg?.sessionId) {
          const sessionId = String(msg.sessionId || '');
          if (msg.active === false) {
            stopBrowserLiveStream(sessionId, String(msg.reason || 'Live browser stream stopped by the canvas.').trim() || 'Live browser stream stopped by the canvas.')
              .catch(() => {});
            return;
          }
          startBrowserLiveStream(sessionId, {
            focus: msg.focus,
            preferCdp: msg.preferCdp !== false,
            restoreUrl: String(msg.restoreUrl || '').trim(),
            restoreTitle: String(msg.restoreTitle || '').trim(),
          }).catch((err: any) => {
            try {
              ws.send(JSON.stringify({
                type: 'browser:stream_status',
                sessionId,
                active: false,
                transport: '',
                focus: String(msg.focus || 'passive'),
                status: String(err?.message || err || 'Could not start live browser stream.'),
                timestamp: Date.now(),
              }));
            } catch {}
          });
          return;
        }
        if (msg?.type === 'browser:reopen' && msg?.sessionId) {
          const sessionId = String(msg.sessionId || '');
          browserReopenSession(sessionId, {
            url: String(msg.restoreUrl || '').trim(),
            title: String(msg.restoreTitle || '').trim(),
          }).then((knowledge) => {
            if (!knowledge) {
              try {
                ws.send(JSON.stringify({
                  type: 'browser:input:error',
                  sessionId,
                  error: 'Could not reopen the browser session.',
                  timestamp: Date.now(),
                }));
              } catch {}
              return;
            }
            broadcastPayload({
              type: 'browser:status',
              sessionId: knowledge.sessionId,
              active: knowledge.active,
              url: knowledge.url,
              title: knowledge.title,
              mode: knowledge.mode,
              captured: knowledge.captured,
              controlOwner: knowledge.controlOwner,
              streamActive: knowledge.streamActive,
              streamTransport: knowledge.streamTransport,
              streamFocus: knowledge.streamFocus,
              source: 'system',
              tool: 'browser_reopen',
              statusLabel: 'Reopened the last browser page.',
              frameBase64: knowledge.frameBase64,
              frameWidth: knowledge.frameWidth,
              frameHeight: knowledge.frameHeight,
              frameFormat: 'png',
              timestamp: Date.now(),
            });
            try {
              ws.send(JSON.stringify({
                type: 'browser:knowledge',
                action: 'loaded',
                sessionId: knowledge.sessionId,
                active: knowledge.active,
                url: knowledge.url,
                site: knowledge.site,
                title: knowledge.title,
                mode: knowledge.mode,
                captured: knowledge.captured,
                controlOwner: knowledge.controlOwner,
                streamActive: knowledge.streamActive,
                streamTransport: knowledge.streamTransport,
                streamFocus: knowledge.streamFocus,
                frameBase64: knowledge.frameBase64,
                frameWidth: knowledge.frameWidth,
                frameHeight: knowledge.frameHeight,
                elements: knowledge.elements,
                itemRoots: knowledge.itemRoots,
                extractionSchemas: knowledge.extractionSchemas,
                timestamp: Date.now(),
              }));
            } catch {}
          }).catch((err: any) => {
            try {
              ws.send(JSON.stringify({
                type: 'browser:input:error',
                sessionId,
                error: String(err?.message || err || 'Could not reopen the browser session.'),
                timestamp: Date.now(),
              }));
            } catch {}
          });
          return;
        }
        if (msg?.type === 'browser:navigation' && msg?.sessionId) {
          const sessionId = String(msg.sessionId || '');
          browserNavigateControl(sessionId, {
            action: msg.action,
            url: String(msg.url || '').trim(),
          }).then((status) => {
            broadcastPayload({
              type: 'browser:status',
              ...status,
              source: 'system',
              tool: `browser_${String(msg.action || 'navigate').trim().toLowerCase()}`,
            });
          }).catch((err: any) => {
            try {
              ws.send(JSON.stringify({
                type: 'browser:input:error',
                sessionId,
                error: String(err?.message || err || 'Browser navigation failed.'),
                timestamp: Date.now(),
              }));
            } catch {}
          });
          return;
        }
        if (msg?.type === 'browser:input' && msg?.sessionId) {
          browserHandleUserInput(String(msg.sessionId || ''), {
            action: String(msg.action || ''),
            x: Number(msg.x),
            y: Number(msg.y),
            button: msg.button,
            deltaX: Number(msg.deltaX),
            deltaY: Number(msg.deltaY),
            key: msg.key,
            text: msg.text,
            ctrlKey: msg.ctrlKey === true,
            altKey: msg.altKey === true,
            metaKey: msg.metaKey === true,
            shiftKey: msg.shiftKey === true,
          }).then((payload) => {
            broadcastPayload({
              type: 'browser:status',
              ...payload,
            });
          }).catch((err: any) => {
            try {
              ws.send(JSON.stringify({
                type: 'browser:input:error',
                sessionId: String(msg.sessionId || ''),
                error: String(err?.message || err || 'Browser input failed.'),
                timestamp: Date.now(),
              }));
            } catch {}
          });
          return;
        }
        if (msg?.type === 'browser:inspect_point' && msg?.sessionId) {
          const trackSelection = msg?.track === true || msg?.purpose === 'select';
          const purpose = String(msg?.purpose || '').trim() || 'select';
          browserInspectPoint(
            String(msg.sessionId || ''),
            Number(msg.x),
            Number(msg.y),
            { trackSelection },
          ).then((selection) => {
            const payload = {
              type: 'browser:selection',
              sessionId: String(msg.sessionId || ''),
              selection,
              purpose,
              requestId: msg?.requestId,
              timestamp: Date.now(),
            };
            broadcastPayload(payload);
          }).catch(() => {});
          return;
        }
        if (msg?.type === 'browser:inspect_map' && msg?.sessionId) {
          browserGetInteractableMap(String(msg.sessionId || ''), {
            limit: Number(msg?.limit) || 240,
            includeStatic: msg?.includeStatic === true,
          }).then((mapResult) => {
            try {
              ws.send(JSON.stringify({
                type: 'browser:inspect_map_result',
                sessionId: String(msg.sessionId || ''),
                requestId: msg?.requestId,
                map: mapResult,
                timestamp: Date.now(),
              }));
            } catch {}
          }).catch(() => {});
          return;
        }
        if (msg?.type === 'browser:track_selection' && msg?.sessionId) {
          const pack = msg?.pack && typeof msg.pack === 'object' ? msg.pack : null;
          const normalized = setBrowserLiveSelectionFromPack(String(msg.sessionId || ''), pack);
          try {
            ws.send(JSON.stringify({
              type: 'browser:track_selection_ack',
              sessionId: String(msg.sessionId || ''),
              tracked: !!normalized,
              pack: normalized,
              timestamp: Date.now(),
            }));
          } catch {}
          return;
        }
        if (msg?.type === 'browser:clear_selection' && msg?.sessionId) {
          clearBrowserLiveSelectionTracker(String(msg.sessionId || ''));
          return;
        }
        if (msg?.type === 'browser:knowledge:request' && msg?.sessionId) {
          getBrowserNamedElementsForSession(String(msg.sessionId || ''), {
            url: String(msg.restoreUrl || '').trim(),
            title: String(msg.restoreTitle || '').trim(),
          })
            .then((knowledge) => {
              if (!knowledge) return;
              try {
                ws.send(JSON.stringify({
                  type: 'browser:knowledge',
                  action: 'loaded',
                  sessionId: knowledge.sessionId,
                  active: knowledge.active,
                  url: knowledge.url,
                  site: knowledge.site,
                  title: knowledge.title,
                  mode: knowledge.mode,
                  captured: knowledge.captured,
                  controlOwner: knowledge.controlOwner,
                  streamActive: knowledge.streamActive,
                  streamTransport: knowledge.streamTransport,
                  streamFocus: knowledge.streamFocus,
                  frameBase64: knowledge.frameBase64,
                  frameWidth: knowledge.frameWidth,
                  frameHeight: knowledge.frameHeight,
                  elements: knowledge.elements,
                  itemRoots: knowledge.itemRoots,
                  extractionSchemas: knowledge.extractionSchemas,
                  timestamp: Date.now(),
                }));
              } catch {}
            })
            .catch(() => {});
          return;
        }
        if (msg?.type === 'browser:teach:sync' && msg?.sessionId) {
          const sessionId = String(msg.sessionId || '');
          const teachSession = msg?.teachSession;
          if (teachSession && typeof teachSession === 'object' && teachSession.active === true) {
            saveBrowserTeachSessionSnapshot(sessionId, teachSession);
          } else {
            clearBrowserTeachSessionSnapshot(sessionId);
          }
          return;
        }
        if (msg?.type === 'browser:element:save' && msg?.sessionId) {
          saveBrowserNamedElement(String(msg.sessionId || ''), {
            name: String(msg.name || '').trim(),
            kind: String(msg.kind || '').trim().toLowerCase() === 'item_root' ? 'item_root' : 'element',
            selector: String(msg?.selection?.selector || '').trim(),
            tagName: String(msg?.selection?.tagName || '').trim(),
            id: String(msg?.selection?.id || '').trim(),
            text: String(msg?.selection?.text || '').trim(),
            url: String(msg?.selection?.url || '').trim(),
          }).then((knowledge) => {
            const payload = {
              type: 'browser:knowledge',
              action: 'saved',
              sessionId: knowledge.sessionId,
              url: knowledge.url,
              site: knowledge.site,
              savedKind: knowledge.kind,
              saved: knowledge.saved,
              elements: knowledge.elements,
              itemRoots: knowledge.itemRoots,
              extractionSchemas: knowledge.extractionSchemas,
              timestamp: Date.now(),
            };
            broadcastPayload(payload);
          }).catch((err: any) => {
            try {
              ws.send(JSON.stringify({
                type: 'browser:knowledge:error',
                sessionId: String(msg.sessionId || ''),
                error: String(err?.message || err || 'Failed to save browser memory entry.'),
                timestamp: Date.now(),
              }));
            } catch {}
          });
          return;
        }
        // Handle approve_goal_request fired from Telegram (broadcast round-trip)
        if (msg?.type === 'approve_goal_request' && msg?.goalId) {
          hookBus.fire({ type: 'gateway:approve_goal', goalId: msg.goalId, chatId: msg.chatId })
            .catch((e: any) => console.warn('[WS] approve_goal_request error:', e?.message));
        }
      } catch {}
    });
    ws.on('close', () => {
      clearHeartbeat();
      console.log('[Prom] WS disconnected');
    });
    ws.on('error', () => {
      clearHeartbeat();
      try { ws.terminate(); } catch {}
    });
  });

  server.on('error', (err: any) => {
    if (err?.code === 'EADDRINUSE') {
      console.error(`[Gateway] Port ${host}:${port} is already in use.`);
      console.error('[Gateway] Another gateway instance is likely already running.');
      console.error('[Gateway] Use one instance only, then open http://127.0.0.1:18789');
      process.exit(1);
      return;
    }
    console.error('[Gateway] HTTP server error:', err?.message || err);
    process.exit(1);
  });

  return { server, wss };
}
