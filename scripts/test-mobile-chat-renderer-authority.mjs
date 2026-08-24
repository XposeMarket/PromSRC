import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('web-ui/src/mobile/mobile-chat-renderer-runtime.js', 'utf8');
const rendererStart = source.indexOf('function _renderThread(');
const rendererEnd = source.indexOf("if (!window.__pmToolActivityReadyBridgeInstalled)", rendererStart);
const sessionRenderStart = source.indexOf('function _renderMobileChatSessionNow(');
const sessionRenderEnd = source.indexOf('\n  // Background/process rendering and agent transcript presentation are Chat-owned optional work.', sessionRenderStart);
assert.ok(rendererStart >= 0 && rendererEnd > rendererStart, 'main mobile renderer seam must remain discoverable');
assert.ok(sessionRenderStart >= 0 && sessionRenderEnd > sessionRenderStart, 'mobile session renderer seam must remain discoverable');

const renderer = source.slice(rendererStart, rendererEnd);
const sessionRenderer = source.slice(sessionRenderStart, sessionRenderEnd);
const transcriptAuthorityForbidden = /__pmChat\.threads|_activeMobileThread\(/;
assert.doesNotMatch(renderer, transcriptAuthorityForbidden, 'main renderer must not read compatibility transcript threads');
assert.doesNotMatch(sessionRenderer, transcriptAuthorityForbidden, 'session renderer must not read compatibility transcript threads');
assert.match(renderer, /getTranscriptRows\(sid/, 'main renderer must consume runtime-backed rows');
assert.match(sessionRenderer, /getTranscriptRows\(renderSid/, 'session renderer must consume runtime-backed rows');

function sliceFunction(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `${name} seam must remain discoverable`);
  return source.slice(start, end);
}

const streamingPatch = sliceFunction('_patchLatestMobileStreamingMessage', '_scheduleMobileStreamingPatch');
const workTimerLabel = sliceFunction('_syncMobileWorkTimerLabel', '_syncMobileWorkTimer');
const workTimer = sliceFunction('_syncMobileWorkTimer', '_installMobileTimestampReveal');
for (const [name, body] of [
  ['streaming patch', streamingPatch],
  ['work timer label', workTimerLabel],
  ['work timer', workTimer],
]) {
  assert.doesNotMatch(body, transcriptAuthorityForbidden, `${name} must not read compatibility transcript threads`);
  assert.match(body, /getTranscriptRows\(/, `${name} must consume runtime-backed rows`);
}

console.log('Mobile chat renderer authority contract passed.');
