import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const sourcePages = read('web-ui/src/mobile/mobile-pages.js');
const sourceVoicePage = read('web-ui/src/mobile/mobile-voice-page.js');
const sourceRuntime = read('web-ui/src/mobile/mobile-voice-runtime.js');
const sourceRealtimeRuntime = read('web-ui/src/mobile/mobile-voice-realtime-runtime.js');
const generatedPages = read('generated/public-web-ui/static/mobile/mobile-pages.js');
const generatedVoicePage = read('generated/public-web-ui/static/mobile/mobile-voice-page.js');
const generatedRuntime = read('generated/public-web-ui/static/mobile/mobile-voice-runtime.js');
const generatedRealtimeRuntime = read('generated/public-web-ui/static/mobile/mobile-voice-realtime-runtime.js');
const manifest = JSON.parse(read('generated/public-web-ui/asset-manifest.json'));
const assets = new Map(manifest.assets.map((asset) => [asset.path, asset]));

assert.equal(generatedPages, sourcePages, 'generated mobile-pages.js must mirror source');
assert.equal(generatedVoicePage, sourceVoicePage, 'generated mobile-voice-page.js must mirror source');
assert.equal(generatedRuntime, sourceRuntime, 'generated mobile-voice-runtime.js must mirror source');
assert.equal(generatedRealtimeRuntime, sourceRealtimeRuntime, 'generated mobile-voice-realtime-runtime.js must mirror source');

assert.match(sourcePages, /import\('\.\/mobile-voice-runtime\.js'\)/, 'Chat should lazy-load the Voice runtime');
assert.doesNotMatch(sourcePages, /from ['"]\.\/mobile-voice-runtime\.js['"]/, 'Chat must not statically import the Voice runtime');
assert.doesNotMatch(sourcePages, /MOBILE_REALTIME_HANDOFF_RECOVERY_ENABLED/, 'realtime transport constants must not remain in Chat owner');
assert.doesNotMatch(sourcePages, /function _startMobileOpenAiRealtimeWebSocketSession\s*\(/, 'OpenAI realtime transport must not remain in Chat owner');
assert.doesNotMatch(sourcePages, /function _createMobileXaiPlayback\s*\(/, 'xAI realtime playback must not remain in Chat owner');
assert.doesNotMatch(sourcePages, /const PM_VOICE_SETTINGS_KEY\s*=\s*/, 'Voice configuration must not remain in Chat owner');
assert.match(sourcePages, /"_notifyMobileVoiceAgentConnection": \{ enumerable: true, get: \(\) => _notifyMobileVoiceAgentConnection \}/, 'Voice page context must expose the connection-status bridge');
assert.match(sourcePages, /"_markMobileRealtimeAgentBackendReady": \{ enumerable: true, get: \(\) => _markMobileRealtimeAgentBackendReady \}/, 'Voice page context must expose the backend-ready bridge');
assert.match(sourcePages, /function _voiceRoomParticipantKey\(\.\.\.args\) \{ return _mobileVoiceRuntimeInvoke\('_voiceRoomParticipantKey', args\); \}/, 'Voice Room ownership must be a Voice runtime facade');
assert.doesNotMatch(sourcePages, /function _voiceRoomParticipantKey\(participant\s*=\s*\{\}\)/, 'Voice Room ownership must not remain in Chat owner');
assert.match(sourceVoicePage, /import \{ createMobileVoiceRuntime \} from ['"]\.\/mobile-voice-runtime\.js['"];/, 'Voice page must own runtime creation');
assert.match(sourceVoicePage, /const runtime = createMobileVoiceRuntime\(baseContext\)/, 'Voice page must hydrate the runtime before rendering');
assert.match(sourceRuntime, /const PM_VOICE_SETTINGS_KEY\s*=\s*/, 'Voice runtime entry must contain Voice configuration');
assert.match(sourceRuntime, /from ['"]\.\/mobile-voice-realtime-runtime\.js['"];/, 'Voice runtime entry must statically own the deferred realtime implementation');
assert.match(sourceRealtimeRuntime, /MOBILE_REALTIME_HANDOFF_RECOVERY_ENABLED/, 'Voice realtime runtime must contain realtime transport');
assert.match(sourceRealtimeRuntime, /function _startMobileOpenAiRealtimeWebSocketSession\s*\(/, 'Voice realtime runtime must contain OpenAI realtime transport');

function outputFor(source) {
  const output = manifest.moduleOutputs[source];
  assert(output, `production manifest is missing ${source}`);
  return output;
}

function staticClosure(entryPath) {
  const seen = new Set();
  const queue = [entryPath];
  while (queue.length) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    for (const imported of assets.get(current)?.imports || []) {
      if (imported.kind === 'import-statement') queue.push(imported.path);
    }
  }
  return seen;
}

const chatOutput = outputFor('src/mobile/mobile-pages.js');
const voiceOutput = outputFor('src/mobile/mobile-voice-page.js');
const runtimeOutput = outputFor('src/mobile/mobile-voice-runtime.js');
const chatClosure = staticClosure(chatOutput);
const voiceClosure = staticClosure(voiceOutput);
const runtimeClosure = staticClosure(runtimeOutput);
const realtimeOutputs = (assets.get(runtimeOutput)?.imports || [])
  .filter((entry) => entry.kind === 'import-statement')
  .map((entry) => entry.path);
assert(realtimeOutputs.length, 'Voice runtime entry must import a production realtime implementation chunk');

assert(!chatClosure.has(runtimeOutput), 'Voice runtime entry leaked into the mobile Chat static closure');
assert(realtimeOutputs.every((pathname) => !chatClosure.has(pathname)), 'Voice realtime implementation leaked into the mobile Chat static closure');
assert(realtimeOutputs.every((pathname) => voiceClosure.has(pathname)), 'Voice realtime implementation is missing from the Voice owner closure');
assert(
  [...runtimeClosure].some((pathname) => voiceClosure.has(pathname)),
  'Voice runtime implementation is missing from the Voice owner closure',
);
assert(
  manifest.assets.some((asset) => asset.imports?.some((entry) => entry.kind === 'dynamic-import' && entry.path === runtimeOutput)),
  'production manifest must record the Voice runtime as a dynamic import',
);

const chatRecords = [...chatClosure].map((pathname) => assets.get(pathname)).filter(Boolean);
const voiceRecords = [...voiceClosure].map((pathname) => assets.get(pathname)).filter(Boolean);
const measure = (records) => ({
  rawBytes: records.reduce((total, record) => total + record.bytes, 0),
  gzipBytes: records.reduce((total, record) => total + record.gzipBytes, 0),
  moduleCount: records.length,
});

console.log(JSON.stringify({
  buildId: manifest.buildId,
  mobileChat: measure(chatRecords),
  mobileVoice: measure(voiceRecords),
  runtimeOutput,
  realtimeOutputs,
}, null, 2));
console.log('Mobile Voice runtime ownership contract passed.');
