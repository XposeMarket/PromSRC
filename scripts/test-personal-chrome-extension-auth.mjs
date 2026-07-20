import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'extensions/prometheus-personal-chrome/service-worker.js'), 'utf8');
const secret = 'extension-test-secret-0123456789';
const protocol = 'prometheus-personal-chrome/v1';
const hmac = (domain, ...parts) => crypto.createHmac('sha256', secret).update([protocol, domain, ...parts].join('\0')).digest('base64url');
const tick = () => new Promise(resolve => setTimeout(resolve, 15));

async function boot() {
  const instances = [];
  class FakeSocket {
    static OPEN = 1; static CONNECTING = 0;
    constructor() { this.readyState = 0; this.sent = []; this.closed = null; instances.push(this); }
    send(value) { this.sent.push(JSON.parse(value)); }
    close(code, reason) { this.closed = { code, reason }; this.readyState = 3; }
  }
  const event = { addListener() {} };
  const chrome = {
    storage: { local: { get: async () => ({ pairingSecret: secret }), set: async () => {} } },
    runtime: { getManifest: () => ({ version: 'test' }), onStartup: event, onInstalled: event, onMessage: event },
    alarms: { create() {}, onAlarm: event }, debugger: { onDetach: event, onEvent: event, attach: async () => {}, sendCommand: async () => {} },
    tabs: { onRemoved: event, query: async () => [], create: async () => ({}), update: async () => {}, remove: async () => {}, get: async () => ({}) }, windows: { update: async () => {} }, downloads: { search: async () => [] },
  };
  const context = vm.createContext({ chrome, WebSocket: FakeSocket, crypto: crypto.webcrypto, TextEncoder, btoa, setTimeout, clearTimeout, console });
  vm.runInContext(source, context, { filename: 'service-worker.js' });
  await tick(); const socket = instances[0]; assert.ok(socket, 'extension should attempt loopback connection'); socket.readyState = FakeSocket.OPEN; socket.onopen(); await tick();
  return socket;
}

// A fake local listener cannot elicit the pairing secret and fails server proof.
const badChallenge = await boot(); const hello = badChallenge.sent[0];
assert.equal(hello.kind, 'client_hello'); assert.equal('secret' in hello, false, 'raw secret must never be sent');
badChallenge.onmessage({ data: JSON.stringify({ kind: 'server_challenge', serverNonce: crypto.randomBytes(32).toString('base64url'), proof: 'wrong' }) }); await tick();
assert.equal(badChallenge.closed?.code, 4003, 'wrong server proof must close the socket');

// A correct challenge followed by a bad final proof also fails before commands.
const badFinal = await boot(); const hello2 = badFinal.sent[0]; const serverNonce = crypto.randomBytes(32).toString('base64url');
badFinal.onmessage({ data: JSON.stringify({ kind: 'server_challenge', serverNonce, proof: hmac('server-proof', hello2.clientNonce, serverNonce) }) }); await tick();
assert.equal(badFinal.sent[1]?.kind, 'client_proof');
badFinal.onmessage({ data: JSON.stringify({ kind: 'authenticated', proof: 'wrong' }) }); await tick();
assert.equal(badFinal.closed?.code, 4004, 'wrong final server proof must close the socket');
console.log('PASS: extension rejects wrong server proofs without exposing the pairing secret');
