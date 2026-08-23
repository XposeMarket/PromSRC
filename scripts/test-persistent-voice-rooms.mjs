import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const session = read('src/gateway/session.ts');
const chatRouter = read('src/gateway/routes/chat.router.ts');
const mobileApi = read('web-ui/src/mobile/mobile-api.js');
const mobilePages = read('web-ui/src/mobile/mobile-pages.js');
const mobileRouter = read('web-ui/src/mobile/mobile-router.js');
const mobileShell = read('web-ui/src/mobile/mobile-shell.js');
const desktop = read('web-ui/src/pages/ChatPage.js');
const index = read('web-ui/index.html');

assert.match(session, /interface VoiceRoomMetadata/);
assert.match(session, /voiceRoom\?: VoiceRoomMetadata/);
assert.match(session, /startsWith\('voice_room_'\).*return 'voice_room'/);
assert.match(session, /summary\.messageCount > 0 \|\| !!summary\.pinnedAt \|\| !!summary\.voiceRoom/);

assert.match(chatRouter, /post\('\/api\/voice-rooms\/resolve'/);
assert.match(chatRouter, /createHash\('sha256'\)\.update\(rosterKey\)/);
assert.match(chatRouter, /post\('\/api\/voice-rooms\/:id\/transcript'/);
assert.match(chatRouter, /voiceSpeaker/);

assert.match(mobileApi, /channel: String\(s\?\.channel \|\| 'web'\)/, 'the unified mobile session feed must preserve voice-room channel identity');
assert.match(mobilePages, /_resolveDurableMobileVoiceRoom/);
assert.match(mobilePages, /_loadDurableMobileVoiceRoom/);
assert.match(mobilePages, /appendMobileVoiceRoomTranscript/);
assert.match(mobilePages, /pm-voice-room-agent-settings/);
assert.match(mobilePages, /pm-voice-room-file-input/);
assert.match(mobileRouter, /#mobile\/voice\/\$\{encodeURIComponent\(openSessionId\)\}/);
assert.match(mobileShell, /data-session-channel/);

assert.match(index, /key: 'voice_room', label: 'Voice Rooms'/);
assert.match(desktop, /source === 'voice_room'.*startVoiceAgentRealtimeSession/s);
assert.match(desktop, /\/api\/realtime\/codex-bridge\/append-text/);
assert.match(desktop, /voice-room-speaker/);

console.log('persistent Voice Rooms contract: ok');
