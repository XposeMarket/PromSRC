// Maps a chat session id to the mobile route that owns it. Agent-owned
// sessions (team member rooms, team DMs, subagent chats, background agents)
// have dedicated, labelled pages and must never render in the generic main
// chat page, where the user can type into an agent's room by mistake.
//
// Keep in sync with src/gateway/notifications/session-route.ts. The regression
// test scripts/test-notification-session-route.mjs asserts both agree.

const TEAM_ROOM_PREFIX = 'team_room_member_';
const TEAM_DM_PREFIX = 'team_dm_member_';
const AGENT_DELIM = '___AGENT___';
const SUBAGENT_CHAT_PREFIX = 'subagent_chat_';
const BACKGROUND_PREFIX = 'background_';

function teamIdFrom(sid, prefix) {
  const rest = sid.slice(prefix.length);
  const idx = rest.indexOf(AGENT_DELIM);
  return idx > 0 ? rest.slice(0, idx).trim() : '';
}

/** Owning mobile route (without leading '#') for an agent-owned session, or '' for a normal user chat. */
export function agentOwnedMobileRoute(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return '';
  if (sid.startsWith(TEAM_ROOM_PREFIX) || sid.startsWith(TEAM_DM_PREFIX)) {
    const teamId = teamIdFrom(sid, sid.startsWith(TEAM_ROOM_PREFIX) ? TEAM_ROOM_PREFIX : TEAM_DM_PREFIX);
    return teamId ? `mobile/teams/${encodeURIComponent(teamId)}` : 'mobile/teams';
  }
  if (sid.startsWith(SUBAGENT_CHAT_PREFIX)) {
    const agentId = sid.slice(SUBAGENT_CHAT_PREFIX.length).trim();
    return agentId ? `mobile/subagents/${encodeURIComponent(agentId)}/chat` : 'mobile/subagents';
  }
  if (sid.startsWith(BACKGROUND_PREFIX)) return 'mobile/tasks';
  return '';
}

/** Mobile route (without leading '#') for opening this session. */
export function mobileRouteForSession(sessionId) {
  const owned = agentOwnedMobileRoute(sessionId);
  if (owned) return owned;
  return `mobile/chat/${encodeURIComponent(String(sessionId || '').trim() || 'default')}`;
}
