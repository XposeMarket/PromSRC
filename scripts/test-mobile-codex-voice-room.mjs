import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mobile = fs.readFileSync(path.join(root, 'web-ui/src/mobile/mobile-pages.js'), 'utf8');
const router = fs.readFileSync(path.join(root, 'src/gateway/routes/realtime.router.ts'), 'utf8');
const chatRouter = fs.readFileSync(path.join(root, 'src/gateway/routes/chat.router.ts'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'src/gateway/realtime/codex-app-server-bridge.ts'), 'utf8');

const matcher = mobile.slice(
  mobile.indexOf('function _voiceRoomSpeechWords'),
  mobile.indexOf('function _voiceRoomParseQuietCommand'),
);
assert.match(matcher, /_voiceRoomOnlyLeadingFillers/, 'room matcher must tolerate leading speech fillers');
assert.match(matcher, /greetingAddress = greeting && _voiceRoomOnlyLeadingFillers/, 'greetings after filler words must count as addresses');
assert.match(matcher, /asked = at > 0/, 'explicit ask/tell routing must remain supported');
assert.match(matcher, /function _voiceRoomConversationalAddressPrefix/, 'natural conversational handoffs must be recognized explicitly');
assert.match(matcher, /ambiguous: true/, 'same-strength aliases must report ambiguity instead of guessing');
assert.match(matcher, /I talked to Victor yesterday/, 'matcher must document ordinary-prose protection');
assert.match(matcher, /function _voiceRoomHasUnmatchedAddressCue/, 'room matching must identify an unknown explicit address');

const matcherContext = {
  _normalizeMobileWakePhrase: (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(),
  _voiceRoomNormalizeText: (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(),
  _voiceRoomParticipantKey: (participant = {}) => participant.key || '',
};
vm.runInNewContext(matcher, matcherContext);
const matchAddress = matcherContext._voiceRoomMatchAddress;
const roomParticipants = [
  { key: 'main', label: 'Prometheus', aliases: ['Prometheus', 'Prom'] },
  { key: 'subagent:victor', label: 'Victor', aliases: ['Victor'] },
];
const victorMatch = matchAddress('Uh, hey Victor, status please', roomParticipants);
assert.equal(victorMatch?.participant?.key, 'subagent:victor', 'leading fillers must still route Victor');
assert.equal(victorMatch?.remainder, 'status please');
const prometheusMatch = matchAddress('Alright, hey Prometheus, what changed?', roomParticipants);
assert.equal(prometheusMatch?.participant?.key, 'main', 'leading filler + Prometheus must route main');
const conversationalNolanParticipants = [
  ...roomParticipants,
  { key: 'subagent:nolan', label: 'Nolan', aliases: ['Nolan'] },
];
const howAboutNolan = matchAddress("Alright, how about you Nolan, how's it going?", conversationalNolanParticipants);
assert.equal(howAboutNolan?.participant?.key, 'subagent:nolan', '"how about you Nolan" must switch naturally');
assert.equal(howAboutNolan?.mode, 'conversational');
assert.match(howAboutNolan?.remainder || '', /how about you Nolan/i, 'the addressed agent must receive the conversational context');
assert.equal(matchAddress("I'm doing pretty good. How about you, Victor? How's it going", roomParticipants)?.participant?.key, 'subagent:victor', 'a conversational handoff after an earlier sentence must still switch');
assert.equal(matchAddress('Alright, um, again, Nolan. Hello. Please respond', conversationalNolanParticipants)?.participant?.key, 'subagent:nolan', 'natural filler words before a direct room address must still switch');
assert.equal(matchAddress('What do you think, Victor?', roomParticipants)?.participant?.key, 'subagent:victor', 'trailing-name questions must route');
assert.equal(matchAddress("Let's hear from Victor", roomParticipants)?.participant?.key, 'subagent:victor', 'hear-from phrasing must route');
assert.equal(matchAddress('And you, Prometheus?', roomParticipants)?.participant?.key, 'main', '"and you" handoffs must route');
assert.equal(matchAddress('I talked to Victor yesterday', roomParticipants), null, 'ordinary prose must not switch room agents');
assert.equal(matchAddress('Nolan told Victor about the change', conversationalNolanParticipants)?.participant?.key, 'subagent:nolan', 'an explicit leading address must still route the first named participant');
const ambiguousMatch = matchAddress('Hey Nolan, status?', [
  { key: 'subagent:nolan-a', label: 'Nolan A', aliases: ['Nolan'] },
  { key: 'subagent:nolan-b', label: 'Nolan B', aliases: ['Nolan'] },
]);
assert.equal(ambiguousMatch?.ambiguous, true, 'duplicate aliases must remain ambiguous');

const refresh = mobile.slice(
  mobile.indexOf('async function _refreshMobileRealtimeAgentRoomTarget'),
  mobile.indexOf('function _sendMobileRealtimeRoomTextToTarget'),
);
const publicSend = mobile.slice(
  mobile.indexOf('function _sendMobileRealtimeRoomTextToTarget'),
  mobile.indexOf('function _voiceRoomAddressOnlyHandoffText'),
);
assert.match(refresh, /_isMobileCodexV3RealtimeConnection\(conn\)[\s\S]*?return false;/, 'Codex room refresh must refuse public session.update');
assert.match(publicSend, /_isMobileCodexV3RealtimeConnection\(conn\)[\s\S]*?return false;/, 'Codex room send must refuse public conversation/response commands');

const handoff = mobile.slice(
  mobile.indexOf('function _voiceRoomAddressOnlyHandoffText'),
  mobile.indexOf('async function _routeMobileVoiceRoomTranscript'),
);
assert.match(handoff, /_parkMobileCodexVoiceRoomConnection\(previous, previousTargetKey\)/, 'Codex handoff must silence and park the superseded AVAS peer');
assert.match(handoff, /previous\.roomActive = false[\s\S]*?__pmRealtimeAgent\.conn = null/, 'the superseded AVAS peer must be removed from active input before switching');
assert.ok(
  handoff.indexOf('await _promoteMobileCodexVoiceRoomConnection') < handoff.lastIndexOf('_parkMobileCodexVoiceRoomConnection(previous, previousTargetKey)'),
  'a warm target must be promoted before the old peer is parked',
);
assert.match(handoff, /await _startMobileRealtimeAgentSession\?\.\(sid, \{ listenMode \}\)/, 'Codex handoff must start the addressed agent session');
assert.match(handoff, /next\.transport !== 'codex_app_server'[\s\S]*?next\.dc\?\.readyState !== 'open'/, 'handoff must wait for a confirmed new AVAS data channel');
assert.match(handoff, /roomHandoffInjectedId === handoffId/, 'handoff text must be injected exactly once');
assert.match(handoff, /VOICE_ROOM_CONTROL/, 'address-only handoff must use a control acknowledgement, not a fake name turn');
assert.match(handoff, /_silenceMobileVoiceRoomOutput[\s\S]*?if \(_isMobileCodexV3RealtimeConnection\(conn\)\)[\s\S]*?audio\.muted = true/, 'Codex handoff must mute instead of sending blocked cancel commands');
assert.ok(handoff.indexOf('await _recordMobileVoiceRoomHandoffUserTranscript') < handoff.indexOf('await _appendMobileCodexVoiceRoomText'), 'the complete visible user turn must be recorded before AVAS receives injected text');
assert.match(handoff, /\{ handoffId, injectedText: text \}/, 'address-only handoff must mark the actual control payload as an echo to consume');

const recordSource = mobile.slice(
  mobile.indexOf('async function _recordMobileVoiceRoomHandoffUserTranscript'),
  mobile.indexOf('async function _handoffMobileCodexVoiceRoomTarget'),
);
const persisted = [];
const finalized = [];
const recordContext = {
  Date,
  __pmRealtimeAgent: { turn: {} },
  _normalizeVoiceEchoText: (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(),
  _voiceRoomParticipantKey: (participant = {}) => participant.key || '',
  _voiceRoomCurrentTargetKey: () => recordContext.currentTarget?.kind === 'subagent' ? `subagent:${recordContext.currentTarget.agentId}` : 'main',
  _clearMobileRealtimeAgentQueuedFinalSummary: () => {},
  _ensureMobileRealtimeExchangeId: () => {},
  _voiceShowRealtimeUserTranscript: () => {},
  _voiceDebug: () => {},
  _currentMobileSubagentVoiceTarget: () => recordContext.currentTarget,
  _persistRealtimeSubagentUserTranscript: async (_target, text) => persisted.push(text),
  _finalizeMobileRealtimeAgentChatTurn: (_sid, _role, text) => finalized.push(text),
  _ensureMobileRealtimeAgentTurnOrder: () => {},
  _persistMobileThreadSnapshot: () => {},
  _renderRecent: () => {},
  _renderMobileChatSessionNow: () => {},
  _notifyMobileChatVoiceUpdate: () => {},
  _consumeMobileRealtimeAgentPendingFiles: () => 0,
};
vm.runInNewContext(recordSource, recordContext);
const recordTurn = recordContext._recordMobileVoiceRoomHandoffUserTranscript;
const consumeEcho = recordContext._consumeMobileVoiceRoomHandoffEcho;
const originalVictorTurn = 'Uh hey Victor status please';
recordContext.currentTarget = { kind: 'subagent', agentId: 'victor' };
await recordTurn(originalVictorTurn, { key: 'subagent:victor' }, 'subagent_chat_victor', { handoffId: 'handoff-victor', injectedText: 'status please' });
await recordTurn(originalVictorTurn, { key: 'subagent:victor' }, 'subagent_chat_victor', { handoffId: 'handoff-victor', injectedText: 'status please' });
assert.deepEqual(persisted, [originalVictorTurn], 'changed-target subagent handoff must persist the original full user turn exactly once');
assert.equal(recordContext.__pmRealtimeAgent.turn.lastUserTranscript, originalVictorTurn, 'assistant reply pairing must use the original visible turn, not the routed remainder');
assert.equal(consumeEcho('status please', 'subagent_chat_victor'), true, 'the injected routed remainder echo must be consumed once');
assert.equal(consumeEcho('status please', 'subagent_chat_victor'), false, 'a consumed routed echo must not suppress later real speech');
recordContext.currentTarget = { kind: 'subagent', agentId: 'nolan' };
await recordTurn(originalVictorTurn, { key: 'subagent:nolan' }, 'subagent_chat_nolan', { handoffId: 'fallback-nolan', injectedText: originalVictorTurn });
assert.deepEqual(persisted, [originalVictorTurn, originalVictorTurn], 'a tool-fallback handoff must still give the newly selected subagent its full user turn even when the room transcript already captured it');
recordContext.currentTarget = null;
const finalizedBeforeFallback = finalized.length;
await recordTurn(originalVictorTurn, { key: 'main' }, 'mobile_new_room', { handoffId: 'fallback-main', injectedText: originalVictorTurn });
assert.equal(finalized.length, finalizedBeforeFallback, 'a tool-fallback handoff must not duplicate an already visible main-chat user turn');
const addressOnlyControl = '[VOICE_ROOM_CONTROL] You are now the active participant.';
recordContext.currentTarget = { kind: 'subagent', agentId: 'victor' };
await recordTurn('Hey Victor', { key: 'subagent:victor' }, 'subagent_chat_victor', { handoffId: 'handoff-victor-address', injectedText: addressOnlyControl });
assert.equal(consumeEcho(addressOnlyControl, 'subagent_chat_victor'), true, 'address-only control echo must be consumed before it can render as a second user turn');
assert.equal(consumeEcho(addressOnlyControl, 'subagent_chat_victor'), false, 'address-only control echo must be consumed exactly once');
recordContext.currentTarget = null;
const originalMainTurn = 'Alright hey Prometheus show me the status';
await recordTurn(originalMainTurn, { key: 'main' }, 'mobile_new_room', { handoffId: 'handoff-main', injectedText: 'show me the status' });
assert.deepEqual(finalized, [originalMainTurn], 'switching back to Prometheus must create the main-chat user turn before the injected reply');

const route = mobile.slice(
  mobile.indexOf('async function _routeMobileVoiceRoomTranscript'),
  mobile.indexOf('function _hasMobileVoiceWarmMic'),
);
assert.match(route, /match\?\.ambiguous[\s\S]*?handled: true, suppressed: true, ambiguous: true/, 'ambiguous room addresses must not route');
assert.match(route, /!match && _voiceRoomHasUnmatchedAddressCue\(text\)[\s\S]*?handled: true, suppressed: true, unknown: true/, 'unknown explicit room addresses must not fall through to sticky focus');
assert.match(route, /_isMobileCodexV3RealtimeConnection\(\)[\s\S]*?_handoffMobileCodexVoiceRoomTarget/, 'only a changed Codex room target may reconnect via handoff');
assert.match(route, /return \{ handled: false, participant, text: routedText, targetChanged \};/, 'same-target follow-ups must remain native and avoid reconnecting');

assert.match(router, /\/api\/realtime\/codex-bridge\/append-text[\s\S]*?appendRealtimeText\(sessionId, text\)/, 'gateway must expose AVAS-native append-text handoff endpoint');
assert.match(bridge, /async appendRealtimeText\(sessionId: string, text: string\)/, 'bridge must append text to one explicit live AVAS session');
assert.match(chatRouter, /name: 'voice_room_handoff'/, 'room bootstrap must expose an explicit tool fallback for missed host handoffs');
assert.match(chatRouter, /buildRealtimeVoiceAgentTools\(voiceTarget, contextPacket\.voiceRoom \|\| null\)/, 'room bootstrap must give the dynamic handoff tool its participant roster');
assert.match(chatRouter, /call voice_room_handoff immediately with that participant/, 'room participants must be told to use the fallback instead of narrating a missed switch');
assert.match(mobile, /async function _executeMobileVoiceRoomHandoffTool/, 'mobile must execute Voice Room fallback handoff calls');
assert.match(mobile, /if \(name === 'voice_room_handoff'\)[\s\S]*?_executeMobileVoiceRoomHandoffTool/, 'mobile tool dispatch must route fallback handoff calls before normal voice tools');
assert.match(mobile, /voiceRoomTranscript = false/, 'mobile chat must support a Voice Room transcript-only surface');
assert.match(mobile, /pm-voice-room-transcript-composer/, 'Voice Room transcript mode must hide the regular composer');
assert.match(mobile, /pm-voice-room-return/, 'Voice Room transcript mode must provide a route back to the live room');
assert.match(mobile, /Switched to: \$\{label\}/, 'successful room handoffs must visibly name the active agent');
assert.match(mobile, /Room active/, 'reopening the orb must show that the persistent room is active');
assert.match(mobile, /_exitMobileVoiceRoomForFreshChat\('ordinary_chat_voice_open'\)/, 'ordinary chat voice must explicitly leave a stale Voice Room');
assert.match(mobile, /_stageMobileRealtimeAgentAttachmentPreview/, 'Voice-page attachments must get a visible staged preview');

console.log('mobile Codex Voice Room handoff checks passed');
