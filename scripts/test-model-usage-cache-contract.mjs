import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/providers/model-usage.ts', 'utf8');
assert.doesNotMatch(source, /_usageReadCacheEvents/, 'gateway must not retain every historical model call object');
assert.doesNotMatch(source, /_usageEventsBySession/, 'gateway must not duplicate lifetime usage into per-session arrays');
assert.match(source, /_usageReadCacheEventCount \+= 1/, 'warmup telemetry should retain only an integer event count');
assert.match(source, /events\.length > CALIBRATION_WINDOW/, 'provider-model calibration working sets must stay bounded');
assert.match(source, /function readHistoricalUsageEvents\(sessionId\?: string\)/, 'full history must remain available as an explicit disk-backed query');
console.log('model usage cache contract regression: ok');
