import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const desktop = read('web-ui/src/pages/ChatPage.js');
const prioritySource = read('web-ui/index.html');
const generatedDesktop = read('generated/public-web-ui/static/pages/ChatPage.js');
const mobileModel = read('web-ui/src/mobile/mobile-model-badge.js');
const generatedMobileModel = read('generated/public-web-ui/static/mobile/mobile-model-badge.js');
const mobileContext = read('web-ui/src/mobile/mobile-context-window.js');
const generatedMobileContext = read('generated/public-web-ui/static/mobile/mobile-context-window.js');
const mobilePages = read('web-ui/src/mobile/mobile-pages.js');
const generatedMobilePages = read('generated/public-web-ui/static/mobile/mobile-pages.js');
const priorityStart = prioritySource.indexOf('function _prioritySessionActivityTime(');
const priorityEnd = prioritySource.indexOf('let _sessionListRefreshFrame', priorityStart);
const priority = prioritySource.slice(priorityStart, priorityEnd);

assert.match(desktop, /desktopNewChatContextProjectsCacheReady/);
assert.match(desktop, /loadDesktopNewChatProjects\(\{ preload: true \}\)/);
assert.match(desktop, /desktopNewChatContextProjectsLoad/);
assert.match(desktop, /generation !== desktopSessionOpenGeneration/);
assert.match(desktop, /desktopSessionOpenRequests\.get\(sessionId\)/);
assert.match(generatedDesktop, /desktopNewChatContextProjectsCacheReady/);
assert.match(generatedDesktop, /generation !== desktopSessionOpenGeneration/);

assert.match(mobileModel, /MOBILE_CHAT_MODEL_ROUTE_STORAGE_KEY/);
assert.match(mobileModel, /_readSavedChatModelRoute/);
assert.match(mobileModel, /_writeSavedChatModelRoute/);
assert.match(mobileModel, /_mobileDraftModelRoute \|\| _readSavedChatModelRoute\(\)/);
assert.match(mobileModel, /fromSelector: true/);
assert.match(generatedMobileModel, /MOBILE_CHAT_MODEL_ROUTE_STORAGE_KEY/);
assert.match(generatedMobileModel, /fromSelector: true/);

assert.match(mobileContext, /pm-mobile-session-changed/);
assert.match(mobileContext, /_refresh\(sid \|\| currentSid, \{ force: true/);
assert.match(generatedMobileContext, /pm-mobile-session-changed/);
assert.match(mobilePages, /new CustomEvent\('pm-mobile-session-changed'/);
assert.match(generatedMobilePages, /new CustomEvent\('pm-mobile-session-changed'/);

assert.match(priority, /session\?\.lastMessageAt/);
assert.match(priority, /isInternalChatMessage\(message\)/);
assert.doesNotMatch(priority, /session\?\.(?:updatedAt|lastActiveAt)/);
assert.doesNotMatch(priority, /Date\.now\(\)/);

console.log('chat selection refresh contract: cached projects, guarded desktop opens, mobile route persistence/session refresh, and message-recency priority ordering passed');
