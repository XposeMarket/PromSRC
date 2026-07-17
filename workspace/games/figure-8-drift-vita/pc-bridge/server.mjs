import dgram from 'node:dgram';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import {
  INPUT_PORT, BRIDGE_PORT, HTTP_PORT, BUTTONS,
  axisByte, buildInputPacket, parseTelemetry, parseFrameChunk,
} from './protocol.mjs';

const VITA_IP = process.env.VITA_IP || '10.0.0.231';
const udpPort = Number(process.env.F8_BRIDGE_PORT || BRIDGE_PORT);
const httpPort = Number(process.env.F8_HTTP_PORT || HTTP_PORT);
const socket = dgram.createSocket('udp4');
let sequence = 0;
let control = { buttons: 0, lx: 128, ly: 128, rx: 128, ry: 128 };
let telemetry = null;
let telemetryAt = 0;
let latestFrame = null;
let latestFrameAt = 0;
let latestFrameId = 0;
const frames = new Map();

function sendControl() {
  const packet = buildInputPacket(++sequence, control);
  socket.send(packet, INPUT_PORT, VITA_IP);
}

function acceptFrameChunk(chunk) {
  let frame = frames.get(chunk.frameId);
  if (!frame) {
    frame = { chunks: new Array(chunk.chunkCount), received: 0, createdAt: Date.now(), width: chunk.width, height: chunk.height };
    frames.set(chunk.frameId, frame);
  }
  if (frame.chunks.length !== chunk.chunkCount || chunk.chunkIndex >= frame.chunks.length) return;
  if (!frame.chunks[chunk.chunkIndex]) { frame.chunks[chunk.chunkIndex] = chunk.payload; frame.received += 1; }
  if (frame.received === frame.chunks.length) {
    latestFrame = Buffer.concat(frame.chunks);
    latestFrameId = chunk.frameId;
    latestFrameAt = Date.now();
    frames.delete(chunk.frameId);
  }
  for (const [id, pending] of frames) if (Date.now() - pending.createdAt > 2000) frames.delete(id);
}

socket.on('message', packet => {
  try {
    const magic = packet.length >= 4 ? packet.readUInt32LE(0) : 0;
    if (magic === 0x4b413846) { telemetry = parseTelemetry(packet); telemetryAt = Date.now(); }
    else if (magic === 0x52463846) acceptFrameChunk(parseFrameChunk(packet));
  } catch (error) {
    console.error(`Dropped wireless packet: ${error.message}`);
  }
});

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  response.end(body);
}

function page() {
  return `<!doctype html><meta charset="utf-8"><title>Figure 8 Drift Wireless</title>
  <style>body{margin:0;background:#111;color:#eee;font:15px system-ui;display:grid;place-items:center;min-height:100vh}main{width:min(960px,94vw)}canvas{width:100%;aspect-ratio:16/9;background:#000;border:2px solid #f06416}button{padding:12px 18px;margin:4px;background:#292929;color:#fff;border:1px solid #555;border-radius:7px}pre{background:#191919;padding:12px;white-space:pre-wrap}.active{background:#a43b0c}</style>
  <main><h1>Figure 8 Drift — Wi-Fi Test Bridge</h1><canvas id="screen" width="320" height="180"></canvas><pre id="stats">Waiting for Vita…</pre>
  <div>${['up','down','left','right','cross','circle','triangle','square','l','r','select','start'].map(name=>`<button data-button="${name}">${name.toUpperCase()}</button>`).join('')}</div></main>
  <script>const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d'),stats=document.querySelector('#stats');let last=0;
  async function refresh(){try{const state=await fetch('/api/state').then(r=>r.json());stats.textContent=JSON.stringify(state,null,2);if(state.frameId!==last){const image=new Image;image.onload=()=>{ctx.drawImage(image,0,0,320,180);URL.revokeObjectURL(image.src)};image.src=URL.createObjectURL(await fetch('/frame.jpg?t='+state.frameId).then(r=>r.blob()));last=state.frameId}}catch{}setTimeout(refresh,200)}refresh();
  for(const button of document.querySelectorAll('button')){const name=button.dataset.button;const down=()=>{button.classList.add('active');fetch('/api/button?name='+name+'&down=1',{method:'POST'})};const up=()=>{button.classList.remove('active');fetch('/api/button?name='+name+'&down=0',{method:'POST'})};button.onpointerdown=down;button.onpointerup=up;button.onpointerleave=up}</script>`;
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/') { const body = page(); response.writeHead(200, {'content-type':'text/html; charset=utf-8'}); return response.end(body); }
  if (url.pathname === '/frame.jpg') {
    if (!latestFrame) return json(response, 404, { error: 'No frame received' });
    response.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': latestFrame.length, 'cache-control': 'no-store' });
    return response.end(latestFrame);
  }
  if (url.pathname === '/api/state') return json(response, 200, {
    vitaIp: VITA_IP, connected: Date.now() - telemetryAt < 1000,
    telemetry, telemetryAgeMs: telemetryAt ? Date.now() - telemetryAt : null,
    frameId: latestFrameId, frameAgeMs: latestFrameAt ? Date.now() - latestFrameAt : null,
    control,
  });
  if (url.pathname === '/api/button' && request.method === 'POST') {
    const name = String(url.searchParams.get('name') || '').toLowerCase();
    const mask = BUTTONS[name];
    if (!mask) return json(response, 400, { error: `Unknown button ${name}` });
    if (url.searchParams.get('down') === '1') control.buttons |= mask; else control.buttons &= ~mask;
    sendControl(); return json(response, 200, control);
  }
  if (url.pathname === '/api/tap' && request.method === 'POST') {
    const name = String(url.searchParams.get('name') || '').toLowerCase();
    const mask = BUTTONS[name];
    if (!mask) return json(response, 400, { error: `Unknown button ${name}` });
    const duration = Math.max(40, Math.min(1000, Number(url.searchParams.get('ms') || 100)));
    control.buttons |= mask; sendControl();
    setTimeout(() => { control.buttons &= ~mask; sendControl(); }, duration);
    return json(response, 202, { tapping: name, duration });
  }
  if (url.pathname === '/api/stick' && request.method === 'POST') {
    for (const axis of ['lx','ly','rx','ry']) if (url.searchParams.has(axis)) control[axis] = axisByte(url.searchParams.get(axis));
    sendControl(); return json(response, 200, control);
  }
  if (url.pathname === '/api/release' && request.method === 'POST') {
    control = { buttons: 0, lx: 128, ly: 128, rx: 128, ry: 128 }; sendControl();
    return json(response, 200, control);
  }
  return json(response, 404, { error: 'Not found' });
});

export function start() {
  socket.bind(udpPort, '0.0.0.0', () => {
    setInterval(sendControl, 200).unref();
    server.listen(httpPort, '127.0.0.1', () => {
      console.log(`Figure 8 wireless bridge: http://127.0.0.1:${httpPort}`);
      console.log(`Target Vita: ${VITA_IP}:${INPUT_PORT}; receiving UDP on :${udpPort}`);
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) start();
