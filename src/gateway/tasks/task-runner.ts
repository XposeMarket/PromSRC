/**
 * task-runner.ts - Multi-Step Task Execution Engine
 * 
 * Sliding context window architecture:
 * - Each step gets: goal + compressed journal + current state + tools
 * - Journal keeps last N steps as bullet summaries
 * - Full state only for the CURRENT step (not history)
 * - Model picks ONE action per turn
 * 
 * This enables 20-30 step workflows on a 4B model with 8K context.
 */

import crypto from 'crypto';
import { getOllamaClient } from '../../agents/ollama-client';
import { parseProviderModelRef } from '../../agents/model-routing.js';
import { getConfig } from '../../config/config';
import { registerBrowserSessionMetadata } from '../browser-tools';
import { getActivatedToolCategories, getWorkspace, setActivatedToolCategories, setWorkspace } from '../session';
import { getRuntimeToolCategories } from '../tool-builder';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface TaskTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      required: string[];
      properties: Record<string, any>;
    };
  };
}

export interface JournalEntry {
  step: number;
  action: string;       // e.g. "browser_click({ref: 3})"
  result: string;       // e.g. "Clicked 'Submit' → redirected to dashboard"
  timestamp: number;
}

export interface TaskState {
  id: string;
  goal: string;
  status: 'running' | 'complete' | 'failed' | 'paused';
  currentStep: number;
  maxSteps: number;
  journal: JournalEntry[];
  currentState: string;  // current page/environment snapshot
  error?: string;
  startedAt: number;
  completedAt?: number;
}

export interface TaskStepResult {
  action: string;
  args: any;
  result: string;
  error: boolean;
}

export type ToolExecutor = (name: string, args: any) => Promise<{ result: string; error: boolean; newState?: string }>;

export type BackgroundJoinPolicy = 'wait_all' | 'wait_until_timeout' | 'best_effort_merge';

export type EphemeralBackgroundState = 'queued' | 'in_progress' | 'completed' | 'failed' | 'timed_out';

export interface EphemeralBackgroundStatus {
  id: string;
  state: EphemeralBackgroundState;
  joinPolicy: BackgroundJoinPolicy;
  timeoutMs: number;
  tags?: string[];
  providerId?: string;
  model?: string;
  modelSource?: string;
  startedAt: number;
  completedAt?: number;
  result?: string;
  error?: string;
  mergedAt?: number;
}

export type ProgressCallback = (event: string, data: any) => void;

// ─── Configuration ─────────────────────────────────────────────────────────────

const DEFAULT_MAX_STEPS = 25;
const JOURNAL_WINDOW = 8;      // keep last N journal entries in full
const JOURNAL_SUMMARY_MAX = 5; // summarize earlier entries into N bullet points

// ─── Task Runner ───────────────────────────────────────────────────────────────

export class TaskRunner {
  private state: TaskState;
  private tools: TaskTool[];
  private executor: ToolExecutor;
  private onProgress: ProgressCallback;
  private systemContext: string;

  constructor(options: {
    goal: string;
    tools: TaskTool[];
    executor: ToolExecutor;
    onProgress: ProgressCallback;
    systemContext?: string;  // personality, soul, etc.
    maxSteps?: number;
    initialState?: string;
  }) {
    this.state = {
      id: `task_${Date.now()}`,
      goal: options.goal,
      status: 'running',
      currentStep: 0,
      maxSteps: options.maxSteps || DEFAULT_MAX_STEPS,
      journal: [],
      currentState: options.initialState || 'No state yet. Start by taking an action.',
      startedAt: Date.now(),
    };
    this.tools = options.tools;
    this.executor = options.executor;
    this.onProgress = options.onProgress;
    this.systemContext = options.systemContext || '';
  }

  getState(): TaskState {
    return { ...this.state };
  }

  /**
   * Run the task to completion (or max steps).
   * Returns the final task state.
   */
  async run(): Promise<TaskState> {
    const ollama = getOllamaClient();

    this.onProgress('task_start', { goal: this.state.goal, maxSteps: this.state.maxSteps });
    console.log(`\n[Background Task] ── Starting: "${this.state.goal}" (max ${this.state.maxSteps} steps) ──`);

    while (this.state.status === 'running' && this.state.currentStep < this.state.maxSteps) {
      this.state.currentStep++;
      const step = this.state.currentStep;

      this.onProgress('task_step', { step, maxSteps: this.state.maxSteps });
      console.log(`[Background Task] Step ${step}/${this.state.maxSteps}`);

      // Build the compact prompt
      const messages = this.buildStepMessages();

      // Call model
      let response: any;
      try {
        const result = await ollama.chatWithThinking(messages, 'executor', {
          tools: this.tools,
          temperature: 0.2,     // low temp for task execution
          num_ctx: 8192,
          num_predict: 2048,
          think: false,
        });
        response = result.message;

        if (result.thinking) {
          console.log(`[Background Task] Think: ${result.thinking.slice(0, 100)}...`);
        }
      } catch (err: any) {
        console.error(`[Background Task] Model error at step ${step}:`, err.message);
        this.state.status = 'failed';
        this.state.error = err.message;
        break;
      }

      // Check for tool calls
      const toolCalls = response.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        // Model responded with text — check if it's declaring completion
        const text = (response.content || '').trim();
        console.log(`[Background Task] Model text: ${text.slice(0, 150)}`);

        if (this.isTaskComplete(text)) {
          this.state.status = 'complete';
          this.state.completedAt = Date.now();
          this.addJournal('TASK_COMPLETE', text);
          this.onProgress('task_complete', { message: text, steps: step });
          console.log(`[Background Task] ✅ Complete at step ${step}: ${text.slice(0, 100)}`);
          break;
        }

        if (this.isTaskFailed(text)) {
          this.state.status = 'failed';
          this.state.error = text;
          this.addJournal('TASK_FAILED', text);
          this.onProgress('task_failed', { message: text, steps: step });
          console.log(`[Background Task] ❌ Failed at step ${step}: ${text.slice(0, 100)}`);
          break;
        }

        // Model just talked — nudge it to take action
        this.addJournal('model_response', text);
        console.log(`[Background Task] Model spoke without acting, nudging...`);
        continue;
      }

      // Execute FIRST tool call (one action per step)
      const call = toolCalls[0];
      const toolName = call.function?.name || 'unknown';
      const toolArgs = call.function?.arguments || {};
      const actionStr = `${toolName}(${JSON.stringify(toolArgs).slice(0, 100)})`;

      console.log(`[Background Task] Action: ${actionStr}`);
      this.onProgress('task_action', { step, action: toolName, args: toolArgs });

      try {
        const { result, error, newState } = await this.executor(toolName, toolArgs);

        // Update current state if the executor provides a new one
        if (newState) {
          this.state.currentState = newState;
        }

        // Compress into journal entry
        const summary = error
          ? `❌ ${toolName}: ${result.slice(0, 150)}`
          : `✅ ${toolName}: ${result.slice(0, 150)}`;

        this.addJournal(actionStr, summary);

        this.onProgress('task_result', {
          step, action: toolName, result: result.slice(0, 300), error,
        });

        console.log(error
          ? `[Background Task] ❌ ${result.slice(0, 100)}`
          : `[Background Task] ✅ ${result.slice(0, 100)}`);

        // If there were additional tool calls, log them but don't execute
        if (toolCalls.length > 1) {
          console.log(`[Background Task] (${toolCalls.length - 1} additional tool calls ignored — one per step)`);
        }
      } catch (err: any) {
        const errMsg = `Execution error: ${err.message}`;
        this.addJournal(actionStr, `❌ ${errMsg}`);
        console.error(`[Background Task] Execution error:`, err.message);
        // Don't fail the whole task on one error — let model recover
      }
    }

    // Check if we hit max steps
    if (this.state.status === 'running') {
      this.state.status = 'paused';
      this.state.error = `Reached max steps (${this.state.maxSteps})`;
      this.onProgress('task_paused', {
        message: `Reached ${this.state.maxSteps} steps without completing.`,
        journal: this.state.journal.map(j => j.result),
      });
      console.log(`[Background Task] ⚠️ Paused at max steps (${this.state.maxSteps})`);
    }

    return this.state;
  }

  // ─── Prompt Building ───────────────────────────────────────────────────────

  private buildStepMessages(): any[] {
    const messages: any[] = [];

    // System prompt — compact, focused on task execution
    messages.push({
      role: 'system',
      content: `You are completing a multi-step task. Pick ONE action per turn.

RULES:
1. Take exactly ONE action per turn using the available tools.
2. After each action, you'll see the result and can take the next action.
3. When the task is fully complete, respond with text starting with "TASK_COMPLETE:" followed by a summary.
4. If the task cannot be completed, respond with "TASK_FAILED:" and explain why.
5. Do NOT explain your reasoning. Just pick the next action.
6. Use the CURRENT STATE to decide what to do next — don't guess from memory.
${this.systemContext ? '\n' + this.systemContext : ''}`,
    });

    // Task goal
    messages.push({
      role: 'user',
      content: this.buildTaskPrompt(),
    });

    return messages;
  }

  private buildTaskPrompt(): string {
    const parts: string[] = [];

    // Goal
    parts.push(`TASK: ${this.state.goal}`);
    parts.push(`PROGRESS: Step ${this.state.currentStep} of ${this.state.maxSteps}`);

    // Journal — compressed
    if (this.state.journal.length > 0) {
      parts.push('');
      parts.push('COMPLETED STEPS:');

      const journal = this.state.journal;

      if (journal.length <= JOURNAL_WINDOW) {
        // All entries fit in the window
        for (const entry of journal) {
          parts.push(`  ${entry.step}. ${entry.result}`);
        }
      } else {
        // Summarize older entries, keep recent ones in full
        const oldEntries = journal.slice(0, journal.length - JOURNAL_WINDOW);
        const recentEntries = journal.slice(journal.length - JOURNAL_WINDOW);

        // Ultra-compact summary of old steps
        const summaryCount = Math.min(oldEntries.length, JOURNAL_SUMMARY_MAX);
        parts.push(`  [Steps 1-${oldEntries.length}: ${summaryCount} key actions]`);
        // Pick evenly spaced entries from old ones
        const stride = Math.max(1, Math.floor(oldEntries.length / summaryCount));
        for (let i = 0; i < oldEntries.length; i += stride) {
          if (parts.length - 4 < summaryCount) { // rough limit
            const e = oldEntries[i];
            parts.push(`  ${e.step}. ${e.result.slice(0, 80)}`);
          }
        }

        parts.push('  ...');
        parts.push('  [Recent steps:]');
        for (const entry of recentEntries) {
          parts.push(`  ${entry.step}. ${entry.result}`);
        }
      }
    }

    // Current state — this gets the most context budget
    parts.push('');
    parts.push('CURRENT STATE:');
    // Trim state to ~2000 chars to leave room
    const stateTrimmed = this.state.currentState.length > 2000
      ? this.state.currentState.slice(0, 2000) + '\n...(truncated)'
      : this.state.currentState;
    parts.push(stateTrimmed);

    parts.push('');
    parts.push('What is the next action? Pick ONE tool call.');

    return parts.join('\n');
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private addJournal(action: string, result: string) {
    this.state.journal.push({
      step: this.state.currentStep,
      action,
      result,
      timestamp: Date.now(),
    });
  }

  private isTaskComplete(text: string): boolean {
    const lower = text.toLowerCase();
    return lower.includes('task_complete') ||
           lower.includes('task complete') ||
           lower.includes('successfully completed') ||
           (lower.includes('done') && lower.includes('all steps'));
  }

  private isTaskFailed(text: string): boolean {
    const lower = text.toLowerCase();
    return lower.includes('task_failed') ||
           lower.includes('task failed') ||
           lower.includes('cannot complete') ||
           lower.includes('unable to complete');
  }
}

export interface EphemeralBackgroundSpawnInput {
  prompt: string;
  joinPolicy?: BackgroundJoinPolicy;
  timeoutMs?: number;
  tags?: string[];
  tools?: TaskTool[];  // Optional full tool set (same as main agent)
  spawnerSessionId?: string;  // Session ID of the main chat that spawned this — for SSE forwarding
  modelOverride?: string;
  providerOverride?: string;
}

export interface EphemeralBackgroundJoinResult {
  id: string;
  joinPolicy: BackgroundJoinPolicy;
  state: EphemeralBackgroundState;
  merged: boolean;
  timedOut: boolean;
  result?: string;
  error?: string;
}

export interface EphemeralBackgroundWaitResult {
  waitedMs: number;
  timedOut: boolean;
  backgroundIds: string[];
  completed: number;
  failed: number;
  running: number;
  statuses: EphemeralBackgroundStatus[];
}

interface EphemeralBackgroundRecord extends EphemeralBackgroundStatus {
  promise: Promise<void>;
  spawnerSessionId?: string;
}

const BACKGROUND_WAIT_ALL_CAP_MS = 120_000;
const DEFAULT_BACKGROUND_TIMEOUT_MS = 120_000;
const _ephemeralBackgroundRuns = new Map<string, EphemeralBackgroundRecord>();

// ─── Background Agent deps (injected at startup via setBackgroundAgentDeps) ──
type BgHandleChat = (
  prompt: string,
  sessionId: string,
  sendSSE: (event: string, data: any) => void,
  extra?: any,
  abortSignal?: AbortSignal,
  callerContext?: string,
  modelOverride?: string,
  executionMode?: string,
  toolFilter?: any,
  attachments?: any,
  reasoningOptions?: any,
  providerOverride?: string,
) => Promise<string>;

interface EphemeralBgDeps {
  handleChat: BgHandleChat;
  broadcastWS: (data: any) => void;
}

let _bgDeps: EphemeralBgDeps | null = null;

export function setBackgroundAgentDeps(deps: EphemeralBgDeps): void {
  _bgDeps = deps;
  console.log('[BackgroundAgent] handleChat executor wired — full tool loop active.');
}

// ─── Background Agent Plan State ─────────────────────────────────────────────
// Isolated per-bg-session plan tracking. Never touches main plan panel or task
// records — lives entirely in memory, keyed by bg session ID (background_{id}).
interface BgPlanState {
  steps: string[];
  currentStep: number; // 0-indexed, -1 = not started
}

const _bgAgentPlans = new Map<string, BgPlanState>();

export function bgPlanDeclare(sessionId: string, steps: string[]): string {
  const cleaned = steps.map(s => String(s || '').trim()).filter(Boolean).slice(0, 8);
  if (cleaned.length === 0) return 'ERROR: bg_plan_declare requires at least one step.';
  _bgAgentPlans.set(sessionId, { steps: cleaned, currentStep: 0 });
  const list = cleaned.map((s, i) => `  ${i + 1}. ${s}`).join('\n');
  return `BG Plan declared (${cleaned.length} steps):\n${list}\n\nNow executing Step 1: ${cleaned[0]}`;
}

export function bgPlanAdvance(sessionId: string, note?: string): string {
  const plan = _bgAgentPlans.get(sessionId);
  if (!plan) return 'ERROR: No bg plan declared for this session. Call bg_plan_declare first.';
  const completed = plan.currentStep;
  const completedLabel = plan.steps[completed] || `Step ${completed + 1}`;
  plan.currentStep += 1;
  if (plan.currentStep >= plan.steps.length) {
    _bgAgentPlans.delete(sessionId);
    return `Step ${completed + 1}/${plan.steps.length} complete: ${completedLabel}${note ? ` — ${note}` : ''}.\nAll ${plan.steps.length} steps done. Compose final summary.`;
  }
  const next = plan.steps[plan.currentStep];
  return `Step ${completed + 1}/${plan.steps.length} complete: ${completedLabel}${note ? ` — ${note}` : ''}.\nNow executing Step ${plan.currentStep + 1}: ${next}`;
}

export function getBgPlan(sessionId: string): BgPlanState | null {
  return _bgAgentPlans.get(sessionId) || null;
}

function clampBackgroundTimeoutMs(raw: number | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_BACKGROUND_TIMEOUT_MS;
  return Math.max(500, Math.min(BACKGROUND_WAIT_ALL_CAP_MS, Math.floor(n)));
}

function resolveBackgroundAgentModelRouting(): { providerId?: string; model?: string; source: string } {
  try {
    const cfg = getConfig().getConfig() as any;
    const defaults = cfg?.agent_model_defaults || {};
    const ref = String(defaults.background_agent || defaults.background_task || '').trim();
    if (ref) {
      const parsed = parseProviderModelRef(ref);
      if (parsed) {
        return {
          providerId: parsed.providerId,
          model: parsed.model,
          source: defaults.background_agent ? 'agent_model_defaults.background_agent' : 'agent_model_defaults.background_task',
        };
      }
      return { model: ref, source: defaults.background_agent ? 'agent_model_defaults.background_agent' : 'agent_model_defaults.background_task' };
    }

    const activeProvider = String(cfg?.llm?.provider || '').trim();
    const activeModel = activeProvider ? String(cfg?.llm?.providers?.[activeProvider]?.model || '').trim() : '';
    if (activeProvider || activeModel) {
      return { providerId: activeProvider || undefined, model: activeModel || undefined, source: 'llm.primary' };
    }
  } catch {
    // Fall through to the normal chat router default.
  }
  return { source: 'chat_router_default' };
}

function createBackgroundPrompt(prompt: string): any[] {
  return [
    {
      role: 'system',
      content:
        'You are executing a one-time ephemeral background task in parallel with the main chat. ' +
        'You have full access to all tools (files, browser, memory, shell, etc.) — same as the main agent. ' +
        'Complete your task efficiently and report the outcome.',
    },
    {
      role: 'user',
      content: String(prompt || '').trim(),
    },
  ];
}

function startBackgroundExecution(record: EphemeralBackgroundRecord, prompt: string): Promise<void> {
  return (async () => {
    record.state = 'in_progress';
    console.log(`[Background Agent] ${record.id} started`);

    // ── Full handleChat path (preferred — full tool execution loop + live SSE) ──
    if (_bgDeps?.handleChat) {
      const { handleChat, broadcastWS } = _bgDeps;
      const sessionId = `background_${record.id}`;
      const { spawnerSessionId } = record;
      try {
        const runtimeCategories = getRuntimeToolCategories();
        const inheritedCategories = spawnerSessionId
          ? Array.from(getActivatedToolCategories(spawnerSessionId))
          : [];
        const categories = Array.from(new Set([
          ...runtimeCategories,
          ...inheritedCategories,
        ]));
        setActivatedToolCategories(sessionId, categories);
        if (spawnerSessionId) {
          const parentWorkspace = getWorkspace(spawnerSessionId);
          if (parentWorkspace) setWorkspace(sessionId, parentWorkspace);
        }
      } catch (err: any) {
        console.warn(`[Background Agent] ${record.id} could not inherit session tool context: ${err?.message || err}`);
      }
      registerBrowserSessionMetadata(sessionId, {
        ownerType: 'background',
        ownerId: record.id,
        label: 'Subagent',
        taskPrompt: prompt,
        spawnerSessionId,
      });
      const modelRouting = resolveBackgroundAgentModelRouting();
      const providerOverride = String(record.providerId || '').trim();
      const modelOverride = String(record.model || '').trim();
      record.providerId = providerOverride || modelRouting.providerId;
      record.model = modelOverride || modelRouting.model;
      record.modelSource = (providerOverride || modelOverride)
        ? (record.modelSource || 'background_spawn_override')
        : modelRouting.source;
      const toolCallLog: string[] = [];

      if (spawnerSessionId) {
        broadcastWS({
          type: 'browser:agent_registered',
          sessionId,
          browserOwnerType: 'background',
          browserOwnerId: record.id,
          browserLabel: 'Subagent',
          browserTaskPrompt: prompt,
          browserSpawnerSessionId: spawnerSessionId,
          active: false,
          timestamp: Date.now(),
        });
      }

      // Forward every SSE event to the spawner's UI session so the user sees activity in real time
      const sendSSE = (event: string, data: any) => {
        if (spawnerSessionId) {
          broadcastWS({
            type: 'bg_agent_event',
            sessionId: spawnerSessionId,
            bgId: record.id,
            eventType: event,
            actor: 'Background Agent',
            ...(data && typeof data === 'object' ? data : { message: String(data ?? '') }),
          });
        }
        // Capture tool calls for the result summary returned to main agent on join
        if (event === 'tool_call' && data?.name) {
          const argsPreview = JSON.stringify(data.args ?? {}).slice(0, 120);
          toolCallLog.push(`→ ${data.name}(${argsPreview})`);
        } else if (event === 'tool_result' && data?.name) {
          const resultPreview = String(data.result ?? '').replace(/\s+/g, ' ').slice(0, 200);
          toolCallLog.push(`  ← ${data.name}: ${resultPreview}`);
        }
      };

      try {
        const chatResult = await handleChat(
          prompt,
          sessionId,
          sendSSE,
          undefined,   // extra
          undefined,   // abortSignal
          `[Background Agent ${record.id}] You are executing a one-time ephemeral background task in parallel with the main chat. Complete the task using tools as needed and report the outcome clearly.`,
          record.model,   // modelOverride
          'background_agent',
          undefined,   // toolFilter — full tool access
          undefined,
          undefined,
          record.providerId,
        );
        // handleChat returns a ChatResult object — extract .text, not the whole object
        const finalText = String((chatResult as any)?.text ?? chatResult ?? '').trim();

        const toolSummary = toolCallLog.length > 0
          ? `\n\n---\n**Tool calls made:**\n${toolCallLog.join('\n')}`
          : '';
        record.result = (finalText || 'Background task completed with no textual output.') + toolSummary;
        record.state = 'completed';
        record.completedAt = Date.now();
        console.log(`[Background Agent] ${record.id} completed`);

        if (spawnerSessionId) {
          broadcastWS({ type: 'bg_agent_done', sessionId: spawnerSessionId, bgId: record.id, state: 'completed', result: record.result, actor: 'Background Agent', providerId: record.providerId, model: record.model, modelSource: record.modelSource });
        }
      } catch (err: any) {
        record.error = String(err?.message || err || 'Background execution failed');
        record.state = 'failed';
        record.completedAt = Date.now();
        console.log(`[Background Agent] ${record.id} failed: ${record.error}`);
        if (spawnerSessionId) {
          broadcastWS({ type: 'bg_agent_done', sessionId: spawnerSessionId, bgId: record.id, state: 'failed', error: record.error, actor: 'Background Agent', providerId: record.providerId, model: record.model, modelSource: record.modelSource });
        }
      }
      return;
    }

    // ── Fallback: single-shot LLM call (deps not yet injected) ────────────
    try {
      const ollama = getOllamaClient();
      const out = await ollama.chatWithThinking(createBackgroundPrompt(prompt), 'executor', {
        temperature: 0.2,
        num_ctx: 8192,
        num_predict: 2048,
        think: false,
      });
      const text = String(out?.message?.content || '').trim();
      record.result = text || 'Background task completed with no textual output.';
      record.state = 'completed';
      record.completedAt = Date.now();
      console.log(`[Background Agent] ${record.id} completed (fallback — no handleChat wired)`);
    } catch (err: any) {
      record.error = String(err?.message || err || 'Background execution failed');
      record.state = 'failed';
      record.completedAt = Date.now();
      console.log(`[Background Agent] ${record.id} failed: ${record.error}`);
    }
  })();
}

export function backgroundSpawn(input: EphemeralBackgroundSpawnInput): EphemeralBackgroundStatus {
  const prompt = String(input?.prompt || '').trim();
  if (!prompt) {
    throw new Error('background_spawn requires prompt');
  }
  const id = `bg_${crypto.randomUUID()}`;
  const joinPolicy: BackgroundJoinPolicy =
    input?.joinPolicy === 'wait_all' || input?.joinPolicy === 'best_effort_merge'
      ? input.joinPolicy
      : 'wait_all';
  const timeoutMs = clampBackgroundTimeoutMs(input?.timeoutMs);

  const record: EphemeralBackgroundRecord = {
    id,
    state: 'queued',
    joinPolicy,
    timeoutMs,
    tags: Array.isArray(input?.tags) ? input.tags.map((v) => String(v)).filter(Boolean).slice(0, 12) : undefined,
    startedAt: Date.now(),
    promise: Promise.resolve(),
  };

  record.spawnerSessionId = String(input?.spawnerSessionId || '').trim() || undefined;
  const explicitProviderOverride = String(input?.providerOverride || '').trim();
  const explicitModelOverride = String(input?.modelOverride || '').trim();
  if (explicitProviderOverride) record.providerId = explicitProviderOverride;
  if (explicitModelOverride) record.model = explicitModelOverride;
  if (explicitProviderOverride || explicitModelOverride) record.modelSource = 'background_spawn_override';
  record.promise = startBackgroundExecution(record, prompt);
  _ephemeralBackgroundRuns.set(id, record);
  console.log(`[Background Agent] spawned ${id} (policy=${joinPolicy}, timeoutMs=${timeoutMs})`);

  return {
    id: record.id,
    state: record.state,
    joinPolicy: record.joinPolicy,
    timeoutMs: record.timeoutMs,
    tags: record.tags,
    providerId: record.providerId,
    model: record.model,
    modelSource: record.modelSource,
    startedAt: record.startedAt,
  };
}

export function backgroundStatus(backgroundId: string): EphemeralBackgroundStatus | null {
  const rec = _ephemeralBackgroundRuns.get(String(backgroundId || '').trim());
  if (!rec) return null;
  return {
    id: rec.id,
    state: rec.state,
    joinPolicy: rec.joinPolicy,
    timeoutMs: rec.timeoutMs,
    tags: rec.tags,
    providerId: rec.providerId,
    model: rec.model,
    modelSource: rec.modelSource,
    startedAt: rec.startedAt,
    completedAt: rec.completedAt,
    result: rec.result,
    error: rec.error,
    mergedAt: rec.mergedAt,
  };
}

export const backgroundProgress = backgroundStatus;

function isBackgroundTerminal(rec: EphemeralBackgroundRecord): boolean {
  return rec.state === 'completed' || rec.state === 'failed' || rec.state === 'timed_out';
}

function listBackgroundRecordsForWait(input: {
  backgroundId?: string;
  backgroundIds?: string[];
  spawnerSessionId?: string;
}): EphemeralBackgroundRecord[] {
  const explicitIds = [
    String(input?.backgroundId || '').trim(),
    ...(Array.isArray(input?.backgroundIds) ? input.backgroundIds.map((id) => String(id || '').trim()) : []),
  ].filter(Boolean);
  if (explicitIds.length > 0) {
    return Array.from(new Set(explicitIds))
      .map((id) => _ephemeralBackgroundRuns.get(id))
      .filter(Boolean) as EphemeralBackgroundRecord[];
  }
  const spawnerSessionId = String(input?.spawnerSessionId || '').trim();
  if (!spawnerSessionId) return [];
  return Array.from(_ephemeralBackgroundRuns.values())
    .filter((rec) => rec.spawnerSessionId === spawnerSessionId && !isBackgroundTerminal(rec));
}

function statusFromRecord(rec: EphemeralBackgroundRecord): EphemeralBackgroundStatus {
  return {
    id: rec.id,
    state: rec.state,
    joinPolicy: rec.joinPolicy,
    timeoutMs: rec.timeoutMs,
    tags: rec.tags,
    providerId: rec.providerId,
    model: rec.model,
    modelSource: rec.modelSource,
    startedAt: rec.startedAt,
    completedAt: rec.completedAt,
    result: rec.result,
    error: rec.error,
    mergedAt: rec.mergedAt,
  };
}

export async function backgroundWait(input: {
  backgroundId?: string;
  backgroundIds?: string[];
  spawnerSessionId?: string;
  timeoutMs?: number;
}): Promise<EphemeralBackgroundWaitResult> {
  const records = listBackgroundRecordsForWait(input);
  const timeoutMs = clampBackgroundTimeoutMs(input?.timeoutMs);
  const startedAt = Date.now();
  if (records.length > 0) {
    await Promise.race([
      Promise.all(records.map((rec) => rec.promise.catch(() => undefined))),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  } else if (timeoutMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, timeoutMs));
  }
  const waitedMs = Date.now() - startedAt;
  const statuses = records.map(statusFromRecord);
  const completed = statuses.filter((status) => status.state === 'completed').length;
  const failed = statuses.filter((status) => status.state === 'failed').length;
  const running = statuses.filter((status) => status.state === 'in_progress' || status.state === 'queued').length;
  return {
    waitedMs,
    timedOut: running > 0,
    backgroundIds: statuses.map((status) => status.id),
    completed,
    failed,
    running,
    statuses,
  };
}

async function waitForBackgroundWithTimeout(rec: EphemeralBackgroundRecord, timeoutMs: number): Promise<boolean> {
  if (rec.state === 'completed' || rec.state === 'failed' || rec.state === 'timed_out') return true;
  const winner = await Promise.race([
    rec.promise.then(() => 'done'),
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs)),
  ]);
  if (winner === 'timeout') {
    rec.state = 'timed_out';
    return false;
  }
  return true;
}

export async function backgroundJoin(input: {
  backgroundId: string;
  joinPolicy?: BackgroundJoinPolicy;
  timeoutMs?: number;
}): Promise<EphemeralBackgroundJoinResult | null> {
  const rec = _ephemeralBackgroundRuns.get(String(input?.backgroundId || '').trim());
  if (!rec) return null;

  const policy: BackgroundJoinPolicy =
    input?.joinPolicy === 'wait_all' || input?.joinPolicy === 'best_effort_merge'
      ? input.joinPolicy
      : (rec.joinPolicy || 'wait_until_timeout');
  const timeoutMs = clampBackgroundTimeoutMs(input?.timeoutMs ?? rec.timeoutMs);

  let completed = rec.state === 'completed' || rec.state === 'failed';
  let timedOut = false;

  if (!completed) {
    if (policy === 'wait_all') {
      await rec.promise;
    } else if (policy === 'wait_until_timeout') {
      completed = await waitForBackgroundWithTimeout(rec, timeoutMs);
      timedOut = !completed;
    }
  }

  const terminal = rec.state === 'completed' || rec.state === 'failed';
  const canMerge = terminal && !rec.mergedAt;
  if (canMerge) {
    rec.mergedAt = Date.now();
  }
  console.log(`[Background Agent] join ${rec.id}: state=${rec.state} merged=${canMerge} timedOut=${timedOut}`);

  return {
    id: rec.id,
    joinPolicy: policy,
    state: rec.state,
    merged: canMerge,
    timedOut,
    result: rec.result,
    error: rec.error,
  };
}


// ─── Convenience: Run a one-shot task ──────────────────────────────────────────

export async function runTask(options: {
  goal: string;
  tools: TaskTool[];
  executor: ToolExecutor;
  onProgress: ProgressCallback;
  systemContext?: string;
  maxSteps?: number;
  initialState?: string;
}): Promise<TaskState> {
  const runner = new TaskRunner(options);
  return runner.run();
}
