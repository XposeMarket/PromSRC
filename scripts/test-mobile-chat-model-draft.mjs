import assert from 'node:assert/strict';
import fs from 'node:fs';

const badge = fs.readFileSync('web-ui/src/mobile/mobile-model-badge.js', 'utf8');
const pages = fs.readFileSync('web-ui/src/mobile/mobile-pages.js', 'utf8');

assert.match(badge, /let _mobileDraftModelRoute = null/);
assert.match(badge, /sessionId === 'mobile_default'\) return _mobileDraftModelRoute/);
assert.match(badge, /export async function applyMobileDraftModelRouteToSession/);
assert.doesNotMatch(badge, /Send the first message before choosing a model for this chat/);
assert.doesNotMatch(badge, /Use Main Chat Default/);
assert.doesNotMatch(badge, /class="pm-(?:reasoning|msheet)-source"/);

assert.match(pages, /function _startMobileNewChat\(navigate\)[\s\S]*?activeSessionId = MOBILE_CHAT_SESSION_ID;\s*resetMobileDraftModelRoute\(\)/);
assert.match(pages, /function _startMobileNewVoiceDraft\(\)[\s\S]*?activeSessionId = MOBILE_CHAT_SESSION_ID;\s*resetMobileDraftModelRoute\(\)/);
assert.match(
  pages,
  /await createMobileChatSession\(actualSessionId, \{ title: 'New Chat' \}\);\s*await applyMobileDraftModelRouteToSession\(actualSessionId\)/,
);

console.log('mobile chat draft model-route regression checks passed');
