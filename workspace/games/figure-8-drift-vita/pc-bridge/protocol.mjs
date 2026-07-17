export const INPUT_PORT = 18792;
export const BRIDGE_PORT = 18793;
export const HTTP_PORT = 8791;

export const BUTTONS = Object.freeze({
  select: 0x000001, start: 0x000008,
  up: 0x000010, right: 0x000020, down: 0x000040, left: 0x000080,
  l: 0x000100, r: 0x000200,
  triangle: 0x001000, circle: 0x002000, cross: 0x004000, square: 0x008000,
});

export function fnvChecksum(buffer, length = buffer.length - 4) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < length; index += 1) {
    hash ^= buffer[index];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function axisByte(value = 0) {
  const normalized = Math.max(-1, Math.min(1, Number(value) || 0));
  return Math.max(0, Math.min(255, Math.round(128 + normalized * 127)));
}

export function buildInputPacket(sequence, state = {}) {
  const packet = Buffer.alloc(24);
  packet.writeUInt32LE(0x50493846, 0); // F8IP
  packet.writeUInt16LE(1, 4);
  packet.writeUInt16LE(packet.length, 6);
  packet.writeUInt32LE(sequence >>> 0, 8);
  packet.writeUInt32LE((state.buttons || 0) >>> 0, 12);
  packet[16] = state.lx ?? 128;
  packet[17] = state.ly ?? 128;
  packet[18] = state.rx ?? 128;
  packet[19] = state.ry ?? 128;
  packet.writeUInt32LE(fnvChecksum(packet), 20);
  return packet;
}

export function parseTelemetry(packet) {
  if (!Buffer.isBuffer(packet) || packet.length !== 64) throw new Error('Invalid telemetry size');
  if (packet.readUInt32LE(0) !== 0x4b413846) throw new Error('Invalid telemetry magic');
  if (packet.readUInt16LE(4) !== 1 || packet.readUInt16LE(6) !== packet.length) throw new Error('Invalid telemetry version');
  if (packet.readUInt32LE(60) !== fnvChecksum(packet)) throw new Error('Invalid telemetry checksum');
  return {
    sequence: packet.readUInt32LE(8), status: packet.readUInt32LE(12), buttons: packet.readUInt32LE(16),
    lx: packet[20], ly: packet[21], rx: packet[22], ry: packet[23],
    speed: packet.readFloatLE(24), yaw: packet.readFloatLE(28), slipAngle: packet.readFloatLE(32),
    score: packet.readFloatLE(36), combo: packet.readFloatLE(40), x: packet.readFloatLE(44),
    z: packet.readFloatLE(48), yawRate: packet.readFloatLE(52), mode: packet.readUInt32LE(56),
  };
}

export function parseFrameChunk(packet) {
  if (!Buffer.isBuffer(packet) || packet.length < 24) throw new Error('Invalid frame chunk size');
  if (packet.readUInt32LE(0) !== 0x52463846) throw new Error('Invalid frame magic');
  if (packet.readUInt16LE(4) !== 1 || packet.readUInt16LE(6) !== 24) throw new Error('Invalid frame version');
  const payloadSize = packet.readUInt16LE(16);
  if (packet.length !== 24 + payloadSize) throw new Error('Invalid frame payload size');
  return {
    frameId: packet.readUInt32LE(8), chunkIndex: packet.readUInt16LE(12),
    chunkCount: packet.readUInt16LE(14), payloadSize,
    width: packet.readUInt16LE(18), height: packet.readUInt16LE(20), payload: packet.subarray(24),
  };
}
