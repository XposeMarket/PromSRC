import assert from 'node:assert/strict';
import { geocodeQueryCandidates } from './weather';

assert.deepEqual(geocodeQueryCandidates('Frederick, MD'), ['Frederick, Maryland', 'Frederick, MD', 'Frederick']);
assert.deepEqual(geocodeQueryCandidates('Frederick, md'), ['Frederick, Maryland', 'Frederick, md', 'Frederick']);
assert.deepEqual(geocodeQueryCandidates('Frederick, Maryland, US'), ['Frederick, Maryland, US', 'Frederick']);
assert.deepEqual(geocodeQueryCandidates('Paris'), ['Paris']);
assert.deepEqual(geocodeQueryCandidates('  '), []);
assert.deepEqual(geocodeQueryCandidates('Washington, DC'), ['Washington, District of Columbia', 'Washington, DC', 'Washington']);

console.log('weather-geocode regression: OK');
