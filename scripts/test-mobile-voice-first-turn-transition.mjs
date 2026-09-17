import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMobileChatMessageRenderer } from '../web-ui/src/mobile/mobile-chat-message-renderer.js';

const pages = [
  fs.readFileSync('web-ui/src/mobile/mobile-pages.js', 'utf8'),
  fs.readFileSync('web-ui/src/mobile/mobile-chat-page-runtime.js', 'utf8'),
].join('\n');
const voicePage = fs.readFileSync('web-ui/src/mobile/mobile-voice-page.js', 'utf8');
const realtimeVoice = fs.readFileSync('web-ui/src/mobile/mobile-voice-realtime-runtime.js', 'utf8');
const chatMessageRenderer = fs.readFileSync('web-ui/src/mobile/mobile-chat-message-renderer.js', 'utf8');
const chatRendererRuntime = fs.readFileSync('web-ui/src/mobile/mobile-chat-renderer-runtime.js', 'utf8');

assert.match(
  pages,
  /const newChatVoice = !thread\.some\(\(message\) => \['user', 'ai', 'assistant'\]/,
  'Voice must identify a pristine chat by visible turns instead of its transient session id',
);
assert.match(pages, /requestedSession = sid;[\s\S]{0,1200}_setChatVoiceActive\(true\)/, 'the mounted chat must recompute draft Voice chrome when the first spoken turn materializes a session');
assert.match(voicePage, /context\._ensureDurableMobileVoiceSession\(/, 'Voice first turn must materialize a durable chat session');
assert.match(
  voicePage,
  /if \(inlineMode\) \{[\s\S]{0,500}classList\.add\('pm-chat-voice-focus'\)[\s\S]{0,250}classList\.remove\('pm-chat-voice-docked'\)/,
  'inline Voice must open centered in focus mode before the swipe-down reveal',
);
assert.match(voicePage, /let inlineOrbDocked = false;/, 'inline Voice gesture state must begin centered and undocked');
assert.doesNotMatch(
  voicePage,
  /inlineMode\s*\?\s*'<button[^']+id="pm-voice-orb"/,
  'inline Voice must not render the obsolete empty orb overlay behind the particle orb',
);
assert.match(
  realtimeVoice,
  /\['content', 'output'\][\s\S]{0,260}nested\.forEach\(\(part\) => visit\(part, depth \+ 1\)\)/,
  'realtime Voice must extract assistant transcripts nested in response output content',
);
assert.match(
  realtimeVoice,
  /type === 'response\.content_part\.done'[\s\S]{0,120}type === 'response\.done'/,
  'realtime Voice must finalize visible assistant text from response.done when audio-specific transcript events are absent',
);
assert.match(
  chatMessageRenderer,
  /m\.source === 'voice_agent_realtime' && m\.voiceRealtimeActive === true[\s\S]{0,360}_renderMobileVoiceLyrics\(b\.text, m\.voiceRealtimeProgress, \{ compact: true \}\)/,
  'the extracted chat renderer must show synchronized realtime Voice lyrics while audio is playing',
);
assert.match(
  chatRendererRuntime,
  /_renderMobileUserEditComposer,[\s\S]{0,120}_renderMobileVoiceLyrics,[\s\S]{0,120}_renderMobileVoiceWorkgroup,/,
  'the chat renderer runtime must pass the lyric renderer through its extracted ownership boundary',
);
assert.match(
  pages,
  /"_renderMobileVoiceLyrics": \{ enumerable: true, get: \(\) => _renderMobileVoiceLyrics \}/,
  'the parent mobile runtime must inject its lyric renderer into the extracted Chat owner',
);
const rendererContext = new Proxy({
  ICONS: {},
  __pmChat: { editingMessageIndex: -1, activeSessionId: 'voice-test' },
  _collectMessageMedia: () => [],
  _getPendingApprovalsForSession: () => [],
  _mobileWorkflowTraceEntriesForMessage: () => [],
  _renderMobileVoiceLyrics: (text) => `<voice-lyrics>${text}</voice-lyrics>`,
  chatTimelineRowSignature: () => 'voice-test-row',
  escapeHtml: (value) => String(value ?? ''),
}, {
  get(target, property) {
    return property in target ? target[property] : () => '';
  },
});
const executableRenderer = createMobileChatMessageRenderer(() => rendererContext);
const realtimeVoiceHtml = executableRenderer({
  role: 'ai',
  source: 'voice_agent_realtime',
  voiceRealtimeActive: true,
  voiceRealtimeProgress: 0.4,
  body: { text: 'Streaming voice response' },
}, 0, 'voice-row', 'voice-signature');
assert.match(realtimeVoiceHtml, /<voice-lyrics>Streaming voice response<\/voice-lyrics>/, 'the lazy Chat renderer must execute the realtime lyric path without a ReferenceError');
const mobileCss = [
  fs.readFileSync('web-ui/src/styles/mobile.css', 'utf8'),
  fs.readFileSync('web-ui/src/styles/mobile-shell.css', 'utf8'),
].join('\n');
assert.match(mobileCss, /pm-chat-voice-docked \.pm-composer\.is-voice-active \{ clip-path: none !important; outline: 0 !important; \}/, 'docked inline Voice must not clip a horizontal top-edge seam');
assert.match(
  mobileCss,
  /pm-chat-voice-docked \.pm-body\.pm-chat-body\.pm-chat-voice-occluded[\s\S]{0,420}padding-bottom: calc\(var\(--pm-tabbar-h, 72px\)/,
  'docked inline Voice must let the transcript flow behind the floating orb rather than reserve a legacy panel',
);
assert.match(
  mobileCss,
  /#pm-composer\.is-voice-active \{[\s\S]{0,800}height: 0 !important;[\s\S]{0,800}background: transparent !important;/,
  'the inline Voice composer must remain a zero-height transparent owner even while body state is recovering',
);
assert.match(
  mobileCss,
  /#pm-composer\.is-voice-active #pm-voice-mic\.pm-voice-particle-orb \{[\s\S]{0,900}position: fixed !important;[\s\S]{0,900}visibility: visible !important;/,
  'the real inline particle orb must remain visible independently of transient body state classes',
);
assert.match(
  mobileCss,
  /pm-chat-voice-active \.pm-tabbar \{[\s\S]{0,300}display: grid !important;[\s\S]{0,300}grid-template-columns: repeat\(4, 1fr\) !important;[\s\S]{0,300}pointer-events: auto !important;/,
  'inline Voice must leave the persistent bottom tab bar tappable without changing its grid geometry',
);
assert.match(
  mobileCss,
  /pm-chat-voice-active \.pm-tabbar-haptic-gesture-surface \{[\s\S]{0,220}visibility: visible !important;[\s\S]{0,220}pointer-events: auto !important;/,
  'inline Voice must leave tab sliding enabled',
);
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
