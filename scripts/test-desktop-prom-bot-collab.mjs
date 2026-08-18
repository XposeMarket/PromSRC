import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const source = read('web-ui/src/prom-bot-collab.js');
const generated = read('generated/public-web-ui/static/prom-bot-collab.js');
const performanceSource = read('web-ui/src/performance.js');

assert.equal(source, generated, 'Prom Bot collaboration runtime must mirror generated public source');
assert.match(performanceSource, /import\('\.\/prom-bot\.js'\)[\s\S]*prom-bot-roster\.js[\s\S]*prom-bot-collab\.js/, 'collaboration must boot after the Prom Bot shell and richer roster');

// Lightweight rooms stay distinct from Managed Teams but use the same unified
// chat presentation language and normal sidebar row language.
assert.match(source, /GROUPS_KEY = 'prometheus_prom_bot_groups_v1'/);
assert.match(source, /MAX_GROUP_MEMBERS = 6/);
assert.match(source, /MAX_GROUP_STREAMS = 3/);
assert.match(source, /MAX_GROUP_MESSAGES = 300/);
assert.doesNotMatch(source, /\/api\/teams\b|team_manage|ask_team_coordinator/, 'lightweight Prom Bot rooms must not silently create Managed Teams');
assert.match(source, /prom-bot-group-row chat-session-item job-item/);
assert.match(source, /unified-agent-chat-shell prom-bot-group-shell/);
assert.match(source, /unified-agent-chat-header/);
assert.match(source, /unified-agent-chat-messages prom-bot-group-messages/);
assert.match(source, /window\.__PROM_UNIFIED_DESKTOP_CHAT/);

// The lightweight room projection keeps its own transcript/context while Bot
// execution still uses the established standalone subagent stream.
assert.match(source, /localStorage\.setItem\(GROUPS_KEY/);
assert.match(source, /recentRoomTranscript\(group\)/);
assert.match(source, /PROM BOT GROUP ROOM/);
assert.match(source, /\/api\/agents\/\$\{encodeURIComponent\(agent\.id\)\}\/chat\/stream/);
assert.match(source, /visibleMessage: `\[Prom Bot group · \$\{group\.title\}\]/);
assert.match(source, /source: `prom_bot_group:\$\{group\.id\}`/);
assert.match(source, /markDirectSeen\(agent\.id\)/, 'room-generated replies must not appear as unread direct DMs');
assert.match(source, /mapLimit\(targets, MAX_GROUP_STREAMS/);

// @mentions target members; a turn without a mention asks the whole room.
assert.match(source, /matchAll\(\/@\(\[a-zA-Z0-9_\.\-\]\+\)\/g\)/);
assert.match(source, /const mentioned = resolveMentions\(text, members\)/);
assert.match(source, /const targets = mentioned\.length \? mentioned : members/);
assert.match(source, /reply with exactly \[PASS\]/);
assert.match(source, /\^\\\[PASS\\\]\$\/i/, 'bots may silently pass when a room message is irrelevant');

// Direct Prom Bot chats gain handoff mentions without replacing the original
// subagent-chat send path. Mentioned peers receive their own canonical turn.
assert.match(source, /subagent-chat-input/);
assert.match(source, /subagent-chat-send-button/);
assert.match(source, /dispatchDirectMentionHandoff/);
assert.match(source, /Prom Bot @mention handoff from/);
assert.match(source, /source: 'prom_bot_direct_handoff'/);
assert.match(source, /agent\.id !== currentId/);
assert.match(source, /refreshPromBotRosterIntelligence/);

// Group creation/search/navigation stay Prom Bot shell behavior and expose a
// stable room API so the next Team-flow layer can convert a Group to a Team.
assert.match(source, /textContent = '\+ Group chat'/);
assert.match(source, /Choose 2–\$\{MAX_GROUP_MEMBERS\} bots/);
assert.match(source, /prom-bot-roster-search/);
assert.match(source, /closePromBotChat\?\.\(\{ keepMode: true \}\)/);
assert.match(source, /window\.getPromBotGroups/);
assert.match(source, /window\.getPromBotGroup/);
assert.match(source, /window\.deletePromBotGroup/);

console.log('[test-desktop-prom-bot-collab] passed: Prom Bot DMs/groups share unified chat UI, targeted @mentions, and clean room-vs-DM state');
