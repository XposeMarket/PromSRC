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
assert.match(source, /MAX_GROUP_HANDOFF_WAVES = 2/);
assert.match(source, /MAX_GROUP_MESSAGES = 300/);
assert.doesNotMatch(source, /\/api\/teams\b|team_manage|ask_team_coordinator/, 'lightweight Prom Bot rooms must not silently create Managed Teams');
assert.match(source, /prom-bot-group-row chat-session-item job-item/);
assert.match(source, /unified-agent-chat-shell prom-bot-group-shell/);
assert.match(source, /unified-agent-chat-header/);
assert.match(source, /unified-agent-chat-messages prom-bot-group-messages/);
assert.match(source, /setPromChatTitleOverride\?\.\('Prom Bot group', group\.title, 'prom-bot-group'\)/,
  'group rooms must project their identity into the shared chat title slot');
assert.match(source, /clearPromChatTitleOverride\?\.\('prom-bot-group'\)/,
  'group title projection must be cleared when leaving the room');
assert.doesNotMatch(source, /<div class="side-chat-kicker">Prom Bot group<\/div>/,
  'the group label must not be duplicated inside the room header');
assert.doesNotMatch(source, /<div class="side-chat-title">\$\{esc\(group\.title\)\}<\/div>/,
  'the group title must be projected into the main chat title area');
assert.match(source, /window\.__PROM_UNIFIED_DESKTOP_CHAT/);
assert.match(source, /#chat-view\.prom-bot-group-active/,
  'Prom Bot group chat must use the normal main-chat flex surface');
assert.match(source, /function displaceMainChatSurface\(/,
  'Prom Bot group chat must displace the ordinary main-chat children');
assert.match(source, /#chat-view\.prom-bot-group-active > \[hidden\][\s\S]*?display:\s*none !important/,
  'Prom Bot group chat must suppress authored display rules on displaced main-chat children');
assert.match(source, /function restoreMainChatSurface\(/,
  'Prom Bot group chat must restore the ordinary main-chat children on exit');
assert.match(source, /entry\.node\.hidden = true/,
  'Prom Bot group chat must not leave the underlying main chat visible');
assert.doesNotMatch(source, /#\$\{GROUP_HOST_ID\}\s*\{\s*position:absolute/,
  'Prom Bot group chat must not return to the legacy absolute overlay host');

// The lightweight room projection keeps its own transcript/context while Bot
// execution still uses the established standalone subagent stream.
assert.match(source, /localStorage\.setItem\(GROUPS_KEY/);
assert.match(source, /recentRoomTranscript\(group\)/);
assert.match(source, /PROM BOT GROUP ROOM/);
assert.match(source, /\/api\/agents\/\$\{encodeURIComponent\(agent\.id\)\}\/chat\/stream/);
assert.match(source, /visibleMessage: sourceAgent/);
assert.match(source, /source: `prom_bot_group:\$\{group\.id\}`/);
assert.match(source, /markDirectSeen\(agent\.id\)/, 'room-generated replies must not appear as unread direct DMs');

// User @mentions target members; a turn without a mention asks the whole room.
assert.match(source, /matchAll\(\/@\(\[a-zA-Z0-9_\.\-\]\+\)\/g\)/);
assert.match(source, /const mentioned = resolveMentions\(text, members\)/);
assert.match(source, /const targets = mentioned\.length \? mentioned : members/);
assert.match(source, /reply with exactly \[PASS\]/);
assert.match(source, /\^\\\[PASS\\\]\$\/i/, 'bots may silently pass when a room message is irrelevant');

// Bot-authored @mentions also become real room handoffs. Handoff waves are
// bounded and a Bot can only be invoked once per user turn, preventing loops.
assert.match(source, /runGroupConversation\(group, initialTargets, initialText\)/);
assert.match(source, /resolveMentions\(result\.reply, members\)/);
assert.match(source, /!visited\.has\(agent\.id\)/);
assert.match(source, /visited\.add\(target\.id\)/);
assert.match(source, /depth <= MAX_GROUP_HANDOFF_WAVES/);
assert.match(source, /sourceAgent: result\.agent/);
assert.match(source, /Prom Bot will route that mention after you reply/);
assert.match(source, /Bots can @ each other/);

// Direct Prom Bot chats gain handoff mentions without replacing the original
// subagent-chat send path. Mentioned peers receive their own canonical turn.
assert.match(source, /subagent-chat-input/);
assert.match(source, /subagent-chat-send-button/);
assert.match(source, /dispatchDirectMentionHandoff/);
assert.match(source, /Prom Bot @mention handoff from/);
assert.match(source, /source: 'prom_bot_direct_handoff'/);
assert.match(source, /agent\.id !== currentId/);
assert.match(source, /refreshPromBotRosterIntelligence/);

// Collaboration chrome is scoped to the Prom Bot sidebar instead of observing
// every DOM mutation in the desktop app.
assert.doesNotMatch(source, /observe\(document\.body/);
assert.match(source, /chromeObserver\.observe\(section, \{ childList: true, subtree: true \}\)/);

// Group creation/search/navigation stay Prom Bot shell behavior and expose a
// stable room API so the next Team-flow layer can convert a Group to a Team.
assert.match(source, /textContent = '\+ Group chat'/);
assert.match(source, /session-hover-preview prom-bot-group-hover-preview/,
  'group rename should reuse the regular chat hover-popover styling');
assert.match(source, /beginGroupHoverRename\(popover\)/,
  'group hover popover should expose the same inline rename interaction');
assert.match(source, /group\.title = nextTitle/,
  'group rename should persist the edited title on the lightweight room');
assert.match(source, /saveGroups\(\);[\s\S]*?renderGroupRows\(\);[\s\S]*?setPromChatTitleOverride/,
  'renaming the active group should refresh its sidebar row and title projection');
assert.match(source, /Choose 2–\$\{MAX_GROUP_MEMBERS\} bots/);
assert.match(source, /prom-bot-roster-search/);
assert.match(source, /closePromBotChat\?\.\(\{ keepMode: true \}\)/);
assert.match(source, /window\.getPromBotGroups/);
assert.match(source, /window\.getPromBotGroup/);
assert.match(source, /window\.deletePromBotGroup/);

console.log('[test-desktop-prom-bot-collab] passed: Prom Bot DMs/groups share unified chat UI with bounded user and Bot-to-Bot @mentions');
