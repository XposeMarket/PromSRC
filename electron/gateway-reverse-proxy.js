/**
 * Stable local relay for the Electron-managed gateway.
 *
 * The public desktop port is what Tailscale Funnel (and paired mobile devices)
 * target. Keeping that listener in Electron means a gateway-child restart does
 * not withdraw the Funnel service. The child listens only on a loopback
 * backend port, which this relay forwards to while it is ready.
 */

const http = require('http');
const net = require('net');

const HOP_BY_HOP_REQUEST_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const RELAY_STATES = new Set(['starting', 'ready', 'restarting', 'failed', 'closed']);

function createRestartingBody(state = 'restarting') {
  const failed = state === 'failed';
  return JSON.stringify({
    error: failed
      ? 'Prometheus gateway is unavailable. The desktop supervisor paused automatic recovery.'
      : 'Prometheus gateway is restarting. Please retry shortly.',
    code: failed ? 'GATEWAY_UNAVAILABLE' : 'GATEWAY_RESTARTING',
    retryable: true,
  });
}

function writeRestartingResponse(req, res, state = 'restarting') {
  if (!res || res.destroyed || res.headersSent) return;
  const body = createRestartingBody(state);
  const origin = String(req.headers.origin || '').trim();
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Retry-After': state === 'failed' ? '10' : '1',
    'X-Prometheus-Gateway-State': state,
    Connection: 'close',
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers.Vary = 'Origin';
    headers['Access-Control-Allow-Headers'] = String(req.headers['access-control-request-headers'] || 'Content-Type, X-Pairing-Token');
    headers['Access-Control-Allow-Methods'] = 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS';
  }
  res.writeHead(503, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

function writeRestartingUpgrade(socket, state = 'restarting') {
  if (!socket || socket.destroyed) return;
  const body = createRestartingBody(state);
  const response = [
    'HTTP/1.1 503 Service Unavailable',
    'Content-Type: application/json; charset=utf-8',
    'Content-Length: ' + Buffer.byteLength(body),
    'Cache-Control: no-store',
    'Retry-After: ' + (state === 'failed' ? '10' : '1'),
    'X-Prometheus-Gateway-State: ' + state,
    'Connection: close',
    '',
    body,
  ].join('\r\n');
  try { socket.end(response); } catch { try { socket.destroy(); } catch {} }
}

function normalizeTargetPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : null;
}

function normalizeTimeout(value, fallback) {
  const timeout = Number(value);
  return Number.isFinite(timeout) && timeout >= 0 ? Math.floor(timeout) : fallback;
}

function requestHeaders(headers) {
  const out = {};
  for (const [name, value] of Object.entries(headers || {})) {
    if (value == null || HOP_BY_HOP_REQUEST_HEADERS.has(String(name).toLowerCase())) continue;
    out[name] = value;
  }
  return out;
}

function createGatewayReverseProxy({
  host = '0.0.0.0',
  port,
  targetHost = '127.0.0.1',
  getTargetPort,
  initialState = 'ready',
  upstreamTimeoutMs = 15_000,
  log = () => {},
} = {}) {
  if (typeof getTargetPort !== 'function') throw new Error('Gateway relay requires getTargetPort().');
  if (!normalizeTargetPort(port)) throw new Error('Gateway relay requires a valid public port.');
  if (!RELAY_STATES.has(initialState)) throw new Error('Unknown gateway relay state: ' + initialState);

  let state = initialState;
  const responseHeaderTimeoutMs = normalizeTimeout(upstreamTimeoutMs, 15_000);
  const activeHttp = new Set();
  const activeUpgrades = new Set();
  const clientSockets = new Set();

  const canProxy = () => state === 'ready' && !!normalizeTargetPort(getTargetPort());
  const relayState = () => state;
  const unavailableState = () => state === 'failed' ? 'failed' : 'restarting';

  function abortActiveUpstreams() {
    for (const request of Array.from(activeHttp)) {
      try { request.upstream.destroy(); } catch {}
      try { request.res.destroy(); } catch {}
    }
    for (const upgrade of Array.from(activeUpgrades)) {
      try { upgrade.closeBoth(); } catch {}
    }
  }

  function setState(nextState) {
    if (!RELAY_STATES.has(nextState)) throw new Error('Unknown gateway relay state: ' + nextState);
    state = nextState;
    if (state !== 'ready') abortActiveUpstreams();
    return state;
  }

  function beginRestart(reason = 'gateway backend replacement') {
    log('[relay] Entering restarting state: ' + String(reason).slice(0, 160) + '\n');
    return setState('restarting');
  }

  const server = http.createServer((req, res) => {
    const targetPort = normalizeTargetPort(getTargetPort());
    if (!canProxy() || !targetPort) {
      writeRestartingResponse(req, res, state === 'starting' || state === 'restarting' || state === 'failed'
        ? relayState()
        : unavailableState());
      return;
    }

    let responseStarted = false;
    let settled = false;
    let headerTimer = null;
    const record = { upstream: null, res };
    const cleanup = () => {
      if (settled) return;
      settled = true;
      if (headerTimer) clearTimeout(headerTimer);
      activeHttp.delete(record);
    };
    const fail = (error) => {
      cleanup();
      if (state !== 'ready' || !targetPort) {
        if (!res.headersSent) writeRestartingResponse(req, res, state);
        else {
          try { res.destroy(); } catch {}
        }
        return;
      }
      log('[relay] Backend HTTP request failed: ' + (error?.code || error?.message || error) + '\n');
      if (responseStarted || res.headersSent) {
        try { res.destroy(error); } catch {}
      } else {
        writeRestartingResponse(req, res, 'restarting');
      }
    };

    const upstream = http.request({
      host: targetHost,
      port: targetPort,
      method: req.method,
      path: req.url,
      headers: requestHeaders(req.headers),
      // Long-running tools and streaming turns may stay open after response
      // headers arrive. The bounded timer below covers only connection and
      // response-header acquisition, so it cannot cut off a healthy stream.
      timeout: 0,
    }, (upstreamResponse) => {
      responseStarted = true;
      if (headerTimer) clearTimeout(headerTimer);
      res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(res);
      upstreamResponse.once('end', cleanup);
      upstreamResponse.once('error', fail);
    });
    record.upstream = upstream;
    activeHttp.add(record);
    if (responseHeaderTimeoutMs > 0) {
      headerTimer = setTimeout(() => {
        const error = new Error('Gateway relay upstream response headers timed out.');
        error.code = 'GATEWAY_UPSTREAM_TIMEOUT';
        upstream.destroy(error);
      }, responseHeaderTimeoutMs);
      headerTimer.unref?.();
    }

    upstream.once('error', fail);
    upstream.once('close', cleanup);
    req.once('aborted', () => upstream.destroy());
    res.once('close', () => {
      if (!res.writableEnded) upstream.destroy();
      cleanup();
    });
    req.pipe(upstream);
  });

  server.on('upgrade', (req, socket, head) => {
    const targetPort = normalizeTargetPort(getTargetPort());
    if (!canProxy() || !targetPort) {
      writeRestartingUpgrade(socket, state === 'starting' || state === 'restarting' || state === 'failed'
        ? relayState()
        : unavailableState());
      return;
    }

    let connected = false;
    let closed = false;
    let connectTimer = null;
    const upstream = net.createConnection({ host: targetHost, port: targetPort });
    const upgrade = { socket, upstream, closeBoth: null };
    const cleanup = () => {
      if (connectTimer) clearTimeout(connectTimer);
      activeUpgrades.delete(upgrade);
    };
    const closeBoth = () => {
      if (closed) return;
      closed = true;
      cleanup();
      try { socket.destroy(); } catch {}
      try { upstream.destroy(); } catch {}
    };
    upgrade.closeBoth = closeBoth;
    activeUpgrades.add(upgrade);
    const fail = (error) => {
      cleanup();
      if (!connected) writeRestartingUpgrade(socket, state);
      else closeBoth();
      if (state === 'ready') {
        log('[relay] Backend WebSocket upgrade failed: ' + (error?.code || error?.message || error) + '\n');
      }
    };
    if (responseHeaderTimeoutMs > 0) {
      connectTimer = setTimeout(() => {
        const error = new Error('Gateway relay WebSocket connection timed out.');
        error.code = 'GATEWAY_UPSTREAM_TIMEOUT';
        fail(error);
        try { upstream.destroy(); } catch {}
      }, responseHeaderTimeoutMs);
      connectTimer.unref?.();
    }

    upstream.once('error', fail);
    upstream.once('connect', () => {
      if (connectTimer) clearTimeout(connectTimer);
      if (state !== 'ready') {
        closeBoth();
        return;
      }
      connected = true;
      const requestLine = String(req.method || 'GET') + ' ' + String(req.url || '/') + ' HTTP/' + String(req.httpVersion || '1.1') + '\r\n';
      const rawHeaders = Array.isArray(req.rawHeaders) ? req.rawHeaders : [];
      let headerLines = '';
      for (let index = 0; index < rawHeaders.length; index += 2) {
        const name = String(rawHeaders[index] || '');
        const value = String(rawHeaders[index + 1] || '');
        if (name) headerLines += name + ': ' + value + '\r\n';
      }
      try {
        upstream.write(requestLine + headerLines + '\r\n');
        if (head?.length) upstream.write(head);
        socket.pipe(upstream);
        upstream.pipe(socket);
      } catch (error) {
        fail(error);
      }
    });
    socket.once('error', closeBoth);
    socket.once('close', closeBoth);
    upstream.once('close', () => {
      cleanup();
      try { socket.destroy(); } catch {}
    });
  });

  server.on('connection', (socket) => {
    clientSockets.add(socket);
    socket.once('close', () => clientSockets.delete(socket));
  });
  server.requestTimeout = 0;
  server.timeout = 0;
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  return {
    server,
    listen() {
      return new Promise((resolve, reject) => {
        const onError = (error) => {
          server.removeListener('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.removeListener('error', onError);
          resolve(server.address());
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen({ host, port, exclusive: true });
      });
    },
    getState: relayState,
    setState,
    beginRestart,
    close() {
      setState('closed');
      abortActiveUpstreams();
      for (const socket of Array.from(clientSockets)) {
        try { socket.destroy(); } catch {}
      }
      return new Promise((resolve) => {
        if (!server.listening) return resolve();
        server.close(() => resolve());
      });
    },
  };
}

module.exports = { createGatewayReverseProxy };
