import dgram from 'node:dgram';
import http from 'node:http';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const INPUT_PORT = Number(process.env.VITA_INPUT_PORT || 18791);
export const HTTP_PORT = Number(process.env.VITA_CONTROL_HTTP_PORT || 8790);
export const HTTP_HOST = process.env.VITA_CONTROL_HTTP_HOST || '127.0.0.1';
export const DEFAULT_VITA_IP = process.env.VITA_IP || '';
const TOKEN = process.env.VITA_CONTROL_TOKEN || '';
const PACKET_VERSION = 2;
const ACK_TIMEOUT_MS = Number(process.env.VITA_ACK_TIMEOUT_MS || 800);

export const BUTTONS = Object.freeze({
  select: 0x00000001, start: 0x00000008, up: 0x00000010, right: 0x00000020,
  down: 0x00000040, left: 0x00000080, l: 0x00000100, r: 0x00000200,
  triangle: 0x00001000, circle: 0x00002000, cross: 0x00004000, square: 0x00008000,
  ps: 0x00010000,
});

let sequence = 1;

function checksum(buffer) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < buffer.length - 4; i++) {
    hash ^= buffer[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
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

export function createControlServer() {
  return http.createServer(async (req, res) => {
    try {
      if (req.url === '/health') return json(res, 200, { ok: true, service: 'prometheus-vita-control', vitaIp: DEFAULT_VITA_IP || null, inputPort: INPUT_PORT, protocol: PACKET_VERSION, host: os.hostname() });
      if (!authed(req)) return json(res, 401, { ok: false, error: 'unauthorized' });
      if (req.method !== 'POST') return json(res, 404, { ok: false, error: 'not found' });
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
