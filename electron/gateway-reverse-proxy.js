/**
 * Stable local relay for the Electron-managed gateway.
 *
 * The public desktop port is what Tailscale Funnel (and paired mobile devices)
 * target.  Keeping that listener in Electron means a gateway-child restart no
 * longer withdraws the Funnel service.  The child itself listens only on a
 * loopback backend port, which this relay forwards HTTP and WebSocket traffic
 * to while it is alive.
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

function createRestartingBody() {
  return JSON.stringify({
    error: 'Prometheus gateway is restarting. Please retry shortly.',
    code: 'GATEWAY_RESTARTING',
    retryable: true,
  });
}

function writeRestartingResponse(req, res) {
  const body = createRestartingBody();
  const origin = String(req.headers.origin || '').trim();
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Retry-After': '1',
    'X-Prometheus-Gateway-State': 'restarting',
    Connection: 'close',
  };
  // A remote paired PWA can be mid-preflight while the backend is changing.
  // This body contains no data, but retaining CORS visibility lets its
  // transport recognize the short restart window and retry safely.
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers.Vary = 'Origin';
    headers['Access-Control-Allow-Headers'] = String(req.headers['access-control-request-headers'] || 'Content-Type, X-Pairing-Token');
    headers['Access-Control-Allow-Methods'] = 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS';
  }
  res.writeHead(503, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

function writeRestartingUpgrade(socket) {
  if (socket.destroyed) return;
  const body = createRestartingBody();
  const response = [
    'HTTP/1.1 503 Service Unavailable',
    'Content-Type: application/json; charset=utf-8',
    `Content-Length: ${Buffer.byteLength(body)}`,
    'Cache-Control: no-store',
    'Retry-After: 1',
    'X-Prometheus-Gateway-State: restarting',
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
  log = () => {},
} = {}) {
  if (typeof getTargetPort !== 'function') throw new Error('Gateway relay requires getTargetPort().');
  if (!normalizeTargetPort(port)) throw new Error('Gateway relay requires a valid public port.');

  const server = http.createServer((req, res) => {
    const targetPort = normalizeTargetPort(getTargetPort());
    if (!targetPort) {
      writeRestartingResponse(req, res);
      return;
    }

    let responseStarted = false;
    const upstream = http.request({
      host: targetHost,
      port: targetPort,
      method: req.method,
      path: req.url,
      headers: requestHeaders(req.headers),
      // Long-running tools and streaming turns must not inherit Node's short
      // request timeout while crossing this local process boundary.
      timeout: 0,
    }, (upstreamResponse) => {
      responseStarted = true;
      res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(res);
    });

    const fail = (error) => {
      log(`[relay] Backend HTTP request failed: ${error?.code || error?.message || error}\n`);
      if (responseStarted || res.headersSent) {
        try { res.destroy(error); } catch {}
      } else {
        writeRestartingResponse(req, res);
      }
    };
    upstream.once('error', fail);
    req.once('aborted', () => upstream.destroy());
    req.pipe(upstream);
  });

  server.on('upgrade', (req, socket, head) => {
    const targetPort = normalizeTargetPort(getTargetPort());
    if (!targetPort) {
      writeRestartingUpgrade(socket);
      return;
    }

    let connected = false;
    let closed = false;
    const upstream = net.createConnection({ host: targetHost, port: targetPort });
    const closeBoth = () => {
      if (closed) return;
      closed = true;
      try { socket.destroy(); } catch {}
      try { upstream.destroy(); } catch {}
    };
    const fail = (error) => {
      log(`[relay] Backend WebSocket upgrade failed: ${error?.code || error?.message || error}\n`);
      if (!connected) writeRestartingUpgrade(socket);
      else closeBoth();
    };

    upstream.once('error', fail);
    upstream.once('connect', () => {
      connected = true;
      const requestLine = `${req.method || 'GET'} ${req.url || '/'} HTTP/${req.httpVersion || '1.1'}\r\n`;
      const rawHeaders = Array.isArray(req.rawHeaders) ? req.rawHeaders : [];
      let headerLines = '';
      for (let index = 0; index < rawHeaders.length; index += 2) {
        const name = String(rawHeaders[index] || '');
        const value = String(rawHeaders[index + 1] || '');
        if (name) headerLines += `${name}: ${value}\r\n`;
      }
      try {
        upstream.write(`${requestLine}${headerLines}\r\n`);
        if (head?.length) upstream.write(head);
        socket.pipe(upstream);
        upstream.pipe(socket);
      } catch (error) {
        fail(error);
      }
    });
    socket.once('error', closeBoth);
    socket.once('close', () => { try { upstream.destroy(); } catch {} });
    upstream.once('close', () => { try { socket.destroy(); } catch {} });
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
    close() {
      return new Promise((resolve) => {
        if (!server.listening) return resolve();
        server.close(() => resolve());
      });
    },
  };
}

module.exports = { createGatewayReverseProxy };
