#!/usr/bin/env node
import assert from 'node:assert/strict';

const { browseHyperframesCatalog, BUNDLED_HYPERFRAMES_CATALOG } = await import('../dist/gateway/creative/hyperframes-catalog.js');

assert.ok(BUNDLED_HYPERFRAMES_CATALOG.length > 0, 'bundled catalog should contain entries');

const ready = browseHyperframesCatalog({ query: 'logo' });
assert.equal(ready.state, 'ready');
assert.equal(ready.available, true);
assert.equal(ready.synced, true);
assert.ok(ready.matchedTotal > 0);

const noMatch = browseHyperframesCatalog({ query: 'definitely-not-a-real-hyperframes-item' });
assert.equal(noMatch.state, 'no_match');
assert.equal(noMatch.catalogTotal, BUNDLED_HYPERFRAMES_CATALOG.length);
assert.equal(noMatch.matchedTotal, 0);

const empty = browseHyperframesCatalog({}, { catalog: [] });
assert.equal(empty.state, 'empty');
assert.equal(empty.catalogTotal, 0);

const unsynced = browseHyperframesCatalog({}, { synced: false });
assert.equal(unsynced.state, 'unsynced');
assert.deepEqual(unsynced.items, []);

const unavailable = browseHyperframesCatalog({}, { available: false });
assert.equal(unavailable.state, 'unavailable');
assert.deepEqual(unavailable.items, []);

console.log('HyperFrames catalog status contract passed.');
