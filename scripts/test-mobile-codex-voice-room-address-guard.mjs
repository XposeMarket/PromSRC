import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mobile = fs.readFileSync(path.join(root, 'web-ui/src/mobile/mobile-pages.js'), 'utf8');

const instructionSource = mobile.slice(
  mobile.indexOf('function _mobileVoiceRoomCodexInstructions'),
  mobile.indexOf('function _voiceRoomParseQuietCommand'),
);
assert.match(instructionSource, /remain completely silent/, 'room agents must be instructed not to acknowledge another participant');
assert.match(instructionSource, /never say "one sec"/, 'the known spoken handoff acknowledgement must be explicitly forbidden');

const standby = mobile.slice(
  mobile.indexOf('async function _startMobileCodexVoiceRoomStandbyConnection'),
  mobile.indexOf('async function _startMobileRealtimeAgentSession'),
);
assert.match(
  standby,
  /instructions: _mobileVoiceRoomCodexInstructions\(bootstrap\.instructions, key\)/,
  'every warmed participant must receive room-aware AVAS instructions',
);

const active = mobile.slice(
  mobile.indexOf('async function _startMobileRealtimeAgentSession'),
  mobile.indexOf('async function _startMobileOpenAiRealtimeWebSocketSession'),
);
assert.match(
  active,
  /instructions: _mobileVoiceRoomCodexInstructions\(bootstrap\.instructions, _voiceRoomCurrentTargetKey\(\)\)/,
  'the active AVAS participant must receive the same room-routing contract',
);

const guardSource = mobile.slice(
  mobile.indexOf('function _armMobileVoiceRoomHandoffAckGuard'),
  mobile.indexOf('function _mobileVoiceRoomWarmPool'),
);
const audio = { muted: false };
const debugEvents = [];
const guardContext = {
  Date,
  __pmRealtimeAgent: {
    conn: { audio },
    turn: {},
    quiet: { active: false },
  },
  _isVoiceRoomEnabled: () => true,
  _isMobileCodexV3RealtimeConnection: () => true,
  _voiceRoomNormalizeText: (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
  _voiceDebug: (event) => debugEvents.push(event),
};
vm.runInNewContext(guardSource, guardContext);
assert.equal(guardContext._armMobileVoiceRoomHandoffAckGuard('One sec'), true);
assert.equal(audio.muted, true, 'a leaked AVAS handoff acknowledgement must be muted immediately');
assert.ok(guardContext.__pmRealtimeAgent.turn.roomHandoffAckGuard, 'the mute must remain guarded until routing resolves');
assert.equal(guardContext._releaseMobileVoiceRoomHandoffAckGuard('same_agent_turn'), true);
assert.equal(audio.muted, false, 'a normal same-agent turn must restore audio');
assert.deepEqual(debugEvents, ['voice-room-handoff-ack-suppressed', 'voice-room-handoff-ack-guard-released']);

const handler = mobile.slice(
  mobile.indexOf('async function _handleMobileRealtimeAgentEvent'),
  mobile.indexOf('function _mobileRealtimeAgentEventErrorMessage'),
);
assert.match(
  handler,
  /_armMobileVoiceRoomHandoffAckGuard\(ackProbe\)[\s\S]*?roomHandoffAckGuard[\s\S]*?return;/,
  'assistant transcript handling must drop the acknowledgement after arming the audio guard',
);
assert.match(
  handler,
  /_releaseMobileVoiceRoomHandoffAckGuard\('same_agent_turn'\)/,
  'same-agent transcript routing must release a false-positive guard',
);
assert.match(
  handler,
  /_releaseMobileVoiceRoomHandoffAckGuard\('response_done'\)/,
  'suppressed responses must not leave the active participant permanently muted',
);

console.log('mobile Codex Voice Room address-guard checks passed');
