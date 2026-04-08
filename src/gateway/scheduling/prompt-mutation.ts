/**
 * prompt-mutation.ts — Phase 1: Prompt Self-Mutation System
 *
 * After every successful scheduled task run, analyzes the run journal and
 * proposes improvements to the job's prompt. If improvements are confident
 * enough, automatically patches the job's prompt field via scheduler.updateJob().
 *
 * Each mutation is logged to schedule memory as a learned_context entry.
 * The mutation version is tracked per job for the UI to display.
 *
 * This is the single highest-leverage feature in the Jarvis roadmap:
 *   - Every scheduled task gets smarter on every run
 *   - Zero new infrastructure required
 *   - Uses existing scheduler, schedule-memory, and LLM directly
 */

import fs from 'fs';
import path from 'path';
import { getConfig } from '../../config/config';
import { addLearnedContext, setNote, loadScheduleMemory } from './schedule-memory';
import type { CronJob } from './cron-scheduler';
import type { TaskJournalEntry } from '../tasks/task-store';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface MutationAnalysisResult {
  improvements: string[];
  confidence: number;       // 0.0 – 1.0
  shouldUpdate: boolean;
  reasoning: string;
}

export interface PromptMutationRecord {
  version: number;
  mutatedAt: string;        // ISO timestamp
  originalPromptSnippet: string;  // first 100 chars before mutation
  improvements: string[];
  confidence: number;
  reasoning: string;
  runJournalLength: number;
}

export interface PromptMutationState {
  scheduleId: string;
  version: number;
  history: PromptMutationRecord[];
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 0.7;
const MAX_MUTATION_HISTORY = 20;
const MUTATION_SEPARATOR = '\n\n[LEARNED SHORTCUTS';

// ─── Paths ─────────────────────────────────────────────────────────────────────

function getMutationStateDir(): string {
  let base: string;
  try {
    base = getConfig().getConfigDir();
  } catch {
    base = path.join(process.cwd(), '.smallclaw');
  }
  const dir = path.join(base, 'prompt-mutations');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getMutationStatePath(scheduleId: string): string {
  return path.join(getMutationStateDir(), `${scheduleId}.json`);
}

// ─── Mutation State Store ──────────────────────────────────────────────────────

export function loadMutationState(scheduleId: string): PromptMutationState | null {
  const p = getMutationStatePath(scheduleId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as PromptMutationState;
  } catch {
    return null;
  }
}

function saveMutationState(state: PromptMutationState): void {
  fs.writeFileSync(getMutationStatePath(state.scheduleId), JSON.stringify(state, null, 2), 'utf-8');
}

export function getMutationVersion(scheduleId: string): number {
  const state = loadMutationState(scheduleId);
  return state?.version ?? 0;
}

// ─── Analysis Prompt Builder ───────────────────────────────────────────────────

function buildAnalysisPrompt(
  originalPrompt: string,
  journalEntries: TaskJournalEntry[],
  taskResult: string,
): string {
  // Extract last 15 meaningful journal entries (tool calls + results + status)
  const relevantEntries = journalEntries
    .filter(j => ['tool_call', 'tool_result', 'status_push', 'advisor_decision'].includes(j.type))
    .slice(-15)
    .map(j => `[${j.type}] ${j.content}`)
    .join('\n');

  return `You are analyzing a completed automated task to improve its prompt for future runs.

ORIGINAL PROMPT:
${originalPrompt.slice(0, 600)}

RUN JOURNAL (what the AI actually did, last 15 steps):
${relevantEntries || '(no tool calls recorded)'}

TASK RESULT: ${taskResult.slice(0, 300)}

Your job:
1. Identify unnecessary steps the AI took (confusion, wrong paths, redundant snapshots)
2. Identify shortcuts it discovered that worked (direct URLs, element refs, efficient sequences)
3. Write up to 3 CONCRETE additions to the prompt that would make the next run more direct

Focus ONLY on specific, actionable instructions — not general advice like "be more efficient".
Good improvement: "Navigate directly to x.com/compose/tweet — do NOT use the compose button in the nav"
Bad improvement: "Try to be faster" or "Avoid unnecessary steps"

Return ONLY valid JSON, no other text:
{
  "improvements": ["concrete instruction 1", "concrete instruction 2"],
  "confidence": 0.0,
  "shouldUpdate": false,
  "reasoning": "one sentence explaining your decision"
}

If there are no meaningful improvements (task ran perfectly, or you cannot identify specific shortcuts), return shouldUpdate=false and confidence below 0.7.`;
}

// ─── Core Analysis Function ────────────────────────────────────────────────────

export async function analyzeRunForImprovement(
  job: CronJob,
  journalEntries: TaskJournalEntry[],
  taskResult: string,
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
): Promise<MutationAnalysisResult | null> {
  if (!job.id) return null;
  const scheduleId = job.id;

  // Don't analyze if job has less than 1 prior run (no baseline to compare)
  const mem = loadScheduleMemory(scheduleId);
  const priorRuns = mem?.runSummaries?.length ?? 0;
  if (priorRuns < 1) {
    console.log(`[PromptMutation] Skipping analysis for "${job.name}" — need at least 1 prior run`);
    return null;
  }

  // Don't analyze if journal is too sparse
  const toolCallCount = journalEntries.filter(j => j.type === 'tool_call').length;
  if (toolCallCount < 2) {
    console.log(`[PromptMutation] Skipping analysis for "${job.name}" — too few tool calls (${toolCallCount})`);
    return null;
  }

  const analysisPrompt = buildAnalysisPrompt(job.prompt, journalEntries, taskResult);
  const sessionId = `mutation_analysis_${scheduleId}_${Date.now()}`;

  let analysisText = '';
  try {
    const result = await handleChat(
      analysisPrompt,
      sessionId,
      () => {}, // no-op SSE sink
      undefined,
      undefined,
      '[SYSTEM: You are a prompt analysis assistant. Return ONLY valid JSON. No markdown, no explanation, just the JSON object.]',
      undefined,
      'background_task',
    );
    analysisText = String(result?.text || '').trim();
  } catch (err: any) {
    console.error(`[PromptMutation] Analysis call failed for job "${job.name}":`, err.message);
    return null;
  }

  // Parse the JSON response
  try {
    // Strip any markdown fences if the model added them
    const clean = analysisText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();

    const parsed = JSON.parse(clean) as MutationAnalysisResult;

    // Validate structure
    if (!Array.isArray(parsed.improvements)) return null;
    if (typeof parsed.confidence !== 'number') return null;
    if (typeof parsed.shouldUpdate !== 'boolean') return null;

    // Filter out empty or vague improvements
    parsed.improvements = parsed.improvements
      .map(s => String(s || '').trim())
      .filter(s => s.length > 15 && s.length < 300);

    console.log(`[PromptMutation] Analysis for "${job.name}": confidence=${parsed.confidence}, shouldUpdate=${parsed.shouldUpdate}, improvements=${parsed.improvements.length}`);
    return parsed;
  } catch (parseErr: any) {
    console.warn(`[PromptMutation] Failed to parse analysis JSON for "${job.name}":`, parseErr.message);
    console.warn(`[PromptMutation] Raw response was:`, analysisText.slice(0, 200));
    return null;
  }
}

// ─── Apply Mutation ────────────────────────────────────────────────────────────

export function applyPromptMutation(
  job: CronJob,
  analysis: MutationAnalysisResult,
  updateJob: (id: string, partial: Partial<CronJob>) => CronJob | null,
): { applied: boolean; newPrompt: string; version: number } {
  const scheduleId = job.id;

  if (!analysis.shouldUpdate || analysis.confidence < CONFIDENCE_THRESHOLD) {
    return { applied: false, newPrompt: job.prompt, version: getMutationVersion(scheduleId) };
  }

  if (analysis.improvements.length === 0) {
    return { applied: false, newPrompt: job.prompt, version: getMutationVersion(scheduleId) };
  }

  // Load or create mutation state
  let state = loadMutationState(scheduleId) ?? {
    scheduleId,
    version: 0,
    history: [],
  };

  const newVersion = state.version + 1;
  const timestamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Strip any existing learned shortcuts section before appending new one
  const basePrompt = job.prompt.includes(MUTATION_SEPARATOR)
    ? job.prompt.slice(0, job.prompt.indexOf(MUTATION_SEPARATOR)).trimEnd()
    : job.prompt.trimEnd();

  // Build the learned shortcuts block
  const shortcutLines = analysis.improvements.map(imp => `- ${imp}`).join('\n');
  const shortcutBlock = `${MUTATION_SEPARATOR} - v${newVersion} - ${timestamp}]:\n${shortcutLines}\n[/LEARNED SHORTCUTS]`;

  const newPrompt = `${basePrompt}${shortcutBlock}`;

  // Record the mutation
  const record: PromptMutationRecord = {
    version: newVersion,
    mutatedAt: new Date().toISOString(),
    originalPromptSnippet: basePrompt.slice(0, 100),
    improvements: analysis.improvements,
    confidence: analysis.confidence,
    reasoning: analysis.reasoning,
    runJournalLength: 0, // set by caller if needed
  };

  state.version = newVersion;
  state.history = [...state.history, record].slice(-MAX_MUTATION_HISTORY);
  saveMutationState(state);

  // Update the job's prompt via scheduler
  const updated = updateJob(scheduleId, { prompt: newPrompt });
  if (!updated) {
    console.error(`[PromptMutation] Failed to update job "${job.name}" via updateJob()`);
    return { applied: false, newPrompt: job.prompt, version: state.version - 1 };
  }

  // Write to schedule memory so the AI knows the prompt was updated
  try {
    addLearnedContext(scheduleId, `Prompt updated to v${newVersion} on ${timestamp}: ${analysis.reasoning}`);
    setNote(scheduleId, 'prompt_version', String(newVersion));
    setNote(scheduleId, 'prompt_last_mutated', new Date().toISOString());
    setNote(scheduleId, `prompt_v${newVersion}_summary`, analysis.improvements.slice(0, 2).join(' | ').slice(0, 200));
  } catch (memErr: any) {
    console.warn(`[PromptMutation] Schedule memory write failed:`, memErr.message);
  }

  console.log(`[PromptMutation] ✅ Job "${job.name}" prompt updated to v${newVersion} (confidence=${analysis.confidence})`);
  console.log(`[PromptMutation] Improvements applied:`, analysis.improvements);

  return { applied: true, newPrompt, version: newVersion };
}

// ─── Post-Task Memory Extraction ──────────────────────────────────────────────

/**
 * Automatically appended as the final step of every background task plan.
 * Extracts key facts from the run and writes them to schedule memory.
 * This is the "post-task memory extraction" step from the analysis doc.
 */
export const MEMORY_EXTRACTION_STEP = {
  description: 'Extract key facts from this run and write them to memory using update_schedule_memory tool. Capture: what worked, what was discovered, any shortcuts found, dedup keys for items processed.',
  status: 'pending' as const,
};

/**
 * Build the post-run memory extraction prompt for the final synthesis round.
 * Returns additional context to append to the synthesis prompt.
 */
export function buildMemoryExtractionContext(scheduleId: string | undefined): string {
  if (!scheduleId) return '';
  const mem = loadScheduleMemory(scheduleId);
  if (!mem) return '';

  const priorVersion = mem.notes?.['prompt_version'] ?? '1';
  const lastMutated = mem.notes?.['prompt_last_mutated'] ?? 'never';

  return `\n\n[MEMORY EXTRACTION CONTEXT]\nThis is a scheduled task (schedule ID: ${scheduleId}).\nCurrent prompt version: ${priorVersion} (last mutated: ${lastMutated}).\nAfter completing the task, use update_schedule_memory to record: any navigation shortcuts discovered, content that was processed (as dedup keys), and the overall outcome summary.\n[/MEMORY EXTRACTION CONTEXT]`;
}
