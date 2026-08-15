import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const source = read('web-ui/src/api.js');
const generated = read('generated/public-web-ui/static/api.js');

assert.equal(source, generated, 'generated API client must match canonical source');
assert.doesNotMatch(
  source,
  /127\.0\.0\.1:18789/,
  'shared API routing must not fall back to the obsolete fixed gateway port',
);

let executable = source
  .replace(/^import\s+\{\s*API\s*\}\s+from\s+'\.\/state\.js';\s*$/m, '')
  .replace(/\bexport\s+/g, '');
executable = executable.split('// ─── Endpoint Constants')[0];

const values = new Map();
const localStorage = {
  getItem: (key) => values.get(String(key)) ?? null,
  setItem: (key, value) => values.set(String(key), String(value)),
};
const window = {
  location: { origin: 'http://127.0.0.1:24567', protocol: 'http:' },
  localStorage,
};
const context = {
  API: '',
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
};
vm.runInNewContext(
  `${executable}\nthis.__buildApiCandidateUrls = buildApiCandidateUrls;`,
  context,
  { filename: 'api.js' },
);

assert.deepEqual(
  Array.from(context.__buildApiCandidateUrls('/api/status')),
  ['/api/status'],
  'Electron/same-origin API requests must stay on the relay origin that served the page',
);

window.__pmMobileActiveGatewayId = 'gw-mac';
window.__pmMobileActiveGatewayOrigin = 'https://mac.example';
window.__pmMobileActiveGatewayToken = 'mac-token';
window.__pmMobileActiveGatewayExecutionEnabled = true;
assert.deepEqual(
  Array.from(context.__buildApiCandidateUrls('/api/status')),
  ['https://mac.example/api/status'],
  'explicit remote mobile targets must remain target-scoped after removing the desktop fallback',
);

console.log('[test-api-origin-isolation] passed: API requests cannot fall through to stale port 18789');
