// Mobile Chat tab restore regression.
// Tapping Chat after visiting Tasks/Hub/etc. must reopen the conversation the
// user was in, not a blank New Chat. Only New Chat (or deleting that chat)
// forgets it, and agent-owned/draft sessions are never remembered.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MOBILE_CHAT_TAB_ROUTE_KEY,
  forgetMobileChatTabRoute,
  rememberMobileChatTabRoute,
  resolveMobileChatTabRoute,
} from '../web-ui/src/mobile/mobile-session-route.js';

const memoryStore = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
};

// Nothing remembered: Chat tab opens the plain chat route (new chat draft).
let s = memoryStore();
assert.equal(resolveMobileChatTabRoute('#mobile/chat', s), '#mobile/chat');

// Open a chat, go elsewhere, tap Chat: back to that chat.
rememberMobileChatTabRoute('mobile_abc123', s);
assert.equal(resolveMobileChatTabRoute('#mobile/chat', s), '#mobile/chat/mobile_abc123');
// Other routes are never rewritten.
assert.equal(resolveMobileChatTabRoute('#mobile/tasks', s), '#mobile/tasks');
assert.equal(resolveMobileChatTabRoute('#mobile/chat/other', s), '#mobile/chat/other');

// Remote-gateway (namespaced, URI-encoded) chat ids round-trip unchanged.
const namespaced = encodeURIComponent('gw:desk-1/mobile_xyz');
rememberMobileChatTabRoute(namespaced, s);
assert.equal(resolveMobileChatTabRoute('#mobile/chat', s), `#mobile/chat/${namespaced}`);

// Draft and agent-owned sessions never replace the remembered chat.
rememberMobileChatTabRoute('mobile_default', s);
rememberMobileChatTabRoute('team_room_member_t1___AGENT___a1', s);
rememberMobileChatTabRoute('subagent_chat_x', s);
rememberMobileChatTabRoute('background_123', s);
assert.equal(s.getItem(MOBILE_CHAT_TAB_ROUTE_KEY), namespaced);

// Deleting an unrelated chat keeps it; deleting this chat forgets it.
forgetMobileChatTabRoute('mobile_unrelated', s);
assert.equal(s.getItem(MOBILE_CHAT_TAB_ROUTE_KEY), namespaced);
forgetMobileChatTabRoute('mobile_xyz', s);
assert.equal(s.getItem(MOBILE_CHAT_TAB_ROUTE_KEY), null);

// New Chat forgets it, so the Chat tab then lands on the draft.
rememberMobileChatTabRoute('mobile_abc123', s);
forgetMobileChatTabRoute('', s);
assert.equal(resolveMobileChatTabRoute('#mobile/chat', s), '#mobile/chat');

// Wiring: every way of reaching Chat goes through the resolver, chat routes are
// recorded on render, and both New Chat paths clear the memory first.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const router = read('web-ui/src/mobile/mobile-router.js');
assert.match(router, /export function mobileNavigate\(route\)[\s\S]{0,1500}route = resolveMobileChatTabRoute\(route\);/);
assert.match(router, /if \(page === 'chat' && arg\) rememberMobileChatTabRoute\(arg\);/);
assert.match(router, /onNewChat: \(\) => \{[\s\S]{0,200}forgetMobileChatTabRoute\(\);/);
const pages = read('web-ui/src/mobile/mobile-pages.js');
assert.equal(MOBILE_CHAT_TAB_ROUTE_KEY, 'pm_mobile_chat_tab_route');
assert.match(pages, /function _startMobileNewChat\(navigate\) \{[\s\S]{0,900}localStorage\.removeItem\('pm_mobile_chat_tab_route'\)[\s\S]{0,1200}navigate\?\.\('#mobile\/chat'\);/);
assert.doesNotMatch(pages, /mobile-session-route/, 'chat owner slice must not grow for this');
// Leaving chat records the live URL (covers a draft's replaceState to its real
// id), and only for non-chat targets so New Chat cannot re-record the old chat.
assert.match(router, /if \(!\/\^#mobile\\\/chat\(\?:\\\/\|\$\)\/\.test\(route\)\) \{[\s\S]{0,200}rememberMobileChatTabRoute\(current\[1\]\)/);
const runtime = read('web-ui/src/mobile/mobile-chat-page-runtime.js');
assert.doesNotMatch(runtime, /mobile-session-route/, 'chat renderer slice must not grow for this');
const shell = read('web-ui/src/mobile/mobile-shell.js');
assert.match(shell, /pm_mobile_chat_tab_route/);

console.log('mobile chat tab restore: ok');
