/**
 * cron-scheduler.ts — Prometheus Tasks / Cron System
 *
 * Design constraints (4B model reality):
 *  - One task at a time, no parallelism
 *  - Minimal cron parsing — handles the 90% patterns without external deps
 *  - HEARTBEAT_OK response is silently suppressed
 *  - Any real content → creates an automated chat session broadcast over WS
 *  - Telegram stub: deliverTelegram() is a no-op with a clear TODO marker
 */

import fs from 'fs';
import path from 'path';
import { Cron } from 'croner';
import { BackgroundTaskRunner } from '../tasks/background-task-runner';
import { addMessage, clearHistory, getSession, setWorkspace } from '../session';
import { ensureAgentWorkspace, getAgentById, getConfig } from '../../config/config';
import { recordAgentRun } from '../../scheduler';
import { buildSelfReflectionInstruction } from '../../config/self-reflection.js';
import { loadScheduleMemory, formatScheduleMemoryForPrompt, startRunLogEntry, completeScheduledRun, addLearnedContext, setNote } from './schedule-memory';
import { ensureScheduleOwnerAgent, ensureScheduleRuntimeForAgent } from './schedule-agent';
import { appendSubagentChatMessage, getSubagentChatHistory } from '../agents-runtime/subagent-chat-store';
import {
  createTask,
  loadTask,
  saveTask,
  updateTaskStatus,
  setTaskStepRunning,
  updateTaskRuntimeProgress,
  appendJournal,
  writeToEvidenceBus,
  mutatePlan,
  type TaskPlanStep,
} from '../tasks/task-store';
import {
  getAgentTeamId,
  appendTeamChat,
  getManagedTeam,
  saveManagedTeam,
  type ManagedTeam,
} from '../teams/managed-teams';
import { runTeamAgentViaChat } from '../teams/team-dispatch-runtime';
import { triggerManagerReview } from '../teams/team-manager-runner';
import { broadcastTeamEvent } from '../comms/broadcaster';
import { registerLiveRuntime, finishLiveRuntime } from '../live-runtime-registry';
import {
  buildMissingSourceBlockMessage,
  buildObsoleteBrandBlockMessage,
  containsObsoleteProductBrand,
  extractPromptRequiredWorkspaceReads,
  normalizeWorkspaceAliasPath,
} from '../scheduled-output-guard';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface CronJob {
  id: string;
  name: string;
  prompt: string;
  type: 'one-shot' | 'recurring' | 'heartbeat';
  schedule: string | null;   // Cron expression (5 or 6 fields), e.g. "*/30 * * * *"
  tz?: string;               // Optional IANA timezone (e.g. "America/New_York")
  sessionTarget: 'main' | 'isolated';       // default: isolated
  payloadKind: 'agentTurn' | 'systemEvent'; // default: agentTurn
  systemEventText?: string;                  // used when payloadKind=systemEvent
  model?: string;                            // optional per-job model override
  subagent_id?: string;      // optional: ID of a subagent definition in workspace/.prometheus/subagents/
  runAt: string | null;      // ISO timestamp for one-shots
  enabled: boolean;
  priority: number;          // lower number = higher priority
  delivery: 'web';           // 'telegram' coming later — stub is ready
  lastRun: string | null;
  lastResult: string | null;
  lastDuration: number | null;
  consecutiveErrors?: number;
  deleteAfterRun?: boolean;
  nextRun: string | null;
  status: 'scheduled' | 'queued' | 'running' | 'completed' | 'paused';
  pausedReason?: 'manual' | 'interrupted_by_schedule';
  lastOutputSessionId: string | null;  // last auto-created session containing output
  expectedOutputs?: Array<{
    path: string;
    requiredText?: string;
    absentText?: string;
  }>;
  createdAt: string;
}

export interface HeartbeatConfig {
  enabled: boolean;
  intervalMinutes: number;
  activeHoursStart: number; // 0–23
  activeHoursEnd: number;   // 0–23
}

export interface CronStore {
  heartbeat: HeartbeatConfig;
  jobs: CronJob[];
}

let _cronSchedulerInstance: CronScheduler | null = null;

export function setCronSchedulerInstance(scheduler: CronScheduler): void {
  _cronSchedulerInstance = scheduler;
}

export function getCronSchedulerInstance(): CronScheduler | null {
  return _cronSchedulerInstance;
}

export interface AutomatedSession {
  id: string;
  title: string;
  jobName: string;
  jobId: string;
  history: Array<{ role: string; content: string }>;
  automated: true;
  createdAt: number;
}

export interface RunJobNowOptions {
  // Default false for direct user-triggered runs.
  // Automated recovery callers should pass true.
  respectActiveHours?: boolean;
}

function buildScheduledTaskPlan(job: CronJob): TaskPlanStep[] {
  const prompt = String(job.prompt || '');
  const lower = prompt.toLowerCase();
  const descriptions: string[] = ['Prepare scheduled run context and activate required tools'];

  if (lower.includes('source-preferences.md') || lower.includes('read first')) {
    descriptions.push('Read or seed required workspace source files');
  }
  if (lower.includes('x.com/home') || lower.includes('browser') || lower.includes('collect')) {
    descriptions.push('Collect the bounded browser/source sample without side effects');
  }
  if (lower.includes('search') || lower.includes('targeted')) {
    descriptions.push('Run targeted searches and extract concrete signals');
  }
  if (lower.includes('output files') || lower.includes('write workspace') || lower.includes('save both')) {
    descriptions.push('Write the required workspace output files');
  }
  if (lower.includes('verify') || lower.includes('read_file') || lower.includes('completion')) {
    descriptions.push('Verify outputs and record completion or blockers');
  }

  if (descriptions.length < 3) {
    descriptions.push('Execute the scheduled prompt');
    descriptions.push('Deliver the final scheduled-task result');
  }

  return Array.from(new Set(descriptions)).slice(0, 8).map((description, index) => ({
    index,
    description,
    status: 'pending',
  }));
}

type JobRunStatus = 'ok' | 'success' | 'error';

const TOP_OF_HOUR_STAGGER_MS = 5 * 60 * 1000;
const TASK_TERMINAL_STATUSES = new Set(['complete', 'failed', 'needs_assistance', 'awaiting_user_input', 'paused', 'stalled']);
const RUN_HISTORY_COMPACTION_DELAY_MS = 15 * 1000;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function sanitizeAgentIdForSession(agentId: string): string {
  return String(agentId || '').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120) || 'agent';
}

function getSubagentChatSessionId(agentId: string): string {
  return `subagent_chat_${sanitizeAgentIdForSession(agentId)}`;
}

function loadAgentIdentityPrompt(agentWorkspace: string): string {
  const candidates = [
    path.join(agentWorkspace, 'system_prompt.md'),
    path.join(agentWorkspace, 'AGENTS.md'),
    path.join(agentWorkspace, 'HEARTBEAT.md'),
  ];
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const content = fs.readFileSync(candidate, 'utf-8').trim();
      if (content) return content;
    } catch {
      // Keep falling back when a prompt file is unreadable.
    }
  }
  return '';
}

function buildScheduleOwnerCallerContext(agentId: string, agent: any, mainWorkspace: string, artifactWorkspace: string, job: CronJob, taskId: string, runId: string): string {
  const identityPrompt = loadAgentIdentityPrompt(artifactWorkspace);
  return [
    '[SUBAGENT CHAT CONTEXT]',
    `You are running as the scheduled-job owner agent "${agent?.name || agentId}" (id: ${agentId}).`,
    'This scheduled run is a normal chat turn with a linked task card. Work live in this conversation; the task card is only the operational mirror.',
    `Schedule ID: ${job.id}`,
    `Schedule name: ${job.name}`,
    `Task card ID: ${taskId}`,
    `Schedule run ID: ${runId}`,
    `Main workspace: ${mainWorkspace}`,
    `Subagent artifact workspace: ${artifactWorkspace}`,
    'Use your prior chat history, schedule memory, and runtime files for continuity. Keep blockers and fixes explicit so future runs can build on them.',
    identityPrompt
      ? ['', 'Your configured identity prompt follows. Keep this role and scope during the scheduled run.', '', identityPrompt].join('\n')
      : 'No subagent identity file was found. Use the schedule prompt and current run context as your guide.',
    '[/SUBAGENT CHAT CONTEXT]',
  ].join('\n');
}

function seedSubagentChatSessionFromStore(agentId: string, sessionId: string, workspacePath: string): void {
  setWorkspace(sessionId, workspacePath);
  const session = getSession(sessionId);
  if (Array.isArray(session.history) && session.history.length > 0) return;

  const prior = getSubagentChatHistory(agentId, 80);
  for (const msg of prior) {
    if (msg.role !== 'user' && msg.role !== 'agent') continue;
    addMessage(sessionId, {
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: String(msg.content || ''),
      timestamp: Number(msg.ts || Date.now()) || Date.now(),
      channel: 'web',
    }, {
      disableCompactionCheck: true,
      disableMemoryFlushCheck: true,
      maxMessages: 120,
    });
  }
}

function setTaskPlanFromProgress(taskId: string, data: any): void {
  const items = Array.isArray(data?.items) ? data.items : [];
  if (!items.length) return;
  const task = loadTask(taskId);
  if (!task) return;
  const toPlanStatus = (status: any): TaskPlanStep['status'] => {
    const value = String(status || '').toLowerCase();
    if (value === 'in_progress' || value === 'running') return 'running';
    if (value === 'done' || value === 'complete') return 'done';
    if (value === 'failed') return 'failed';
    if (value === 'skipped') return 'skipped';
    return 'pending';
  };
  task.plan = items.slice(0, task.maxPlanDepth || 20).map((item: any, index: number) => ({
    index,
    description: String(item?.text || `Step ${index + 1}`).slice(0, 240),
    status: toPlanStatus(item?.status),
  }));
  const activeIndex = Number(data?.activeIndex);
  task.currentStepIndex = Number.isFinite(activeIndex) && activeIndex >= 0
    ? Math.min(activeIndex, Math.max(0, task.plan.length - 1))
    : task.currentStepIndex;
  task.lastProgressAt = Date.now();
  saveTask(task);
}

function setTaskPlanFromDeclaredSteps(taskId: string, steps: any[]): void {
  const cleanSteps = Array.isArray(steps)
    ? steps.map((step) => String(step || '').trim()).filter(Boolean).slice(0, 8)
    : [];
  if (!cleanSteps.length) return;
  const task = loadTask(taskId);
  if (!task) return;
  task.plan = cleanSteps.map((description, index) => ({
    index,
    description: description.slice(0, 240),
    status: index === 0 ? 'running' : 'pending',
  }));
  task.currentStepIndex = 0;
  task.lastProgressAt = Date.now();
  saveTask(task);
}

function mirrorChatEventToTask(
  taskId: string,
  event: string,
  data: any,
  broadcast: (data: any) => void,
  opts?: { scheduleId?: string; scheduleName?: string },
): void {
  try {
    if (event === 'tool_call') {
      const action = String(data?.action || 'unknown');
      appendJournal(taskId, {
        type: 'tool_call',
        content: `${action}(${JSON.stringify(data?.args || {}).slice(0, 120)})`,
      });
      if (action === 'declare_plan') {
        setTaskPlanFromDeclaredSteps(taskId, Array.isArray(data?.args?.steps) ? data.args.steps : []);
      }
      broadcast({ type: 'task_tool_call', taskId, tool: action, args: data?.args, scheduleId: opts?.scheduleId });
      broadcast({ type: 'task_panel_update', taskId });
      return;
    }

    if (event === 'tool_result') {
      const action = String(data?.action || 'unknown');
      const result = String(data?.result || '');
      appendJournal(taskId, {
        type: data?.error ? 'error' : 'tool_result',
        content: `${action}: ${result.slice(0, 220)}`,
        detail: result.length > 220 ? result.slice(0, 2000) : undefined,
      });
      broadcast({ type: 'task_panel_update', taskId });
      return;
    }

    if (event === 'progress_state') {
      updateTaskRuntimeProgress(taskId, {
        source: data?.source,
        activeIndex: Number(data?.activeIndex ?? -1),
        items: Array.isArray(data?.items)
          ? data.items.map((item: any, idx: number) => ({
            id: String(item?.id || `p${idx + 1}`),
            text: String(item?.text || ''),
            status: String(item?.status || 'pending') as any,
          }))
          : [],
      });
      setTaskPlanFromProgress(taskId, data);
      broadcast({ type: 'task_panel_update', taskId });
      return;
    }

    if (event === 'info' || event === 'warning' || event === 'error') {
      appendJournal(taskId, {
        type: event === 'error' ? 'error' : 'status_push',
        content: String(data?.message || data?.text || event).slice(0, 500),
      });
      broadcast({ type: 'task_panel_update', taskId });
      return;
    }

    if (event === 'final' || event === 'done') {
      const finalText = String(data?.reply || data?.text || '').trim();
      if (finalText) {
        appendJournal(taskId, {
          type: 'status_push',
          content: `Final: ${finalText.slice(0, 240)}`,
          detail: finalText.slice(0, 2000),
        });
        broadcast({ type: 'task_panel_update', taskId });
      }
    }
  } catch (err: any) {
    console.warn(`[CronScheduler] Failed to mirror ${event} into task ${taskId}:`, err?.message || err);
  }
}

function resolveMaxRunHistory(): number {
  let maxRunHistory = 200;
  try {
    const raw = Number((getConfig().getConfig() as any)?.tasks?.maxRunHistory);
    if (Number.isFinite(raw) && raw >= 10) maxRunHistory = Math.floor(raw);
  } catch {
    // keep default
  }
  return maxRunHistory;
}

async function waitForTaskTerminal(taskId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = loadTask(taskId);
    if (!task) return null;
    if (TASK_TERMINAL_STATUSES.has(String(task.status))) return task;
    await delay(1000);
  }
  return loadTask(taskId);
}

function isTopOfHourExpr(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  return parts.length === 5 && parts[0] === '0' && parts[1].includes('*');
}

function computeStaggerMs(jobId: string, schedule: string | null): number {
  if (!schedule || !isTopOfHourExpr(schedule)) return 0;
  let hash = 0;
  for (let i = 0; i < jobId.length; i++) {
    hash = ((hash << 5) - hash) + jobId.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % TOP_OF_HOUR_STAGGER_MS;
}

function applyDeterministicStagger(nextRunIso: string, jobId: string, schedule: string | null): string {
  const staggerMs = computeStaggerMs(jobId, schedule);
  if (staggerMs <= 0) return nextRunIso;
  const nextRunDate = new Date(nextRunIso);
  if (!Number.isFinite(nextRunDate.getTime())) return nextRunIso;
  return new Date(nextRunDate.getTime() + staggerMs).toISOString();
}

function getMarkdownSection(content: string, heading: string): string {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex(line => line.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start < 0) return '';
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i].trim())) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}

function hydrateManagedTeamFromWorkspaceInfo(agentId: string): ManagedTeam | null {
  const workspace = getConfig().getWorkspacePath() || process.cwd();
  const teamsRoot = path.join(workspace, 'teams');
  if (!fs.existsSync(teamsRoot)) return null;

  try {
    for (const dirent of fs.readdirSync(teamsRoot, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      const teamInfoPath = path.join(teamsRoot, dirent.name, 'workspace', 'team_info.md');
      if (!fs.existsSync(teamInfoPath)) continue;
      const content = fs.readFileSync(teamInfoPath, 'utf-8');
      const subagentIds = Array.from(content.matchAll(/\(id:\s*([^)]+)\)/g))
        .map(match => String(match[1] || '').trim())
        .filter(Boolean);
      if (!subagentIds.includes(agentId)) continue;

      const teamId = content.match(/^Team ID:\s*(\S+)/m)?.[1]?.trim() || dirent.name;
      const existing = getManagedTeam(teamId);
      if (existing) return existing;

      const title = content.match(/^#\s+(.+?)\s+Team Info\s*$/m)?.[1]?.trim() || teamId;
      const purpose = getMarkdownSection(content, 'Enduring Purpose / Mandate')
        || getMarkdownSection(content, 'What This Team Is For')
        || title;
      const now = Date.now();
      const team: ManagedTeam = {
        id: teamId,
        name: title,
        description: purpose,
        emoji: 'T',
        manager: {
          systemPrompt: `Coordinate the ${title} team. Purpose: ${purpose}`,
          reviewTrigger: 'after_each_run',
          autoApplyLowRisk: true,
          paused: false,
        },
        subagentIds,
        teamContext: purpose,
        teamMode: 'autonomous',
        mission: purpose,
        purpose,
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
        pendingMessages: {},
        pendingManagerMessages: [],
        runHistory: [],
        totalRuns: 0,
        createdAt: now,
        updatedAt: now,
        notificationTargets: [],
      };
      saveManagedTeam(team);
      console.log(`[CronScheduler] Hydrated managed team "${team.name}" (${team.id}) from ${teamInfoPath}`);
      return team;
    }
  } catch (err: any) {
    console.warn(`[CronScheduler] Failed to scan team workspaces for ${agentId}:`, err?.message || err);
  }

  return null;
}

// ─── Minimal Cron Parser ───────────────────────────────────────────────────────
// Supports: * * * * * (min hour dom month dow)
// Patterns covered:
//   */N  * * * *   → every N minutes
//   0    H * * *   → daily at hour H
//   0    H * * D   → weekly on day D at H
//   0    H 1 * *   → monthly on 1st at H
//   *    * * * *   → every minute (should not be used but handled)

export function getNextRun(cronExpr: string | null, from: Date, tz?: string): Date {
  if (!cronExpr) {
    return new Date(from.getTime() + 30 * 60 * 1000);
  }

  try {
    const cron = new Cron(cronExpr.trim(), {
      timezone: tz || Intl.DateTimeFormat().resolvedOptions().timeZone,
      catch: false,
    });
    const next = cron.nextRun(from);
    if (next && Number.isFinite(next.getTime()) && next.getTime() > from.getTime()) {
      return next;
    }
    // Guard: avoid same-second scheduling loops.
    const nextSecond = new Date(Math.floor(from.getTime() / 1000) * 1000 + 1000);
    const retry = cron.nextRun(nextSecond);
    return retry && retry.getTime() > from.getTime()
      ? retry
      : new Date(from.getTime() + 30 * 60 * 1000);
  } catch {
    return new Date(from.getTime() + 30 * 60 * 1000);
  }
}

// ─── Telegram Stub ─────────────────────────────────────────────────────────────
// TODO: Replace this stub with actual telegram delivery when implementing Telegram channel.
// The interface is already defined — just fill in the body of deliverTelegram().

async function deliverTelegram(_jobName: string, _content: string): Promise<void> {
  // STUB — Telegram not yet configured.
  // When implementing:
  //   1. Read config.channels.telegram.botToken and allowedUserIds
  //   2. POST to https://api.telegram.org/bot{token}/sendMessage
  //   3. Split content if > 4096 chars
  console.log('[CronScheduler] Telegram delivery stub called — not yet implemented');
}

// ─── CronScheduler Class ───────────────────────────────────────────────────────

interface SchedulerDeps {
  storePath: string;         // path to jobs.json
  handleChat: (          // direct reference to the handleChat function
    message: string,
    sessionId: string,
    sendSSE: (event: string, data: any) => void,
    pinnedMessages?: Array<{ role: string; content: string }>,
    abortSignal?: { aborted: boolean },
    callerContext?: string,
    modelOverride?: string,
    executionMode?: 'interactive' | 'background_task' | 'heartbeat' | 'cron',
    toolFilter?: string[]
  ) => Promise<{ type: string; text: string; thinking?: string }>;
  broadcast: (data: object) => void; // WebSocket broadcast to all clients
  deliverTelegram?: (text: string) => Promise<void>; // optional telegram delivery
  getMainSessionId?: () => string;
  getAvailableToolNames?: () => string[];
  injectSystemEvent?: (sessionId: string, text: string, job: CronJob) => void;
  // NEW: spawn a proper BackgroundTask instead of raw handleChat
  // Returns a Promise so the caller can await the task creation (including preflight plan generation)
  spawnBackgroundTask?: (job: CronJob) => Promise<{ taskId: string; sessionId: string } | null>;
}

export class CronScheduler {
  private storePath: string;
  private store: CronStore;
  private deps: SchedulerDeps;
  private tickInterval: NodeJS.Timeout | null = null;
  private runningJobId: string | null = null;
  private interruptedTasksBySchedule: Map<string, string[]> = new Map(); // scheduleId -> [taskIds]
  private pendingRunHistoryCompactions: Map<string, NodeJS.Timeout> = new Map();

  private defaultStore(): CronStore {
    return {
      heartbeat: {
        enabled: false,
        intervalMinutes: 30,
        activeHoursStart: 8,
        activeHoursEnd: 22,
      },
      jobs: [],
    };
  }

  constructor(deps: SchedulerDeps) {
    this.deps = deps;
    this.storePath = deps.storePath;
    this.store = this.loadStore();
    console.log(`[CronScheduler] Loaded ${this.store.jobs.length} jobs from ${this.storePath}`);
  }

  // ─── Store I/O ───────────────────────────────────────────────────────────────

  private loadStore(): CronStore {
    try {
      if (!fs.existsSync(this.storePath)) return this.defaultStore();
      const raw = fs.readFileSync(this.storePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const jobs = Array.isArray(parsed.jobs)
        ? parsed.jobs.map((j: any) => ({
            ...j,
            sessionTarget: j?.sessionTarget === 'main' ? 'main' : 'isolated',
            payloadKind: j?.payloadKind === 'systemEvent' ? 'systemEvent' : 'agentTurn',
            lastOutputSessionId: j?.lastOutputSessionId ?? j?.sessionId ?? null,
          }))
        : [];
      return {
        heartbeat: { ...this.defaultStore().heartbeat, ...(parsed.heartbeat || {}) },
        jobs,
      };
    } catch {
      return this.defaultStore();
    }
  }

  private saveStore(): void {
    try {
      const dir = path.dirname(this.storePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = `${this.storePath}.tmp-${Date.now()}`;
      fs.writeFileSync(tmp, JSON.stringify(this.store, null, 2), 'utf-8');
      fs.renameSync(tmp, this.storePath);
    } catch (err: any) {
      console.error('[CronScheduler] Failed to save store:', err.message);
    }
  }

  private compactRunHistory(jobId: string, filePath: string): void {
    try {
      if (!fs.existsSync(filePath)) return;
      const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/).filter(Boolean);
      const maxRunHistory = resolveMaxRunHistory();
      if (lines.length <= maxRunHistory) return;
      const trimmed = lines.slice(-maxRunHistory);
      const tmp = `${filePath}.tmp-${Date.now()}`;
      fs.writeFileSync(tmp, trimmed.join('\n') + '\n', 'utf-8');
      fs.renameSync(tmp, filePath);
    } catch (err: any) {
      console.error(`[CronScheduler] Failed to compact run history for ${jobId}:`, err?.message || err);
    }
  }

  private scheduleRunHistoryCompaction(jobId: string, filePath: string): void {
    if (this.pendingRunHistoryCompactions.has(jobId)) return;
    const timer = setTimeout(() => {
      this.pendingRunHistoryCompactions.delete(jobId);
      this.compactRunHistory(jobId, filePath);
    }, RUN_HISTORY_COMPACTION_DELAY_MS);
    if (typeof (timer as any)?.unref === 'function') {
      (timer as any).unref();
    }
    this.pendingRunHistoryCompactions.set(jobId, timer);
  }

  private appendRunHistory(jobId: string, entry: { t: string; status: JobRunStatus; duration: number; result_excerpt: string }): void {
    try {
      const baseDir = path.dirname(this.storePath);
      const runsDir = path.join(baseDir, 'runs');
      if (!fs.existsSync(runsDir)) fs.mkdirSync(runsDir, { recursive: true });
      const safeId = String(jobId || '').replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = path.join(runsDir, `${safeId}.jsonl`);
      fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
      this.scheduleRunHistoryCompaction(jobId, filePath);
    } catch (err: any) {
      console.error(`[CronScheduler] Failed to append run history for ${jobId}:`, err?.message || err);
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  getConfig(): HeartbeatConfig {
    return this.store.heartbeat;
  }

  updateConfig(partial: Partial<HeartbeatConfig>): void {
    this.store.heartbeat = { ...this.store.heartbeat, ...partial };
    this.saveStore();
    // Restart tick loop with new interval
    this.stop();
    this.start();
    this.broadcastUpdate();
  }

  createJob(partial: Partial<CronJob> & { name: string; prompt: string }): CronJob {
    const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date();
    const normalizedType: CronJob['type'] = partial.type === 'one-shot' ? 'one-shot' : 'recurring';

    const job: CronJob = {
      id,
      name: partial.name,
      prompt: partial.prompt,
      type: normalizedType,
      schedule: partial.schedule || '*/30 * * * *',
      tz: partial.tz,
      sessionTarget: partial.sessionTarget === 'main' ? 'main' : 'isolated',
      payloadKind: partial.payloadKind === 'systemEvent' ? 'systemEvent' : 'agentTurn',
      systemEventText: typeof partial.systemEventText === 'string' ? partial.systemEventText : undefined,
      model: typeof partial.model === 'string' ? partial.model : undefined,
      subagent_id: typeof partial.subagent_id === 'string' ? partial.subagent_id : undefined,
      runAt: partial.runAt || null,
      enabled: partial.enabled !== false,
      priority: typeof partial.priority === 'number' ? partial.priority : this.store.jobs.length,
      delivery: 'web',
      lastRun: null,
      lastResult: null,
      lastDuration: null,
      consecutiveErrors: 0,
      deleteAfterRun: partial.deleteAfterRun === true,
      nextRun: normalizedType === 'one-shot' && partial.runAt
        ? partial.runAt
        : applyDeterministicStagger(
            getNextRun(partial.schedule || null, now, partial.tz).toISOString(),
            id,
            partial.schedule || null
          ),
      status: 'scheduled',
      lastOutputSessionId: null,
      createdAt: now.toISOString(),
    };

    this.store.jobs.push(job);
    this.saveStore();
    this.broadcastUpdate();
    console.log(`[CronScheduler] Created job "${job.name}" (${job.id})`);
    return job;
  }

  updateJob(id: string, partial: Partial<CronJob>): CronJob | null {
    const idx = this.store.jobs.findIndex(j => j.id === id);
    if (idx === -1) return null;
    const normalizedPartial: Partial<CronJob> = { ...partial };
    if (partial.type !== undefined) {
      normalizedPartial.type = partial.type === 'one-shot' ? 'one-shot' : 'recurring';
    }
    this.store.jobs[idx] = { ...this.store.jobs[idx], ...normalizedPartial };
    // Recalculate nextRun if schedule changed
    if (partial.schedule !== undefined || partial.runAt !== undefined || partial.tz !== undefined) {
      const job = this.store.jobs[idx];
      job.nextRun = job.type === 'one-shot' && job.runAt
        ? job.runAt
        : applyDeterministicStagger(
            getNextRun(job.schedule, new Date(), job.tz).toISOString(),
            job.id,
            job.schedule
          );
    }
    this.saveStore();
    this.broadcastUpdate();
    return this.store.jobs[idx];
  }

  deleteJob(id: string): boolean {
    const before = this.store.jobs.length;
    this.store.jobs = this.store.jobs.filter(j => j.id !== id);
    if (this.store.jobs.length === before) return false;
    const pendingCompaction = this.pendingRunHistoryCompactions.get(id);
    if (pendingCompaction) {
      clearTimeout(pendingCompaction);
      this.pendingRunHistoryCompactions.delete(id);
    }
    this.saveStore();
    this.broadcastUpdate();
    return true;
  }

  reorderJobs(orderedIds: string[]): void {
    const byId = new Map(this.store.jobs.map(j => [j.id, j]));
    orderedIds.forEach((id, idx) => {
      const job = byId.get(id);
      if (job) job.priority = idx;
    });
    this.store.jobs.sort((a, b) => a.priority - b.priority);
    this.saveStore();
    this.broadcastUpdate();
  }

  async runJobNow(id: string, options: RunJobNowOptions = {}): Promise<void> {
    const job = this.store.jobs.find(j => j.id === id);
    if (!job) return;
    if (job.type === 'heartbeat') {
      console.log(`[CronScheduler] runJobNow ignored for legacy heartbeat job "${job.name}"`);
      return;
    }
    if (this.runningJobId) {
      throw new Error(`Another schedule is already running (${this.runningJobId}). Try again after it finishes.`);
    }
    if (job.status === 'running') {
      throw new Error(`Schedule "${job.name}" is already running.`);
    }
    // Run outside the normal tick: ignore model-busy guard (user explicitly requested).
    if (options.respectActiveHours && !this.isWithinActiveHours()) {
      console.log(`[CronScheduler] runJobNow skipped for "${job.name}" - outside active hours`);
      return;
    }
    await this.executeJob(job);
  }

  // ─── Scheduler Loop ──────────────────────────────────────────────────────────

  start(): void {
    if (this.tickInterval) return;
    // Tick every 10 seconds for better cron accuracy
    // 60s intervals could miss a 1-minute cron window; 10s ensures we catch every due job
    this.tickInterval = setInterval(() => this.tick(), 10 * 1000);
    console.log('[CronScheduler] Started — ticking every 10s for accurate cron execution');
  }

  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  private isWithinActiveHours(): boolean {
    const { activeHoursStart, activeHoursEnd } = this.store.heartbeat;
    const hour = new Date().getHours();
    if (activeHoursStart <= activeHoursEnd) {
      return hour >= activeHoursStart && hour < activeHoursEnd;
    }
    // Overnight range e.g. 22–6
    return hour >= activeHoursStart || hour < activeHoursEnd;
  }

  private tick(): void {
    // CRITICAL: Check if ANY cron jobs are enabled, not just heartbeat!
    // Heartbeat is a separate feature — regular cron jobs should execute independent of it.
    const hasEnabledJobs = this.store.jobs.some(j => j.enabled && j.type !== 'heartbeat');
    if (!hasEnabledJobs && !this.store.heartbeat.enabled) return;
    
    if (this.runningJobId) return; // one at a time
    // Active hours only gates the heartbeat — NOT explicit cron jobs.
    // If a user scheduled "daily at 9:59 PM", that fires regardless of active hours.
    // We only apply the active hours check when the ONLY pending work is heartbeat.
    const hasOverdueExplicitJobs = this.store.jobs.some(j =>
      j.enabled &&
      j.type !== 'heartbeat' &&
      j.status !== 'running' &&
      j.status !== 'paused' &&
      j.status !== 'completed' &&
      j.nextRun !== null &&
      new Date(j.nextRun) <= new Date()
    );
    if (!hasOverdueExplicitJobs && !this.isWithinActiveHours()) {
      // Only skip if there are no explicit cron jobs due — heartbeat respects active hours
      return;
    }

    const now = new Date();
    const overdue = this.store.jobs
      .filter(j =>
        j.enabled &&
        j.type !== 'heartbeat' &&
        j.status !== 'running' &&
        j.status !== 'paused' &&
        j.status !== 'completed' &&
        j.nextRun !== null &&
        new Date(j.nextRun) <= now
      )
      .sort((a, b) => a.priority - b.priority);

    if (overdue.length === 0) return;

    const job = overdue[0];
    console.log(`[CronScheduler] Tick — running job "${job.name}"`);
    // Fire async but don't await — tick returns immediately
    this.executeJob(job).catch(err =>
      console.error(`[CronScheduler] Job "${job.name}" crashed:`, err.message)
    );
  }

  // ─── Job Execution ────────────────────────────────────────────────────────────

  private async executeJob(job: CronJob): Promise<void> {
    this.runningJobId = job.id;
    const start = Date.now();

    // Mark as running
    job.status = 'running';
    this.saveStore();
    this.deps.broadcast({ type: 'tasks_update', jobs: this.store.jobs, config: this.store.heartbeat });
    this.deps.broadcast({ type: 'task_running', jobId: job.id, jobName: job.name });

    // Check for running background tasks and interrupt them if this schedule requires it
    const interruptedTasks: string[] = [];
    const runningTasks = BackgroundTaskRunner.getRunningTasks();
    if (runningTasks.length > 0) {
      console.log(`[CronScheduler] Schedule "${job.name}" found ${runningTasks.length} running background task(s) - interrupting...`);
      for (const taskId of runningTasks) {
        const interrupted = BackgroundTaskRunner.interruptTaskForSchedule(taskId, job.id);
        if (interrupted) {
          interruptedTasks.push(taskId);
          console.log(`[CronScheduler] Interrupted background task ${taskId} for schedule ${job.id}`);
        }
      }
      // Store interrupted tasks by schedule ID for later resumption
      if (interruptedTasks.length > 0) {
        this.interruptedTasksBySchedule.set(job.id, interruptedTasks);
      }
      // Give tasks a moment to pause at round boundary
      if (interruptedTasks.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Fake sessionId for the cron call — isolated from user sessions
    const mainSessionId = this.deps.getMainSessionId?.() || 'default';
    const targetSessionId = job.sessionTarget === 'main'
      ? mainSessionId
      : `cron_${job.id}_${Date.now()}`;
    const isolatedRunSession = job.sessionTarget !== 'main';
    let teamSubagentId = String(job.subagent_id || '').trim();
    if (!teamSubagentId) {
      try {
        const owner = ensureScheduleOwnerAgent({
          scheduleId: job.id,
          scheduleName: job.name,
          prompt: job.prompt,
          model: job.model,
        });
        job.subagent_id = owner.agentId;
        teamSubagentId = owner.agentId;
        this.saveStore();
        this.deps.broadcast({ type: 'tasks_update', jobs: this.store.jobs, config: this.store.heartbeat });
        console.log(`[CronScheduler] Assigned schedule "${job.name}" to owner subagent ${owner.agentId}`);
      } catch (err: any) {
        console.warn(`[CronScheduler] Failed to create schedule owner for "${job.name}":`, err?.message || err);
      }
    }
    let teamId = teamSubagentId ? getAgentTeamId(teamSubagentId) : null;
    let team = teamId ? getManagedTeam(teamId) : null;
    if (!team && teamSubagentId) {
      team = hydrateManagedTeamFromWorkspaceInfo(teamSubagentId);
      teamId = team?.id || null;
    }
    const teamAgentName = teamSubagentId
      ? (getAgentById(teamSubagentId)?.name || teamSubagentId)
      : '';
    if (isolatedRunSession) {
      // Defensive clear to guarantee clean isolated context for this run.
      clearHistory(targetSessionId);
    }

    // Collect SSE events emitted during the run
    const events: Array<{ type: string; data: any }> = [];
    const sendSSE = (type: string, data: any) => {
      events.push({ type, data });
      // Forward tool_call/tool_result events to UI so NOW card shows live progress
      if (['tool_call', 'tool_result', 'thinking', 'info'].includes(type)) {
        this.deps.broadcast({ type: 'task_sse', jobId: job.id, event: type, data });
      }
    };

    let resultText = '';
    let duration = 0;
    let scheduledSubagentTaskId: string | undefined;
    let activeCronTaskId: string | undefined;
    let activeRunId: string | undefined;
    let activeScheduledAt: number | undefined;

    try {
      if (job.payloadKind === 'systemEvent') {
        const text = String(job.systemEventText || job.prompt || '').trim();
        if (text) {
          this.deps.injectSystemEvent?.(targetSessionId, text, job);
          resultText = text;
        } else {
          resultText = 'SYSTEM_EVENT_EMPTY';
        }
      } else {
        const modelOverride = String(job.model || '').trim() || undefined;

        // Inject schedule memory (dedup keys + learned context only — no run summaries)
        const scheduleMem = loadScheduleMemory(job.id);
        let effectivePrompt = job.prompt;
        const memText = formatScheduleMemoryForPrompt(scheduleMem);
        if (memText) {
          effectivePrompt = [job.prompt, '', memText].join('\n');
          console.log(`[CronScheduler] Injected schedule context for "${job.name}"`);
        }

        const selfLearnInstruction = buildSelfReflectionInstruction({
          availableTools: this.deps.getAvailableToolNames?.() || [],
          mode: 'schedule',
        });
        if (selfLearnInstruction) {
          effectivePrompt = effectivePrompt + selfLearnInstruction;
        }

        if (teamSubagentId) {
          const scheduledAt = Date.now();
          const agentDef = getAgentById(teamSubagentId);
          let runId = '';
          let taskSuccess = false;
          let stepCount = 1;

          if (teamId) {
            const teamResult = await runTeamAgentViaChat(
              teamSubagentId,
              effectivePrompt,
              teamId,
              'cron'
            );
            scheduledSubagentTaskId = teamResult.taskId;
            if (scheduledSubagentTaskId) {
              runId = startRunLogEntry({ scheduleId: job.id, taskId: scheduledSubagentTaskId, scheduledAt });
            }
            resultText = teamResult.success
              ? String(teamResult.result || '').trim()
              : `ERROR: ${String(teamResult.error || teamResult.result || 'Scheduled team subagent failed').trim()}`;
            taskSuccess = teamResult.success && !/^\s*ERROR:/i.test(resultText);
            stepCount = teamResult.stepCount || 1;
          } else {
            ensureScheduleRuntimeForAgent(teamSubagentId, {
              scheduleId: job.id,
              scheduleName: job.name,
              prompt: effectivePrompt,
              model: job.model,
            });
            const agentWorkspace = agentDef ? ensureAgentWorkspace(agentDef as any) : getConfig().getWorkspacePath();
            const chatSessionId = getSubagentChatSessionId(teamSubagentId);
            seedSubagentChatSessionFromStore(teamSubagentId, chatSessionId, getConfig().getWorkspacePath());

            const cronTask = createTask({
              title: job.name,
              prompt: effectivePrompt,
              sessionId: chatSessionId,
              channel: 'web',
              scheduleId: job.id,
              taskKind: 'scheduled',
              subagentProfile: teamSubagentId,
              agentWorkspace: getConfig().getWorkspacePath(),
              plan: buildScheduledTaskPlan(job),
            });
            scheduledSubagentTaskId = cronTask.id;
            activeCronTaskId = cronTask.id;
            updateTaskStatus(cronTask.id, 'running');
            setTaskStepRunning(cronTask.id, 0);
            runId = startRunLogEntry({ scheduleId: job.id, taskId: cronTask.id, scheduledAt });
            activeRunId = runId;
            activeScheduledAt = scheduledAt;
            try {
              const linkedTask = loadTask(cronTask.id);
              if (linkedTask) {
                linkedTask.scheduleRunId = runId;
                saveTask(linkedTask);
              }
            } catch {}
            this.deps.broadcast({ type: 'task_running', taskId: cronTask.id, jobId: job.id, jobName: job.name });
            this.deps.broadcast({
              type: 'cron_task_spawned',
              jobId: job.id,
              jobName: job.name,
              taskId: cronTask.id,
              agentId: teamSubagentId,
            });

            const scheduledUserMessage = appendSubagentChatMessage(teamSubagentId, {
              role: 'user',
              content: `[Scheduled task: ${job.name}]\n\n${job.prompt}`,
              metadata: {
                source: 'schedule',
                scheduleId: job.id,
                scheduleName: job.name,
                taskId: cronTask.id,
                runId,
              },
            });
            this.deps.broadcast({
              type: 'subagent_chat_message',
              agentId: teamSubagentId,
              message: scheduledUserMessage,
            });

            const abortSignal = { aborted: false };
            const runtimeId = registerLiveRuntime({
              kind: 'cron',
              label: `Scheduled owner chat - ${job.name}`,
              sessionId: chatSessionId,
              taskId: cronTask.id,
              scheduleId: job.id,
              source: 'scheduler',
              detail: effectivePrompt.slice(0, 160),
              abortSignal,
              onAbort: () => {
                updateTaskStatus(cronTask.id, 'failed', { finalSummary: 'Aborted via Telegram /stop.' });
                appendJournal(cronTask.id, { type: 'status_push', content: 'Aborted via Telegram /stop.' });
              },
            });
            const taskSendSSE = (event: string, data: any) => {
              sendSSE(event, data);
              this.deps.broadcast({
                type: 'subagent_chat_stream_event',
                agentId: teamSubagentId,
                taskId: cronTask.id,
                scheduleId: job.id,
                scheduleName: job.name,
                event,
                data,
              });
              mirrorChatEventToTask(cronTask.id, event, data, this.deps.broadcast, {
                scheduleId: job.id,
                scheduleName: job.name,
              });

              if (event === 'tool_call' && data?.action === 'write_note') {
                const noteArgs = data.args || {};
                const noteScope = String(noteArgs.scope || '').toLowerCase();
                const noteKey = String(noteArgs.key || noteArgs.tag || 'insight').trim();
                const noteValue = String(noteArgs.value || noteArgs.content || '').trim();
                if (noteValue) {
                  writeToEvidenceBus(cronTask.id, {
                    stepIndex: Math.max(0, Number(loadTask(cronTask.id)?.currentStepIndex || 0)),
                    category: 'finding',
                    key: noteKey,
                    value: noteValue,
                  });
                  if (noteScope === 'schedule' || noteKey === 'last_run_insight') {
                    addLearnedContext(job.id, noteValue);
                  } else if (noteScope === 'note') {
                    setNote(job.id, noteKey, noteValue);
                  }
                }
              }
            };

            try {
              const requiredReads = extractPromptRequiredWorkspaceReads(effectivePrompt);
              if (requiredReads.length) {
                const workspaceRoot = getConfig().getWorkspacePath();
                const missing = requiredReads.filter((p) => {
                  const abs = path.join(workspaceRoot, normalizeWorkspaceAliasPath(p, workspaceRoot));
                  return !fs.existsSync(abs) || !fs.statSync(abs).isFile();
                });
                if (missing.length) {
                  throw new Error(buildMissingSourceBlockMessage(missing));
                }
              }

              const ownerResult = await this.deps.handleChat(
                effectivePrompt,
                chatSessionId,
                taskSendSSE,
                undefined,
                abortSignal,
                buildScheduleOwnerCallerContext(
                  teamSubagentId,
                  agentDef,
                  getConfig().getWorkspacePath(),
                  agentWorkspace,
                  job,
                  cronTask.id,
                  runId,
                ),
                modelOverride || String((agentDef as any)?.model || '').trim() || undefined,
                'interactive'
              );
              resultText = abortSignal.aborted
                ? 'ERROR: Run aborted by operator.'
                : String(ownerResult?.text || '').trim();
            } finally {
              finishLiveRuntime(runtimeId);
            }

            if (!resultText) resultText = 'Scheduled subagent task completed.';
            if (containsObsoleteProductBrand(resultText)) {
              resultText = `ERROR: ${buildObsoleteBrandBlockMessage('Cron final output')}`;
            }
            const finalStatus = /^\s*ERROR:/i.test(resultText) ? 'failed' : 'complete';
            const finalTask = loadTask(cronTask.id);
            const lastOpenStep = finalTask?.plan?.findIndex((step) => step.status === 'running' || step.status === 'pending') ?? -1;
            if (lastOpenStep >= 0 && finalStatus === 'complete') {
              mutatePlan(cronTask.id, [{
                op: 'complete',
                step_index: lastOpenStep,
                notes: resultText.slice(0, 200),
              }]);
            }
            updateTaskStatus(cronTask.id, finalStatus, { finalSummary: resultText });
            appendJournal(cronTask.id, {
              type: finalStatus === 'complete' ? 'status_push' : 'error',
              content: finalStatus === 'complete'
                ? `Done: ${resultText.slice(0, 240)}`
                : `Failed: ${resultText.slice(0, 240)}`,
              detail: resultText.slice(0, 2000),
            });
            this.deps.broadcast({ type: 'task_complete', taskId: cronTask.id, summary: resultText });
            this.deps.broadcast({ type: 'task_panel_update', taskId: cronTask.id });
            const scheduledAgentMessage = appendSubagentChatMessage(teamSubagentId, {
              role: 'agent',
              content: resultText,
              metadata: {
                source: 'schedule',
                scheduleId: job.id,
                scheduleName: job.name,
                taskId: cronTask.id,
                runId,
                success: finalStatus === 'complete',
              },
            });
            this.deps.broadcast({
              type: 'subagent_chat_message',
              agentId: teamSubagentId,
              message: scheduledAgentMessage,
            });
            taskSuccess = finalStatus === 'complete' && !/^\s*ERROR:/i.test(resultText);
            const doneTask = loadTask(cronTask.id);
            stepCount = Array.isArray((doneTask as any)?.journal)
              ? Math.max(1, (doneTask as any).journal.filter((j: any) => j?.type === 'tool_call' || j?.type === 'status_push').length)
              : 1;

            try {
              const finishedAt = Date.now();
              recordAgentRun({
                agentId: teamSubagentId,
                agentName: agentDef?.name || teamSubagentId,
                trigger: 'cron',
                taskId: scheduledSubagentTaskId,
                success: taskSuccess,
                startedAt: start,
                finishedAt,
                durationMs: finishedAt - start,
                stepCount,
                error: taskSuccess ? undefined : resultText.slice(0, 300),
                resultPreview: taskSuccess ? resultText.slice(0, 1000) : undefined,
              });
            } catch (agentRunErr: any) {
              console.warn(`[CronScheduler] Failed to record subagent run for "${job.name}":`, agentRunErr?.message || agentRunErr);
            }
          }

          try {
            if (!runId) {
              runId = startRunLogEntry({
                scheduleId: job.id,
                taskId: scheduledSubagentTaskId || `schedule_${job.id}`,
                scheduledAt,
              });
            }
            completeScheduledRun({
              scheduleId: job.id,
              runId,
              taskId: scheduledSubagentTaskId || `schedule_${job.id}`,
              success: taskSuccess,
              summary: resultText.slice(0, 400),
              stepCount,
              errorIfAny: !taskSuccess ? resultText.slice(0, 200) : undefined,
              scheduledAt,
            });
          } catch { /* best effort */ }
        } else {
        // Create a TaskRecord so the kanban/background-tasks page can show live progress
        const cronTask = createTask({
          title: job.name,
          prompt: job.prompt,
          sessionId: targetSessionId,
          channel: 'web',
          scheduleId: job.id,
          plan: buildScheduledTaskPlan(job),
        });
        activeCronTaskId = cronTask.id;
        updateTaskStatus(cronTask.id, 'running');
        setTaskStepRunning(cronTask.id, 0);
        this.deps.broadcast({ type: 'task_running', taskId: cronTask.id, jobId: job.id, jobName: job.name });
        this.deps.broadcast({ type: 'cron_task_spawned', jobId: job.id, jobName: job.name, taskId: cronTask.id, teamId: teamId || undefined, agentId: teamSubagentId || undefined });

        // Mirror sendSSE events into the task journal so the kanban panel shows live tool calls
        // Also intercepts write_note tool calls to persist schedule-scoped insights into schedule memory
        const taskSendSSE = (event: string, data: any) => {
          sendSSE(event, data); // still feeds the cron broadcast pipeline
          if (event === 'tool_call') {
            appendJournal(cronTask.id, {
              type: 'tool_call',
              content: `${data.action || 'unknown'}(${JSON.stringify(data.args || {}).slice(0, 80)})`,
            });
            this.deps.broadcast({ type: 'task_tool_call', taskId: cronTask.id, tool: data.action, args: data.args });
            this.deps.broadcast({ type: 'task_panel_update', taskId: cronTask.id });

            // Intercept write_note → write to evidence bus for visibility in panel,
            // and persist schedule-scoped insights into schedule memory for future runs
            if (data.action === 'write_note') {
              const noteArgs = data.args || {};
              const noteScope = String(noteArgs.scope || '').toLowerCase();
              const noteKey = String(noteArgs.key || noteArgs.tag || 'insight').trim();
              const noteValue = String(noteArgs.value || noteArgs.content || '').trim();
              if (noteValue) {
                // Always write to evidence bus so it shows in the task panel
                writeToEvidenceBus(cronTask.id, {
                  stepIndex: 0,
                  category: 'finding',
                  key: noteKey,
                  value: noteValue,
                });
                if (noteScope === 'schedule' || noteKey === 'last_run_insight') {
                  // Persist to schedule memory so it shows up in future run prompts
                  addLearnedContext(job.id, noteValue);
                  console.log(`[CronScheduler] Saved schedule insight for "${job.name}": ${noteValue.slice(0, 80)}`);
                } else if (noteScope === 'note') {
                  setNote(job.id, noteKey, noteValue);
                }
              }
            }
          } else if (event === 'tool_result') {
            appendJournal(cronTask.id, {
              type: 'tool_result',
              content: `${data.action || 'unknown'}: ${String(data.result || '').slice(0, 120)}`,
            });
          } else if (event === 'progress_state') {
            updateTaskRuntimeProgress(cronTask.id, {
              source: data?.source,
              activeIndex: Number(data?.activeIndex ?? -1),
              items: Array.isArray(data?.items)
                ? data.items.map((item: any, idx: number) => ({
                  id: String(item?.id || `p${idx + 1}`),
                  text: String(item?.text || ''),
                  status: String(item?.status || 'pending') as any,
                }))
                : [],
            });
            this.deps.broadcast({ type: 'task_panel_update', taskId: cronTask.id });
          }
        };

        // Log this run start
        const scheduledAt = Date.now();
        const runId = startRunLogEntry({ scheduleId: job.id, taskId: cronTask.id, scheduledAt });
        activeRunId = runId;
        activeScheduledAt = scheduledAt;
        const abortSignal = { aborted: false };
        const runtimeId = registerLiveRuntime({
          kind: 'cron',
          label: `Scheduled task - ${job.name}`,
          sessionId: targetSessionId,
          taskId: cronTask.id,
          scheduleId: job.id,
          source: 'scheduler',
          detail: effectivePrompt.slice(0, 160),
          abortSignal,
          onAbort: () => {
            updateTaskStatus(cronTask.id, 'failed', { finalSummary: 'Aborted via Telegram /stop.' });
            appendJournal(cronTask.id, { type: 'status_push', content: 'Aborted via Telegram /stop.' });
          },
        });

        try {
        const requiredReads = extractPromptRequiredWorkspaceReads(effectivePrompt);
        if (requiredReads.length) {
          const workspaceRoot = getConfig().getWorkspacePath();
          const missing = requiredReads.filter((p) => {
            const abs = path.join(workspaceRoot, normalizeWorkspaceAliasPath(p, workspaceRoot));
            return !fs.existsSync(abs) || !fs.statSync(abs).isFile();
          });
          if (missing.length) {
            throw new Error(buildMissingSourceBlockMessage(missing));
          }
        }
        const result = await this.deps.handleChat(
          effectivePrompt,
          targetSessionId,
          taskSendSSE,
          undefined,
          abortSignal,
          undefined,
          modelOverride,
          'cron'
        );
        resultText = abortSignal.aborted
          ? 'ERROR: Run aborted by operator.'
          : (result.text || '');

        // ── Synthesis round: if the AI did real work but returned a vague/short response ──
        // (e.g. "Done.", "Task complete.") run one follow-up round in the same session so it
        // can produce the actual structured output from the browser/research data it gathered.
        const hadToolCalls = events.some(e => e.type === 'tool_call');
        const isVagueResult =
          resultText.trim().length < 300 ||
          /^(done\.?|complete\.?|ok\.?|finished\.?|task complete\.?|step complete\.?|all steps complete\.?|all done\.?)$/i.test(resultText.trim());
        if (!abortSignal.aborted && hadToolCalls && isVagueResult) {
          console.log(`[CronScheduler] Job "${job.name}" returned vague response (${resultText.length} chars) — running synthesis round.`);
          try {
            const synthResult = await this.deps.handleChat(
              `Based on all the data and research you collected above, write your complete, structured final response now. ` +
              `Write the actual content — the full report, analysis, or answer — directly. ` +
              `Do not say "Done" or reference background processing. Start immediately with the content.`,
              targetSessionId,
              taskSendSSE,
              undefined,
              abortSignal,
              undefined,
              modelOverride,
              'cron'
            );
            const synthText = String(synthResult.text || '').trim();
            if (synthText.length > resultText.trim().length + 50) {
              resultText = synthText;
            }
          } catch (synthErr: any) {
            console.warn(`[CronScheduler] Synthesis round failed for "${job.name}":`, synthErr.message);
          }
        }

        if (containsObsoleteProductBrand(resultText)) {
          resultText = `ERROR: ${buildObsoleteBrandBlockMessage('Cron final output')}`;
        }

        // Mark the single plan step as done so progress bar fills to 100%
        const taskSuccess = !resultText.startsWith('ERROR:');
        mutatePlan(cronTask.id, [{
          op: 'complete',
          step_index: 0,
          notes: resultText.slice(0, 200),
        }]);

        // Mark task complete and write final result to journal
        updateTaskStatus(cronTask.id, taskSuccess ? 'complete' : 'failed', {
          finalSummary: resultText,
        });
        appendJournal(cronTask.id, {
          type: 'status_push',
          content: taskSuccess ? `Done: ${resultText.slice(0, 200)}` : `Failed: ${resultText.slice(0, 200)}`,
        });
        this.deps.broadcast({ type: 'task_complete', taskId: cronTask.id, summary: resultText });
        this.deps.broadcast({ type: 'task_step_done', taskId: cronTask.id, stepIndex: 0 });

        // Log run completion in schedule memory
        try {
          completeScheduledRun({
            scheduleId: job.id,
            runId,
            taskId: cronTask.id,
            success: taskSuccess,
            summary: resultText.slice(0, 400),
            stepCount: 1,
            errorIfAny: !taskSuccess ? resultText.slice(0, 200) : undefined,
            scheduledAt,
          });
        } catch { /* best effort */ }
        } finally {
          finishLiveRuntime(runtimeId);
        }

        }
      }
      duration = Date.now() - start;
    } catch (err: any) {
      resultText = `ERROR: ${err.message}`;
      duration = Date.now() - start;
      console.error(`[CronScheduler] Job "${job.name}" error:`, err.message);
      if (activeCronTaskId) {
        updateTaskStatus(activeCronTaskId, 'failed', { finalSummary: resultText });
        appendJournal(activeCronTaskId, {
          type: 'status_push',
          content: `Failed: ${resultText.slice(0, 200)}`,
        });
        if (activeRunId) {
          try {
            completeScheduledRun({
              scheduleId: job.id,
              runId: activeRunId,
              taskId: activeCronTaskId,
              success: false,
              summary: resultText.slice(0, 400),
              stepCount: 1,
              errorIfAny: resultText.slice(0, 200),
              scheduledAt: activeScheduledAt || start,
            });
          } catch {
            // best effort only
          }
        }
        this.deps.broadcast({ type: 'task_complete', taskId: activeCronTaskId, summary: resultText });
        this.deps.broadcast({ type: 'task_panel_update', taskId: activeCronTaskId });
        if (teamSubagentId && !teamId) {
          try {
            const errorMessage = appendSubagentChatMessage(teamSubagentId, {
              role: 'agent',
              content: resultText,
              metadata: {
                source: 'schedule',
                scheduleId: job.id,
                scheduleName: job.name,
                taskId: activeCronTaskId,
                runId: activeRunId,
                success: false,
              },
            });
            this.deps.broadcast({
              type: 'subagent_chat_stream_event',
              agentId: teamSubagentId,
              taskId: activeCronTaskId,
              scheduleId: job.id,
              scheduleName: job.name,
              event: 'error',
              data: { message: resultText },
            });
            this.deps.broadcast({
              type: 'subagent_chat_message',
              agentId: teamSubagentId,
              message: errorMessage,
            });
          } catch {}
        }
      }
    }

    // Determine if this is a silent OK or real output
    const isOk = /^\s*HEARTBEAT_OK\s*$/i.test(resultText);
    const isBlockedMissingSource = /^\s*ERROR:\s*BLOCKED: required scheduled-job source file is missing\./i.test(resultText);
    const runStatus: JobRunStatus = isOk
      ? 'ok'
      : (/^\s*ERROR:/i.test(resultText) ? 'error' : 'success');

    job.lastRun = new Date().toISOString();
    job.lastResult = resultText.slice(0, 3000);
    job.lastDuration = duration;

    if (job.type === 'one-shot' || job.deleteAfterRun) {
      this.store.jobs = this.store.jobs.filter(j => j.id !== job.id);
    } else {
      job.status = 'scheduled';
      if (runStatus === 'error' && !isBlockedMissingSource) {
        job.consecutiveErrors = (job.consecutiveErrors || 0) + 1;
        const backoffMs = Math.min(
          Math.pow(2, job.consecutiveErrors - 1) * 60_000,
          4 * 60 * 60_000
        );
        job.nextRun = new Date(Date.now() + backoffMs).toISOString();
      } else {
        if (isBlockedMissingSource) {
          job.consecutiveErrors = 0;
        } else {
          job.consecutiveErrors = 0;
        }
        job.nextRun = applyDeterministicStagger(
          getNextRun(job.schedule, new Date(), job.tz).toISOString(),
          job.id,
          job.schedule
        );
      }
    }

    let automatedSession: AutomatedSession | null = null;

    const shouldRouteToTeam = !!(teamId && teamSubagentId);
    const shouldRouteToStandaloneSubagent = !!(teamSubagentId && !teamId);

    if (!isOk && resultText.trim() && job.payloadKind !== 'systemEvent' && shouldRouteToTeam) {
      try {
        const success = runStatus !== 'error';
        const chatMessage = appendTeamChat(teamId!, {
          from: 'subagent',
          fromName: teamAgentName,
          fromAgentId: teamSubagentId,
          content: success
            ? `Scheduled task complete (${job.name}): ${resultText}`
            : `Scheduled task failed (${job.name}): ${resultText}`,
          metadata: {
            agentId: teamSubagentId,
            runSuccess: success,
          },
        });
        broadcastTeamEvent({
          type: 'team_chat_message',
          teamId,
          teamName: team?.name || teamId,
          message: chatMessage,
        });
        broadcastTeamEvent({
          type: 'team_subagent_completed',
          teamId,
          teamName: team?.name || teamId,
          agentId: teamSubagentId,
          agentName: teamAgentName,
          taskId: scheduledSubagentTaskId,
          success,
          resultPreview: resultText.slice(0, 800),
          trigger: 'cron',
        });
        console.log(`[CronScheduler] Job "${job.name}" produced output -> routed to team chat ${teamId}`);
        await triggerManagerReview(teamId!, broadcastTeamEvent);
      } catch (teamRouteErr: any) {
        console.error(`[CronScheduler] Failed to route "${job.name}" output to team chat:`, teamRouteErr?.message || teamRouteErr);
      }
    } else if (!isOk && resultText.trim() && job.payloadKind !== 'systemEvent' && shouldRouteToStandaloneSubagent) {
      job.lastOutputSessionId = null;
      console.log(`[CronScheduler] Job "${job.name}" produced output -> routed to subagent ${teamSubagentId} task ${scheduledSubagentTaskId || 'unknown'}`);
    } else if (!isOk && resultText.trim() && job.payloadKind !== 'systemEvent') {
      // Create an automated chat session with the output
      const sessionId = `auto_${job.id}_${Date.now()}`;
      const title = `🕐 ${job.name} — ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;

      automatedSession = {
        id: sessionId,
        title,
        jobName: job.name,
        jobId: job.id,
        automated: true,
        createdAt: Date.now(),
        history: [
          { role: 'user', content: `[Automated Task: ${job.name}]\n\n${job.prompt}` },
          { role: 'ai', content: resultText },
        ],
      };

      job.lastOutputSessionId = sessionId;
      console.log(`[CronScheduler] Job "${job.name}" produced output → auto session ${sessionId}`);

      // Deliver to Telegram if available
      if (this.deps.deliverTelegram) {
        const tgMsg = `\ud83d\udd50 <b>${job.name}</b>\n\n${resultText}`;
        if (containsObsoleteProductBrand(tgMsg)) {
          console.error(`[CronScheduler] Telegram delivery blocked: ${buildObsoleteBrandBlockMessage('Cron delivery payload')}`);
        } else {
          this.deps.deliverTelegram(tgMsg).catch(err =>
            console.error(`[CronScheduler] Telegram delivery failed:`, err.message)
          );
        }
      }
    } else {
      console.log(`[CronScheduler] Job "${job.name}" → HEARTBEAT_OK (suppressed)`);
    }

    this.appendRunHistory(job.id, {
      t: job.lastRun || new Date().toISOString(),
      status: runStatus,
      duration,
      result_excerpt: resultText.slice(0, 500),
    });

    this.saveStore();
    if (isolatedRunSession) {
      // Isolated cron runs should not retain conversation context after completion.
      clearHistory(targetSessionId);
    }
    this.runningJobId = null;

    // After schedule completes, resume any tasks that were interrupted by this schedule
    const tasksToResume = this.interruptedTasksBySchedule.get(job.id);
    if (tasksToResume && tasksToResume.length > 0) {
      console.log(`[CronScheduler] Schedule "${job.name}" completed - scheduling resumption of ${tasksToResume.length} task(s)`);
      // Schedule resumption for next heartbeat cycle or shortly after
      setTimeout(() => {
        for (const taskId of tasksToResume) {
          if (BackgroundTaskRunner.resumeTaskAfterSchedule(taskId, job.id)) {
            console.log(`[CronScheduler] Resumed task ${taskId} after schedule ${job.id} completed`);
          }
        }
        this.interruptedTasksBySchedule.delete(job.id);
      }, 2000); // 2 second delay to ensure final state is persisted
    }

    // Broadcast final state to all WebSocket clients
    this.deps.broadcast({
      type: 'task_done',
      jobId: job.id,
      jobName: job.name,
      isOk,
      duration,
      automatedSession,
      jobs: this.store.jobs,
      config: this.store.heartbeat,
    });
  }

  // ─── Task Pause/Resume/Interrupt ─────────────────────────────────────────────

  /**
   * Pause a job (e.g., to resume/retry later)
   */
  pauseJob(id: string, reason: 'manual' | 'interrupted_by_schedule' = 'manual'): CronJob | null {
    const job = this.store.jobs.find(j => j.id === id);
    if (!job) return null;
    job.status = 'paused';
    job.pausedReason = reason;
    this.saveStore();
    this.broadcastUpdate();
    console.log(`[CronScheduler] Job "${job.name}" paused (reason: ${reason})`);
    return job;
  }

  /**
   * Resume a paused job
   */
  resumeJob(id: string): CronJob | null {
    const job = this.store.jobs.find(j => j.id === id);
    if (!job) return null;
    if (job.status !== 'paused') {
      console.warn(`[CronScheduler] Attempt to resume non-paused job "${job.name}"`);
      return job;
    }
    job.status = 'scheduled';
    job.pausedReason = undefined;
    // Recalculate nextRun
    const now = new Date();
    job.nextRun = job.type === 'one-shot' && job.runAt
      ? job.runAt
      : applyDeterministicStagger(
          getNextRun(job.schedule, now, job.tz).toISOString(),
          job.id,
          job.schedule
        );
    this.saveStore();
    this.broadcastUpdate();
    console.log(`[CronScheduler] Job "${job.name}" resumed`);
    return job;
  }

  /**
   * Return the current list of all jobs.
   */
  getJobs(): CronJob[] {
    return this.store.jobs;
  }

  /**
   * Get job status and pause info
   */
  getJobStatus(id: string): { job: CronJob | null; isPaused: boolean; pauseReason?: string } {
    const job = this.store.jobs.find(j => j.id === id);
    return {
      job: job || null,
      isPaused: job?.status === 'paused',
      pauseReason: job?.pausedReason,
    };
  }

  // ─── Broadcast Helper ─────────────────────────────────────────────────────────

  private broadcastUpdate(): void {
    this.deps.broadcast({ type: 'tasks_update', jobs: this.store.jobs, config: this.store.heartbeat });
  }
}
