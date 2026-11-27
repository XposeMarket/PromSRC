/**
 * Team list payload for GET /api/teams. teamChat / runHistory / roomState are
 * megabytes per team (4.8MB for 3 teams, 3.6-4.8s per request, so the Teams
 * page sat blank on desktop and mobile), and no list consumer reads them: the
 * board loads /chat, /runs and /room-state on its own. Strip them and keep
 * cheap counts + last activity. `?full=1` on the route returns raw records.
 */
import { summarizeEscalations } from './managed-teams';

export function summarizeTeamForList(team: any, liveStartedAt = 0): any {
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
    lastRunAt: Math.max(lastRun, ts(rest.lastRunAt), liveStartedAt),
    running: liveStartedAt > 0,
    teamChatCount: chat.length,
    runHistoryCount: runs.length,
    lastActivityAt: Math.max(ts(rest.lastActivityAt), lastChat, lastRun) || undefined,
    escalations: summarizeEscalations(team),
  };
}

/**
 * Model-facing result for team pause / resume. The internal helpers return the
 * whole team record and the tool used to serialize it as-is: 4,486,954
 * characters for one team with 78 runs of chat (thinking, process and live
 * trace entries), which floods the calling model's context. A control action
 * only has to confirm the new state. History stays on the read paths (team
 * status, /chat, /runs, /room-state).
 */
export function summarizeTeamControlResult(
  action: 'pause' | 'resume',
  out: { success?: boolean; team?: any; error?: string } | null | undefined,
  wasPaused?: boolean,
): any {
  if (!out || out.success !== true || !out.team || typeof out.team !== 'object') {
    return { success: false, action, error: String(out?.error || `Team ${action} failed`) };
  }
  const team = out.team;
  const paused = team.manager?.paused === true;
  const subagentIds = Array.isArray(team.subagentIds) ? team.subagentIds.map((id: any) => String(id)) : [];
  return {
    success: true,
    action,
    // false when the team was already in the requested state (nothing was written).
    ...(typeof wasPaused === 'boolean' ? { changed: wasPaused !== paused } : {}),
    team: {
      id: String(team.id || ''),
      name: String(team.name || '').slice(0, 200),
      paused,
      pausedAt: paused ? team.manager?.pausedAt ?? null : null,
      pauseReason: paused && team.manager?.pauseReason ? String(team.manager.pauseReason).slice(0, 300) : null,
      managerAgentId: team.managerAgentId ? String(team.managerAgentId) : null,
      subagentIds,
      memberCount: subagentIds.length,
      teamChatCount: Array.isArray(team.teamChat) ? team.teamChat.length : 0,
      runHistoryCount: Array.isArray(team.runHistory) ? team.runHistory.length : 0,
      totalRuns: Number(team.totalRuns) || 0,
    },
    note: 'Compact result. Use team_action:"status" for manager, member and dispatch detail.',
  };
}

/**
 * HTTP response for POST /api/teams/:id/pause and /resume (including the
 * abortOnly interrupt). Same reason as the list payload: no client reads the
 * returned team (both UIs refetch), so do not ship megabytes of chat back for
 * a button tap. Every other field of the result is passed through unchanged.
 */
export function summarizeTeamControlResponse<T extends { team?: any }>(out: T, liveStartedAt = 0): T {
  if (!out || !out.team || typeof out.team !== 'object') return out;
  return { ...out, team: summarizeTeamForList(out.team, liveStartedAt) };
}
