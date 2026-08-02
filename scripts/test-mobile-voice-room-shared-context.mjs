import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mobile = fs.readFileSync(path.join(root, 'web-ui/src/mobile/mobile-pages.js'), 'utf8');
const chatRouter = fs.readFileSync(path.join(root, 'src/gateway/routes/chat.router.ts'), 'utf8');

const state = mobile.slice(
  mobile.indexOf('function _normalizeVoiceRoomState'),
  mobile.indexOf('function _voiceRoomSetFocus'),
);
assert.match(state, /transcript: \[\]/, 'Voice Room state must own a shared transcript');
assert.match(state, /slice\(-48\)/, 'the persisted room transcript must remain bounded');
assert.match(state, /function _voiceRoomRememberTranscript/, 'room turns must have one canonical recorder');
assert.match(state, /function _mobileVoiceRoomContextPayload/, 'the shared transcript must serialize into a context packet');
assert.match(state, /function _mobileVoiceRoomTranscriptBlock/, 'live AVAS sessions must receive a readable room transcript block');

const roomInstructions = mobile.slice(
  mobile.indexOf('function _mobileVoiceRoomCodexInstructions'),
  mobile.indexOf('function _voiceRoomParseQuietCommand'),
);
assert.match(
  roomInstructions,
  /_mobileVoiceRoomTranscriptBlock\(\{ maxEntries: 24, maxChars: 4200 \}\)/,
  'active and warmed room agents must bootstrap with the shared discussion',
);

const handoff = mobile.slice(
  mobile.indexOf('async function _handoffMobileCodexVoiceRoomTarget'),
  mobile.indexOf('async function _routeMobileVoiceRoomTranscript'),
);
assert.match(
  handoff,
  /_mobileVoiceRoomHandoffContextText\(participant, currentTurn\)/,
  'a promoted warm participant must receive the latest transcript before answering',
);
assert.ok(
  handoff.indexOf('_recordMobileVoiceRoomHandoffUserTranscript') < handoff.indexOf('_appendMobileCodexVoiceRoomText'),
  'the visible turn must remain persisted before the shared context is appended',
);

const route = mobile.slice(
  mobile.indexOf('async function _routeMobileVoiceRoomTranscript'),
  mobile.indexOf('function _hasMobileVoiceWarmMic'),
);
assert.match(
  route,
  /_voiceRoomRememberTranscript\('user', 'User', text, participantKey\)/,
  'every accepted room user turn must enter the shared transcript',
);

const eventHandler = mobile.slice(
  mobile.indexOf('async function _handleMobileRealtimeAgentEvent'),
  mobile.indexOf('function _mobileRealtimeAgentEventErrorMessage'),
);
assert.match(
  eventHandler,
  /_voiceRoomRememberTranscript\([\s\S]*?'assistant'[\s\S]*?_voiceRoomParticipantLabel[\s\S]*?transcript/,
  'final room assistant speech must enter the same transcript with its speaker identity',
);

for (const marker of [
  "voiceRoomContext: _mobileVoiceRoomContextPayload()",
  'voiceRoomContext: _mobileVoiceRoomContextPayload(),',
]) {
  assert.ok(mobile.includes(marker), 'mobile bootstrap/context requests must carry Voice Room context');
}

assert.match(chatRouter, /function normalizeVoiceRoomContext/, 'the gateway must validate the client room packet');
assert.match(chatRouter, /voiceRoom: voiceRoom \|\| undefined/, 'worker context packets must expose the shared room context');
assert.match(
  chatRouter,
  /## Shared Voice Room transcript[\s\S]*?resolve references such as "that"/,
  'the realtime prompt must place shared discussion high enough for cross-agent references',
);
assert.match(
  chatRouter,
  /const voiceRoom = normalizeVoiceRoomContext\(body\);[\s\S]*?provided\.voiceRoom = voiceRoom/,
  'a fresh room transcript must replace a reusable packet snapshot',
);

console.log('mobile Voice Room shared-context contract passed');
