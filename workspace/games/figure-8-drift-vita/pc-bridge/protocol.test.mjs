import test from 'node:test';
import assert from 'node:assert/strict';
import { BUTTONS, axisByte, buildInputPacket, fnvChecksum, parseTelemetry, parseFrameChunk } from './protocol.mjs';

test('builds checksummed input packets', () => {
  const packet = buildInputPacket(7, { buttons: 0x4200, lx: axisByte(-1), rx: axisByte(.5) });
  assert.equal(packet.length, 24);
  assert.equal(packet.readUInt32LE(0), 0x50493846);
  assert.equal(packet.readUInt32LE(8), 7);
  assert.equal(packet.readUInt32LE(20), fnvChecksum(packet));
  assert.equal(packet[16], 1);
  assert.equal(packet[18], 192);
});

test('exports the native Select mask used by the Wi-Fi bridge', () => {
  assert.equal(BUTTONS.select, 0x000001);
  const packet = buildInputPacket(8, { buttons: BUTTONS.select });
  assert.equal(packet.readUInt32LE(12), BUTTONS.select);
});

test('parses telemetry', () => {
  const packet = Buffer.alloc(64);
  packet.writeUInt32LE(0x4b413846, 0); packet.writeUInt16LE(1, 4); packet.writeUInt16LE(64, 6);
  packet.writeUInt32LE(9, 8); packet.writeFloatLE(22.5, 24); packet.writeFloatLE(.4, 32); packet.writeUInt32LE(2, 56);
  packet.writeUInt32LE(fnvChecksum(packet), 60);
  const value = parseTelemetry(packet);
  assert.equal(value.sequence, 9); assert.equal(value.speed, 22.5); assert.ok(Math.abs(value.slipAngle - .4) < 1e-6); assert.equal(value.mode, 2);
});

test('parses frame chunks', () => {
  const packet = Buffer.alloc(27);
  packet.writeUInt32LE(0x52463846, 0); packet.writeUInt16LE(1, 4); packet.writeUInt16LE(24, 6);
  packet.writeUInt32LE(3, 8); packet.writeUInt16LE(1, 12); packet.writeUInt16LE(2, 14); packet.writeUInt16LE(3, 16);
  packet.writeUInt16LE(320, 18); packet.writeUInt16LE(180, 20); packet.set([1,2,3], 24);
  const chunk = parseFrameChunk(packet);
  assert.equal(chunk.frameId, 3); assert.equal(chunk.chunkIndex, 1); assert.deepEqual([...chunk.payload], [1,2,3]);
});
