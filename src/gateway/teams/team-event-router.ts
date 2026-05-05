import { getAgentById } from '../../config/config';
import {
  appendTeamRoomMessage,
  getManagedTeam,
  queueAgentMessage,
  queueManagerMessage,
  type TeamMemberPresenceState,
} from './managed-teams';
import { scheduleTeamManagerAutoWake } from './team-manager-autowake';
import { scheduleTeamMemberAutoWake } from './team-member-room';

export type TeamEventType =
  | 'member_completed_task'
  | 'member_failed_task'
  | 'member_shared_artifact'
  | 'member_blocked';

export interface TeamEventRouterInput {
  type: TeamEventType;
  teamId: string;
  agentId: string;
  agentName?: string;
  task?: string;
  resultSummary?: string;
  artifactName?: string;
  artifactPath?: string;
  error?: string;
  warning?: string;
  taskId?: string;
  dispatchId?: string;
  stepCount?: number;
  durationMs?: number;
  source?: string;
}

export interface TeamEventRouterResult {
  roomMessageId?: string;
  managerQueued: boolean;
  membersWoken: string[];
}

function compact(value: unknown, max = 900): string {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function isWakeableStatus(status?: TeamMemberPresenceState | string): boolean {
  return ['idle', 'ready', 'waiting_for_context', 'planning'].includes(String(status || 'idle'));
}

function buildRoomContent(event: TeamEventRouterInput): string {
  const task = compact(event.task, 260);
  const summary = compact(event.resultSummary || event.error || event.warning, 1000);
  if (event.type === 'member_completed_task') {
    return [
      `Completed task${task ? `: ${task}` : ''}.`,
      summary ? `Result: ${summary}` : '',
    ].filter(Boolean).join('\n');
  }
  if (event.type === 'member_failed_task') {
    return [
      `Task failed${task ? `: ${task}` : ''}.`,
      summary ? `Issue: ${summary}` : '',
    ].filter(Boolean).join('\n');
  }
  if (event.type === 'member_shared_artifact') {
    return [
      `Shared artifact: ${compact(event.artifactName || 'artifact', 180)}`,
      event.artifactPath ? `Path: ${compact(event.artifactPath, 300)}` : '',
      summary ? `Note: ${summary}` : '',
    ].filter(Boolean).join('\n');
  }
  return [
    `Blocked${task ? ` on: ${task}` : ''}.`,
    summary ? `Reason: ${summary}` : '',
  ].filter(Boolean).join('\n');
}

function buildManagerNotice(event: TeamEventRouterInput): string {
  const agent = event.agentName || event.agentId;
  const task = compact(event.task, 260);
  const summary = compact(event.resultSummary || event.error || event.warning, 1200);
  const prefix = event.type === 'member_completed_task'
    ? `${agent} completed a task`
    : event.type === 'member_failed_task'
      ? `${agent} failed a task`
      : event.type === 'member_shared_artifact'
        ? `${agent} shared an artifact`
        : `${agent} is blocked`;
  return [
    prefix,
    task ? `Task: ${task}` : '',
    summary ? `Summary: ${summary}` : '',
    event.taskId ? `Task ID: ${event.taskId}` : '',
  ].filter(Boolean).join('\n');
}

function wakeLikelyUnblockedMembers(event: TeamEventRouterInput): string[] {
  if (event.type !== 'member_completed_task') return [];
  const team = getManagedTeam(event.teamId);
  if (!team?.roomState?.plan?.length) return [];
  const roomState = team.roomState;
  const candidates = roomState.plan
    .filter((item) =>
      item.ownerAgentId
      && item.ownerAgentId !== event.agentId
      && ['pending', 'active', 'blocked'].includes(String(item.status || ''))
    )
    .map((item) => String(item.ownerAgentId || '').trim())
    .filter(Boolean);
  const unique = Array.from(new Set(candidates)).slice(0, 3);
  const woken: string[] = [];
  for (const agentId of unique) {
    const state = roomState.memberStates?.[agentId];
    if (!isWakeableStatus(state?.status)) continue;
    const agent = getAgentById(agentId) as any;
    const fromName = event.agentName || event.agentId;
    const msg = [
      `[Team event] ${fromName} completed work that may unblock or affect your assigned plan item.`,
      event.task ? `Completed task: ${compact(event.task, 260)}` : '',
      event.resultSummary ? `Result summary: ${compact(event.resultSummary, 800)}` : '',
      `Review the room state, update your status, and say whether you are ready for follow-up work.`,
    ].filter(Boolean).join('\n');
    if (!queueAgentMessage(event.teamId, agentId, msg)) continue;
    scheduleTeamMemberAutoWake(event.teamId, agentId, {
      reason: `${fromName} completed related team work${agent?.name ? ` for ${agent.name}` : ''}.`,
      source: 'dispatch_followup',
    });
    woken.push(agentId);
  }
  return woken;
}

function hasActivePlanWorkForTeam(teamId: string): boolean {
  const team = getManagedTeam(teamId);
  const plan = Array.isArray(team?.roomState?.plan) ? team.roomState.plan : [];
  return plan.some((item) => ['pending', 'active', 'blocked'].includes(String(item?.status || '')));
}

function shouldWakeManager(event: TeamEventRouterInput, membersWoken: string[]): boolean {
  if (event.type === 'member_failed_task' || event.type === 'member_blocked') return true;
  if (event.type === 'member_shared_artifact') return true;
  if (event.warning || event.error) return true;
  if (membersWoken.length > 0) return true;
  if (event.type === 'member_completed_task' && hasActivePlanWorkForTeam(event.teamId)) return true;
  return false;
}

function buildAutoWakeReason(event: TeamEventRouterInput, membersWoken: string[]): string {
  const agent = event.agentName || event.agentId;
  const task = compact(event.task, 220);
  const summary = compact(event.resultSummary || event.error || event.warning, 700);
  const action = event.type === 'member_completed_task'
    ? 'completed work'
    : event.type === 'member_failed_task'
      ? 'failed or returned an incomplete result'
      : event.type === 'member_shared_artifact'
        ? 'shared a team artifact'
        : 'reported a blocker/context need';
  return [
    `${agent} ${action}.`,
    task ? `Task: ${task}` : '',
    summary ? `Summary: ${summary}` : '',
    membersWoken.length > 0 ? `Auto-woken teammates: ${membersWoken.join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

export function routeTeamEvent(event: TeamEventRouterInput): TeamEventRouterResult {
  const team = getManagedTeam(event.teamId);
  if (!team || !event.agentId) {
    return { managerQueued: false, membersWoken: [] };
  }

  const agent = getAgentById(event.agentId) as any;
  const agentName = String(event.agentName || agent?.name || event.agentId).trim();
  const category = event.type === 'member_completed_task' || event.type === 'member_shared_artifact'
    ? 'result'
    : 'blocker';
  const roomMessage = appendTeamRoomMessage(event.teamId, {
    actorType: 'member',
    actorName: agentName,
    actorId: event.agentId,
    content: buildRoomContent({ ...event, agentName }),
    category,
    target: 'all',
    metadata: {
      agentId: event.agentId,
      runId: event.taskId,
      dispatchId: event.dispatchId,
      runSuccess: event.type === 'member_completed_task' || event.type === 'member_shared_artifact',
      source: event.source || 'team_event_router',
    },
  }, { mirrorToChat: false });

  const shouldQueueManager =
    event.type !== 'member_completed_task'
    || Boolean(event.warning)
    || Boolean(event.error)
    || String(event.source || '').includes('background');

  let managerQueued = false;
  if (shouldQueueManager) {
    managerQueued = queueManagerMessage(event.teamId, event.agentId, buildManagerNotice({ ...event, agentName }));
  }

  const membersWoken = wakeLikelyUnblockedMembers({ ...event, agentName });
  if (shouldWakeManager({ ...event, agentName }, membersWoken)) {
    scheduleTeamManagerAutoWake(
      event.teamId,
      buildAutoWakeReason({ ...event, agentName }, membersWoken),
    );
  }

  return {
    roomMessageId: roomMessage?.id,
    managerQueued,
    membersWoken,
  };
}
