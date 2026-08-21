import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { WebSocketServer, WebSocket } = require('ws');
const { createGatewayReverseProxy } = require(path.join(root, 'electron', 'gateway-reverse-proxy.js'));

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = probe.address();
      probe.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function request(port, pathname = '/', headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.once('error', reject);
    req.end();
  });
}

async function startBackend(port, name) {
  let requests = 0;
  const backend = http.createServer((req, res) => {
    requests += 1;
    res.writeHead(200, { 'Content-Type': 'application/json', 'X-Backend': name });
    res.end(JSON.stringify({ ok: true, name, path: req.url }));
  });
  const wss = new WebSocketServer({ noServer: true });
  backend.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('message', (message) => ws.send(`echo:${message}`));
    });
  });
  await new Promise((resolve, reject) => {
    backend.once('error', reject);
    backend.listen({ host: '127.0.0.1', port }, () => {
      backend.removeListener('error', reject);
      resolve();
    });
  });
  return { backend, wss, get requests() { return requests; } };
}

function closeBackend(bundle) {
  return new Promise((resolve, reject) => {
    bundle.wss.close((wsError) => {
      if (wsError) return reject(wsError);
      closeServer(bundle.backend).then(resolve, reject);
    });
  });
}

function websocketEcho(port) {
  return new Promise((resolve, reject) => {
    const client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const timer = setTimeout(() => {
      try { client.terminate(); } catch {}
      reject(new Error('Timed out waiting for relayed WebSocket echo.'));
    }, 5_000);
    client.once('open', () => client.send('hello'));
    client.once('message', (message) => {
      clearTimeout(timer);
      try { client.close(); } catch {}
      resolve(String(message));
    });
    client.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function run() {
  const publicPort = await freePort();
  const backendPort = await freePort();
  let targetPort = backendPort;
  let backend = await startBackend(backendPort, 'first');
  const relay = createGatewayReverseProxy({
    host: '127.0.0.1',
    port: publicPort,
    getTargetPort: () => targetPort,
    initialState: 'starting',
  });

  try {
    await relay.listen();
    const starting = await request(publicPort, '/api/health', { Origin: 'https://phone.example' });
    assert.equal(starting.status, 503, 'the public relay must not probe a backend before it is marked ready');
    assert.equal(starting.headers['x-prometheus-gateway-state'], 'starting');
    assert.equal(backend.requests, 0, 'starting state must avoid connection-refused churn');

    relay.setState('ready');
    const initial = await request(publicPort, '/api/health');
    assert.equal(initial.status, 200);
    assert.equal(initial.headers['x-backend'], 'first');
    assert.equal(JSON.parse(initial.body).path, '/api/health');
    assert.equal(await websocketEcho(publicPort), 'echo:hello', 'WebSocket upgrades traverse the relay');

    relay.beginRestart('relay regression replacement');
    const draining = await request(publicPort, '/api/health');
    assert.equal(draining.status, 503, 'planned drain returns a controlled response');
    assert.equal(draining.headers['x-prometheus-gateway-state'], 'restarting');
    await closeBackend(backend);
    backend = null;
    const restarting = await request(publicPort, '/api/health', { Origin: 'https://phone.example' });
    assert.equal(restarting.status, 503, 'public listener stays up while the backend is absent');
    assert.equal(restarting.headers['x-prometheus-gateway-state'], 'restarting');
    assert.equal(restarting.headers['access-control-allow-origin'], 'https://phone.example');
    assert.equal(JSON.parse(restarting.body).code, 'GATEWAY_RESTARTING');
    assert.equal(relay.server.listening, true, 'the public relay never closes during backend replacement');

    backend = await startBackend(backendPort, 'replacement');
    relay.setState('ready');
    const replacement = await request(publicPort, '/api/status');
    assert.equal(replacement.status, 200);
    assert.equal(replacement.headers['x-backend'], 'replacement');
  } finally {
    if (backend) await closeBackend(backend);
    await relay.close();
  }

  console.log('[test-electron-gateway-relay] passed: stable HTTP/WebSocket relay survives backend replacement');
}

run().catch((error) => {
  console.error('[test-electron-gateway-relay] failed:', error);
  process.exitCode = 1;
});
