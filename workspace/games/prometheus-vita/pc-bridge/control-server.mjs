import dgram from 'node:dgram';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const INPUT_PORT = Number(process.env.VITA_INPUT_PORT || 18791);
export const FRAME_PORT = Number(process.env.VITA_FRAME_PORT || 18790);
export const HTTP_PORT = Number(process.env.VITA_CONTROL_HTTP_PORT || 8790);
export const HTTP_HOST = process.env.VITA_CONTROL_HTTP_HOST || '127.0.0.1';
export const DEFAULT_VITA_IP = process.env.VITA_IP || '';
const TOKEN = process.env.VITA_CONTROL_TOKEN || '';
const PACKET_VERSION = 2;
const KEEP_AWAKE_FLAG = 0x80000000;
const KEEP_AWAKE_INTERVAL_MS = 3000;
const ACK_TIMEOUT_MS = Number(process.env.VITA_ACK_TIMEOUT_MS || 800);

export const BUTTONS = Object.freeze({
  select: 0x00000001, start: 0x00000008, up: 0x00000010, right: 0x00000020,
  down: 0x00000040, left: 0x00000080, l: 0x00000100, r: 0x00000200,
  triangle: 0x00001000, circle: 0x00002000, cross: 0x00004000, square: 0x00008000,
  ps: 0x00010000,
});

let sequence = 1;
let frameSocket;
let latestFrameBmp;
let latestFrameAt = 0;
let keepAwakeTimer;
const assemblingFrames = new Map();
const pendingAcks = new Map();

function rgb565ToBmp(pixels, width, height) {
  const rowBytes = (width * 3 + 3) & ~3;
  const bmp = Buffer.alloc(54 + rowBytes * height);
  bmp.write('BM', 0); bmp.writeUInt32LE(bmp.length, 2); bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(width, 18); bmp.writeInt32LE(height, 22);
  bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28); bmp.writeUInt32LE(rowBytes * height, 34);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = pixels.readUInt16LE((y * width + x) * 2);
    const dst = 54 + (height - 1 - y) * rowBytes + x * 3;
    bmp[dst] = ((value & 31) * 255 / 31) | 0;
    bmp[dst + 1] = (((value >> 5) & 63) * 255 / 63) | 0;
    bmp[dst + 2] = (((value >> 11) & 31) * 255 / 31) | 0;
  }
  return bmp;
}

function acceptFrameChunk(message) {
  if (message.length < 24 || message.readUInt32LE(0) !== 0x52465650) return;
  const headerSize = message.readUInt16LE(6), frameId = message.readUInt32LE(8);
  const index = message.readUInt16LE(12), count = message.readUInt16LE(14);
  const payloadSize = message.readUInt16LE(16), width = message.readUInt16LE(18), height = message.readUInt16LE(20);
  if (headerSize !== 24 || index >= count || message.length !== headerSize + payloadSize || width > 480 || height > 272) return;
  let frame = assemblingFrames.get(frameId);
  if (!frame) {
    frame = { chunks: Array(count), received: 0, width, height, created: Date.now() };
    assemblingFrames.set(frameId, frame);
  }
  if (!frame.chunks[index]) { frame.chunks[index] = message.subarray(headerSize); frame.received++; }
  if (frame.received === count) {
    const pixels = Buffer.concat(frame.chunks);
    if (pixels.length === width * height * 2) { latestFrameBmp = rgb565ToBmp(pixels, width, height); latestFrameAt = Date.now(); }
    assemblingFrames.delete(frameId);
  }
  for (const [id, pending] of assemblingFrames) if (Date.now() - pending.created > 1500) assemblingFrames.delete(id);
}

export function startFrameReceiver() {
  if (frameSocket) return frameSocket;
  frameSocket = dgram.createSocket('udp4');
  frameSocket.on('message', message => {
    if (message.length === 28 && message.readUInt32LE(0) === 0x4b415650) {
      try { const ack = parseAck(message); const pending = pendingAcks.get(ack.sequence); if (pending) pending(ack); } catch {}
      return;
    }
    acceptFrameChunk(message);
  });
  frameSocket.bind(FRAME_PORT, '0.0.0.0');
  return frameSocket;
}

function startKeepAwakeHeartbeat() {
  if (keepAwakeTimer || !DEFAULT_VITA_IP) return;
  const send = () => {
    if (!frameSocket) return;
    frameSocket.send(makePacket({ buttons: KEEP_AWAKE_FLAG }), INPUT_PORT, DEFAULT_VITA_IP, () => {});
  };
  keepAwakeTimer = setInterval(send, KEEP_AWAKE_INTERVAL_MS);
  keepAwakeTimer.unref();
  send();
}

function checksum(buffer) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < buffer.length - 4; i++) {
    hash ^= buffer[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
function dataChecksum(buffer) {
  let hash = 0x811c9dc5;
  for (const byte of buffer) { hash ^= byte; hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash >>> 0;
}

function zipEntries(zip, wanted) {
  const found = new Map(); let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Invalid VPK ZIP directory');
  const count = zip.readUInt16LE(eocd + 10); let offset = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid VPK central entry');
    const method = zip.readUInt16LE(offset + 10), compressed = zip.readUInt32LE(offset + 20), size = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28), extraLength = zip.readUInt16LE(offset + 30), commentLength = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42), name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (wanted.has(name)) {
      if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error('Invalid VPK local entry');
      const localName = zip.readUInt16LE(local + 26), localExtra = zip.readUInt16LE(local + 28), start = local + 30 + localName + localExtra;
      const packed = zip.subarray(start, start + compressed); const value = method === 0 ? Buffer.from(packed) : method === 8 ? zlib.inflateRawSync(packed) : null;
      if (!value || value.length !== size) throw new Error(`Unsupported or corrupt VPK entry: ${name}`); found.set(name, value);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  for (const name of wanted) if (!found.has(name)) throw new Error(`VPK missing ${name}`);
  return found;
}

function packageHmac(data) {
  const sha = crypto.createHash('sha1').update(data).digest(), work = Buffer.alloc(64);
  sha.copy(work, 0, 4, 12); sha.copy(work, 8, 4, 12); sha.copy(work, 16, 12, 16);
  work[20] = sha[16]; work[21] = sha[1]; work[22] = sha[2]; work[23] = sha[3]; work.copy(work, 24, 16, 24);
  return crypto.createHash('sha1').update(work).digest().subarray(0, 16);
}

function makeHeadBin(titleId = 'FIG8VITA1') {
  const head = Buffer.from(fs.readFileSync(new URL('./assets/head.bin', import.meta.url)));
  head.fill(0, 0x30, 0x60); head.write(`EP9000-${titleId}_00-0000000000000000`, 0x30, 48, 'ascii');
  let length = head.readUInt32BE(0xD0); packageHmac(head.subarray(0, length)).copy(head, length);
  const offset = head.readUInt32BE(0x08); length = head.readUInt32BE(0x10); const output = head.readUInt32BE(0xD4);
  packageHmac(head.subarray(offset, offset + length - 64)).copy(head, output);
  length = head.readUInt32BE(0xE8); packageHmac(head.subarray(0, length)).copy(head, length);
  return head;
}

export function prepareGameVpk(vpk) {
  const entries = zipEntries(vpk, new Set(['eboot.bin', 'sce_sys/param.sfo', 'assets/environment-atlas.jpg']));
  return { eboot: entries.get('eboot.bin'), param: entries.get('sce_sys/param.sfo'), head: makeHeadBin(), environment: entries.get('assets/environment-atlas.jpg') };
}

export async function installGameVpk(ip, vpk) {
  const prepared = prepareGameVpk(vpk);
  const steps = [];
  steps.push(await uploadVpk(ip, prepared.eboot, 3));
  steps.push(await uploadVpk(ip, prepared.param, 4));
  steps.push(await uploadVpk(ip, prepared.head, 5));
  steps.push(await uploadVpk(ip, prepared.environment, 9));
  steps.push(await uploadVpk(ip, Buffer.from([1]), 6));
  return steps;
}

export function uploadVpk(ip, payload, kind = 1) {
  if (!ip) throw new Error('Vita IP required');
  if (!Buffer.isBuffer(payload) || !payload.length || payload.length > 32 * 1024 * 1024) throw new Error('VPK must be 1 byte to 32 MB');
  const header = Buffer.alloc(20); header.writeUInt32LE(0x50555650, 0); header.writeUInt16LE(1, 4);
  header.writeUInt16LE(kind, 6); header.writeUInt32LE(payload.length, 8); header.writeUInt32LE(dataChecksum(payload), 12);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: ip, port: FRAME_PORT }); let ack = Buffer.alloc(0); let settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; socket.destroy(); error ? reject(error) : resolve(value); };
    socket.setTimeout(30000, () => finish(new Error('Vita upload timed out')));
    socket.once('error', finish);
    socket.once('connect', () => { socket.write(header); socket.write(payload); });
    socket.on('data', chunk => {
      ack = Buffer.concat([ack, chunk]); if (ack.length < 16) return;
      if (ack.readUInt32LE(0) !== 0x41555650) return finish(new Error('Invalid upload acknowledgement'));
      const result = { status: ack.readUInt32LE(4), received: ack.readUInt32LE(8), checksum: ack.readUInt32LE(12) };
      if (result.status !== 0) return finish(new Error(`Vita rejected upload with status ${result.status} after ${result.received} bytes`));
      finish(null, result);
    });
  });
}

export function makePacket(state = {}) {
  const packet = Buffer.alloc(24);
  let mask = Number(state.buttons || 0) >>> 0;
  for (const name of state.press || []) {
    const bit = BUTTONS[String(name).toLowerCase()];
    if (bit === undefined) throw new Error(`Unknown Vita button: ${name}`);
    mask |= bit;
  }
  packet.writeUInt32LE(0x50495650, 0);
  packet.writeUInt16LE(PACKET_VERSION, 4);
  packet.writeUInt16LE(packet.length, 6);
  packet.writeUInt32LE(sequence++ >>> 0, 8);
  packet.writeUInt32LE(mask >>> 0, 12);
  packet[16] = Number(state.lx ?? 128) & 255;
  packet[17] = Number(state.ly ?? 128) & 255;
  packet[18] = Number(state.rx ?? 128) & 255;
  packet[19] = Number(state.ry ?? 128) & 255;
  packet.writeUInt32LE(checksum(packet), 20);
  return packet;
}

export function parseAck(packet) {
  if (!Buffer.isBuffer(packet) || packet.length !== 28) throw new Error('Invalid Vita ACK size');
  if (packet.readUInt32LE(0) !== 0x4b415650) throw new Error('Invalid Vita ACK magic');
  if (packet.readUInt16LE(4) !== 1 || packet.readUInt16LE(6) !== packet.length) throw new Error('Invalid Vita ACK version');
  if (packet.readUInt32LE(24) !== checksum(packet)) throw new Error('Invalid Vita ACK checksum');
  return {
    sequence: packet.readUInt32LE(8),
    status: packet.readUInt32LE(12),
    buttonResult: packet.readInt32LE(16),
    analogResult: packet.readInt32LE(20),
  };
}

export function sendState(ip, state, { timeout = ACK_TIMEOUT_MS } = {}) {
  if (!ip) throw new Error('Vita IP required. Set VITA_IP or pass {"ip":"..."}.');
  const packet = makePacket(state);
  const expectedSequence = packet.readUInt32LE(8);
  if (frameSocket) return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pendingAcks.delete(expectedSequence); reject(new Error(`No ACK from Vita ${ip}:${INPUT_PORT} within ${timeout}ms`)); }, timeout);
    pendingAcks.set(expectedSequence, ack => { clearTimeout(timer); pendingAcks.delete(expectedSequence); resolve({ ...ack, ip, port: INPUT_PORT }); });
    frameSocket.send(packet, INPUT_PORT, ip, error => { if (error) { clearTimeout(timer); pendingAcks.delete(expectedSequence); reject(error); } });
  });
  const socket = dgram.createSocket('udp4');
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(new Error(`No ACK from Vita ${ip}:${INPUT_PORT} within ${timeout}ms`)), timeout);
    socket.once('error', finish);
    socket.on('message', (message, remote) => {
      try {
        const ack = parseAck(message);
        if (ack.sequence !== expectedSequence) return;
        finish(null, { ...ack, ip: remote.address, port: remote.port });
      } catch {
        // Ignore unrelated UDP packets until timeout.
      }
    });
    socket.send(packet, INPUT_PORT, ip, error => {
      if (error) finish(error);
    });
  });
}

export async function tap(ip, button, duration = 120) {
  const repeats = Math.max(2, Math.ceil(duration / 45));
  const acknowledgements = [];
  for (let i = 0; i < repeats; i++) {
    acknowledgements.push(await sendState(ip, { press: [button] }));
    await new Promise(resolve => setTimeout(resolve, 45));
  }
  acknowledgements.push(await sendState(ip, {}));
  return acknowledgements;
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
function authed(req) {
  if (!TOKEN) return true;
  return req.headers['x-vita-control-token'] === TOKEN;
}
async function readJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}
async function readBuffer(req, limit = 32 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error('upload too large'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}

export function createControlServer() {
  startFrameReceiver();
  startKeepAwakeHeartbeat();
  return http.createServer(async (req, res) => {
    try {
      if (req.url === '/health') return json(res, 200, { ok: true, service: 'prometheus-vita-control', vitaIp: DEFAULT_VITA_IP || null, inputPort: INPUT_PORT, framePort: FRAME_PORT, frameAgeMs: latestFrameAt ? Date.now() - latestFrameAt : null, protocol: PACKET_VERSION, host: os.hostname() });
      if (!authed(req)) return json(res, 401, { ok: false, error: 'unauthorized' });
      if (req.method === 'GET' && req.url.startsWith('/frame.bmp')) {
        if (!latestFrameBmp) return json(res, 404, { ok: false, error: 'no frame received' });
        res.writeHead(200, { 'content-type': 'image/bmp', 'cache-control': 'no-store' }); return res.end(latestFrameBmp);
      }
      if (req.method === 'GET' && req.url === '/view') {
        res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
        return res.end('<!doctype html><meta name="viewport" content="width=device-width"><style>html,body{margin:0;background:#111;height:100%;display:grid;place-items:center}img{width:min(100vw,960px);image-rendering:auto}</style><img id="v"><script>let n=0;setInterval(()=>v.src="/frame.bmp?"+(n++),250)</script>');
      }
      if (req.method !== 'POST') return json(res, 404, { ok: false, error: 'not found' });
      if (req.url === '/update-shell-plugin' || req.url === '/update-kernel-plugin') {
        const payload = await readBuffer(req, 2 * 1024 * 1024); const ip = req.headers['x-vita-ip'] || DEFAULT_VITA_IP;
        const kind = req.url === '/update-shell-plugin' ? 7 : 8;
        const acknowledgement = await uploadVpk(ip, payload, kind);
        return json(res, 200, { ok: true, ip, bytes: payload.length, kind, rebootRequired: true, acknowledgement });
      }
      if (req.url === '/upload-game' || req.url === '/upload-prometheus') {
        const payload = await readBuffer(req); const ip = req.headers['x-vita-ip'] || DEFAULT_VITA_IP;
        const acknowledgement = await uploadVpk(ip, payload, req.url === '/upload-game' ? 1 : 2);
        return json(res, 200, { ok: true, ip, bytes: payload.length, acknowledgement });
      }
      if (req.url === '/install-game') {
        const payload = await readBuffer(req); const ip = req.headers['x-vita-ip'] || DEFAULT_VITA_IP;
        const steps = await installGameVpk(ip, payload);
        return json(res, 200, { ok: true, ip, bytes: payload.length, installed: 'FIG8VITA1', steps });
      }
      const body = await readJson(req);
      const ip = body.ip || DEFAULT_VITA_IP;
      if (req.url === '/tap') {
        const acknowledgements = await tap(ip, body.button, Number(body.duration || 120));
        return json(res, 200, { ok: true, ip, tapped: body.button, acknowledgements });
      }
      if (req.url === '/state') {
        const acknowledgement = await sendState(ip, body);
        return json(res, 200, { ok: true, ip, acknowledgement });
      }
      return json(res, 404, { ok: false, error: 'not found' });
    } catch (error) {
      return json(res, 400, { ok: false, error: error.message });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createControlServer().listen(HTTP_PORT, HTTP_HOST, () => {
    console.log(`Prometheus Vita Control listening on http://${HTTP_HOST}:${HTTP_PORT}`);
    console.log(DEFAULT_VITA_IP ? `Target Vita: ${DEFAULT_VITA_IP}:${INPUT_PORT}` : 'Set VITA_IP before sending controls.');
  });
}
