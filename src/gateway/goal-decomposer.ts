/**
 * goal-decomposer.ts — Phase 3: Autonomous Goal Decomposition
 *
 * The "run a company" feature. Accepts a high-level goal and decomposes it into:
 *   - Sub-goals with schedules, success metrics, and subagent profiles
 *   - Creates scheduled jobs for each approved sub-goal
 *   - Manages the goal as a first-class entity with tracking
 *
 * Flow:
 *   1. User sends high-level goal to goal_decompose tool
 *   2. LLM produces a structured decomposition
 *   3. User approves via Telegram or web UI
 *   4. On approval: createJob() called for each sub-goal, goal stored in goals.json
 *   5. Goal tracking page shows active goals, their sub-tasks, and progress
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getConfig } from '../config/config';
import type { CronJob } from './scheduling/cron-scheduler';
import type { ToolResult } from '../types';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface GoalSubTask {
  id: string;
  description: string;           // what this sub-task does
  schedule: string;               // cron expression, e.g. "0 9 * * *"
  scheduleHuman: string;          // human-readable, e.g. "Daily at 9am"
  subagentProfile?: string;       // optional subagent profile
  successMetric: string;          // how to know this sub-task is done
  priority: number;               // 0 = highest
  jobId?: string;                 // set after approval when createJob() is called
  status: 'pending_approval' | 'active' | 'paused' | 'completed';
}

export interface Goal {
  id: string;
  title: string;
  description: string;            // the original high-level goal text
  timeframe: string;              // e.g. "1 month", "ongoing"
  successMetric: string;          // top-level success criterion
  subTasks: GoalSubTask[];
  status: 'pending_approval' | 'active' | 'paused' | 'completed' | 'archived';
  createdAt: string;              // ISO timestamp
  approvedAt?: string;
  completedAt?: string;
  progressNotes: string[];        // freeform progress tracking
  linkedJobIds: string[];         // all job IDs created for this goal
}

export interface GoalDecompositionResult {
  goal_title: string;
  timeframe: string;
  success_metric: string;
  sub_tasks: Array<{
    description: string;
    schedule: string;
    schedule_human: string;
    subagent_profile?: string;
    success_metric: string;
    priority: number;
  }>;
  reasoning: string;
  estimated_effort: string;       // e.g. "Low - 2-3 automated tasks"
}

export interface GoalStore {
  goals: Goal[];
  updatedAt: number;
}

// ─── Paths ─────────────────────────────────────────────────────────────────────

function getGoalsPath(): string {
  let base: string;
  try {
    base = path.join(process.cwd(), 'workspace');
  } catch {
    base = process.cwd();
  }
  return path.join(base, 'goals.json');
}

// ─── Goal Store ────────────────────────────────────────────────────────────────

export function loadGoalStore(): GoalStore {
  const p = getGoalsPath();
  if (!fs.existsSync(p)) return { goals: [], updatedAt: Date.now() };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as GoalStore;
  } catch {
    return { goals: [], updatedAt: Date.now() };
  }
}

function saveGoalStore(store: GoalStore): void {
  store.updatedAt = Date.now();
  const tmp = `${getGoalsPath()}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
  fs.renameSync(tmp, getGoalsPath());
}

export function loadGoal(id: string): Goal | null {
  const store = loadGoalStore();
  return store.goals.find(g => g.id === id) ?? null;
}

export function saveGoal(goal: Goal): void {
  const store = loadGoalStore();
  const idx = store.goals.findIndex(g => g.id === goal.id);
  if (idx === -1) {
    store.goals.push(goal);
  } else {
    store.goals[idx] = goal;
  }
  saveGoalStore(store);
}

export function listGoals(filter?: { status?: Goal['status'][] }): Goal[] {
  const store = loadGoalStore();
  if (!filter?.status) return store.goals;
  return store.goals.filter(g => filter.status!.includes(g.status));
}

// ─── Decomposition Prompt ──────────────────────────────────────────────────────

function buildDecompositionPrompt(goalText: string, contextHints?: string): string {
  return `You are a strategic planning assistant for an autonomous AI agent system (Prometheus).

A user has given you this high-level goal:
"${goalText}"

${contextHints ? `Additional context: ${contextHints}\n` : ''}

Your job is to decompose this goal into 2-6 automated sub-tasks that Prometheus can execute as scheduled jobs.

Each sub-task should be:
- Concrete and executable (the AI can actually DO it with tools it has: browser, web search, files, shell)
- Scheduled appropriately (daily, weekly, etc.)
- Independently verifiable (you can tell if it succeeded)

AVAILABLE TOOLS Prometheus has:
- Browser automation (browse websites, fill forms, click buttons)
- Web search and content fetching
- File read/write operations
- Shell command execution
- Memory and note-taking
- Twitter/X posting via browser

Return ONLY valid JSON, no other text:
{
  "goal_title": "Short descriptive title for this goal",
  "timeframe": "How long to pursue this goal",
  "success_metric": "How to know the top-level goal is achieved",
  "sub_tasks": [
    {
      "description": "Detailed prompt for what this scheduled job should do each run",
      "schedule": "*/30 * * * *",
      "schedule_human": "Every 30 minutes",
      "subagent_profile": null,
      "success_metric": "How to know this sub-task run succeeded",
      "priority": 0
    }
  ],
  "reasoning": "Why this decomposition makes sense for the goal",
  "estimated_effort": "Low/Medium/High — N automated tasks"
}

Make sub-task descriptions DETAILED and SPECIFIC — they become the actual prompts the AI executes.`;
}

// ─── Core Decompose Function ───────────────────────────────────────────────────

export async function decomposeGoal(
  goalText: string,
  contextHints: string | undefined,
  handleChat: (
    message: string,
    sessionId: string,
    sendSSE: (event: string, data: any) => void,
    pinnedMessages?: Array<{ role: string; content: string }>,
    abortSignal?: { aborted: boolean },
    callerContext?: string,
    modelOverride?: string,
    executionMode?: 'interactive' | 'background_task' | 'heartbeat' | 'cron',
  ) => Promise<{ type: string; text: string }>,
): Promise<GoalDecompositionResult | null> {
  const prompt = buildDecompositionPrompt(goalText, contextHints);
  const sessionId = `goal_decompose_${Date.now()}`;

  let responseText = '';
  try {
    const result = await handleChat(
      prompt,
      sessionId,
      () => {},
      undefined,
      undefined,
      '[SYSTEM: You are a strategic planning assistant. Return ONLY valid JSON. No markdown, no explanation.]',
      undefined,
      'background_task',
    );
    responseText = String(result?.text || '').trim();
  } catch (err: any) {
    console.error('[GoalDecomposer] LLM call failed:', err.message);
    return null;
  }

  try {
    const clean = responseText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();

    const parsed = JSON.parse(clean) as GoalDecompositionResult;

    // Validate
    if (!parsed.goal_title || !Array.isArray(parsed.sub_tasks)) return null;
    if (parsed.sub_tasks.length === 0) return null;

    // Clamp to max 6 sub-tasks
    parsed.sub_tasks = parsed.sub_tasks.slice(0, 6);

    return parsed;
  } catch (parseErr: any) {
    console.error('[GoalDecomposer] Failed to parse decomposition JSON:', parseErr.message);
    return null;
  }
}

// ─── Create Goal from Decomposition ───────────────────────────────────────────

export function createGoalFromDecomposition(
  originalGoalText: string,
  decomposition: GoalDecompositionResult,
): Goal {
  const id = `goal_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

  const subTasks: GoalSubTask[] = decomposition.sub_tasks.map((st, idx) => ({
    id: `subtask_${id}_${idx}`,
    description: st.description,
    schedule: st.schedule,
    scheduleHuman: st.schedule_human,
    subagentProfile: st.subagent_profile ?? undefined,
    successMetric: st.success_metric,
    priority: st.priority ?? idx,
    status: 'pending_approval',
  }));

  const goal: Goal = {
    id,
    title: decomposition.goal_title,
    description: originalGoalText,
    timeframe: decomposition.timeframe,
    successMetric: decomposition.success_metric,
    subTasks,
    status: 'pending_approval',
    createdAt: new Date().toISOString(),
    progressNotes: [`Goal created: ${decomposition.reasoning}`],
    linkedJobIds: [],
  };

  saveGoal(goal);
  return goal;
}

// ─── Approve Goal (create jobs) ────────────────────────────────────────────────

export function approveGoal(
  goalId: string,
  createJob: (partial: Partial<CronJob> & { name: string; prompt: string }) => CronJob,
  approvedSubTaskIds?: string[],  // if undefined, approve all
): { goal: Goal; createdJobs: CronJob[] } | null {
  const goal = loadGoal(goalId);
  if (!goal) return null;

  const toApprove = approvedSubTaskIds
    ? goal.subTasks.filter(st => approvedSubTaskIds.includes(st.id))
    : goal.subTasks;

  const createdJobs: CronJob[] = [];

  for (const subTask of toApprove) {
    const job = createJob({
      name: `[${goal.title}] ${subTask.description.slice(0, 60)}`,
      prompt: subTask.description,
      schedule: subTask.schedule,
      subagent_id: subTask.subagentProfile ?? undefined,
      priority: subTask.priority,
      enabled: true,
    });

    subTask.jobId = job.id;
    subTask.status = 'active';
    goal.linkedJobIds.push(job.id);
    createdJobs.push(job);

    console.log(`[GoalDecomposer] Created job "${job.name}" (${job.id}) for goal "${goal.title}"`);
  }

  goal.status = 'active';
  goal.approvedAt = new Date().toISOString();
  goal.progressNotes.push(`Goal approved at ${goal.approvedAt}. Created ${createdJobs.length} scheduled job(s).`);
  saveGoal(goal);

  return { goal, createdJobs };
}

// ─── Update Goal Progress ──────────────────────────────────────────────────────

export function updateGoalProgress(goalId: string, note: string): void {
  const goal = loadGoal(goalId);
  if (!goal) return;
  goal.progressNotes = [...goal.progressNotes, `[${new Date().toISOString()}] ${note}`].slice(-30);
  saveGoal(goal);
}

export function completeGoal(goalId: string, summary: string): void {
  const goal = loadGoal(goalId);
  if (!goal) return;
  goal.status = 'completed';
  goal.completedAt = new Date().toISOString();
  goal.progressNotes.push(`Goal completed: ${summary}`);
  saveGoal(goal);
}

// ─── Goal Summary for Display ──────────────────────────────────────────────────

export function formatGoalSummary(goal: Goal): string {
  const activeSubTasks = goal.subTasks.filter(st => st.status === 'active').length;
  const completedSubTasks = goal.subTasks.filter(st => st.status === 'completed').length;
  const lastNote = goal.progressNotes[goal.progressNotes.length - 1] ?? 'No notes yet';

  return [
    `🎯 Goal: ${goal.title}`,
    `Status: ${goal.status} | Sub-tasks: ${activeSubTasks} active, ${completedSubTasks} completed of ${goal.subTasks.length}`,
    `Success metric: ${goal.successMetric}`,
    `Last update: ${lastNote.slice(0, 150)}`,
  ].join('\n');
}

// ─── goal_decompose Tool Definition ───────────────────────────────────────────

export interface GoalDecomposeArgs {
  goal: string;           // The high-level goal text
  context?: string;       // Optional additional context about current situation
  auto_approve?: boolean; // If true, skip approval gate (dangerous — off by default)
}

export async function executeGoalDecompose(
  args: GoalDecomposeArgs,
  handleChat: Parameters<typeof decomposeGoal>[2],
  createJob: Parameters<typeof approveGoal>[1],
  sendToUser: (message: string) => Promise<void>,
): Promise<ToolResult> {
  if (!args?.goal?.trim()) {
    return { success: false, error: 'goal is required — provide the high-level goal you want to pursue' };
  }

  console.log(`[GoalDecomposer] Decomposing goal: "${args.goal.slice(0, 100)}"`);

  const decomposition = await decomposeGoal(args.goal, args.context, handleChat);
  if (!decomposition) {
    return { success: false, error: 'Failed to decompose goal — the LLM did not return a valid plan' };
  }

  const goal = createGoalFromDecomposition(args.goal, decomposition);

  // Build approval message
  const approvalLines = [
    `🎯 <b>Goal Decomposition: ${decomposition.goal_title}</b>`,
    ``,
    `📋 <b>Timeframe:</b> ${decomposition.timeframe}`,
    `✅ <b>Success metric:</b> ${decomposition.success_metric}`,
    `⚙️ <b>Estimated effort:</b> ${decomposition.estimated_effort}`,
    ``,
    `<b>Proposed sub-tasks:</b>`,
    ...decomposition.sub_tasks.map((st, i) => [
      ``,
      `<b>${i + 1}. ${st.description.slice(0, 80)}</b>`,
      `   Schedule: ${st.schedule_human}`,
      `   Success: ${st.success_metric}`,
    ].join('\n')),
    ``,
    `💡 <b>Reasoning:</b> ${decomposition.reasoning}`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    `Goal ID: <code>${goal.id}</code>`,
    ``,
    `Reply <b>/approve_goal ${goal.id}</b> to create all scheduled jobs and start pursuing this goal.`,
    `Reply <b>/reject_goal ${goal.id}</b> to discard it.`,
    ``,
    `Or approve individual sub-tasks: <b>/approve_goal ${goal.id} subtask_0 subtask_1</b>`,
  ];

  const approvalMessage = approvalLines.join('\n');

  // Auto-approve if requested (use carefully)
  if (args.auto_approve === true) {
    const result = approveGoal(goal.id, createJob);
    if (result) {
      return {
        success: true,
        data: {
          goal_id: goal.id,
          goal_title: goal.title,
          sub_tasks_created: result.createdJobs.length,
          job_ids: result.createdJobs.map(j => j.id),
          auto_approved: true,
        },
        stdout: `✅ Goal "${goal.title}" auto-approved. Created ${result.createdJobs.length} scheduled job(s).`,
      };
    }
  }

  // Send approval message to user
  try {
    await sendToUser(approvalMessage);
  } catch (e: any) {
    console.warn('[GoalDecomposer] Failed to send approval message:', e.message);
  }

  return {
    success: true,
    data: {
      goal_id: goal.id,
      goal_title: goal.title,
      sub_tasks_count: decomposition.sub_tasks.length,
      awaiting_approval: true,
    },
    stdout: `Goal decomposed into ${decomposition.sub_tasks.length} sub-task(s). Approval request sent.\n\nGoal ID: ${goal.id}\n\n${formatGoalSummary(goal)}`,
  };
}

export const goalDecomposeTool = {
  name: 'goal_decompose',
  description:
    'Decompose a high-level goal into scheduled automated sub-tasks. The AI analyzes the goal and ' +
    'produces a structured plan of recurring jobs. The user approves via /approve_goal <id>. ' +
    'On approval, scheduled jobs are automatically created for each sub-task. ' +
    'Use this when given a goal like "grow my Twitter following", "monitor competitors daily", ' +
    '"keep my GitHub README updated", or "send me weekly business reports".',
  jsonSchema: {
    type: 'object',
    required: ['goal'],
    properties: {
      goal: { type: 'string', description: 'The high-level goal to decompose, e.g. "Post daily content to grow my Twitter following by 500 this month"' },
      context: { type: 'string', description: 'Optional additional context about current situation, constraints, or preferences' },
      auto_approve: { type: 'boolean', description: 'If true, skip the approval gate and immediately create jobs. Default: false.' },
    },
    additionalProperties: false,
  },
};
