/**
 * task-manager.ts
 *
 * Manager/Worker split for background task execution.
 *
 * Two calls per step:
 *   1. callManagerBrief()   — Manager produces an ExecutionBrief telling the worker exactly what to do
 *   2. [worker executes]
 *   3. callManagerVerify()  — Manager verifies the result and produces forward guidance
 *
 * The Manager uses the primary LLM from Settings → Models.
 * If the provider cannot be built, functions return null and the runner falls back
 * to the legacy handleChat() + auditor path.
 */

import { buildPrimaryLlm } from '../llm-primary';
import { contentToString } from '../../providers/content-utils';
import {
  type TaskRecord,
  type EvidenceBusSnapshot,
  formatEvidenceBusForPrompt,
} from './task-store';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ExecutionBrief {
  /** What the worker must accomplish in this step. */
  exact_objective: string;
  /** The condition that signals the worker is done. */
  stop_condition: string;
  /** Maximum number of tool calls the worker may make. */
  tool_budget: number;
  /** Actions the worker must NOT take. */
  forbidden_actions: string[];
  /** Observable outcomes that indicate success. */
  success_signals: string[];
  /** Optional forward context from the previous step's verify. */
  forward_context?: string;
}

export type ManagerVerdict = 'PASS' | 'RETRY' | 'ESCALATE';

export interface ManagerVerifyDecision {
  verdict: ManagerVerdict;
  reasoning: string;
  /** Present when verdict=RETRY — corrected ExecutionBrief for the retry. */
  retry_brief?: ExecutionBrief;
  /** Forward guidance to inject into the next step's brief. */
  next_step_brief?: string;
  /** Evidence entries to write to the bus (applied by the runner). */
  evidence_to_bus?: Array<{
    category: 'finding' | 'decision' | 'artifact' | 'error' | 'dedup_key';
    key?: string;
    value: string;
  }>;
  /** Optional schedule memory updates (for scheduled tasks). */
  memory_updates?: Array<{
    category: 'dedup_key' | 'learned_context' | 'note';
    key?: string;
    value: string;
  }>;
}

// ─── System Prompts ────────────────────────────────────────────────────────────

const MANAGER_BRIEF_SYSTEM = `You are the Manager in a two-model task execution system.
Your job: produce a precise ExecutionBrief that tells a Worker exactly what to do for ONE plan step.

The Worker is focused and isolated — it receives ONLY your brief, no task history.
Your brief must be complete, unambiguous, and achievable in the tool budget.

Respond with ONLY a JSON object (no markdown, no preamble):
{
  "exact_objective": "Precise description of what to accomplish in this step",
  "stop_condition": "The observable condition that means this step is done",
  "tool_budget": <integer 3-15>,
  "forbidden_actions": ["list of things NOT to do, e.g. 'do not modify other files'"],
  "success_signals": ["observable outcomes that confirm success, e.g. 'write_evidence called with artifact key'"]
}

Guidelines:
- exact_objective must be actionable with the tools available (shell, files, browser, web_fetch, write_evidence)
- stop_condition must be verifiable from tool call results
- tool_budget: 3-5 for simple steps, 8-12 for research/multi-action steps, max 15
- forbidden_actions prevents the worker from drifting into scope creep
- success_signals helps the verify phase confirm the step is done
- If evidence bus contains prior findings, reference them in the objective to avoid duplicate work`;

const MANAGER_VERIFY_SYSTEM = `You are the Manager verifying whether a Worker completed a plan step.
You have: the original ExecutionBrief, the Worker's tool call log, and the Worker's result text.

Respond with ONLY a JSON object (no markdown, no preamble):
{
  "verdict": "PASS" | "RETRY" | "ESCALATE",
  "reasoning": "1-2 sentence explanation",
  "retry_brief": { ...ExecutionBrief... } | null,
  "next_step_brief": "optional string: forward context for the next step brief",
  "evidence_to_bus": [
    { "category": "finding"|"decision"|"artifact"|"error"|"dedup_key", "key": "optional", "value": "finding text" }
  ],
  "memory_updates": []
}

Verdict rules:
- PASS: the success_signals from the brief are evidenced in the tool log or result text
- RETRY: the worker made progress but missed the stop_condition — provide a corrected retry_brief
- ESCALATE: the step failed in a way that needs human intervention or the self-healer

evidence_to_bus: always populate with key findings the Manager should remember for future steps.
next_step_brief: optional guidance for the NEXT step's ExecutionBrief (what to do differently, what was learned).

For RETRY: the retry_brief should correct the specific gap in the original brief that caused the miss.
ESCALATE only when: the worker hit a hard error, the task premise is wrong, or 2+ retries already failed.`;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function parseJsonSafe(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(cleaned) as Record<string, unknown>; } catch { return null; }
}

function parseExecutionBrief(raw: Record<string, unknown>): ExecutionBrief | null {
  if (typeof raw.exact_objective !== 'string' || !raw.exact_objective) return null;
  if (typeof raw.stop_condition !== 'string' || !raw.stop_condition) return null;
  return {
    exact_objective: String(raw.exact_objective).slice(0, 600),
    stop_condition: String(raw.stop_condition).slice(0, 300),
    tool_budget: Math.min(15, Math.max(3, Number(raw.tool_budget) || 8)),
    forbidden_actions: Array.isArray(raw.forbidden_actions)
      ? (raw.forbidden_actions as unknown[]).map(x => String(x).slice(0, 200)).slice(0, 8)
      : [],
    success_signals: Array.isArray(raw.success_signals)
      ? (raw.success_signals as unknown[]).map(x => String(x).slice(0, 200)).slice(0, 8)
      : [],
    forward_context: typeof raw.forward_context === 'string' ? raw.forward_context.slice(0, 400) : undefined,
  };
}

async function buildManagerProvider() {
  return buildPrimaryLlm();
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Produce an ExecutionBrief for the given step.
 * Returns null if the primary provider is unavailable (caller falls back to legacy path).
 */
export async function callManagerBrief(input: {
  task: TaskRecord;
  stepIndex: number;
  evidenceBus: EvidenceBusSnapshot | null;
  retryHint?: string;
  forwardContext?: string;
}): Promise<ExecutionBrief | null> {
  const built = await buildManagerProvider();
  if (!built) return null;
  const { provider, model } = built;

  const { task, stepIndex, evidenceBus, retryHint, forwardContext } = input;
  const step = task.plan[stepIndex];
  if (!step) return null;

  const completedSteps = task.plan
    .filter((s, i) => i < stepIndex && (s.status === 'done' || s.status === 'skipped'))
    .map((s, i) => `Step ${i}: ${s.description}${s.notes ? ` — ${s.notes.slice(0, 100)}` : ''}`);

  const remainingSteps = task.plan
    .filter((s, i) => i > stepIndex && s.status === 'pending')
    .map((s, i) => `Step ${stepIndex + 1 + i}: ${s.description}`);

  const busText = formatEvidenceBusForPrompt(evidenceBus);

  // Detect step type for specialized brief guidance
  const isMemoryStep = step.notes === 'memory_extraction' || /memory.?extract|write.?note/i.test(step.description);
  const isXTask = /\b(x\.com|twitter|tweet|retweet|post.*tweet|reply.*tweet)\b/i.test(
    task.prompt + ' ' + task.title
  );

  const memoryStepHint = isMemoryStep
    ? `IMPORTANT: This is a memory extraction step. The worker MUST call write_note() at least once per distinct fact discovered. This step is NOT complete unless write_note was called. Do NOT skip this step even if the task was simple.`
    : '';

  const xTaskHint = isXTask
    ? `X.COM / TWITTER NOTE FOR BRIEF: To compose a tweet, the worker MUST use this exact 3-step sequence: (1) browser_open("https://x.com/home") — the result will include a SITE SHORTCUTS block showing keyboard shortcuts including "n → Open new tweet composer modal". (2) browser_press_key({"key":"n"}) — this opens the composer modal immediately on any X page, no scrolling needed. (3) browser_fill(ref, tweet_text) — find the contenteditable composer ref in the snapshot after pressing n, and fill it. The fill auto-submits via the Post button. Forbidden actions: browser_snapshot after browser_open (snapshot is already in the result), ANY PageDown/scroll before filling, opening a profile URL like x.com/Prometheus (that is NOT the home page and has no composer). The exact_objective MUST say: "Press n to open composer, then browser_fill with the tweet text." The stop_condition MUST be: "browser_fill returned confirmation that the tweet was posted."`
    : '';

  const userContent = [
    `TASK: ${task.title}`,
    `ORIGINAL REQUEST: ${task.prompt.slice(0, 400)}`,
    ``,
    `CURRENT STEP (${stepIndex + 1}/${task.plan.length}): ${step.description}`,
    ``,
    completedSteps.length > 0
      ? `COMPLETED STEPS:\n${completedSteps.join('\n')}`
      : 'COMPLETED STEPS: none yet',
    ``,
    remainingSteps.length > 0
      ? `REMAINING AFTER THIS STEP:\n${remainingSteps.join('\n')}`
      : 'REMAINING AFTER THIS STEP: none (this is the last step)',
    ``,
    busText,
    ``,
    retryHint ? `RETRY HINT (previous attempt failed): ${retryHint}` : '',
    forwardContext ? `FORWARD CONTEXT (from previous step): ${forwardContext}` : '',
    memoryStepHint,
    xTaskHint,
    ``,
    `Produce the ExecutionBrief for this step now.`,
  ].filter(Boolean).join('\n');

  try {
    const result = await provider.chat(
      [
        { role: 'system', content: MANAGER_BRIEF_SYSTEM },
        { role: 'user', content: userContent },
      ],
      model,
      { max_tokens: 600 },
    );

    const raw = contentToString(result.message.content).trim();
    const parsed = parseJsonSafe(raw);
    if (!parsed) {
      console.warn('[TaskManager] callManagerBrief: failed to parse JSON response');
      return null;
    }

    const brief = parseExecutionBrief(parsed);
    if (!brief) {
      console.warn('[TaskManager] callManagerBrief: invalid brief structure');
      return null;
    }

    if (forwardContext) brief.forward_context = forwardContext;
    return brief;
  } catch (err: any) {
    console.error('[TaskManager] callManagerBrief error:', err.message);
    return null;
  }
}

/**
 * Verify a completed step and produce a ManagerVerifyDecision.
 * Returns null if the primary provider is unavailable.
 */
export async function callManagerVerify(input: {
  task: TaskRecord;
  stepIndex: number;
  brief: ExecutionBrief;
  workerToolLog: Array<{ tool: string; args: any; result: string; error: boolean }>;
  workerResultText: string;
  evidenceBus: EvidenceBusSnapshot | null;
}): Promise<ManagerVerifyDecision | null> {
  const built = await buildManagerProvider();
  if (!built) return null;
  const { provider, model } = built;

  const { task, stepIndex, brief, workerToolLog, workerResultText, evidenceBus } = input;

  // For memory extraction steps, a PASS requires write_note to have been called.
  const isMemoryStep = (task.plan[stepIndex]?.notes === 'memory_extraction') ||
    /memory.?extract|write.?note/i.test(task.plan[stepIndex]?.description || '');
  const memoryVerifyNote = isMemoryStep
    ? `\n\nMEMORY STEP RULE: This step is ONLY a PASS if write_note() appears in the tool call log at least once. If write_note was NOT called, verdict must be RETRY with retry_brief instructing the worker to call write_note for each key fact.`
    : '';

  const toolLogText = workerToolLog
    .slice(0, 25)
    .map((t, i) => {
      let argsText = '';
      try { argsText = JSON.stringify(t.args ?? {}).slice(0, 200); } catch { argsText = '{}'; }
      const resultText = String(t.result || '').slice(0, 600);
      return `${i + 1}. [${t.error ? 'FAIL' : 'OK'}] ${t.tool}(${argsText})\n   → ${resultText}`;
    })
    .join('\n\n');

  const busText = formatEvidenceBusForPrompt(evidenceBus);

  const userContent = [
    `TASK: ${task.title}`,
    `STEP ${stepIndex + 1}/${task.plan.length}: ${task.plan[stepIndex]?.description || ''}`,
    ``,
    `EXECUTION BRIEF:`,
    `  Objective: ${brief.exact_objective}`,
    `  Stop condition: ${brief.stop_condition}`,
    `  Success signals: ${brief.success_signals.join('; ')}`,
    ``,
    `WORKER TOOL LOG:`,
    toolLogText || '(no tool calls)',
    ``,
    `WORKER RESULT TEXT:`,
    workerResultText.slice(0, 800),
    ``,
    busText,
    ``,
    `Verify whether the step's stop_condition is met and produce the ManagerVerifyDecision now.${memoryVerifyNote}`,
  ].filter(Boolean).join('\n');

  try {
    const result = await provider.chat(
      [
        { role: 'system', content: MANAGER_VERIFY_SYSTEM },
        { role: 'user', content: userContent },
      ],
      model,
      { max_tokens: 800 },
    );

    const raw = contentToString(result.message.content).trim();
    const parsed = parseJsonSafe(raw);
    if (!parsed) {
      console.warn('[TaskManager] callManagerVerify: failed to parse JSON response');
      return null;
    }

    const verdict = (['PASS', 'RETRY', 'ESCALATE'] as ManagerVerdict[]).includes(
      parsed.verdict as ManagerVerdict,
    )
      ? (parsed.verdict as ManagerVerdict)
      : 'ESCALATE';

    const decision: ManagerVerifyDecision = {
      verdict,
      reasoning: String(parsed.reasoning || '').slice(0, 400),
    };

    if (verdict === 'RETRY' && parsed.retry_brief && typeof parsed.retry_brief === 'object') {
      const retryBrief = parseExecutionBrief(parsed.retry_brief as Record<string, unknown>);
      if (retryBrief) decision.retry_brief = retryBrief;
    }

    if (parsed.next_step_brief && typeof parsed.next_step_brief === 'string') {
      decision.next_step_brief = parsed.next_step_brief.slice(0, 400);
    }

    if (Array.isArray(parsed.evidence_to_bus)) {
      decision.evidence_to_bus = (parsed.evidence_to_bus as unknown[])
        .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
        .slice(0, 10)
        .map(e => ({
          category: (['finding', 'decision', 'artifact', 'error', 'dedup_key'].includes(String(e.category))
            ? String(e.category)
            : 'finding') as NonNullable<ManagerVerifyDecision['evidence_to_bus']>[number]['category'],
          key: e.key ? String(e.key).slice(0, 100) : undefined,
          value: String(e.value || '').slice(0, 500),
        }));
    }

    if (Array.isArray(parsed.memory_updates)) {
      decision.memory_updates = (parsed.memory_updates as unknown[])
        .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
        .slice(0, 5)
        .map(e => ({
          category: (['dedup_key', 'learned_context', 'note'].includes(String(e.category))
            ? String(e.category)
            : 'learned_context') as 'dedup_key' | 'learned_context' | 'note',
          key: e.key ? String(e.key).slice(0, 100) : undefined,
          value: String(e.value || '').slice(0, 500),
        }));
    }

    return decision;
  } catch (err: any) {
    console.error('[TaskManager] callManagerVerify error:', err.message);
    return null;
  }
}

/**
 * Format an ExecutionBrief as a clean system message for the worker.
 * The worker receives ONLY this — no task history, no prior conversation.
 */
export function formatBriefForWorker(brief: ExecutionBrief): string {
  const lines = [
    `[EXECUTION BRIEF]`,
    `You are a focused worker executing ONE specific step. This brief is your only context.`,
    `DO NOT ask for confirmation. DO NOT re-read files or pages unless the objective requires it.`,
    `EXECUTE and STOP when done.`,
    `X.COM RULE: If objective involves X.com/Twitter: (1) browser_open("https://x.com/home"), (2) browser_press_key({"key":"n"}) to open composer modal, (3) browser_fill(ref, text). Do NOT open a profile URL. Do NOT PageDown or snapshot before filling.`,
    ``,
    `OBJECTIVE: ${brief.exact_objective}`,
    ``,
    `STOP WHEN: ${brief.stop_condition}`,
    ``,
    `TOOL BUDGET: You may make AT MOST ${brief.tool_budget} tool calls total. Every unnecessary call wastes budget. Stop immediately when the objective is achieved.`,
    ``,
    brief.forbidden_actions.length > 0
      ? `DO NOT (these are hard rules):\n${brief.forbidden_actions.map(a => `  - ${a}`).join('\n')}`
      : '',
    ``,
    brief.success_signals.length > 0
      ? `SUCCESS IS CONFIRMED BY:\n${brief.success_signals.map(s => `  - ${s}`).join('\n')}`
      : '',
    ``,
    brief.forward_context
      ? `CONTEXT FROM PREVIOUS STEP: ${brief.forward_context}`
      : '',
    ``,
    `When done, write a 1-3 sentence summary of exactly what you accomplished and what evidence confirms it.`,
    `[/EXECUTION BRIEF]`,
  ].filter(s => s !== null && s !== undefined);

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
