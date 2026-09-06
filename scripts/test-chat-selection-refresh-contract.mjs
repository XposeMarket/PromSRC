import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const desktop = read('web-ui/src/pages/ChatPage.js');
const generatedDesktop = read('generated/public-web-ui/static/pages/ChatPage.js');
const priority = read('web-ui/src/legacy-desktop-bootstrap.js');
const generatedPriority = read('generated/public-web-ui/static/legacy-desktop-bootstrap.js');
const mobileModel = read('web-ui/src/mobile/mobile-model-badge.js');
const generatedMobileModel = read('generated/public-web-ui/static/mobile/mobile-model-badge.js');
const mobileContext = read('web-ui/src/mobile/mobile-context-window.js');
const generatedMobileContext = read('generated/public-web-ui/static/mobile/mobile-context-window.js');
const mobileRuntime = read('web-ui/src/mobile/mobile-chat-page-runtime.js');
const generatedMobileRuntime = read('generated/public-web-ui/static/mobile/mobile-chat-page-runtime.js');

assert.match(desktop, /desktopNewChatContextProjectsCacheReady/);
assert.match(desktop, /loadDesktopNewChatProjects\(\{ preload: true \}\)/);
assert.match(desktop, /generation !== desktopSessionOpenGeneration/);
assert.match(desktop, /desktopSessionOpenRequests\.get\(sessionId\)/);
assert.match(generatedDesktop, /desktopNewChatContextProjectsCacheReady/);
assert.match(generatedDesktop, /generation !== desktopSessionOpenGeneration/);

assert.match(mobileModel, /MOBILE_CHAT_MODEL_ROUTE_STORAGE_KEY/);
assert.match(mobileModel, /_readSavedChatModelRoute/);
assert.match(mobileModel, /fromSelector: true/);
assert.match(generatedMobileModel, /MOBILE_CHAT_MODEL_ROUTE_STORAGE_KEY/);
assert.match(mobileContext, /pm-mobile-session-changed/);
assert.match(mobileContext, /_refresh\(sid \|\| currentSid, \{ force: true/);
assert.match(generatedMobileContext, /pm-mobile-session-changed/);
assert.match(mobileRuntime, /pm-mobile-session-changed/);
assert.match(generatedMobileRuntime, /pm-mobile-session-changed/);

const priorityStart = priority.indexOf('function _prioritySessionActivityTime(');
const priorityEnd = priority.indexOf('let _sessionListRefreshFrame', priorityStart);
const priorityBlock = priority.slice(priorityStart, priorityEnd);
const generatedPriorityStart = generatedPriority.indexOf('function _prioritySessionActivityTime(');
const generatedPriorityEnd = generatedPriority.indexOf('let _sessionListRefreshFrame', generatedPriorityStart);
const generatedPriorityBlock = generatedPriority.slice(generatedPriorityStart, generatedPriorityEnd);
assert.match(priorityBlock, /session\?\.lastMessageAt/);
assert.match(priorityBlock, /isInternalChatMessage\(message\)/);
assert.doesNotMatch(priorityBlock, /session\?\.(?:updatedAt|lastActiveAt)/);
assert.doesNotMatch(priorityBlock, /Date\.now\(\)/);
assert.match(generatedPriorityBlock, /session\?\.lastMessageAt/);

console.log('chat selection refresh contract passed');
