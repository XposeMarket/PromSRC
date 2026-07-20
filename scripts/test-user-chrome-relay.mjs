import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import WebSocket from 'ws';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const relayModule = await import(pathToFileURL(path.join(root, 'dist/gateway/user-chrome-relay.js')).href);
const port = 19234;
const secret = 'test-pairing-secret-0123456789abcdef';
const relay = new relayModule.UserChromeRelay({ port, pairingSecret: secret }); relay.ensureStarted();
const status = relay.getStatus(); assert.equal(status.port, port); assert.match(status.pairingFile, /user-chrome-extension-pairing\.json$/);
const protocol = 'prometheus-personal-chrome/v1';
const hmac = (domain, ...parts) => crypto.createHmac('sha256', secret).update([protocol, domain, ...parts].join('\0')).digest('base64url');
const open = () => new Promise((resolve, reject) => { const ws = new WebSocket(`ws://127.0.0.1:${port}/prometheus-user-chrome`); ws.once('open', () => resolve(ws)); ws.once('error', reject); });
const message = ws => new Promise((resolve, reject) => { ws.once('message', raw => resolve(JSON.parse(String(raw)))); ws.once('error', reject); });
const close = ws => new Promise(resolve => ws.once('close', resolve));
async function authenticate() {
  const ws = await open(); const clientNonce = crypto.randomBytes(32).toString('base64url');
  ws.send(JSON.stringify({ kind: 'client_hello', clientNonce, extensionVersion: 'test' }));
  const challenge = await message(ws);
  assert.equal(challenge.kind, 'server_challenge');
  assert.equal(challenge.proof, hmac('server-proof', clientNonce, challenge.serverNonce));
  ws.send(JSON.stringify({ kind: 'client_proof', proof: hmac('client-proof', clientNonce, challenge.serverNonce) }));
  const final = await message(ws); assert.equal(final.kind, 'authenticated');
  assert.equal(final.proof, hmac('server-final', clientNonce, challenge.serverNonce));
  return { ws, clientNonce, serverNonce: challenge.serverNonce };
}

// Malformed and wrong client proof never create an authenticated peer.
const malformed = await open(); malformed.send('{bad json'); await close(malformed); assert.equal(relay.getStatus().connected, false);
const wrong = await open(); const wrongClientNonce = crypto.randomBytes(32).toString('base64url'); wrong.send(JSON.stringify({ kind: 'client_hello', clientNonce: wrongClientNonce })); await message(wrong); wrong.send(JSON.stringify({ kind: 'client_proof', proof: 'wrong' })); await close(wrong); assert.equal(relay.getStatus().connected, false);
const replayNonce = crypto.randomBytes(32).toString('base64url');
const original = await open(); original.send(JSON.stringify({ kind: 'client_hello', clientNonce: replayNonce })); const originalChallenge = await message(original); const replayedProof = hmac('client-proof', replayNonce, originalChallenge.serverNonce); original.close(); await close(original);
const replay = await open(); replay.send(JSON.stringify({ kind: 'client_hello', clientNonce: replayNonce })); const replayChallenge = await message(replay); assert.notEqual(replayChallenge.serverNonce, originalChallenge.serverNonce); replay.send(JSON.stringify({ kind: 'client_proof', proof: replayedProof })); await close(replay); assert.equal(relay.getStatus().connected, false);

const peer = await authenticate(); assert.equal(relay.getStatus().authenticated, true);
peer.ws.on('message', raw => { const request = JSON.parse(String(raw)); if (request.kind !== 'command') return; const expected = hmac('command', peer.clientNonce, peer.serverNonce, request.id, JSON.stringify({ method: request.method, params: request.params })); assert.equal(request.mac, expected, 'every command must be HMAC authenticated'); const payload = { ok: true, result: { accepted: request.method }, error: '' }; peer.ws.send(JSON.stringify({ kind: 'result', id: request.id, ...payload, mac: hmac('result', peer.clientNonce, peer.serverNonce, request.id, JSON.stringify(payload)) })); });
assert.deepEqual(await relay.request('tabs.list'), { accepted: 'tabs.list' });

// An active request is rejected immediately when the peer disconnects.
peer.ws.removeAllListeners('message'); const pending = relay.request('never', {}, 10_000); peer.ws.close(); await assert.rejects(pending, /disconnected/);

// A newer mutually-authenticated peer supersedes the old one and pending work.
const first = await authenticate(); first.ws.on('message', () => {}); const superseded = relay.request('wait', {}, 10_000); const supersededCheck = assert.rejects(superseded, /superseded/); const second = await authenticate(); await supersededCheck; second.ws.close(); await close(second.ws); first.ws.close();

// A failed listen must clear state, allowing later retry instead of lying about running.
const originalConsoleError = console.error; console.error = () => {};
const blocked = new relayModule.UserChromeRelay({ port, pairingSecret: secret }); blocked.ensureStarted(); await new Promise(resolve => setTimeout(resolve, 80)); console.error = originalConsoleError; assert.equal(blocked.getStatus().running, false);
relay.wss?.close(); relay.server?.close();
console.log('PASS: Personal Chrome mutual-HMAC relay authentication, replay/malformed rejection, pending cleanup, and lifecycle');
