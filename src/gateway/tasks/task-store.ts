/**
 * task-store.ts Ã¢â‚¬â€ Persistent background task storage
 *
 * Tasks are stored as individual JSON files in .prometheus/tasks/
 * plus an index file for fast listing.
 *
 * This is the data layer only Ã¢â‚¬â€ no execution logic.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getConfig } from '../../config/config';

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Evidence Bus Types Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

export type EvidenceCategory =
  | 'finding'    // a discovered fact or piece of information
  | 'decision'   // a choice the manager/worker made
  | 'artifact'   // file path, URL, or output reference
  | 'error'      // something that failed (useful for retry context)
  | 'dedup_key'; // a key to prevent duplicate actions

export interface EvidenceEntry {
  id: string;                  // uuid
  agentId?: string;            // which agent wrote this (null = main task runner)
  stepIndex: number;           // which step this was written during
  t: number;                   // timestamp
  category: EvidenceCategory;
  key?: string;                // dedup/lookup key (e.g. "posted_tweet_ids")
  value: string;               // the actual finding, max 1000 chars
  confidence?: number;         // 0-1, how sure the agent was
}

export interface EvidenceBus {
  taskId: string;
  createdAt: number;
  updatedAt: number;
  entries: EvidenceEntry[];
}

export type EvidenceBusSnapshot = EvidenceBus;

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Types Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'stalled'
  | 'needs_assistance'
  | 'awaiting_user_input'  // task asked a clarification question and is waiting for user reply
  | 'complete'
  | 'failed'
  | 'waiting_subagent';   // parent is blocked waiting for child sub-agents to finish

export type PauseReason =
  | 'preempted_by_chat'
  | 'heartbeat_cycle'
  | 'user_pause'
  | 'error'
  | 'max_steps'
  | 'interrupted_by_schedule'
  | 'awaiting_user_input'  // task paused because it needs clarification from the user
  | 'recovering_from_build_error';  // agent is recovering from a build error

export type JournalEntryType =
  | 'tool_call'
  | 'tool_result'
  | 'advisor_decision'
  | 'status_push'
  | 'pause'
  | 'resume'
  | 'error'
  | 'plan_mutation'
  | 'heartbeat'
  | 'write_note';

export interface TaskPlanStep {
  index: number;
  description: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  completedAt?: number;
  notes?: string;
}

export type TaskProgressStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped';

export interface TaskRuntimeProgressItem {
  id: string;
  text: string;
  status: TaskProgressStatus;
}

export interface TaskRuntimeProgressState {
  source: 'none' | 'preflight' | 'tool_sequence';
  activeIndex: number;
  items: TaskRuntimeProgressItem[];
  updatedAt: number;
}

export interface TaskJournalEntry {
  t: number;
  type: JournalEntryType;
  content: string;      // compact one-liner
  detail?: string;      // full data if needed
}

export interface TaskResumeContext {
  messages: any[];                   // full messages[] array compressed
  browserSessionActive: boolean;
  browserUrl?: string;
  round: number;
  orchestrationLog: string[];
  fileOpState?: {
    type: string;
    owner: 'primary' | 'secondary';
    touchedFiles: string[];
  };
  onResumeInstruction?: string;      // injected into parent context when all children complete
}

export type SubagentProfile = 'file_editor' | 'researcher' | 'shell_runner' | 'reader_only';

export interface TaskRecord {
  id: string;
  title: string;
  prompt: string;                    // verbatim original user message
  sessionId: string;                 // originating chat session
  channel: 'web' | 'telegram';
  telegramChatId?: number;

  // Ã¢â€â‚¬Ã¢â€â‚¬ Sub-agent fields Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  parentTaskId?: string;             // set if this task was spawned by a parent
  pendingSubagentIds?: string[];     // child task IDs the parent is waiting on
  subagentProfile?: SubagentProfile; // restricts tool access for this child task
  agentWorkspace?: string;           // absolute workspace path Ã¢â‚¬â€ scopes ALL file tool access for this task

  status: TaskStatus;
  pauseReason?: PauseReason;

  // Ã¢â€â‚¬Ã¢â€â‚¬ Schedule interruption context Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  pausedByScheduleId?: string;       // Which schedule caused the pause
  pausedAt?: number;                 // When task was paused
  pausedAtStepIndex?: number;        // Plan step index when paused
  shouldResumeAfterSchedule?: boolean; // Resume when schedule completes

  plan: TaskPlanStep[];
  currentStepIndex: number;
  maxPlanDepth: number;              // default 20
  runtimeProgress?: TaskRuntimeProgressState;

  journal: TaskJournalEntry[];
  lastToolCall?: string;
  lastToolCallAt?: number;
  lastProgressAt: number;

  startedAt: number;
  completedAt?: number;

  resumeContext: TaskResumeContext;
  finalSummary?: string;

  /** Number of times the self-healer has intervened on this task. Resets on manual resume. */
  selfHealAttempts?: number;
  /** Number of completion-verifier resynth attempts. */
  resynthAttempts?: number;
  /**
   * When status=awaiting_user_input: the question the AI asked that needs a user reply.
   * Cleared when the user replies and the task resumes.
   */
  pendingClarificationQuestion?: string;

  // Ã¢â€â‚¬Ã¢â€â‚¬ Schedule linkage Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  /** Set when this task was spawned by a scheduled job. Used for schedule memory. */
  scheduleId?: string;
  /** Run log ID for tracking this execution in schedule-memory run-log.json */
  scheduleRunId?: string;

  // ── run_task_now fields ────────────────────────────────────────────────────
  /** 'run_once' = spawned via run_task_now tool; 'scheduled' = cron/scheduled job */
  taskKind?: 'scheduled' | 'run_once';
  /** Session that called run_task_now — verification result is delivered here */
  originatingSessionId?: string;
  /** Tracks the silent verification phase for run_once tasks */
  verificationStatus?: 'pending' | 'running' | 'complete' | 'skipped';

  // Ã¢â€â‚¬Ã¢â€â‚¬ Multi-agent architecture fields Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  /** true = use manager/worker split; false or undefined = legacy handleChat() mode */
  managerEnabled?: boolean;
  /** Which provider/model to use for worker execution, e.g. "openai_codex/gpt-4o" */
  executorProvider?: string;
  /** Last ExecutionBrief produced by the manager (stored for retry use) */
  lastBrief?: {
    exact_objective: string;
    stop_condition: string;
    tool_budget: number;
    forbidden_actions: string[];
    success_signals: string[];
    forward_context?: string;
  };
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Index Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

interface TaskIndex {
  ids: string[];
  updatedAt: number;
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Store Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

const TASKS_DIR_NAME = 'tasks';

function getStateBaseDir(): string {
  try {
    return getConfig().getConfigDir();
  } catch {
    return path.join(process.cwd(), '.prometheus');
  }
}

function getTasksDir(): string {
  const base = path.join(getStateBaseDir(), TASKS_DIR_NAME);
  fs.mkdirSync(base, { recursive: true });
  return base;
}

function taskFilePath(id: string): string {
  return path.join(getTasksDir(), `${id}.json`);
}

function indexFilePath(): string {
  return path.join(getTasksDir(), '_index.json');
}

function loadIndex(): TaskIndex {
  const p = indexFilePath();
  if (!fs.existsSync(p)) return { ids: [], updatedAt: Date.now() };
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8')) as unknown;

    // Backward compatibility: older builds persisted the index as string[].
    if (Array.isArray(parsed)) {
      const ids = parsed.filter((v): v is string => typeof v === 'string');
      return { ids: Array.from(new Set(ids)), updatedAt: Date.now() };
    }

    if (parsed && typeof parsed === 'object') {
      const record = parsed as { ids?: unknown; updatedAt?: unknown };
      const ids = Array.isArray(record.ids)
        ? record.ids.filter((v): v is string => typeof v === 'string')
        : [];
      const updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : Date.now();
      return { ids: Array.from(new Set(ids)), updatedAt };
    }

    return { ids: [], updatedAt: Date.now() };
  } catch {
    return { ids: [], updatedAt: Date.now() };
  }
}

function saveIndex(index: TaskIndex): void {
  fs.writeFileSync(indexFilePath(), JSON.stringify(index, null, 2), 'utf-8');
}

function addToIndex(id: string): void {
  const idx = loadIndex();
  if (!idx.ids.includes(id)) {
    idx.ids.push(id);
    idx.updatedAt = Date.now();
    saveIndex(idx);
  }
}

function removeFromIndex(id: string): void {
  const idx = loadIndex();
  idx.ids = idx.ids.filter(i => i !== id);
  idx.updatedAt = Date.now();
  saveIndex(idx);
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ CRUD Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

export function createTask(params: {
  title: string;
  prompt: string;
  sessionId: string;
  channel: 'web' | 'telegram';
  telegramChatId?: number;
  plan: TaskPlanStep[];
  // Sub-agent fields
  parentTaskId?: string;
  subagentProfile?: string;
  agentWorkspace?: string;   // locks file tools to this path for the task's lifetime
  onResumeInstruction?: string;
  // Schedule fields
  scheduleId?: string;
  /** Executor model assignment: "providerId/model", e.g. "anthropic/claude-haiku-4-5-20251001". Set by proposal dispatch for risk_tier-aware execution. */
  executorProvider?: string;
  // run_task_now fields
  taskKind?: 'scheduled' | 'run_once';
  originatingSessionId?: string;
}): TaskRecord {
  const id = crypto.randomUUID();
  const now = Date.now();

  const task: TaskRecord = {
    id,
    title: params.title,
    prompt: params.prompt,
    sessionId: params.sessionId,
    channel: params.channel,
    telegramChatId: params.telegramChatId,

    status: 'queued',

    // Sub-agent wiring
    parentTaskId: params.parentTaskId,
    pendingSubagentIds: [],
    subagentProfile: params.subagentProfile as SubagentProfile | undefined,
    agentWorkspace: params.agentWorkspace,
    // Schedule linkage
    scheduleId: params.scheduleId,
    // Executor model override
    executorProvider: params.executorProvider,
    // run_task_now linkage
    taskKind: params.taskKind,
    originatingSessionId: params.originatingSessionId,
    verificationStatus: params.taskKind === 'run_once' ? 'pending' : undefined,

    plan: params.plan,
    currentStepIndex: 0,
    maxPlanDepth: 20,

    journal: [{
      t: now,
      type: 'status_push',
      content: `Task created: ${params.title}`,
    }],
    lastProgressAt: now,
    startedAt: now,

    resumeContext: {
      messages: [],
      browserSessionActive: false,
      round: 0,
      orchestrationLog: [],
      onResumeInstruction: params.onResumeInstruction,
    },
  };

  saveTask(task);
  addToIndex(id);
  return task;
}

export function loadTask(id: string): TaskRecord | null {
  const p = taskFilePath(id);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as TaskRecord;
  } catch {
    return null;
  }
}

export function saveTask(task: TaskRecord): void {
  // Trim journal to last 500 entries to prevent unbounded growth
  if (task.journal.length > 500) {
    task.journal = task.journal.slice(-500);
  }
  fs.writeFileSync(taskFilePath(task.id), JSON.stringify(task, null, 2), 'utf-8');
}

export function updateTaskStatus(
  id: string,
  status: TaskStatus,
  opts?: {
    pauseReason?: PauseReason;
    finalSummary?: string;
    pausedByScheduleId?: string | undefined;
    pausedAt?: number | undefined;
    pausedAtStepIndex?: number | undefined;
    shouldResumeAfterSchedule?: boolean | undefined;
  },
): TaskRecord | null {
  const task = loadTask(id);
  if (!task) return null;
  task.status = status;
  if (opts?.pauseReason !== undefined) task.pauseReason = opts.pauseReason;
  if (opts?.finalSummary !== undefined) task.finalSummary = opts.finalSummary;
  if (opts?.pausedByScheduleId !== undefined) task.pausedByScheduleId = opts.pausedByScheduleId;
  if (opts?.pausedAt !== undefined) task.pausedAt = opts.pausedAt;
  if (opts?.pausedAtStepIndex !== undefined) task.pausedAtStepIndex = opts.pausedAtStepIndex;
  if (opts?.shouldResumeAfterSchedule !== undefined) task.shouldResumeAfterSchedule = opts.shouldResumeAfterSchedule;
  if (status === 'complete' || status === 'failed') task.completedAt = Date.now();
  task.lastProgressAt = Date.now();
  saveTask(task);
  return task;
}

export function appendJournal(id: string, entry: Omit<TaskJournalEntry, 't'>): void {
  const task = loadTask(id);
  if (!task) return;
  task.journal.push({ t: Date.now(), ...entry });
  task.lastProgressAt = Date.now();
  if (entry.type === 'tool_call') {
    task.lastToolCall = entry.content;
    task.lastToolCallAt = Date.now();
  }
  saveTask(task);
}

export function updateResumeContext(id: string, ctx: Partial<TaskResumeContext>): void {
  const task = loadTask(id);
  if (!task) return;
  task.resumeContext = { ...task.resumeContext, ...ctx };
  saveTask(task);
}

export function setTaskStepRunning(id: string, stepIndex: number): TaskRecord | null {
  const task = loadTask(id);
  if (!task) return null;
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= task.plan.length) return task;

  let changed = false;
  for (let i = 0; i < task.plan.length; i++) {
    const step = task.plan[i];
    if (!step) continue;
    if (i === stepIndex) {
      if (step.status === 'pending' || step.status === 'running') {
        if (step.status !== 'running') {
          step.status = 'running';
          changed = true;
        }
      }
    } else if (step.status === 'running') {
      step.status = 'pending';
      changed = true;
    }
  }

  if (task.currentStepIndex !== stepIndex) {
    task.currentStepIndex = stepIndex;
    changed = true;
  }
  if (!changed) return task;

  task.lastProgressAt = Date.now();
  saveTask(task);
  return task;
}

export function updateTaskRuntimeProgress(
  id: string,
  progress: {
    source?: 'none' | 'preflight' | 'tool_sequence';
    activeIndex?: number;
    items?: Array<{ id?: string; text?: string; status?: TaskProgressStatus }>;
  },
): TaskRecord | null {
  const task = loadTask(id);
  if (!task) return null;

  const source = progress?.source === 'preflight' || progress?.source === 'tool_sequence'
    ? progress.source
    : 'none';
  const activeIndex = Number.isFinite(Number(progress?.activeIndex)) ? Number(progress?.activeIndex) : -1;
  const toProgressStatus = (raw: any): TaskProgressStatus => {
    const v = String(raw || '').toLowerCase();
    if (v === 'in_progress') return 'in_progress';
    if (v === 'done') return 'done';
    if (v === 'failed') return 'failed';
    if (v === 'skipped') return 'skipped';
    return 'pending';
  };
  const items = Array.isArray(progress?.items)
    ? progress.items.slice(0, 12).map((item, idx) => ({
      id: String(item?.id || `p${idx + 1}`),
      text: String(item?.text || '').slice(0, 160),
      status: toProgressStatus(item?.status),
    }))
    : [];

  task.runtimeProgress = {
    source,
    activeIndex,
    items,
    updatedAt: Date.now(),
  };
  task.lastProgressAt = Date.now();
  saveTask(task);
  return task;
}

export function mutatePlan(
  id: string,
  mutations: Array<
    | { op: 'complete'; step_index: number; notes?: string }
    | { op: 'add'; after_index: number; description: string; notes?: string }
    | { op: 'modify'; step_index: number; description: string }
  >,
): TaskRecord | null {
  const task = loadTask(id);
  if (!task) return null;

  for (const m of mutations) {
    if (m.op === 'complete') {
      const step = task.plan[m.step_index];
      if (step) {
        step.status = 'done';
        step.completedAt = Date.now();
        if (m.notes) step.notes = m.notes;
      }
    } else if (m.op === 'add') {
      // Guard max plan depth
      if (task.plan.length >= task.maxPlanDepth) continue;
      const insertAt = m.after_index + 1;
      const newStep: TaskPlanStep = {
        index: insertAt,
        description: m.description,
        status: 'pending',
        notes: m.notes,
      };
      task.plan.splice(insertAt, 0, newStep);
      // Re-index
      task.plan.forEach((s, i) => { s.index = i; });
    } else if (m.op === 'modify') {
      const step = task.plan[m.step_index];
      if (step && step.status === 'pending') {
        step.description = m.description;
      }
    }
  }

  task.journal.push({
    t: Date.now(),
    type: 'plan_mutation',
    content: `Plan mutated: ${mutations.map(m => m.op).join(', ')}`,
    detail: JSON.stringify(mutations),
  });

  saveTask(task);
  return task;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Sub-Agent Completion Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

/**
 * Called when a child task completes. Removes it from the parent's pending
 * list and, if all children are done, re-queues the parent to resume.
 * Returns the parent task (if found) and whether all children finished.
 */
export function resolveSubagentCompletion(
  childTaskId: string,
  childSummary: string,
): { parentTask: TaskRecord | null; allChildrenDone: boolean } {
  const child = loadTask(childTaskId);
  if (!child?.parentTaskId) return { parentTask: null, allChildrenDone: false };

  const parent = loadTask(child.parentTaskId);
  if (!parent) return { parentTask: null, allChildrenDone: false };

  // Remove this child from pending list
  parent.pendingSubagentIds = (parent.pendingSubagentIds || [])
    .filter(id => id !== childTaskId);

  // Inject sub-agent result into parent's resume messages
  const resultMessage = {
    role: 'user',
    content: `[SUBAGENT RESULT: ${child.title}]\n${childSummary.slice(0, 800)}\n[/SUBAGENT RESULT]`,
    timestamp: Date.now(),
  };
  parent.resumeContext.messages = [
    ...(parent.resumeContext.messages || []),
    resultMessage,
  ].slice(-10); // respect MAX_RESUME_MESSAGES

  // Write structured result to the shared parent evidence bus
  try {
    writeToEvidenceBus(parent.id, {
      agentId: child.id,
      stepIndex: child.currentStepIndex,
      category: 'finding',
      key: `subagent_result_${child.id.slice(0, 8)}`,
      value: `[${child.title}] ${childSummary.slice(0, 500)}`,
    });
  } catch {
    // best effort Ã¢â‚¬â€ never block parent resumption
  }

  const allChildrenDone = (parent.pendingSubagentIds || []).length === 0;

  if (allChildrenDone) {
    parent.status = 'queued'; // ready to resume Ã¢â‚¬â€ runner will set to 'running'
    parent.lastProgressAt = Date.now();
    parent.journal.push({
      t: Date.now(),
      type: 'resume',
      content: `All sub-agents complete. Re-queuing parent task.`,
    });
  } else {
    parent.journal.push({
      t: Date.now(),
      type: 'status_push',
      content: `Sub-agent "${child.title}" finished. Still waiting on ${parent.pendingSubagentIds!.length} child(ren).`,
    });
  }

  saveTask(parent);
  return { parentTask: parent, allChildrenDone };
}

export function listTasks(filter?: { status?: TaskStatus[] }): TaskRecord[] {
  const idx = loadIndex();
  const tasks: TaskRecord[] = [];
  for (const id of idx.ids) {
    const task = loadTask(id);
    if (!task) continue;
    if (filter?.status && !filter.status.includes(task.status)) continue;
    tasks.push(task);
  }
  return tasks.sort((a, b) => b.startedAt - a.startedAt);
}

export function deleteTask(id: string): boolean {
  const p = taskFilePath(id);
  const idx = loadIndex();
  const inIndex = idx.ids.includes(id);
  let removedAny = false;

  if (fs.existsSync(p)) {
    try {
      fs.unlinkSync(p);
      removedAny = true;
    } catch {
      // best effort; continue cleanup of related artifacts
    }
  }

  // Always remove from index to prevent stale list entries.
  if (inIndex) {
    removeFromIndex(id);
    removedAny = true;
  }

  // Remove evidence bus for this task.
  deleteEvidenceBus(id);

  // Remove related task artifacts created by background execution.
  const base = getStateBaseDir();
  const relatedFiles = [
    path.join(base, 'sessions', `task_${id}.json`),
    path.join(base, 'jobs', 'file-op-v2', `task_${id}.json`),
    // Backward-compat for older/alternate checkpoint naming.
    path.join(base, 'jobs', 'file-op-v2', `${id}.json`),
  ];
  for (const file of relatedFiles) {
    if (!fs.existsSync(file)) continue;
    try {
      fs.unlinkSync(file);
      removedAny = true;
    } catch {
      // best effort only
    }
  }

  return removedAny;
}



// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Evidence Bus Store Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

function busFilePath(taskId: string): string {
  return path.join(getTasksDir(), `${taskId}.bus.json`);
}

export function loadEvidenceBus(taskId: string): EvidenceBus | null {
  const p = busFilePath(taskId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as EvidenceBus;
  } catch {
    return null;
  }
}

function saveEvidenceBus(bus: EvidenceBus): void {
  fs.writeFileSync(busFilePath(bus.taskId), JSON.stringify(bus, null, 2), 'utf-8');
}

export function getOrCreateEvidenceBus(taskId: string): EvidenceBus {
  const existing = loadEvidenceBus(taskId);
  if (existing) return existing;
  const bus: EvidenceBus = {
    taskId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    entries: [],
  };
  saveEvidenceBus(bus);
  return bus;
}

export function writeToEvidenceBus(
  taskId: string,
  entry: Omit<EvidenceEntry, 'id' | 't'>,
): EvidenceEntry {
  const bus = getOrCreateEvidenceBus(taskId);
  const newEntry: EvidenceEntry = {
    id: crypto.randomUUID(),
    t: Date.now(),
    ...entry,
    value: String(entry.value || '').slice(0, 1000),
  };
  bus.entries.push(newEntry);
  bus.updatedAt = Date.now();
  saveEvidenceBus(bus);
  return newEntry;
}

export function getEvidenceBusSnapshot(taskId: string): EvidenceBusSnapshot | null {
  return loadEvidenceBus(taskId);
}

/**
 * Fast dedup check: returns true if a dedup_key entry with the given key
 * already contains the given value.
 */
export function isDedupKeyPresent(taskId: string, key: string, value: string): boolean {
  const bus = loadEvidenceBus(taskId);
  if (!bus) return false;
  return bus.entries.some(
    e => e.category === 'dedup_key' && e.key === key && e.value === value,
  );
}

/**
 * Delete the evidence bus file for a task (called on task deletion / cleanup).
 */
export function deleteEvidenceBus(taskId: string): void {
  const p = busFilePath(taskId);
  if (fs.existsSync(p)) {
    try { fs.unlinkSync(p); } catch { /* best effort */ }
  }
}

/**
 * Format the evidence bus as a human-readable string for injection into
 * Manager prompts.
 */
export function formatEvidenceBusForPrompt(bus: EvidenceBusSnapshot | null): string {
  if (!bus || bus.entries.length === 0) return 'EVIDENCE BUS: (empty)';
  const lines = bus.entries.slice(-50).map(e => {
    const who = e.agentId ? ` by agent=${e.agentId}` : '';
    const keyPart = e.key ? ` key=${e.key}` : '';
    return `[${e.category}]${who} step=${e.stepIndex}${keyPart}: "${e.value.slice(0, 200)}"`;
  });
  return `EVIDENCE BUS (what agents have found so far):\n${lines.join('\n')}`;
}

