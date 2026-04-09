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
import { getAgentById, ensureAgentWorkspace } from '../../config/config.js';

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
    runId?: string;
    agentId?: string;
    runSuccess?: boolean;
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
}

const MAX_TEAM_RUN_HISTORY = 200;

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
  const base = path.join(process.cwd(), '.prometheus');
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

      return {
        ...team,
        pendingChanges: pendingNormalized,
        changeHistory: historyNormalized,
        contextReferences: refsNormalized,
        // Ensure runHistory is always an array (backwards-compat with older JSON)
        runHistory: Array.isArray(team.runHistory) ? team.runHistory : [],
      } as ManagedTeam;
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
    pendingChanges: [],
    changeHistory: [],
    runHistory: [],
    totalRuns: 0,
    createdAt: now,
    updatedAt: now,
    notificationTargets: [],
    originatingSessionId: input.originatingSessionId,
  };
  saveManagedTeam(team);

  // Initialize memory files for the purpose→task workflow
  try {
    const { initTeamMemoryFiles } = require('../teams/team-workspace');
    initTeamMemoryFiles(team.id);
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

  team.teamChat = [...(team.teamChat || []), msg].slice(-500); // keep last 500 messages
  saveManagedTeam(team);
  return msg;
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
  if (!team.pendingManagerMessages) team.pendingManagerMessages = [];
  const entry = `[From ${fromAgentId}]: ${String(message).slice(0, 1500)}`;
  team.pendingManagerMessages.push(entry);
  // Cap at 20 messages to prevent unbounded growth
  team.pendingManagerMessages = team.pendingManagerMessages.slice(-20);
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
  const messages = [...team.pendingManagerMessages];
  team.pendingManagerMessages = [];
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
  team.currentFocus = String(newFocus || '').trim().slice(0, 2000);
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
  team.mission = String(newMission || '').trim().slice(0, 2000);
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
