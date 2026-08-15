import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function loadApiForTest() {
  let source = read('web-ui/src/api.js');
  source = source.replace(/^import\s+\{\s*API\s*\}\s+from\s+'\.\/state\.js';\s*$/m, '');
  source = source.replace(/\bexport\s+/g, '');
  source = source.split('// ─── Endpoint Constants')[0];

  const values = new Map([['pm_device_token', 'legacy-current-token']]);
  const localStorage = {
    getItem: (key) => values.has(String(key)) ? values.get(String(key)) : null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: (key) => values.delete(String(key)),
  };
  const window = {
    location: { origin: 'https://phone.example', protocol: 'https:' },
    localStorage,
  };
  const context = {
    API: 'https://phone.example',
    window,
    localStorage,
    location: window.location,
    URL,
    URLSearchParams,
    Headers,
    FormData,
    Blob,
    ArrayBuffer,
    AbortController,
    setTimeout,
    clearTimeout,
    console,
    fetch: null,
  };
  vm.runInNewContext(`${source}\nthis.__api = { api, getDedupeKey, buildApiCandidateUrls };`, context, { filename: 'api.js' });
  return context;
}

function selectGateway(ctx, { id, origin, token, enabled = true }) {
  ctx.window.__pmMobileActiveGatewayId = id;
  ctx.window.__pmMobileActiveGatewayOrigin = origin;
  ctx.window.__pmMobileActiveGatewayToken = token;
  ctx.window.__pmMobileActiveGatewayExecutionEnabled = enabled;
}

async function run() {
  assert.equal(
    read('web-ui/src/api.js'),
    read('generated/public-web-ui/static/api.js'),
    'generated API client must remain in sync with canonical source',
  );

  const ctx = loadApiForTest();
  const calls = [];
  ctx.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({ success: true }),
    };
  };

  selectGateway(ctx, {
    id: 'gw-mac',
    origin: 'https://mac.example',
    token: 'mac-token',
  });
  await ctx.__api.api('/api/teams', { dedupe: false });
  assert.equal(calls.length, 1, 'remote requests do not try local fallback candidates');
  assert.equal(calls[0].url, 'https://mac.example/api/teams');
  assert.equal(calls[0].options.headers['X-Pairing-Token'], 'mac-token');
  assert.notEqual(calls[0].options.headers['X-Pairing-Token'], 'legacy-current-token');

  selectGateway(ctx, {
    id: 'gw-unpaired',
    origin: 'https://unpaired.example',
    token: '',
  });
  await assert.rejects(
    () => ctx.__api.api('/api/teams', { dedupe: false }),
    (error) => error?.code === 'GATEWAY_NOT_PAIRED',
    'remote API access fails closed without that gateway pairing grant',
  );
  assert.equal(calls.length, 1, 'fail-closed routing must not fall back to the current gateway');

  selectGateway(ctx, {
    id: 'gw-readonly',
    origin: 'https://readonly.example',
    token: 'readonly-token',
    enabled: false,
  });
  await assert.rejects(
    () => ctx.__api.api('/api/teams', { dedupe: false }),
    (error) => error?.code === 'REMOTE_EXECUTION_NOT_ENABLED',
    'remote API access respects the execution capability gate',
  );
  assert.equal(calls.length, 1);

  // Same endpoint on two computers must never share one in-flight GET promise.
  const pending = [];
  ctx.fetch = (url, options) => new Promise((resolve) => {
    pending.push({ url: String(url), options, resolve });
  });
  selectGateway(ctx, {
    id: 'gw-mac',
    origin: 'https://mac.example',
    token: 'mac-token',
  });
  const macRequest = ctx.__api.api('/api/status');
  await Promise.resolve();

  selectGateway(ctx, {
    id: 'gw-desktop',
    origin: 'https://desktop.example',
    token: 'desktop-token',
  });
  const desktopRequest = ctx.__api.api('/api/status');
  await Promise.resolve();

  assert.notEqual(macRequest, desktopRequest, 'GET coalescing is scoped to the selected gateway');
  assert.equal(pending.length, 2, 'each gateway receives its own request');
  assert.equal(pending[0].url, 'https://mac.example/api/status');
  assert.equal(pending[1].url, 'https://desktop.example/api/status');
  assert.equal(pending[0].options.headers['X-Pairing-Token'], 'mac-token');
  assert.equal(pending[1].options.headers['X-Pairing-Token'], 'desktop-token');

  for (const request of pending) {
    request.resolve({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({ success: true }),
    });
  }
  await Promise.all([macRequest, desktopRequest]);

  console.log('[test-mobile-gateway-api-routing] passed: generic mobile API calls stay target-scoped and fail closed');
}

run().catch((error) => {
  console.error('[test-mobile-gateway-api-routing] failed:', error);
  process.exitCode = 1;
});
