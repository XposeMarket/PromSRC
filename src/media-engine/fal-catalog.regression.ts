import assert from 'node:assert/strict';
import { estimateCostUsd, getModel } from './catalog.js';
import { falUnitCost } from './fal-catalog.js';

assert.equal(falUnitCost(0.12, 'second', { durationSec: 3, resolution: '480p' }), 0.36);
assert.equal(falUnitCost(0.12, 'video', { durationSec: 10 }), 0.12);
assert.equal(falUnitCost(0.12, 'request', { durationSec: 10 }), 0.12);
assert.equal(falUnitCost(2.5, '1M video tokens', { durationSec: 3, resolution: '480p', aspectRatio: '16:9' }), 2.5 * (480 * 853 * 24 * 3 / 1024) / 1_000_000);
assert.ok((falUnitCost(2.5, '1M video tokens', { durationSec: 3, resolution: '1080p' }) || 0) > (falUnitCost(2.5, '1M video tokens', { durationSec: 3, resolution: '480p' }) || 0));
assert.equal(falUnitCost(0.03, 'seconds', { durationSec: 5 }), 0.15);
assert.equal(falUnitCost(0.03, 'per second', { durationSec: 5 }), 0.15);
assert.equal(falUnitCost(0.25, 'per video', { durationSec: 10 }), 0.25);
assert.equal(falUnitCost(0.04, 'per image', { durationSec: 3 }), 0.04);
assert.equal(falUnitCost(3, 'unknown-billing-unit', {}), undefined);
// Seedance 2.x bills $0.014 per 1000 tokens; fal lists 720p at ~$0.3034/s (1280x720x24/1024 tokens/s).
const sd5 = falUnitCost(0.014, '1000 tokens', { durationSec: 5, resolution: '720p', aspectRatio: '9:16' }) || 0;
assert.ok(Math.abs(sd5 - 1.512) < 0.01, `seedance 2.x 5s 720p should be ~$1.51, got ${sd5}`);
assert.equal(falUnitCost(0.014, '1000 tokens', { durationSec: 5, resolution: '720p', aspectRatio: '9:16' }), falUnitCost(0.014, '1000 tokens', { durationSec: 5, resolution: '720p', aspectRatio: '16:9' }));
assert.equal(falUnitCost(14, '1M tokens', { durationSec: 5, resolution: '720p' }), sd5);
assert.equal(falUnitCost(0.014, '1k tokens', { durationSec: 5, resolution: '720p' }), sd5);
const seedance = getModel('fal/seedance-v1-pro-i2v');
assert.ok(seedance);
// Static (non-live) rate path. Live fal prices from the synced cache (fal-video-catalog.json, #535/#561)
// override the manifest estimate for the real seedance endpoint and vary per machine, so pin an endpoint
// that is never in the live cache to keep this assertion about the static $0.03/s estimate.
assert.equal(estimateCostUsd({ ...seedance, endpoint: 'fal-ai/bytedance/seedance/v1/pro/image-to-video/static-rate-fixture' }, { count: 5, durationSec: 3, resolution: '480p' }), 0.45);
assert.equal(estimateCostUsd({ ...seedance, endpoint: 'fal-ai/minimax/h3-max/text-to-video', pricing: { unit: 'seconds', unitPriceUsd: 0.03, source: 'live' } }, { durationSec: 5, count: 1 }), 0.15);
assert.ok(estimateCostUsd(seedance, { count: 5, durationSec: 3, resolution: '1080p' }) > 0.45);
console.log('fal catalog unit-pricing regression passed');
