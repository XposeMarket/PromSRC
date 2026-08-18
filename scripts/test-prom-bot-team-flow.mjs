import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const flow = read('web-ui/src/team-prom-bot-flow.js');
const generated = read('generated/public-web-ui/static/team-prom-bot-flow.js');
const performanceSource = read('web-ui/src/performance.js');
const teamsPage = read('web-ui/src/pages/TeamsPage.js');
const teamsRouter = read('src/gateway/routes/teams.router.ts');
const memberRoom = read('src/gateway/teams/team-member-room.ts');

assert.equal(flow, generated, 'Prom Bot Team flow must mirror generated public source');
assert.match(performanceSource, /prom-bot-collab\.js[\s\S]*team-prom-bot-flow\.js/, 'Team flow must boot after Prom Bot collaboration');

// Team chat remains the established Subagent/side-chat presentation system.
assert.match(teamsPage, /window\.__PROM_UNIFIED_DESKTOP_CHAT/);
assert.match(teamsPage, /unified-agent-chat-shell/);
assert.match(teamsPage, /unified-agent-chat-header/);
assert.match(teamsPage, /renderer\.renderHistory/);
assert.match(teamsPage, /renderer\.renderLiveMessage/);
assert.match(teamsPage, /renderer\.renderComposer/);
assert.match(flow, /Managed Prom Bot room/);
assert.doesNotMatch(flow, /renderTeamMessageBubble|team-prom-bot-message-bubble/, 'Team flow must not fork another chat renderer');

// Managed Team conversational contract: ordinary text goes to the manager;
// explicit mentions remain untouched for the existing authoritative router.
assert.match(flow, /TEAM_CHAT_ROUTE_RE/);
assert.match(flow, /!explicitMention\(message\)/);
assert.match(flow, /payload\.targetType = 'manager'/);
assert.match(flow, /payload\.targetLabel = 'manager'/);
assert.match(flow, /No mention → manager/);
assert.match(flow, /@manager/);
assert.match(flow, /@team/);
assert.match(flow, /Message the manager, @team, or @Bot/);

// The existing server router remains responsible for actual @manager/@team/
// member resolution and durable Team direct threads.
assert.match(teamsRouter, /buildTeamMentionParticipants/);
assert.match(teamsRouter, /label: 'manager'/);
assert.match(teamsRouter, /aliases: \['team'\]/);
assert.match(teamsRouter, /type: 'member'/);
assert.match(teamsRouter, /getOrCreateTeamDirectThread/);
assert.match(teamsRouter, /scheduleTeamMemberDirectWake/);
assert.match(teamsRouter, /deliverTeamBroadcastToMembers/);

// Bot-to-Bot collaboration remains server-side Team room behavior, including
// teammate messaging and auto-wake; no client fanout executor is introduced.
assert.match(memberRoom, /Use talk_to_teammate to coordinate with other members or the manager/);
assert.match(memberRoom, /scheduleTeamMemberAutoWake/);
assert.match(memberRoom, /MESSAGES FOR YOU/);
assert.doesNotMatch(flow, /Promise\.all\([^)]*subagent|mapLimit\([^)]*team/, 'Team flow must not fan Team members out in the browser');

// Prom Bot Group → Managed Team conversion uses the existing Team API, keeps
// the same Bot membership, imports the conversation as Team context, and does
// not auto-kickoff work merely because the room was converted.
assert.match(flow, /Convert to Team/);
assert.match(flow, /fetch\('\/api\/teams'/);
assert.match(flow, /subagentIds: Array\.isArray\(group\.memberIds\) \? group\.memberIds : \[\]/);
assert.match(flow, /kickoffInitialReview: false/);
assert.match(flow, /\/context-references/);
assert.match(flow, /Prom Bot group history/);
assert.match(flow, /prom_bot_group_conversion/);
assert.match(flow, /window\.deletePromBotGroup/);
assert.match(flow, /window\.openTeamBoard/);
assert.match(flow, /window\.switchTeamTab/);

console.log('[test-prom-bot-team-flow] passed: Teams behave as manager-led Prom Bot rooms on the existing unified Team runtime');
