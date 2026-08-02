import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mobile = fs.readFileSync(path.join(root, 'web-ui/src/mobile/mobile-pages.js'), 'utf8');

const healthSource = mobile.slice(
  mobile.indexOf('function _isHealthyMobileVoiceRoomConnection'),
  mobile.indexOf('function _mobileVoiceRoomParkedAudio'),
);
const healthContext = {};
vm.runInNewContext(healthSource, healthContext);
const healthy = {
  transport: 'codex_app_server',
  codexBridgeSessionId: 'bridge-1',
  dc: { readyState: 'open' },
  pc: { connectionState: 'connected' },
};
assert.equal(healthContext._isHealthyMobileVoiceRoomConnection(healthy), true);
assert.equal(healthContext._isHealthyMobileVoiceRoomConnection({ ...healthy, dc: { readyState: 'closed' } }), false);
assert.equal(healthContext._isHealthyMobileVoiceRoomConnection({ ...healthy, pc: { connectionState: 'failed' } }), false);

const poolControl = mobile.slice(
  mobile.indexOf('function _mobileVoiceRoomWarmPool'),
  mobile.indexOf('async function _recordMobileVoiceRoomHandoffUserTranscript'),
);
assert.match(poolControl, /PM_VOICE_ROOM_WARM_MAX - 1/, 'standby pool must be bounded below the total room connection limit');
assert.match(poolControl, /await sender\.replaceTrack\(null\)/, 'parking the active agent must detach its microphone sender');
assert.match(poolControl, /conn\.roomMicClone\.enabled = false/, 'parking a warmed agent must silence its cloned microphone');
assert.match(poolControl, /conn\.audio\.muted = false/, 'promotion must explicitly restore only the selected agent output');
assert.match(poolControl, /_startMobileCodexBridgeRealtimeEventPoll\(conn\)/, 'only promotion may start standby transcript polling');
assert.match(poolControl, /_startMobileRealtimeAgentContextRefreshLoop\(conn\)/, 'promoted agents must resume live context refresh');
assert.match(poolControl, /voice-room-warm-(?:ready|promoted|parked)/, 'warm lifecycle must be observable in mobile logs');

const standby = mobile.slice(
  mobile.indexOf('async function _startMobileCodexVoiceRoomStandbyConnection'),
  mobile.indexOf('async function _startMobileRealtimeAgentSession'),
);
assert.match(standby, /const micTrack = sourceTrack\.clone\(\);[\s\S]*?micTrack\.enabled = false;/, 'standby sessions must share the capture source through a disabled clone');
assert.match(standby, /if \(!conn\?\.roomActive \|\| __pmRealtimeAgent\?\.conn !== conn\) return;/, 'standby data-channel events must be ignored until promotion');
assert.match(standby, /audio\.muted = true/, 'standby audio must remain muted');
assert.match(standby, /contextOnly: true/, 'each standby must still receive its actual agent identity/context');
assert.match(standby, /voiceTarget: target/, 'each standby bootstrap must target the actual selected agent');

const handoff = mobile.slice(
  mobile.indexOf('async function _handoffMobileCodexVoiceRoomTarget'),
  mobile.indexOf('async function _routeMobileVoiceRoomTranscript'),
);
assert.match(handoff, /_parkMobileCodexVoiceRoomConnection\(previous, previousTargetKey\)/, 'handoff must park rather than destroy the previous healthy AVAS connection');
assert.match(handoff, /_mobileVoiceRoomWarmPool\(\)\.get\(targetKey\)/, 'handoff must check the warm target before cold bootstrap');
assert.match(handoff, /_promoteMobileCodexVoiceRoomConnection\(next, participant, listenMode\)/, 'warm handoff must promote the selected agent locally');
assert.match(handoff, /if \(!next\) next = await _startMobileRealtimeAgentSession/, 'cold startup must remain the fallback when no standby is healthy');
assert.match(handoff, /warmPromoted/, 'handoff timing logs must identify warm versus cold switches');

const stop = mobile.slice(
  mobile.indexOf('function _stopMobileRealtimeAgentSession'),
  mobile.indexOf('function _startMobileOpenAiRealtimeWebSocketSession'),
);
assert.match(stop, /_clearMobileCodexVoiceRoomWarmPool\('realtime_session_stopped'\)/, 'leaving/restarting Voice must close every standby AVAS session');

const eventPoll = mobile.slice(
  mobile.indexOf('function _stopMobileCodexBridgeRealtimeEventPoll'),
  mobile.indexOf('async function _handleMobileRealtimeAgentEvent'),
);
assert.match(eventPoll, /conn\.codexBridgeEventAfterId = poll\.afterId/, 'parking must retain the AVAS event cursor');
assert.match(eventPoll, /afterId: Number\(conn\?\.codexBridgeEventAfterId/, 'promotion must resume polling after the prior cursor without replaying old turns');

console.log('mobile Codex Voice Room warm-pool checks passed');
