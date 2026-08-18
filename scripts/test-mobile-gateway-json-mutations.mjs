import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('web-ui/src/mobile/mobile-gateway-catalog.js', 'utf8');
const generated = fs.readFileSync('generated/public-web-ui/static/mobile/mobile-gateway-catalog.js', 'utf8');
assert.equal(source, generated, 'generated mobile gateway catalog must mirror canonical source');

let runnable = source.replace(/import\s+\{[\s\S]*?\}\s+from\s+'\.\/mobile-api\.js';/, '');
runnable = runnable.replace(/\bexport\s+/g, '');

const values = new Map();
const localStorage = {
  getItem: (key) => values.has(String(key)) ? values.get(String(key)) : null,
  setItem: (key, value) => values.set(String(key), String(value)),
  removeItem: (key) => values.delete(String(key)),
};
const window = {
  localStorage,
  location: { origin: 'https://phone.example' },
  dispatchEvent() {},
};
const context = {
  window,
  location: window.location,
  API: 'https://phone.example',
  getDeviceToken: () => '',
  clearDeviceToken() {},
  Headers,
  URL,
  URLSearchParams,
  AbortController,
  CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
  setTimeout,
  clearTimeout,
  btoa: (value) => Buffer.from(String(value), 'binary').toString('base64'),
  atob: (value) => Buffer.from(String(value), 'base64').toString('binary'),
  escape,
  unescape,
  console,
};

vm.runInNewContext(`${runnable}\nthis.__catalog = { upsertGateway, updateGatewayStatus, gatewayFetchJson };`, context, {
  filename: 'mobile-gateway-catalog.js',
});

const catalog = context.__catalog;
const gateway = catalog.upsertGateway({
  gatewayId: 'gw-desktop',
  name: 'Desktop Prometheus',
  origin: 'https://desktop.example',
  execution: { enabled: true, mode: 'paired-device-direct', scopes: ['chat.write'] },
}, { token: 'desktop-token', deviceId: 'desktop-device' });
catalog.updateGatewayStatus(gateway.gatewayId, { status: 'online' });

let request = null;
context.fetch = async (url, options) => {
  request = { url: String(url), options };
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => JSON.stringify({ session: { id: 'thread-1', pinnedAt: Date.now() } }),
  };
};

const pinBody = JSON.stringify({ pinned: true });
await catalog.gatewayFetchJson(gateway.gatewayId, '/api/sessions/thread-1', {
  method: 'PATCH',
  body: pinBody,
});

assert.equal(request.url, 'https://desktop.example/api/sessions/thread-1');
assert.equal(request.options.method, 'PATCH');
assert.equal(request.options.body, pinBody, 'remote mutation body must not be transformed');
assert.equal(request.options.headers.get('X-Pairing-Token'), 'desktop-token');
assert.equal(request.options.headers.get('Accept'), 'application/json');
assert.equal(
  request.options.headers.get('Content-Type'),
  'application/json',
  'remote session mutations must declare JSON so the gateway parses pinned/title fields',
);

await catalog.gatewayFetchJson(gateway.gatewayId, '/api/custom', {
  method: 'POST',
  body: 'custom',
  headers: { 'Content-Type': 'application/merge-patch+json' },
});
assert.equal(
  request.options.headers.get('Content-Type'),
  'application/merge-patch+json',
  'an explicit caller content type must be preserved',
);

console.log('[test-mobile-gateway-json-mutations] passed: remote pin/session bodies are parsed as JSON without weakening target-scoped auth');
