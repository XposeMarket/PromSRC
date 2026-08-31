import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const sourcePages = read('web-ui/src/mobile/mobile-pages.js');
const sourceRuntime = read('web-ui/src/mobile/mobile-chat-renderer-runtime.js');
const generatedPages = read('generated/public-web-ui/static/mobile/mobile-pages.js');
const generatedRuntime = read('generated/public-web-ui/static/mobile/mobile-chat-renderer-runtime.js');
const manifest = JSON.parse(read('generated/public-web-ui/asset-manifest.json'));
const assets = new Map(manifest.assets.map((asset) => [asset.path, asset]));

assert.equal(generatedPages, sourcePages, 'generated mobile-pages.js must mirror source');
assert.equal(generatedRuntime, sourceRuntime, 'generated mobile-chat-renderer-runtime.js must mirror source');
assert.match(sourcePages, /import\('\.\/mobile-chat-renderer-runtime\.js'\)/, 'Chat must lazy-load its renderer runtime');
assert.doesNotMatch(sourcePages, /from ['"]\.\/mobile-chat-renderer-runtime\.js['"]/, 'Chat must not statically import its renderer runtime');
assert.match(sourcePages, /export async function renderChatPage/, 'Chat route must await renderer hydration');
assert.match(sourcePages, /await loadMobileChatRendererRuntime\(\)/, 'Chat route must hydrate before the first render');
assert.match(sourcePages, /function _renderChatMessageHtml\(\.\.\.args\) \{ return _mobileChatRendererInvoke\('_renderChatMessageHtml', args\); \}/, 'rich-message construction must be a renderer facade');
assert.match(sourcePages, /function _renderThread\(\.\.\.args\) \{ return _mobileChatRendererInvoke\('_renderThread', args\); \}/, 'transcript rendering must be a renderer facade');
assert.match(sourcePages, /function _applyMobileAgentStreamEvent\(\.\.\.args\) \{ return _mobileChatRendererInvoke\('_applyMobileAgentStreamEvent', args\); \}/, 'stream reduction must be a renderer facade');
assert.match(sourcePages, /function _renderMobileBackgroundSpawnDock\(\.\.\.args\) \{ return _mobileChatRendererInvoke\('_renderMobileBackgroundSpawnDock', args\); \}/, 'background-agent dock rendering must be a renderer facade');
assert.doesNotMatch(sourcePages, /function _renderChatMessageHtml\(m,\s*index\s*=\s*-1/, 'rich-message construction must not remain in mobile-pages');
assert.doesNotMatch(sourcePages, /function _renderThread\(threadEl,\s*sessionKey\s*=\s*''\)/, 'transcript rendering must not remain in mobile-pages');
assert.doesNotMatch(sourcePages, /const PM_VOICE_SETTINGS_KEY\s*=/, 'Voice configuration must not remain in mobile-pages');
assert.match(sourceRuntime, /function _renderChatMessageHtml\s*\(/, 'renderer runtime must own rich-message construction');
assert.match(sourceRuntime, /function _renderThread\s*\(/, 'renderer runtime must own transcript rendering');
assert.match(sourceRuntime, /function _applyMobileAgentStreamEvent\s*\(/, 'renderer runtime must own stream reduction');
assert.match(sourceRuntime, /function _renderMobileBackgroundSpawnDock\s*\(/, 'renderer runtime must own background-agent dock rendering');

function outputFor(source) {
  const output = manifest.moduleOutputs[source];
  assert(output, `production manifest is missing ${source}`);
  return output;
}

function staticClosure(entryPath) {
  const seen = new Set();
  const queue = [entryPath];
  while (queue.length) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    for (const imported of assets.get(current)?.imports || []) {
      if (imported.kind === 'import-statement') queue.push(imported.path);
    }
  }
  return seen;
}

const chatOutput = outputFor('src/mobile/mobile-pages.js');
const rendererOutput = outputFor('src/mobile/mobile-chat-renderer-runtime.js');
const chatClosure = staticClosure(chatOutput);
assert(!chatClosure.has(rendererOutput), 'Chat renderer runtime leaked into the Chat static closure');
assert(
  manifest.assets.some((asset) => asset.imports?.some((entry) => entry.kind === 'dynamic-import' && entry.path === rendererOutput)),
  'production manifest must record the Chat renderer as a dynamic import',
);

const records = [...chatClosure].map((pathname) => assets.get(pathname)).filter(Boolean);
const measurements = {
  rawBytes: records.reduce((total, record) => total + record.bytes, 0),
  gzipBytes: records.reduce((total, record) => total + record.gzipBytes, 0),
  moduleCount: records.length,
};
// The mobile question stepper keeps prior answers in the chat-side draft map
// and animates the composer-owned handoff; keep the performance guard tight
// while allowing that intentional interaction state logic.
// Goal launches now prime the normal live-turn surface at lifecycle admission
// so the first tool frame has an owner; keep the budget tight while allowing
// that intentional goal-stream handoff. The background-agent side-chat
// disclosure, prompt replay, and recovery presentation add 559 gzip bytes over
// current main, so the ceiling is ratcheted to the exact refreshed measurement.
assert(measurements.gzipBytes <= 250913, `Chat renderer slice regressed to ${measurements.gzipBytes} gzip bytes`);
console.log(JSON.stringify({ buildId: manifest.buildId, measurements, rendererOutput }, null, 2));
console.log('Mobile Chat renderer ownership contract passed.');
