import assert from 'node:assert/strict';

process.env.PROMETHEUS_DISABLE_USAGE_AWARENESS_REFRESH = '1';

import {
  addPendingRuntimeSteerForSession,
  clearStartingSessionSteers,
  hasStartingSessionSteers,
} from '../live-runtime-registry';
import {
  clearProviderUsageExhausted,
  isUsageLimitError,
  providerUsageExhaustedReason,
  recordProviderUsageExhausted,
} from '../../providers/usage-awareness';

// Usage-limit errors are recognised and mark the provider exhausted, so
// switch_model will not route a helper tier to it.
assert.equal(isUsageLimitError(new Error('openai_codex API error 429: The usage limit has been reached')), true);
assert.equal(isUsageLimitError(new Error('anthropic API error 500: overloaded')), false);
assert.equal(providerUsageExhaustedReason('provider_regression'), null);
recordProviderUsageExhausted('provider_regression');
assert.match(String(providerUsageExhaustedReason('provider_regression')), /usage limit/);
clearProviderUsageExhausted('provider_regression');
assert.equal(providerUsageExhaustedReason('provider_regression'), null);

// A steer for a run that has not registered its runtime yet is held (not
// rejected) when the caller says a run is starting, and is dropped by interrupt.
const held = addPendingRuntimeSteerForSession('session_starting', {
  message: 'change of plan',
  source: 'peer_session:test',
  kind: 'correction',
  queueIfStarting: true,
} as any);
assert.equal(held.ok, true);
assert.equal(hasStartingSessionSteers('session_starting'), 1);
assert.equal(clearStartingSessionSteers('session_starting'), 1);
assert.equal(hasStartingSessionSteers('session_starting'), 0);

// Without a starting run the steer is still rejected (no silent drops).
const rejected = addPendingRuntimeSteerForSession('session_idle', {
  message: 'nobody home',
  source: 'peer_session:test',
  kind: 'correction',
} as any);
assert.equal(rejected.ok, false);

console.log('thread ops queued-run and usage exhaustion regression passed');
