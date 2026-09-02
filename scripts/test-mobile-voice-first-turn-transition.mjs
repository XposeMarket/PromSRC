import assert from 'node:assert/strict';
import fs from 'node:fs';

const pages = fs.readFileSync('web-ui/src/mobile/mobile-pages.js', 'utf8');
const voicePage = fs.readFileSync('web-ui/src/mobile/mobile-voice-page.js', 'utf8');

assert.match(
  pages,
  /const newChatVoice = !thread\.some\(\(message\) => \['user', 'ai', 'assistant'\]/,
  'Voice must identify a pristine chat by visible turns instead of its transient session id',
);
assert.match(pages, /requestedSession = sid;[\s\S]{0,1200}_setChatVoiceActive\(true\)/, 'the mounted chat must recompute draft Voice chrome when the first spoken turn materializes a session');
assert.match(voicePage, /context\._ensureDurableMobileVoiceSession\(/, 'Voice first turn must materialize a durable chat session');
const mobileCss = fs.readFileSync('web-ui/src/styles/mobile.css', 'utf8');
assert.match(mobileCss, /pm-chat-voice-docked \.pm-composer\.is-voice-active \{ clip-path: none !important; outline: 0 !important; \}/, 'docked inline Voice must not clip a horizontal top-edge seam');
assert.match(
  mobileCss,
  /pm-chat-voice-active \.pm-composer\.is-voice-active,[\s\S]{0,1100}background-color: transparent !important;[\s\S]{0,350}clip-path: none !important;/,
  'inline Voice must stay a transparent positioning layer after the shared glass finish',
);
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
