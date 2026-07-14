import assert from 'node:assert/strict';
import test from 'node:test';
import { BUTTONS, makePacket, parseAck } from './control-server.mjs';

function checksum(buffer) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < buffer.length - 4; i++) {
    hash ^= buffer[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

test('encodes a valid Vita input v2 packet', () => {
  const packet = makePacket({ press: ['cross', 'right'], lx: 5, ry: 250 });
  assert.equal(packet.length, 24);
  assert.equal(packet.readUInt32LE(0), 0x50495650);
  assert.equal(packet.readUInt16LE(4), 2);
  assert.equal(packet.readUInt16LE(6), 24);
  assert.equal(packet.readUInt32LE(12), BUTTONS.cross | BUTTONS.right);
  assert.equal(packet[16], 5);
  assert.equal(packet[19], 250);
  assert.equal(packet.readUInt32LE(20), checksum(packet));
});

test('parses Vita acknowledgement telemetry', () => {
  const ack = Buffer.alloc(28);
  ack.writeUInt32LE(0x4b415650, 0);
  ack.writeUInt16LE(1, 4);
  ack.writeUInt16LE(28, 6);
  ack.writeUInt32LE(44, 8);
  ack.writeUInt32LE(1, 12);
  ack.writeInt32LE(0, 16);
  ack.writeInt32LE(-7, 20);
  ack.writeUInt32LE(checksum(ack), 24);
  assert.deepEqual(parseAck(ack), {
    sequence: 44,
    status: 1,
    buttonResult: 0,
    analogResult: -7,
  });
});

test('rejects corrupt Vita acknowledgements', () => {
  assert.throws(() => parseAck(Buffer.alloc(28)), /magic/);
});

test('rejects unknown button names', () => {
  assert.throws(() => makePacket({ press: ['nope'] }), /Unknown Vita button/);
});
