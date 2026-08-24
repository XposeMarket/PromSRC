import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('web-ui/src/mobile/mobile-pages.js', 'utf8');
const rendererStart = source.indexOf('function _renderThread(');
const rendererEnd = source.indexOf("if (!window.__pmToolActivityReadyBridgeInstalled)", rendererStart);
const sessionRenderStart = source.indexOf('function _renderMobileChatSessionNow(');
const sessionRenderEnd = source.indexOf('const mobileSourceState =', sessionRenderStart);
assert.ok(rendererStart >= 0 && rendererEnd > rendererStart, 'main mobile renderer seam must remain discoverable');
assert.ok(sessionRenderStart >= 0 && sessionRenderEnd > sessionRenderStart, 'mobile session renderer seam must remain discoverable');

const renderer = source.slice(rendererStart, rendererEnd);
const sessionRenderer = source.slice(sessionRenderStart, sessionRenderEnd);
assert.doesNotMatch(renderer, /__pmChat\.threads/, 'main renderer must not read compatibility transcript threads');
assert.doesNotMatch(sessionRenderer, /__pmChat\.threads/, 'session renderer must not read compatibility transcript threads');
assert.match(renderer, /getTranscriptRows\(sid/, 'main renderer must consume runtime-backed rows');
assert.match(sessionRenderer, /getTranscriptRows\(renderSid/, 'session renderer must consume runtime-backed rows');

console.log('Mobile chat renderer authority contract passed.');
