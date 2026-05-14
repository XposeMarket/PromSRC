import { getAgentById } from '../../../config/config';
import {
  appendJournal,
  createTask,
  setTaskStepRunning,
  updateTaskStatus,
} from '../../tasks/task-store';
import { bindTaskRunToSession, getTaskRunBinding } from '../../tasks/task-run-mirror';
import {
  appendTeamChat,
  listManagedTeams,
} from '../../teams/managed-teams';
import {
  parseTeamMemberDirectSessionId,
  parseTeamMemberRoomSessionId,
} from '../../teams/team-member-room';
import type { ExecuteToolDeps } from '../subagent-executor';

export type TeamNoteContext = {
  teamId: string;
  authorType: 'manager' | 'subagent';
  authorId: string;
  conversationMode: 'manager' | 'member_room' | 'member_direct' | 'dispatch';
};

export function inferTeamNoteContext(sessionId: string): TeamNoteContext | null {
  const sid = String(sessionId || '');
  if (sid.startsWith('team_coord_')) {
    const teamId = sid.replace(/^team_coord_/, '').trim();
    return teamId ? { teamId, authorType: 'manager', authorId: 'manager', conversationMode: 'manager' } : null;
  }
  if (sid.startsWith('team_dm_manager_')) {
    const match = sid.match(/^team_dm_manager_(.+?)___THREAD___(.+)$/);
    const teamId = String(match?.[1] || '').trim();
    return teamId ? { teamId, authorType: 'manager', authorId: 'manager', conversationMode: 'manager' } : null;
  }
  const roomSession = parseTeamMemberRoomSessionId(sid);
  if (roomSession) {
    return {
      teamId: roomSession.teamId,
      authorType: 'subagent',
      authorId: roomSession.agentId,
      conversationMode: 'member_room',
    };
  }
  const directSession = parseTeamMemberDirectSessionId(sid);
  if (directSession) {
    return {
      teamId: directSession.teamId,
      authorType: 'subagent',
      authorId: directSession.agentId,
      conversationMode: 'member_direct',
    };
  }
  if (sid.startsWith('team_dispatch_')) {
    const stripped = sid.replace(/^team_dispatch_/, '');
    const idx = stripped.lastIndexOf('_');
    const agentId = idx > 0 ? stripped.slice(0, idx) : stripped;
    const team = listManagedTeams().find((t: any) => Array.isArray(t.subagentIds) && t.subagentIds.includes(agentId));
    return team ? { teamId: team.id, authorType: 'subagent', authorId: agentId, conversationMode: 'dispatch' } : null;
  }
  return null;
}

export function appendAndBroadcastTeamChat(
  deps: ExecuteToolDeps,
  team: any,
  message: {
    from: 'manager' | 'subagent' | 'user';
    fromName: string;
    fromAgentId?: string;
    content: string;
    metadata?: Record<string, any>;
  },
) {
  const chatMsg = appendTeamChat(String(team?.id || ''), message);
  try {
    deps.broadcastTeamEvent?.({
      type: 'team_chat_message',
      teamId: team?.id,
      teamName: team?.name,
      chatMessage: chatMsg,
      text: String(chatMsg?.content || message.content || ''),
      message: String(chatMsg?.content || message.content || ''),
    });
  } catch {}
  return chatMsg;
}

export function getTeamChatTargetMetadata(targetAgentId: string) {
  const target = String(targetAgentId || '').trim();
  if (target === 'all') {
    return { targetType: 'team', targetId: 'all', targetLabel: 'team' };
  }
  if (target === 'manager') {
    return { targetType: 'manager', targetId: 'manager', targetLabel: 'manager' };
  }
  const targetAgent = getAgentById(target) as any;
  return {
    targetType: 'member',
    targetId: target,
    targetLabel: String(targetAgent?.name || target).trim(),
  };
}

function shouldStartTeamStatusTaskMirror(phase: string, currentTask: string, blockedReason: string): boolean {
  const normalizedPhase = String(phase || '').trim().toLowerCase();
  const taskText = String(currentTask || '').trim();
  const blockedText = String(blockedReason || '').trim();
  if (!taskText && !blockedText) return false;
  if (['ready', 'idle', 'done', 'complete', 'completed', 'standby', 'standing_by'].includes(normalizedPhase)) {
    return false;
  }
  return [
    'executing',
    'running',
    'planning',
    'reviewing',
    'verifying',
    'checking',
    'working',
    'blocked',
    'waiting_for_context',
  ].includes(normalizedPhase) || !!taskText;
}

export function maybeStartTeamStatusTaskMirror(
  sessionId: string,
  deps: ExecuteToolDeps,
  noteContext: {
    teamId: string;
    authorId: string;
    conversationMode: 'manager' | 'member_room' | 'member_direct' | 'dispatch';
  },
  agentName: string,
  phase: string,
  currentTask: string,
  blockedReason: string,
): string | undefined {
  if (getTaskRunBinding(sessionId)?.taskId) return undefined;
  if (!shouldStartTeamStatusTaskMirror(phase, currentTask, blockedReason)) return undefined;

  const taskText = String(currentTask || blockedReason || 'Team member work').trim();
  const title = `${agentName || noteContext.authorId}: ${taskText.slice(0, 80)}`;
  const task = createTask({
    title,
    prompt: taskText,
    sessionId,
    channel: 'web',
    plan: [{
      index: 0,
      description: taskText.slice(0, 160) || title,
      status: 'pending',
    }],
    teamSubagent: {
      teamId: noteContext.teamId,
      agentId: noteContext.authorId,
      agentName,
    },
  });
  updateTaskStatus(task.id, 'running');
  setTaskStepRunning(task.id, 0);
  appendJournal(task.id, {
    type: 'status_push',
    content: `Task mirror started from update_my_status: ${String(phase || 'running')}${taskText ? ` | ${taskText}` : ''}`,
  });
  bindTaskRunToSession(sessionId, {
    taskId: task.id,
    source: 'team_status',
    teamId: noteContext.teamId,
    agentId: noteContext.authorId,
  });
  try {
    deps.broadcastWS?.({
      type: 'task_running',
      taskId: task.id,
      title,
      source: 'team_status',
      sessionId,
      teamId: noteContext.teamId,
      agentId: noteContext.authorId,
      agentName,
    });
    deps.broadcastWS?.({ type: 'task_panel_update', taskId: task.id, teamId: noteContext.teamId, agentId: noteContext.authorId });
    deps.broadcastTeamEvent?.({
      type: 'task_running',
      taskId: task.id,
      teamId: noteContext.teamId,
      agentId: noteContext.authorId,
      agentName,
      taskSummary: taskText,
      source: 'team_status',
      startedAt: task.startedAt,
    });
  } catch {}
  return task.id;
}
