/**
 * Team list payload for GET /api/teams. teamChat / runHistory / roomState are
 * megabytes per team (4.8MB for 3 teams, 3.6-4.8s per request, so the Teams
 * page sat blank on desktop and mobile), and no list consumer reads them: the
 * board loads /chat, /runs and /room-state on its own. Strip them and keep
 * cheap counts + last activity. `?full=1` on the route returns raw records.
 */
export function summarizeTeamForList(team: any): any {
  if (!team || typeof team !== 'object') return team;
  const { teamChat, runHistory, roomState, ...rest } = team;
  const chat = Array.isArray(teamChat) ? teamChat : [];
  const runs = Array.isArray(runHistory) ? runHistory : [];
  const ts = (v: any) => {
    const n = typeof v === 'number' ? v : Date.parse(String(v || ''));
    return Number.isFinite(n) ? n : 0;
  };
  const last = chat[chat.length - 1];
  const lastChat = last ? ts(last.timestamp ?? last.createdAt) : 0;
  const lastRun = runs.reduce((m: number, r: any) => Math.max(m, ts(r?.finishedAt), ts(r?.startedAt)), 0);
  return {
    ...rest,
    teamChatCount: chat.length,
    runHistoryCount: runs.length,
    lastActivityAt: Math.max(ts(rest.lastActivityAt), lastChat, lastRun) || undefined,
  };
}
