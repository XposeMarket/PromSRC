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
assert.match(mobileCss, /pm-chat-voice-docked \.pm-composer\.is-voice-active \{ clip-path: inset\(1px 0 0\); outline: 0 !important; \}/, 'docked inline Voice must clip its former top-edge seam');
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
