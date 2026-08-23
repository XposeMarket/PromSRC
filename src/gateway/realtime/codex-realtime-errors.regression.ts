import assert from 'node:assert/strict';

import {
  CODEX_REALTIME_SESSION_MODEL_REJECTED,
  classifyCodexRealtimeStartError,
} from './codex-realtime-errors.js';

const rejected = classifyCodexRealtimeStartError(new Error(
  'failed to start realtime conversation: {"detail":"Field `session.model` is not allowed for this Codex realtime session"}',
));
assert.equal(rejected.code, CODEX_REALTIME_SESSION_MODEL_REJECTED);
assert.equal(rejected.retryable, false);
assert.equal(rejected.upstream, true);
assert.match(rejected.error, /temporarily unavailable/i);
assert.match(rejected.technicalDetails || '', /session\.model/);

const generic = classifyCodexRealtimeStartError(new Error('app-server closed'));
assert.equal(generic.code, 'codex_realtime_start_failed');
assert.equal(generic.retryable, true);

console.log('Codex realtime error classification regression passed');
