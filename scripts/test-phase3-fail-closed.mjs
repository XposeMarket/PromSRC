import assert from 'node:assert/strict';
import express from 'express';

const { buildWebhookRouter } = await import('../dist/gateway/comms/webhook-handler.js');
const { validateXFetchPayload } = await import('../dist/tools/web.js');
const { isUsableProductArtifactItem, normalizeProductArtifactItems } = await import('../dist/gateway/rich-artifacts.js');

const events = [];
let config = { enabled: true, token: 'phase3-secret', path: '/hooks' };
const app = express();
app.use(express.json());
app.use('/hooks', buildWebhookRouter({
  handleChat: async () => ({ type: 'assistant', text: 'ok' }),
  addMessage: (id, message) => events.push({ type: 'message', id, message }),
  getIsModelBusy: () => false,
  broadcast: (data) => events.push({ type: 'broadcast', data }),
  deliverTelegram: async () => {},
}, () => config));

const server = await new Promise((resolve) => {
  const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
});
const address = server.address();
const base = `http://127.0.0.1:${address.port}/hooks`;

async function request(path, init = {}) {
  const response = await fetch(`${base}${path}`, init);
  const text = await response.text();
  let body = text;
  try { body = JSON.parse(text); } catch {}
  return { status: response.status, body };
}

try {
  assert.equal((await request('/status')).status, 401);
  assert.equal((await request('/status?token=phase3-secret')).status, 400);
  assert.equal((await request('/status', { headers: { authorization: 'Bearer wrong' } })).status, 401);
  const status = await request('/status', { headers: { authorization: 'Bearer phase3-secret' } });
  assert.equal(status.status, 200);
  assert.equal(status.body.ok, true);

  const missingWake = await request('/wake', {
    method: 'POST', headers: { authorization: 'Bearer phase3-secret', 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(missingWake.status, 400);
  const malformed = await request('/wake', {
    method: 'POST', headers: { authorization: 'Bearer phase3-secret', 'content-type': 'application/json' }, body: '{bad',
  });
  assert.equal(malformed.status, 400);
  const wake = await request('/wake', {
    method: 'POST', headers: { 'x-prometheus-token': 'phase3-secret', 'content-type': 'application/json' }, body: JSON.stringify({ text: 'fixture event', mode: 'next-heartbeat' }),
  });
  assert.equal(wake.status, 200);
  assert.equal(wake.body.mode, 'next-heartbeat');
  assert(events.some((event) => event.type === 'message'));
  assert(events.some((event) => event.type === 'broadcast'));

  config = { ...config, enabled: false };
  assert.equal((await request('/status', { headers: { authorization: 'Bearer phase3-secret' } })).status, 200);
  const disabledWake = await request('/wake', {
    method: 'POST', headers: { authorization: 'Bearer phase3-secret', 'content-type': 'application/json' }, body: JSON.stringify({ text: 'fixture' }),
  });
  assert.equal(disabledWake.status, 503);
} finally {
  await new Promise((resolve) => server.close(resolve));
}

const xUrl = 'https://x.com/example/status/123';
assert.match(validateXFetchPayload({ success: true, url: xUrl, tweets: [], count: 0 }, xUrl), /returned no posts/i);
assert.match(validateXFetchPayload({ success: false, url: xUrl, error: 'auth failed' }, xUrl), /auth failed/i);
assert.equal(validateXFetchPayload({ success: true, url: xUrl, tweets: [{ id: '123', text: 'hello' }], count: 1 }, xUrl), null);

const normalized = normalizeProductArtifactItems([
  { title: 'Valid product', productUrl: 'https://shop.example/item', imageUrl: 'https://shop.example/item.jpg', price: '$19.00' },
  { title: 'No image', productUrl: 'https://shop.example/no-image', price: '$12.00' },
  { title: 'No metadata', productUrl: 'https://shop.example/no-meta', imageUrl: 'https://shop.example/no-meta.jpg' },
  { title: 'Invalid URL', productUrl: 'javascript:alert(1)', imageUrl: 'https://shop.example/x.jpg', price: '$1.00' },
]);
assert.equal(normalized.length, 3);
assert.equal(isUsableProductArtifactItem(normalized[0]), true);
assert.equal(isUsableProductArtifactItem(normalized[1]), false);
assert.equal(isUsableProductArtifactItem(normalized[2]), false);

console.log('Phase 3 fail-closed regression tests passed.');
