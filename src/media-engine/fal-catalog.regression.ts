import assert from 'node:assert/strict';
import { estimateCostUsd, getModel } from './catalog.js';
import { falUnitCost } from './fal-catalog.js';

assert.equal(falUnitCost(0.12, 'second', { durationSec: 3, resolution: '480p' }), 0.36);
assert.equal(falUnitCost(0.12, 'video', { durationSec: 10 }), 0.12);
assert.equal(falUnitCost(0.12, 'request', { durationSec: 10 }), 0.12);
assert.equal(falUnitCost(2.5, '1M video tokens', { durationSec: 3, resolution: '480p', aspectRatio: '16:9' }), 2.5 * (480 * 853 * 24 * 3 / 1024) / 1_000_000);
assert.ok((falUnitCost(2.5, '1M video tokens', { durationSec: 3, resolution: '1080p' }) || 0) > (falUnitCost(2.5, '1M video tokens', { durationSec: 3, resolution: '480p' }) || 0));
assert.equal(falUnitCost(3, 'unknown-billing-unit', {}), undefined);
assert.equal(falUnitCost(3, 'image', { durationSec: 3 }), undefined);
const seedance = getModel('fal/seedance-v1-pro-i2v');
assert.ok(seedance);
assert.equal(estimateCostUsd(seedance, { count: 5, durationSec: 3, resolution: '480p' }), 0.45);
assert.ok(estimateCostUsd(seedance, { count: 5, durationSec: 3, resolution: '1080p' }) > 0.45);
console.log('fal catalog unit-pricing regression passed');
