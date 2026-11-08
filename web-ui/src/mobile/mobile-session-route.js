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

// Chat tab memory. The bottom Chat tab must return to the conversation the
// user was last in, not a blank new chat. The router records the last explicit
// `#mobile/chat/<arg>` route here; only New Chat (a bare chat render that did
// not come from the tab) or deleting that chat forgets it. Kept separate from
// pm_mobile_last_chat_session, which Voice drafts and other flows clear.
export const MOBILE_CHAT_TAB_ROUTE_KEY = 'pm_mobile_chat_tab_route';

function chatTabStore(storage) {
  if (storage) return storage;
  try { return globalThis.localStorage || null; } catch { return null; }
}

/** Record the raw (still URI-encoded) chat route arg the user is viewing. */
export function rememberMobileChatTabRoute(arg, storage) {
  const raw = String(arg || '').trim();
  const store = chatTabStore(storage);
  if (!raw || !store) return;
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch {}
  if (decoded === 'mobile_default' || decoded === 'default' || agentOwnedMobileRoute(decoded)) return;
  try { store.setItem(MOBILE_CHAT_TAB_ROUTE_KEY, raw); } catch {}
}

/** Forget the remembered chat (New Chat), or only if it points at sessionId (delete). */
export function forgetMobileChatTabRoute(sessionId = '', storage) {
  const store = chatTabStore(storage);
  if (!store) return;
  try {
    const sid = String(sessionId || '').trim();
    if (sid) {
      const raw = String(store.getItem(MOBILE_CHAT_TAB_ROUTE_KEY) || '');
      let decoded = raw;
      try { decoded = decodeURIComponent(raw); } catch {}
      if (!raw || (!decoded.includes(sid) && !raw.includes(sid))) return;
    }
    store.removeItem(MOBILE_CHAT_TAB_ROUTE_KEY);
  } catch {}
}

/** Route the Chat tab should open: the remembered chat, else the given route. */
export function resolveMobileChatTabRoute(route, storage) {
  const target = String(route || '');
  if (target !== '#mobile/chat' && target !== 'mobile/chat' && target !== '#/mobile/chat') return target;
  const store = chatTabStore(storage);
  let raw = '';
  try { raw = String(store?.getItem(MOBILE_CHAT_TAB_ROUTE_KEY) || '').trim(); } catch {}
  return raw ? `#mobile/chat/${raw}` : target;
}

/** Mobile route (without leading '#') for opening this session. */
export function mobileRouteForSession(sessionId) {
  const owned = agentOwnedMobileRoute(sessionId);
  if (owned) return owned;
  return `mobile/chat/${encodeURIComponent(String(sessionId || '').trim() || 'default')}`;
}
