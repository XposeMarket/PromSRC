import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');
const require = createRequire(import.meta.url);

const bridge = read('src/gateway/realtime/codex-app-server-bridge.ts');
const router = read('src/gateway/routes/realtime.router.ts');
const chatRouter = read('src/gateway/routes/chat.router.ts');
const chatPage = read('web-ui/src/pages/ChatPage.js');
const generatedChatPage = read('generated/public-web-ui/static/pages/ChatPage.js');
const mobilePages = read('web-ui/src/mobile/mobile-pages.js');
const generatedMobilePages = read('generated/public-web-ui/static/mobile/mobile-pages.js');

assert.match(bridge, /account\?\.type !== 'chatgpt'/, 'bridge must reject non-ChatGPT app-server accounts');
assert.match(bridge, /\['app-server', '--listen', 'stdio:\/\/', '--enable', 'realtime_conversation'\]/, 'bridge must launch the experimental app-server transport');
assert.match(bridge, /this\.request\('thread\/realtime\/start'/, 'bridge must use thread/realtime/start');
assert.doesNotMatch(bridge, /OPENAI_(?:REALTIME_)?API_KEY|openai-oauth|getValidToken|loadTokens/, 'OAuth bridge must not read or exchange API-key/OAuth token material itself');

assert.match(router, /\/api\/realtime\/codex-bridge\/call/, 'gateway must expose the local SDP bridge endpoint');
assert.match(router, /auth: 'chatgpt_oauth_app_server'/, 'bridge responses must identify ChatGPT OAuth app-server auth');
assert.match(chatRouter, /body\.contextOnly === true/, 'voice bootstrap must support credential-free context generation');
assert.match(chatPage, /contextOnly: useCodexOauthBridge/, 'desktop voice must request context-only bootstrap on the OAuth bridge');
assert.match(chatPage, /\/api\/realtime\/codex-bridge\/call/, 'desktop voice must exchange SDP through the local bridge');
assert.match(chatPage, /\/api\/realtime\/codex-bridge\/stop/, 'desktop voice must stop the app-server session');
assert.match(generatedChatPage, /contextOnly: useCodexOauthBridge/, 'generated desktop UI must include context-only OAuth bootstrap');
assert.match(generatedChatPage, /\/api\/realtime\/codex-bridge\/call/, 'generated desktop UI must include the local SDP bridge');
assert.match(mobilePages, /contextOnly: useCodexOauthBridge/, 'mobile voice must request context-only OAuth bootstrap');
assert.match(mobilePages, /\/api\/realtime\/codex-bridge\/call/, 'mobile voice must exchange SDP through the local bridge');
assert.match(generatedMobilePages, /\/api\/realtime\/codex-bridge\/stop/, 'generated mobile UI must stop the app-server session');
assert.match(mobilePages, /function _setMobileVoiceStatus\(/, 'realtime handlers must use a module-level mobile status helper');
assert.match(mobilePages, /_clearMobileRealtimeAgentOutputAudioIfStarted\('quiet_mode'\)/, 'quiet mode must not clear zero-length assistant audio');
assert.match(mobilePages, /function _ensureMobileRealtimeAgentTurnOrder\(/, 'mobile realtime must repair transcript/response ordering races');
assert.match(mobilePages, /_restartMobileRealtimeAgentForSettings\('openai_voice_changed'\)/, 'voice changes must restart OpenAI realtime sessions');
assert.match(mobilePages, /_prewarmMobileCodexRealtimeBridge\(\)/, 'mobile voice must prewarm the Codex bridge');
assert.match(mobilePages, /function _appendMobileRealtimeTranscriptDelta\(/, 'streamed transcript deltas must retain word boundaries');
assert.match(mobilePages, /voiceRealtimeMediaLastTime/, 'lyric timing must use a per-turn media playback clock');
assert.match(mobilePages, /rawDeltaMs < 750/, 'lyric timing must ignore historical WebRTC media-clock jumps');
assert.doesNotMatch(mobilePages, /liveVoiceHtml \|\|/, 'normal mobile chat bubbles must not render realtime karaoke lyrics');
assert.match(chatPage, /function appendRealtimeAgentTranscriptDelta\(/, 'desktop streamed transcripts must retain word boundaries');

const { normalizeRealtimeSdp } = require('../dist/gateway/realtime/codex-app-server-bridge.js');
const normalizedSdp = normalizeRealtimeSdp('v=0\na=test');
assert.equal(normalizedSdp, 'v=0\r\na=test\r\n', 'SDP answers must use CRLF and end with a final CRLF for WebRTC parsers');

console.log('[codex-oauth-realtime-bridge] contract checks passed');
