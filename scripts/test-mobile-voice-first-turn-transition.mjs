import assert from 'node:assert/strict';
import fs from 'node:fs';

const pages = fs.readFileSync('web-ui/src/mobile/mobile-pages.js', 'utf8');
const voicePage = fs.readFileSync('web-ui/src/mobile/mobile-voice-page.js', 'utf8');

assert.match(
  pages,
  /requestedSession === MOBILE_CHAT_SESSION_ID[\s\S]{0,900}requestedSession = sid;[\s\S]{0,900}_setChatVoiceActive\(true\)/,
  'the mounted chat must recompute draft Voice chrome when the first spoken turn materializes a session',
);
assert.match(voicePage, /context\._ensureDurableMobileVoiceSession\(/, 'Voice first turn must materialize a durable chat session');
assert.doesNotMatch(
  voicePage,
  /pm-mobile-voice-first-turn-materialized/,
  'Voice must use the mounted chat update bridge rather than dispatch an unconsumed custom event',
);
assert.match(
  voicePage,
  /onThought: \(m, meta = \{\}\)[\s\S]{0,420}_handleMobileCleanThought\(chatAiTurn, \{ \.\.\.meta, text \}\)/,
  'Voice thought packets must retain visibility metadata and use the shared safe-progress classifier',
);

console.log('mobile Voice first-turn transition contract passed');
