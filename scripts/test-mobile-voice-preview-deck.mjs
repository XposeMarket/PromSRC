import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VOICE_PREVIEW_DISMISS_DISTANCE_PX,
  getVoicePreviewDragStyle,
  getVoicePreviewGestureOutcome,
} from '../web-ui/src/mobile/voice-preview-deck.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pages = fs.readFileSync(path.join(root, 'web-ui/src/mobile/mobile-pages.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'web-ui/src/styles/mobile.css'), 'utf8');

const narrowCard = { left: 16, right: 374, top: 118, bottom: 410 };
const firstPixels = getVoicePreviewDragStyle({ dx: 4, dy: 3, cardRect: narrowCard, viewportWidth: 390, viewportHeight: 844 });
assert.equal(firstPixels.opacity, '1', 'the first pixels of a swipe must not fade the active card');
assert.match(firstPixels.transform, /scale\(1\)/, 'the first pixels of a swipe must not shrink the active card');

const boundedDrag = getVoicePreviewDragStyle({ dx: 180, dy: 260, cardRect: narrowCard, viewportWidth: 390, viewportHeight: 844 });
assert.match(boundedDrag.transform, /translate3d\(6px, 260px, 0\)/, 'gesture translation must remain inside a narrow viewport');
assert.equal(getVoicePreviewGestureOutcome({ dx: VOICE_PREVIEW_DISMISS_DISTANCE_PX, dy: 0 }), 'dismiss');
assert.equal(getVoicePreviewGestureOutcome({ dx: 180, dy: 0, cancelled: true }), 'reset', 'a cancelled swipe must always reverse instead of dequeuing');

assert.match(pages, /getVoicePreviewDragStyle\(/, 'Voice preview wiring must use the bounded drag style');
assert.match(pages, /pointercancel[\s\S]{0,120}cancelled: true/, 'pointer cancellation must be marked as a reversal');
assert.match(pages, /const outcome = getVoicePreviewGestureOutcome\(\{ dx, dy, cancelled \}\)/, 'gesture outcome must receive the cancellation state');
assert.match(pages, /previewTransitionTimer/, 'preview transitions need a cancellable timer');
assert.match(css, /\.pm-voice-preview-host \{[\s\S]*?overflow: clip;/, 'the preview deck must contain its layers');
assert.match(css, /\.pm-voice-preview-ghost \{[\s\S]*?height: var\(--pm-voice-preview-card-height/, 'artifact ghosts must retain a full card footprint');
assert.doesNotMatch(pages, /card\.style\.opacity = String\(Math\.max\(\.35/, 'live swipe progress must not interpolate card opacity');

console.log('mobile voice preview deck gesture contract: ok');
