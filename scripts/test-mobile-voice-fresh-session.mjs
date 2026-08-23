import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pages = fs.readFileSync(path.join(root, 'web-ui/src/mobile/mobile-pages.js'), 'utf8');
const voiceOwner = fs.readFileSync(path.join(root, 'web-ui/src/mobile/mobile-voice-page.js'), 'utf8');
const router = fs.readFileSync(path.join(root, 'web-ui/src/mobile/mobile-router.js'), 'utf8');

// The extracted owner receives former closure bindings through a live context.
// Normalize that mechanical prefix so this legacy semantic contract continues
// to inspect the Voice behavior rather than its module location.
const voicePage = voiceOwner.replace(/\bcontext\./g, '');
const renderStart = voicePage.indexOf('export async function renderVoicePage');
assert.ok(renderStart >= 0, 'standalone Voice page renderer must exist');

assert.match(
  voicePage,
  /if \(!inlineMode\) \{[\s\S]*?_startMobileNewVoiceDraft\(\);/,
  'entering standalone Voice must begin with an isolated mobile draft',
);
assert.match(
  pages,
  /function _startMobileNewVoiceDraft\(\)[\s\S]*?__pmVoice\.target = \{ kind: 'main' \};[\s\S]*?const room = _normalizeVoiceRoomState\(__pmVoice\?\.room \|\| _loadVoiceRoomState\(\)\);[\s\S]*?focusUntil: 0,[\s\S]*?recentRoutes: \[\],[\s\S]*?__pmVoice\.targetSessionId = MOBILE_CHAT_SESSION_ID;/,
  'a new Voice draft must reset context/focus without clearing a configured room roster',
);
assert.doesNotMatch(
  pages.slice(pages.indexOf('function _startMobileNewVoiceDraft()'), pages.indexOf('function _isMobileNewChatDraftActiveForVoice()')),
  /enabled:\s*false,[\s\S]*?participants:\s*\[\]/,
  'a new Voice draft must not erase persisted room participants',
);

const resolverStart = voicePage.indexOf('async function _resolveVoiceSessionTarget');
const resolverEnd = voicePage.indexOf('\n  const voiceSessionTargetPicker', resolverStart);
const resolver = voicePage.slice(resolverStart, resolverEnd);
assert.ok(resolverStart >= 0 && resolverEnd > resolverStart, 'Voice target resolver must be inspectable');
assert.doesNotMatch(
  resolver,
  /loadLatestUsableSession|__pmChat\.activeSessionId/,
  'standalone Voice target resolution must not inherit the latest or active chat',
);
assert.match(
  resolver,
  /__pmVoice\.targetSessionId = MOBILE_CHAT_SESSION_ID;[\s\S]*?__pmVoice\.targetSessionForced = true;[\s\S]*?return MOBILE_CHAT_SESSION_ID;/,
  'unselected standalone Voice must remain pinned to the fresh draft',
);

assert.match(
  voicePage,
  /window\.__pmVoiceTargetPicker = voiceSessionTargetPicker/,
  'the Voice page must intercept drawer session selection',
);
assert.match(
  voicePage,
  /const activateTargetPickerButton = \(\) => \{[\s\S]*?openDrawer\(\);[\s\S]*?\};/,
  'the scrolled Voice target control must open the chat-session drawer',
);
assert.doesNotMatch(
  router,
  /if \(typeof picker === 'function'\) \{\s*window\.__pmVoiceTargetPicker = null;/,
  'selecting one Voice target must not disable later target changes on the same page',
);
assert.match(
  voicePage,
  /loadMobileChatSession\(sid,[\s\S]*?force: true[\s\S]*?_mergeMobileSessionThreadWithLocal\(sid, history, localThread\)/,
  'explicit session selection must hydrate the selected conversation history',
);
assert.match(
  voicePage,
  /__pmVoice\.targetSessionId = sid;[\s\S]*?__pmVoice\.targetSessionForced = true;[\s\S]*?_prewarmMobileVoiceWorkerContext\(\{[\s\S]*?sessionId: sid,[\s\S]*?force: true[\s\S]*?_restartMobileRealtimeAgentForSettings\('voice_session_target_changed'\)/,
  'explicit selection must bind and refresh Voice against the selected context',
);
assert.match(
  voicePage,
  /if \(targetSessionId === MOBILE_CHAT_SESSION_ID\)[\s\S]*?_ensureDurableMobileVoiceSession/,
  'the first utterance in a fresh Voice draft must materialize a new durable session',
);

console.log('mobile Voice fresh-session checks passed');
