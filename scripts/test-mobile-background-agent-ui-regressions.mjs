import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const pages = read('web-ui/src/mobile/mobile-pages.js');
const runtime = read('web-ui/src/mobile/mobile-chat-renderer-runtime.js');
const messageRenderer = read('web-ui/src/mobile/mobile-chat-message-renderer.js');

assert.match(pages, /mobileChatRendererPendingCalls/, 'background frames must buffer while the lazy renderer hydrates');
assert.match(pages, /'_pushMobileBackgroundSpawnEvent'/, 'background event reducer must be deferred safely');
assert.match(pages, /'_completeMobileBackgroundSpawnLane'/, 'background completion reducer must be deferred safely');
assert.match(runtime, /const nestedEvent = \(msg\?\.event[\s\S]{0,260}payload\?\.event/, 'nested background event payloads must be normalized');
assert.match(runtime, /evt\.delta[\s\S]{0,240}evt\.content/, 'token events must accept provider delta/content fields');
assert.match(runtime, /evt\.result[\s\S]{0,240}evt\.data\?\.content/, 'terminal events must accept result/data content fields');
assert.match(messageRenderer, /msgIndex >= 0 && __pmChat\.editingMessageIndex === msgIndex/, 'synthetic prompt rows must not collide with edit sentinel -1');

for (const relative of [
  'mobile-chat-message-renderer.js',
  'mobile-chat-renderer-runtime.js',
  'mobile-pages.js',
]) {
  assert.equal(
    read(`web-ui/src/mobile/${relative}`),
    read(`generated/public-web-ui/static/mobile/${relative}`),
    `generated mobile ${relative} must mirror source`,
  );
}

console.log('mobile background-agent UI regressions: passed');
