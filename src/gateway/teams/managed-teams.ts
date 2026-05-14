/**
 * managed-teams.ts — Managed Team Data Layer
 *
 * Extends the existing agent-teams.ts with the full management layer:
 * - ManagedTeam type (extends AgentTeam with manager config, chat, changes)
 * - TeamChatMessage, TeamChange types
 * - Storage: workspace/.prometheus/managed-teams.json
 * - CRUD helpers used by team-manager-runner.ts and server-v2.ts
 *
 * Design principle: subagents remain as AgentDefinition entries in config.agents[].
 * The team is a metadata/management overlay. The Tasks/Schedule page MUST filter
 * out any AgentDefinition with a teamId so team-owned agents don't show there.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getAgentById, ensureAgentWorkspace, getConfig } from '../../config/config.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface TeamChatMessage {
  id: string;
  timestamp: number;
  from: 'manager' | 'subagent' | 'user';
  fromName: string;
  fromAgentId?: string;
  content: string;
  threadId?: string;       // groups messages from a single manager review cycle
	  metadata?: {
    source?: string;
    proposalId?: string;
    scheduleId?: string;
    scheduleName?: string;
	    runId?: string;
    agentId?: string;
    runSuccess?: boolean;
    taskId?: string;
    targetType?: 'room' | 'team' | 'manager' | 'member' | 'user';
    targetId?: string;
    targetLabel?: string;
    messageType?: TeamRoomMessageCategory;
    stepCount?: number;
    durationMs?: number;
    thinking?: string;
    attachmentPreviews?: Array<{
      kind?: string;
      name?: string;
      ext?: string;
      workspacePath?: string;
      dataUrl?: string;
      mimeType?: string;
      binary?: boolean;
    }>;
    processEntries?: Array<{
      ts?: string;
      type?: string;
      content?: string;
      actor?: string;
      [key: string]: any;
    }>;
  };
}

export interface TeamChange {
  id: string;
  proposedAt: number;
  appliedAt?: number;
  rejectedAt?: number;
  status: 'pending' | 'applied' | 'rejected' | 'auto_applied';
  type:
    | 'modify_prompt'
    | 'modify_schedule'
    | 'schedule_one_off'
    | 'modify_max_steps'
    | 'add_subagent'
    | 'remove_subagent'
    | 'modify_context'
    | 'modify_goal';
  targetSubagentId?: string;
  description: string;   // human-readable: "Change X Poster to run at 9am instead of 8am"
  riskLevel: 'low' | 'medium' | 'high';
  diff: {
    field: string;
    before: any;
    after: any;
  };
}

export interface ManagerNote {
  timestamp: number;
  content: string;
  type: 'analysis' | 'decision' | 'observation' | 'error_handled';
  threadId?: string;
}

export interface TeamContextReference {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
  updatedBy?: string;
}

// ─── Structured Goal Model ──────────────────────────────────────────────────────
// Replaces the flat `teamContext` string with a living mission/focus/milestones model.

export type TeamMode = 'project' | 'autonomous';

export interface TeamMilestone {
  id: string;
  description: string;
  status: 'pending' | 'active' | 'complete' | 'blocked';
  relevantAgentIds: string[];
  completedAt?: number;
  createdAt: number;
}

// ─── Main Agent ↔ Coordinator Thread ────────────────────────────────────────────
// Persistent 2-way conversation between the team coordinator and the main chat agent.
// Messages are visible in both the team chat page and the main chat page.

export interface MainAgentThreadMessage {
  id: string;
  from: 'coordinator' | 'main_agent';
  content: string;
  timestamp: number;
  read: boolean;
  type: 'planning' | 'error' | 'status' | 'reply';
}

export type TeamRoomActorType = 'manager' | 'member' | 'user' | 'system' | 'main_agent';
export type TeamRoomMessageCategory =
  | 'chat'
  | 'feedback'
  | 'blocker'
  | 'plan'
  | 'result'
  | 'status'
  | 'goal_update'
  | 'artifact'
  | 'dispatch'
  | 'system';
export type TeamMemberPresenceState =
  | 'idle'
  | 'planning'
  | 'ready'
  | 'waiting_for_context'
  | 'running'
  | 'blocked'
  | 'reviewing';
export type TeamPlanPriority = 'high' | 'medium' | 'low';
export type TeamPlanStatus = 'pending' | 'active' | 'completed' | 'blocked' | 'dropped';
export type TeamDispatchStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface TeamRoomMessage {
  id: string;
  timestamp: number;
  actorType: TeamRoomActorType;
  actorName: string;
  actorId?: string;
  content: string;
  category: TeamRoomMessageCategory;
  target?: string;
  threadId?: string;
  metadata?: {
    runId?: string;
    agentId?: string;
    dispatchId?: string;
    runSuccess?: boolean;
    source?: string;
    stepCount?: number;
    durationMs?: number;
  };
}

export interface TeamMemberState {
  agentId: string;
  status: TeamMemberPresenceState;
  currentTask?: string;
  blockedReason?: string;
  lastResult?: string;
  lastUpdateAt: number;
  lastRoomEventSeenAt?: number;
}

export interface TeamPlanItem {
  id: string;
  description: string;
  priority: TeamPlanPriority;
  status: TeamPlanStatus;
  ownerAgentId?: string;
  reason?: string;
  createdBy?: string;
  createdAt: number;
  updatedAt: number;
}

export interface TeamDispatchRecord {
  id: string;
  agentId: string;
  agentName: string;
  taskSummary: string;
  status: TeamDispatchStatus;
  requestedBy?: string;
  taskId?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  resultPreview?: string;
}

export interface TeamSharedArtifact {
  id: string;
  name: string;
  type: string;
  description?: string;
  content?: string;
  path?: string;
  createdBy: string;
  createdAt: number;
}

export interface TeamRoomBlocker {
  id: string;
  content: string;
  fromAgentId?: string;
  createdAt: number;
  resolvedAt?: number;
}

export interface TeamManagerInboxEntry {
  id: string;
  fromAgentId?: string;
  fromName: string;
  content: string;
  createdAt: number;
  drainedAt?: number;
}

export interface TeamDirectThreadPendingMessage {
  id: string;
  content: string;
  createdAt: number;
  chatMessageId?: string;
}

export interface TeamDirectThread {
  id: string;
  participantType: 'manager' | 'member';
  participantId: string;
  participantLabel: string;
  sessionId: string;
  createdAt: number;
  lastMessageAt: number;
  lastParticipantReplyAt?: number;
  leaseExpiresAt: number;
  pendingUserMessages: TeamDirectThreadPendingMessage[];
}

export interface TeamRoomState {
  purpose: string;
  runGoal: string;
  plan: TeamPlanItem[];
  roomMessages: TeamRoomMessage[];
  memberStates: Record<string, TeamMemberState>;
  dispatches: TeamDispatchRecord[];
  sharedArtifacts: TeamSharedArtifact[];
  blockers: TeamRoomBlocker[];
  managerInbox: TeamManagerInboxEntry[];
  directThreads: Record<string, TeamDirectThread>;
}

// ─── Per-Agent Pause State ──────────────────────────────────────────────────────
// Coordinator can pause/unpause individual agents independently of team-level pause.

export interface AgentPauseState {
  paused: boolean;
  pausedAt?: number;
  pauseReason?: string;
}

// ─── Issue 9: Per-team run history ─────────────────────────────────────────────
// Each entry records one subagent run within the team.
// Capped at MAX_TEAM_RUN_HISTORY entries in managed-teams.json so it survives restarts.

export interface TeamRunEntry {
  id: string;
  agentId: string;
  agentName: string;
  trigger: 'cron' | 'team_dispatch' | 'manual';
  taskId?: string;
  success: boolean;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  stepCount?: number;
  zeroToolCalls?: boolean;   // true when agent returned 0 tool calls (Issue 12 signal)
  error?: string;
  resultPreview?: string;
  quality?: {
    warning?: string;
    zeroToolCalls?: boolean;
    resultLength?: number;
    suspect?: boolean;
  };
  roomSnapshot?: TeamRunRoomSnapshot;
}

export interface TeamRunRoomSnapshot {
  capturedAt: number;
  memberStates: Record<string, TeamMemberState>;
  activeDispatches: TeamDispatchRecord[];
  recentDispatches: TeamDispatchRecord[];
  managerAutoWakeEvents: TeamRoomMessage[];
  memberWakeEvents: TeamRoomMessage[];
  artifacts: TeamSharedArtifact[];
  blockers: TeamRoomBlocker[];
  plan: TeamPlanItem[];
  relatedEvents: TeamRoomMessage[];
}

const MAX_TEAM_RUN_HISTORY = 200;
export const TEAM_DIRECT_THREAD_LEASE_MS = 24 * 60 * 60 * 1000;

export interface ManagedTeam {
  id: string;
  name: string;
  description: string;
  emoji: string;           // shown in UI and notifications, e.g. "🏠"

  // Manager configuration
  manager: {
    systemPrompt: string;     // What the manager is trying to achieve overall
    model?: string;           // e.g. "openai/gpt-4o" — uses global secondary if omitted
    reviewTrigger: 'after_each_run' | 'after_all_runs' | 'daily' | 'manual';
    autoApplyLowRisk: boolean; // auto-apply low-risk changes without user approval
    lastReviewAt?: number;
    nextReviewAt?: number;
    paused?: boolean;
    pausedAt?: number;
    pauseReason?: string;
    savedSchedules?: Record<string, string | null | undefined>;
  };

  // Links to AgentDefinition IDs in config.agents[]
  subagentIds: string[];

  // Extra filesystem roots shared by every team member. The main workspace
  // and team workspace are always allowed at runtime.
  allowedWorkPaths?: string[];

  // ── Structured Goal Model ──────────────────────────────────────────────────
  // `teamContext` is retained for backward compatibility but is now secondary.
  // The structured fields below are the source of truth for goal tracking.
  teamContext: string;               // legacy flat goal string (still injected into context)
  teamMode: TeamMode;                // 'project' (has completion) or 'autonomous' (perpetual)
  mission: string;                   // permanent top-level purpose (rarely changes)
  purpose?: string;                  // v2 alias for mission — "why this team exists permanently"
  currentFocus: string;              // what the team is actively doing RIGHT NOW
  currentTask?: string;              // per-run task derived by coordinator from memory files
  completedWork: string[];           // accumulating log (compacted over time, capped at 50)
  milestones?: TeamMilestone[];      // optional — only for project-type teams

  // ── Main Agent ↔ Coordinator 2-way conversation thread ────────────────────
  mainAgentThread?: MainAgentThreadMessage[];

  // ── Per-agent pause states ────────────────────────────────────────────────
  agentPauseStates?: Record<string, AgentPauseState>;

  // Freeform user-supplied context: links, instructions, reference data, anything
  // Injected verbatim into every manager review and every subagent run
  contextNotes?: string;
  contextReferences?: TeamContextReference[];

  // Manager's running memory (persisted write_notes equivalent)
  managerNotes: ManagerNote[];

  // Inter-agent + user chat messages
  teamChat: TeamChatMessage[];

  // Canonical team-room coordination state.
  roomState?: TeamRoomState;

  // Changes proposed by manager
  pendingChanges: TeamChange[];
  changeHistory: TeamChange[];

  // Agent-to-agent message queues (persisted, survive restarts)
  // manager → subagent: pendingMessages[agentId] = string[]
  // subagent → manager: pendingManagerMessages = string[]
  pendingMessages?: Record<string, string[]>;
  pendingManagerMessages?: string[];

  // Issue 9: team-scoped run history — survives restarts, capped at MAX_TEAM_RUN_HISTORY
  runHistory?: TeamRunEntry[];

  // Session that triggered creation via ask_team_coordinator — team results route back here
  originatingSessionId?: string;

  // Stats
  totalRuns: number;          // total subagent runs across all members
  createdAt: number;
  updatedAt: number;
  lastActivityAt?: number;    // last time any subagent ran
  notificationTargets?: Array<{
    channel: 'telegram' | 'discord' | 'whatsapp';
    peerId: string;
    addedAt: number;
    source?: string;
  }>;
}

// ─── Issue 10: Team health computation ─────────────────────────────────────────
// Computed on-the-fly from runHistory — never persisted (would go stale).

export type TeamHealth = 'healthy' | 'degraded' | 'stalled';

export interface TeamHealthResult {
  status: TeamHealth;
  successRate: number;   // 0–1 over the last HEALTH_WINDOW_RUNS runs
  runsInWindow: number;
  lastRunAt?: number;
  stalledSince?: number; // set when no run in 24 h and team has a cron schedule
}

const HEALTH_WINDOW_RUNS = 20;          // look at last N runs
const STALLED_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

export function computeTeamHealth(team: ManagedTeam): TeamHealthResult {
  if (team.manager?.paused) {
    return { status: 'stalled', successRate: 0, runsInWindow: 0 };
  }

  const history = Array.isArray(team.runHistory) ? team.runHistory : [];
  const window = history.slice(-HEALTH_WINDOW_RUNS);
  const runsInWindow = window.length;
  const lastRunAt = history.length > 0 ? history[history.length - 1].startedAt : undefined;

  if (runsInWindow === 0) {
    // No runs ever — only stalled if there IS a scheduled subagent (expected to have run)
    return { status: 'healthy', successRate: 1, runsInWindow: 0, lastRunAt };
  }

  const successCount = window.filter(r => r.success).length;
  const successRate = successCount / runsInWindow;

  // Stalled: no activity in 24h (only meaningful when there's a cron schedule)
  const now = Date.now();
  const sinceLastRun = lastRunAt ? now - lastRunAt : Infinity;
  const stalledSince = sinceLastRun > STALLED_THRESHOLD_MS ? lastRunAt : undefined;

  let status: TeamHealth;
  if (successRate >= 0.8) {
    status = stalledSince ? 'stalled' : 'healthy';
  } else if (successRate >= 0.4) {
    status = 'degraded';
  } else {
    status = 'stalled';
  }

  return { status, successRate, runsInWindow, lastRunAt, stalledSince };
}

export interface ManagedTeamStore {
  teams: ManagedTeam[];
  version: number;
  updatedAt: number;
}

const TEAM_CHANGE_TYPES: TeamChange['type'][] = [
  'modify_prompt',
  'modify_schedule',
  'schedule_one_off',
  'modify_max_steps',
  'add_subagent',
  'remove_subagent',
  'modify_context',
  'modify_goal',
];
const TEAM_CHANGE_TYPE_SET = new Set<TeamChange['type']>(TEAM_CHANGE_TYPES);
const TEAM_CHANGE_STATUS_SET = new Set<TeamChange['status']>(['pending', 'applied', 'rejected', 'auto_applied']);
const TEAM_CHANGE_RISK_SET = new Set<TeamChange['riskLevel']>(['low', 'medium', 'high']);

const TEAM_CHANGE_TYPE_ALIASES: Record<string, TeamChange['type']> = {
  modify_instruction: 'modify_prompt',
  modify_instructions: 'modify_prompt',
  modify_system_prompt: 'modify_prompt',
  modify_system_instructions: 'modify_prompt',
  modify_instruction_prompt: 'modify_prompt',
  update_prompt: 'modify_prompt',
  change_prompt: 'modify_prompt',
  change_instruction: 'modify_prompt',
  update_schedule: 'modify_schedule',
  change_schedule: 'modify_schedule',
  modify_cron: 'modify_schedule',
  modify_cron_schedule: 'modify_schedule',
  modify_max_step: 'modify_max_steps',
  change_max_steps: 'modify_max_steps',
  schedule_once: 'schedule_one_off',
  one_off_schedule: 'schedule_one_off',
  update_goal: 'modify_goal',
  change_goal: 'modify_goal',
  set_goal: 'modify_goal',
  modify_team_goal: 'modify_goal',
  update_team_goal: 'modify_goal',
  change_team_goal: 'modify_goal',
};

function pickString(obj: any, keys: string[]): string {
  if (!obj || typeof obj !== 'object') return '';
  for (const key of keys) {
    const value = obj[key];
    if (value === undefined || value === null) continue;
    const s = String(value).trim();
    if (s) return s;
  }
  return '';
}

function normalizeRiskLevel(raw: any): TeamChange['riskLevel'] {
  const risk = String(raw || '').trim().toLowerCase();
  if (TEAM_CHANGE_RISK_SET.has(risk as TeamChange['riskLevel'])) return risk as TeamChange['riskLevel'];
  return 'medium';
}

function normalizeStatus(raw: any): TeamChange['status'] {
  const status = String(raw || '').trim().toLowerCase();
  if (TEAM_CHANGE_STATUS_SET.has(status as TeamChange['status'])) return status as TeamChange['status'];
  return 'pending';
}

function normalizeDiff(type: TeamChange['type'], rawDiff: any): TeamChange['diff'] {
  const field = String(rawDiff?.field || '').trim();
  const before = rawDiff?.before ?? null;
  let after = rawDiff?.after ?? null;

  if (type === 'modify_prompt' && typeof after === 'object' && after) {
    const promptText = pickString(after, [
      'prompt',
      'instruction_prompt',
      'instructions',
      'system_prompt',
      'systemPrompt',
      'system_instructions',
      'value',
      'text',
      'after',
    ]);
    if (promptText) after = promptText;
  }

  if (type === 'modify_schedule' && typeof after === 'object' && after) {
    const schedule = pickString(after, [
      'cron',
      'cronSchedule',
      'cron_schedule',
      'schedule',
      'value',
      'after',
    ]);
    if (schedule) after = schedule;
  }

  if (type === 'modify_max_steps' && typeof after === 'object' && after) {
    const rawSteps = pickString(after, ['maxSteps', 'max_steps', 'steps', 'value', 'after']);
    const maxSteps = Number(rawSteps);
    if (Number.isFinite(maxSteps) && maxSteps > 0) after = maxSteps;
  }

  return { field, before, after };
}

function normalizeContextReference(raw: any): TeamContextReference | null {
  if (!raw || typeof raw !== 'object') return null;
  const title = String(raw.title || '').trim().slice(0, 120);
  const content = String(raw.content || '').trim().slice(0, 8000);
  if (!title || !content) return null;
  const createdAt = Number(raw.createdAt) || Date.now();
  const updatedAt = Number(raw.updatedAt) || createdAt;
  return {
    id: String(raw.id || `ctx_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`),
    title,
    content,
    createdAt,
    updatedAt,
    createdBy: String(raw.createdBy || '').trim() || undefined,
    updatedBy: String(raw.updatedBy || '').trim() || undefined,
  };
}

function normalizeContextReferenceList(raw: any): TeamContextReference[] {
  if (!Array.isArray(raw)) return [];
  const out = raw
    .map((item: any) => normalizeContextReference(item))
    .filter((item: TeamContextReference | null): item is TeamContextReference => !!item);
  return out.slice(-200);
}

function normalizeTeamRoomActorType(raw: any): TeamRoomActorType {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'manager' || value === 'member' || value === 'user' || value === 'system' || value === 'main_agent') {
    return value as TeamRoomActorType;
  }
  if (value === 'subagent') return 'member';
  if (value === 'coordinator') return 'manager';
  return 'system';
}

function normalizeTeamRoomMessageCategory(raw: any): TeamRoomMessageCategory {
  const value = String(raw || '').trim().toLowerCase();
  if (
    value === 'chat'
    || value === 'feedback'
    || value === 'blocker'
    || value === 'plan'
    || value === 'result'
    || value === 'status'
    || value === 'goal_update'
    || value === 'artifact'
    || value === 'dispatch'
    || value === 'system'
  ) {
    return value as TeamRoomMessageCategory;
  }
  return 'chat';
}

function normalizeTeamMemberPresenceState(raw: any): TeamMemberPresenceState {
  const value = String(raw || '').trim().toLowerCase();
  if (
    value === 'idle'
    || value === 'planning'
    || value === 'ready'
    || value === 'waiting_for_context'
    || value === 'running'
    || value === 'blocked'
    || value === 'reviewing'
  ) {
    return value as TeamMemberPresenceState;
  }
  if (value === 'executing') return 'running';
  if (value === 'done' || value === 'complete' || value === 'completed') return 'ready';
  return 'idle';
}

function normalizeTeamPlanPriority(raw: any): TeamPlanPriority {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'high' || value === 'medium' || value === 'low') return value as TeamPlanPriority;
  return 'medium';
}

function normalizeTeamPlanStatus(raw: any): TeamPlanStatus {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'pending' || value === 'active' || value === 'completed' || value === 'blocked' || value === 'dropped') {
    return value as TeamPlanStatus;
  }
  if (value === 'complete') return 'completed';
  return 'pending';
}

function normalizeTeamDispatchStatus(raw: any): TeamDispatchStatus {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'queued' || value === 'running' || value === 'completed' || value === 'failed') {
    return value as TeamDispatchStatus;
  }
  if (value === 'complete') return 'completed';
  return 'queued';
}

function inferRoomActorFromChatMessage(message: TeamChatMessage): TeamRoomActorType {
  if (message.from === 'manager') return 'manager';
  if (message.from === 'subagent') return 'member';
  if (message.fromName === 'Main Agent') return 'main_agent';
  return 'user';
}

function mapChatTargetToRoomTarget(message: TeamChatMessage): string | undefined {
  const targetType = String(message.metadata?.targetType || '').trim().toLowerCase();
  if (targetType === 'team' || targetType === 'room') return 'all';
  if (targetType === 'manager') return 'manager';
  if (targetType === 'member') return String(message.metadata?.targetId || '').trim() || undefined;
  if (targetType === 'user') return 'user';
  return undefined;
}

function mapRoomTargetToChatMetadata(target: string | undefined): {
  targetType?: NonNullable<TeamChatMessage['metadata']>['targetType'];
  targetId?: string;
} {
  const value = String(target || '').trim();
  if (!value) return {};
  if (value === 'all') return { targetType: 'team' };
  if (value === 'manager') return { targetType: 'manager', targetId: 'manager' };
  if (value === 'user') return { targetType: 'user', targetId: 'user' };
  return { targetType: 'member', targetId: value };
}

function mapChatMessageToRoomMessage(message: TeamChatMessage): TeamRoomMessage {
  const actorType = inferRoomActorFromChatMessage(message);
  return {
    id: String(message.id || `room_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`),
    timestamp: Number(message.timestamp) || Date.now(),
    actorType,
    actorName: String(message.fromName || (actorType === 'manager' ? 'Manager' : actorType === 'main_agent' ? 'Main Agent' : 'User')).trim(),
    actorId: String(message.fromAgentId || message.metadata?.agentId || '').trim() || undefined,
    content: String(message.content || '').trim(),
    category: normalizeTeamRoomMessageCategory(message.metadata?.messageType || 'chat'),
    target: mapChatTargetToRoomTarget(message),
    threadId: String(message.threadId || '').trim() || undefined,
    metadata: message.metadata ? {
      source: String(message.metadata.source || '').trim() || undefined,
      runId: String(message.metadata.runId || '').trim() || undefined,
      agentId: String(message.metadata.agentId || message.fromAgentId || '').trim() || undefined,
      runSuccess: typeof message.metadata.runSuccess === 'boolean' ? message.metadata.runSuccess : undefined,
      stepCount: Number.isFinite(Number(message.metadata.stepCount)) ? Number(message.metadata.stepCount) : undefined,
      durationMs: Number.isFinite(Number(message.metadata.durationMs)) ? Number(message.metadata.durationMs) : undefined,
    } : undefined,
  };
}

function mapRoomMessageToChatMessage(message: TeamRoomMessage): TeamChatMessage {
  const from = message.actorType === 'manager'
    ? 'manager'
    : message.actorType === 'member'
      ? 'subagent'
      : 'user';
  const fromName = String(message.actorName || (
    message.actorType === 'manager'
      ? 'Manager'
      : message.actorType === 'main_agent'
        ? 'Main Agent'
        : message.actorType === 'member'
          ? message.actorId || 'Subagent'
          : 'User'
  )).trim();
  return {
    id: message.id,
    timestamp: message.timestamp,
    from,
    fromName,
    fromAgentId: message.actorType === 'member'
      ? (String(message.actorId || '').trim() || undefined)
      : undefined,
    content: String(message.content || '').trim(),
    threadId: String(message.threadId || '').trim() || undefined,
    metadata: {
      ...(message.metadata ? {
        source: String(message.metadata.source || '').trim() || undefined,
        messageType: normalizeTeamRoomMessageCategory(message.category || 'chat'),
        runId: String(message.metadata.runId || '').trim() || undefined,
        agentId: String(message.metadata.agentId || message.actorId || '').trim() || undefined,
        runSuccess: typeof message.metadata.runSuccess === 'boolean' ? message.metadata.runSuccess : undefined,
        stepCount: Number.isFinite(Number(message.metadata.stepCount)) ? Number(message.metadata.stepCount) : undefined,
        durationMs: Number.isFinite(Number(message.metadata.durationMs)) ? Number(message.metadata.durationMs) : undefined,
      } : {}),
      ...mapRoomTargetToChatMetadata(message.target),
    },
  };
}

function normalizeTeamRoomMessage(raw: any): TeamRoomMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const content = String(raw.content || '').trim().slice(0, 8000);
  if (!content) return null;
  return {
    id: String(raw.id || `room_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`),
    timestamp: Number(raw.timestamp) || Date.now(),
    actorType: normalizeTeamRoomActorType(raw.actorType || raw.from),
    actorName: String(raw.actorName || raw.fromName || raw.actorId || 'System').trim().slice(0, 120),
    actorId: String(raw.actorId || raw.fromAgentId || raw.metadata?.agentId || '').trim() || undefined,
    content,
    category: normalizeTeamRoomMessageCategory(raw.category || raw.type),
    target: String(raw.target || raw.to || '').trim() || undefined,
    threadId: String(raw.threadId || '').trim() || undefined,
    metadata: raw.metadata && typeof raw.metadata === 'object' ? {
      runId: String(raw.metadata.runId || '').trim() || undefined,
      agentId: String(raw.metadata.agentId || '').trim() || undefined,
      dispatchId: String(raw.metadata.dispatchId || '').trim() || undefined,
      runSuccess: typeof raw.metadata.runSuccess === 'boolean' ? raw.metadata.runSuccess : undefined,
      source: String(raw.metadata.source || '').trim() || undefined,
      stepCount: Number.isFinite(Number(raw.metadata.stepCount)) ? Number(raw.metadata.stepCount) : undefined,
      durationMs: Number.isFinite(Number(raw.metadata.durationMs)) ? Number(raw.metadata.durationMs) : undefined,
    } : undefined,
  };
}

function normalizeTeamMemberStateRecord(raw: any, agentId: string): TeamMemberState {
  return {
    agentId,
    status: normalizeTeamMemberPresenceState(raw?.status || raw?.phase),
    currentTask: String(raw?.currentTask || raw?.current_task || '').trim().slice(0, 500) || undefined,
    blockedReason: String(raw?.blockedReason || raw?.blocked_reason || '').trim().slice(0, 500) || undefined,
    lastResult: String(raw?.lastResult || raw?.roundResult || raw?.result || '').trim().slice(0, 1000) || undefined,
    lastUpdateAt: Number(raw?.lastUpdateAt || raw?.updatedAt) || Date.now(),
    lastRoomEventSeenAt: Number(raw?.lastRoomEventSeenAt) || undefined,
  };
}

function normalizeTeamPlanItem(raw: any): TeamPlanItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const description = String(raw.description || raw.title || '').trim().slice(0, 500);
  if (!description) return null;
  const createdAt = Number(raw.createdAt) || Date.now();
  return {
    id: String(raw.id || `plan_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`),
    description,
    priority: normalizeTeamPlanPriority(raw.priority),
    status: normalizeTeamPlanStatus(raw.status),
    ownerAgentId: String(raw.ownerAgentId || raw.owner_agent_id || '').trim() || undefined,
    reason: String(raw.reason || '').trim().slice(0, 500) || undefined,
    createdBy: String(raw.createdBy || '').trim() || undefined,
    createdAt,
    updatedAt: Number(raw.updatedAt) || createdAt,
  };
}

function normalizeTeamDispatchRecord(raw: any): TeamDispatchRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const agentId = String(raw.agentId || '').trim();
  const taskSummary = String(raw.taskSummary || raw.task || '').trim().slice(0, 1000);
  if (!agentId || !taskSummary) return null;
  return {
    id: String(raw.id || `dispatch_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`),
    agentId,
    agentName: String(raw.agentName || agentId).trim().slice(0, 120),
    taskSummary,
    status: normalizeTeamDispatchStatus(raw.status),
    requestedBy: String(raw.requestedBy || '').trim() || undefined,
    taskId: String(raw.taskId || '').trim() || undefined,
    createdAt: Number(raw.createdAt) || Date.now(),
    startedAt: Number(raw.startedAt) || undefined,
    finishedAt: Number(raw.finishedAt) || undefined,
    resultPreview: String(raw.resultPreview || '').trim().slice(0, 1500) || undefined,
  };
}

function normalizeTeamSharedArtifact(raw: any): TeamSharedArtifact | null {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').trim().slice(0, 200);
  if (!name) return null;
  return {
    id: String(raw.id || `artifact_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`),
    name,
    type: String(raw.type || 'data').trim().slice(0, 80),
    description: String(raw.description || '').trim().slice(0, 500) || undefined,
    content: String(raw.content || '').trim().slice(0, 4000) || undefined,
    path: String(raw.path || '').trim().slice(0, 500) || undefined,
    createdBy: String(raw.createdBy || 'system').trim().slice(0, 120),
    createdAt: Number(raw.createdAt) || Date.now(),
  };
}

function normalizeTeamBlocker(raw: any): TeamRoomBlocker | null {
  if (!raw || typeof raw !== 'object') return null;
  const content = String(raw.content || raw.message || '').trim().slice(0, 1000);
  if (!content) return null;
  return {
    id: String(raw.id || `blocker_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`),
    content,
    fromAgentId: String(raw.fromAgentId || '').trim() || undefined,
    createdAt: Number(raw.createdAt) || Date.now(),
    resolvedAt: Number(raw.resolvedAt) || undefined,
  };
}

function normalizeManagerInboxEntry(raw: any): TeamManagerInboxEntry | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const text = String(raw).trim().slice(0, 1500);
    if (!text) return null;
    const match = text.match(/^\[From ([^\]]+)\]:\s*(.*)$/);
    const fromAgentId = match?.[1]?.trim();
    const content = String(match?.[2] || text).trim().slice(0, 1500);
    return {
      id: `inbox_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
      fromAgentId: fromAgentId || undefined,
      fromName: fromAgentId || 'Subagent',
      content,
      createdAt: Date.now(),
    };
  }
  if (typeof raw !== 'object') return null;
  const content = String(raw.content || raw.message || '').trim().slice(0, 1500);
  if (!content) return null;
  const fromAgentId = String(raw.fromAgentId || '').trim() || undefined;
  return {
    id: String(raw.id || `inbox_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`),
    fromAgentId,
    fromName: String(raw.fromName || fromAgentId || 'Subagent').trim().slice(0, 120),
    content,
    createdAt: Number(raw.createdAt) || Date.now(),
    drainedAt: Number(raw.drainedAt) || undefined,
  };
}

function buildTeamDirectThreadKey(
  participantType: TeamDirectThread['participantType'],
  participantId: string,
): string {
  return `${participantType}:${String(participantId || '').trim() || participantType}`;
}

function buildTeamDirectThreadSessionId(
  teamId: string,
  participantType: TeamDirectThread['participantType'],
  participantId: string,
  threadId: string,
): string {
  const cleanTeamId = String(teamId || '').trim();
  const cleanParticipantId = String(participantId || participantType).trim();
  const cleanThreadId = String(threadId || '').trim();
  if (participantType === 'manager') {
    return `team_dm_manager_${cleanTeamId}___THREAD___${cleanThreadId}`;
  }
  return `team_dm_member_${cleanTeamId}___AGENT___${cleanParticipantId}___THREAD___${cleanThreadId}`;
}

function normalizeTeamDirectThread(
  raw: any,
  teamId: string,
  key: string,
): TeamDirectThread | null {
  if (!raw || typeof raw !== 'object') return null;
  const participantType = String(raw.participantType || '').trim().toLowerCase();
  const normalizedType = participantType === 'manager' ? 'manager' : participantType === 'member' ? 'member' : '';
  if (!normalizedType) return null;
  const participantId = String(raw.participantId || '').trim() || (normalizedType === 'manager' ? 'manager' : '');
  if (!participantId) return null;
  const createdAt = Number(raw.createdAt) || Date.now();
  const threadId = String(raw.id || `thread_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`).trim();
  const pendingUserMessages = Array.isArray(raw.pendingUserMessages)
    ? raw.pendingUserMessages
        .map((entry: any) => {
          const content = String(entry?.content || entry?.message || '').trim().slice(0, 4000);
          if (!content) return null;
          const normalized: TeamDirectThreadPendingMessage = {
            id: String(entry?.id || `thread_msg_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`),
            content,
            createdAt: Number(entry?.createdAt) || Date.now(),
            chatMessageId: String(entry?.chatMessageId || '').trim() || undefined,
          };
          return normalized;
        })
        .filter((entry: TeamDirectThreadPendingMessage | null): entry is TeamDirectThreadPendingMessage => !!entry)
        .slice(-20)
    : [];
  return {
    id: threadId,
    participantType: normalizedType as TeamDirectThread['participantType'],
    participantId,
    participantLabel: String(raw.participantLabel || participantId).trim().slice(0, 120) || participantId,
    sessionId: String(raw.sessionId || buildTeamDirectThreadSessionId(teamId, normalizedType as TeamDirectThread['participantType'], participantId, threadId)).trim(),
    createdAt,
    lastMessageAt: Number(raw.lastMessageAt) || createdAt,
    lastParticipantReplyAt: Number(raw.lastParticipantReplyAt) || undefined,
    leaseExpiresAt: Number(raw.leaseExpiresAt) || (createdAt + TEAM_DIRECT_THREAD_LEASE_MS),
    pendingUserMessages,
  };
}

function buildLegacyRoomMessages(team: any): TeamRoomMessage[] {
  const chat = Array.isArray(team?.teamChat) ? team.teamChat : [];
  return chat
    .map((message: any) => mapChatMessageToRoomMessage(message as TeamChatMessage))
    .slice(-500);
}

function buildLegacyManagerInbox(team: any): TeamManagerInboxEntry[] {
  const inbox = Array.isArray(team?.pendingManagerMessages) ? team.pendingManagerMessages : [];
  return inbox
    .map((entry: any) => normalizeManagerInboxEntry(entry))
    .filter((entry: TeamManagerInboxEntry | null): entry is TeamManagerInboxEntry => !!entry)
    .slice(-100);
}

function normalizeTeamRoomState(team: any): { state: TeamRoomState; changed: boolean } {
  const raw = team?.roomState && typeof team.roomState === 'object' ? team.roomState : null;
  let changed = !raw;

  const purpose = String(raw?.purpose || team?.purpose || team?.mission || team?.teamContext || team?.description || '').trim().slice(0, 2000);
  const runGoal = String(raw?.runGoal || team?.currentTask || team?.currentFocus || '').trim().slice(0, 2000);

  const rawMessages = Array.isArray(raw?.roomMessages) ? raw.roomMessages : buildLegacyRoomMessages(team);
  if (!Array.isArray(raw?.roomMessages)) changed = true;
  const roomMessages = rawMessages
    .map((message: any) => normalizeTeamRoomMessage(message))
    .filter((message: TeamRoomMessage | null): message is TeamRoomMessage => !!message)
    .slice(-500);

  const rawPlan = Array.isArray(raw?.plan)
    ? raw.plan
    : Array.isArray(team?.milestones)
      ? team.milestones.map((milestone: any) => ({
          id: milestone.id,
          description: milestone.description,
          status: milestone.status === 'complete' ? 'completed' : milestone.status,
          priority: 'medium',
          ownerAgentId: Array.isArray(milestone.relevantAgentIds) ? milestone.relevantAgentIds[0] : undefined,
          createdAt: milestone.createdAt,
          updatedAt: milestone.completedAt || milestone.createdAt,
        }))
      : [];
  if (!Array.isArray(raw?.plan)) changed = true;
  const plan = rawPlan
    .map((item: any) => normalizeTeamPlanItem(item))
    .filter((item: TeamPlanItem | null): item is TeamPlanItem => !!item)
    .slice(-100);

  const existingMemberStates = raw?.memberStates && typeof raw.memberStates === 'object' ? raw.memberStates : {};
  if (!raw?.memberStates || typeof raw.memberStates !== 'object') changed = true;
  const memberStates: Record<string, TeamMemberState> = {};
  const currentAgentIds = Array.isArray(team?.subagentIds) ? team.subagentIds : [];
  for (const [agentId, entry] of Object.entries(existingMemberStates)) {
    memberStates[agentId] = normalizeTeamMemberStateRecord(entry, agentId);
  }
  for (const agentId of currentAgentIds) {
    if (!memberStates[agentId]) {
      memberStates[agentId] = normalizeTeamMemberStateRecord({}, agentId);
      changed = true;
    }
  }

  const rawDispatches = Array.isArray(raw?.dispatches) ? raw.dispatches : [];
  if (!Array.isArray(raw?.dispatches)) changed = true;
  const dispatches = rawDispatches
    .map((entry: any) => normalizeTeamDispatchRecord(entry))
    .filter((entry: TeamDispatchRecord | null): entry is TeamDispatchRecord => !!entry)
    .slice(-200);

  const rawArtifacts = Array.isArray(raw?.sharedArtifacts) ? raw.sharedArtifacts : [];
  if (!Array.isArray(raw?.sharedArtifacts)) changed = true;
  const sharedArtifacts = rawArtifacts
    .map((entry: any) => normalizeTeamSharedArtifact(entry))
    .filter((entry: TeamSharedArtifact | null): entry is TeamSharedArtifact => !!entry)
    .slice(-100);

  const rawBlockers = Array.isArray(raw?.blockers) ? raw.blockers : [];
  if (!Array.isArray(raw?.blockers)) changed = true;
  const blockers = rawBlockers
    .map((entry: any) => normalizeTeamBlocker(entry))
    .filter((entry: TeamRoomBlocker | null): entry is TeamRoomBlocker => !!entry)
    .slice(-100);

  const rawInbox = Array.isArray(raw?.managerInbox) ? raw.managerInbox : buildLegacyManagerInbox(team);
  if (!Array.isArray(raw?.managerInbox)) changed = true;
  const managerInbox = rawInbox
    .map((entry: any) => normalizeManagerInboxEntry(entry))
    .filter((entry: TeamManagerInboxEntry | null): entry is TeamManagerInboxEntry => !!entry)
    .slice(-100);

  const rawDirectThreads = raw?.directThreads && typeof raw.directThreads === 'object' ? raw.directThreads : {};
  if (!raw?.directThreads || typeof raw.directThreads !== 'object') changed = true;
  const directThreads: Record<string, TeamDirectThread> = {};
  for (const [key, entry] of Object.entries(rawDirectThreads)) {
    const normalized = normalizeTeamDirectThread(entry, String(team?.id || '').trim(), key);
    if (!normalized) {
      changed = true;
      continue;
    }
    directThreads[key] = normalized;
  }

  return {
    state: {
      purpose,
      runGoal,
      plan,
      roomMessages,
      memberStates,
      dispatches,
      sharedArtifacts,
      blockers,
      managerInbox,
      directThreads,
    },
    changed,
  };
}

function syncLegacyTeamFields(team: ManagedTeam): void {
  if (!Array.isArray(team.allowedWorkPaths)) {
    team.allowedWorkPaths = [];
  }
  const roomState = team.roomState;
  if (!roomState) return;
  const purpose = String(roomState.purpose || team.purpose || team.mission || team.teamContext || team.description || '').trim().slice(0, 2000);
  const runGoal = String(roomState.runGoal || team.currentTask || team.currentFocus || '').trim().slice(0, 2000);
  roomState.purpose = purpose;
  roomState.runGoal = runGoal;
  team.purpose = purpose || undefined;
  team.mission = purpose;
  if (!String(team.teamContext || '').trim()) {
    team.teamContext = purpose;
  }
  team.currentFocus = runGoal;
}

function ensureTeamRoomState(team: ManagedTeam): TeamRoomState {
  const normalized = normalizeTeamRoomState(team);
  team.roomState = normalized.state;
  syncLegacyTeamFields(team);
  return team.roomState;
}

export function normalizeTeamChangeType(rawType: any, diffField?: any): TeamChange['type'] | null {
  const raw = String(rawType || '').trim().toLowerCase();
  if (raw) {
    if (TEAM_CHANGE_TYPE_SET.has(raw as TeamChange['type'])) return raw as TeamChange['type'];
    if (TEAM_CHANGE_TYPE_ALIASES[raw]) return TEAM_CHANGE_TYPE_ALIASES[raw];
  }

  const field = String(diffField || '').trim().toLowerCase();
  if (!field) return null;
  if (/(instruction|prompt|system_prompt|system_instructions|heartbeat)/.test(field)) return 'modify_prompt';
  if (/(schedule|cron|runat|run_at)/.test(field)) return 'modify_schedule';
  if (/(max[_\s-]*steps?)/.test(field)) return 'modify_max_steps';
  if (/(team_?goal|teamgoal|team_?context|teamcontext|goal)/.test(field)) return 'modify_goal';
  if (/context/.test(field)) return 'modify_context';
  return null;
}

function normalizeTeamChangeRecord(raw: any): TeamChange | null {
  if (!raw || typeof raw !== 'object') return null;
  const type = normalizeTeamChangeType(raw.type, raw?.diff?.field);
  if (!type) return null;
  return {
    id: String(raw.id || `chg_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`),
    proposedAt: Number(raw.proposedAt) || Date.now(),
    appliedAt: Number(raw.appliedAt) || undefined,
    rejectedAt: Number(raw.rejectedAt) || undefined,
    status: normalizeStatus(raw.status),
    type,
    targetSubagentId: String(raw.targetSubagentId || '').trim() || undefined,
    description: String(raw.description || '').trim() || `Change: ${type}`,
    riskLevel: normalizeRiskLevel(raw.riskLevel),
    diff: normalizeDiff(type, raw.diff),
  };
}

// ─── Storage ───────────────────────────────────────────────────────────────────

function getStorePath(): string {
  const base = getConfig().getConfigDir();
  fs.mkdirSync(base, { recursive: true });
  return path.join(base, 'managed-teams.json');
}

let _cache: ManagedTeamStore | null = null;
let _cacheTimestamp: number = 0;
const _cacheTTL = 5 * 60 * 1000; // 5 minutes TTL for managed teams cache

export function loadManagedTeamStore(): ManagedTeamStore {
  const now = Date.now();
  // Return cached version if still valid
  if (_cache && (now - _cacheTimestamp) < _cacheTTL) {
    return _cache;
  }
  
  const p = getStorePath();
  if (!fs.existsSync(p)) {
    _cache = { teams: [], version: 1, updatedAt: Date.now() };
    _cacheTimestamp = now;
    return _cache;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8')) as any;
    const teams = Array.isArray(parsed?.teams) ? parsed.teams : [];
    let mutated = false;
    const normalizedTeams = teams.map((team: any) => {
      const pendingRaw = Array.isArray(team?.pendingChanges) ? team.pendingChanges : [];
      const historyRaw = Array.isArray(team?.changeHistory) ? team.changeHistory : [];
      const refsRaw = Array.isArray(team?.contextReferences) ? team.contextReferences : [];
      const pendingNormalized = pendingRaw
        .map((change: any) => normalizeTeamChangeRecord(change))
        .filter((change: TeamChange | null): change is TeamChange => !!change);
      const historyNormalized = historyRaw
        .map((change: any) => normalizeTeamChangeRecord(change))
        .filter((change: TeamChange | null): change is TeamChange => !!change);
      let refsNormalized = normalizeContextReferenceList(refsRaw);

      if (refsNormalized.length === 0 && String(team?.contextNotes || '').trim()) {
        const now = Date.now();
        refsNormalized = [{
          id: `ctx_${now.toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
          title: 'Legacy Team Context',
          content: String(team.contextNotes).trim().slice(0, 8000),
          createdAt: now,
          updatedAt: now,
          createdBy: 'migration',
          updatedBy: 'migration',
        }];
        mutated = true;
      }

      if (pendingNormalized.length !== pendingRaw.length || historyNormalized.length !== historyRaw.length || refsNormalized.length !== refsRaw.length) {
        mutated = true;
      } else {
        const pendingTypeChanged = pendingRaw.some((change: any, idx: number) => String(change?.type || '').trim() !== pendingNormalized[idx].type);
        const historyTypeChanged = historyRaw.some((change: any, idx: number) => String(change?.type || '').trim() !== historyNormalized[idx].type);
        if (pendingTypeChanged || historyTypeChanged) mutated = true;
      }

      const normalizedTeam = {
        ...team,
        pendingChanges: pendingNormalized,
        changeHistory: historyNormalized,
        contextReferences: refsNormalized,
        allowedWorkPaths: Array.isArray(team.allowedWorkPaths) ? team.allowedWorkPaths.map(String).filter(Boolean) : [],
        // Ensure runHistory is always an array (backwards-compat with older JSON)
        runHistory: Array.isArray(team.runHistory) ? team.runHistory : [],
      } as ManagedTeam;
      const roomNormalized = normalizeTeamRoomState(normalizedTeam);
      normalizedTeam.roomState = roomNormalized.state;
      syncLegacyTeamFields(normalizedTeam);
      if (roomNormalized.changed) mutated = true;
      return normalizedTeam;
    });

    _cache = {
      teams: normalizedTeams,
      version: Number(parsed?.version) || 1,
      updatedAt: Number(parsed?.updatedAt) || Date.now(),
    };
    _cacheTimestamp = now;
    if (mutated) saveManagedTeamStore(_cache);
    return _cache;
  } catch {
    _cache = { teams: [], version: 1, updatedAt: Date.now() };
    _cacheTimestamp = now;
    return _cache;
  }
}

export function saveManagedTeamStore(store: ManagedTeamStore): void {
  _cache = { ...store, updatedAt: Date.now() };
  _cacheTimestamp = Date.now();  // Refresh TTL on save
  const p = getStorePath();
  const tmp = `${p}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(_cache, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
}

function invalidateCache(): void {
  _cache = null;
  _cacheTimestamp = 0;
}

// ─── Pagination Support ────────────────────────────────────────────────────────

export interface PaginatedTeamList {
  teams: ManagedTeam[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * Get paginated list of managed teams. Useful for UI that loads teams progressively.
 * @param page - Page number (0-indexed), default 0
 * @param pageSize - Items per page, default 20
 */
export function listManagedTeamsPaginated(page: number = 0, pageSize: number = 20): PaginatedTeamList {
  const store = loadManagedTeamStore();
  const total = store.teams.length;
  const start = page * pageSize;
  const end = start + pageSize;
  const paginatedTeams = store.teams.slice(start, end);
  
  return {
    teams: paginatedTeams,
    total,
    page,
    pageSize,
    hasMore: end < total,
  };
}

/**
 * Get team metadata (without full chat history or context references).
 * Useful for listing teams without loading heavy data.
 */
export function getManagedTeamMetadata(id: string): Omit<ManagedTeam, 'teamChat' | 'contextReferences'> | null {
  const team = getManagedTeam(id);
  if (!team) return null;
  
  const { teamChat, contextReferences, ...metadata } = team;
  return metadata;
}

// ─── CRUD ──────────────────────────────────────────────────────────────────────

export function listManagedTeams(): ManagedTeam[] {
  return loadManagedTeamStore().teams;
}

export function getManagedTeam(id: string): ManagedTeam | null {
  return loadManagedTeamStore().teams.find(t => t.id === id) ?? null;
}

export function saveManagedTeam(team: ManagedTeam): void {
  invalidateCache();
  const store = loadManagedTeamStore();
  const idx = store.teams.findIndex(t => t.id === team.id);
  ensureTeamRoomState(team);
  team.updatedAt = Date.now();
  if (idx === -1) {
    store.teams.push(team);
  } else {
    store.teams[idx] = team;
  }
  saveManagedTeamStore(store);
}

export function deleteManagedTeam(id: string): boolean {
  invalidateCache();
  const store = loadManagedTeamStore();
  const before = store.teams.length;
  store.teams = store.teams.filter(t => t.id !== id);
  if (store.teams.length === before) return false;
  saveManagedTeamStore(store);
  return true;
}

export function createManagedTeam(input: {
  name: string;
  description: string;
  emoji?: string;
  subagentIds: string[];
  teamContext: string;
  purpose?: string;        // v2: static "why this team exists" — stored as both purpose and mission
  managerSystemPrompt: string;
  managerModel?: string;
  reviewTrigger?: ManagedTeam['manager']['reviewTrigger'];
  originatingSessionId?: string;
  allowedWorkPaths?: string[];
}): ManagedTeam {
  const now = Date.now();
  const purposeOrContext = input.purpose || input.teamContext || input.description || '';
  const team: ManagedTeam = {
    id: `team_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
    name: input.name,
    description: input.description,
    emoji: input.emoji || '🏠',
    manager: {
      systemPrompt: input.managerSystemPrompt,
      model: input.managerModel,
      reviewTrigger: input.reviewTrigger || 'after_each_run',
      autoApplyLowRisk: true,
      lastReviewAt: undefined,
      paused: false,
    },
    subagentIds: input.subagentIds,
    allowedWorkPaths: Array.isArray(input.allowedWorkPaths) ? input.allowedWorkPaths.map(String).filter(Boolean) : [],
    teamContext: input.teamContext,
    teamMode: 'autonomous',
    purpose: purposeOrContext,
    mission: purposeOrContext,
    currentFocus: '',
    currentTask: undefined,
    completedWork: [],
    milestones: [],
    mainAgentThread: [],
    agentPauseStates: {},
    contextReferences: [],
    managerNotes: [],
    teamChat: [],
    roomState: {
      purpose: purposeOrContext,
      runGoal: '',
      plan: [],
      roomMessages: [],
      memberStates: Object.fromEntries(input.subagentIds.map((agentId) => [agentId, {
        agentId,
        status: 'idle' as TeamMemberPresenceState,
        lastUpdateAt: now,
      }])),
      dispatches: [],
      sharedArtifacts: [],
      blockers: [],
      managerInbox: [],
      directThreads: {},
    },
    pendingChanges: [],
    changeHistory: [],
    runHistory: [],
    totalRuns: 0,
    createdAt: now,
    updatedAt: now,
    notificationTargets: [],
    originatingSessionId: input.originatingSessionId,
  };
  syncLegacyTeamFields(team);
  saveManagedTeam(team);

  // Initialize memory files for the purpose→task workflow
  try {
    const { initTeamWorkspaceArtifacts } = require('../teams/team-workspace');
    initTeamWorkspaceArtifacts(team);
  } catch { /* non-fatal */ }

  return team;
}

// ─── Team Chat Helpers ─────────────────────────────────────────────────────────

export function appendTeamChat(
  teamId: string,
  message: Omit<TeamChatMessage, 'id' | 'timestamp'>,
): TeamChatMessage | null {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team) return null;

  const msg: TeamChatMessage = {
    ...message,
    id: `msg_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
    timestamp: Date.now(),
  };

  const roomState = ensureTeamRoomState(team);
	  roomState.roomMessages = [...(roomState.roomMessages || []), mapChatMessageToRoomMessage(msg)].slice(-500);
	  team.teamChat = [...(team.teamChat || []), msg].slice(-500); // keep last 500 messages
	  saveManagedTeam(team);
  if (msg.from === 'manager' && msg.metadata?.source !== 'team_proposal_execution') {
    const content = String(msg.content || '').trim();
    if (content) {
      setImmediate(() => {
        import('../tasks/task-router.js')
          .then((mod) => mod.mirrorTeamManagerProposalResponse(teamId, content))
          .catch(() => {});
      });
    }
  }
	  return msg;
}

export function appendTeamRoomMessage(
  teamId: string,
  message: Omit<TeamRoomMessage, 'id' | 'timestamp'>,
  options?: { mirrorToChat?: boolean },
): TeamRoomMessage | null {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team) return null;

  const entry: TeamRoomMessage = {
    ...message,
    id: `room_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
    timestamp: Date.now(),
  };
  const roomState = ensureTeamRoomState(team);
  roomState.roomMessages = [...(roomState.roomMessages || []), entry].slice(-500);
  if (options?.mirrorToChat !== false) {
    team.teamChat = [...(team.teamChat || []), mapRoomMessageToChatMessage(entry)].slice(-500);
  }
  saveManagedTeam(team);
  return entry;
}

export function getTeamDirectThread(
  teamId: string,
  participantType: TeamDirectThread['participantType'],
  participantId?: string,
): TeamDirectThread | null {
  const team = getManagedTeam(teamId);
  if (!team) return null;
  const roomState = ensureTeamRoomState(team);
  const effectiveParticipantId = String(participantId || (participantType === 'manager' ? 'manager' : '')).trim();
  if (!effectiveParticipantId) return null;
  return roomState.directThreads?.[buildTeamDirectThreadKey(participantType, effectiveParticipantId)] || null;
}

export function getTeamDirectThreadById(teamId: string, threadId: string): TeamDirectThread | null {
  const team = getManagedTeam(teamId);
  if (!team) return null;
  const roomState = ensureTeamRoomState(team);
  const match = Object.values(roomState.directThreads || {}).find((entry) => String(entry?.id || '').trim() === String(threadId || '').trim());
  return match || null;
}

export function getOrCreateTeamDirectThread(
  teamId: string,
  participantType: TeamDirectThread['participantType'],
  participantId: string,
  participantLabel: string,
): TeamDirectThread | null {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team) return null;
  const roomState = ensureTeamRoomState(team);
  const effectiveParticipantId = String(participantId || (participantType === 'manager' ? 'manager' : '')).trim();
  if (!effectiveParticipantId) return null;
  const key = buildTeamDirectThreadKey(participantType, effectiveParticipantId);
  const now = Date.now();
  const existing = roomState.directThreads?.[key];
  if (existing && Number(existing.leaseExpiresAt || 0) > now) {
    existing.participantLabel = String(participantLabel || existing.participantLabel || effectiveParticipantId).trim().slice(0, 120) || effectiveParticipantId;
    existing.lastMessageAt = now;
    existing.leaseExpiresAt = now + TEAM_DIRECT_THREAD_LEASE_MS;
    roomState.directThreads[key] = existing;
    saveManagedTeam(team);
    return existing;
  }
  const threadId = `thread_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
  const created: TeamDirectThread = {
    id: threadId,
    participantType,
    participantId: effectiveParticipantId,
    participantLabel: String(participantLabel || effectiveParticipantId).trim().slice(0, 120) || effectiveParticipantId,
    sessionId: buildTeamDirectThreadSessionId(teamId, participantType, effectiveParticipantId, threadId),
    createdAt: now,
    lastMessageAt: now,
    leaseExpiresAt: now + TEAM_DIRECT_THREAD_LEASE_MS,
    pendingUserMessages: [],
  };
  roomState.directThreads[key] = created;
  saveManagedTeam(team);
  return created;
}

export function enqueueTeamDirectThreadUserMessage(
  teamId: string,
  participantType: TeamDirectThread['participantType'],
  participantId: string,
  participantLabel: string,
  content: string,
  chatMessageId?: string,
): TeamDirectThread | null {
  const thread = getOrCreateTeamDirectThread(teamId, participantType, participantId, participantLabel);
  if (!thread) return null;
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team) return null;
  const roomState = ensureTeamRoomState(team);
  const key = buildTeamDirectThreadKey(thread.participantType, thread.participantId);
  const current = roomState.directThreads[key];
  if (!current) return null;
  const text = String(content || '').trim().slice(0, 4000);
  if (!text) return current;
  current.pendingUserMessages = [
    ...(Array.isArray(current.pendingUserMessages) ? current.pendingUserMessages : []),
    {
      id: `thread_msg_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
      content: text,
      createdAt: Date.now(),
      chatMessageId: String(chatMessageId || '').trim() || undefined,
    },
  ].slice(-20);
  current.lastMessageAt = Date.now();
  current.leaseExpiresAt = current.lastMessageAt + TEAM_DIRECT_THREAD_LEASE_MS;
  roomState.directThreads[key] = current;
  saveManagedTeam(team);
  return current;
}

export function drainTeamDirectThreadUserMessages(teamId: string, threadId: string): TeamDirectThreadPendingMessage[] {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team) return [];
  const roomState = ensureTeamRoomState(team);
  const entry = Object.entries(roomState.directThreads || {})
    .find(([, thread]) => String(thread?.id || '').trim() === String(threadId || '').trim());
  if (!entry) return [];
  const [key, thread] = entry;
  const pending = Array.isArray(thread.pendingUserMessages) ? [...thread.pendingUserMessages] : [];
  thread.pendingUserMessages = [];
  roomState.directThreads[key] = thread;
  saveManagedTeam(team);
  return pending;
}

export function hasPendingTeamDirectThreadUserMessages(teamId: string, threadId: string): boolean {
  const thread = getTeamDirectThreadById(teamId, threadId);
  return !!thread && Array.isArray(thread.pendingUserMessages) && thread.pendingUserMessages.length > 0;
}

export function listPendingTeamDirectThreadsForParticipant(
  teamId: string,
  participantType: TeamDirectThread['participantType'],
  participantId: string,
): TeamDirectThread[] {
  const team = getManagedTeam(teamId);
  if (!team) return [];
  const roomState = ensureTeamRoomState(team);
  return Object.values(roomState.directThreads || {})
    .filter((thread) =>
      thread.participantType === participantType
      && String(thread.participantId || '').trim() === String(participantId || '').trim()
      && Array.isArray(thread.pendingUserMessages)
      && thread.pendingUserMessages.length > 0
    )
    .sort((a, b) => Number(a.lastMessageAt || 0) - Number(b.lastMessageAt || 0));
}

export function touchTeamDirectThreadParticipantReply(teamId: string, threadId: string): boolean {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team) return false;
  const roomState = ensureTeamRoomState(team);
  const entry = Object.entries(roomState.directThreads || {})
    .find(([, thread]) => String(thread?.id || '').trim() === String(threadId || '').trim());
  if (!entry) return false;
  const [key, thread] = entry;
  const now = Date.now();
  thread.lastParticipantReplyAt = now;
  thread.lastMessageAt = now;
  thread.leaseExpiresAt = now + TEAM_DIRECT_THREAD_LEASE_MS;
  roomState.directThreads[key] = thread;
  saveManagedTeam(team);
  return true;
}

export function getTeamRoomState(teamId: string): TeamRoomState | null {
  const team = getManagedTeam(teamId);
  if (!team) return null;
  return ensureTeamRoomState(team);
}

function cloneRoomValue<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function isRoomMessageVisibleToAgent(message: TeamRoomMessage, agentId?: string): boolean {
  const target = String(message?.target || '').trim();
  if (!agentId || !target || target === 'all' || target === 'team') return true;
  const normalizedTarget = target.toLowerCase();
  return normalizedTarget === agentId.toLowerCase()
    || normalizedTarget === 'manager'
    || String(message?.actorId || '').trim().toLowerCase() === agentId.toLowerCase()
    || String(message?.metadata?.agentId || '').trim().toLowerCase() === agentId.toLowerCase();
}

export function getTeamRoomEventsSince(
  teamId: string,
  sinceAt = 0,
  options?: { agentId?: string; limit?: number },
): TeamRoomMessage[] {
  const roomState = getTeamRoomState(teamId);
  if (!roomState) return [];
  const limit = Math.max(1, Math.min(100, Number(options?.limit) || 20));
  return (roomState.roomMessages || [])
    .filter((message) => Number(message.timestamp || 0) > Number(sinceAt || 0))
    .filter((message) => isRoomMessageVisibleToAgent(message, options?.agentId))
    .slice(-limit)
    .map((message) => cloneRoomValue(message));
}

export function markTeamMemberRoomEventsSeen(teamId: string, agentId: string, seenAt = Date.now()): boolean {
  const cleanAgentId = String(agentId || '').trim();
  if (!cleanAgentId) return false;
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team) return false;
  const roomState = ensureTeamRoomState(team);
  const current = roomState.memberStates?.[cleanAgentId];
  roomState.memberStates[cleanAgentId] = {
    ...(current || {
      agentId: cleanAgentId,
      status: 'idle' as TeamMemberPresenceState,
      lastUpdateAt: seenAt,
    }),
    agentId: cleanAgentId,
    lastRoomEventSeenAt: Math.max(Number(current?.lastRoomEventSeenAt || 0), Number(seenAt || Date.now())),
  };
  saveManagedTeam(team);
  return true;
}

export function buildTeamRunSnapshot(
  teamId: string,
  options?: { agentId?: string; sinceAt?: number; limitEvents?: number },
): TeamRunRoomSnapshot | null {
  const roomState = getTeamRoomState(teamId);
  if (!roomState) return null;
  const sinceAt = Number(options?.sinceAt || 0);
  const limitEvents = Math.max(5, Math.min(60, Number(options?.limitEvents) || 24));
  const messages = Array.isArray(roomState.roomMessages) ? roomState.roomMessages : [];
  const relatedEvents = messages
    .filter((message) => !sinceAt || Number(message.timestamp || 0) >= sinceAt)
    .filter((message) => isRoomMessageVisibleToAgent(message, options?.agentId))
    .slice(-limitEvents);
  const managerAutoWakeEvents = messages
    .filter((message) => message?.metadata?.source === 'team_manager_auto_wake')
    .slice(-12);
  const memberWakeEvents = messages
    .filter((message) => message?.metadata?.source === 'team_member_auto_wake_scheduled')
    .filter((message) => isRoomMessageVisibleToAgent(message, options?.agentId))
    .slice(-12);
  const activeDispatches = (roomState.dispatches || [])
    .filter((dispatch) => dispatch.status === 'queued' || dispatch.status === 'running')
    .slice(-20);
  const recentDispatches = (roomState.dispatches || []).slice(-20);
  const blockers = (roomState.blockers || [])
    .filter((blocker) => !blocker.resolvedAt)
    .slice(-20);

  return cloneRoomValue({
    capturedAt: Date.now(),
    memberStates: roomState.memberStates || {},
    activeDispatches,
    recentDispatches,
    managerAutoWakeEvents,
    memberWakeEvents,
    artifacts: (roomState.sharedArtifacts || []).slice(-20),
    blockers,
    plan: (roomState.plan || []).slice(-50),
    relatedEvents,
  });
}

export function appendManagerNote(
  teamId: string,
  note: Omit<ManagerNote, 'timestamp'>,
): void {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team) return;
  team.managerNotes = [
    ...(team.managerNotes || []),
    { ...note, timestamp: Date.now() },
  ].slice(-200); // keep last 200 notes
  saveManagedTeam(team);
}

// ─── Change Management ─────────────────────────────────────────────────────────

export function proposeTeamChange(teamId: string, change: Omit<TeamChange, 'id' | 'proposedAt' | 'status'>): TeamChange | null {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team) return null;
  const type = normalizeTeamChangeType((change as any).type, (change as any)?.diff?.field);
  if (!type) return null;

  const tc: TeamChange = {
    ...change,
    type,
    targetSubagentId: String((change as any)?.targetSubagentId || '').trim() || undefined,
    description: String((change as any)?.description || '').trim() || `Change: ${type}`,
    riskLevel: normalizeRiskLevel((change as any)?.riskLevel),
    diff: normalizeDiff(type, (change as any)?.diff),
    id: `chg_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
    proposedAt: Date.now(),
    status: 'pending',
  };

  team.pendingChanges = [...(team.pendingChanges || []), tc];
  saveManagedTeam(team);
  return tc;
}

export function applyTeamChange(teamId: string, changeId: string): TeamChange | null {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team) return null;

  const idx = team.pendingChanges.findIndex(c => c.id === changeId);
  if (idx === -1) return null;

  const change = { ...team.pendingChanges[idx], status: 'applied' as const, appliedAt: Date.now() };
  team.pendingChanges.splice(idx, 1);
  team.changeHistory = [...(team.changeHistory || []), change].slice(-100);
  saveManagedTeam(team);
  return change;
}

export function rejectTeamChange(teamId: string, changeId: string): TeamChange | null {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team) return null;

  const idx = team.pendingChanges.findIndex(c => c.id === changeId);
  if (idx === -1) return null;

  const change = { ...team.pendingChanges[idx], status: 'rejected' as const, rejectedAt: Date.now() };
  team.pendingChanges.splice(idx, 1);
  team.changeHistory = [...(team.changeHistory || []), change].slice(-100);
  saveManagedTeam(team);
  return change;
}

export function listTeamContextReferences(teamId: string): TeamContextReference[] {
  const team = getManagedTeam(teamId);
  if (!team) return [];
  const refs = normalizeContextReferenceList(team.contextReferences || []);
  return refs.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function addTeamContextReference(
  teamId: string,
  input: { title: string; content: string; actor?: string },
): TeamContextReference | null {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team) return null;
  const now = Date.now();
  const title = String(input?.title || '').trim().slice(0, 120);
  const content = String(input?.content || '').trim().slice(0, 8000);
  if (!title || !content) return null;
  const actor = String(input?.actor || '').trim() || undefined;
  const next: TeamContextReference = {
    id: `ctx_${now.toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
    title,
    content,
    createdAt: now,
    updatedAt: now,
    createdBy: actor,
    updatedBy: actor,
  };
  const refs = normalizeContextReferenceList(team.contextReferences || []);
  team.contextReferences = [...refs, next].slice(-200);
  saveManagedTeam(team);
  return next;
}

export function updateTeamContextReference(
  teamId: string,
  refId: string,
  patch: { title?: string; content?: string; actor?: string },
): TeamContextReference | null {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team) return null;
  const refs = normalizeContextReferenceList(team.contextReferences || []);
  const idx = refs.findIndex(r => r.id === refId);
  if (idx === -1) return null;
  const existing = refs[idx];
  const title = patch.title !== undefined ? String(patch.title || '').trim().slice(0, 120) : existing.title;
  const content = patch.content !== undefined ? String(patch.content || '').trim().slice(0, 8000) : existing.content;
  if (!title || !content) return null;
  refs[idx] = {
    ...existing,
    title,
    content,
    updatedAt: Date.now(),
    updatedBy: String(patch.actor || '').trim() || existing.updatedBy,
  };
  team.contextReferences = refs;
  saveManagedTeam(team);
  return refs[idx];
}

export function deleteTeamContextReference(teamId: string, refId: string): boolean {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team) return false;
  const refs = normalizeContextReferenceList(team.contextReferences || []);
  const next = refs.filter(r => r.id !== refId);
  if (next.length === refs.length) return false;
  team.contextReferences = next;
  saveManagedTeam(team);
  return true;
}

export function buildTeamContextRuntimeBlock(team: ManagedTeam): string {
  const refs = normalizeContextReferenceList(team.contextReferences || []);
  const parts: string[] = [];
  if (refs.length > 0) {
    parts.push(
      `[TEAM CONTEXT REFERENCES - TEAM ID: ${team.id}]`,
      'These references are shared context for the whole team.',
      'If you update them via tools, append or edit carefully and do not remove existing entries unless explicitly told.',
      ...refs.map((ref, idx) => {
        const updated = new Date(ref.updatedAt).toISOString();
        return `${idx + 1}. [${ref.id}] ${ref.title} (updated ${updated})\n${ref.content}`;
      }),
    );
  }
  const legacy = String(team.contextNotes || '').trim();
  if (legacy) {
    parts.push('[LEGACY TEAM CONTEXT NOTES]', legacy);
  }
  return parts.join('\n\n').trim();
}

// ─── Team Membership Helpers ───────────────────────────────────────────────────

/**
 * Returns the teamId for an agentId if it belongs to a managed team, else null.
 * Used by the schedule/tasks page to filter out team-owned agents.
 */
export function getAgentTeamId(agentId: string): string | null {
  const teams = listManagedTeams();
  for (const team of teams) {
    if (team.subagentIds.includes(agentId)) return team.id;
  }
  return null;
}

/**
 * Returns all agentIds that are members of any managed team.
 * Used to filter the schedule page.
 */
export function getTeamMemberAgentIds(): Set<string> {
  const teams = listManagedTeams();
  const ids = new Set<string>();
  for (const team of teams) {
    for (const id of team.subagentIds) ids.add(id);
  }
  return ids;
}

/**
 * Get the team that owns a given agentId.
 */
export function getTeamForAgent(agentId: string): ManagedTeam | null {
  const teams = listManagedTeams();
  return teams.find(t => t.subagentIds.includes(agentId)) ?? null;
}

// ─── Issue 9: Run History (team-scoped, persisted) ─────────────────────────────

/**
 * Record a completed subagent run in the team's own run history.
 * This is the fix for Issue 9 — previously recordTeamRun only incremented
 * totalRuns and was never called. Now it writes a full TeamRunEntry that
 * survives restarts and enables health computation.
 */
export function recordTeamRun(
  teamId: string,
  entry: Omit<TeamRunEntry, 'id'>,
): TeamRunEntry | null {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team) return null;

  const saved: TeamRunEntry = {
    ...entry,
    id: `tr_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
  };

  team.runHistory = [...(team.runHistory || []), saved].slice(-MAX_TEAM_RUN_HISTORY);
  team.totalRuns = (team.totalRuns || 0) + 1;
  team.lastActivityAt = entry.finishedAt || Date.now();
  saveManagedTeam(team);
  return saved;
}

/**
 * Get the team's run history (newest last), optionally filtered by agentId.
 */
export function getTeamRunHistory(teamId: string, limit = 50, agentId?: string): TeamRunEntry[] {
  const team = getManagedTeam(teamId);
  if (!team) return [];
  let history = Array.isArray(team.runHistory) ? team.runHistory : [];
  if (agentId) history = history.filter(r => r.agentId === agentId);
  return history.slice(-limit);
}

export function addTeamNotificationTarget(
  teamId: string,
  target: { channel: 'telegram' | 'discord' | 'whatsapp'; peerId: string; source?: string },
): boolean {
  const peerId = String(target?.peerId || '').trim();
  if (!peerId) return false;
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team) return false;
  const list = Array.isArray(team.notificationTargets) ? [...team.notificationTargets] : [];
  const exists = list.some(t => t.channel === target.channel && String(t.peerId) === peerId);
  if (!exists) {
    list.push({
      channel: target.channel,
      peerId,
      addedAt: Date.now(),
      source: target.source,
    });
    team.notificationTargets = list.slice(-50);
    saveManagedTeam(team);
  }
  return true;
}

export function getTeamNotificationTargets(
  teamId: string,
  channel?: 'telegram' | 'discord' | 'whatsapp',
): Array<{ channel: 'telegram' | 'discord' | 'whatsapp'; peerId: string; addedAt: number; source?: string }> {
  const team = getManagedTeam(teamId);
  if (!team) return [];
  const list = Array.isArray(team.notificationTargets) ? team.notificationTargets : [];
  if (!channel) return list;
  return list.filter(t => t.channel === channel);
}

// ── Agent-to-Agent Message Queues ─────────────────────────────────────────────────
// Messages persist in managed-teams.json so they survive gateway restarts.
// manager → subagent: queueAgentMessage / drainAgentMessages
// subagent → manager: queueManagerMessage / drainManagerMessages

// ─── HEARTBEAT.md one-off task helpers ───────────────────────────────────────
// One-off tasks queued by the manager are written into the agent's HEARTBEAT.md
// inside a clearly delimited block. When the scheduled cron fires and the agent
// reads HEARTBEAT.md, it sees and executes the task. After the run, the heartbeat
// runner calls pruneHeartbeatOneOffTasks() to strip the completed block so the
// task never repeats. Immediate dispatches also still inject the message via
// callerContext (drainAgentMessages), so both paths work correctly.

const ONE_OFF_SECTION_START = '## [ONE-OFF TASKS — auto-removed after run]';
const ONE_OFF_TASK_PREFIX = '<!-- one_off_task:';
const ONE_OFF_TASK_SUFFIX = ' -->';
const ONE_OFF_TASK_END = '<!-- /one_off_task -->';

/**
 * Append a one-off task block to the agent's HEARTBEAT.md.
 * The block is delimited so pruneHeartbeatOneOffTasks() can remove it cleanly.
 */
function appendOneOffTaskToHeartbeat(agentId: string, message: string): void {
  try {
    const agent = getAgentById(agentId);
    if (!agent) return;
    const workspace = ensureAgentWorkspace(agent as any);
    const heartbeatPath = path.join(workspace, 'HEARTBEAT.md');

    // Read existing content (or start fresh)
    let existing = '';
    try { existing = fs.readFileSync(heartbeatPath, 'utf-8'); } catch { existing = ''; }

    const taskId = `${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
    const timestamp = new Date().toISOString();

    // Build the one-off block
    const block = [
      '',
      ONE_OFF_SECTION_START,
      `${ONE_OFF_TASK_PREFIX}${taskId}${ONE_OFF_TASK_SUFFIX}`,
      `*Queued by manager at ${timestamp} — execute once, then this block is auto-removed.*`,
      '',
      String(message).trim(),
      '',
      ONE_OFF_TASK_END,
      '',
    ].join('\n');

    // Only add the section if it's not already present; otherwise append the block
    if (existing.includes(ONE_OFF_SECTION_START)) {
      // Insert before the last occurrence of the end tag so tasks stack cleanly
      const insertAt = existing.lastIndexOf(ONE_OFF_TASK_END);
      if (insertAt !== -1) {
        const newBlock = [
          '',
          `${ONE_OFF_TASK_PREFIX}${taskId}${ONE_OFF_TASK_SUFFIX}`,
          `*Queued by manager at ${timestamp} — execute once, then this block is auto-removed.*`,
          '',
          String(message).trim(),
          '',
          ONE_OFF_TASK_END,
        ].join('\n');
        existing = existing.slice(0, insertAt + ONE_OFF_TASK_END.length) + newBlock + existing.slice(insertAt + ONE_OFF_TASK_END.length);
        fs.writeFileSync(heartbeatPath, existing, 'utf-8');
      } else {
        fs.appendFileSync(heartbeatPath, block, 'utf-8');
      }
    } else {
      fs.appendFileSync(heartbeatPath, block, 'utf-8');
    }

    console.log(`[ManagedTeams] One-off task written to HEARTBEAT.md for agent "${agentId}" (task_id: ${taskId})`);
  } catch (err: any) {
    console.warn(`[ManagedTeams] Could not write one-off task to HEARTBEAT.md for "${agentId}": ${err?.message}`);
  }
}

/**
 * Remove all one-off task blocks from an agent's HEARTBEAT.md after a run.
 * Called by the heartbeat runner post-completion so tasks never repeat.
 * Safe to call even if no one-off blocks are present.
 */
export function pruneHeartbeatOneOffTasks(agentId: string): boolean {
  try {
    const agent = getAgentById(agentId);
    if (!agent) return false;
    const workspace = ensureAgentWorkspace(agent as any);
    const heartbeatPath = path.join(workspace, 'HEARTBEAT.md');
    if (!fs.existsSync(heartbeatPath)) return false;

    let content = fs.readFileSync(heartbeatPath, 'utf-8');
    if (!content.includes(ONE_OFF_SECTION_START)) return false; // nothing to prune

    // Strip every <!-- one_off_task:... --> ... <!-- /one_off_task --> block,
    // plus the section header line itself when no tasks remain.
    // We use a regex that matches across newlines.
    const taskBlockRe = /<!--\s*one_off_task:[^>]*-->([\s\S]*?)<!--\s*\/one_off_task\s*-->/g;
    const pruned = content.replace(taskBlockRe, '');

    // Remove the now-empty section header if no more task blocks exist
    if (!pruned.includes(ONE_OFF_TASK_PREFIX)) {
      const sectionHeaderRe = new RegExp(
        '\\n?' + ONE_OFF_SECTION_START.replace(/[[\]]/g, '\\$&') + '\\n?',
        'g',
      );
      const final = pruned.replace(sectionHeaderRe, '\n').replace(/\n{3,}/g, '\n\n').trimEnd();
      fs.writeFileSync(heartbeatPath, final + '\n', 'utf-8');
    } else {
      fs.writeFileSync(heartbeatPath, pruned.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n', 'utf-8');
    }

    console.log(`[ManagedTeams] Pruned one-off tasks from HEARTBEAT.md for agent "${agentId}"`);
    return true;
  } catch (err: any) {
    console.warn(`[ManagedTeams] Could not prune HEARTBEAT.md for "${agentId}": ${err?.message}`);
    return false;
  }
}

/**
 * Queue a message from the manager (or main agent) to a specific subagent.
 *
 * Two-path delivery:
 *   1. Stored in managed-teams.json → drained at immediate dispatch time and
 *      injected into callerContext (existing behaviour, unchanged).
 *   2. Also written to the agent's HEARTBEAT.md as a one-off task block →
 *      the scheduled cron run picks it up automatically on next tick.
 *      After the heartbeat run completes, pruneHeartbeatOneOffTasks() strips
 *      the block so it never repeats.
 *
 * This means queued messages work for BOTH immediate dispatch AND scheduled runs.
 */
export function queueAgentMessage(teamId: string, agentId: string, message: string): boolean {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team) return false;
  if (!team.pendingMessages) team.pendingMessages = {};
  if (!team.pendingMessages[agentId]) team.pendingMessages[agentId] = [];
  team.pendingMessages[agentId].push(String(message).slice(0, 2000));
  // Cap at 10 queued messages per agent to prevent unbounded growth
  team.pendingMessages[agentId] = team.pendingMessages[agentId].slice(-10);
  saveManagedTeam(team);

  // Also write to HEARTBEAT.md so the next scheduled cron run sees it
  appendOneOffTaskToHeartbeat(agentId, String(message).slice(0, 2000));

  return true;
}

export function peekAgentMessages(teamId: string, agentId: string): string[] {
  const team = getManagedTeam(teamId);
  if (!team) return [];
  const messages = team.pendingMessages?.[agentId];
  return Array.isArray(messages) ? [...messages] : [];
}

export function hasPendingAgentMessages(teamId: string, agentId: string): boolean {
  return peekAgentMessages(teamId, agentId).length > 0;
}

/**
 * Drain all pending messages for a specific subagent.
 * Called at dispatch time — returns the messages and clears the queue.
 *
 * Also prunes any one-off task blocks from the agent's HEARTBEAT.md immediately.
 * This prevents a race where the manager queues a task, immediately dispatches it,
 * and then the next scheduled cron run finds the same task still in HEARTBEAT.md
 * and re-executes it.
 */
export function drainAgentMessages(teamId: string, agentId: string): string[] {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team || !team.pendingMessages?.[agentId]?.length) return [];
  const messages = [...team.pendingMessages[agentId]];
  team.pendingMessages[agentId] = [];
  saveManagedTeam(team);

  // Clear the one-off blocks from HEARTBEAT.md now that we're dispatching immediately.
  // The heartbeat runner would also do this post-run, but clearing here ensures the
  // cron tick can't pick up a task that's already being executed via direct dispatch.
  try {
    pruneHeartbeatOneOffTasks(agentId);
  } catch { /* non-fatal */ }

  return messages;
}

/**
 * Queue a message from a subagent to the team manager.
 * The message is injected into the manager's next review context.
 */
export function queueManagerMessage(teamId: string, fromAgentId: string, message: string): boolean {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team) return false;
  const roomState = ensureTeamRoomState(team);
  if (!team.pendingManagerMessages) team.pendingManagerMessages = [];
  const entry = `[From ${fromAgentId}]: ${String(message).slice(0, 1500)}`;
  team.pendingManagerMessages.push(entry);
  // Cap at 20 messages to prevent unbounded growth
  team.pendingManagerMessages = team.pendingManagerMessages.slice(-20);
  const fromAgent = getAgentById(fromAgentId) as any;
  roomState.managerInbox = [
    ...(roomState.managerInbox || []),
    {
      id: `inbox_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
      fromAgentId: String(fromAgentId || '').trim() || undefined,
      fromName: String(fromAgent?.name || fromAgentId || 'Subagent').trim().slice(0, 120),
      content: String(message).slice(0, 1500),
      createdAt: Date.now(),
    },
  ].slice(-100);
  saveManagedTeam(team);
  return true;
}

/**
 * Drain all pending messages to the manager.
 * Called at the start of each manager review — returns messages and clears the queue.
 */
export function drainManagerMessages(teamId: string): string[] {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team || !team.pendingManagerMessages?.length) return [];
  const roomState = ensureTeamRoomState(team);
  const messages = [...team.pendingManagerMessages];
  team.pendingManagerMessages = [];
  roomState.managerInbox = (roomState.managerInbox || []).map((entry) =>
    entry.drainedAt ? entry : { ...entry, drainedAt: Date.now() }
  );
  saveManagedTeam(team);
  return messages;
}

/**
 * Get pending message counts for a team (for UI display and health checks).
 */
export function getPendingMessageCounts(teamId: string): { toManager: number; toAgents: Record<string, number> } {
  const team = getManagedTeam(teamId);
  if (!team) return { toManager: 0, toAgents: {} };
  const toManager = team.pendingManagerMessages?.length ?? 0;
  const toAgents: Record<string, number> = {};
  for (const [agentId, msgs] of Object.entries(team.pendingMessages ?? {})) {
    if (msgs.length > 0) toAgents[agentId] = msgs.length;
  }
  return { toManager, toAgents };
}

export function updateTeamMemberState(
  teamId: string,
  agentId: string,
  patch: {
    status?: TeamMemberPresenceState | string;
    currentTask?: string;
    blockedReason?: string;
    lastResult?: string;
  },
): TeamMemberState | null {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team) return null;
  const roomState = ensureTeamRoomState(team);
  const current = roomState.memberStates[agentId] || normalizeTeamMemberStateRecord({}, agentId);
  const next: TeamMemberState = {
    ...current,
    status: normalizeTeamMemberPresenceState(patch.status || current.status),
    currentTask: patch.currentTask !== undefined
      ? (String(patch.currentTask || '').trim().slice(0, 500) || undefined)
      : current.currentTask,
    blockedReason: patch.blockedReason !== undefined
      ? (String(patch.blockedReason || '').trim().slice(0, 500) || undefined)
      : current.blockedReason,
    lastResult: patch.lastResult !== undefined
      ? (String(patch.lastResult || '').trim().slice(0, 1000) || undefined)
      : current.lastResult,
    lastUpdateAt: Date.now(),
  };
  roomState.memberStates[agentId] = next;
  saveManagedTeam(team);
  return next;
}

export function upsertTeamPlanItem(
  teamId: string,
  input: {
    goalId?: string;
    description: string;
    priority?: TeamPlanPriority | string;
    status?: TeamPlanStatus | string;
    ownerAgentId?: string;
    reason?: string;
    createdBy?: string;
  },
): TeamPlanItem | null {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team) return null;
  const roomState = ensureTeamRoomState(team);
  const description = String(input.description || '').trim().slice(0, 500);
  if (!description) return null;
  const goalId = String(input.goalId || '').trim();
  const now = Date.now();
  const idx = goalId ? roomState.plan.findIndex((item) => item.id === goalId) : -1;
  if (idx >= 0) {
    roomState.plan[idx] = {
      ...roomState.plan[idx],
      description,
      priority: normalizeTeamPlanPriority(input.priority || roomState.plan[idx].priority),
      status: normalizeTeamPlanStatus(input.status || roomState.plan[idx].status),
      ownerAgentId: input.ownerAgentId !== undefined
        ? (String(input.ownerAgentId || '').trim() || undefined)
        : roomState.plan[idx].ownerAgentId,
      reason: input.reason !== undefined
        ? (String(input.reason || '').trim().slice(0, 500) || undefined)
        : roomState.plan[idx].reason,
      updatedAt: now,
    };
    saveManagedTeam(team);
    return roomState.plan[idx];
  }
  const created: TeamPlanItem = {
    id: `plan_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
    description,
    priority: normalizeTeamPlanPriority(input.priority),
    status: normalizeTeamPlanStatus(input.status || 'active'),
    ownerAgentId: String(input.ownerAgentId || '').trim() || undefined,
    reason: String(input.reason || '').trim().slice(0, 500) || undefined,
    createdBy: String(input.createdBy || '').trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  roomState.plan = [...(roomState.plan || []), created].slice(-100);
  saveManagedTeam(team);
  return created;
}

export function shareTeamArtifact(
  teamId: string,
  input: {
    name: string;
    type?: string;
    description?: string;
    content?: string;
    path?: string;
    createdBy: string;
  },
): TeamSharedArtifact | null {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team) return null;
  const roomState = ensureTeamRoomState(team);
  const name = String(input.name || '').trim().slice(0, 200);
  if (!name) return null;
  const artifact: TeamSharedArtifact = {
    id: `artifact_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
    name,
    type: String(input.type || 'data').trim().slice(0, 80),
    description: String(input.description || '').trim().slice(0, 500) || undefined,
    content: String(input.content || '').trim().slice(0, 4000) || undefined,
    path: String(input.path || '').trim().slice(0, 500) || undefined,
    createdBy: String(input.createdBy || 'system').trim().slice(0, 120),
    createdAt: Date.now(),
  };
  roomState.sharedArtifacts = [...(roomState.sharedArtifacts || []), artifact].slice(-100);
  saveManagedTeam(team);
  return artifact;
}

export function createTeamDispatchRecord(
  teamId: string,
  input: {
    agentId: string;
    agentName?: string;
    taskSummary: string;
    requestedBy?: string;
    taskId?: string;
  },
): TeamDispatchRecord | null {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team) return null;
  const roomState = ensureTeamRoomState(team);
  const agentId = String(input.agentId || '').trim();
  const taskSummary = String(input.taskSummary || '').trim().slice(0, 1000);
  if (!agentId || !taskSummary) return null;
  const dispatch: TeamDispatchRecord = {
    id: `dispatch_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
    agentId,
    agentName: String(input.agentName || agentId).trim().slice(0, 120),
    taskSummary,
    status: 'queued',
    requestedBy: String(input.requestedBy || '').trim() || undefined,
    taskId: String(input.taskId || '').trim() || undefined,
    createdAt: Date.now(),
  };
  roomState.dispatches = [...(roomState.dispatches || []), dispatch].slice(-200);
  saveManagedTeam(team);
  return dispatch;
}

export function updateTeamDispatchRecord(
  teamId: string,
  dispatchId: string,
  patch: {
    status?: TeamDispatchStatus | string;
    taskId?: string;
    startedAt?: number;
    finishedAt?: number;
    resultPreview?: string;
  },
): TeamDispatchRecord | null {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team) return null;
  const roomState = ensureTeamRoomState(team);
  const idx = roomState.dispatches.findIndex((entry) => entry.id === dispatchId);
  if (idx === -1) return null;
  roomState.dispatches[idx] = {
    ...roomState.dispatches[idx],
    status: patch.status ? normalizeTeamDispatchStatus(patch.status) : roomState.dispatches[idx].status,
    taskId: patch.taskId !== undefined ? (String(patch.taskId || '').trim() || undefined) : roomState.dispatches[idx].taskId,
    startedAt: patch.startedAt !== undefined ? patch.startedAt : roomState.dispatches[idx].startedAt,
    finishedAt: patch.finishedAt !== undefined ? patch.finishedAt : roomState.dispatches[idx].finishedAt,
    resultPreview: patch.resultPreview !== undefined
      ? (String(patch.resultPreview || '').trim().slice(0, 1500) || undefined)
      : roomState.dispatches[idx].resultPreview,
  };
  saveManagedTeam(team);
  return roomState.dispatches[idx];
}

export function setTeamRunGoal(teamId: string, runGoal: string): boolean {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team) return false;
  const roomState = ensureTeamRoomState(team);
  roomState.runGoal = String(runGoal || '').trim().slice(0, 2000);
  team.currentFocus = roomState.runGoal;
  saveManagedTeam(team);
  return true;
}

export function setTeamPurpose(teamId: string, purpose: string): boolean {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team) return false;
  const roomState = ensureTeamRoomState(team);
  roomState.purpose = String(purpose || '').trim().slice(0, 2000);
  team.purpose = roomState.purpose || undefined;
  team.mission = roomState.purpose;
  if (!String(team.teamContext || '').trim()) {
    team.teamContext = roomState.purpose;
  }
  saveManagedTeam(team);
  return true;
}

export function buildTeamRoomSummary(
  teamOrId: ManagedTeam | string,
  options?: {
    limitMessages?: number;
    agentId?: string;
    includePlan?: boolean;
    includeArtifacts?: boolean;
  },
): string {
  const team = typeof teamOrId === 'string' ? getManagedTeam(teamOrId) : teamOrId;
  if (!team) return '';
  const roomState = ensureTeamRoomState(team);
  const viewer = String(options?.agentId || '').trim();
  const relevantMessages = (roomState.roomMessages || [])
    .filter((message) => {
      if (!viewer) return true;
      if (!message.target || message.target === 'all') return true;
      return message.target === viewer || (viewer === 'manager' && message.target === 'manager');
    })
    .slice(-(options?.limitMessages || 12));

  const memberLines = team.subagentIds.map((agentId) => {
    const member = roomState.memberStates?.[agentId] || normalizeTeamMemberStateRecord({}, agentId);
    const agent = getAgentById(agentId) as any;
    const parts = [`${agent?.name || agentId}: ${member.status}`];
    if (member.currentTask) parts.push(`task=${member.currentTask}`);
    if (member.blockedReason) parts.push(`blocked=${member.blockedReason}`);
    return `  - ${parts.join(' | ')}`;
  });

  const planLines = options?.includePlan === false
    ? []
    : (roomState.plan || []).slice(-8).map((item) =>
        `  - [${item.status.toUpperCase()}|${item.priority.toUpperCase()}] ${item.description}${item.ownerAgentId ? ` (owner: ${item.ownerAgentId})` : ''}`
      );

  const artifactLines = options?.includeArtifacts
    ? (roomState.sharedArtifacts || []).slice(-5).map((artifact) =>
        `  - ${artifact.name} (${artifact.type})${artifact.path ? ` @ ${artifact.path}` : ''}`
      )
    : [];

  const blockerLines = (roomState.blockers || [])
    .filter((item) => !item.resolvedAt)
    .slice(-5)
    .map((item) => `  - ${item.fromAgentId ? `${item.fromAgentId}: ` : ''}${item.content}`);

  const lines: string[] = [
    `[TEAM ROOM SNAPSHOT]`,
    `Purpose: ${roomState.purpose || 'Not specified'}`,
    `Run goal: ${roomState.runGoal || 'Not set'}`,
    `Member states:`,
    ...(memberLines.length > 0 ? memberLines : ['  - (no members)']),
  ];

  if (planLines.length > 0) {
    lines.push(`Plan:`, ...planLines);
  }
  if (blockerLines.length > 0) {
    lines.push(`Open blockers:`, ...blockerLines);
  }
  if (artifactLines.length > 0) {
    lines.push(`Recent artifacts:`, ...artifactLines);
  }
  lines.push(`Recent room messages:`);
  if (relevantMessages.length === 0) {
    lines.push(`  - (no recent room messages)`);
  } else {
    for (const message of relevantMessages) {
      const actor = message.actorName || message.actorId || message.actorType;
      const target = message.target ? ` -> ${message.target}` : '';
      const metaBits: string[] = [];
      if (Number(message.metadata?.stepCount || 0) > 0) metaBits.push(`${Number(message.metadata?.stepCount)} tools`);
      if (Number(message.metadata?.durationMs || 0) > 0) metaBits.push(`${Math.max(1, Math.round(Number(message.metadata?.durationMs) / 1000))}s`);
      if (typeof message.metadata?.runSuccess === 'boolean') metaBits.push(message.metadata.runSuccess ? 'success' : 'failed');
      const meta = metaBits.length ? ` (${metaBits.join(', ')})` : '';
      lines.push(`  - [${actor}${target}]${meta} ${message.content.slice(0, 300)}`);
    }
  }

  return lines.join('\n');
}

// ─── Main Agent ↔ Coordinator Thread ─────────────────────────────────────────

const MAX_THREAD_MESSAGES = 100;

/**
 * Append a message to the main agent ↔ coordinator conversation thread.
 * Returns the created message, or null if team not found.
 */
export function appendMainAgentThread(
  teamId: string,
  msg: Omit<MainAgentThreadMessage, 'id' | 'timestamp'>,
): MainAgentThreadMessage | null {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team) return null;
  const entry: MainAgentThreadMessage = {
    ...msg,
    id: `mat_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
    timestamp: Date.now(),
  };
  if (!team.mainAgentThread) team.mainAgentThread = [];
  team.mainAgentThread = [...team.mainAgentThread, entry].slice(-MAX_THREAD_MESSAGES);
  saveManagedTeam(team);
  return entry;
}

/**
 * Get the main agent thread for a team.
 */
export function getMainAgentThread(teamId: string, limit = 20): MainAgentThreadMessage[] {
  const team = getManagedTeam(teamId);
  if (!team) return [];
  return (team.mainAgentThread || []).slice(-limit);
}

/**
 * Check if there are any unread messages from the coordinator waiting for main agent.
 */
export function hasUnreadCoordinatorMessages(teamId: string): boolean {
  const team = getManagedTeam(teamId);
  if (!team) return false;
  return (team.mainAgentThread || []).some(m => m.from === 'coordinator' && !m.read);
}

/**
 * Mark all coordinator messages as read (called when main agent processes them).
 */
export function markCoordinatorMessagesRead(teamId: string): void {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team || !team.mainAgentThread?.length) return;
  let changed = false;
  for (const msg of team.mainAgentThread) {
    if (msg.from === 'coordinator' && !msg.read) {
      msg.read = true;
      changed = true;
    }
  }
  if (changed) saveManagedTeam(team);
}

// ─── Per-Agent Pause Management ──────────────────────────────────────────────

/**
 * Pause an individual agent on a team.
 * Different from team-level pause — only this agent stops running.
 */
export function pauseTeamAgent(teamId: string, agentId: string, reason?: string): boolean {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team) return false;
  if (!team.agentPauseStates) team.agentPauseStates = {};
  team.agentPauseStates[agentId] = {
    paused: true,
    pausedAt: Date.now(),
    pauseReason: reason,
  };
  saveManagedTeam(team);
  return true;
}

/**
 * Unpause an individual agent on a team.
 */
export function unpauseTeamAgent(teamId: string, agentId: string): boolean {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team) return false;
  if (!team.agentPauseStates) team.agentPauseStates = {};
  team.agentPauseStates[agentId] = { paused: false };
  saveManagedTeam(team);
  return true;
}

/**
 * Check if a specific agent is paused on a team.
 */
export function isAgentPaused(teamId: string, agentId: string): boolean {
  const team = getManagedTeam(teamId);
  if (!team) return false;
  return team.agentPauseStates?.[agentId]?.paused === true;
}

// ─── Structured Goal Helpers ──────────────────────────────────────────────────

/**
 * Update the team's current focus.
 */
export function updateTeamFocus(teamId: string, newFocus: string): boolean {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team) return false;
  const roomState = ensureTeamRoomState(team);
  roomState.runGoal = String(newFocus || '').trim().slice(0, 2000);
  team.currentFocus = roomState.runGoal;
  saveManagedTeam(team);
  return true;
}

/**
 * Update the team's mission.
 */
export function updateTeamMission(teamId: string, newMission: string): boolean {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team) return false;
  const roomState = ensureTeamRoomState(team);
  roomState.purpose = String(newMission || '').trim().slice(0, 2000);
  team.purpose = roomState.purpose || undefined;
  team.mission = roomState.purpose;
  if (!String(team.teamContext || '').trim()) {
    team.teamContext = roomState.purpose;
  }
  saveManagedTeam(team);
  return true;
}

/**
 * Log completed work. Capped at 50 entries; oldest entries compacted.
 */
export function logCompletedWork(teamId: string, entry: string): boolean {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team) return false;
  if (!team.completedWork) team.completedWork = [];
  team.completedWork.push(`[${new Date().toISOString()}] ${String(entry).trim().slice(0, 500)}`);
  team.completedWork = team.completedWork.slice(-50);
  saveManagedTeam(team);
  return true;
}

/**
 * Add a milestone to the team (project mode).
 */
export function addTeamMilestone(
  teamId: string,
  milestone: Omit<TeamMilestone, 'id' | 'createdAt'>,
): TeamMilestone | null {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team) return null;
  const entry: TeamMilestone = {
    ...milestone,
    id: `ms_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
    createdAt: Date.now(),
  };
  if (!team.milestones) team.milestones = [];
  team.milestones.push(entry);
  saveManagedTeam(team);
  return entry;
}

/**
 * Update a milestone's status.
 */
export function updateTeamMilestone(
  teamId: string,
  milestoneId: string,
  updates: Partial<Pick<TeamMilestone, 'status' | 'description' | 'relevantAgentIds'>>,
): TeamMilestone | null {
  invalidateCache();
  const team = getManagedTeam(teamId);
  if (!team || !team.milestones) return null;
  const ms = team.milestones.find(m => m.id === milestoneId);
  if (!ms) return null;
  if (updates.status !== undefined) ms.status = updates.status;
  if (updates.description !== undefined) ms.description = updates.description;
  if (updates.relevantAgentIds !== undefined) ms.relevantAgentIds = updates.relevantAgentIds;
  if (updates.status === 'complete') ms.completedAt = Date.now();
  saveManagedTeam(team);
  return ms;
}
