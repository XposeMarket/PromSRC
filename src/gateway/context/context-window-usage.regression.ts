import assert from 'node:assert/strict';
import { deriveContextWindowUsage } from './context-window-usage';

const normal = deriveContextWindowUsage(68_000, 272_000);
assert.deepEqual(
  { status: normal.status, percent: normal.percent, progressPercent: normal.progressPercent, overflowTokens: normal.overflowTokens },
  { status: 'normal', percent: 25, progressPercent: 25, overflowTokens: 0 },
);

const full = deriveContextWindowUsage(272_000, 272_000);
assert.deepEqual(
  { status: full.status, percent: full.percent, progressPercent: full.progressPercent, overflowTokens: full.overflowTokens },
  { status: 'full', percent: 100, progressPercent: 100, overflowTokens: 0 },
);

const overflow = deriveContextWindowUsage(425_000, 272_000);
assert.deepEqual(
  { status: overflow.status, percent: overflow.percent, progressPercent: overflow.progressPercent, overflowTokens: overflow.overflowTokens },
  { status: 'over_capacity', percent: 156.25, progressPercent: 100, overflowTokens: 153_000 },
);

const unavailable = deriveContextWindowUsage(10_000, 0);
assert.equal(unavailable.status, 'unavailable');
assert.equal(unavailable.percent, 0);

console.log('context-window-usage regression: ok');
