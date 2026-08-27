import assert from 'node:assert/strict';
import fs from 'node:fs';

const pages = fs.readFileSync('web-ui/src/mobile/mobile-pages.js', 'utf8');
const desktop = fs.readFileSync('web-ui/src/pages/ChatPage.js', 'utf8');
const voice = fs.readFileSync('web-ui/src/mobile/mobile-voice-page.js', 'utf8');
const css = fs.readFileSync('web-ui/src/styles/mobile.css', 'utf8');

assert.match(css, /\.pm-voice-body--page \.pm-voice-snap-primary \.pm-voice-orb-dock[\s\S]{0,180}top: 50%[\s\S]{0,80}bottom: auto[\s\S]{0,80}transform: translateY\(-50%\)/, 'standalone voice orb dock must be centered in the primary stage');
assert.match(voice, /mobileThinkingOrb = controller[\s\S]{0,180}requestAnimationFrame\(_drawStandaloneOrbReaction\)/, 'voice audio RAF must start after the async orb mounts');
assert.match(pages, /function _mobileImageGenerationEntryAction\(/, 'mobile image pending detection must inspect nested tool activity');
assert.match(pages, /value === 'image_gen'[\s\S]{0,80}value === 'imagegen'/, 'mobile image pending detection must accept provider aliases');
assert.match(pages, /const activeImageCalls = new Set\(\)/, 'mobile image pending state must be keyed by call identity');
assert.match(desktop, /const activeImageCalls = new Set\(\)/, 'desktop image pending state must be keyed by call identity');
assert.match(desktop, /\['generate_image', 'image_gen', 'imagegen'\]/, 'desktop image pending detection must accept provider aliases');
assert.match(pages, /activeImageCalls\.delete\(key\)/, 'mobile image completion/error must clear its keyed pending state');
assert.match(pages, /activeImageCalls\.clear\(\)/, 'mobile legacy image completion/error must clear anonymous pending state');
assert.match(desktop, /activeImageCalls\.delete\(key\)/, 'desktop image completion/error must clear its keyed pending state');
assert.match(desktop, /activeImageCalls\.clear\(\)/, 'desktop legacy image completion/error must clear anonymous pending state');

console.log('[mobile-voice-image-lifecycle] voice centering, async orb animation, and keyed image loading contracts passed');
