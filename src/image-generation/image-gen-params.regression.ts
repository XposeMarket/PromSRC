import assert from 'node:assert/strict';
import { resolveOpenAIImageSize, resolveOpenAIQualityForModel, supportsArbitraryOpenAIImageSize, normalizeImageQuality, normalizeNativeAspectRatio, normalizeImageModeration, normalizeImageResolution } from './utils.js';

// Native arbitrary sizes on gpt-image-2.x
assert.equal(supportsArbitraryOpenAIImageSize('gpt-image-2.5-flare'), true);
assert.equal(supportsArbitraryOpenAIImageSize('gpt-image-1.5'), false);
assert.equal(resolveOpenAIImageSize('1536x864', 'landscape', true).apiSize, '1536x864');
assert.equal(resolveOpenAIImageSize('1500x850', 'landscape', true).apiSize, '1504x848');
assert.equal(resolveOpenAIImageSize('1536x864', 'landscape', false).apiSize, '1536x1024');
assert.equal(resolveOpenAIImageSize('4000x1000', 'landscape', true).apiSize, '1536x1024'); // ratio > 3:1 falls back
// Quality tiers
assert.equal(normalizeImageQuality('xhigh'), 'xhigh');
assert.equal(normalizeImageQuality('max'), 'max');
assert.equal(resolveOpenAIQualityForModel('max', 'gpt-image-2.5-sunburst'), 'max');
assert.equal(resolveOpenAIQualityForModel('max', 'gpt-image-2'), 'high');
// Moderation / resolution / native ratios
assert.equal(normalizeImageModeration('low'), 'low');
assert.equal(normalizeImageModeration('none'), undefined);
assert.equal(normalizeImageResolution('2K'), '2k');
assert.equal(normalizeNativeAspectRatio('19.5:9'), '19.5:9');
assert.equal(normalizeNativeAspectRatio('auto'), 'auto');
assert.equal(normalizeNativeAspectRatio('landscape'), undefined);
console.log('image-gen-params regression: PASS');
