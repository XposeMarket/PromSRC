import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('web-ui/mobile-v2.html');
const entry = read('web-ui/src/mobile-v2/mobile-v2-entry.js');
const gateway = read('web-ui/src/mobile-v2/core/gateway-client.js');
const store = read('web-ui/src/mobile-v2/core/chat-store.js');
const shell = read('web-ui/src/mobile-v2/ui/shell.js');
const css = read('web-ui/src/mobile-v2/mobile-v2.css');

assert.match(html, /mobile-v2-root/);
assert.match(html, /src\/mobile-v2\/mobile-v2-entry\.js/);
assert.match(entry, /GatewayClient/);
assert.match(entry, /ChatStore/);
assert.match(gateway, /X-Pairing-Token/);
assert.match(gateway, /\/api\/chat/);
assert.match(gateway, /history-page/);
assert.match(store, /gatewayId/);
assert.match(store, /sessionId/);
assert.match(shell, /pm-tabbar/);
assert.match(shell, /pm-drawer/);
assert.match(shell, /pm-session-row/);
assert.match(css, /@import '\.\.\/styles\/mobile\.css'/);

for (const source of [entry, gateway, store, shell]) {
  assert.doesNotMatch(source, /window\.__pm/, 'Mobile V2 must not adopt legacy mobile global state.');
  assert.doesNotMatch(source, /from ['"]\.\.\/mobile\//, 'Mobile V2 must not import the legacy mobile runtime.');
  assert.doesNotMatch(source, /mobile-pages\.js|mobile-router\.js|mobile-api\.js/, 'Mobile V2 must stay runtime-isolated from legacy mobile modules.');
}

console.log('mobile-v2 foundation: isolated runtime, existing visual contract, gateway protocol wiring passed');
