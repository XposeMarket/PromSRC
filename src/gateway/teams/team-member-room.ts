import fs from 'fs';
import path from 'path';
import { getAgentById, ensureAgentWorkspace, getConfig } from '../../config/config';
import { parseProviderModelRef, resolveConfiguredAgentModel } from '../../agents/model-routing.js';
import {
  appendTeamChat,
  appendTeamRoomMessage,
  buildTeamRoomSummary,
  drainAgentMessages,
  drainTeamDirectThreadUserMessages,
  getManagedTeam,
  getTeamRoomEventsSince,
  getTeamDirectThreadById,
  hasPendingAgentMessages,
  hasPendingTeamDirectThreadUserMessages,
  listPendingTeamDirectThreadsForParticipant,
  markTeamMemberRoomEventsSeen,
  touchTeamDirectThreadParticipantReply,
  updateTeamMemberState,
} from './managed-teams';
import { ensureTeamWorkspace, ensureTeamAgentIdentity, getTeamWorkspacePath } from './team-workspace';
import { finishLiveRuntime, registerLiveRuntime } from '../live-runtime-registry';
import { _activeAgentSessions, type RunAgentResult } from './team-dispatch-runtime';
import { runWithWorkspace } from '../../tools/workspace-context';
import { setActivatedToolCategories } from '../session';

type HandleChatFn = (
  message: string,
  sessionId: string,
  sendSSE: (event: string, data: any) => void,
  pinnedMessages?: Array<{ role: string; content: string }>,
  abortSignal?: { aborted: boolean },
  callerContext?: string,
  modelOverride?: string,
  executionMode?: 'interactive' | 'background_task' | 'heartbeat' | 'cron' | 'team_subagent',
  toolFilter?: string[],
  attachments?: undefined,
  reasoningOptions?: undefined,
  providerOverride?: string,
) => Promise<{ type: string; text: string; thinking?: string }>;

interface TeamMemberRoomDeps {
  handleChat: HandleChatFn;
  broadcastTeamEvent: (data: object) => void;
  buildTools: () => any[];
}

export interface TeamMemberRoomTurnOptions {
  abortSignal?: { aborted: boolean };
  autoWakeReason?: string;
  autoWakeSource?: 'teammate_message' | 'dispatch_followup' | 'room_followup' | 'manager_message';
  autoWakeChainDepth?: number;
}

type TeamMemberProcessEntry = {
  ts?: string;
  type?: string;
  content?: string;
  actor?: string;
  [key: string]: any;
};

interface TeamMemberTurnTracker {
  streamId: string;
  startedAt: number;
  stepCount: number;
  thinking: string;
  replyText: string;
  processEntries: TeamMemberProcessEntry[];
}

const TEAM_MEMBER_ROOM_SESSION_PREFIX = 'team_room_member_';
const TEAM_MEMBER_ROOM_SESSION_DELIM = '___AGENT___';
const TEAM_MEMBER_DIRECT_SESSION_PREFIX = 'team_dm_member_';
const TEAM_MEMBER_DIRECT_THREAD_DELIM = '___THREAD___';
const TEAM_MEMBER_AUTO_WAKE_DEBOUNCE_MS = 900;
const TEAM_MEMBER_AUTO_WAKE_FOLLOWUP_MS = 450;
const TEAM_MEMBER_AUTO_WAKE_MAX_CHAIN_DEPTH = 3;
const activeTeamMemberRoomSessions = new Set<string>();
const activeTeamMemberDirectTurns = new Set<string>();
const pendingTeamMemberWakeTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingTeamMemberDirectWakeTimers = new Map<string, ReturnType<typeof setTimeout>>();
let _teamMemberRoomDeps: TeamMemberRoomDeps | null = null;

export function setTeamMemberRoomDeps(deps: TeamMemberRoomDeps): void {
  _teamMemberRoomDeps = deps;
}

export function getTeamMemberRoomSessionId(teamId: string, agentId: string): string {
  return `${TEAM_MEMBER_ROOM_SESSION_PREFIX}${String(teamId || '').trim()}${TEAM_MEMBER_ROOM_SESSION_DELIM}${String(agentId || '').trim()}`;
}

export function parseTeamMemberRoomSessionId(sessionId: string): { teamId: string; agentId: string } | null {
  const sid = String(sessionId || '');
  if (!sid.startsWith(TEAM_MEMBER_ROOM_SESSION_PREFIX)) return null;
  const remainder = sid.slice(TEAM_MEMBER_ROOM_SESSION_PREFIX.length);
  const idx = remainder.indexOf(TEAM_MEMBER_ROOM_SESSION_DELIM);
  if (idx <= 0) return null;
  const teamId = remainder.slice(0, idx).trim();
  const agentId = remainder.slice(idx + TEAM_MEMBER_ROOM_SESSION_DELIM.length).trim();
  if (!teamId || !agentId) return null;
  return { teamId, agentId };
}

export function parseTeamMemberDirectSessionId(sessionId: string): { teamId: string; agentId: string; threadId: string } | null {
  const sid = String(sessionId || '');
  if (!sid.startsWith(TEAM_MEMBER_DIRECT_SESSION_PREFIX)) return null;
  const remainder = sid.slice(TEAM_MEMBER_DIRECT_SESSION_PREFIX.length);
  const agentDelim = TEAM_MEMBER_ROOM_SESSION_DELIM;
  const threadDelim = TEAM_MEMBER_DIRECT_THREAD_DELIM;
  const teamIdx = remainder.indexOf(agentDelim);
  if (teamIdx <= 0) return null;
  const threadIdx = remainder.indexOf(threadDelim, teamIdx + agentDelim.length);
  if (threadIdx <= teamIdx) return null;
  const teamId = remainder.slice(0, teamIdx).trim();
  const agentId = remainder.slice(teamIdx + agentDelim.length, threadIdx).trim();
  const threadId = remainder.slice(threadIdx + threadDelim.length).trim();
  if (!teamId || !agentId || !threadId) return null;
  return { teamId, agentId, threadId };
}

function getTeamMemberWakeKey(teamId: string, agentId: string): string {
  return `${String(teamId || '').trim()}::${String(agentId || '').trim()}`;
}

function getTeamMemberDirectWakeKey(teamId: string, agentId: string, threadId: string): string {
  return `${String(teamId || '').trim()}::${String(agentId || '').trim()}::${String(threadId || '').trim()}`;
}

function isTeamMemberDispatchActive(agentId: string): boolean {
  return Array.from(_activeAgentSessions).some((id) => String(id || '').startsWith(`team_dispatch_${agentId}_`));
}

function isTeamMemberConversationActive(teamId: string, agentId: string): boolean {
  return activeTeamMemberRoomSessions.has(getTeamMemberRoomSessionId(teamId, agentId))
    || activeTeamMemberDirectTurns.has(getTeamMemberWakeKey(teamId, agentId));
}

function clearPendingTeamMemberWake(teamId: string, agentId: string): void {
  const key = getTeamMemberWakeKey(teamId, agentId);
  const timer = pendingTeamMemberWakeTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    pendingTeamMemberWakeTimers.delete(key);
  }
}

function clearPendingTeamMemberDirectWake(teamId: string, agentId: string, threadId: string): void {
  const key = getTeamMemberDirectWakeKey(teamId, agentId, threadId);
  const timer = pendingTeamMemberDirectWakeTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    pendingTeamMemberDirectWakeTimers.delete(key);
  }
}

function buildAutoWakePrompt(reason?: string): string {
  const why = String(reason || '').trim();
  return [
    `[AUTO-WAKE: TEAM ROOM MESSAGE]`,
    `You have new teammate messages waiting in the team room.`,
    why ? `Wake reason: ${why}` : '',
    `Review your queued messages and the recent room context, then reply only if you have something useful to add.`,
    `Do not repeat readiness acknowledgements. Update your status only for a material change, blocker, or manager-needed state.`,
  ].filter(Boolean).join('\n');
}

function buildDirectWakePrompt(messages: Array<{ content?: string; createdAt?: number }>): string {
  const pending = Array.isArray(messages) ? messages : [];
  if (pending.length === 1) {
    return String(pending[0]?.content || '').trim();
  }
  return [
    `The team owner sent you multiple direct messages in the team chat.`,
    ...pending.map((entry, index) => `${index + 1}. ${String(entry?.content || '').trim()}`),
    ``,
    `Reply naturally and address the newest message while keeping the prior ones in mind.`,
  ].join('\n');
}

export function scheduleTeamMemberAutoWake(
  teamId: string,
  agentId: string,
  options: {
    reason?: string;
    delayMs?: number;
    chainDepth?: number;
    source?: 'teammate_message' | 'dispatch_followup' | 'room_followup' | 'manager_message';
  } = {},
): boolean {
  const team = getManagedTeam(teamId);
  if (!team) return false;
  if (team.manager?.paused === true) return false;
  if (!team.subagentIds.includes(agentId)) return false;
  if (team.agentPauseStates?.[agentId]?.paused === true) return false;
  if (!hasPendingAgentMessages(teamId, agentId)) {
    clearPendingTeamMemberWake(teamId, agentId);
    return false;
  }

  const sessionId = getTeamMemberRoomSessionId(teamId, agentId);
  if (activeTeamMemberRoomSessions.has(sessionId) || isTeamMemberConversationActive(teamId, agentId) || isTeamMemberDispatchActive(agentId)) {
    return false;
  }

  const chainDepth = Math.max(0, Math.floor(Number(options.chainDepth ?? 0)));
  if (chainDepth > TEAM_MEMBER_AUTO_WAKE_MAX_CHAIN_DEPTH) return false;
  const key = getTeamMemberWakeKey(teamId, agentId);
  if (pendingTeamMemberWakeTimers.has(key)) return true;
  const agentName = String(getAgentById(agentId)?.name || agentId).trim();
  const cleanReason = String(options.reason || '').trim();
  appendTeamRoomMessage(teamId, {
    actorType: 'system',
    actorName: 'Team Member Auto-Wake',
    actorId: agentId,
    content: `${agentName} wake scheduled${cleanReason ? `: ${cleanReason}` : '.'}`,
    category: 'status',
    target: agentId,
    metadata: {
      agentId,
      source: 'team_member_auto_wake_scheduled',
    },
  }, { mirrorToChat: false });

  const delayMs = Number.isFinite(Number(options.delayMs))
    ? Math.max(0, Math.floor(Number(options.delayMs)))
    : TEAM_MEMBER_AUTO_WAKE_DEBOUNCE_MS;
  const timer = setTimeout(() => {
    pendingTeamMemberWakeTimers.delete(key);
    if (!hasPendingAgentMessages(teamId, agentId)) return;
    if (activeTeamMemberRoomSessions.has(sessionId) || isTeamMemberConversationActive(teamId, agentId) || isTeamMemberDispatchActive(agentId)) return;
    void runTeamMemberRoomTurn(
      teamId,
      agentId,
      buildAutoWakePrompt(options.reason),
      {
        autoWakeReason: options.reason,
        autoWakeSource: options.source || 'teammate_message',
        autoWakeChainDepth: chainDepth,
      },
    ).catch(() => {});
  }, delayMs);
  pendingTeamMemberWakeTimers.set(key, timer);
  return true;
}

export function scheduleTeamMemberDirectWake(
  teamId: string,
  agentId: string,
  threadId: string,
  options: {
    reason?: string;
    delayMs?: number;
    chainDepth?: number;
  } = {},
): boolean {
  const thread = getTeamDirectThreadById(teamId, threadId);
  if (!thread) return false;
  const team = getManagedTeam(teamId);
  if (!team) return false;
  if (team.manager?.paused === true) return false;
  if (!team.subagentIds.includes(agentId)) return false;
  if (team.agentPauseStates?.[agentId]?.paused === true) return false;
  if (!hasPendingTeamDirectThreadUserMessages(teamId, threadId)) {
    clearPendingTeamMemberDirectWake(teamId, agentId, threadId);
    return false;
  }
  if (isTeamMemberConversationActive(teamId, agentId) || isTeamMemberDispatchActive(agentId)) {
    return false;
  }
  const chainDepth = Math.max(0, Math.floor(Number(options.chainDepth ?? 0)));
  if (chainDepth > TEAM_MEMBER_AUTO_WAKE_MAX_CHAIN_DEPTH) return false;
  const key = getTeamMemberDirectWakeKey(teamId, agentId, threadId);
  if (pendingTeamMemberDirectWakeTimers.has(key)) return true;
  const delayMs = Number.isFinite(Number(options.delayMs))
    ? Math.max(0, Math.floor(Number(options.delayMs)))
    : TEAM_MEMBER_AUTO_WAKE_DEBOUNCE_MS;
  const timer = setTimeout(() => {
    pendingTeamMemberDirectWakeTimers.delete(key);
    if (!hasPendingTeamDirectThreadUserMessages(teamId, threadId)) return;
    if (isTeamMemberConversationActive(teamId, agentId) || isTeamMemberDispatchActive(agentId)) return;
    void runTeamMemberDirectTurn(teamId, agentId, threadId, {
      autoWakeReason: options.reason,
      autoWakeChainDepth: chainDepth,
    }).catch(() => {});
  }, delayMs);
  pendingTeamMemberDirectWakeTimers.set(key, timer);
  return true;
}

function createTeamMemberTurnTracker(teamId: string, agentId: string): TeamMemberTurnTracker {
  return {
    streamId: `team_member_${teamId}_${agentId}_${Date.now()}`,
    startedAt: Date.now(),
    stepCount: 0,
    thinking: '',
    replyText: '',
    processEntries: [],
  };
}

function pushTeamMemberProcessEntry(
  tracker: TeamMemberTurnTracker,
  type: string,
  content: string,
  extra: Record<string, any> = {},
): void {
  const text = String(content || '').trim();
  if (!text) return;
  tracker.processEntries.push({
    ts: new Date().toLocaleTimeString(),
    type,
    content: text,
    ...extra,
  });
  if (tracker.processEntries.length > 250) {
    tracker.processEntries.splice(0, tracker.processEntries.length - 250);
  }
}

function safeTeamMemberPreview(value: any, max = 400): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.slice(0, max);
  try {
    return JSON.stringify(value).slice(0, max);
  } catch {
    return String(value).slice(0, max);
  }
}

function captureTeamMemberStreamEvent(
  tracker: TeamMemberTurnTracker,
  event: string,
  data: any,
): void {
  if (event === 'token') {
    const chunk = String(data?.text || '');
    if (chunk) tracker.replyText = `${tracker.replyText}${chunk}`;
    return;
  }
  if (event === 'thinking_delta') {
    const chunk = String(data?.thinking || data?.text || '');
    if (chunk) tracker.thinking = `${tracker.thinking}${chunk}`;
    return;
  }
  if (event === 'thinking' || event === 'agent_thought') {
    const thought = String(data?.thinking || data?.text || '').trim();
    if (!thought) return;
    tracker.thinking = tracker.thinking ? `${tracker.thinking}\n\n${thought}` : thought;
    pushTeamMemberProcessEntry(tracker, 'think', thought, data?.actor ? { actor: data.actor } : {});
    return;
  }
  if (event === 'info') {
    const info = String(data?.message || '').trim();
    if (!info) return;
    pushTeamMemberProcessEntry(tracker, 'info', info, data?.actor ? { actor: data.actor } : {});
    return;
  }
  if (event === 'progress_state') {
    const items = Array.isArray(data?.items) ? data.items : [];
    const activeIndex = Number(data?.activeIndex ?? -1);
    const activeItem = activeIndex >= 0 ? items[activeIndex] : null;
    const activeText = String(activeItem?.text || '').trim();
    if (activeText) pushTeamMemberProcessEntry(tracker, 'info', activeText);
    return;
  }
  if (event === 'tool_call') {
    tracker.stepCount += 1;
    const toolName = String(data?.action || data?.tool || data?.name || '?').trim() || '?';
    const argsPreview = safeTeamMemberPreview(data?.args || data?.input || {}, 220);
    pushTeamMemberProcessEntry(
      tracker,
      'tool',
      `${toolName}${argsPreview ? ` ${argsPreview}` : ''}`,
      (data?.args && typeof data.args === 'object')
        ? { args: data.args, ...(data?.actor ? { actor: data.actor } : {}) }
        : (data?.actor ? { actor: data.actor } : {}),
    );
    return;
  }
  if (event === 'tool_result') {
    const toolName = String(data?.action || data?.tool || data?.name || '?').trim() || '?';
    const resultText = safeTeamMemberPreview(data?.result ?? data?.output ?? data?.content ?? '', 500);
    pushTeamMemberProcessEntry(
      tracker,
      data?.error === true ? 'error' : 'result',
      `${toolName} => ${resultText || '(no output)'}`,
      data?.actor ? { actor: data.actor } : {},
    );
    return;
  }
  if (event === 'tool_progress') {
    const toolName = String(data?.action || data?.tool || data?.name || '?').trim() || '?';
    const progressMsg = String(data?.message || '').trim();
    if (!progressMsg) return;
    pushTeamMemberProcessEntry(tracker, 'info', `${toolName}: ${progressMsg}`, data?.actor ? { actor: data.actor } : {});
  }
}

function buildTeamMemberTurnMetadata(
  tracker: TeamMemberTurnTracker,
  agentId: string,
  finalText: string,
): {
  runId?: string;
  agentId?: string;
  runSuccess?: boolean;
  stepCount?: number;
  durationMs?: number;
  thinking?: string;
  processEntries?: TeamMemberProcessEntry[];
} {
  const reply = String(finalText || tracker.replyText || '').trim();
  const processEntries = Array.isArray(tracker.processEntries) ? [...tracker.processEntries] : [];
  if (reply && !processEntries.some((entry) => entry?.type === 'final' && String(entry?.content || '').trim() === reply)) {
    processEntries.push({
      ts: new Date().toLocaleTimeString(),
      type: 'final',
      content: reply,
    });
  }
  return {
    runId: tracker.streamId,
    agentId,
    runSuccess: true,
    stepCount: tracker.stepCount || undefined,
    durationMs: Math.max(0, Date.now() - tracker.startedAt),
    thinking: String(tracker.thinking || '').trim() || undefined,
    processEntries: processEntries.length > 0 ? processEntries : undefined,
  };
}

function parseProviderModel(raw: string): { providerOverride?: string; modelOverride?: string } {
  const v = String(raw || '').trim();
  if (!v) return {};
  const parsed = parseProviderModelRef(v);
  if (parsed) {
    return { providerOverride: parsed.providerId, modelOverride: parsed.model };
  }
  return { modelOverride: v };
}

function resolveTeamMemberModelRouting(agentId: string): { providerOverride?: string; modelOverride?: string } {
  const agent = getAgentById(agentId);
  const cfg = getConfig().getConfig() as any;
  const resolved = resolveConfiguredAgentModel(cfg, agent, {
    agentType: 'team_subagent',
    isTeamMember: true,
    fallbackToPrimary: true,
  });
  return parseProviderModel(resolved.model);
}

function normalizePathForCompare(p: string): string {
  const resolved = path.resolve(String(p || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function resolveTeamMemberAllowedWorkPaths(agentId: string, teamId: string): string[] {
  void agentId;
  const team = getManagedTeam(teamId) as any;
  const mainWorkspace = getConfig().getWorkspacePath();
  const teamWorkspace = getTeamWorkspacePath(teamId);
  const rawValues = [
    ...(Array.isArray(team?.allowedWorkPaths) ? team.allowedWorkPaths : []),
    ...(Array.isArray(team?.allowed_work_paths) ? team.allowed_work_paths : []),
  ];
  const roots = [mainWorkspace, teamWorkspace];
  for (const raw of rawValues) {
    const value = String(raw || '').trim();
    if (!value) continue;
    roots.push(path.isAbsolute(value) ? value : path.join(mainWorkspace, value));
  }
  const seen = new Set<string>();
  return roots.map((p) => path.resolve(p)).filter((resolved) => {
    const key = normalizePathForCompare(resolved);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildTeamMemberToolFilter(
  deps: TeamMemberRoomDeps,
  mode: 'room' | 'direct' = 'room',
): string[] | undefined {
  void deps;
  void mode;
  return undefined;
}

function readTeamMemberRoleBlock(teamId: string, agentId: string, agentName: string): string {
  const agent = getAgentById(agentId) as any;
  if (!agent) return '';
  try {
    const globalWorkspace = String(agent?.workspace || ensureAgentWorkspace(agent) || '').trim();
    const identityWorkspace = ensureTeamAgentIdentity(teamId, agentId, globalWorkspace || undefined);
    const promptFile = [path.join(identityWorkspace, 'system_prompt.md'), path.join(identityWorkspace, 'HEARTBEAT.md')]
      .find((filePath) => fs.existsSync(filePath));
    if (!promptFile) return '';
    const raw = String(fs.readFileSync(promptFile, 'utf-8') || '').trim();
    if (!raw) return '';
    return `[YOUR ROLE ON THIS TEAM — ${agentName}]\n${raw}`;
  } catch {
    return '';
  }
}

function buildTeamMemberCallerContext(teamId: string, agentId: string, prompt: string): string {
  const team = getManagedTeam(teamId);
  const agent = getAgentById(agentId) as any;
  const agentName = String(agent?.name || agentId).trim();
  const workspacePath = getTeamWorkspacePath(teamId);
  const allowedWorkPaths = resolveTeamMemberAllowedWorkPaths(agentId, teamId);
  const roomSummary = team ? buildTeamRoomSummary(team, {
    agentId,
    limitMessages: 18,
    includePlan: true,
    includeArtifacts: true,
  }) : '';
  const memberState = team?.roomState?.memberStates?.[agentId];
  const roomEventDeltas = team
    ? getTeamRoomEventsSince(teamId, Number(memberState?.lastRoomEventSeenAt || memberState?.lastUpdateAt || 0), { agentId, limit: 12 })
    : [];
  const roomDeltaBlock = roomEventDeltas.length > 0
    ? [
        `[ROOM EVENTS SINCE YOUR LAST TURN]`,
        ...roomEventDeltas.map((event, index) => {
          const actor = String(event.actorName || event.actorId || event.actorType || 'system').trim();
          const target = event.target ? ` -> ${event.target}` : '';
          const source = event.metadata?.source ? ` [${event.metadata.source}]` : '';
          return `${index + 1}. ${actor}${target}${source}: ${String(event.content || '').replace(/\s+/g, ' ').slice(0, 400)}`;
        }),
      ].join('\n')
    : '';
  if (roomEventDeltas.length > 0) {
    markTeamMemberRoomEventsSeen(teamId, agentId);
  }
  const pendingMessages = drainAgentMessages(teamId, agentId);
  const roleBlock = readTeamMemberRoleBlock(teamId, agentId, agentName);

  return [
    `[TEAM ROOM MEMBER TURN — ${team?.name || teamId} | ${agentName}]`,
    `You are participating in the shared team room, not running an execution dispatch.`,
    `Use this turn to discuss the plan, answer teammates, propose next steps, ask for missing context, and say clearly when you're ready to be dispatched.`,
    `Do not turn this into a long autonomous execution run unless the request explicitly asks for a quick concrete check.`,
    '',
    `[CURRENT REQUEST]`,
    String(prompt || '').trim() || '(No specific prompt provided.)',
    '',
    workspacePath
      ? [
          `[TEAM WORKSPACE]`,
          workspacePath,
          `Use this shared workspace if you need to inspect files or verify something for the team.`,
          `Allowed work paths:`,
          ...allowedWorkPaths.map((p) => `  - ${p}`),
        ].join('\n')
      : '',
    roleBlock ? `\n${roleBlock}` : '',
    roomSummary ? `\n${roomSummary}` : '',
    roomDeltaBlock ? `\n${roomDeltaBlock}` : '',
    pendingMessages.length > 0
      ? `\n[MESSAGES FOR YOU]\n${pendingMessages.map((message, index) => `${index + 1}. ${message}`).join('\n')}`
      : '',
    `[ROOM COLLABORATION RULES]`,
    `- Use talk_to_teammate to coordinate with other members or the manager.`,
    `- Use request_context or request_manager_help when you need manager input, a decision, or another teammate assigned.`,
    `- Your final reply is automatically posted to the team room. Do not also call post_to_team_chat for the same message.`,
    `- Use update_my_status only when your state materially changed or you are blocked/waiting for context; do not call it just to say hello or repeat that you are ready.`,
    `- Use update_team_goal if you want to propose or refine plan items.`,
    `- Use share_artifact when you create or discover something the whole team should be able to reuse.`,
    `- If you are ready for execution, say exactly what you're ready to do. Update your status only if it was previously blocked, waiting, or stale.`,
    `- If you need something from the manager, ask plainly and update your status to waiting_for_context or blocked.`,
  ].filter(Boolean).join('\n');
}

function buildTeamMemberDirectCallerContext(teamId: string, agentId: string, threadId: string): string {
  const team = getManagedTeam(teamId);
  const agent = getAgentById(agentId) as any;
  const agentName = String(agent?.name || agentId).trim();
  const workspacePath = getTeamWorkspacePath(teamId);
  const allowedWorkPaths = resolveTeamMemberAllowedWorkPaths(agentId, teamId);
  const roleBlock = readTeamMemberRoleBlock(teamId, agentId, agentName);
  const roomSummary = team ? buildTeamRoomSummary(team, {
    agentId,
    limitMessages: 12,
    includePlan: true,
    includeArtifacts: true,
  }) : '';
  const memberState = team?.roomState?.memberStates?.[agentId];
  const roomEventDeltas = team
    ? getTeamRoomEventsSince(teamId, Number(memberState?.lastRoomEventSeenAt || memberState?.lastUpdateAt || 0), { agentId, limit: 8 })
    : [];
  const roomDeltaBlock = roomEventDeltas.length > 0
    ? [
        `[ROOM EVENTS SINCE YOUR LAST TURN]`,
        ...roomEventDeltas.map((event, index) => {
          const actor = String(event.actorName || event.actorId || event.actorType || 'system').trim();
          const target = event.target ? ` -> ${event.target}` : '';
          const source = event.metadata?.source ? ` [${event.metadata.source}]` : '';
          return `${index + 1}. ${actor}${target}${source}: ${String(event.content || '').replace(/\s+/g, ' ').slice(0, 360)}`;
        }),
      ].join('\n')
    : '';
  if (roomEventDeltas.length > 0) {
    markTeamMemberRoomEventsSeen(teamId, agentId);
  }
  const threadMessages = Array.isArray(team?.teamChat)
    ? team.teamChat
        .filter((message: any) => String(message?.threadId || '').trim() === String(threadId || '').trim())
        .slice(-12)
    : [];
  const directThreadContext = threadMessages.length > 0
    ? [
        `[DIRECT CHAT HISTORY WITH TEAM OWNER]`,
        ...threadMessages.map((message: any) => {
          const fromName = String(message?.fromName || (message?.from === 'user' ? 'You' : agentName)).trim() || agentName;
          return `- ${fromName}: ${String(message?.content || '').trim().slice(0, 600)}`;
        }),
      ].join('\n')
    : '';
  return [
    `[DIRECT TEAM CHAT — ${team?.name || teamId} | ${agentName}]`,
    `You are speaking directly with the team owner in a side conversation inside the team chat.`,
    `Reply naturally and conversationally. Continue the existing conversation instead of treating each message like a brand-new wake-up task.`,
    `Do not narrate your internal tool use. Do not post separate status messages unless the user explicitly asks for a status update.`,
    `Only use post_to_team_chat if the user explicitly wants you to tell the whole room something.`,
    '',
    workspacePath
      ? [
          `[TEAM WORKSPACE]`,
          workspacePath,
          `Use the shared workspace if you need to quickly inspect or verify something for this direct conversation.`,
          `Allowed work paths:`,
          ...allowedWorkPaths.map((p) => `  - ${p}`),
        ].join('\n')
      : '',
    roleBlock ? `\n${roleBlock}` : '',
    directThreadContext ? `\n${directThreadContext}` : '',
    roomSummary ? `\n${roomSummary}` : '',
    roomDeltaBlock ? `\n${roomDeltaBlock}` : '',
  ].filter(Boolean).join('\n');
}

function broadcastTeamMemberStreamStart(
  deps: TeamMemberRoomDeps,
  team: any,
  tracker: TeamMemberTurnTracker,
  agentId: string,
  agentName: string,
): void {
  deps.broadcastTeamEvent({
    type: 'team_member_stream_start',
    teamId: team.id,
    teamName: team.name,
    streamId: tracker.streamId,
    agentId,
    agentName,
    startedAt: tracker.startedAt,
  });
}

function broadcastTeamMemberStreamEvent(
  deps: TeamMemberRoomDeps,
  team: any,
  tracker: TeamMemberTurnTracker,
  agentId: string,
  agentName: string,
  eventType: string,
  data: any,
): void {
  deps.broadcastTeamEvent({
    type: 'team_member_stream_event',
    teamId: team.id,
    teamName: team.name,
    streamId: tracker.streamId,
    agentId,
    agentName,
    eventType,
    data,
  });
}

function broadcastTeamMemberStreamDone(
  deps: TeamMemberRoomDeps,
  team: any,
  tracker: TeamMemberTurnTracker,
  agentId: string,
  agentName: string,
  success: boolean,
): void {
  deps.broadcastTeamEvent({
    type: 'team_member_stream_done',
    teamId: team.id,
    teamName: team.name,
    streamId: tracker.streamId,
    agentId,
    agentName,
    success,
    durationMs: Math.max(0, Date.now() - tracker.startedAt),
    completedAt: Date.now(),
  });
}

export async function runTeamMemberRoomTurn(
  teamId: string,
  agentId: string,
  prompt: string,
  options: TeamMemberRoomTurnOptions = {},
): Promise<RunAgentResult> {
  const deps = _teamMemberRoomDeps;
  if (!deps) {
    return { success: false, result: '', error: 'Team member room deps not initialized', durationMs: 0, agentName: agentId };
  }

  const team = getManagedTeam(teamId);
  if (!team) {
    return { success: false, result: '', error: `Team not found: ${teamId}`, durationMs: 0, agentName: agentId };
  }
  if (team.manager?.paused === true) {
    return { success: false, result: '', error: `Team "${team.name}" is paused.`, durationMs: 0, agentName: agentId };
  }
  if (!team.subagentIds.includes(agentId)) {
    return { success: false, result: '', error: `Agent "${agentId}" is not a member of team "${team.name}".`, durationMs: 0, agentName: agentId };
  }
  if (team.agentPauseStates?.[agentId]?.paused === true) {
    return { success: false, result: '', error: `Agent "${agentId}" is paused on team "${team.name}".`, durationMs: 0, agentName: agentId };
  }

  const agent = getAgentById(agentId) as any;
  const agentName = String(agent?.name || agentId).trim();
  const sessionId = getTeamMemberRoomSessionId(teamId, agentId);
  const startedAt = Date.now();
  if (isTeamMemberConversationActive(teamId, agentId)) {
    return { success: false, result: '', error: `${agentName} already has a live room turn in progress.`, durationMs: 0, agentName };
  }
  if (isTeamMemberDispatchActive(agentId)) {
    return { success: false, result: '', error: `${agentName} is currently dispatched on an execution task.`, durationMs: 0, agentName };
  }

  try {
    ensureTeamWorkspace(teamId);
  } catch { /* best effort */ }

  const callerContext = buildTeamMemberCallerContext(teamId, agentId, prompt);
  const tracker = createTeamMemberTurnTracker(teamId, agentId);
  const toolFilter = buildTeamMemberToolFilter(deps, 'room');
  const agentRouting = resolveTeamMemberModelRouting(agentId);
  const abortSignal = options.abortSignal || { aborted: false };
  const autoWakeReason = String(options.autoWakeReason || '').trim();
  const autoWakeSource = options.autoWakeSource || 'teammate_message';
  const autoWakeChainDepth = Math.max(0, Math.floor(Number(options.autoWakeChainDepth ?? 0)));
  const currentTaskLabel = autoWakeReason
    ? 'Responding to new team-room messages'
    : String(prompt || '').trim().slice(0, 500);
  const runtimeId = registerLiveRuntime({
    kind: 'team_member',
    label: `Team room member - ${agentName}`,
    sessionId,
    teamId,
    agentId,
    source: 'system',
    detail: String(prompt || '').slice(0, 160),
    abortSignal,
  });
  const memberStateBefore = getManagedTeam(teamId)?.roomState?.memberStates?.[agentId];

  activeTeamMemberRoomSessions.add(sessionId);
  try {
	    try {
	      const { setWorkspace } = require('../session');
	      setWorkspace(sessionId, getTeamWorkspacePath(teamId));
	    } catch { /* non-fatal */ }

    updateTeamMemberState(teamId, agentId, {
      status: 'planning',
      currentTask: currentTaskLabel || undefined,
      blockedReason: undefined,
    });

    broadcastTeamMemberStreamStart(deps, team, tracker, agentId, agentName);
    if (autoWakeReason) {
      const autoWakeMessage = `Auto-woken by ${autoWakeSource.replace(/_/g, ' ')}: ${autoWakeReason}`;
      pushTeamMemberProcessEntry(tracker, 'info', autoWakeMessage, { actor: 'system' });
      broadcastTeamMemberStreamEvent(deps, team, tracker, agentId, agentName, 'info', {
        message: autoWakeMessage,
        actor: 'system',
      });
    }
    const trackingSse = (event: string, data: any) => {
      captureTeamMemberStreamEvent(tracker, event, data);
      broadcastTeamMemberStreamEvent(deps, team, tracker, agentId, agentName, event, data);
    };

    // Reset activated tool categories so this subagent turn matches main-chat
    // behavior: autoActivateToolCategories repopulates from the message content.
    // Without this, sessions keep ALL categories activated from prior runs and
    // ship 270+ tools to Anthropic — which trips the OAuth subscription gate.
    try { setActivatedToolCategories(sessionId, []); } catch {}

    const result = await runWithWorkspace(
      getTeamWorkspacePath(teamId),
      () => deps.handleChat(
      String(prompt || '').trim(),
      sessionId,
      trackingSse,
      undefined,
      abortSignal,
      callerContext,
      agentRouting.modelOverride,
      'team_subagent',
      toolFilter,
      undefined,
      undefined,
      agentRouting.providerOverride,
      ),
      resolveTeamMemberAllowedWorkPaths(agentId, teamId),
    );

    const responseText = String(result.text || '').trim() || `${agentName} is ready for the next step.`;
    const resultThinking = String(result.thinking || '').trim();
    if (resultThinking) {
      tracker.thinking = tracker.thinking ? `${tracker.thinking}\n\n${resultThinking}` : resultThinking;
    }
    if (responseText) {
      tracker.replyText = responseText;
      pushTeamMemberProcessEntry(tracker, 'final', responseText);
      broadcastTeamMemberStreamEvent(deps, team, tracker, agentId, agentName, 'final', { text: responseText });
      const chatMsg = appendTeamChat(teamId, {
        from: 'subagent',
        fromName: agentName,
        fromAgentId: agentId,
        content: responseText,
        metadata: buildTeamMemberTurnMetadata(tracker, agentId, responseText),
      });
      deps.broadcastTeamEvent({
        type: 'team_chat_message',
        teamId,
        teamName: team.name,
        chatMessage: chatMsg,
        text: String(chatMsg?.content || ''),
      });
    }

    const latestState = getManagedTeam(teamId)?.roomState?.memberStates?.[agentId];
    const explicitStatusUpdate = Number(latestState?.lastUpdateAt || 0) > Math.max(Number(memberStateBefore?.lastUpdateAt || 0), startedAt);
    if (!explicitStatusUpdate || latestState?.status === 'planning') {
      updateTeamMemberState(teamId, agentId, {
        status: 'ready',
        currentTask: '',
        blockedReason: undefined,
        lastResult: responseText.slice(0, 1000) || undefined,
      });
    }

    broadcastTeamMemberStreamEvent(deps, team, tracker, agentId, agentName, 'done', {
      reply: responseText,
      thinking: resultThinking,
    });
    broadcastTeamMemberStreamDone(deps, team, tracker, agentId, agentName, true);
    return {
      success: true,
      result: responseText,
      thinking: tracker.thinking.trim() || undefined,
      processEntries: tracker.processEntries.length > 0 ? [...tracker.processEntries] : undefined,
      durationMs: Math.max(0, Date.now() - startedAt),
      stepCount: tracker.stepCount,
      agentName,
      taskId: tracker.streamId,
    };
  } catch (err: any) {
    const errorText = String(err?.message || err || 'Unknown room turn error').trim();
    pushTeamMemberProcessEntry(tracker, 'error', errorText);
    const chatMsg = appendTeamChat(teamId, {
      from: 'subagent',
      fromName: agentName,
      fromAgentId: agentId,
      content: `Room turn failed: ${errorText}`,
      metadata: {
        ...buildTeamMemberTurnMetadata(tracker, agentId, `Room turn failed: ${errorText}`),
        runSuccess: false,
      },
    });
    deps.broadcastTeamEvent({
      type: 'team_chat_message',
      teamId,
      teamName: team.name,
      chatMessage: chatMsg,
      text: String(chatMsg?.content || ''),
    });
	    updateTeamMemberState(teamId, agentId, {
	      status: 'blocked',
	      currentTask: currentTaskLabel || undefined,
	      blockedReason: errorText.slice(0, 500),
	      lastResult: errorText.slice(0, 1000),
	    });
    broadcastTeamMemberStreamDone(deps, team, tracker, agentId, agentName, false);
    return {
      success: false,
      result: '',
      error: errorText,
      thinking: tracker.thinking.trim() || undefined,
      processEntries: tracker.processEntries.length > 0 ? [...tracker.processEntries] : undefined,
      durationMs: Math.max(0, Date.now() - startedAt),
      stepCount: tracker.stepCount,
      agentName,
      taskId: tracker.streamId,
    };
  } finally {
    activeTeamMemberRoomSessions.delete(sessionId);
    const pendingDirectThreads = listPendingTeamDirectThreadsForParticipant(teamId, 'member', agentId);
    for (const thread of pendingDirectThreads) {
      scheduleTeamMemberDirectWake(teamId, agentId, thread.id, {
        reason: 'The team owner sent you a new direct follow-up while you were busy in the room.',
        delayMs: TEAM_MEMBER_AUTO_WAKE_FOLLOWUP_MS,
      });
    }
    if (hasPendingAgentMessages(teamId, agentId) && autoWakeChainDepth < TEAM_MEMBER_AUTO_WAKE_MAX_CHAIN_DEPTH) {
      scheduleTeamMemberAutoWake(teamId, agentId, {
        reason: 'New teammate messages arrived while you were already responding in the room.',
        delayMs: TEAM_MEMBER_AUTO_WAKE_FOLLOWUP_MS,
        chainDepth: autoWakeChainDepth + 1,
        source: 'room_followup',
      });
    } else if (!hasPendingAgentMessages(teamId, agentId)) {
      clearPendingTeamMemberWake(teamId, agentId);
    }
    finishLiveRuntime(runtimeId);
  }
}

export async function runTeamMemberDirectTurn(
  teamId: string,
  agentId: string,
  threadId: string,
  options: TeamMemberRoomTurnOptions = {},
): Promise<RunAgentResult> {
  const deps = _teamMemberRoomDeps;
  if (!deps) {
    return { success: false, result: '', error: 'Team member room deps not initialized', durationMs: 0, agentName: agentId };
  }
  const team = getManagedTeam(teamId);
  if (!team) {
    return { success: false, result: '', error: `Team not found: ${teamId}`, durationMs: 0, agentName: agentId };
  }
  if (team.manager?.paused === true) {
    return { success: false, result: '', error: `Team "${team.name}" is paused.`, durationMs: 0, agentName: agentId };
  }
  if (!team.subagentIds.includes(agentId)) {
    return { success: false, result: '', error: `Agent "${agentId}" is not a member of team "${team.name}".`, durationMs: 0, agentName: agentId };
  }
  if (team.agentPauseStates?.[agentId]?.paused === true) {
    return { success: false, result: '', error: `Agent "${agentId}" is paused on team "${team.name}".`, durationMs: 0, agentName: agentId };
  }

  const thread = getTeamDirectThreadById(teamId, threadId);
  if (!thread || thread.participantType !== 'member' || String(thread.participantId || '').trim() !== String(agentId || '').trim()) {
    return { success: false, result: '', error: 'Direct thread not found for this member.', durationMs: 0, agentName: agentId };
  }
  const agent = getAgentById(agentId) as any;
  const agentName = String(agent?.name || agentId).trim();
  const conversationKey = getTeamMemberWakeKey(teamId, agentId);
  if (isTeamMemberConversationActive(teamId, agentId)) {
    return { success: false, result: '', error: `${agentName} already has a live conversation in progress.`, durationMs: 0, agentName };
  }
  if (isTeamMemberDispatchActive(agentId)) {
    return { success: false, result: '', error: `${agentName} is currently dispatched on an execution task.`, durationMs: 0, agentName };
  }

  const pendingMessages = drainTeamDirectThreadUserMessages(teamId, threadId);
  if (pendingMessages.length === 0) {
    return { success: true, result: '', durationMs: 0, agentName };
  }

  try {
    ensureTeamWorkspace(teamId);
  } catch { /* best effort */ }

  const prompt = buildDirectWakePrompt(pendingMessages);
  const callerContext = buildTeamMemberDirectCallerContext(teamId, agentId, threadId);
  const tracker = createTeamMemberTurnTracker(teamId, agentId);
  const toolFilter = buildTeamMemberToolFilter(deps, 'direct');
  const agentRouting = resolveTeamMemberModelRouting(agentId);
  const abortSignal = options.abortSignal || { aborted: false };
  const autoWakeReason = String(options.autoWakeReason || '').trim();
  const autoWakeChainDepth = Math.max(0, Math.floor(Number(options.autoWakeChainDepth ?? 0)));
  const currentTaskLabel = `Direct team chat with team owner`;
  const runtimeId = registerLiveRuntime({
    kind: 'team_member',
    label: `Team direct chat - ${agentName}`,
    sessionId: thread.sessionId,
    teamId,
    agentId,
    source: 'system',
    detail: String(prompt || '').slice(0, 160),
    abortSignal,
  });
  const memberStateBefore = getManagedTeam(teamId)?.roomState?.memberStates?.[agentId];

  activeTeamMemberDirectTurns.add(conversationKey);
  try {
	    try {
	      const { setWorkspace } = require('../session');
	      setWorkspace(thread.sessionId, getTeamWorkspacePath(teamId));
	    } catch { /* non-fatal */ }

    updateTeamMemberState(teamId, agentId, {
      status: 'planning',
      currentTask: currentTaskLabel,
      blockedReason: undefined,
    });

    broadcastTeamMemberStreamStart(deps, team, tracker, agentId, agentName);
    if (autoWakeReason) {
      const autoWakeMessage = `Direct follow-up: ${autoWakeReason}`;
      pushTeamMemberProcessEntry(tracker, 'info', autoWakeMessage, { actor: 'system' });
      broadcastTeamMemberStreamEvent(deps, team, tracker, agentId, agentName, 'info', {
        message: autoWakeMessage,
        actor: 'system',
      });
    }

    const trackingSse = (event: string, data: any) => {
      captureTeamMemberStreamEvent(tracker, event, data);
      broadcastTeamMemberStreamEvent(deps, team, tracker, agentId, agentName, event, data);
    };

    try { setActivatedToolCategories(thread.sessionId, []); } catch {}

    const result = await runWithWorkspace(
      getTeamWorkspacePath(teamId),
      () => deps.handleChat(
      prompt,
      thread.sessionId,
      trackingSse,
      undefined,
      abortSignal,
      callerContext,
      agentRouting.modelOverride,
      'team_subagent',
      toolFilter,
      undefined,
      undefined,
      agentRouting.providerOverride,
      ),
      resolveTeamMemberAllowedWorkPaths(agentId, teamId),
    );

    const responseText = String(result.text || '').trim() || `${agentName} is here and ready to help.`;
    const resultThinking = String(result.thinking || '').trim();
    if (resultThinking) {
      tracker.thinking = tracker.thinking ? `${tracker.thinking}\n\n${resultThinking}` : resultThinking;
    }
    tracker.replyText = responseText;
    pushTeamMemberProcessEntry(tracker, 'final', responseText);
    broadcastTeamMemberStreamEvent(deps, team, tracker, agentId, agentName, 'final', { text: responseText });
    const chatMsg = appendTeamChat(teamId, {
      from: 'subagent',
      fromName: agentName,
      fromAgentId: agentId,
      content: responseText,
      threadId,
      metadata: {
        ...buildTeamMemberTurnMetadata(tracker, agentId, responseText),
        targetType: 'user',
        targetId: 'user',
        targetLabel: 'You',
      },
    });
    deps.broadcastTeamEvent({
      type: 'team_chat_message',
      teamId,
      teamName: team.name,
      chatMessage: chatMsg,
      text: String(chatMsg?.content || ''),
    });
    touchTeamDirectThreadParticipantReply(teamId, threadId);

    const latestState = getManagedTeam(teamId)?.roomState?.memberStates?.[agentId];
    const explicitStatusUpdate = Number(latestState?.lastUpdateAt || 0) > Math.max(Number(memberStateBefore?.lastUpdateAt || 0), tracker.startedAt);
    if (!explicitStatusUpdate || latestState?.status === 'planning') {
      updateTeamMemberState(teamId, agentId, {
        status: 'ready',
        currentTask: '',
        blockedReason: undefined,
        lastResult: responseText.slice(0, 1000) || undefined,
      });
    }

    broadcastTeamMemberStreamEvent(deps, team, tracker, agentId, agentName, 'done', {
      reply: responseText,
      thinking: resultThinking,
    });
    broadcastTeamMemberStreamDone(deps, team, tracker, agentId, agentName, true);
    return {
      success: true,
      result: responseText,
      thinking: tracker.thinking.trim() || undefined,
      processEntries: tracker.processEntries.length > 0 ? [...tracker.processEntries] : undefined,
      durationMs: Math.max(0, Date.now() - tracker.startedAt),
      stepCount: tracker.stepCount,
      agentName,
      taskId: tracker.streamId,
    };
  } catch (err: any) {
    const errorText = String(err?.message || err || 'Unknown direct chat error').trim();
    pushTeamMemberProcessEntry(tracker, 'error', errorText);
    const chatMsg = appendTeamChat(teamId, {
      from: 'subagent',
      fromName: agentName,
      fromAgentId: agentId,
      content: `Direct reply failed: ${errorText}`,
      threadId,
      metadata: {
        ...buildTeamMemberTurnMetadata(tracker, agentId, `Direct reply failed: ${errorText}`),
        runSuccess: false,
        targetType: 'user',
        targetId: 'user',
        targetLabel: 'You',
      },
    });
    deps.broadcastTeamEvent({
      type: 'team_chat_message',
      teamId,
      teamName: team.name,
      chatMessage: chatMsg,
      text: String(chatMsg?.content || ''),
    });
    updateTeamMemberState(teamId, agentId, {
      status: 'blocked',
      currentTask: currentTaskLabel,
      blockedReason: errorText.slice(0, 500),
      lastResult: errorText.slice(0, 1000),
    });
    broadcastTeamMemberStreamDone(deps, team, tracker, agentId, agentName, false);
    return {
      success: false,
      result: '',
      error: errorText,
      thinking: tracker.thinking.trim() || undefined,
      processEntries: tracker.processEntries.length > 0 ? [...tracker.processEntries] : undefined,
      durationMs: Math.max(0, Date.now() - tracker.startedAt),
      stepCount: tracker.stepCount,
      agentName,
      taskId: tracker.streamId,
    };
  } finally {
    activeTeamMemberDirectTurns.delete(conversationKey);
    if (hasPendingTeamDirectThreadUserMessages(teamId, threadId) && autoWakeChainDepth < TEAM_MEMBER_AUTO_WAKE_MAX_CHAIN_DEPTH) {
      scheduleTeamMemberDirectWake(teamId, agentId, threadId, {
        reason: 'The team owner sent another direct follow-up while you were already replying.',
        delayMs: TEAM_MEMBER_AUTO_WAKE_FOLLOWUP_MS,
        chainDepth: autoWakeChainDepth + 1,
      });
    } else {
      clearPendingTeamMemberDirectWake(teamId, agentId, threadId);
    }
    if (hasPendingAgentMessages(teamId, agentId)) {
      scheduleTeamMemberAutoWake(teamId, agentId, {
        reason: 'New teammate messages arrived while you were in a direct chat.',
        delayMs: TEAM_MEMBER_AUTO_WAKE_FOLLOWUP_MS,
        source: 'room_followup',
      });
    }
    finishLiveRuntime(runtimeId);
  }
}
