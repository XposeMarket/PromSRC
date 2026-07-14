import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.VITA_BRIDGE_HOST || '0.0.0.0';
const PORT = Number(process.env.VITA_BRIDGE_PORT || 8780);
const TOKEN = String(process.env.VITA_BRIDGE_TOKEN || '').trim();
const GATEWAY = String(process.env.PROMETHEUS_GATEWAY_URL || 'http://127.0.0.1:18789').replace(/\/$/, '');
const FRAME = path.resolve(process.env.VITA_BRIDGE_FRAME || 'latest-frame.jpg');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const DEVICE = process.env.VITA_VIDEO_DEVICE || '';
const UPDATE_VPK = path.resolve(process.env.VITA_UPDATE_VPK || path.join(HERE, '..', 'deploy', 'prometheus_vita.vpk'));
const UPDATE_VERSION = String(process.env.VITA_UPDATE_VERSION || '00.24');

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
function authed(req) {
  if (!TOKEN) return true;
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  return req.headers['x-vita-bridge-token'] === TOKEN || url.searchParams.get('token') === TOKEN;
}
function captureFrame() {
  if (!DEVICE) return { ok: fs.existsSync(FRAME), source: 'watched-file', frame: FRAME };
  const tmp = `${FRAME}.tmp.jpg`;
  const args = ['-hide_banner', '-loglevel', 'error', '-f', 'dshow', '-i', `video=${DEVICE}`, '-frames:v', '1', '-q:v', '2', '-y', tmp];
  const run = spawnSync(FFMPEG, args, { encoding: 'utf8', timeout: 15000, windowsHide: true });
  if (run.status !== 0 || !fs.existsSync(tmp)) return { ok: false, error: (run.stderr || `ffmpeg exit ${run.status}`).trim() };
  fs.renameSync(tmp, FRAME);
  return { ok: true, source: DEVICE, frame: FRAME };
}
function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter(x => x && x.family === 'IPv4' && !x.internal).map(x => x.address);
}
function updateInfo() {
  const ready = fs.existsSync(UPDATE_VPK);
  return {
    ok: ready,
    version: UPDATE_VERSION,
    ready,
    size: ready ? fs.statSync(UPDATE_VPK).size : 0,
    download: '/update/prometheus_vita.vpk'
  };
}
async function proxyPrometheus(req, res, url) {
  const upstreamPath = url.pathname.replace(/^\/prometheus/, '/api') + url.search;
  const headers = { 'content-type': req.headers['content-type'] || 'application/json' };
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    const upstream = await fetch(`${GATEWAY}${upstreamPath}`, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method || 'GET') ? undefined : Buffer.concat(chunks),
      signal: AbortSignal.timeout(310000),
    });
    const contentType = upstream.headers.get('content-type') || 'application/json';
    const responseHeaders = {
      'content-type': contentType,
      'cache-control': 'no-store, no-transform',
      ...(contentType.includes('text/event-stream') ? { connection: 'keep-alive', 'x-accel-buffering': 'no' } : {}),
    };
    res.writeHead(upstream.status, responseHeaders);
    if (!upstream.body) return res.end();
    // Stream gateway bytes as they arrive. The Vita uses these SSE frames for
    // live tool/activity updates instead of waiting for the whole turn.
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(Buffer.from(value))) await new Promise(resolve => res.once('drain', resolve));
    }
    res.end();
  } catch (error) {
    json(res, 502, { ok: false, error: `Prometheus gateway unavailable: ${error.message}` });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/health') return json(res, 200, { ok: true, service: 'prometheus-vita-bridge', frameReady: fs.existsSync(FRAME), source: DEVICE || 'watched-file', update: updateInfo(), gateway: GATEWAY, lan: lanAddresses() });
  if (!authed(req)) return json(res, 401, { ok: false, error: 'unauthorized' });
  if (url.pathname.startsWith('/prometheus/')) return void proxyPrometheus(req, res, url);
  if (url.pathname === '/update/manifest.json' && req.method === 'GET') return json(res, fs.existsSync(UPDATE_VPK) ? 200 : 404, updateInfo());
  if (url.pathname === '/update/prometheus_vita.vpk' && req.method === 'GET') {
    if (!fs.existsSync(UPDATE_VPK)) return json(res, 404, { ok: false, error: 'No Vita update build is available.' });
    const stat = fs.statSync(UPDATE_VPK);
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': stat.size,
      'content-disposition': 'attachment; filename="prometheus_vita.vpk"',
      'cache-control': 'no-store'
    });
    return fs.createReadStream(UPDATE_VPK).pipe(res);
  }
  if (url.pathname === '/capture' && req.method === 'POST') {
    const result = captureFrame();
    return json(res, result.ok ? 200 : 503, result);
  }
  if (url.pathname === '/frame.jpg' && req.method === 'GET') {
    if (url.searchParams.get('fresh') === '1') captureFrame();
    if (!fs.existsSync(FRAME)) return json(res, 404, { ok: false, error: 'No Vita frame yet. Configure VITA_VIDEO_DEVICE or write latest-frame.jpg.' });
    res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' });
    return fs.createReadStream(FRAME).pipe(res);
  }
  json(res, 404, { ok: false, error: 'not found' });
});
server.listen(PORT, HOST, () => console.log(`Prometheus Vita Bridge listening on http://${HOST}:${PORT}`));
