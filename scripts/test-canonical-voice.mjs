import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parse } = require('acorn');
const desktop = fs.readFileSync('web-ui/src/pages/ChatPage.js', 'utf8');
const mobile = fs.readFileSync('web-ui/src/mobile/mobile-voice-page.js', 'utf8');
const api = fs.readFileSync('web-ui/src/mobile/mobile-api.js', 'utf8');
function fn(source, name) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  let found;
  function visit(n) {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'FunctionDeclaration' && n.id?.name === name) found = source.slice(n.start, n.end);
    for (const value of Object.values(n)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(ast);
  assert.ok(found, name);
  return found;
}
const calls = [];
const box = vm.createContext({
  DESKTOP_VOICE_MODES: new Set(['canonical', 'xai', 'openai_realtime']),
  DESKTOP_VOICE_SETTINGS_KEY: 'voice', localStorage: { getItem: () => JSON.stringify({ voiceMode: 'openai_realtime', sttProvider: 'xai', ttsProvider: 'xai', serverVoice: 'eve' }) },
  getStoredVoiceSetting: (_k, fallback) => fallback,
  desktopVoiceSettings: { voiceMode: 'canonical', sttProvider: 'xai' },
  voiceDictationEnabled: true, canonicalVoiceEpoch: 1, backendVoiceMimeType: 'audio/webm', audioExtensionForMimeType: () => 'webm',
  window: { activeChatSessionId: 'thread-a' }, navigator: { language: 'en-US' },
  blobToBase64: async () => 'audio', appendDictationText: t => calls.push(['text', t]),
  sendChat: async () => calls.push(['canonical-submit']), showDesktopVoiceStatus: () => {},
  fetch: async (url, init) => { calls.push([url, JSON.parse(init.body)]); return { ok: true, json: async () => ({ text: 'use my tools' }) }; },
});
vm.runInContext([fn(desktop, 'normalizeDesktopVoiceMode'), fn(desktop, 'loadDesktopVoiceSettings'), fn(desktop, 'transcribeBackendRecording'), fn(desktop, 'applyDesktopVoiceProviderDefaults')].join('\n'), box);
const settings = box.loadDesktopVoiceSettings();
assert.equal(settings.voiceMode, 'canonical');
assert.equal(settings.sttProvider, 'xai'); assert.equal(settings.ttsProvider, 'xai');
assert.equal(box.applyDesktopVoiceProviderDefaults(), false);
await box.transcribeBackendRecording({});
assert.equal(calls[0][0], '/api/voice/transcribe'); assert.equal(calls[0][1].provider, 'xai');
assert.deepEqual(calls.slice(1), [['text', 'use my tools'], ['canonical-submit']]);
// A response arriving after thread navigation must not submit to another chat.
calls.length = 0;
box.fetch = async () => { box.window.activeChatSessionId = 'thread-b'; return { ok: true, json: async () => ({ text: 'stale' }) }; };
await box.transcribeBackendRecording({}); assert.equal(calls.length, 0);
// Repeated browser finals are one turn; navigating or changing epoch drops stale events.
const browserCalls = [];
class Recognition { start() {} stop() {} }
Object.assign(box, { getSpeechRecognitionCtor: () => Recognition, document: { getElementById: () => ({ value: '' }) }, voiceRecognition: null, stopRealtimeVoicePlayback() {}, setVoiceDictationState() {}, writeDictationTranscript() {}, handleVoiceWakeGateTranscript: text => ({ text }), getRealtimeWakeGate: () => null, voiceDictationBaseText: '', voiceDictationFinalText: '', sendChat: async () => browserCalls.push('submit') });
vm.runInContext(fn(desktop, 'toggleBrowserDictation'), box);
box.toggleBrowserDictation();
const recognizer = box.voiceRecognition;
const finalEvent = { resultIndex: 0, results: [Object.assign([{ transcript: 'one turn' }], { isFinal: true })] };
recognizer.onresult(finalEvent); recognizer.onresult(finalEvent);
assert.equal(browserCalls.length, 1);
box.voiceRecognition = null; box.toggleBrowserDictation();
box.window.activeChatSessionId = 'other-thread'; box.voiceRecognition.onresult(finalEvent);
assert.equal(browserCalls.length, 1);
// The actual public voice-toggle function starts on click one and stops on click two.
const toggleCalls = [];
Object.assign(box, { backendVoiceRecorder: null, voiceRecognition: null, voiceRepliesEnabled: false, voiceTtsProvider: 'browser', setRegularVoiceControlsVisible() {}, toggleBackendDictation: async () => toggleCalls.push('backend'), window: { activeChatSessionId: 'thread-a', SpeechRecognition: Recognition, speechSynthesis: { cancel: () => toggleCalls.push('playback-stop') }, stopGeneration: () => toggleCalls.push('cancel-chat') } });
box.desktopVoiceSettings = { voiceMode: 'canonical', sttProvider: 'browser', ttsProvider: 'xai' };
box.toggleBrowserDictation = () => { toggleCalls.push('start'); box.voiceRecognition = { stop: () => { toggleCalls.push('stop'); box.voiceRecognition = null; } }; };
vm.runInContext(fn(desktop, 'toggleRealtimeVoiceReplies'), box);
await box.toggleRealtimeVoiceReplies(); await box.toggleRealtimeVoiceReplies();
assert.deepEqual(toggleCalls, ['playback-stop', 'cancel-chat', 'start', 'playback-stop', 'stop']);
assert.equal(box.voiceTtsProvider, 'xai');



// Execute the production mobile microphone routing with browser absent.
const routed = [];
const m = vm.createContext({
  window: {}, context: { __pmVoice: { listening: false, settings: { voiceMode: 'canonical', sttProvider: 'xai' }, activeVoiceRuntime: { isStreamActive: true, sessionId: 'thread-a', abort: () => routed.push('abort') } }, _voiceDebug() {}, _captureVoicePlaybackInterrupt() {}, _ttsStop() {}, stopMobileMainChat: async sid => routed.push(['cancel', sid]) },
  _isActiveVoiceRender: () => true, recognitionSubmitTimer: null,
  _startBackendListening: async provider => routed.push(['stt', provider]),
});
vm.runInContext(fn(mobile, '_startListening'), m);
await m._startListening();
assert.deepEqual(routed, ['abort', ['cancel', 'thread-a'], ['stt', 'xai']]);
m.context.__pmVoice.activeVoiceRuntime = null; m.context.__pmVoice.settings.sttProvider = 'browser';
await m._startListening(); assert.deepEqual(routed.at(-1), ['stt', 'auto']);

// Exercise actual mobile /api/chat serialization and SSE callbacks, not grep.
const events = []; let request; let signal;
const sse = [{ type: 'token', text: 'Hello' }, { type: 'approval_required', approval: { id: 'a1' } }, { type: 'tool_call', name: 'memory' }, { type: 'final', text: 'Done' }].map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
const streamBox = vm.createContext({
  AbortController, TextDecoder, Error, console, MOBILE_CHAT_SESSION_ID: 'default',
  _buildUrl: p => p, _mobileRequestToken: () => 'paired', _assertMobileRequestTarget() {},
  presentChatError: x => x,
  fetch: async (url, init) => { request = { url, body: JSON.parse(init.body) }; signal = init.signal; return { ok: true, body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }) }; },
});
vm.runInContext(fn(api, 'streamChat'), streamBox);
await new Promise((resolve, reject) => {
  streamBox.streamChat({ message: 'voice text', sessionId: 'thread-a', clientRequestId: 'voice-1', attachments: [{ path: 'image.png' }], callerContext: '', selectedSkillIds: ['skill-a'] }, {
    onToken: t => events.push(['token', t]), onEvent: e => events.push([e.type]), onToolCall: e => events.push(['tool', e.name]), onFinal: t => events.push(['final', t]), onError: reject, onDone: resolve,
  });
});
assert.equal(request.url, '/api/chat'); assert.equal(request.body.sessionId, 'thread-a');
assert.equal(request.body.clientRequestId, 'voice-1'); assert.equal(request.body.attachments[0].path, 'image.png');
assert.equal(request.body.callerContext, undefined); assert.equal(request.body.selectedSkillIds[0], 'skill-a');
assert.ok(events.some(e => e[0] === 'approval_required')); assert.ok(events.some(e => e[0] === 'tool'));
assert.ok(events.some(e => e[0] === 'final' && e[1] === 'Done'));
const handle = streamBox.streamChat({ message: 'cancel', sessionId: 'thread-a' }, {}); handle.abort();
assert.equal(signal.aborted, true);
console.log('PASS canonical voice: desktop STT -> normal submit, provider preservation, stale-thread suppression; mobile provider fallback/barge-in; actual /api/chat SSE attachments/request IDs/skills/approval event/final/cancellation');
// Execute the production backend synthesis helper with a mocked audio provider.
const ts = require('typescript');
const voiceServer = fs.readFileSync('src/gateway/routes/voice.router.ts', 'utf8');
const serverJs = ts.transpileModule(voiceServer, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const audioRequests = [];
const backend = vm.createContext({ Buffer, openAiAudioKey: async () => 'fixture-key', getXaiAuthCandidates: async () => [{ token: 'fixture-xai' }], xaiBaseUrl: () => 'https://fixture.xai/v1', isXaiCredentialFailure: () => false, fetch: async (url, init) => { audioRequests.push({ url, body: JSON.parse(init.body) }); return { ok: true, headers: { get: () => 'audio/mpeg' }, arrayBuffer: async () => Buffer.from('audio') }; } });
vm.runInContext(fn(serverJs, 'synthesizeCanonicalSpeech'), backend);
const synthesized = await backend.synthesizeCanonicalSpeech({ provider: 'openai', text: 'Canonical answer', voice: 'alloy' });
assert.equal(synthesized.audioBase64, Buffer.from('audio').toString('base64'));
assert.equal(audioRequests[0].body.input, 'Canonical answer');
assert.equal(audioRequests[0].body.messages, undefined);
await backend.synthesizeCanonicalSpeech({ provider: 'xai', text: 'Same answer', voiceId: 'eve' });
assert.equal(audioRequests[1].body.voice_id, 'eve');
await assert.rejects(() => backend.synthesizeCanonicalSpeech({ provider: 'legacy', text: 'no' }), /Unsupported/);
console.log('PASS backend audio: OpenAI/xAI synthesize returned chat text only; unsupported provider rejected');

