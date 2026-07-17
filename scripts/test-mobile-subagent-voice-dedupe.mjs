import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = fs.readFileSync(path.join(root, 'web-ui/src/mobile/mobile-api.js'), 'utf8');
const pages = fs.readFileSync(path.join(root, 'web-ui/src/mobile/mobile-pages.js'), 'utf8');

const streamStart = api.indexOf('export function streamSubagentChat');
const streamEnd = api.indexOf('\nfunction _withTimeout', streamStart);
assert.ok(streamStart >= 0 && streamEnd > streamStart, 'streamSubagentChat source must be present');
const stream = api.slice(streamStart, streamEnd);

assert.match(stream, /let streamFinished = false;/, 'subagent streams need a terminal callback guard');
assert.match(stream, /const finishOnce = \(\) => \{[\s\S]*if \(streamFinished\) return;[\s\S]*cb\('onDone'\);[\s\S]*\};/);
assert.equal((stream.match(/cb\('onDone'\)/g) || []).length, 1, 'onDone must only be reachable through finishOnce');
assert.doesNotMatch(stream, /case 'done':[\s\S]{0,180}cb\('onDone'\)/, 'the done frame must not bypass finishOnce');

assert.match(pages, /function _claimSubagentVoiceReplyOnce\(/, 'voice replies need a shared synchronous claim');
assert.match(
  pages,
  /async function _deliverSubagentVoiceReplyOnce[\s\S]*_claimSubagentVoiceReplyOnce[\s\S]*_realtimeAgentDataChannelOpen\(\)[\s\S]*_requestMobileRealtimeAgentFinalSummary[\s\S]*_ttsSpeak/,
  'one claimed delivery must choose realtime summary or TTS exclusively',
);
assert.equal((pages.match(/_deliverSubagentVoiceReplyOnce\(agentId, reply\)/g) || []).length, 1);
assert.equal((pages.match(/_deliverSubagentVoiceReplyOnce\(agent\.id, finalSubagentVoiceReply\)/g) || []).length, 1);

console.log('mobile subagent voice dedupe contract: ok');
