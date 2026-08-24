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
import { normalizeReasoningEffort } from '../../providers/reasoning-capabilities';
import { registerBrowserSessionMetadata } from '../browser-tools';
import { addPendingRuntimeSteerForBackgroundAgent, addPendingRuntimeSteerForSession, finishLiveRuntime, registerLiveRuntime } from '../live-runtime-registry';
import { getSession, getWorkspace, replaceHistory, setActivatedToolCategories, setWorkspace } from '../session';
import { updateVoiceWorkgroupWorkerStatus } from '../voice/voice-workgroup-store';
import { getResourceStore, redactResourceText } from '../resources/resource-store';
import { gatewayRuntimeAdmission, type RuntimeAdmissionLease } from '../runtime-admission';
import {
  appendBackgroundAgentStreamEvent,
  backgroundAgentStreamSummary,
  createBackgroundAgentStream,
  finishBackgroundAgentStream,
  replayBackgroundAgentStream,
  type BackgroundAgentStreamFrame,
  type BackgroundAgentStreamState,
} from './background-agent-stream';

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
  spawnerSessionId?: string;
  resourceIds?: string[];
  prompt?: string;
  promptPreview?: string;
  fileChanges?: any;
  providerId?: string;
  model?: string;
  modelSource?: string;
  reasoningEffort?: string;
  /** Stable snake_case field exposed to tool callers and benchmark runners. */
  executor_reasoning_effort?: string;
  stream?: Record<string, any> | null;
  startedAt: number;
  completedAt?: number;
  result?: string;
  error?: string;
  mergedAt?: number;
}

export type ProgressCallback = (event: string, data: any) => void;

function backgroundTraceText(value: unknown, max = 4_000): string {
  const text = String(value ?? '').trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function backgroundProcessEntryFromSseEvent(event: string, data: any): Record<string, any> | null {
  const eventType = String(event || '').trim();
  const source = String(data?.source || data?.extra?.source || '').trim().toLowerCase();
  const visibility = String(data?.visibility || data?.extra?.visibility || '').trim().toLowerCase();
  const userVisibleReasoning = eventType === 'reasoning_summary_delta'
    || eventType === 'reasoning_summary'
    || source === 'reasoning_summary'
    || visibility === 'user';
  if (!eventType || eventType === 'heartbeat' || eventType === 'token'
    || (eventType === 'thinking_delta' && !userVisibleReasoning)) return null;
  const action = String(data?.action || data?.name || data?.toolName || '').trim();
  const baseExtra = {
    source: source || 'background_sse',
    event: eventType,
    ...(action ? { toolName: action } : {}),
    ...(data?.args && typeof data.args === 'object' ? { args: data.args } : {}),
    ...(data?.toolCallId || data?.tool_call_id ? { toolCallId: data.toolCallId || data.tool_call_id } : {}),
    ...(data?.error ? { error: true } : {}),
  };
  if (userVisibleReasoning && (eventType === 'thinking_delta' || eventType === 'reasoning_summary_delta' || eventType === 'reasoning_summary')) {
    const text = backgroundTraceText(data?.text || data?.thinking || data?.summary || data?.message);
    return text ? {
      type: 'think',
      actor: 'Prom',
      text,
      extra: { ...baseExtra, source: 'reasoning_summary', visibility: 'user' },
    } : null;
  }
  if (eventType === 'tool_call') {
    const text = backgroundTraceText(action ? `Preparing ${action}` : data?.message || 'Preparing tool');
    return text ? { type: 'tool', actor: 'Prom', text, extra: baseExtra } : null;
  }
  if (eventType === 'tool_result') {
    const result = backgroundTraceText(data?.result || data?.output || (action ? `${action} complete` : 'Tool complete'), 4_000);
    return result ? { type: data?.error ? 'error' : 'result', actor: 'Prom', text: `${action}${result && action && !result.startsWith(action) ? ` -> ${result}` : result}`, extra: baseExtra } : null;
  }
  if (eventType === 'model_stream_event') {
    const modelEvent = data?.event && typeof data.event === 'object' ? data.event : {};
    const modelType = String(modelEvent.type || '').trim().toLowerCase();
    if (!/^tool_call_(?:start|done)$/.test(modelType)) return null;
    const modelAction = String(modelEvent.name || modelEvent.toolName || action || 'tool').trim();
    return { type: 'info', actor: 'Prom', text: `${modelType.endsWith('start') ? 'Preparing' : 'Prepared'} ${modelAction}`, extra: { ...baseExtra, source: 'model_stream_event', modelType, toolName: modelAction } };
  }
  if (eventType === 'progress_state') {
    const items = Array.isArray(data?.items)
      ? data.items.map((item: any) => String(item?.label || item?.text || item?.title || '').trim()).filter(Boolean).slice(-8)
      : [];
    const content = [String(data?.reason || '').trim(), items.length ? items.join(' | ') : ''].filter(Boolean).join(': ');
    return content ? { type: 'info', actor: 'Prom', text: `Progress: ${content}`, extra: baseExtra } : null;
  }
  if (eventType === 'thinking' || eventType === 'agent_thought') {
    if (visibility === 'private' || visibility === 'internal') return null;
    const text = backgroundTraceText(data?.thinking || data?.text || data?.message);
    return text ? { type: 'think', actor: 'Prom', text, extra: { ...baseExtra, visibility: visibility || 'user' } } : null;
  }
  const text = backgroundTraceText(data?.message || data?.text || data?.result || data?.summary, 2_000);
  if (!text) return null;
  return { type: eventType === 'error' ? 'error' : eventType === 'warn' ? 'warn' : 'info', actor: 'Prom', text, extra: baseExtra };
}

function appendBackgroundSseTrace(
  processEntries: Record<string, any>[],
  liveTraceEntries: Record<string, any>[],
  event: string,
  data: any,
  frame: BackgroundAgentStreamFrame,
): void {
  const raw = backgroundProcessEntryFromSseEvent(event, data);
  if (!raw) return;
  const at = Number(frame.at || Date.now()) || Date.now();
  const streamId = String(frame.streamId || '').trim();
  const seq = Math.max(0, Math.floor(Number(frame.seq || 0)) || 0);
  const id = streamId && seq ? `trace_${streamId}_${seq}` : `trace_background_${processEntries.length + 1}`;
  const entry = {
    ...raw,
    id,
    at,
    ...(streamId ? { streamId } : {}),
    ...(seq ? { seq } : {}),
    time: new Date(at).toLocaleTimeString(),
  };
  processEntries.push(entry);
  if (processEntries.length > 500) processEntries.splice(0, processEntries.length - 500);
  const trace = {
    id,
    type: raw.type,
    text: raw.text,
    time: at,
    ...(streamId ? { streamId } : {}),
    ...(seq ? { seq } : {}),
    extra: raw.extra,
  };
  const previous = liveTraceEntries[liveTraceEntries.length - 1];
  if (raw.type === 'think' && String(raw.extra?.source || '').toLowerCase() === 'reasoning_summary'
    && previous?.type === 'think'
    && String(previous.extra?.source || '').toLowerCase() === 'reasoning_summary') {
    previous.text = `${String(previous.text || '')}${String(raw.text || '')}`.slice(-12_000);
    previous.time = at;
  } else {
    liveTraceEntries.push(trace);
    if (liveTraceEntries.length > 500) liveTraceEntries.splice(0, liveTraceEntries.length - 500);
  }
}

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
          usageContext: { sessionId: this.state.id || 'background_task', agentId: 'background_task' },
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
  resourceIds?: string[];     // Explicit resource links inherited only by this background_spawn worker
  modelOverride?: string;
  providerOverride?: string;
  reasoningEffort?: string;
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

export interface EphemeralBackgroundSteerResult {
  id: string;
  state: EphemeralBackgroundState;
  queued: boolean;
  eventId?: string;
  error?: string;
}

interface EphemeralBackgroundRecord extends EphemeralBackgroundStatus {
  promise: Promise<void>;
  spawnerSessionId?: string;
  abortSignal?: { aborted: boolean; signal?: AbortSignal };
  abortController?: AbortController;
  promptPreview?: string;
  fileChanges?: any;
  resourceIds?: string[];
  backgroundStream: BackgroundAgentStreamState;
}

const BACKGROUND_WAIT_ALL_CAP_MS = 120_000;
const DEFAULT_BACKGROUND_TIMEOUT_MS = 120_000;
const _ephemeralBackgroundRuns = new Map<string, EphemeralBackgroundRecord>();

function backgroundVoiceWorkgroupId(record: Pick<EphemeralBackgroundStatus, 'tags'>): string {
  const tag = (Array.isArray(record.tags) ? record.tags : [])
    .find((value) => String(value || '').startsWith('voice_workgroup:'));
  return tag ? String(tag).slice('voice_workgroup:'.length).trim() : '';
}

function backgroundVoiceDispatchMetadata(record: Pick<EphemeralBackgroundStatus, 'tags'>): Record<string, any> {
  const voiceWorkgroupId = backgroundVoiceWorkgroupId(record);
  return voiceWorkgroupId ? { voiceDispatch: true, voiceWorkgroupId, workgroupId: voiceWorkgroupId, tags: record.tags } : { tags: record.tags };
}

function persistBackgroundVoiceWorker(record: EphemeralBackgroundRecord): void {
  const workgroupId = backgroundVoiceWorkgroupId(record);
  if (!workgroupId) return;
  const status = record.state === 'completed' ? 'complete' : record.state === 'in_progress' ? 'running' : record.state;
  try {
    updateVoiceWorkgroupWorkerStatus(workgroupId, record.id, status, {
      currentStep: status === 'running' ? 'Working in the background' : undefined,
      finalResult: record.state === 'completed' ? String(record.result || '').trim() : String(record.error || '').trim(),
      updatedAt: Date.now(),
    });
  } catch (err: any) {
    console.warn(`[Background Agent] Could not persist voice workgroup status for ${record.id}: ${err?.message || err}`);
  }
}

function queueBackgroundResultForForeground(record: EphemeralBackgroundRecord): boolean {
  const spawnerSessionId = String(record.spawnerSessionId || '').trim();
  if (!spawnerSessionId || (record.state !== 'completed' && record.state !== 'failed')) return false;
  const outcome = record.state === 'completed'
    ? String(record.result || 'Background task completed with no textual output.').trim()
    : String(record.error || 'Background task failed without an error message.').trim();
  const queued = addPendingRuntimeSteerForSession(spawnerSessionId, {
    message: outcome,
    source: 'background_spawn_completion',
    kind: 'background_agent_result',
    requiresWorkerResponse: true,
    clientRequestId: `background_agent_result:${record.id}`,
    backgroundAgentId: record.id,
    backgroundAgentState: record.state,
    contextSummary: `One-shot background agent ${record.id} finished the delegated task: ${String(record.prompt || record.promptPreview || '').slice(0, 1200)}`,
  });
  if (!queued.ok) {
    console.warn(`[Background Agent] ${record.id} could not inject completion into foreground runtime: ${queued.error || 'unknown error'}`);
  }
  return queued.ok;
}

// ─── Background Agent deps (injected at startup via setBackgroundAgentDeps) ──
type BgHandleChat = (
  prompt: string,
  sessionId: string,
  sendSSE: (event: string, data: any) => void,
  extra?: any,
  abortSignal?: { aborted: boolean },
  callerContext?: string,
  modelOverride?: string,
  executionMode?: string,
  toolFilter?: any,
  attachments?: any,
  reasoningOptions?: any,
  providerOverride?: string,
  callerOnToken?: (token: string) => void,
  runtimeOptions?: { admissionLease?: RuntimeAdmissionLease },
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

export function resolveBackgroundAgentModelRouting(record?: Pick<EphemeralBackgroundRecord, 'providerId' | 'model' | 'reasoningEffort'>): { providerId?: string; model?: string; reasoningEffort?: string; source: string } {
  if (record?.providerId || record?.model) {
    const rawProvider = String(record.providerId || '').trim();
    const rawModel = String(record.model || '').trim();
    const parsed = parseProviderModelRef(rawModel);
    const providerId = parsed?.providerId || rawProvider || undefined;
    const model = parsed?.model || rawModel || undefined;
    const reasoningEffort = normalizeReasoningEffort(String(providerId || ''), String(model || ''), record.reasoningEffort);
    if (record.reasoningEffort && !reasoningEffort) {
      throw new Error(`Reasoning effort "${record.reasoningEffort}" is not supported by ${providerId || 'the selected provider'}/${model || 'the selected model'}.`);
    }
    return { providerId, model, reasoningEffort, source: 'background_spawn.override' };
  }
  try {
    const cfg = getConfig().getConfig() as any;
    const defaults = cfg?.agent_model_defaults || {};
    const slot = 'background_spawn';
    const ref = String(defaults[slot] || '').trim();
    if (ref) {
      const parsed = parseProviderModelRef(ref);
      if (parsed) {
        return {
          providerId: parsed.providerId,
          model: parsed.model,
          reasoningEffort: normalizeReasoningEffort(parsed.providerId, parsed.model, record?.reasoningEffort || cfg?.agent_model_default_reasoning?.[slot]),
          source: `agent_model_defaults.${slot}`,
        };
      }
      return { model: ref, source: `agent_model_defaults.${slot}` };
    }

    const activeProvider = String(cfg?.llm?.provider || '').trim();
    const activeModel = activeProvider ? String(cfg?.llm?.providers?.[activeProvider]?.model || '').trim() : '';
    if (activeProvider || activeModel) {
      return {
        providerId: activeProvider || undefined,
        model: activeModel || undefined,
        reasoningEffort: normalizeReasoningEffort(activeProvider, activeModel, record?.reasoningEffort),
        source: 'llm.primary',
      };
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
        'You start with core tools and can request additional categories when needed. ' +
        'Complete your task efficiently and report the outcome.',
    },
    {
      role: 'user',
      content: String(prompt || '').trim(),
    },
  ];
}

function startBackgroundExecution(record: EphemeralBackgroundRecord, prompt: string): Promise<void> {
  let runtimeAdmissionLease: RuntimeAdmissionLease | null = null;
  const execution = (async () => {
    const abortController = new AbortController();
    const abortSignal = record.abortSignal || { aborted: false };
    abortSignal.signal = abortController.signal;
    record.abortSignal = abortSignal;
    record.abortController = abortController;
    try {
      runtimeAdmissionLease = await gatewayRuntimeAdmission.acquire({
        lane: 'background',
        signal: abortController.signal,
        metadata: { sessionId: 'background_' + record.id, backgroundId: record.id },
      });
    } catch (error: any) {
      record.state = 'failed';
      record.error = String(error?.message || error || 'Background runtime admission failed');
      record.completedAt = Date.now();
      persistBackgroundVoiceWorker(record);
      queueBackgroundResultForForeground(record);
      console.warn('[Background Agent] ' + record.id + ' was not admitted: ' + record.error);
      return;
    }
    const runtimeSessionId = `background_${record.id}`;
    const runtimeId = registerLiveRuntime({
      kind: 'background_agent',
      label: 'Background agent',
      sessionId: runtimeSessionId,
      taskId: record.id,
      source: 'background_spawn',
      detail: String(prompt || '').slice(0, 160),
      abortSignal,
      onAbort: () => {
        abortController.abort();
        if (!isBackgroundTerminal(record)) {
          record.state = 'failed';
          record.error = 'Aborted by operator.';
          record.completedAt = Date.now();
        }
      },
    });
    record.state = 'in_progress';
    console.log(`[Background Agent] ${record.id} started`);

    // ── Full handleChat path (preferred — full tool execution loop + live SSE) ──
    if (_bgDeps?.handleChat) {
      const { handleChat, broadcastWS } = _bgDeps;
      const sessionId = runtimeSessionId;
      const { spawnerSessionId } = record;
      try {
        // Background agents get a fresh tool surface. They should not inherit
        // every category the foreground chat has opened during the session,
        // because that bloats native tool schemas for the entire background run.
        setActivatedToolCategories(sessionId, []);
        if (spawnerSessionId) {
          const parentWorkspace = getWorkspace(spawnerSessionId);
          if (parentWorkspace) setWorkspace(sessionId, parentWorkspace);
          try {
            getResourceStore(parentWorkspace || getConfig().getWorkspacePath()).copyThreadResources(
              spawnerSessionId,
              sessionId,
              {
                resourceIds: record.resourceIds,
                inheritedBy: 'background_spawn',
                actor: 'background_spawn',
              },
            );
          } catch (error: any) {
            console.warn(`[Background Agent] ${record.id} could not inherit chat resources: ${redactResourceText(error?.message || error)}`);
          }
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
      const modelRouting = record.modelSource
        ? {
            providerId: record.providerId,
            model: record.model,
            reasoningEffort: record.reasoningEffort,
            source: record.modelSource,
          }
        : resolveBackgroundAgentModelRouting(record);
      record.providerId = modelRouting.providerId;
      record.model = modelRouting.model;
      record.modelSource = modelRouting.source;
      record.reasoningEffort = modelRouting.reasoningEffort;
      const toolCallLog: string[] = [];
      const backgroundProcessEntries: Record<string, any>[] = [];
      const backgroundLiveTraceEntries: Record<string, any>[] = [];
      let lastSessionCheckpointAt = 0;
      const persistBackgroundSessionCheckpoint = (terminal = false, finalText = '', reasoningSummary = '') => {
        const now = Date.now();
        if (!terminal && now - lastSessionCheckpointAt < 1200) return;
        try {
          const session = getSession(sessionId);
          const history = Array.isArray(session.history) ? session.history.slice() : [];
          const promptKey = String(prompt || '').replace(/\s+/g, ' ').trim();
          const hasUserPrompt = history.some((entry: any) => entry?.role === 'user'
            && String(entry.content || '').replace(/\s+/g, ' ').trim() === promptKey);
          if (!hasUserPrompt) {
            history.push({
              role: 'user',
              content: prompt,
              timestamp: Number(record.startedAt || now) || now,
              channel: 'background_agent',
              channelLabel: 'Background agent',
            } as any);
          }
          const assistantIndex = history.findIndex((entry: any) => entry?.role === 'assistant'
            && String(entry.backgroundAgentId || '') === String(record.id));
          const content = terminal
            ? String(finalText || record.error || 'Background task completed with no textual output.').trim()
            : 'Background agent is working...';
          const assistant = {
            role: 'assistant',
            content,
            timestamp: now,
            backgroundAgentId: record.id,
            messageKind: 'background_agent_run',
            channel: 'background_agent',
            channelLabel: 'Background agent',
            streaming: !terminal,
            workStartedAt: Number(record.startedAt || now) || now,
            ...(terminal ? { workEndedAt: now, workDurationMs: Math.max(0, now - Number(record.startedAt || now)) } : {}),
            processEntries: backgroundProcessEntries.slice(-500),
            liveTraceEntries: backgroundLiveTraceEntries.slice(-500),
            reasoningSummary: String(reasoningSummary || '').trim() || undefined,
          };
          if (assistantIndex >= 0) history[assistantIndex] = assistant as any;
          else history.push(assistant as any);
          replaceHistory(sessionId, history as any, { historyChangeSource: 'replace_history' });
          lastSessionCheckpointAt = now;
        } catch (error: any) {
          console.warn(`[Background Agent] ${record.id} session trace checkpoint failed: ${error?.message || error}`);
        }
      };

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
        const frame = appendBackgroundAgentStreamEvent(record.backgroundStream, event, data);
        appendBackgroundSseTrace(backgroundProcessEntries, backgroundLiveTraceEntries, event, data, frame);
        persistBackgroundSessionCheckpoint();
        if (spawnerSessionId) {
          const eventData = data && typeof data === 'object' ? data : { message: String(data ?? '') };
          broadcastWS({
            ...eventData,
            ...backgroundVoiceDispatchMetadata(record),
            type: 'bg_agent_event',
            sessionId: spawnerSessionId,
            spawnerSessionId,
            bgSessionId: sessionId,
            backgroundSessionId: sessionId,
            bgId: record.id,
            eventType: event,
            actor: 'Background Agent',
            task: prompt,
            prompt,
            taskPrompt: prompt,
            streamId: frame.streamId,
            seq: frame.seq,
            at: frame.at,
            data: frame.data,
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
          abortSignal,
          `[Background Agent ${record.id}] You are executing a one-time ephemeral background task in parallel with the main chat. Complete the task using tools as needed and report the outcome clearly. Effective routing: provider=${record.providerId || 'default'}, model=${record.model || 'default'}, reasoning=${record.reasoningEffort || 'provider_default'}.`,
          record.model,   // modelOverride
          'background_task',
          undefined,   // toolFilter — full tool access
          undefined,
          record.reasoningEffort
            ? { enabled: record.reasoningEffort !== 'none', level: record.reasoningEffort }
            : undefined,
          record.providerId,
          undefined,
          { admissionLease: runtimeAdmissionLease || undefined },
        );
        record.fileChanges = (chatResult as any)?.fileChanges || undefined;
        // handleChat returns a ChatResult object — extract .text, not the whole object
        const finalText = String((chatResult as any)?.text ?? chatResult ?? '').trim();
        if (abortSignal.aborted) {
          record.error = 'Aborted by operator.';
          record.state = 'failed';
          record.completedAt = Date.now();
          persistBackgroundSessionCheckpoint(true, '', String((chatResult as any)?.reasoningSummary || ''));
          finishBackgroundAgentStream(record.backgroundStream);
          persistBackgroundVoiceWorker(record);
          if (spawnerSessionId) {
            broadcastWS({ ...backgroundVoiceDispatchMetadata(record), type: 'bg_agent_done', sessionId: spawnerSessionId, spawnerSessionId, bgSessionId: sessionId, backgroundSessionId: sessionId, bgId: record.id, state: 'failed', error: record.error, task: prompt, prompt, taskPrompt: prompt, fileChanges: record.fileChanges, actor: 'Background Agent', providerId: record.providerId, model: record.model, modelSource: record.modelSource, executor_reasoning_effort: record.reasoningEffort });
          }
          finishLiveRuntime(runtimeId);
          return;
        }

        const toolSummary = toolCallLog.length > 0
          ? `\n\n---\n**Tool calls made:**\n${toolCallLog.join('\n')}`
          : '';
        record.result = (finalText || 'Background task completed with no textual output.') + toolSummary;
        record.state = 'completed';
        record.completedAt = Date.now();
        persistBackgroundSessionCheckpoint(true, finalText, String((chatResult as any)?.reasoningSummary || ''));
        finishBackgroundAgentStream(record.backgroundStream);
        persistBackgroundVoiceWorker(record);
        queueBackgroundResultForForeground(record);
        console.log(`[Background Agent] ${record.id} completed`);

        if (spawnerSessionId) {
          broadcastWS({ ...backgroundVoiceDispatchMetadata(record), type: 'bg_agent_done', sessionId: spawnerSessionId, spawnerSessionId, bgSessionId: sessionId, backgroundSessionId: sessionId, bgId: record.id, state: 'completed', result: record.result, task: prompt, prompt, taskPrompt: prompt, fileChanges: record.fileChanges, actor: 'Background Agent', providerId: record.providerId, model: record.model, modelSource: record.modelSource, executor_reasoning_effort: record.reasoningEffort });
        }
      } catch (err: any) {
        record.error = String(err?.message || err || 'Background execution failed');
        record.state = 'failed';
        record.completedAt = Date.now();
        persistBackgroundSessionCheckpoint(true, '', '');
        finishBackgroundAgentStream(record.backgroundStream);
        persistBackgroundVoiceWorker(record);
        queueBackgroundResultForForeground(record);
        console.log(`[Background Agent] ${record.id} failed: ${record.error}`);
        if (spawnerSessionId) {
          broadcastWS({ ...backgroundVoiceDispatchMetadata(record), type: 'bg_agent_done', sessionId: spawnerSessionId, spawnerSessionId, bgSessionId: sessionId, backgroundSessionId: sessionId, bgId: record.id, state: 'failed', error: record.error, task: prompt, prompt, taskPrompt: prompt, fileChanges: record.fileChanges, actor: 'Background Agent', providerId: record.providerId, model: record.model, modelSource: record.modelSource, executor_reasoning_effort: record.reasoningEffort });
        }
      }
      finishLiveRuntime(runtimeId);
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
        usageContext: { sessionId: record.id, agentId: 'background_agent' },
      });
      const text = String(out?.message?.content || '').trim();
      record.result = text || 'Background task completed with no textual output.';
      record.state = 'completed';
      record.completedAt = Date.now();
      finishBackgroundAgentStream(record.backgroundStream);
      console.log(`[Background Agent] ${record.id} completed (fallback — no handleChat wired)`);
    } catch (err: any) {
      record.error = String(err?.message || err || 'Background execution failed');
      record.state = 'failed';
      record.completedAt = Date.now();
      finishBackgroundAgentStream(record.backgroundStream);
      console.log(`[Background Agent] ${record.id} failed: ${record.error}`);
    } finally {
      persistBackgroundVoiceWorker(record);
      queueBackgroundResultForForeground(record);
      finishLiveRuntime(runtimeId);
    }
  })();
  return execution.finally(() => {
    runtimeAdmissionLease?.release();
  });
}

export function backgroundSpawn(input: EphemeralBackgroundSpawnInput): EphemeralBackgroundStatus {
  const prompt = String(input?.prompt || '').trim();
  if (!prompt) {
    throw new Error('background_spawn requires prompt');
  }
  const id = `bg_${crypto.randomUUID()}`;
  const joinPolicy: BackgroundJoinPolicy =
    input?.joinPolicy === 'wait_all' || input?.joinPolicy === 'wait_until_timeout' || input?.joinPolicy === 'best_effort_merge'
      ? input.joinPolicy
      : 'wait_all';
  const timeoutMs = clampBackgroundTimeoutMs(input?.timeoutMs);
  const resolvedRouting = resolveBackgroundAgentModelRouting({
    providerId: input.providerOverride,
    model: input.modelOverride,
    reasoningEffort: input.reasoningEffort,
  });

  const record: EphemeralBackgroundRecord = {
    id,
    state: 'queued',
    joinPolicy,
    timeoutMs,
    tags: Array.isArray(input?.tags) ? input.tags.map((v) => String(v)).filter(Boolean).slice(0, 12) : undefined,
    startedAt: Date.now(),
    promise: Promise.resolve(),
    abortSignal: { aborted: false },
    prompt,
    promptPreview: prompt.slice(0, 160),
    providerId: resolvedRouting.providerId,
    model: resolvedRouting.model,
    modelSource: resolvedRouting.source,
    reasoningEffort: resolvedRouting.reasoningEffort,
    backgroundStream: createBackgroundAgentStream(),
  };

  record.spawnerSessionId = String(input?.spawnerSessionId || '').trim() || undefined;
  record.resourceIds = Array.isArray(input?.resourceIds)
    ? input.resourceIds.map((value) => String(value || '').trim()).filter(Boolean).slice(0, 100)
    : undefined;
  _ephemeralBackgroundRuns.set(id, record);
  record.promise = startBackgroundExecution(record, prompt);
  console.log(`[Background Agent] spawned ${id} (policy=${joinPolicy}, timeoutMs=${timeoutMs})`);

  return {
    id: record.id,
    state: record.state,
    joinPolicy: record.joinPolicy,
    timeoutMs: record.timeoutMs,
    tags: record.tags,
    spawnerSessionId: record.spawnerSessionId,
    resourceIds: record.resourceIds,
    prompt,
    promptPreview: record.promptPreview,
    fileChanges: record.fileChanges,
    providerId: record.providerId,
    model: record.model,
    modelSource: record.modelSource,
    reasoningEffort: record.reasoningEffort,
    executor_reasoning_effort: record.reasoningEffort,
    stream: backgroundAgentStreamSummary(record.backgroundStream),
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
    spawnerSessionId: rec.spawnerSessionId,
    resourceIds: rec.resourceIds,
    prompt: rec.prompt,
    promptPreview: rec.promptPreview,
    fileChanges: rec.fileChanges,
    providerId: rec.providerId,
    model: rec.model,
    modelSource: rec.modelSource,
    reasoningEffort: rec.reasoningEffort,
    executor_reasoning_effort: rec.reasoningEffort,
    stream: backgroundAgentStreamSummary(rec.backgroundStream),
    startedAt: rec.startedAt,
    completedAt: rec.completedAt,
    result: rec.result,
    error: rec.error,
    mergedAt: rec.mergedAt,
  };
}

export const backgroundProgress = backgroundStatus;

export function backgroundAgentStreamReplay(backgroundId: string, after = 0): {
  id: string;
  state: EphemeralBackgroundState;
  stream: Record<string, any> | null;
  events: BackgroundAgentStreamFrame[];
} | null {
  const rec = _ephemeralBackgroundRuns.get(String(backgroundId || '').trim());
  if (!rec) return null;
  return {
    id: rec.id,
    state: rec.state,
    stream: backgroundAgentStreamSummary(rec.backgroundStream),
    events: replayBackgroundAgentStream(rec.backgroundStream, after),
  };
}

export function listBackgroundStatuses(): EphemeralBackgroundStatus[] {
  return Array.from(_ephemeralBackgroundRuns.values())
    .map(statusFromRecord)
    .sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * Deliver guidance to a running background_spawn worker through its live
 * runtime inbox. The worker consumes this on its next model loop just like a
 * foreground chat consumes a user steer.
 */
export function backgroundSteer(backgroundId: string, message: string, options: {
  source?: string;
  kind?: 'correction' | 'question' | 'constraint' | 'cancel' | 'pause' | 'continue' | 'clarification';
} = {}): EphemeralBackgroundSteerResult {
  const rec = _ephemeralBackgroundRuns.get(String(backgroundId || '').trim());
  if (!rec) return { id: String(backgroundId || '').trim(), state: 'failed', queued: false, error: 'Background agent not found.' };
  if (isBackgroundTerminal(rec)) {
    return { id: rec.id, state: rec.state, queued: false, error: `Background agent is already ${rec.state}.` };
  }
  const text = String(message || '').trim();
  if (!text) return { id: rec.id, state: rec.state, queued: false, error: 'A steering message is required.' };
  const queued = addPendingRuntimeSteerForBackgroundAgent(rec.id, {
    message: text,
    source: options.source || 'background_ops_steer',
    kind: options.kind || 'constraint',
    requiresWorkerResponse: true,
    clientRequestId: `background_agent_steer:${rec.id}:${Date.now()}`,
    contextSummary: `Live guidance for one-shot background agent ${rec.id}.`,
  });
  if (queued.ok && queued.event) {
    const frame = appendBackgroundAgentStreamEvent(rec.backgroundStream, 'user_message', {
      role: 'user',
      message: queued.event.message,
      text: queued.event.message,
      steer: true,
      eventId: queued.event.id,
      source: queued.event.source,
      kind: queued.event.kind,
    });
    const spawnerSessionId = String(rec.spawnerSessionId || '').trim();
    if (spawnerSessionId && _bgDeps?.broadcastWS) {
      _bgDeps.broadcastWS({
        ...backgroundVoiceDispatchMetadata(rec),
        type: 'bg_agent_event',
        sessionId: spawnerSessionId,
        spawnerSessionId,
        bgSessionId: `background_${rec.id}`,
        backgroundSessionId: `background_${rec.id}`,
        bgId: rec.id,
        eventType: 'user_message',
        actor: 'User',
        streamId: frame.streamId,
        seq: frame.seq,
        at: frame.at,
        data: frame.data,
      });
    }
  }
  return {
    id: rec.id,
    state: rec.state,
    queued: queued.ok,
    eventId: queued.event?.id,
    error: queued.error,
  };
}

export function backgroundAbort(backgroundId: string): { ok: boolean; status?: EphemeralBackgroundStatus; error?: string } {
  const rec = _ephemeralBackgroundRuns.get(String(backgroundId || '').trim());
  if (!rec) return { ok: false, error: 'Background agent not found.' };
  if (isBackgroundTerminal(rec)) {
    return { ok: false, status: statusFromRecord(rec), error: `Background agent is already ${rec.state}.` };
  }
  if (rec.abortSignal) rec.abortSignal.aborted = true;
  rec.abortController?.abort();
  rec.state = 'failed';
  rec.error = 'Aborted by operator.';
  rec.completedAt = Date.now();
  finishBackgroundAgentStream(rec.backgroundStream);
  persistBackgroundVoiceWorker(rec);
  return { ok: true, status: statusFromRecord(rec) };
}

function isBackgroundTerminal(rec: EphemeralBackgroundRecord): boolean {
  return rec.state === 'completed' || rec.state === 'failed' || rec.state === 'timed_out';
}

// Background agents/tasks that are still running and were spawned by the given
// chat session — used so the main chat abort/stop-now can cancel everything it
// spawned, not just the foreground turn.
export function listActiveBackgroundIdsForSession(spawnerSessionId: string): string[] {
  const sid = String(spawnerSessionId || '').trim();
  if (!sid) return [];
  return Array.from(_ephemeralBackgroundRuns.values())
    .filter((rec) => rec.spawnerSessionId === sid && !isBackgroundTerminal(rec))
    .map((rec) => rec.id);
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
    spawnerSessionId: rec.spawnerSessionId,
    prompt: rec.prompt,
    promptPreview: rec.promptPreview,
    fileChanges: rec.fileChanges,
    providerId: rec.providerId,
    model: rec.model,
    modelSource: rec.modelSource,
    reasoningEffort: rec.reasoningEffort,
    executor_reasoning_effort: rec.reasoningEffort,
    stream: backgroundAgentStreamSummary(rec.backgroundStream),
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
    input?.joinPolicy === 'wait_all' || input?.joinPolicy === 'wait_until_timeout' || input?.joinPolicy === 'best_effort_merge'
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
