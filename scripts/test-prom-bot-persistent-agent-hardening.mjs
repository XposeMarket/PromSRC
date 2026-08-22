import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const roster = read('web-ui/src/prom-bot-roster.js');
const collab = read('web-ui/src/prom-bot-collab.js');
const hardening = read('web-ui/src/prom-bot-collab-hardening.js');
const generatedHardening = read('generated/public-web-ui/static/prom-bot-collab-hardening.js');
const teamFlow = read('web-ui/src/team-prom-bot-flow.js');
const botCreate = read('web-ui/src/bot-create.js');
const performanceSource = read('web-ui/src/performance.js');

assert.equal(hardening, generatedHardening, 'Prom Bot collaboration hardening source/generated mirror drifted');
assert.match(performanceSource, /prom-bot-collab\.js[\s\S]*prom-bot-collab-hardening\.js[\s\S]*team-prom-bot-flow\.js/, 'hardening must load after Group collaboration and before Team flow');

// Group turns still use the canonical agent runtime, but direct roster state is
// calculated only from direct traffic. The persisted backend source marker is
// authoritative for the separation.
assert.match(collab, /source: `prom_bot_group:\$\{group\.id\}`/);
assert.match(roster, /isPromBotGroupTraffic/);
assert.match(roster, /source\.startsWith\('prom_bot_group:'\)/);
assert.match(roster, /const directMessages = messages\.filter/);
assert.match(roster, /latestMessage\(directMessages\)/);

// The legacy Group layer writes the direct read cursor after room turns; the
// hardening wrapper snapshots/restores it and refreshes roster intelligence so
// a real DM can never be permanently swallowed by room traffic.
assert.match(hardening, /DIRECT_SEEN_KEY = 'prometheus_prom_bot_seen_v1'/);
assert.match(hardening, /snapshotDirectSeenCursor/);
assert.match(hardening, /restoreDirectSeenCursor\(directSeenBefore\)/);
assert.match(hardening, /refreshPromBotRosterIntelligence/);

// Only one user-authored Group turn may run at once. Keyboard, composer send,
// and voice all route through the same guard.
assert.match(hardening, /let groupSendPromise = null/);
assert.match(hardening, /if \(groupSendPromise\)/);
assert.match(hardening, /window\.sendPromBotGroupMessage = guardedSend/);
assert.match(hardening, /window\.handlePromBotGroupKeydown/);
assert.match(hardening, /window\.startPromBotGroupVoice/);
assert.match(hardening, /setGroupComposerBusy\(true\)/);
assert.match(hardening, /setGroupComposerBusy\(false\)/);

// POST /api/agents is the resource commit point. A later AGENT.md or automatic
// open failure must be reported as partial follow-up failure, never as if the
// Bot itself did not exist (which would invite duplicate creation retries).
assert.match(botCreate, /The resource creation is the commit point/);
assert.match(botCreate, /let identityError = null/);
assert.match(botCreate, /Bot created · identity save needs attention/);
assert.match(botCreate, /do not create a duplicate Bot/);
assert.match(botCreate, /Bot was created but could not be opened automatically/);

// Group→Team conversion is non-destructive unless transcript import is proven
// successful. A failed import preserves the original lightweight Group.
assert.match(teamFlow, /const contextRes = await fetch/);
assert.match(teamFlow, /if \(!contextRes\.ok \|\| contextData\?\.success === false\)/);
assert.match(teamFlow, /history preserved/);
assert.match(teamFlow, /original Group was kept/);
const importGuard = teamFlow.indexOf('if (!contextRes.ok || contextData?.success === false)');
const deletion = teamFlow.indexOf('window.deletePromBotGroup?.(group.id)');
assert.ok(importGuard >= 0 && deletion > importGuard, 'Group deletion must occur only after the transcript-import guard');

console.log('[test-prom-bot-persistent-agent-hardening] passed: direct state, Group serialization, creation commit semantics, and conversion durability are guarded');
