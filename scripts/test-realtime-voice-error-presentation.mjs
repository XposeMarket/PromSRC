import assert from 'node:assert/strict';

import {
  CODEX_REALTIME_SESSION_MODEL_REJECTED,
  presentRealtimeVoiceError,
  realtimeVoiceErrorFromResponse,
} from '../web-ui/src/voice/realtime-error-presentation.js';

const error = realtimeVoiceErrorFromResponse({
  code: CODEX_REALTIME_SESSION_MODEL_REJECTED,
  error: 'Codex Voice is temporarily unavailable.',
  retryable: false,
}, 502);
const presentation = presentRealtimeVoiceError(error);
assert.equal(error.status, 502);
assert.equal(error.retryable, false);
assert.equal(presentation.code, CODEX_REALTIME_SESSION_MODEL_REJECTED);
assert.equal(presentation.retryable, false);
assert.match(presentation.title, /temporarily unavailable/i);
assert.match(presentation.message, /upstream Codex realtime service/i);
assert.match(presentation.message, /chat is safe/i);

const legacy = presentRealtimeVoiceError(new Error('Field `session.model` is not allowed for this Codex realtime session'));
assert.equal(legacy.code, CODEX_REALTIME_SESSION_MODEL_REJECTED, 'mixed-version gateways need the same presentation');

console.log('realtime Voice error presentation passed');
