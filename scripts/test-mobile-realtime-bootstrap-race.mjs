import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mobile = fs.readFileSync(path.join(root, 'web-ui/src/mobile/mobile-pages.js'), 'utf8');
const voice = fs.readFileSync(path.join(root, 'web-ui/src/mobile/mobile-voice-page.js'), 'utf8');

const errorHelpers = mobile.slice(
  mobile.indexOf('function _mobileRealtimeBootstrapSupersededError'),
  mobile.indexOf('function _applyVoiceSettingsLive'),
);
const helperContext = { Error };
vm.runInNewContext(errorHelpers, helperContext);
const superseded = helperContext._mobileRealtimeBootstrapSupersededError('Realtime agent');
assert.equal(superseded.code, 'MOBILE_REALTIME_BOOTSTRAP_SUPERSEDED');
assert.equal(helperContext._isMobileRealtimeBootstrapSupersededError(superseded), true);
assert.equal(helperContext._isMobileRealtimeBootstrapSupersededError(new Error('Realtime agent bootstrap superseded')), true);
assert.equal(helperContext._isMobileRealtimeBootstrapSupersededError(new Error('SDP exchange failed')), false);

const openAiStart = mobile.slice(
  mobile.indexOf('async function _startMobileRealtimeAgentSession'),
  mobile.indexOf('function _stopMobileRealtimeAgentSession'),
);
assert.match(
  openAiStart,
  /if \(codexBridgeSessionId\)[\s\S]*?codex-bridge\/stop[\s\S]*?const successor = __pmRealtimeAgent\.connecting;[\s\S]*?return await successor;/,
  'a superseded Codex bootstrap must stop its abandoned bridge and join the successor startup',
);
assert.match(
  openAiStart,
  /throw _mobileRealtimeBootstrapSupersededError\('Realtime agent'\)/,
  'a bootstrap stopped without a successor must use the non-fatal cancellation sentinel',
);

const listenStartAt = voice.indexOf('async function _startListening()');
const listenStart = voice.slice(
  listenStartAt,
  voice.indexOf('const mode = String(context.__pmVoice.settings?.voiceMode', listenStartAt),
);
assert.ok(
  listenStart.indexOf('context._isMobileRealtimeBootstrapSupersededError(err)')
    < listenStart.indexOf('context.pmToast(`Realtime agent failed:'),
  'expected supersession must be handled before the fatal Realtime toast',
);

const targetPicker = voice.slice(
  voice.indexOf('const activateTargetButton = async'),
  voice.indexOf('async function _openVoiceTargetPicker'),
);
assert.match(
  targetPicker,
  /const targetChanged = context\._voiceRoomCurrentTargetKey\(\) !== context\._voiceRoomParticipantKey\(participant\);[\s\S]*?restart: targetChanged/,
  'reselecting the active agent must not restart AVAS',
);
assert.match(
  targetPicker,
  /voice_room_enabled[\s\S]*?restart: targetChanged|restart: targetChanged[\s\S]*?voice_room_enabled/,
  'enabling a room around the active target must not force a duplicate bootstrap',
);

console.log('mobile realtime bootstrap race checks passed');
