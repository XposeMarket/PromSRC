import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const source = read('web-ui/src/prom-bot-collab.js');
const generated = read('generated/public-web-ui/static/prom-bot-collab.js');
const performanceSource = read('web-ui/src/performance.js');

assert.equal(source, generated, 'Prom Bot collaboration runtime must mirror generated public source');
assert.match(performanceSource, /import\('\.\/prom-bot\.js'\)[\s\S]*prom-bot-roster\.js[\s\S]*prom-bot-collab\.js/, 'collaboration must boot after the Prom Bot shell and richer roster');

// Lightweight rooms are deliberately not managed Teams.
assert.match(source, /GROUPS_KEY = 'prometheus_prom_bot_groups_v1'/);
assert.match(source, /MAX_GROUP_MEMBERS = 6/);
assert.match(source, /MAX_GROUP_STREAMS = 3/);
assert.match(source, /MAX_GROUP_MESSAGES = 300/);
assert.doesNotMatch(source, /\/api\/teams\b|team_manage|ask_team_coordinator/, 'lightweight Prom Bot rooms must not create managed teams');

// The room is a persistent UI projection while every bot turn still uses the
// canonical standalone-subagent direct chat stream.
assert.match(source, /localStorage\.setItem\(GROUPS_KEY/);
assert.match(source, /\/api\/agents\/\$\{encodeURIComponent\(agent\.id\)\}\/chat\/stream/);
assert.match(source, /'Content-Type': 'application\/json'/);
assert.match(source, /'Accept': 'text\/event-stream'/);
assert.match(source, /window\.__PROM_UNIFIED_DESKTOP_CHAT/);
assert.match(source, /mapLimit\(targets, MAX_GROUP_STREAMS/);

// @mentions target members; a turn without a mention asks the whole room.
assert.match(source, /matchAll\(\/@\(\[a-zA-Z0-9_\.\-\]\+\)\/g\)/);
assert.match(source, /const mentioned = resolveMentions\(text, members\)/);
assert.match(source, /const targets = mentioned\.length \? mentioned : members/);
assert.match(source, /reply with exactly \[PASS\]/);
assert.match(source, /\^\\\[PASS\\\]\$\/i/, 'bots may silently pass when a room message is irrelevant');

// Direct Prom Bot chats gain handoff mentions without replacing the original
// sendSubagentChat path. Mentioned peers receive their own canonical turn.
assert.match(source, /subagent-chat-input/);
assert.match(source, /subagent-chat-send-button/);
assert.match(source, /dispatchDirectMentionHandoff/);
assert.match(source, /Prom Bot @mention handoff from/);
assert.match(source, /agent\.id !== currentId/);
assert.match(source, /refreshPromBotRosterIntelligence/);

// Group creation/search/navigation remain desktop shell behavior.
assert.match(source, /textContent = '\+ Group chat'/);
assert.match(source, /Choose 2–\$\{MAX_GROUP_MEMBERS\} bots/);
assert.match(source, /prom-bot-roster-search/);
assert.match(source, /closePromBotChat\?\.\(\{ keepMode: true \}\)/);

console.log('[test-desktop-prom-bot-collab] passed: @Bot handoffs and lightweight group rooms reuse canonical subagent streams');
