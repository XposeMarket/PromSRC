import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const mobilePages = read('web-ui/src/mobile/mobile-pages.js');
const mobileRenderer = read('web-ui/src/mobile/mobile-chat-renderer-runtime.js');
const mobileCss = read('web-ui/src/styles/mobile.css');

const cardStart = mobileRenderer.indexOf('function _renderMobileQuestionCard(');
const cardEnd = mobileRenderer.indexOf('function _renderChatMessageHtml(', cardStart);
assert(cardStart >= 0 && cardEnd > cardStart, 'mobile question card renderer must remain discoverable');
const cardSource = mobileRenderer.slice(cardStart, cardEnd);

assert.match(cardSource, /data-pm-q-text/, 'text questions must own an inline answer field');
assert.match(cardSource, /data-pm-q-other/, 'Other answers must own an inline answer field');
assert.match(cardSource, /data-pm-q-general/, 'general context must have an inline answer field');
assert.match(cardSource, /data-pm-q-submit/, 'question cards must expose a semantic submit control');
assert.match(cardSource, /_submitMobileQuestion\(\$\{idJson\}\)/, 'question submit must use the card action');
assert.match(mobilePages, /function _renderMobileQuestionCard\(\.\.\.args\) \{ return _mobileChatRendererInvoke\('_renderMobileQuestionCard', args\); \}/, 'question markup must remain renderer-owned');

assert.match(mobilePages, /const liveDraftMap = host\.hidden \? \{\} : _captureMobileQuestionDraftState\(host\)/, 'question takeover must capture live drafts before rebuilding');
assert.match(mobilePages, /document\.getElementById\('pm-composer-input'\)\?\.blur\?\.\(\)/, 'question takeover must dismiss the normal composer focus');
assert.match(mobilePages, /form\.classList\.toggle\('has-pending-question', questionPending\)/, 'composer state must expose pending question ownership');
assert.match(mobilePages, /Answer before submitting:/, 'required-answer messaging must not refer to the hidden composer');

assert.match(mobileCss, /\.pm-composer\.has-pending-question \.pm-composer-row[\s\S]*?display: none !important/, 'pending questions must hide the normal mobile composer row');
assert.match(mobileCss, /\.pm-composer\.has-pending-question \.pm-mobile-question-popover[\s\S]*?position: relative/, 'pending questions must occupy the composer host');
assert.match(mobileCss, /\.pm-q-input:focus/, 'question fields must retain a visible focus treatment');

console.log('Mobile question composer contract passed.');
