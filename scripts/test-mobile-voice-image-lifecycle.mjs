import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const pages = read('web-ui/src/mobile/mobile-pages.js');
const renderer = read('web-ui/src/mobile/mobile-chat-renderer-runtime.js');
const desktop = read('web-ui/src/pages/ChatPage.js');
const voice = read('web-ui/src/mobile/mobile-voice-page.js');
const css = read('web-ui/src/styles/mobile.css');

assert.match(css, /\.pm-voice-body--page \.pm-voice-snap-primary \.pm-voice-orb-dock[\s\S]{0,180}top: 50%[\s\S]{0,80}bottom: auto[\s\S]{0,80}transform: translateY\(-50%\)/, 'standalone voice orb dock must be centered in the primary stage');
assert.match(voice, /mobileThinkingOrb = controller[\s\S]{0,180}requestAnimationFrame\(_drawStandaloneOrbReaction\)/, 'voice audio RAF must start after the async orb mounts');
assert.match(renderer, /function _imageGenerationEntryAction\(/, 'mobile image pending detection must inspect nested tool activity');
assert.match(pages, /value === 'image_gen'[\s\S]{0,80}value === 'imagegen'/, 'mobile image pending detection must accept provider aliases');
assert.match(renderer, /const activeImageCalls = new Set\(\)/, 'mobile image pending state must be keyed by call identity');
assert.match(desktop, /const activeImageCalls = new Set\(\)/, 'desktop image pending state must be keyed by call identity');
assert.match(desktop, /\['generate_image', 'image_gen', 'imagegen', 'image_generation'/, 'desktop image pending detection must accept provider aliases');
assert.match(renderer, /activeImageCalls\.delete\(key\)/, 'mobile image completion/error must clear its keyed pending state');
assert.match(renderer, /activeImageCalls\.clear\(\)/, 'mobile legacy image completion/error must clear anonymous pending state');
assert.match(desktop, /activeImageCalls\.delete\(key\)/, 'desktop image completion/error must clear its keyed pending state');
assert.match(desktop, /activeImageCalls\.clear\(\)/, 'desktop legacy image completion/error must clear anonymous pending state');
assert.doesNotMatch(renderer, /generate image\|generating image\|image generation/, 'mobile image loading must not infer tool use from prose');
assert.doesNotMatch(desktop, /generate image\|generating image\|image generation/, 'desktop image loading must not infer tool use from prose');

const mobileStart = renderer.indexOf('function _imageGenerationToolName(');
const mobileEnd = renderer.indexOf('\n\n// Chat rich-message', mobileStart);
assert(mobileStart >= 0 && mobileEnd > mobileStart, 'mobile image lifecycle functions must be extractable for behavioral coverage');
const mobileHasPendingImageGeneration = new Function(
  `${renderer.slice(mobileStart, mobileEnd)}; return _hasPendingImageGeneration;`,
)();

const desktopStart = desktop.indexOf('function isGenerateImagePendingFromEntries(');
const desktopEnd = desktop.indexOf('\n\nfunction renderGeneratedImageLoadingCard', desktopStart);
assert(desktopStart >= 0 && desktopEnd > desktopStart, 'desktop image lifecycle functions must be extractable for behavioral coverage');
const desktopHasPendingImageGeneration = new Function(
  `${desktop.slice(desktopStart, desktopEnd)}; return isGenerateImagePendingFromEntries;`,
)();

for (const alias of ['generate_image', 'image_gen', 'imagegen']) {
  assert.equal(
    mobileHasPendingImageGeneration({ streaming: true, processEntries: [{ type: 'info', text: `${alias} complete` }] }),
    false,
    `mobile ${alias} completion must not remain pending`,
  );
  assert.equal(
    desktopHasPendingImageGeneration([{ type: 'info', text: `${alias} complete` }]),
    false,
    `desktop ${alias} completion must not remain pending`,
  );
}

const noisySearchEntries = [{
  type: 'tool',
  text: 'Searching the web for "H3 Max image generation model"',
  extra: { action: 'web_search', args: { query: 'H3 Max image generation model' } },
}];
assert.equal(mobileHasPendingImageGeneration({ streaming: true, processEntries: noisySearchEntries }), false, 'mobile web-search prose must not trigger image loading');
assert.equal(desktopHasPendingImageGeneration(noisySearchEntries), false, 'desktop web-search prose must not trigger image loading');

for (const alias of ['generate_image', 'image_gen', 'imagegen']) {
  assert.equal(
    mobileHasPendingImageGeneration({
      streaming: true,
      processEntries: [{ type: 'call', activity: { action: alias, args: { presentation_mode: 'background' }, callId: `background-${alias}` } }],
    }),
    false,
    `mobile background ${alias} must stay out of the foreground image loader`,
  );
  assert.equal(
    desktopHasPendingImageGeneration([{ type: 'call', activity: { action: alias, args: { presentation_mode: 'background' }, callId: `background-${alias}` } }]),
    false,
    `desktop background ${alias} must stay out of the foreground image loader`,
  );
  assert.equal(
    mobileHasPendingImageGeneration({
      streaming: true,
      processEntries: [{ type: 'call', activity: { action: alias, args: { presentation_mode: 'foreground' }, callId: `foreground-${alias}` } }],
    }),
    true,
    `mobile foreground ${alias} must show the image loader`,
  );
  assert.equal(
    desktopHasPendingImageGeneration([{ type: 'call', activity: { action: alias, args: { presentation_mode: 'foreground' }, callId: `foreground-${alias}` } }]),
    true,
    `desktop foreground ${alias} must show the image loader`,
  );
}

assert.equal(
  mobileHasPendingImageGeneration({
    streaming: true,
    processEntries: [{ type: 'call', activity: { action: 'generate_image', callId: 'implicit-background' } }],
  }),
  false,
  'mobile image calls without explicit foreground presentation must not show the loader',
);
assert.equal(
  desktopHasPendingImageGeneration([{ type: 'call', activity: { action: 'generate_image', callId: 'implicit-background' } }]),
  false,
  'desktop image calls without explicit foreground presentation must not show the loader',
);

const mobileForegroundAndBackground = {
  streaming: true,
  processEntries: [
    { type: 'call', activity: { action: 'generate_image', args: { presentation_mode: 'background' }, callId: 'asset-image' } },
    { type: 'call', activity: { action: 'generate_image', args: { presentation_mode: 'foreground' }, callId: 'answer-image' } },
  ],
};
assert.equal(mobileHasPendingImageGeneration(mobileForegroundAndBackground), true, 'mobile background work must not suppress a separate foreground image call');
assert.equal(desktopHasPendingImageGeneration(mobileForegroundAndBackground.processEntries), true, 'desktop background work must not suppress a separate foreground image call');

const mobileConcurrent = {
  streaming: true,
  processEntries: [
    { type: 'call', activity: { action: 'generate_image', args: { presentation_mode: 'foreground' }, callId: 'image-a' } },
    { type: 'call', activity: { action: 'image_gen', args: { presentation_mode: 'foreground' }, callId: 'image-b' } },
    { type: 'result', action: 'generate_image', callId: 'image-a', text: 'complete' },
  ],
};
assert.equal(mobileHasPendingImageGeneration(mobileConcurrent), true, 'mobile keyed completion must leave another image call pending');
mobileConcurrent.processEntries.push({ type: 'result', action: 'image_gen', callId: 'image-b', text: 'complete' });
assert.equal(mobileHasPendingImageGeneration(mobileConcurrent), false, 'mobile keyed completions must clear all image calls');

const desktopConcurrent = [
  { type: 'call', activity: { action: 'generate_image', args: { presentation_mode: 'foreground' }, callId: 'image-a' } },
  { type: 'call', activity: { action: 'image_gen', args: { presentation_mode: 'foreground' }, callId: 'image-b' } },
  { type: 'result', action: 'generate_image', callId: 'image-a', text: 'complete' },
];
assert.equal(desktopHasPendingImageGeneration(desktopConcurrent), true, 'desktop keyed completion must leave another image call pending');
desktopConcurrent.push({ type: 'result', action: 'image_gen', callId: 'image-b', text: 'complete' });
assert.equal(desktopHasPendingImageGeneration(desktopConcurrent), false, 'desktop keyed completions must clear all image calls');

console.log('[mobile-voice-image-lifecycle] voice centering, async orb animation, and executable keyed image lifecycle contracts passed');
