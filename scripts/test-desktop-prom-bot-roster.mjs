import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const source = read('web-ui/src/prom-bot-roster.js');
const generated = read('generated/public-web-ui/static/prom-bot-roster.js');
const performanceSource = read('web-ui/src/performance.js');

assert.equal(source, generated, 'Prom Bot roster intelligence must mirror generated public source');
assert.match(performanceSource, /import\('\.\/prom-bot\.js'\)[\s\S]*then\(\(\) => import\('\.\/prom-bot-roster\.js'\)\)/, 'roster must boot only after the Prom Bot shell');

// Rich roster is a view over durable subagent state, not a new chat/runtime store.
assert.match(source, /\/api\/agents\/\$\{encodeURIComponent\(id\)\}\/chat\?limit=20/);
assert.match(source, /\/api\/agents\/\$\{encodeURIComponent\(id\)\}\/runs\?limit=12/);
assert.match(source, /MAX_CONCURRENCY = 4/, 'metadata hydration must stay bounded');
assert.match(source, /mapLimit\(agents, MAX_CONCURRENCY, hydrateAgent\)/);

// Hermes-style roster affordances.
assert.match(source, /placeholder = 'Search subagents'/);
assert.match(source, /textContent = 'Active now'/);
assert.match(source, /textContent = 'Needs you'/);
assert.match(source, /className = 'prom-bot-unread-dot'/);
assert.match(source, /className = 'prom-bot-agent-preview'/);
assert.match(source, /relativeTime\(meta\.latestTs\)/);

// Unread is a durable local read cursor over canonical agent messages, not a
// second message store. Opening a bot advances its cursor.
assert.match(source, /prometheus_prom_bot_seen_v1/);
assert.match(source, /latestAgentTs > Number\(seen\[id\] \|\| 0\)/);
assert.match(source, /seen\[id\] = Math\.max/);

// Needs-you and Active Now come from real run states.
assert.match(source, /awaiting_user_input/);
assert.match(source, /needs_assistance/);
assert.match(source, /waiting_subagent/);
assert.match(source, /awaiting_command_approval/);

// Refresh only while Prom Bot is visible/active; no mobile or hidden-page poll.
assert.match(source, /if \(!window\.promBotMode \|\| document\.hidden\) return \[\]/);
assert.match(source, /REFRESH_MS = 20_000/);

console.log('[test-desktop-prom-bot-roster] passed: search, Active Now, previews, unread and needs-you reuse durable agent state');
