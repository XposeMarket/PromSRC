import assert from 'node:assert/strict';
import { buildContextWindowPressure } from './context-window-pressure';
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

// Reproduce the regression behind the UI screenshot: a bounded 20-message
// model-call slice can be about 38k while the full active transcript has
// already crossed the session compaction gate for a 272k model.
const message = { content: 'x'.repeat(6_696) }; // ~1,920 session-estimator tokens.
const longHistory = Array.from({ length: 100 }, () => message);
const pressure = buildContextWindowPressure({
  history: longHistory,
  calibrationFactor: 1,
  contextWindowTokens: 272_000,
  compactionThreshold: 0.7,
});
const visibleTwentyMessageSlice = buildContextWindowPressure({
  history: longHistory.slice(-20),
  calibrationFactor: 1,
  contextWindowTokens: 272_000,
  compactionThreshold: 0.7,
});

assert.ok(
  visibleTwentyMessageSlice.pressureTokens >= 38_000 && visibleTwentyMessageSlice.pressureTokens <= 39_000,
  `expected the old bounded UI slice to look like ~38k, got ${visibleTwentyMessageSlice.pressureTokens}`,
);
assert.ok(
  pressure.pressureTokens >= pressure.compactionTriggerTokens,
  `full active pressure ${pressure.pressureTokens} must cross the ${pressure.compactionTriggerTokens} compaction gate`,
);
assert.ok(
  pressure.pressureTokens >= visibleTwentyMessageSlice.pressureTokens * 4.9,
  'the compaction-pressure meter must not collapse to the legacy 20-message slice',
);
assert.equal(pressure.contextWindowTokens, 272_000);
assert.equal(pressure.atOrPastCompactionTrigger, true);

console.log('context-window-usage regression: ok');
