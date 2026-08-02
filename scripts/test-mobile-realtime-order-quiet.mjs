import assert from 'node:assert/strict';
import fs from 'node:fs';

const mobile = fs.readFileSync('web-ui/src/mobile/mobile-pages.js', 'utf8');

assert.match(mobile, /workflowGroupId: exchangeId,[\s\S]{0,100}workflowPart: 'voice_user'/, 'voice user turns must carry an exchange identity');
assert.match(mobile, /workflowGroupId: exchangeId,[\s\S]{0,100}workflowPart: 'voice_assistant'/, 'voice assistant turns must carry the same exchange identity');
assert.match(mobile, /function _repairMobileRealtimeExchangeOrder\(/, 'mobile must repair delayed user/assistant transcript ordering');
assert.match(mobile, /_dedupeMobileAssistantTurns\(list\);\s*_repairMobileRealtimeExchangeOrder\(list\);/, 'history reconciliation must repair voice order after dedupe');
assert.match(mobile, /const _mobileThreadSnapshotWriteQueues = new Map\(\)/, 'voice history snapshots must be serialized per mobile session');

assert.match(mobile, /realtime-agent-quiet-tool-call-suppressed/, 'quiet mode must suppress tool execution');
assert.match(mobile, /if \(!__pmRealtimeAgent\.quiet\.active\) \{\s*_voiceShowRealtimeUserTranscript/, 'quiet mode must hide rolling user transcripts');
assert.match(mobile, /quietAudio\.muted = true;\s*quietAudio\.volume = 0;/, 'Codex Voice quiet mode must hard-mute WebRTC output');
assert.match(mobile, /AVAS v3 owns VAD and has no public create_response gate/, 'Codex Voice quiet mode must document its native VAD boundary');
assert.match(mobile, /if \(dc\?\.readyState === 'open' && !_isMobileCodexV3RealtimeConnection\(\)\)/, 'waking Codex Voice must not send unsupported public response.create commands');
assert.match(mobile, /Quiet mode intentionally listens across many independent utterances/, 'each quiet utterance must remain eligible for wake detection');

console.log('mobile realtime ordering and quiet-mode contract passed');
