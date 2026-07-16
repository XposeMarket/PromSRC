import assert from 'node:assert/strict';
import { assertMemoryStoreWithinBounds, buildBoundedTokenIndex } from './index.js';

const records: Record<string, any> = {};
for (let i = 0; i < 8001; i += 1) records[`record-${i}`] = { id: `record-${i}` };

assert.throws(
  () => assertMemoryStoreWithinBounds({ records, chunks: {} }),
  /records; safety limit/i,
);
assert.doesNotThrow(() => assertMemoryStoreWithinBounds({
  records: { one: { id: 'one' } as any },
  chunks: { one: { id: 'one', text: 'bounded memory text' } as any },
}));
assert.throws(
  () => assertMemoryStoreWithinBounds({
    records: {},
    chunks: {},
    tokenIndex: { pathological: new Array(500_001).fill('same-chunk') },
  }),
  /token postings exceed/i,
);
assert.throws(
  () => assertMemoryStoreWithinBounds({
    records: {},
    chunks: {},
    relations: new Array(32_001).fill({ id: 'same-relation' }) as any,
  }),
  /relations; safety limit/i,
);

const sharedTermChunks: Record<string, any> = {};
for (let i = 0; i < 500; i += 1) sharedTermChunks[`chunk-${i}`] = { id: `chunk-${i}`, terms: ['shared'] };
const boundedTokenIndex = buildBoundedTokenIndex(sharedTermChunks);
assert.equal(boundedTokenIndex.shared.length, 200, 'individual token posting lists must remain bounded');

console.log('memory bounds regression passed');
