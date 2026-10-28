// Regression: notifications and the mobile chat route must never open an
// agent-owned session (team room, team DM, subagent chat, background agent)
// in the generic main-chat page. 2026-10-28: a push tap dropped Raul into
// Niko's team room (team_room_member_..___AGENT___builder_..) looking like
// main chat, and his "HELLO" went to Niko.
// Run: npx tsx scripts/test-notification-session-route.mjs
import assert from 'node:assert/strict';
import * as server from '../src/gateway/notifications/session-route.ts';
import * as client from '../web-ui/src/mobile/mobile-session-route.js';

const cases = [
  // agent-owned -> dedicated page
  ['team_room_member_team_mulgpj7k_fcdc9f___AGENT___builder_mulgpa09', 'mobile/teams/team_mulgpj7k_fcdc9f', true],
  ['team_dm_member_team_abc___AGENT___voice_x___THREAD___t1', 'mobile/teams/team_abc', true],
  ['subagent_chat_probe_mvbhr36h', 'mobile/subagents/probe_mvbhr36h/chat', true],
  ['background_bg_a9a908c2-2246-48a1-a52b-10224af37d64', 'mobile/tasks', true],
  // user chats -> main chat, untouched
  ['mobile_mvs1ntes_e1a4mx', 'mobile/chat/mobile_mvs1ntes_e1a4mx', false],
  ['default', 'mobile/chat/default', false],
  ['voice_room_123', 'mobile/chat/voice_room_123', false],
  ['desktop_abc123', 'mobile/chat/desktop_abc123', false],
  ['', 'mobile/chat/default', false],
];

let n = 0;
for (const [sid, expected, owned] of cases) {
  for (const [name, mod] of [['server', server], ['client', client]]) {
    assert.equal(mod.mobileRouteForSession(sid), expected, `${name} mobileRouteForSession(${sid})`);
    assert.equal(Boolean(mod.agentOwnedMobileRoute(sid)), owned, `${name} agentOwnedMobileRoute(${sid}) owned=${owned}`);
    n += 2;
  }
}

// Push link builders must use the mapping (not a hardcoded #mobile/chat/<sid>).
import { readFileSync } from 'node:fs';
const bridge = readFileSync(new URL('../src/gateway/notifications/completion-bridge.ts', import.meta.url), 'utf8');
const wake = readFileSync(new URL('../src/gateway/session-wake.ts', import.meta.url), 'utf8');
assert.ok(bridge.includes('mobileRouteForSession(sessionId)'), 'completion-bridge link uses mobileRouteForSession');
assert.ok(!/#mobile\/chat\/\$\{encodeURIComponent\(sessionId/.test(bridge), 'completion-bridge no longer hardcodes #mobile/chat/<sid>');
assert.ok(/url: `\/\?source=pwa#\$\{mobileRouteForSession\(sessionId\)\}`/.test(wake), 'session-wake push carries a session url');
n += 3;

console.log(`notification-session-route: ${n} assertions passed`);
