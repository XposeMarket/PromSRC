/**
 * brain/brain-runner.ts
 *
 * The Brain system — continuous self-reflection with two run types:
 *
 *   THOUGHT  — every ~6 hours while the gateway is alive
 *              Scans the last 6h of audit/task/session/notes activity,
 *              produces a lightweight reflection markdown.
 *              Does NOT write to memory or create proposals.
 *
 *   DREAM    — once nightly (default 23:30 local)
 *              Synthesizes the target day's thoughts, applies durable memory
 *              updates directly, generates formal proposals for everything else,
 *              and rewrites Brain/proposals.md as the morning briefing.
 *              About 30 minutes later, runs a cleanup-only memory solidifier
 *              that may remove/dedupe but must not add new memory.
 *
 * Eligibility is state-based, not timer-only:
 *   Thought: eligible when now - lastThoughtAt >= 6h (with 12h catch-up cap)
 *   Dream:   eligible when local time >= DREAM_HOUR:DREAM_MIN and dream hasn't run today
 *
 * A 15-minute periodic checker evaluates eligibility and dispatches as needed.
 * State persists in workspace/Brain/state/ across gateway restarts.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { activateToolCategory, addMessage, clearHistory, clearSessionMutationScope, persistToolLog, setSessionMutationScope } from '../session';
import { formatToolObservationsForContext, persistToolResultsAsObservations } from '../tool-observations';
import { isKnownProviderId } from '../../providers/provider-registry.js';
import { isPublicDistributionBuild } from '../../runtime/distribution.js';
import {
  getBrainDir,
  ensureBrainDirs,
  loadLatestState,
  saveLatestState,
  loadDailyStatus,
  saveDailyStatus,
  markGatewayStarted,
  getLocalDateStr,
  getWindowLabel,
  fmtUtc,
  fmtLocal,
  type BrainLatestState,
} from './brain-state';
import { registerLiveRuntime, finishLiveRuntime } from '../live-runtime-registry';
import type { SkillsManager } from '../skills-runtime/skills-manager';
import { runSkillCurator } from '../skills-runtime/skill-curator';

// ─── Constants ────────────────────────────────────────────────────────────────

const THOUGHT_INTERVAL_MS  = 6 * 60 * 60 * 1000;   // 6 hours
const CATCHUP_CAP_MS       = 12 * 60 * 60 * 1000;  // max window for catch-up thought
const CHECK_INTERVAL_MS    = 15 * 60 * 1000;        // 15-minute ticker
const DREAM_HOUR           = 23;                    // local hour for dream eligibility
const DREAM_MIN            = 30;                    // local minute for dream eligibility
const DREAM_BUFFER_MIN     = 90;                    // don't start thought if dream is ≤90 min away
const DREAM_CLEANUP_DELAY_MS = 30 * 60 * 1000;      // run the memory solidifier 30m after dream success
const THOUGHT_RETRY_BACKOFF_MS = 30 * 60 * 1000;    // wait 30m after a failed attempt
const DREAM_RETRY_BACKOFF_MS   = 60 * 60 * 1000;    // wait 60m after a failed attempt

const PRIVATE_BRAIN_SOURCE_TOOL_NAMES = new Set([
  'list_source',
  'source_stats',
  'read_source',
  'read_dev_sources',
  'apply_dev_source_patchset',
  'grep_source',
  'list_prom',
  'prom_file_stats',
  'read_prom_file',
  'grep_prom',
  'webui_source_stats',
  'read_webui_source',
  'grep_webui_source',
]);

function isPublicBrainProfile(): boolean {
  return isPublicDistributionBuild();
}

function brainDreamToolFilter(toolNames: string[]): string[] {
  if (!isPublicBrainProfile()) return toolNames;
  return toolNames.filter((name) => !PRIVATE_BRAIN_SOURCE_TOOL_NAMES.has(name));
}

function brainThoughtProposalTypes(): string {
  return isPublicBrainProfile()
    ? 'prompt_mutation / skill_evolution / config_change / feature_addition / task_trigger / general'
    : 'prompt_mutation / skill_evolution / src_edit / config_change / feature_addition / task_trigger / general';
}

function brainThoughtExecutionModes(): string {
  return isPublicBrainProfile()
    ? 'general for research / audit / internal Prometheus orchestration (start a team, message a subagent, surface a finding); action for real work in the user\'s world (build/fix a feature in the workspace or an allowed path, draft+send an approved response to an incoming message/webhook); none when it is only a note. Do not propose internal Prometheus implementation or bundled dev-tool changes in public builds.'
    : 'general for research / audit / internal Prometheus orchestration; action for real work in the user\'s world (build/fix in the workspace or an allowed path, respond to an incoming message/webhook); code_change for Prometheus\'s own src/ or web-ui/ self-edits only; none when it is only a note.';
}

function brainThoughtProposalTypesExample(): string {
  return isPublicBrainProfile()
    ? 'prompt_mutation / skill_evolution / task_trigger / general'
    : 'prompt_mutation / skill_evolution / src_edit / task_trigger / general';
}

function brainThoughtExecutionModesExample(): string {
  return isPublicBrainProfile()
    ? 'general / action / none'
    : 'general / action / code_change / none';
}

function brainOpportunitySurfaceExample(): string {
  return isPublicBrainProfile()
    ? 'teams/... or workspace path'
    : 'src/... or web-ui/... or teams/... or workspace path';
}

function brainDreamSourceEvidenceTools(): string {
  if (isPublicBrainProfile()) {
    return `Use workspace file, entity, and skill tools when the best evidence lives in user workspace surfaces.
Do not inspect internal Prometheus implementation files, bundled dev tools, or self-reference files in public builds.`;
  }

  return `You also have prom-root read tools tonight. Use them when the best evidence lives outside plain workspace surfaces:
- list_prom / read_prom_file / grep_prom for scripts/, electron/, .prometheus/, root docs, and allowlisted project-root files
- read_source / grep_source for src/
- read_webui_source / grep_webui_source for web-ui/`;
}

function brainIncubationFileTargets(): string {
  return isPublicBrainProfile()
    ? 'workspace files, configs, pages, agent definitions, or artifacts involved'
    : 'current files, configs, pages, agent definitions, or code involved';
}

function brainPartialFeatureHeuristic(): string {
  return isPublicBrainProfile()
    ? 'If the user talked about a feature but left it unfinished, inspect the relevant workspace files, project docs, browser-hosted surfaces, or team outputs and determine what already exists, what is missing, and the smallest meaningful proposal that moves it forward tomorrow. Do not inspect or propose internal Prometheus implementation changes in public builds.'
    : 'If the user talked about a feature but left it unfinished, inspect the relevant src/, web-ui/, or prom-root files and determine what already exists, what is missing, and the smallest meaningful proposal that moves it forward tomorrow.';
}

function brainHardenedActionContract(): string {
  return `Hardened action proposal contract (REQUIRED for every action proposal):
The details field must contain these exact markdown headings so the user can approve safely at a glance:
  ## What you asked for
     The origin — what the user said/planned, with a citation (chat/transcript/note).
  ## Current state
     What the target actually does RIGHT NOW. You must have opened the real file/tool/page/thread tonight and confirmed the gap/bug/missing feature still exists and is still unhandled. Cite the files read and the observed present behavior. If it was already done or fixed by another tool, say so and do NOT file the proposal.
  ## Research
     Web/competitor/OSS findings with links (why competitors succeed, reusable open-source projects, prior art). Omit only if genuinely not applicable.
  ## Plan
     The concrete approved steps and exact files to create/edit.
  ## Acceptance criteria
     How the user (or executor) will know it worked.
  ## Risks / open questions
     What could go wrong or needs a decision.
Never file an action proposal whose "Current state" is derived only from the conversation. It must be derived from the live artifact tonight.`;
}

function brainDreamProposalGuidance(): string {
  if (isPublicBrainProfile()) {
    return `Available proposal types:
- prompt_mutation
- skill_evolution
- config_change
- feature_addition
- memory_update
- task_trigger (bounded one-shot action, team run, verification, or investigation)
- general

Execution lanes (execution_mode — required for executable proposals; there are exactly two in public builds):
- general: read + research + internal Prometheus orchestration (start/dispatch a team, message a subagent, update a team/subagent, schedule a follow-up, surface a finding). No user-file writes or external-world side effects.
- action: real work in the user's world — build/fix a feature in the workspace or an allowed path, create an approved artifact, or draft+send an approved response to an incoming email/webhook/notification. Build-capable. Carries the current-state + hardened contract below.

Public build proposal routing rule:
- type describes the proposal category shown to the user; execution_mode (the lane) controls how the approved executor behaves.
- Do not create proposals for internal Prometheus implementation or bundled dev tooling in public builds.
- If a signal appears to require internal product implementation changes, record it as deferred product feedback in the Dream output instead of calling write_proposal.
- Use execution_mode=general for "research this deeper", "audit/verify and report", or internal orchestration like "start this team / message this subagent".
- Use execution_mode=action when approval should make real work happen: build/fix the thing the user planned, or respond to an incoming external event.

Operational proposal rules:
- For general proposals, affected_files are resource/evidence references or expected artifact locations, not an edit plan.
- For action proposals, affected_files are the exact files to create/edit (workspace-relative, or absolute for a configured allowed path).
- Action proposals MUST carry a current-state + hardened structure (see "Hardened action proposal contract" below) so the morning approval is safe at a glance.
- Include execution_steps with 3-7 concrete approved steps. For action proposals, step 1 must be a current-state re-check. These become the executor's task checklist after approval.

${brainHardenedActionContract()}

Skill proposal rules:
- Do not submit proposals for routine existing-skill improvements. Existing skill evolution is automatic in Phase 3.
- Use type skill_evolution only for creating a new reusable workflow skill, or for a high-risk skill change you intentionally deferred from automatic editing.
- New skill proposals must include exact target skill id, planned resources, acceptance behavior after approval, a draft skill body or detailed outline, triggers, permissions, categories, and required tools.
- High-risk existing-skill proposals must explain why automatic editing was unsafe and must cite skill_read/skill_inspect evidence.
- Prefer automatic existing-skill updates or new-skill proposals over memory when the learning is procedural or workflow-specific.`;
  }

  return `Available proposal types:
- prompt_mutation
- skill_evolution
- src_edit
- config_change
- feature_addition
- memory_update
- task_trigger (bounded one-shot action, team run, verification, or investigation)
- general

Execution lanes (execution_mode — required for executable proposals; there are exactly three):
- general: read + research + internal Prometheus orchestration (start/dispatch a team, message a subagent, update a team/subagent, schedule a follow-up, surface a finding). No user-file writes or external-world side effects.
- action: real work in the user's world — build/fix a feature in the workspace or a configured allowed path, create an approved artifact, or draft+send an approved response to an incoming email/webhook/notification. Build-capable. Carries the current-state + hardened contract below.
- code_change: Prometheus's OWN dev self-edit only; affected_files must be exact src/ and/or web-ui/ files; sandboxed; build/verification required.

Proposal routing rule:
- type describes the proposal category shown to the user; execution_mode (the lane) controls how the approved executor behaves.
- code_change is ONLY for editing Prometheus's own source. Editing one of the USER's projects (even if it lives in the workspace or an allowed path) is an action proposal, never code_change.
- Use general for "research this deeper", "audit/verify and report", or internal orchestration like "start this team / message this subagent".
- Use action when approval should make real work happen in the user's world (build the feature they planned, fix the bug you confirmed, respond to an incoming event).

Operational proposal rules:
- For general proposals, affected_files are resource/evidence references or expected artifact locations, not an edit plan.
- For action proposals, affected_files are the exact files to create/edit (workspace-relative, or absolute for a configured allowed path).
- Action proposals MUST carry the current-state + hardened structure (see "Hardened action proposal contract" below) so the morning approval is safe at a glance.
- Include execution_steps with 3-7 concrete approved steps. For action proposals, step 1 must be a current-state re-check. These become the executor's task checklist after approval.
- Do not include src/code_change headings, diff previews, or build steps on a general or action proposal — those belong only to a real code_change.

${brainHardenedActionContract()}

Skill proposal rules:
- Do not submit proposals for routine existing-skill improvements. Existing skill evolution is automatic in Phase 3.
- Use type skill_evolution only for creating a new reusable workflow skill, or for a high-risk skill change you intentionally deferred from automatic editing.
- New skill proposals must include exact target skill id, planned resources, acceptance behavior after approval, a draft skill body or detailed outline, triggers, permissions, categories, and required tools.
- High-risk existing-skill proposals must explain why automatic editing was unsafe and must cite skill_read/skill_inspect evidence.
- Prefer automatic existing-skill updates or new-skill proposals over memory when the learning is procedural or workflow-specific.

Source-code proposal rules:
- If a proposal would edit Prometheus source code, it must set execution_mode=code_change, type src_edit, and affected_files must include the exact src/... or web-ui/... paths
- Before calling write_proposal for src_edit, inspect current code with the source tools:
  - Use grep_source or list_source to locate relevant files when the path is uncertain
  - Use source_stats before reading large or unfamiliar files
  - Prefer read_dev_sources to inspect every affected src/ or web-ui/ file in one batch; use read_source/read_webui_source only for one-off emergency reads
  - Cite the functions, classes, handlers, constants, or line ranges you inspected
- For web-ui code, use webui_source_stats, read_dev_sources, read_webui_source, and grep_webui_source
- Do not create automatic code_change proposals for scripts/, electron/, .prometheus/, dist/, build/, or other project-root paths. Defer them or use a non-code action/review proposal unless the user explicitly asks for that broader manual work.
- Do not rely only on thought summaries for source-edit proposals; base them on actual current files
- Any proposal touching src/ or web-ui/ must include these exact markdown headings in details:
  ## Why this change
  ## Exact source edits
  ## Deterministic behavior after patch
  ## Acceptance tests
  ## Risks and compatibility
- In "Exact source edits", include an ordered implementation plan with the exact files and symbols to edit, the current behavior observed from read_dev_sources/read_source, and the intended replacement behavior.
- In "Acceptance tests", include the safe verification profile/command that should verify the edit. Prefer verification_profile=backend_build for backend-only quick dev edits, verification_profile=webui_sync_check for web-ui edits, and full_build only when full-app behavior needs it. For proposal code_change execution, the executor verifies inside the isolated sandbox with the canonical build command; quick live dev edits finalize through prom_apply_dev_changes.
- Set requires_build=true for TypeScript/backend src edits and web-ui source edits unless there is a specific reason no build is needed.
- Include execution_steps with the exact approved implementation/verification checklist. The executor will use these steps instead of inventing a fresh plan.
- Set executor_prompt, not executorPrompt. The executor_prompt must restate the ordered plan and instruct the approved executor to prefer read_dev_sources and apply_dev_source_patchset; use tiny source read/write tools only for one-off emergency edits.
- If the needed src files or exact edit points are not known after inspection, do not create the proposal. Record it as deferred with "needs source scouting" instead.

Risk tier rules:
- Every src_edit proposal must set risk_tier to low or high
- Use low only for isolated, easy-to-review changes
- Use high for core runtime logic, proposal execution, source-write tools, multi-file edits, or anything that could break workflows
- If unsure, choose high`;
}

function brainDreamProposalSubmitRules(): string {
  if (isPublicBrainProfile()) {
    return `For each proposal passing the gate:
- This automated cron Dream is explicitly authorized and expected to call write_proposal. Do not downgrade executable proposals into "candidates", "recommendations", "suggested scope", or "proposal recommended" text.
- A proposal is not submitted until write_proposal returns a prop_* ID. If you list a proposal in the Dream/proposals.md output, it must either include the returned prop_* ID or be clearly listed under Deferred Ideas with the failed gate reason.
- For action proposals, call write_proposal with: execution_mode="action", type, priority, title, summary, details, affected_files as resource refs, execution_steps, executor_prompt, and requires_build=false
- For review proposals, call write_proposal with: execution_mode="review", type, priority, title, summary, details, affected_files as evidence/resource refs, execution_steps, executor_prompt, and requires_build=false
- Make the title and summary feel like a morning briefing: obvious, concrete, approval-ready
- Save the returned proposal ID for the output files`;
  }

  return `For each proposal passing the gate:
- This automated cron Dream is explicitly authorized and expected to call write_proposal. Do not downgrade executable proposals into "candidates", "recommendations", "suggested scope", or "proposal recommended" text.
- A proposal is not submitted until write_proposal returns a prop_* ID. If you list a proposal in the Dream/proposals.md output, it must either include the returned prop_* ID or be clearly listed under Deferred Ideas with the failed gate reason.
- For action proposals, call write_proposal with: execution_mode="action", type, priority, title, summary, details, affected_files as resource refs, execution_steps, executor_prompt, and requires_build=false
- For review proposals, call write_proposal with: execution_mode="review", type, priority, title, summary, details, affected_files as evidence/resource refs, execution_steps, executor_prompt, and requires_build=false
- For code_change proposals, call write_proposal with: execution_mode="code_change", type="src_edit", priority, title, summary, details, affected_files, execution_steps, executor_prompt, risk_tier, and requires_build=true when build verification is needed
- Make the title and summary feel like a morning briefing: obvious, concrete, approval-ready
- Save the returned proposal ID for the output files`;
}
const DREAM_CLEANUP_RETRY_BACKOFF_MS = 60 * 60 * 1000;
const DREAM_CATCHUP_LOOKBACK_DAYS = 7;              // max backlog window to auto-catch-up

// ─── Types ────────────────────────────────────────────────────────────────────

type HandleChatFn = (
  message: string,
  sessionId: string,
  sendSSE: (event: string, data: any) => void,
  pinnedMessages?: Array<{ role: string; content: string }>,
  abortSignal?: { aborted: boolean },
  callerContext?: string,
  modelOverride?: string,
  executionMode?: 'interactive' | 'background_task' | 'heartbeat' | 'cron',
  toolFilter?: string[],
) => Promise<{
  type: string;
  text: string;
  thinking?: string;
  toolResults?: Array<{ name: string; args: any; result: string; error: boolean }>;
}>;

export interface BrainRunnerDeps {
  handleChat: HandleChatFn;
  broadcast: (data: object) => void;
  workspacePath: string;
  skillsManager?: SkillsManager;
}

// ─── BrainRunner ──────────────────────────────────────────────────────────────

export interface BrainJobStatus {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  running: boolean;
  lastRun: string | null;
  nextRun: string | null;
  schedule: string;
  model?: string;
  todayCount?: number;
  ranToday?: boolean;
  pendingDate?: string;
  lastAttempt?: string | null;
  lastOutcome?: 'idle' | 'success' | 'failed';
  lastError?: string | null;
}

export interface BrainStatus {
  thought: BrainJobStatus;
  dream: BrainJobStatus;
  thoughtModel: string;
  dreamModel: string;
}

function getDreamTimeForDate(dateStr: string): Date {
  const [year, month, day] = String(dateStr || '').split('-').map((part) => Number(part));
  if (!year || !month || !day) throw new Error(`Invalid dream date "${dateStr}"`);
  return new Date(year, month - 1, day, DREAM_HOUR, DREAM_MIN, 0, 0);
}

function addLocalDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function parseBrainModelRef(raw: string): { providerId: string; model: string } | null {
  const value = String(raw || '').trim();
  if (!value) return null;
  const slashIdx = value.indexOf('/');
  if (slashIdx <= 0) return null;
  const providerId = value.slice(0, slashIdx).trim();
  const model = value.slice(slashIdx + 1).trim();
  if (!providerId || !model || !isKnownProviderId(providerId)) return null;
  return { providerId, model };
}

function normalizeBrainModelRef(raw: unknown, label: 'thoughtModel' | 'dreamModel'): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  const parsed = parseBrainModelRef(value);
  if (!parsed) {
    throw new Error(`${label} must use "provider/model" format with a supported provider.`);
  }
  return `${parsed.providerId}/${parsed.model}`;
}

export class BrainRunner {
  private deps: BrainRunnerDeps;
  private ticker: NodeJS.Timeout | null = null;
  private thoughtRunning = false;
  private dreamRunning   = false;
  private dreamCleanupRunning = false;

  constructor(deps: BrainRunnerDeps) {
    this.deps = deps;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  getBrainStatus(): BrainStatus {
    const state   = loadLatestState();
    const today   = getLocalDateStr();
    const daily   = loadDailyStatus(today);
    const now     = new Date();
    const pendingDreamDate = this._getPendingDreamDate(now, state);

    // Next thought
    const lastThought = state.lastThoughtAt ? new Date(state.lastThoughtAt) : null;
    const nextThoughtMs = lastThought
      ? Math.max(lastThought.getTime() + THOUGHT_INTERVAL_MS, now.getTime())
      : now.getTime();

    // Next dream
    const dreamTime = pendingDreamDate
      ? new Date(now)
      : (() => {
          const next = new Date(now);
          next.setHours(DREAM_HOUR, DREAM_MIN, 0, 0);
          if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
          return next;
        })();

    return {
      thoughtModel: state.thoughtModel || '',
      dreamModel: state.dreamModel || '',
      thought: {
        id: 'brain_thought',
        name: '🧠 Brain Thought',
        description: 'Observes the last 6h of activity and writes a reflection',
        enabled: state.thoughtEnabled !== false,
        running: this.thoughtRunning,
        lastRun: state.lastThoughtAt,
        nextRun: new Date(nextThoughtMs).toISOString(),
        schedule: 'Every 6 hours',
        model: state.thoughtModel || '',
        todayCount: daily.thoughts.length,
        lastAttempt: state.lastThoughtAttemptAt,
        lastOutcome: state.lastThoughtStatus,
        lastError: state.lastThoughtError,
      },
      dream: {
        id: 'brain_dream',
        name: '💤 Brain Dream',
        description: 'Nightly synthesis plus a second-pass memory cleanup 30m later',
        enabled: state.dreamEnabled !== false,
        running: this.dreamRunning || this.dreamCleanupRunning,
        lastRun: state.lastDreamCompletedAt || daily.dreamCompletedAt,
        nextRun: dreamTime.toISOString(),
        schedule: `Nightly at ${String(DREAM_HOUR).padStart(2,'0')}:${String(DREAM_MIN).padStart(2,'0')} local, cleanup about 30m later`,
        model: state.dreamModel || '',
        ranToday: this._isDreamCompletedForDate(today),
        pendingDate: pendingDreamDate || undefined,
        lastAttempt: state.lastDreamAttemptAt,
        lastOutcome: state.lastDreamStatus,
        lastError: state.lastDreamError,
      },
    };
  }

  setConfig(partial: {
    thoughtEnabled?: boolean;
    dreamEnabled?: boolean;
    thoughtModel?: string;
    dreamModel?: string;
  }): void {
    const state = loadLatestState();
    if (partial.thoughtEnabled !== undefined) state.thoughtEnabled = partial.thoughtEnabled;
    if (partial.dreamEnabled  !== undefined) state.dreamEnabled  = partial.dreamEnabled;
    if (partial.thoughtModel  !== undefined) state.thoughtModel  = normalizeBrainModelRef(partial.thoughtModel, 'thoughtModel');
    if (partial.dreamModel    !== undefined) state.dreamModel    = normalizeBrainModelRef(partial.dreamModel, 'dreamModel');
    saveLatestState(state);
  }

  /** Manually trigger a thought or dream run regardless of eligibility */
  async runNow(type: 'thought' | 'dream'): Promise<void> {
    const today = getLocalDateStr();
    if (type === 'thought') {
      const now = new Date();
      const windowStart = new Date(now.getTime() - THOUGHT_INTERVAL_MS);
      const daily = loadDailyStatus(today);
      const ok = await this._runThought(windowStart, now, today, daily.thoughts.length + 1);
      if (!ok) throw new Error('Brain thought run did not produce verified artifacts');
    } else {
      const now = new Date();
      const pendingDate = this._getPendingDreamDate(now, loadLatestState()) || today;
      const ok = await this._runDream(pendingDate, this._countThoughtsForDate(pendingDate));
      if (!ok) throw new Error('Brain dream run did not produce verified artifacts');
    }
  }

  start(): void {
    if (this.ticker) return;
    ensureBrainDirs();
    markGatewayStarted();

    // Do not run model-backed brain jobs during gateway boot. Startup status and
    // user chat should get the first provider slot; the periodic ticker handles
    // eligible thought/dream work after the app is already settled.
    this.ticker = setInterval(() => {
      this._tick().catch(err =>
        console.warn('[BrainRunner] Tick error:', err?.message)
      );
    }, CHECK_INTERVAL_MS);

    if (this.ticker && typeof (this.ticker as any).unref === 'function') {
      (this.ticker as any).unref();
    }
    console.log('[BrainRunner] Started — checking every 15 min for thought/dream eligibility');
  }

  stop(): void {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  // ─── Tick ─────────────────────────────────────────────────────────────────

  private async _tick(): Promise<void> {
    const now      = new Date();
    const today    = getLocalDateStr(now);
    const daily    = loadDailyStatus(today);
    const latest   = loadLatestState();
    const pendingDreamDate = this._getPendingDreamDate(now, latest);
    const pendingCleanupDate = this._getPendingDreamCleanupDate(now, latest);

    // Dream check first — takes priority if eligible
    if (
      !this.dreamRunning
      && !!pendingDreamDate
      && latest.dreamEnabled !== false
      && this._isDreamRetryReady(now, latest, pendingDreamDate)
    ) {
      if (this.thoughtRunning) {
        console.log('[BrainRunner] Dream eligible but waiting for thought to finish');
        return;
      }
      this._runDream(pendingDreamDate, this._countThoughtsForDate(pendingDreamDate))
        .then((ok) => {
          if (!ok) console.warn('[BrainRunner] Dream run finished with failure status');
        })
        .catch(err =>
          console.error('[BrainRunner] Dream run error:', err?.message)
        );
      return;
    }

    // Dream cleanup check - runs after the main dream has safely completed.
    if (
      !this.dreamRunning
      && !this.dreamCleanupRunning
      && !!pendingCleanupDate
      && latest.dreamEnabled !== false
      && this._isDreamCleanupRetryReady(now, latest, pendingCleanupDate)
    ) {
      this._runDreamCleanup(pendingCleanupDate)
        .then((ok) => {
          if (!ok) console.warn('[BrainRunner] Dream cleanup run finished with failure status');
        })
        .catch(err =>
          console.error('[BrainRunner] Dream cleanup run error:', err?.message)
        );
      return;
    }

    // Thought check
    if (!this.thoughtRunning && !daily.dreamRan && latest.thoughtEnabled !== false) {
      const thoughtCheck = this._isThoughtEligible(now, latest);
      if (thoughtCheck) {
        this._runThought(thoughtCheck.windowStart, thoughtCheck.windowEnd, today, daily.thoughts.length + 1)
          .then((ok) => {
            if (!ok) console.warn('[BrainRunner] Thought run finished with failure status');
          })
          .catch(err =>
            console.error('[BrainRunner] Thought run error:', err?.message)
          );
      }
    }
  }

  // ─── Eligibility ──────────────────────────────────────────────────────────

  private _isDreamEligible(now: Date): boolean {
    const h = now.getHours();
    const m = now.getMinutes();
    return h > DREAM_HOUR || (h === DREAM_HOUR && m >= DREAM_MIN);
  }

  private _getLatestDueDreamDate(now: Date): string {
    if (this._isDreamEligible(now)) return getLocalDateStr(now);
    return getLocalDateStr(addLocalDays(now, -1));
  }

  private _hasDreamArtifactForDate(dateStr: string): boolean {
    try {
      const dreamDir = path.join(getBrainDir(), 'dreams', dateStr);
      if (!fs.existsSync(dreamDir) || !fs.statSync(dreamDir).isDirectory()) return false;
      return fs.readdirSync(dreamDir).some((entry) => entry.endsWith('-dream.md'));
    } catch {
      return false;
    }
  }

  private _hasDreamCleanupArtifactForDate(dateStr: string): boolean {
    try {
      const dreamDir = path.join(getBrainDir(), 'dreams', dateStr);
      if (!fs.existsSync(dreamDir) || !fs.statSync(dreamDir).isDirectory()) return false;
      return fs.readdirSync(dreamDir).some((entry) => entry.endsWith('-cleanup.md'));
    } catch {
      return false;
    }
  }

  private _hasThoughtArtifactForDate(dateStr: string): boolean {
    return this._countThoughtsForDate(dateStr) > 0;
  }

  private _isValidTimestamp(value: string | null | undefined): boolean {
    if (!value) return false;
    return Number.isFinite(new Date(value).getTime());
  }

  private _isDreamCompletedForDate(dateStr: string): boolean {
    return this._hasDreamArtifactForDate(dateStr) && !this._hasCandidateOnlyProposalSummaryForDate(dateStr);
  }

  private _hasCandidateOnlyProposalSummaryForDate(dateStr: string): boolean {
    const proposalsFilePath = path.join(getBrainDir(), 'proposals.md');
    try {
      if (!fs.existsSync(proposalsFilePath)) return false;
      const text = fs.readFileSync(proposalsFilePath, 'utf-8');
      const dateHeader = new RegExp(`#\\s+Brain\\s+(?:Proposals|Daily Summary)\\s+-\\s+${dateStr.replace(/-/g, '\\-')}\\b`, 'i');
      if (!dateHeader.test(text)) return false;
    } catch {
      return false;
    }
    return !!this._detectProposalContractError(proposalsFilePath, []);
  }

  private _countThoughtsForDate(dateStr: string): number {
    try {
      const thoughtsDir = path.join(getBrainDir(), 'thoughts', dateStr);
      if (!fs.existsSync(thoughtsDir) || !fs.statSync(thoughtsDir).isDirectory()) return 0;
      return fs.readdirSync(thoughtsDir).filter((entry) => entry.endsWith('-thought.md')).length;
    } catch {
      return 0;
    }
  }

  private _getPendingDreamDate(now: Date, state: BrainLatestState): string | null {
    const latestDueDate = this._getLatestDueDreamDate(now);
    const latestDueDay = getDreamTimeForDate(latestDueDate);
    if (latestDueDay.getTime() > now.getTime()) return null;

    const oldestAllowed = addLocalDays(getDreamTimeForDate(latestDueDate), -(DREAM_CATCHUP_LOOKBACK_DAYS - 1));
    let cursor = oldestAllowed;

    while (cursor.getTime() <= latestDueDay.getTime()) {
      const candidateDate = getLocalDateStr(cursor);
      if (!this._isDreamCompletedForDate(candidateDate)) {
        return candidateDate;
      }
      cursor = addLocalDays(cursor, 1);
    }
    return null;
  }

  private _getPendingDreamCleanupDate(now: Date, state: BrainLatestState): string | null {
    const dreamDate = state.lastDreamDate;
    if (!dreamDate || state.lastDreamStatus !== 'success' || !state.lastDreamCompletedAt) return null;
    if (state.lastDreamCleanupDate === dreamDate) return null;

    const dailyStatus = loadDailyStatus(dreamDate);
    if (dailyStatus.dreamCleanupRan || this._hasDreamCleanupArtifactForDate(dreamDate)) return null;

    const dueAt = new Date(new Date(state.lastDreamCompletedAt).getTime() + DREAM_CLEANUP_DELAY_MS);
    if (!Number.isFinite(dueAt.getTime()) || now.getTime() < dueAt.getTime()) return null;
    return dreamDate;
  }

  /** Returns true if dream is ≤ DREAM_BUFFER_MIN away — avoid starting a thought too close */
  private _isDreamSoon(now: Date): boolean {
    const h = now.getHours();
    const m = now.getMinutes();
    const nowMinutes   = h * 60 + m;
    const dreamMinutes = DREAM_HOUR * 60 + DREAM_MIN;
    const diff = dreamMinutes - nowMinutes;
    return diff >= 0 && diff <= DREAM_BUFFER_MIN;
  }

  private _isThoughtEligible(
    now: Date,
    state: BrainLatestState,
  ): { windowStart: Date; windowEnd: Date } | null {
    // Don't run thoughts if dream is imminent or already ran today
    if (this._isDreamSoon(now) || this._isDreamEligible(now)) return null;
    if (state.lastThoughtStatus === 'failed' && state.lastThoughtAttemptAt) {
      const lastAttemptMs = new Date(state.lastThoughtAttemptAt).getTime();
      if (Number.isFinite(lastAttemptMs)) {
        const elapsedSinceAttempt = now.getTime() - lastAttemptMs;
        if (elapsedSinceAttempt < THOUGHT_RETRY_BACKOFF_MS) return null;
      }
    }

    const windowEnd = now;

    const lastThoughtAt = state.lastThoughtAt;
    if (!lastThoughtAt || !this._isValidTimestamp(lastThoughtAt)) {
      // First thought of the day/session
      const windowStart = new Date(now.getTime() - THOUGHT_INTERVAL_MS);
      return { windowStart, windowEnd };
    }

    const lastThought = new Date(lastThoughtAt);
    if (!this._hasThoughtArtifactForDate(getLocalDateStr(lastThought))) {
      const windowStart = new Date(now.getTime() - THOUGHT_INTERVAL_MS);
      return { windowStart, windowEnd };
    }

    const elapsed     = now.getTime() - lastThought.getTime();

    if (elapsed < THOUGHT_INTERVAL_MS) return null;

    // Catch-up: cap window to 12h max regardless of actual gap
    const windowStart = elapsed > CATCHUP_CAP_MS
      ? new Date(now.getTime() - CATCHUP_CAP_MS)
      : lastThought;

    return { windowStart, windowEnd };
  }

  private _isDreamRetryReady(now: Date, state: BrainLatestState, pendingDate: string): boolean {
    if (
      state.lastDreamStatus !== 'failed'
      || !state.lastDreamAttemptAt
      || state.lastDreamAttemptDate !== pendingDate
    ) {
      return true;
    }
    const attemptMs = new Date(state.lastDreamAttemptAt).getTime();
    if (!Number.isFinite(attemptMs)) return true;
    const elapsedSinceAttempt = now.getTime() - attemptMs;
    return elapsedSinceAttempt >= DREAM_RETRY_BACKOFF_MS;
  }

  private _isDreamCleanupRetryReady(now: Date, state: BrainLatestState, pendingDate: string): boolean {
    if (
      state.lastDreamCleanupStatus !== 'failed'
      || !state.lastDreamCleanupAttemptAt
      || state.lastDreamCleanupAttemptDate !== pendingDate
    ) {
      return true;
    }
    const attemptMs = new Date(state.lastDreamCleanupAttemptAt).getTime();
    if (!Number.isFinite(attemptMs)) return true;
    const elapsedSinceAttempt = now.getTime() - attemptMs;
    return elapsedSinceAttempt >= DREAM_CLEANUP_RETRY_BACKOFF_MS;
  }

  private _extractProposalIds(toolResults: Array<{ name: string; args: any; result: string; error: boolean }>): string[] {
    const ids = new Set<string>();
    for (const tr of toolResults || []) {
      if (tr?.error || String(tr?.name || '') !== 'write_proposal') continue;
      const matches = String(tr?.result || '').match(/prop_[a-z0-9_]+/gi) || [];
      for (const match of matches) ids.add(match);
    }
    return Array.from(ids);
  }

  private _detectProposalContractError(proposalsFilePath: string, proposalIds: string[]): string | null {
    if (proposalIds.length > 0) return null;

    let text = '';
    try {
      if (!fs.existsSync(proposalsFilePath)) return null;
      text = fs.readFileSync(proposalsFilePath, 'utf-8');
    } catch {
      return null;
    }

    if (!text.trim() || /prop_[a-z0-9_]+/i.test(text)) return null;
    if (/No proposals generated tonight|None\s+[-—]\s+no items passed|zero proposals pass/i.test(text)) return null;

    const containsProposalSection = /^##\s+Proposals\b/im.test(text);
    const containsNumberedCandidates = /^###\s*\d+[\).]\s+/m.test(text) || /^\d+\.\s+\*\*[^*]+/m.test(text);
    const admitsUnsubmittedProposals = /proposal candidates|did not create executable\s+`?write_proposal`?|cron prompt prohibited|proposal recommended|recommended proposal/i.test(text);

    if (admitsUnsubmittedProposals || (containsProposalSection && containsNumberedCandidates)) {
      return 'Dream listed proposal candidates but did not call write_proposal, so no executable proposal records were created.';
    }

    return null;
  }

  // ─── Thought run ──────────────────────────────────────────────────────────

  private async _runThought(
    windowStart: Date,
    windowEnd: Date,
    dateStr: string,
    thoughtNumber: number,
  ): Promise<boolean> {
    if (this.thoughtRunning) return false;
    this.thoughtRunning = true;
    const runStartedAt = Date.now();

    const windowLabel = getWindowLabel(windowStart);
    const runId       = crypto.randomUUID();
    const sessionId   = `brain_thought_${dateStr}_${windowLabel}`;
    const abortSignal = { aborted: false };
    const runtimeId = registerLiveRuntime({
      kind: 'brain_thought',
      label: `Brain thought - ${dateStr} ${windowLabel}`,
      sessionId,
      source: 'system',
      detail: `Window ${fmtUtc(windowStart)} -> ${fmtUtc(windowEnd)}`,
      abortSignal,
    });

    console.log(`[BrainRunner] Starting Thought ${thoughtNumber} — window ${fmtUtc(windowStart)} → ${fmtUtc(windowEnd)}`);

    // Persist attempt immediately (separate from success state)
    const state = loadLatestState();
    state.lastThoughtAttemptAt = new Date().toISOString();
    state.lastThoughtStatus = 'idle';
    state.lastThoughtError = null;
    saveLatestState(state);

    clearHistory(sessionId);
	    addMessage(
	      sessionId,
	      { role: 'user', content: `[Brain Thought ${thoughtNumber}] Window: ${fmtUtc(windowStart)} → ${fmtUtc(windowEnd)}`, timestamp: Date.now() },
	      { disableCompactionCheck: true, disableMemoryFlushCheck: true },
	    );

	    const outFile = `thoughts/${dateStr}/${windowLabel}-thought.md`;
	    const absOutFile = path.join(getBrainDir(), outFile);
	    const workspaceOutFile = path.join('Brain', outFile).replace(/\\/g, '/');
	    const prompt = this._buildThoughtPromptV2({
	      windowStart, windowEnd, dateStr, windowLabel,
	      thoughtNumber, outFile: absOutFile,
	    });

    const sendSSE = (event: string, data: any) => {
      if (['tool_call', 'tool_result', 'thinking', 'info'].includes(event)) {
        this.deps.broadcast({ type: 'brain_thought_sse', thoughtNumber, event, data });
      }
    };

	    const thoughtModelOverride = loadLatestState().thoughtModel?.trim() || undefined;
	    let resultText = '';
	    let toolResults: Array<{ name: string; args: any; result: string; error: boolean }> = [];
      try {
        activateToolCategory(sessionId, 'file_ops');
        // web_search / web_fetch are core tools (no category) — the toolFilter
        // allowlist below is enough to expose them for light research.
        if (!isPublicBrainProfile()) {
          activateToolCategory(sessionId, 'source_read'); // inspect own code/tools for current-state + tool-failure diagnosis
        }
        const businessCandidatesFile = path.posix.join('Brain', 'business-candidates', dateStr, 'candidates.jsonl');
        const activeWorkFile = path.posix.join('Brain', 'active-work.jsonl');
        setSessionMutationScope(sessionId, {
	        allowedFiles: [workspaceOutFile, businessCandidatesFile, activeWorkFile],
	        allowedDirs: [path.posix.dirname(workspaceOutFile), path.posix.dirname(businessCandidatesFile)],
	      });
	      const result = await this.deps.handleChat(
	        prompt,
	        sessionId,
        sendSSE,
        undefined,
        abortSignal,
        `CONTEXT: Automated Brain Thought run ${thoughtNumber} for ${dateStr}. Window: ${fmtUtc(windowStart)} → ${fmtUtc(windowEnd)}. Observe, verify current state against live artifacts, do light research, maintain the Active Work Ledger, write the thought file, and apply low-risk existing-skill maintenance only. No memory writes, proposals, or new skill creation.`,
        thoughtModelOverride,
        'cron',
        brainDreamToolFilter([
          'list_directory',
          'list_files',
          'read_file',
          'read_files_batch',
	          'file_stats',
	          'grep_file',
	          'grep_files',
          'search_files',
          'mkdir',
          'create_file',
          'write_file',
	          'replace_lines',
          'find_replace',
          'insert_after',
          'delete_lines',
          // Light research — confirm current state of an idea and scan for prior art.
          'web_search',
          'web_search_multi',
          'web_search_single',
          'web_fetch',
          // Private builds only (stripped by brainDreamToolFilter in public builds):
          // inspect own source/tools to confirm current state and diagnose tool failures.
          'list_source',
          'source_stats',
          'read_source',
          'grep_source',
          'list_prom',
          'read_prom_file',
          'grep_prom',
          'skill_list',
          'skill_read',
          'skill_inspect',
          'skill_resource_list',
          'skill_resource_read',
          'skill_audit_all',
          'skill_update_metadata',
          'skill_manifest_write',
          'skill_resource_write',
        ]),
      );
      resultText = abortSignal.aborted
        ? 'ABORTED: Brain thought run aborted by operator.'
        : (result?.text || '');
      toolResults = Array.isArray(result?.toolResults) ? result.toolResults : [];
	    } catch (err: any) {
	      resultText = `Error: ${err?.message || String(err)}`;
	      console.error(`[BrainRunner] Thought ${thoughtNumber} failed:`, err?.message);
	    } finally {
	      finishLiveRuntime(runtimeId);
	      clearSessionMutationScope(sessionId);
	      this.thoughtRunning = false;
	    }

    addMessage(
      sessionId,
      { role: 'assistant', content: resultText.slice(0, 6000), timestamp: Date.now() },
      { disableCompactionCheck: true, disableMemoryFlushCheck: true },
    );
    if (toolResults.length > 0) {
      const observations = persistToolResultsAsObservations(sessionId, `brain_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`, toolResults);
      const toolLog = formatToolObservationsForContext(observations, { includeHeader: false, maxChars: 5000, maxObservations: 8 });
      if (toolLog) persistToolLog(sessionId, toolLog);
    }

    const fileExists = fs.existsSync(absOutFile);
    const fileStats = fileExists ? fs.statSync(absOutFile) : null;
    const fileLooksFresh = !!fileStats && fileStats.size > 0 && fileStats.mtimeMs >= (runStartedAt - 5000);
    const runFailed = /^error:/i.test(String(resultText || '').trim());
    const success = fileLooksFresh && !runFailed;

    const latestAfter = loadLatestState();
    if (success) {
      latestAfter.lastThoughtAt = new Date().toISOString();
      latestAfter.lastThoughtWindow = windowLabel;
      latestAfter.lastThoughtStatus = 'success';
      latestAfter.lastThoughtError = null;
      saveLatestState(latestAfter);
    } else {
      latestAfter.lastThoughtStatus = 'failed';
      latestAfter.lastThoughtError = runFailed
        ? String(resultText).slice(0, 500)
        : `Expected thought artifact missing or stale: ${outFile}`;
      saveLatestState(latestAfter);
    }

    if (success) {
      // Update daily status on verified success only
      const daily = loadDailyStatus(dateStr);
      daily.thoughts.push({ window: windowLabel, file: outFile, completedAt: new Date().toISOString(), runId });
      saveDailyStatus(daily);
    }

    // Broadcast completion
    this.deps.broadcast({
      type: 'brain_thought_done',
      thoughtNumber,
      date: dateStr,
      window: windowLabel,
      file: outFile,
      summary: resultText.slice(0, 400),
      success,
      error: success ? undefined : (loadLatestState().lastThoughtError || 'Unknown thought run failure'),
    });

    if (success) {
      console.log(`[BrainRunner] Thought ${thoughtNumber} complete — wrote to ${outFile}`);
    } else {
      console.warn(`[BrainRunner] Thought ${thoughtNumber} failed integrity checks — state not marked successful`);
      this.deps.broadcast({
        type: 'brain_thought_failed',
        thoughtNumber,
        date: dateStr,
        window: windowLabel,
        file: outFile,
        error: loadLatestState().lastThoughtError || 'Unknown thought run failure',
      });
    }
    return success;
  }

  // ─── Dream run ────────────────────────────────────────────────────────────

  private async _runDream(dateStr: string, thoughtCount: number): Promise<boolean> {
    if (this.dreamRunning) return false;
    this.dreamRunning = true;
    const runStartedAt = Date.now();

    const now         = new Date();
    const dreamLabel  = getWindowLabel(now);
    const sessionId   = `brain_dream_${dateStr}`;
    const abortSignal = { aborted: false };
    const runtimeId = registerLiveRuntime({
      kind: 'brain_dream',
      label: `Brain dream - ${dateStr}`,
      sessionId,
      source: 'system',
      detail: `Nightly synthesis for ${dateStr}`,
      abortSignal,
    });

    console.log(`[BrainRunner] Starting Dream for ${dateStr} (${thoughtCount} thoughts available)`);

    clearHistory(sessionId);
    addMessage(
      sessionId,
      { role: 'user', content: `[Brain Dream] Nightly synthesis for ${dateStr} — ${thoughtCount} thought(s)`, timestamp: Date.now() },
      { disableCompactionCheck: true, disableMemoryFlushCheck: true },
    );

	    const outFile    = `dreams/${dateStr}/${dreamLabel}-dream.md`;
	    const absOutFile = path.join(getBrainDir(), outFile);
	    const workspaceOutFile = path.join('Brain', outFile).replace(/\\/g, '/');
	    const workspaceProposalsFile = path.join('Brain', 'proposals.md').replace(/\\/g, '/');
	    const prompt     = this._buildDreamPromptV2({ dateStr, dreamLabel, thoughtCount, outFile: absOutFile });

    const sendSSE = (event: string, data: any) => {
      if (['tool_call', 'tool_result', 'thinking', 'info'].includes(event)) {
        this.deps.broadcast({ type: 'brain_dream_sse', date: dateStr, event, data });
      }
    };

	    const dreamState = loadLatestState();
	    dreamState.lastDreamAttemptAt = new Date().toISOString();
	    dreamState.lastDreamAttemptDate = dateStr;
	    dreamState.lastDreamStatus = 'idle';
	    dreamState.lastDreamError = null;
	    saveLatestState(dreamState);

	    const dreamModelOverride = loadLatestState().dreamModel?.trim() || undefined;
	    let resultText = '';
	    let toolResults: Array<{ name: string; args: any; result: string; error: boolean }> = [];
	    try {
	      activateToolCategory(sessionId, 'file_ops');
	      activateToolCategory(sessionId, 'browser'); // deep competitor/OSS research on JS-heavy pages
	      if (!isPublicBrainProfile()) {
	        activateToolCategory(sessionId, 'source_read');
	      }
	      const activeWorkFile = path.posix.join('Brain', 'active-work.jsonl');
	      setSessionMutationScope(sessionId, {
	        allowedFiles: [workspaceOutFile, workspaceProposalsFile, 'BUSINESS.md', activeWorkFile],
	        allowedDirs: [path.posix.dirname(workspaceOutFile), 'entities', 'Brain', path.posix.join('Brain', 'business-reconciliation', dateStr)],
	      });
	      const result = await this.deps.handleChat(
	        prompt,
	        sessionId,
        sendSSE,
        undefined,
        abortSignal,
        `CONTEXT: Automated Brain Dream run for ${dateStr}. Drive off the Active Work Ledger and the day's thoughts: re-verify current state against live artifacts, do deep research (web + browser), update durable memory, and file hardened proposals. This is the nightly execution run.`,
        dreamModelOverride,
        'cron',
        brainDreamToolFilter([
          'list_directory',
          'list_files',
          'read_file',
	          'file_stats',
	          'grep_file',
	          'grep_files',
          'search_files',
          'mkdir',
          'create_file',
          'write_file',
	          'replace_lines',
	          'find_replace',
          'apply_patchset',
          'insert_after',
          'delete_lines',
          // Deep research — web search + page fetch + browser for JS-heavy sources.
          'web_search',
          'web_search_multi',
          'web_search_single',
          'web_fetch',
          'browser_open',
          'browser_snapshot',
          'browser_get_page_text',
          'browser_close',
          'memory_browse',
          'memory_write',
          'list_entities',
          'read_entity',
          'write_entity',
          'append_entity_event',
          'list_source',
          'source_stats',
          'read_source',
          'read_dev_sources',
          'apply_dev_source_patchset',
          'grep_source',
          'list_prom',
          'prom_file_stats',
          'read_prom_file',
          'grep_prom',
          'webui_source_stats',
          'read_webui_source',
          'grep_webui_source',
          'skill_list',
          'skill_read',
          'skill_inspect',
          'skill_resource_list',
          'skill_resource_read',
          'skill_audit_all',
          'skill_update_metadata',
          'skill_repair_metadata',
          'skill_manifest_write',
          'skill_resource_write',
          'write_proposal',
        ]),
      );
      resultText = abortSignal.aborted
        ? 'ABORTED: Brain dream run aborted by operator.'
        : (result?.text || '');
      toolResults = Array.isArray(result?.toolResults) ? result.toolResults : [];
	    } catch (err: any) {
	      resultText = `Error: ${err?.message || String(err)}`;
	      console.error(`[BrainRunner] Dream for ${dateStr} failed:`, err?.message);
	    } finally {
	      finishLiveRuntime(runtimeId);
	      clearSessionMutationScope(sessionId);
	      this.dreamRunning = false;
	    }

    addMessage(
      sessionId,
      { role: 'assistant', content: resultText.slice(0, 6000), timestamp: Date.now() },
      { disableCompactionCheck: true, disableMemoryFlushCheck: true },
    );
    if (toolResults.length > 0) {
      const observations = persistToolResultsAsObservations(sessionId, `brain_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`, toolResults);
      const toolLog = formatToolObservationsForContext(observations, { includeHeader: false, maxChars: 5000, maxObservations: 8 });
      if (toolLog) persistToolLog(sessionId, toolLog);
    }

    const runFailed = /^error:/i.test(String(resultText || '').trim());
    const proposalsFilePath = path.join(getBrainDir(), 'proposals.md');
    const artifactRecoveryNotes: string[] = [];
    const artifactFresh = (filePath: string): boolean => {
      try {
        if (!fs.existsSync(filePath)) return false;
        const st = fs.statSync(filePath);
        return st.size > 0 && st.mtimeMs >= (runStartedAt - 5000);
      } catch {
        return false;
      }
    };

    if (!runFailed && !artifactFresh(absOutFile) && String(resultText || '').trim()) {
      try {
        fs.mkdirSync(path.dirname(absOutFile), { recursive: true });
        fs.writeFileSync(absOutFile, [
          `# Dream - ${dateStr}`,
          `_Generated: ${fmtLocal(new Date())}_`,
          '',
          '## Artifact Recovery Note',
          'The model-backed Dream run returned a response but did not write a fresh dream artifact. Prometheus recovered by saving the assistant response here instead of marking the whole Dream failed.',
          '',
          '## Recovered Dream Response',
          String(resultText || '').trim(),
          '',
        ].join('\n'), 'utf-8');
        artifactRecoveryNotes.push(`Recovered missing/stale dream artifact: ${outFile}`);
      } catch (err: any) {
        console.warn('[BrainRunner] Failed to recover dream artifact:', err?.message || err);
      }
    }

    if (!runFailed && artifactFresh(absOutFile) && !artifactFresh(proposalsFilePath)) {
      try {
        fs.mkdirSync(path.dirname(proposalsFilePath), { recursive: true });
        fs.writeFileSync(proposalsFilePath, [
          `# Brain Proposals - ${dateStr}`,
          `_Generated: ${fmtLocal(new Date())}_`,
          '',
          '## Artifact Recovery Note',
          'The Dream run completed but did not write a fresh `Brain/proposals.md`. Prometheus recovered this lightweight morning summary so the Dream is not treated as failed solely because the proposals artifact was missing or stale.',
          '',
          '## Dream Artifact',
          `- ${workspaceOutFile}`,
          '',
          '## Proposals',
          '- None recovered from this run. See the Dream artifact above for the full synthesis and any deferred ideas.',
          '',
        ].join('\n'), 'utf-8');
        artifactRecoveryNotes.push('Recovered missing/stale Brain/proposals.md with a lightweight fallback summary.');
      } catch (err: any) {
        console.warn('[BrainRunner] Failed to recover proposals artifact:', err?.message || err);
      }
    }

    const dreamFresh = artifactFresh(absOutFile);
    const proposalsFresh = artifactFresh(proposalsFilePath);
    const artifactsFresh = dreamFresh && proposalsFresh;
    const proposalIds = this._extractProposalIds(toolResults).slice(-100);
    const proposalContractError = this._detectProposalContractError(proposalsFilePath, proposalIds);
    const success = artifactsFresh && !runFailed && !proposalContractError;

	    const state = loadLatestState();
	    if (success) {
	      state.proposalDedupeIds = proposalIds;
	      state.lastDreamDate = dateStr;
	      state.lastDreamCompletedAt = new Date().toISOString();
	      state.lastDreamAttemptDate = dateStr;
	      state.lastDreamStatus = 'success';
	      state.lastDreamError = artifactRecoveryNotes.length ? artifactRecoveryNotes.join(' ') : null;
	      saveLatestState(state);

      const daily = loadDailyStatus(dateStr);
      daily.dreamRan         = true;
      daily.dreamFile        = outFile;
      daily.dreamCompletedAt = new Date().toISOString();
      saveDailyStatus(daily);
      if (this.deps.skillsManager) {
        try {
          const curator = runSkillCurator({
            workspacePath: this.deps.workspacePath,
            skillsManager: this.deps.skillsManager,
            mode: 'auto-safe',
          });
          this.deps.broadcast({
            type: 'skill_curator_done',
            date: dateStr,
            runId: curator.runId,
            suggestions: curator.suggestions.length,
            auditedChanges: curator.auditedChanges.length,
            quarantined: curator.quarantined.length,
            reportPath: curator.reportPath,
          });
        } catch (err: any) {
          console.warn('[BrainRunner] Skill curator pass failed:', err?.message || err);
        }
      }
    } else {
      state.lastDreamStatus = 'failed';
      state.lastDreamError = runFailed
        ? String(resultText).slice(0, 500)
        : proposalContractError
          ? proposalContractError
        : `Expected dream artifacts missing/stale after recovery attempts: ${[
          dreamFresh ? null : outFile,
          proposalsFresh ? null : 'proposals.md',
        ].filter(Boolean).join(', ') || '(unknown)'}`;
      saveLatestState(state);
    }

    // Broadcast completion
    this.deps.broadcast({
      type: 'brain_dream_done',
      date: dateStr,
      file: outFile,
      summary: `${artifactRecoveryNotes.length ? `[Recovered artifacts: ${artifactRecoveryNotes.join(' ')}]\n` : ''}${resultText.slice(0, 600)}`,
      success,
      error: success ? undefined : (loadLatestState().lastDreamError || 'Unknown dream run failure'),
      recoveredArtifacts: artifactRecoveryNotes,
    });

    if (success) {
      console.log(`[BrainRunner] Dream complete for ${dateStr} — wrote to ${outFile}`);
    } else {
      console.warn(`[BrainRunner] Dream for ${dateStr} failed integrity checks — state not marked successful`);
      this.deps.broadcast({
        type: 'brain_dream_failed',
        date: dateStr,
        file: outFile,
        error: loadLatestState().lastDreamError || 'Unknown dream run failure',
      });
    }
    return success;
  }

  // ─── Thought prompt ───────────────────────────────────────────────────────

  private async _runDreamCleanup(dateStr: string): Promise<boolean> {
    if (this.dreamCleanupRunning || this.dreamRunning) return false;
    this.dreamCleanupRunning = true;
    const runStartedAt = Date.now();

    const now = new Date();
    const cleanupLabel = getWindowLabel(now);
    const sessionId = `brain_dream_cleanup_${dateStr}`;
    const abortSignal = { aborted: false };
    const runtimeId = registerLiveRuntime({
      kind: 'brain_dream',
      label: `Brain dream cleanup - ${dateStr}`,
      sessionId,
      source: 'system',
      detail: `Second-pass memory solidifier for ${dateStr}`,
      abortSignal,
    });

    console.log(`[BrainRunner] Starting Dream cleanup for ${dateStr}`);

    const state = loadLatestState();
    state.lastDreamCleanupAttemptAt = new Date().toISOString();
    state.lastDreamCleanupAttemptDate = dateStr;
    state.lastDreamCleanupStatus = 'idle';
    state.lastDreamCleanupError = null;
    saveLatestState(state);

    clearHistory(sessionId);
    addMessage(
      sessionId,
      { role: 'user', content: `[Brain Dream Cleanup] Memory solidifier for ${dateStr}`, timestamp: Date.now() },
      { disableCompactionCheck: true, disableMemoryFlushCheck: true },
    );

    const outFile = `dreams/${dateStr}/${cleanupLabel}-cleanup.md`;
    const absOutFile = path.join(getBrainDir(), outFile);
    const workspaceOutFile = path.join('Brain', outFile).replace(/\\/g, '/');
    const prompt = this._buildDreamCleanupPromptV2({ dateStr, outFile: absOutFile });

    const sendSSE = (event: string, data: any) => {
      if (['tool_call', 'tool_result', 'thinking', 'info'].includes(event)) {
        this.deps.broadcast({ type: 'brain_dream_cleanup_sse', date: dateStr, event, data });
      }
    };

    const dreamModelOverride = loadLatestState().dreamModel?.trim() || undefined;
    let resultText = '';
    let toolResults: Array<{ name: string; args: any; result: string; error: boolean }> = [];
    try {
      activateToolCategory(sessionId, 'file_ops');
      setSessionMutationScope(sessionId, {
        allowedFiles: [workspaceOutFile, 'USER.md', 'SOUL.md', 'MEMORY.md'],
        allowedDirs: [
          path.posix.dirname(workspaceOutFile),
          'skills',
          path.posix.join('Brain', 'skill-curator'),
        ],
      });
      const result = await this.deps.handleChat(
        prompt,
        sessionId,
        sendSSE,
        undefined,
        abortSignal,
        `CONTEXT: Automated Brain Dream cleanup for ${dateStr}. Second pass only: remove/dedupe stale memory text and audit recent low-risk skill-curator updates. No new memories, no proposals, no new skills.`,
        dreamModelOverride,
        'cron',
        [
          'list_directory',
          'list_files',
          'read_file',
          'file_stats',
          'grep_file',
          'grep_files',
          'search_files',
          'mkdir',
          'create_file',
          'write_file',
          'replace_lines',
          'find_replace',
          'insert_after',
          'delete_lines',
          'memory_browse',
          'skill_curator',
          'skill_read',
          'skill_inspect',
          'skill_resource_list',
          'skill_resource_read',
          'skill_audit_all',
          'skill_repair_metadata',
          'skill_resource_write',
          'skill_resource_delete',
        ],
      );
      resultText = abortSignal.aborted
        ? 'ABORTED: Brain dream cleanup run aborted by operator.'
        : (result?.text || '');
      toolResults = Array.isArray(result?.toolResults) ? result.toolResults : [];
    } catch (err: any) {
      resultText = `Error: ${err?.message || String(err)}`;
      console.error(`[BrainRunner] Dream cleanup for ${dateStr} failed:`, err?.message);
    } finally {
      finishLiveRuntime(runtimeId);
      clearSessionMutationScope(sessionId);
      this.dreamCleanupRunning = false;
    }

    addMessage(
      sessionId,
      { role: 'assistant', content: resultText.slice(0, 6000), timestamp: Date.now() },
      { disableCompactionCheck: true, disableMemoryFlushCheck: true },
    );
    if (toolResults.length > 0) {
      const observations = persistToolResultsAsObservations(sessionId, `brain_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`, toolResults);
      const toolLog = formatToolObservationsForContext(observations, { includeHeader: false, maxChars: 5000, maxObservations: 8 });
      if (toolLog) persistToolLog(sessionId, toolLog);
    }

    const cleanupExists = fs.existsSync(absOutFile);
    const cleanupStats = cleanupExists ? fs.statSync(absOutFile) : null;
    const fileLooksFresh = !!cleanupStats && cleanupStats.size > 0 && cleanupStats.mtimeMs >= (runStartedAt - 5000);
    const runFailed = /^error:/i.test(String(resultText || '').trim());
    const success = fileLooksFresh && !runFailed;

    const latestAfter = loadLatestState();
    if (success) {
      latestAfter.lastDreamCleanupDate = dateStr;
      latestAfter.lastDreamCleanupCompletedAt = new Date().toISOString();
      latestAfter.lastDreamCleanupAttemptDate = dateStr;
      latestAfter.lastDreamCleanupStatus = 'success';
      latestAfter.lastDreamCleanupError = null;
      saveLatestState(latestAfter);

      const daily = loadDailyStatus(dateStr);
      daily.dreamCleanupRan = true;
      daily.dreamCleanupFile = outFile;
      daily.dreamCleanupCompletedAt = new Date().toISOString();
      saveDailyStatus(daily);
    } else {
      latestAfter.lastDreamCleanupStatus = 'failed';
      latestAfter.lastDreamCleanupError = runFailed
        ? String(resultText).slice(0, 500)
        : `Expected dream cleanup artifact missing/stale: ${outFile}`;
      saveLatestState(latestAfter);
    }

    this.deps.broadcast({
      type: 'brain_dream_cleanup_done',
      date: dateStr,
      file: outFile,
      summary: resultText.slice(0, 600),
      success,
      error: success ? undefined : (loadLatestState().lastDreamCleanupError || 'Unknown dream cleanup failure'),
    });


    if (success) {
      console.log(`[BrainRunner] Dream cleanup complete for ${dateStr} - wrote to ${outFile}`);
    } else {
      console.warn(`[BrainRunner] Dream cleanup for ${dateStr} failed integrity checks`);
      this.deps.broadcast({
        type: 'brain_dream_cleanup_failed',
        date: dateStr,
        file: outFile,
        error: loadLatestState().lastDreamCleanupError || 'Unknown dream cleanup failure',
      });
    }
    return success;
  }

  private _buildThoughtPrompt(opts: {
    windowStart: Date;
    windowEnd: Date;
    dateStr: string;
    windowLabel: string;
    thoughtNumber: number;
    outFile: string;
  }): string {
    const { windowStart, windowEnd, dateStr, windowLabel, thoughtNumber, outFile } = opts;
    const wsStart = fmtUtc(windowStart);
    const wsEnd   = fmtUtc(windowEnd);
    const nowStr  = fmtLocal(new Date());
    // Workspace-relative paths (relative to workspacePath) so the file tools resolve them correctly.
    // Do NOT use absolute Windows paths here — the agent strips the drive prefix and creates doubled dirs.
    const thoughtsDirRel  = path.join('Brain', 'thoughts', dateStr);
    const businessCandidatesDirRel = path.join('Brain', 'business-candidates', dateStr);
    const memNotesFileRel = path.join('memory', `${dateStr}-intraday-notes.md`);
    const auditDirRel     = 'audit';
    // outFile received here is already absolute — derive the workspace-relative version for the prompt
    const outFileRel = path.relative(this.deps.workspacePath, outFile);

    return `You are Prometheus, running an automated Brain Thought analysis.

════════════════════════════════════════════════════════════
BRAIN THOUGHT ${thoughtNumber} — Observation + Existing Skill Maintenance
Window:  ${wsStart} → ${wsEnd}
Date:    ${dateStr}
Output:  ${outFileRel}   ← path is RELATIVE to workspace root (use as-is with file tools)
════════════════════════════════════════════════════════════

IMPORTANT — FILE PATH CONVENTION:
All paths in this prompt are RELATIVE to the workspace root.
Pass them directly to file tools (read_file, create_file, mkdir, list_directory) without modification.
Do NOT prepend "workspace/" or any drive letter — the tools resolve relative paths automatically.

STRICT RULES — do not violate under any circumstances:
• DO NOT write to USER.md, SOUL.md, or any memory files
• DO NOT call write_proposal or create any proposals
• DO NOT create new skills directly
• DO NOT update cron jobs, configs, or team state
• Your direct file writes are limited to the thought output file listed above
• You may update existing skills only through skill_manifest_write or skill_resource_write, after reading/inspecting the existing skill
• Existing-skill updates must be low-risk, additive or narrowly corrective, evidence-backed, and recorded with appliedBy="brain_thought", evidence, reason, and changeType metadata

════════════════════════════════════════════════════════════
STEP 1 — SCAN AUDIT WINDOW
════════════════════════════════════════════════════════════

Scan the audit directory for activity between ${wsStart} and ${wsEnd}.
Audit root: ${auditDirRel}

Priority scan order (read in this order, respect the caps):
  1. ${memNotesFileRel}  — today's intraday notes (if file exists)
  2. ${auditDirRel}/chats/sessions/     — chat session snapshots (max 8 most recent)
  3. ${auditDirRel}/tasks/              — task state snapshots (max 15 files)
  4. ${auditDirRel}/cron/runs/          — JSONL run history files (filter by timestamp)
  5. ${auditDirRel}/teams/              — team activity logs (if present)
  6. ${auditDirRel}/proposals/          — proposal state changes (if present)

Selective reading strategy:
  • List each directory first, identify files by modification time if available
  • For JSONL files: read and extract entries whose timestamp falls in the window
  • Read file content selectively — you do not need to read every character
  • If a directory is empty or no files fall in the window, note "no activity" and continue
  • Cap total files read: 8 chat sessions, 15 task files, all cron JSONL entries in window

════════════════════════════════════════════════════════════
STEP 2 — ANALYZE USING THE RUBRIC
════════════════════════════════════════════════════════════

After reading, populate each section below.
For every finding: assign confidence (high / medium / low) and cite evidence (file name or session ref).

A. ACTIVITY SUMMARY
   What actually happened in this 6h window:
   - Major user requests and what was asked
   - Files written or changed
   - Tasks completed or failed (include durations where visible)
   - Scheduled jobs that ran, their results
   - Agents or teams that were invoked

B. BEHAVIOR QUALITY
   Evaluate how Prometheus performed:
   - Where it acted well (correct tool choice, efficient path, good judgment)
   - Where it stalled, looped, or took excessive steps
   - Over-tooling (used many tools when fewer would do) or under-tooling (should have used a tool, didn't)
   - User corrections, re-prompts, or explicit frustration signals
   - Misunderstandings that required clarification

C. MEMORY CANDIDATES
   Items that might be worthy of USER.md, SOUL.md, or MEMORY.md — the Dream will evaluate before any writes.
   Only flag if durable (not one-off noise) and not clearly already captured.
   Future Behavior Memory Test:
   A memory is only useful if it changes future behavior. For every candidate, answer:
   1. What future situation should trigger recall?
   2. What should Prometheus do differently because of it?
   3. Where is the best home: USER.md, SOUL.md, MEMORY.md, BUSINESS.md, entity file, skill, proposal, or nowhere?
   4. What would make this stale or wrong later?
   If you cannot answer these, do not write it as memory.
   Format each as a table row with: Item | Target file | Confidence | Evidence

D. IMPROVEMENT CANDIDATES
   Items that might be worthy of proposals — the Dream will evaluate before submitting.
   Format each as: Issue | Proposal type | Suggested execution mode | Confidence | Evidence
   Proposal types: ${brainThoughtProposalTypes()}
   Execution modes: ${brainThoughtExecutionModes()}

E. WINDOW VERDICT
   - Active: yes / no
   - Signal quality: high / medium / low / none
   - Summary: 2–3 sentence plain-language description of the window

════════════════════════════════════════════════════════════
STEP 3 — WRITE THE THOUGHT FILE
════════════════════════════════════════════════════════════

Create the output directory if needed: ${thoughtsDirRel}
If business candidates exist, create the candidate directory if needed: ${businessCandidatesDirRel}
Write the thought file to: ${outFileRel}

Use EXACTLY this structure:

---
# Thought ${thoughtNumber} — ${dateStr} | Window: ${wsStart}–${wsEnd}
_Generated: ${nowStr}_

## A. Activity Summary
[populate from your analysis]

## B. Behavior Quality
**Went well:**
- [item] | evidence: [ref]

**Stalled or struggled:**
- [item] | evidence: [ref]

**Tool usage patterns:**
- [observations]

**User corrections:**
- [observations, or "none observed"]

## C. Memory Candidates
| Item | Target | Confidence | Evidence |
|------|--------|-----------|---------|
| ...  | USER.md or SOUL.md or MEMORY.md | high/medium/low | [file ref] |

_(Leave table with a single dash row if nothing found.)_

## D. Improvement Candidates
| Issue | Proposal Type | Suggested Execution Mode | Confidence | Evidence |
|-------|---------------|--------------------------|------------|---------|
| ...   | ${brainThoughtProposalTypesExample()} | ${brainThoughtExecutionModesExample()} | high/medium/low | [ref] |

_(Leave table with a single dash row if nothing found.)_

## E. Window Verdict
**Active:** yes/no
**Signal quality:** high/medium/low/none
**Summary:** [2–3 sentences]
---

After the file is written: confirm the write succeeded and stop. Do not do anything else.
`;
  }

  // ─── Dream prompt ─────────────────────────────────────────────────────────

  private _buildDreamPrompt(opts: {
    dateStr: string;
    dreamLabel: string;
    thoughtCount: number;
    outFile: string;
  }): string {
    const { dateStr, dreamLabel, thoughtCount, outFile } = opts;
    const nowStr      = fmtLocal(new Date());
    // Workspace-relative paths — do NOT use absolute Windows paths in prompts.
    // The agent strips the drive prefix and creates doubled dirs (workspace/workspace/...).
    const thoughtsDirRel  = path.join('Brain', 'thoughts', dateStr);
    const dreamsDirRel    = path.join('Brain', 'dreams', dateStr);
    const proposalsFileRel = path.join('Brain', 'proposals.md');
    const userMdFileRel    = 'USER.md';
    const soulMdFileRel    = 'SOUL.md';
    const memoryMdFileRel  = 'MEMORY.md';
    const pendingPropsDirRel = path.join('proposals', 'pending');
    const auditDirRel      = 'audit';
    const outFileRel = path.relative(this.deps.workspacePath, outFile);

    return `You are Prometheus, running an automated Brain Dream — the nightly synthesis and execution run.

════════════════════════════════════════════════════════════
BRAIN DREAM — Nightly Synthesis + Execution
Date:    ${dateStr}
Time:    ${nowStr}
Thoughts available: ${thoughtCount}
Output:  ${outFileRel}
         ${proposalsFileRel} (REWRITE)
════════════════════════════════════════════════════════════

IMPORTANT — FILE PATH CONVENTION:
All paths in this prompt are RELATIVE to the workspace root.
Pass them directly to file tools (read_file, create_file, mkdir, list_directory) without modification.
Do NOT prepend "workspace/" or any drive letter — the tools resolve relative paths automatically.

You have 5 phases tonight. Execute them in order.

════════════════════════════════════════════════════════════
PHASE 1 — LOAD TODAY'S THOUGHTS
════════════════════════════════════════════════════════════

List directory: ${thoughtsDirRel}
Read ALL *-thought.md files found there.

Also load for context:
  - ${userMdFileRel}     — current USER.md (needed for memory dedup)
  - ${soulMdFileRel}     — current SOUL.md (needed for memory dedup)
  - ${memoryMdFileRel}   — current MEMORY.md (needed for long-term memory dedup)
  - ${proposalsFileRel}  — current proposals.md (to see what's already pending/recent)

List ${pendingPropsDirRel} to see what formal proposals are currently pending approval.
(You need this for dedup in Phase 4.)

If no thought files exist in ${thoughtsDirRel}:
  - Note "no thoughts available" in the dream file
  - Skip Phases 2–4
  - Still write the dream file and proposals.md

════════════════════════════════════════════════════════════
PHASE 2 — CROSS-EXAMINE HIGH-CONFIDENCE ITEMS
════════════════════════════════════════════════════════════

For any item marked confidence: HIGH in sections C or D of ANY thought:
  - Read the cited evidence file/session from ${auditDirRel}
  - Verify the finding is real and accurately described
  - If evidence does NOT support the claim: downgrade to medium or discard
  - Only items surviving verification proceed to Phase 3 or 4

Medium and low confidence items:
  - Record in the dream file under "Deferred Ideas" — do NOT write to memory or propose

════════════════════════════════════════════════════════════
PHASE 3 — MEMORY UPDATES (direct writes — no proposals)
════════════════════════════════════════════════════════════

Memory write gate — ALL 4 conditions must be true before writing:
  1. DURABLE — will this fact still matter weeks from now? (not today's ephemeral detail)
  2. NEW — not already present in equivalent meaning in USER.md, SOUL.md, or MEMORY.md
  3. EVIDENCED — either repeated signal (2+ thoughts) OR single verified strong signal
  4. ACTIONABLE — changes specific future behavior in a concrete way

Future Behavior Memory Test:
A memory is only useful if it changes future behavior. For every candidate, answer:
1. What future situation should trigger recall?
2. What should Prometheus do differently because of it?
3. Where is the best home: USER.md, SOUL.md, MEMORY.md, BUSINESS.md, entity file, skill, proposal, or nowhere?
4. What would make this stale or wrong later?
If you cannot answer these, do not write it as memory.

Contradiction and duplication check:
Before writing memory, search existing USER.md, SOUL.md, MEMORY.md, BUSINESS.md, and relevant entity files for contradiction, duplication, or older wording.
If new evidence conflicts with old memory, preserve both only if the distinction matters; otherwise update the older one.

If 0 items pass all 4 gates: write nothing to memory. This is normal.

For items that pass:
  - Edit USER.md for: user identity, preferences, projects, communication style, workflow rules
  - Edit SOUL.md for: Prometheus behavior rules, tool policies, operating constraints
  - Edit MEMORY.md for: durable long-term context, decisions, and historical through-lines
  - MEMORY.md gate is stricter: only cross-session durable facts/decisions; exclude intraday, ephemeral, and quickly-changing details
  - Be surgical: add or update specific entries; do not rewrite large sections
  - Record each write in the dream output under "Memory Updates Applied"

════════════════════════════════════════════════════════════
PHASE 4 — PROPOSALS (everything except memory)
════════════════════════════════════════════════════════════

Proposal quality gate — ALL 4 conditions must be true:
  1. CONCRETE — specific file, job, skill, or behavior to change (not vague)
  2. EVIDENCED — clear citation from a thought file or verified audit reference
  3. NOT DUPLICATE — no semantically equivalent proposal already in pending/ or proposals.md
  4. EXECUTOR-READY — executor_prompt has enough detail to implement without guesswork

${brainDreamProposalGuidance()}

${brainDreamProposalSubmitRules()}

If 0 proposals pass the gate: note this in the dream file. This is normal.

════════════════════════════════════════════════════════════
PHASE 5 — WRITE OUTPUTS
════════════════════════════════════════════════════════════

5a. Create directory ${dreamsDirRel} if needed.
    Write ${outFileRel}:

---
# Dream — ${dateStr}
_Generated: ${nowStr}_
_Thoughts synthesized: N_

## Day Summary
[2–3 paragraphs: high-level picture of the day's activity, behavior quality, and key themes]

## Memory Updates Applied
| Item | File | Change Made | Evidence |
|------|------|------------|---------|
| [item] | USER.md / SOUL.md / MEMORY.md | [what was added/updated] | [thought ref] |

_(If none: "None — no items passed the memory gate tonight.")_

## Proposals Generated
| # | Type | Title | Priority | ID |
|---|------|-------|----------|----|
| 1 | prompt_mutation | ... | high | prop_xxx |

_(If none: "None — no items passed the proposal gate tonight.")_

## Deferred Ideas
| Idea | Reason Deferred | Confidence | From |
|------|-----------------|-----------|------|
| [medium/low confidence items] | [insufficient evidence / duplicate / etc.] | medium | Thought 2 |

## Tomorrow's Watch Items
- [specific things to monitor in the next day's thoughts]
---

5b. REWRITE ${proposalsFileRel} completely (not append):

---
# Brain Proposal Ledger
_Last Updated: ${nowStr}_
_Dream Source: ${outFileRel}_

## Summary
- Thoughts synthesized: N
- Memory updates applied: N
- Proposals generated: N (High: N, Medium: N, Low: N)

## Proposal Queue

### 1) [Proposal title]
- **Type:** [type]
- **Priority:** high / medium / low
- **Confidence:** high / medium / low
- **Reason:** [why this was flagged, with evidence reference]
- **Status:** submitted
- **Proposal ID:** [id from write_proposal]
- **Affects:** [specific file / job name / skill name]
- **Expected impact:** [what concretely improves]

_(Repeat for each proposal. If none: write "No proposals generated tonight — all items were below the quality gate." )_

## Deferred Ideas
_(Items noticed but intentionally not proposed — insufficient confidence or evidence)_

| Idea | Reason | Confidence | First Seen |
|------|--------|-----------|-----------|
| ... | low evidence | medium | Thought 1 |
---

After all writes: print a plain-text summary of what was done tonight (memory updates, proposals created, deferred count).
`;
  }

  private _buildThoughtPromptV2(opts: {
    windowStart: Date;
    windowEnd: Date;
    dateStr: string;
    windowLabel: string;
    thoughtNumber: number;
    outFile: string;
  }): string {
    const { windowStart, windowEnd, dateStr, thoughtNumber, outFile } = opts;
    const wsStart = fmtUtc(windowStart);
    const wsEnd = fmtUtc(windowEnd);
    const nowStr = fmtLocal(new Date());
    const thoughtsDirRel = path.join('Brain', 'thoughts', dateStr);
    const businessCandidatesDirRel = path.join('Brain', 'business-candidates', dateStr);
    const businessCandidatesFileRel = path.join(businessCandidatesDirRel, 'candidates.jsonl');
    const skillEpisodesDirRel = path.join('Brain', 'skill-episodes', dateStr);
    const skillGardenerDirRel = path.join('Brain', 'skill-gardener', dateStr);
    const memNotesFileRel = path.join('memory', `${dateStr}-intraday-notes.md`);
    const auditDirRel = 'audit';
    const outFileRel = path.relative(this.deps.workspacePath, outFile);

    return `You are Prometheus, running an automated Brain Thought analysis.

BRAIN THOUGHT ${thoughtNumber} - Observation + Seed Capture
Window: ${wsStart} -> ${wsEnd}
Date: ${dateStr}
Output: ${outFileRel}

IMPORTANT - FILE PATH CONVENTION:
All paths in this prompt are relative to the workspace root.
Pass them directly to file tools without modification.
Do not prepend "workspace/" or any drive letter.

STRICT RULES:
- Do not write to USER.md, SOUL.md, or any memory files
- Do not call write_proposal or create any proposals
- Do not create new skills directly
- Do not update cron jobs, configs, or team state
- Your direct file writes are limited to the thought output file listed above, ${businessCandidatesFileRel} when business candidates exist, and the Active Work Ledger (Brain/active-work.jsonl)
- You may update an existing skill only through skill_manifest_write, skill_resource_write, or skill_update_metadata, after reading/inspecting that existing skill
- You may call skill_audit_all for a light fleet metadata scan, but Thought must not call skill_repair_metadata or perform broad/batch repairs
- Existing-skill updates must be low-risk, additive or narrowly corrective, evidence-backed, and scoped to triggers, metadata, SKILL.md guidance, examples, templates, schemas, or other skill resources
- Prefer skill_update_metadata for focused description/trigger/category/lifecycle metadata repairs; prefer skill_manifest_write or skill_resource_write for instruction/resource changes
- When calling skill_manifest_write, skill_resource_write, or skill_update_metadata, include evidence/appliedBy="brain_thought"/reason fields when the tool supports them so Dream can audit the skill change ledger
- You MAY read freely and do LIGHT research: read any workspace/project file, ${isPublicBrainProfile() ? 'and use web_search/web_fetch' : 'use read_source/grep_source/read_prom_file to inspect Prometheus\'s own code and tools, and use web_search/web_fetch'} to confirm the current state of an idea and scan for prior art. Keep research light (a couple of lookups); the Dream does the deep dive.

WHO YOU ARE THIS RUN:
You have the user's USER.md, SOUL.md, MEMORY.md, and today's notes in your system context. Use them. Reason like a second brain that already knows what this user is building and cares about: "they planned X with me — let me check whether it actually exists yet", "they added project Y to the workspace — let me look through it for bugs or half-finished work", "this tool keeps failing them — let me see what's actually wrong with it." Proactivity is the point: you do not need an explicit task to investigate something the user clearly cares about.

PRIMARY PURPOSE:
You are not just auditing for mistakes. You are acting like a proactive second brain. You are trying to notice:
- repeated workflows the user performed manually today that could become a skill, composite tool, browser teaching workflow, desktop workflow, or automation
- unfinished feature ideas the user mentioned but did not complete
- new agents, subagents, teams, or workspace surfaces that now deserve follow-up work
- latent opportunities where Prometheus could proactively help tomorrow, across any context: business, marketing, websites, apps, notifications, communications, code, research, content, or operations
- business operating signals that should become structured company/entity memory later: people, leads, clients, projects, vendors, social accounts, offers, policies, deadlines, outreach, payments, meetings, and other business events
- concrete next-step proposals the Dream could investigate into executor-ready plans
- "the user would probably appreciate if I got ahead on this" moments, even when they were not phrased as explicit tasks
- useful wonderings: thoughtful "I wonder if..." observations that may be seeds for future help, not only defects

CURRENT-STATE VERIFICATION (MANDATORY — this is the most important rule):
Separate two kinds of evidence for everything you flag:
- ORIGIN evidence: where the idea/bug/request came from (a chat, transcript, or note). This only PINS the item.
- CURRENT-STATE evidence: what the artifact actually does RIGHT NOW.
You must never flag something as unfinished, broken, or needed based only on the conversation. Before you record any opportunity/bug/seed as live, OPEN THE ACTUAL ARTIFACT TONIGHT — the file, the tool definition, the page, the project folder — and confirm the gap still exists and is still unhandled. Things move on: the user often fixes a bug with Claude/Codex/another tool, or finishes the feature, without doing it through Prometheus. Check the real current state (file contents, recent modification, the project's actual code). If current state shows it is already done or fixed, mark it RESOLVED and do NOT seed it for the Dream. A seed that survives a real current-state check is worth ten that were inferred from chat.

ACTIVE WORK LEDGER (Brain/active-work.jsonl):
This is the standing, memory-grounded list of things the user is actively working on or circling — it is what makes you proactive even on a day with no note. Read it first if it exists.
- For each live idea/project/bug you confirm (from today's activity AND from what MEMORY/USER tells you the user is building), upsert one JSONL row (one JSON object per line):
  {"id":"slug","title":"...","origin":"chat/transcript/note ref or 'memory'","diskPath":"workspace-relative or absolute allowed path, if it is a real project","status":"idea|drafted|in_progress|stalled|resolved","lastVerified":"${dateStr}","currentState":"what you actually observed in the artifact tonight","research":["url or finding"],"evidence":["path:line or ref"]}
- Update status to "resolved" (and say how you verified) when current-state shows it is already done/fixed.
- Keep entries concrete and grounded in current state; this ledger is what the Dream investigates and hardens into proposals.

STEP 1 - SCAN AUDIT WINDOW

Scan the audit directory for activity between ${wsStart} and ${wsEnd}.
Audit root: ${auditDirRel}

Priority scan order:
1. ${memNotesFileRel} - today's intraday notes if the file exists
2. ${auditDirRel}/chats/sessions/ - chat session snapshots
3. ${auditDirRel}/chats/transcripts/ - inspect transcripts for sessions that look feature-oriented, planning-heavy, or unfinished
4. ${auditDirRel}/tasks/ - task state snapshots
5. ${auditDirRel}/cron/runs/ - JSONL run history files filtered by timestamp
6. ${auditDirRel}/teams/ - team activity logs, new subagents, and manager outputs if present
7. ${auditDirRel}/proposals/ - proposal state changes if present
8. ${skillEpisodesDirRel}/episodes.jsonl - structured skill-use episodes if present
9. ${skillGardenerDirRel}/live-candidates.jsonl and workflow-episodes.jsonl - live skill gardener candidates captured during chat, if present

Selective reading strategy:
- List each directory first and identify the files that matter
- For JSONL files, extract only entries whose timestamps fall in the window
- Read selectively; you do not need every character
- When a session snapshot hints at a half-finished idea, planning discussion, new subagent, new website effort, or "we should build X", read the matching transcript before judging it
- If a directory is empty or no files fall in the window, note "no activity" and continue

STEP 2 - ANALYZE USING THE RUBRIC

For every finding, assign confidence (high, medium, low) and cite evidence.

A. Activity Summary
- What actually happened in this window
- Major user requests and what was asked
- Files written or changed
- Tasks completed or failed
- Scheduled jobs that ran
- Agents or teams that were invoked

B. Behavior Quality
- Where Prometheus acted well
- Where it stalled, looped, or took too many steps
- Over-tooling or under-tooling
- User corrections, re-prompts, or frustration signals
- Misunderstandings that required clarification

C. Skill And Workflow Signals
- Skills read or used in the window, with the user request, tool sequence, final response, and any error/rework signal from ${skillEpisodesDirRel}/episodes.jsonl when available
- Live skill gardener candidates from ${skillGardenerDirRel}, including candidate type, status, confidence, suggestedAction, and evidence
- Existing skills that may need updated triggers, clearer steps, examples, resource templates, or guardrails
- New repeatable workflows that seem skill-worthy because they appeared more than once, required many tools, or represent a reusable browser/desktop/file/code/business process
- Procedural "do this next time" learnings belong here, not in memory candidates
- Format as: Skill/Workflow | Signal | Possible Action | Confidence | Evidence

C2. Existing Skill Maintenance
- For high-confidence, low-risk updates to an existing skill, call skill_read first, then skill_inspect or skill_resource_list/read if useful
- Use skill_audit_all only as a light metadata scan when trigger/description/category quality is relevant to the window
- Apply the update during this Thought with skill_update_metadata, skill_manifest_write, or skill_resource_write only when the current skill clearly benefits from observed session evidence
- Prefer small additions: one missing trigger, one metadata correction, one troubleshooting guardrail, one compact example, one template/resource, or one corrected tool-order note
- Preserve imported/upstream-managed skills by using overlays or additive resources where possible
- Never split, delete, radically rewrite, or create skills in Thought
- If a new skill is warranted, record it as an Improvement Candidate for Dream instead of creating it
- After any skill write, verify with skill_read or skill_inspect
- In the thought file, explain exactly what you changed, why, and cite the session/transcript/skill episode/live candidate evidence so Dream can review it later

D. Business Candidates
- Business facts/events that may belong in BUSINESS.md or workspace/entities/*
- Use BUSINESS.md only for company-level identity, offers, policies, approval rules, priorities, and broad operating context
- Use entity files for clients/prospects, contacts/people, projects, vendors/tools, and social accounts
- Thought does not update BUSINESS.md or entity files. It only records candidates for Dream reconciliation.
- For high/medium confidence candidates, also write JSONL rows to ${businessCandidatesFileRel}. Use one JSON object per line with:
  {"timestamp":"ISO","date":"${dateStr}","source":"thought:${outFileRel}","confidence":"high|medium|low","action":"create_entity|update_entity|append_event|update_business_profile|suggest_skill","entityType":"client|project|vendor|contact|social","entityId":"slug-if-known","displayName":"Name if known","summary":"concise business fact or event","evidence":["path:line or transcript ref"],"sensitivity":"normal|private|external_action"}
- Do not write low-confidence rows to JSONL unless they are important enough for Dream to review; keep weak hunches only in the thought markdown.
- Format as: Candidate | Destination | Action | Confidence | Evidence

E. Memory Candidates
- Items that might be worthy of USER.md, SOUL.md, or MEMORY.md
- Only flag if durable and not clearly already captured
- Exclude procedural workflow instructions, skill usage improvements, tool-order recipes, and "when doing X, do Y" notes unless they are truly global operating rules
- Future Behavior Memory Test:
  A memory is only useful if it changes future behavior. For every candidate, answer:
  1. What future situation should trigger recall?
  2. What should Prometheus do differently because of it?
  3. Where is the best home: USER.md, SOUL.md, MEMORY.md, BUSINESS.md, entity file, skill, proposal, or nowhere?
  4. What would make this stale or wrong later?
  If you cannot answer these, do not write it as memory.
- Format as a table row: Item | Target file | Confidence | Evidence

F. Opportunity Seeds
- Capture unfinished or proactive opportunities the Dream should investigate
- This is the most important section when the user talked about something but did not finish it
- Include repeated manual workflows, partial feature ideas, new agents/subagents/teams created but not yet deployed, placeholder-heavy or underused workspace surfaces, business/marketing/product ideas, notification follow-ups, and concrete "Prometheus should probably help with this next" openings
- Prefer seeds that can become proposals, skills, composite tools, browser/desktop taught workflows, scheduled monitors, or one-shot task triggers
- Format as: Seed | Why it matters | Suggested scouting surface | Confidence | Evidence

G. Improvement Candidates
- Items that might be worthy of proposals
- Format as: Issue | Proposal type | Suggested execution mode | Confidence | Evidence
- Proposal types: ${brainThoughtProposalTypes()}
- Execution modes: ${brainThoughtExecutionModes()}

H. Window Verdict
- Active: yes / no
- Signal quality: high / medium / low / none
- Summary: short narrative brain note, 2-4 paragraphs. Put the real summary at the top of the final file, before section A.
- Wonder: include 1-3 natural "I wonder if..." thoughts. They can be speculative, but label uncertainty honestly and ground them in the day's signals.

STEP 3 - WRITE THE THOUGHT FILE

Create the output directory if needed: ${thoughtsDirRel}
Write the thought file to: ${outFileRel}

Use exactly this structure:

---
# Thought ${thoughtNumber} - ${dateStr} | Window: ${wsStart}-${wsEnd}
_Generated: ${nowStr}_

## Summary
[2-4 short paragraphs. Make this feel like an actual thought, not a report stub: summarize what happened, what it seems to mean, where the momentum or friction was, and include 1-3 natural "I wonder if..." observations. Keep it grounded; do not invent facts.]

## Pulse Cards
Write exactly 3 homepage Pulse cards that a user could click on the Prometheus new-chat screen.
These are proactive "you were circling this, want to dig in?" cards based on the user's chats and momentum.
They are not questions about the Brain Thought, not report summaries, and not citations of your analysis sections.
Choose card ideas from actual user-facing threads: things the user mentioned briefly, unfinished ideas, repeated interests, half-built features, follow-up-worthy creative/product/business/code directions, or practical next steps that naturally continue recent conversations.
Prefer cards that feel useful, timely, personal to the user's recent work with Prometheus, and editable, not alarmist or awkward.
Each card must:
- have a short, natural title under 52 characters
- have a clear body under 130 characters
- have a prompt that can be placed directly into the chat composer for the user to edit or send
- avoid phrases like "Brain Thought", "thought file", "Dream should", "audit window", "evidence", "section", raw citations, file paths, and internal jargon in title/body/prompt
- make the prompt grounded enough that Prometheus can verify current state before acting
- be based on actual chat/user evidence from this Thought; if the window has weak signal, use gentle review/planning cards instead of inventing work

Good card style examples:
- title: "Premium UI Microfeatures"
  body: "Small polish passes could make Prometheus feel more finished without a huge rebuild."
  prompt: "Let's dig into premium UI microfeatures for Prometheus based on the recent chat UI work. Review what changed recently, then suggest 5 small high-impact polish ideas and the best first one to implement."
- title: "Prompt Cache Next Steps"
  body: "A lightweight way to save winning prompts could turn repeated workflows into reusable tooling."
  prompt: "Let's explore a Prompt Cache feature for Prometheus. Ground it in recent chats and current workspace artifacts, then sketch the smallest useful version and how it would show up in the UI."
- title: "Opus 4.8 Showcase"
  body: "The model upgrade momentum could become a cleaner demo or launch asset."
  prompt: "Let's revisit the Opus 4.8 showcase idea from the recent Prometheus work. Check what exists now, then propose the cleanest next version or repair path."

Use this exact fenced JSON shape and no extra keys:

\`\`\`json
[
  {
    "title": "Short card title",
    "body": "One sentence describing why this is worth opening.",
    "prompt": "A complete, editable user prompt for Prometheus to act on or plan from."
  },
  {
    "title": "Short card title",
    "body": "One sentence describing why this is worth opening.",
    "prompt": "A complete, editable user prompt for Prometheus to act on or plan from."
  },
  {
    "title": "Short card title",
    "body": "One sentence describing why this is worth opening.",
    "prompt": "A complete, editable user prompt for Prometheus to act on or plan from."
  }
]
\`\`\`

## A. Activity Summary
[populate from your analysis]

## B. Behavior Quality
**Went well:**
- [item] | evidence: [ref]

**Stalled or struggled:**
- [item] | evidence: [ref]

**Tool usage patterns:**
- [observations]

**User corrections:**
- [observations, or "none observed"]

## C. Skill And Workflow Signals
| Skill/Workflow | Signal | Possible Action | Confidence | Evidence |
|----------------|--------|-----------------|-----------|---------|
| ... | [request + tool/final response signal] | update existing skill / propose new skill / no action | high/medium/low | [skill episode or transcript ref] |

_(Leave table with a single dash row if nothing found.)_

## C2. Existing Skill Maintenance
**Applied during this Thought:**
- [skill id] | [change made] | why: [reason] | evidence: [refs] | verification: [skill_read/skill_inspect result summary]

**Deferred for Dream review:**
- [skill/workflow] | [why deferred: new skill / too risky / insufficient evidence] | evidence: [refs]

_(Write "none" under either list if nothing belongs there.)_

## D. Business Candidates
| Candidate | Destination | Action | Confidence | Evidence |
|-----------|-------------|--------|-----------|---------|
| ... | BUSINESS.md or entities/[type]/[id].md | create_entity / update_entity / append_event / update_business_profile / suggest_skill | high/medium/low | [file ref] |

**Business candidate JSONL:** ${businessCandidatesFileRel} written / not needed

_(Leave table with a single dash row if nothing found.)_

## E. Memory Candidates
| Item | Target | Recall Trigger | Future Behavior | Staleness Risk | Confidence | Evidence |
|------|--------|----------------|-----------------|----------------|-----------|---------|
| ...  | USER.md or SOUL.md or MEMORY.md | [when this should be recalled] | [what Prometheus should do differently] | [what could make it wrong/stale] | high/medium/low | [file ref] |

_(Leave table with a single dash row if nothing found.)_

## F. Opportunity Seeds
| Seed | Why It Matters | Suggested Scouting Surface | Confidence | Evidence |
|------|----------------|----------------------------|-----------|---------|
| ...  | [why Dream should care tomorrow] | [${brainOpportunitySurfaceExample()}] | high/medium/low | [ref] |

_(Leave table with a single dash row if nothing found.)_

## G. Improvement Candidates
| Issue | Proposal Type | Suggested Execution Mode | Confidence | Evidence |
|-------|---------------|--------------------------|------------|---------|
| ...   | ${brainThoughtProposalTypesExample()} | ${brainThoughtExecutionModesExample()} | high/medium/low | [ref] |

_(Leave table with a single dash row if nothing found.)_

## H. Window Verdict
**Active:** yes/no
**Signal quality:** high/medium/low/none
**Summary:** [1-2 sentence factual recap; the richer narrative belongs in the top Summary section]
---

After the file is written: confirm the write succeeded and stop. Do not do anything else.
`;
  }

  private _buildDreamCleanupPromptV2(opts: {
    dateStr: string;
    outFile: string;
  }): string {
    const { dateStr, outFile } = opts;
    const nowStr = fmtLocal(new Date());
    const outFileRel = path.relative(this.deps.workspacePath, outFile);
    const dreamsDirRel = path.join('Brain', 'dreams', dateStr);
    const userMdFileRel = 'USER.md';
    const soulMdFileRel = 'SOUL.md';
    const memoryMdFileRel = 'MEMORY.md';
    const latestDreamDirRel = path.join('Brain', 'dreams', dateStr);

    return `You are Prometheus, running the second Brain Dream pass: the memory solidifier and skill curator critic.

BRAIN DREAM CLEANUP - Memory Solidifier + Skill Curator Critic
Date: ${dateStr}
Time: ${nowStr}
Output: ${outFileRel}

IMPORTANT - FILE PATH CONVENTION:
All paths in this prompt are relative to the workspace root.
Pass them directly to file tools without modification.
Do not prepend "workspace/" or any drive letter.

STRICT RULES:
- This pass runs after the nightly dream has already updated memory.
- Do not create proposals.
- Do not create new skills.
- Do not add new memories, new facts, new preferences, or new sections to USER.md, SOUL.md, or MEMORY.md.
- You may only remove, lightly merge, or dedupe text that is clearly redundant, stale, contradictory, or unimportant after the latest dream.
- If the memory is already good, make no memory edits. This is a successful outcome.
- When uncertain, preserve the memory. It is better to leave a duplicate than erase something important.
- You may audit recent Brain Skill Curator suggestions, auto-applied low-risk skill resources, and fleet metadata health.
- You may call skill_audit_all to detect metadata regressions and skill_repair_metadata mode="preview" to inspect possible repairs, but cleanup must not call skill_repair_metadata mode="apply".
- You may reject weak pending curator suggestions, delete/revert clearly bad auto-applied curator resources, or refine an auto-applied resource only when the fix is obvious and strictly improves the same lesson.
- Do not rewrite SKILL.md, archive/merge/delete skills, apply bulk metadata repairs, or make broad skill changes in cleanup.
- Your only required write is the cleanup report at ${outFileRel}. Memory and skill cleanup edits are optional and conservative.

STEP 1 - READ CURRENT MEMORY
Read:
- ${userMdFileRel}
- ${soulMdFileRel}
- ${memoryMdFileRel}

Also list and read the latest main dream artifact in ${latestDreamDirRel} so you understand what was just added or updated.

STEP 2 - LIGHT MEMORY DEDUPE / CLEANUP REVIEW
Look only for:
- exact or near-exact duplicate bullets
- obsolete wording directly contradicted by newer memory nearby
- tiny one-off details that slipped into durable memory and are not useful weeks from now
- duplicated operational rules where one clearer version can safely remain
- memories that no longer pass the Future Behavior Memory Test because they do not change future behavior, have no clear recall trigger, belong in a skill/proposal/entity instead, or became stale/wrong
- USER.md, SOUL.md, MEMORY.md, BUSINESS.md, or entity-file wording that conflicts with newer evidence; preserve both only if the distinction matters, otherwise keep or update the newer/more accurate version

Do not perform broad rewrites. Do not polish prose for style alone. Do not compress nuanced memories into vague summaries.

STEP 3 - SKILL CURATOR CRITIC REVIEW
Run:
- skill_curator action=status

Review the current skill curator queue, daily skill-change audit, and recent applied suggestions. Focus on suggestions created/applied by the Brain Skill Curator plus review-only audit items for normal Prometheus/Thought/Dream skill changes, especially:
- lessonType=recovery, style_pattern, component_recipe, workflow_recipe, trigger_patch, instruction_patch
- status=applied or pending
- autoApplyEligible=true
- autoDecisionReason indicating automatic application or legacy rejection
- review_only items for new skills, direct Prometheus/manual edits, destructive deletes, missing evidence, or broad SKILL.md rewrites

For every reviewed curator item, judge it as one of:
- accept: useful, specific, routed to the right skill, evidence-backed
- reject: pending item is weak, generic, transcript-like, not actionable, or not routed to the right skill
- revert: applied item pollutes the skill, duplicates existing guidance, is too broad, or maps the wrong failure to the wrong behavior
- refine: applied item is directionally useful but needs a clearer future trigger, learned behavior, avoid note, or narrower wording
- needs_review: potentially high-risk, uncertain, broad rewrite, archive/merge/new-skill candidate, or anything you cannot safely judge

Quality gate for curator lessons:
1. FUTURE BEHAVIOR - it says what Prometheus should do differently next time
2. FUTURE TRIGGER - it says when to use the lesson
3. RIGHT SKILL - it belongs in the target skill, not just the skill that happened to be read
4. EVIDENCED - it cites Brain/audit/session evidence or a concrete observed failure/recovery
5. NOT RAW LOG - it is not mainly a request excerpt, outcome excerpt, or tool list
6. SAFE SCOPE - it is additive or narrowly corrective; no broad rewrites here

Allowed skill critic actions:
- To inspect: skill_read, skill_inspect, skill_resource_list, skill_resource_read, skill_audit_all, skill_repair_metadata mode="preview"
- To reject a bad pending item: skill_curator action=reject id=<suggestion id>
- To revert a bad applied resource: skill_resource_delete id=<skill id> path=<resource path>, then skill_curator action=reject id=<suggestion id>
- To refine an applied resource: skill_resource_read, then skill_resource_write to the same path with clearer content and the same lesson scope

Do not apply pending high-risk suggestions. Do not create a new skill. Do not delete anything except an auto-applied curator resource that clearly fails the quality gate. Do not apply bulk metadata repair previews from cleanup; record them for the next Dream.

STEP 4 - OPTIONAL MEMORY/SKILL EDITS
If and only if an edit is clearly safe:
- Use replace_lines, find_replace, or delete_lines surgically.
- Prefer removing the weaker duplicate and keeping the more specific, more recent, or more actionable version.
- Do not use insert_after unless it is only to repair formatting after removing text.
- For skill resources, prefer skill_resource_delete for a bad auto-applied resource or skill_resource_write to refine the same resource path.

STEP 5 - WRITE CLEANUP REPORT
Create directory ${dreamsDirRel} if needed.
Write ${outFileRel} with this structure:

---
# Dream Cleanup - ${dateStr}
_Generated: ${nowStr}_

## Cleanup Summary
[1-3 short paragraphs. Say whether memory was already solid or what small cleanup happened.]

## Memory Edits
| File | Action | Reason |
|------|--------|--------|
| USER.md / SOUL.md / MEMORY.md | removed/deduped/none | [why this was safe] |

_(If no edits: "None - memory already looked solid enough to preserve as-is.")_

## Skill Curator Critic
| Suggestion | Skill | Decision | Action Taken | Reason |
|------------|-------|----------|--------------|--------|
| sc_... / title | skill-id | accept/reject/revert/refine/needs_review | none / rejected / deleted resource / rewrote resource | [quality-gate reason] |

_(If no curator items needed action: "Reviewed curator state; no skill cleanup needed.")_

## Fleet Metadata Regression Check
| Check | Result | Action |
|-------|--------|--------|
| skill_audit_all / skill_repair_metadata preview | [flag count, target skills, or none] | deferred to Dream / no action |

## Preserved On Purpose
- [Any duplicate-looking or messy item you intentionally kept because it may still matter, or "None noted."]
---

After writing the cleanup report, print a plain-text summary and stop.
`;
  }

  private _buildDreamPromptV2(opts: {
    dateStr: string;
    dreamLabel: string;
    thoughtCount: number;
    outFile: string;
  }): string {
    const { dateStr, thoughtCount, outFile } = opts;
    const nowStr = fmtLocal(new Date());
    const thoughtsDirRel = path.join('Brain', 'thoughts', dateStr);
    const businessCandidatesDirRel = path.join('Brain', 'business-candidates', dateStr);
    const businessCandidatesFileRel = path.join(businessCandidatesDirRel, 'candidates.jsonl');
    const businessReconciliationDirRel = path.join('Brain', 'business-reconciliation', dateStr);
    const skillEpisodesDirRel = path.join('Brain', 'skill-episodes', dateStr);
    const skillGardenerDirRel = path.join('Brain', 'skill-gardener', dateStr);
    const dreamsDirRel = path.join('Brain', 'dreams', dateStr);
    const proposalsFileRel = path.join('Brain', 'proposals.md');
    const userMdFileRel = 'USER.md';
    const soulMdFileRel = 'SOUL.md';
    const memoryMdFileRel = 'MEMORY.md';
    const pendingPropsDirRel = path.join('proposals', 'pending');
    const auditDirRel = 'audit';
    const outFileRel = path.relative(this.deps.workspacePath, outFile);

    return `You are Prometheus, running an automated Brain Dream - the nightly synthesis and execution run.

BRAIN DREAM - Nightly Synthesis + Execution
Date: ${dateStr}
Time: ${nowStr}
Thoughts available: ${thoughtCount}
Outputs:
- ${outFileRel}
- ${proposalsFileRel} (rewrite as the post-day summary)

Treat ${dateStr} as the target date for this run, even if the current clock is now on a later day.

IMPORTANT - FILE PATH CONVENTION:
All paths in this prompt are relative to the workspace root.
Pass them directly to file tools without modification.
Do not prepend "workspace/" or any drive letter.

You have 8 phases tonight. Execute them in order.

OPERATING POSTURE:
Act like the user's proactive second brain. The best dream is not just "what failed today"; it notices what the user is trying to become faster at, what they repeated manually, where they are building momentum, and what they would likely appreciate waking up to as approval-ready help. Look across all contexts: business, marketing, websites, apps, notifications, email/follow-up, code, content, research, operations, and personal workflow.

The dream should contain a little wonder. Use a few grounded "I wonder if..." observations where appropriate. These are allowed to be speculative as long as they are clearly framed as wonderings and tied to evidence.

PHASE 1 - LOAD THE TARGET DATE'S THOUGHTS

List directory: ${thoughtsDirRel}
Read all *-thought.md files found there.

Also load for context:
- ${userMdFileRel}
- ${soulMdFileRel}
- ${memoryMdFileRel}
- BUSINESS.md
- ${proposalsFileRel}

List workspace/entities if present. Use list_entities to summarize existing clients, contacts, projects, vendors, and social accounts. Read only the entity files that are relevant to business candidates, current tasks, or repeated business workflows.

List ${businessCandidatesDirRel}. If ${businessCandidatesFileRel} exists, read it. This is the structured Business Brain evidence captured by Thought: candidate people, leads/clients, projects, vendors, social accounts, company profile updates, business events, and business workflow skill opportunities.

List ${skillEpisodesDirRel}. If ${skillEpisodesDirRel}/episodes.jsonl exists, read it. This is the structured skill gardener evidence for the target date: skills read, request excerpts, tool sequences, final responses, errors, touched paths, and outcome hints.

List ${skillGardenerDirRel}. If live-candidates.jsonl or workflow-episodes.jsonl exists, read them. These are always-on skill gardener signals captured during normal chat: reusable workflows, candidate skill updates, candidate resources/templates, missing trigger signals, lifecycle status, confidence, risk, and evidence.

List ${pendingPropsDirRel} to see what formal proposals are currently pending approval.

ACTIVE WORK LEDGER (Brain/active-work.jsonl): if it exists, read it. This is the standing list of what the user is actively building or circling, maintained by Thought. It is a primary driver of tonight's work — investigate every NON-resolved entry even if no thought today mentioned it. You also have USER.md/SOUL.md/MEMORY.md in context; use them to decide which of the user's projects deserve a proactive look-through tonight.
${brainDreamSourceEvidenceTools()}

If no thought files exist in ${thoughtsDirRel}:
- Note "no thoughts available" in the dream file
- STILL drive off the Active Work Ledger and what MEMORY/USER tells you the user is building — a quiet day is not a reason to skip proactive investigation
- Still check ${skillEpisodesDirRel}/episodes.jsonl if present
- Still check ${skillGardenerDirRel}/live-candidates.jsonl and workflow-episodes.jsonl if present
- Skip only a phase that genuinely has no evidence from thoughts, the ledger, or memory
- Still write the dream file and proposals.md

PHASE 2 - CROSS-EXAMINE + RE-VERIFY CURRENT STATE

For any item marked high confidence in sections C, D, E, F, or G of any thought, any high-confidence row in ${businessCandidatesFileRel}, and every non-resolved Active Work Ledger entry:
- Read the cited origin evidence from ${auditDirRel} to confirm it is real and accurately described.
- THEN RE-VERIFY CURRENT STATE TONIGHT (mandatory). Open the actual live artifact — the file, the tool/code, the project folder, the page, the thread — and confirm the gap/bug/missing-feature STILL exists and is STILL unhandled right now. The Thought may be hours old and the world moves: the user frequently fixes a bug or finishes a feature with another tool (Claude, Codex, manual edits) without going through Prometheus. Use file reads, ${isPublicBrainProfile() ? 'web_fetch' : 'read_source/grep_source/read_prom_file'}, and recent-modification signals to check.
- If current state shows it is already done/fixed/handled: discard it, update its ledger entry to status "resolved" with how you verified, and do NOT propose it. This single check is what prevents stale proposals — do not skip it.
- If evidence does not support the claim, downgrade or discard it.
- Only items that survive BOTH origin verification AND a fresh current-state check proceed to later phases.

Medium and low confidence items:
- Record them in the dream file under "Deferred Ideas"
- Do not write them to memory or propose them yet

When a verified opportunity seed points to a partially-finished idea or a newly-created but idle agent, subagent, or workspace surface, treat that as a first-class signal, not a side note.

PHASE 3 - BUSINESS RECONCILIATION

Use BUSINESS.md, list_entities/read_entity, and ${businessCandidatesFileRel} to reconcile business operating memory.

Business routing:
- BUSINESS.md is the generic per-user business profile. It should contain company-level identity, offers, services/products, policies, approval thresholds, priorities, team/tool/vendor overview, and important dates.
- workspace/entities/clients stores clients, prospects, accounts, companies, and organizations the business deals with.
- workspace/entities/contacts stores people.
- workspace/entities/projects stores workstreams, engagements, campaigns, deliverables, and internal business projects.
- workspace/entities/vendors stores tools, suppliers, SaaS, contractors, APIs, and service providers.
- workspace/entities/social stores social accounts/platform strategies/results.

Reconciliation gate:
1. HIGH CONFIDENCE - clear source evidence from thoughts, transcript, team/task logs, or candidates JSONL
2. NON-SENSITIVE - not a raw credential, private secret, medical/legal/financial secret, or uncertain personal detail
3. NOT DUPLICATE - not already present in equivalent form in BUSINESS.md or the entity file
4. RIGHT HOME - company-level facts go to BUSINESS.md; object/history facts go to entity files

Actions:
- For high-confidence entity events, call append_entity_event(type,id,event,display_name,source,confidence).
- For high-confidence new entities with enough identity context, create them via append_entity_event first; this safely starts from the template and records the event.
- For durable company-level facts, update BUSINESS.md surgically with file tools.
- For ambiguous, private, external-action, or low/medium-confidence candidates, do not write. Record them under "Business Updates Needing Review" or "Deferred Ideas".
- For repeatable business workflows, route them to Skill Gardener review as business workflow skill signals rather than memory pollution.

Write a short reconciliation report to ${businessReconciliationDirRel}/report.md if any business candidates were reviewed. Use mkdir/write_file. Include applied updates, skipped candidates, and entity files touched.

PHASE 4 - SKILL GARDENER REVIEW

Use the thought Skill And Workflow Signals, ${skillEpisodesDirRel}/episodes.jsonl, and ${skillGardenerDirRel}/live-candidates.jsonl + workflow-episodes.jsonl to decide whether today's work should improve existing skills or create new ones.

Fleet metadata lane:
- Start with skill_audit_all when skill metadata quality, trigger coverage, or discovery quality is relevant to today's evidence
- Use skill_repair_metadata with mode="preview" to inspect possible bulk repairs before applying anything
- Only call skill_repair_metadata with mode="apply" and confirm=true for a curated repair list you have reviewed; never blindly apply the whole preview set
- Use skill_update_metadata for one or a few targeted existing skills when description, triggers, categories, required tools, lifecycle, or name need repair
- Preserve precise trigger phrasing: descriptions should start with "Use this skill when..." and triggers should include concrete user-language phrases that should surface the skill
- Record fleet audit counts, repair previews reviewed, metadata updates applied, and skipped/deferred repairs in the Dream output

Business workflow skill lane:
- Treat repeated business workflows as first-class skill candidates: lead qualification, prospect research, outreach packet creation, quote/invoice/follow-up drafting, customer support handling, vendor research, project status reporting, social planning, content calendar work, website audits, CRM hygiene, and industry-specific operating workflows.
- Decide whether the workflow should update an existing generic skill, add a reusable resource/template, or become a new business workflow skill proposal.
- Keep entity facts in entities/BUSINESS.md and procedural "how to do this workflow" knowledge in skills.

Thoughts may already have applied low-risk existing-skill maintenance. Treat those edits as first-class items to audit:
- Read each Thought's "Existing Skill Maintenance" section
- For every skill changed by a Thought, call skill_read or skill_inspect and review recent change history
- Accept the Thought's update by keeping it as-is only if it is useful, scoped, evidenced, and not redundant
- Modify/refine the skill if the Thought update is helpful but too broad, unclear, misplaced, or missing important constraints
- Remove or supersede the update only when it pollutes the skill, duplicates existing guidance, or does not help future workflows
- Record the audit decision in the Dream output as accepted, modified, removed/superseded, or deferred, with evidence

For each skill episode:
- Identify the skillId, requestExcerpt, toolSequence, finalResponseExcerpt, errors, touchedPaths, and outcomeHints
- Call skill_read for the skillId before proposing an update so the proposal is based on the current skill, not only the episode excerpt
- Use skill_inspect and skill_resource_list/read when metadata or bundled resources matter
- Review lifecycle and ownership metadata from skill_inspect: lifecycle, ownership, status, manifestSource, provenance, validation, resources, and recent change history if present
- Compare the current skill to what actually happened in the session
- Look for missing triggers, unclear instructions, missing examples, missing templates/resources, tool-order mistakes, repeated errors, or user corrections
- Aggregate repeated candidate signals across today's thoughts and episodes. Stronger signals include repeated use across days, explicit user correction, positive user feedback, skill was read but ignored, skill caused wrong tool order, skill trigger matched too broadly, or skill_list found a relevant skill but no skill_read followed.

For each live candidate:
- Identify type, status, confidence, risk, suggestedAction, toolSequence, outcomeHints, and evidence
- Treat update_existing_skill, add_resource_or_template, and add_trigger as candidate existing-skill maintenance
- Treat create_new_skill_candidate as a possible new skill proposal, but verify against existing skills first
- Treat no_action_but_record_episode as raw evidence only unless repeated patterns make it stronger
- Prefer high-confidence, low-risk candidates for automatic existing-skill updates; defer medium/low confidence items unless corroborated by thoughts, episodes, or transcripts

Route learnings carefully:
- If the learning is "when using this workflow, do X" and an existing skill fits, update that skill automatically
- If it is a repeated tool choreography with no good skill, prefer a skill_evolution proposal that creates a new bundled skill
- If it is a global Prometheus behavior rule independent of any skill, consider prompt_mutation or SOUL.md
- If it is a durable user/project fact, consider memory
- If it is only a one-off task, consider task_trigger or defer

Automatic existing-skill evolution gate:
1. EXISTING - the target skill already exists and was inspected with skill_read
2. SPECIFIC - names the exact existing skill id and resource path to edit
3. EVIDENCED - cites skill episode(s), thought rows, transcripts, or audit files
4. BOUNDED - improves triggers, metadata, SKILL.md guidance, examples, templates, schemas, or other resources without changing unrelated behavior
5. SAFE - preserves upstream/downloaded content where appropriate by using skill_manifest_write overlays or narrowly scoped skill_resource_write updates

Skill lifecycle metadata:
- lifecycle should be one of: draft, active, experimental, deprecated, archived
- status should remain ready, needs_setup, or blocked
- ownership should describe how to treat the skill: local, imported, upstream-managed, or prometheus-owned-overlay
- Imported/upstream-managed skills should usually receive Prometheus-owned manifest overlays or additive resources instead of broad rewrites
- Mark newly observed but uncertain existing skills experimental only when the skill already exists and the evidence shows it needs trial refinement
- Mark stale, replaced, or unsafe skills deprecated/archived only with strong evidence; otherwise defer

For existing skill updates:
- Apply the update automatically tonight with skill_update_metadata, skill_resource_write, or skill_manifest_write
- Do not write a proposal for existing-skill maintenance
- Keep edits small, evidence-backed, and directly tied to observed workflow friction, repeated success patterns, or fleet metadata audit findings
- After writing, call skill_read, skill_inspect, or skill_audit_all scoped to the target skill when appropriate to verify the updated skill is visible and scored correctly
- When calling skill_resource_write, skill_manifest_write, or skill_update_metadata, include changeType/evidence/appliedBy="brain_dream"/reason fields when the tool supports them so the skill change ledger is useful
- The skill manager will snapshot the skill before writing and append the change ledger automatically where supported; verify the update by inspecting the skill afterward
- Record the automatic update in the Dream output under "Skill Gardener Review" and "Skill Updates Applied"
- If the update would delete resources, split a skill, radically rewrite a skill, or otherwise feels high-risk, defer it instead of proposing a routine evolution

For a new skill proposal:
- type must be skill_evolution
- affected_files should reference "skill:<new-skill-id>/SKILL.md" and any planned resources
- details should include the proposed id, name, description, triggers, categories, permissions, required tools, and a draft SKILL.md outline
- prefer skill_create_bundle when resources, examples, schemas, or templates would help; use skill_create only for a simple one-file playbook
- New skill creation is Dream-only and proposal-based: automatically write a skill_evolution proposal when the proposal quality gate passes
- Do not wait for separate user approval to file the proposal; approval is only required later to execute/create the proposed new skill

Do not create new skills directly. New skill creation must go through a skill_evolution proposal and wait for approval.

PHASE 5 - INCUBATE OPPORTUNITY SEEDS (and the Active Work Ledger)

Work through every verified opportunity seed AND every non-resolved Active Work Ledger entry. For each:
- Scout the surface directly before deciding what to propose — read the actual ${brainIncubationFileTargets()}, including the user's own project files when the ledger points to one (workspace path or configured allowed path).
- DEEP RESEARCH (this is your nightly advantage): use web_search/web_fetch (and browser_open + browser_get_page_text for JS-heavy pages) to research the idea properly — competitors and why they succeed, reusable open-source projects or libraries that could accelerate it, prior art, and how others solved the same problem. Capture concrete links and findings.
- Confirm current state one more time if the seed is build-shaped: the gap/bug must still be present in the live artifact before you propose a fix.
- Turn vague intent into a concrete morning-ready proposal only if the evidence supports it. Action proposals must carry the hardened contract (What you asked for / Current state / Research / Plan / Acceptance criteria / Risks). Put the research links and the confirmed current-state observation directly in the proposal so the user can approve it safely at a glance.
- Update the ledger entry: set status (in_progress once a proposal is filed, or resolved if current state shows it is already done), refresh lastVerified, and record the research you did.

Also look for repeated workflows across the thoughts even if no single thought named them as an opportunity. If the user did a similar task multiple times, consider whether Prometheus should propose:
- a new skill
- a composite tool
- a browser teach-mode workflow
- a desktop workflow
- a monitor or notification-to-action flow
- a one-shot task that gets ahead of likely next work

Incubation heuristics:
1. PARTIAL FEATURE IDEA
   ${brainPartialFeatureHeuristic()}
2. NEW AGENT OR SUBAGENT
   If a new agent, subagent, or team was created or configured, inspect its team files, manager outputs, related workspace surfaces, and nearby code. Look for concrete work it could own next.
3. PLACEHOLDER OR NEGLECTED SURFACE
   If a website, page, feature area, or workspace surface appears placeholder-heavy or half-built, inspect the real files and propose the next shippable improvement batch.
4. LATENT USER INTENT
   If the user clearly wants momentum but did not explicitly assign a task, prefer a proposal that packages the next step for approval rather than waiting for the user to restate it tomorrow.
5. NOTIFICATION OR EXTERNAL EVENT FOLLOW-UP
   If the logs show Prometheus noticed a notification, message, lead, business event, or other external signal, consider whether an approval-ready proposal should draft a response, email someone, schedule a follow-up, create a research task, or automate the recurring pattern.
6. PRODUCT/WEBSITE/APP IMPROVEMENT
   If the user was building a website or app, inspect the relevant files or browser-hosted surface when available and propose concrete UX, content, reliability, or launch-readiness improvements when evidence supports them.

Do not hallucinate work. Every incubated proposal still needs concrete evidence from current files, skill episodes, or audit history.

PHASE 6 - MEMORY UPDATES

Memory write gate - all 4 conditions must be true:
1. DURABLE - the fact will still matter weeks from now
2. NEW - it is not already present in equivalent meaning in USER.md, SOUL.md, or MEMORY.md
3. EVIDENCED - repeated signal or one strongly verified signal
4. ACTIONABLE - it should concretely change future behavior

Future Behavior Memory Test:
A memory is only useful if it changes future behavior. For every candidate, answer:
1. What future situation should trigger recall?
2. What should Prometheus do differently because of it?
3. Where is the best home: USER.md, SOUL.md, MEMORY.md, BUSINESS.md, entity file, skill, proposal, or nowhere?
4. What would make this stale or wrong later?
If you cannot answer these, do not write it as memory.

Contradiction and duplication check:
Before writing memory, search existing USER.md, SOUL.md, MEMORY.md, BUSINESS.md, and relevant entity files for contradiction, duplication, or older wording.
If new evidence conflicts with old memory, preserve both only if the distinction matters; otherwise update the older one.

If nothing passes, write nothing to memory.

Memory routing rule:
- Do not write procedural workflow instructions, skill usage improvements, tool-order recipes, or "when doing X, do Y" notes to USER.md, SOUL.md, or MEMORY.md by default
- Route those to automatic existing-skill updates when they fit an installed skill, or to new-skill proposals when no suitable skill exists
- This is important: skill learning should improve skills, not pollute durable memory

For items that do pass:
- Edit USER.md for user identity, preferences, projects, communication style, and workflow rules
- Edit SOUL.md for Prometheus behavior rules, tool policies, and operating constraints
- Edit MEMORY.md for durable long-term context and decisions
- Be surgical and record each write in the dream output under "Memory Updates Applied"

PHASE 7 - PROPOSALS

Proposal quality gate - all 4 conditions must be true:
1. CONCRETE - specific file, job, skill, agent, or behavior to change
2. EVIDENCED - clear citation from a thought file or verified audit${isPublicBrainProfile() ? '' : ' or source'} reference
3. NOT DUPLICATE - no semantically equivalent proposal already pending or already in the ledger
4. EXECUTOR-READY - the executor prompt has enough detail to implement without guesswork

Proposal handoff rule:
- A proposal is the implementation plan. Approval means "execute this plan", not "approve this idea and figure it out later".
- Do not submit proposals whose details only explain benefits, intent, or expected impact.
- Every proposal must say exactly what to create, edit, delete, inspect, or verify. If you cannot produce that plan from current evidence, defer the idea instead of proposing it.

This phase is not limited to "fix what went wrong."
Strong proposals can also come from:
- unfinished feature requests mentioned in chat
- repeated manual workflows that should become skills or composite tools
- skill episodes showing a skill should be improved, split, given examples/templates, or created
- proactive follow-through for new agents, subagents, or teams
- real product or workspace opportunities discovered during incubation
- business, marketing, sales, communication, website, or app ideas that would help the user move faster
- external events or notifications Prometheus can turn into useful drafts, follow-ups, or automations
- planned content or workspace work that is clearly blocked only by the user not having time yet

${brainDreamProposalGuidance()}

${brainDreamProposalSubmitRules()}

If zero proposals pass the gate, note that in the dream file.

PHASE 8 - WRITE OUTPUTS

8a. Create directory ${dreamsDirRel} if needed.
Write ${outFileRel} with this structure. Use \`mkdir\` for the directory and \`write_file\` for the markdown artifact:

---
# Dream - ${dateStr}
_Generated: ${nowStr}_
_Thoughts synthesized: N_

## Day Summary
[3-5 short paragraphs written like a thoughtful day-story rather than a report stub. Put the real summary first: what the day felt like, what moved, what dragged, what Prometheus noticed about the user's momentum, and what proactive openings seem worth waking up to. Include 1-3 grounded "I wonder if..." observations. The wonder can be small or unrelated to proposals, but it should feel like the brain is actually thinking. Do not change any other section formatting.]

## Memory Updates Applied
| Item | File | Recall Trigger | Future Behavior | Staleness Risk | Change Made | Evidence |
|------|------|----------------|-----------------|----------------|-------------|---------|
| [item] | USER.md / SOUL.md / MEMORY.md | [when this should be recalled] | [what Prometheus should do differently] | [what could make it wrong/stale] | [what was added or updated] | [thought ref] |

_(If none: "None - no items passed the memory gate tonight.")_

## Business Reconciliation
| Candidate | Destination | Change Made | Evidence |
|-----------|-------------|-------------|---------|
| [item] | BUSINESS.md or entities/[type]/[id].md | updated / appended event / skipped | [thought/candidate/audit ref] |

**Business report:** ${businessReconciliationDirRel}/report.md written / not needed

## Business Updates Needing Review
| Candidate | Reason Review Is Needed | Suggested Destination | Evidence |
|-----------|-------------------------|-----------------------|---------|
| [item or None] | ambiguous / sensitive / low confidence / duplicate risk | BUSINESS.md or entity path | [ref] |

## Proposals Generated
| # | Type | Title | Priority | ID |
|---|------|-------|----------|----|
| 1 | prompt_mutation | ... | high | prop_xxx |

_(If none: "None - no items passed the proposal gate tonight.")_

## Skill Gardener Review
| Skill/Workflow | Evidence | Current Skill Inspected | Outcome |
|----------------|----------|-------------------------|---------|
| [skill id or new workflow] | [skill episode/thought/audit ref] | yes/no/not applicable | auto-updated / proposed new skill / deferred / no change |

## Thought Skill Updates Audited
| Skill | Thought Change | Dream Decision | Evidence |
|-------|----------------|----------------|---------|
| [skill id or None] | [what Thought wrote] | accepted / modified / removed-superseded / deferred | [thought + skill ledger refs] |

## Skill Updates Applied
| Skill | Resource/Manifest | Change Made | Evidence |
|-------|-------------------|-------------|---------|
| [skill id] | metadata overlay / SKILL.md / skill.json overlay / resource path | [what Dream updated or what Thought update was accepted] | [skill episode/thought/audit ref] |

## Fleet Skill Metadata Audit
| Scan/Repair | Count Or Scope | Decision | Evidence |
|-------------|----------------|----------|---------|
| [skill_audit_all / skill_repair_metadata preview/apply / targeted skill_update_metadata] | [flag count or skill ids] | applied / partially applied / deferred / no action | [tool result or audit ref] |

_(If none: "None - no existing skills needed automatic evolution tonight.")_

## Opportunity Incubation
| Seed | Surfaces Inspected | What The Dream Learned | Outcome |
|------|--------------------|------------------------|---------|
| [seed] | [files or areas inspected] | [current-state summary] | proposed or deferred |

## Deferred Ideas
| Idea | Reason Deferred | Confidence | From |
|------|-----------------|-----------|------|
| [medium or low confidence items] | [insufficient evidence / duplicate / etc.] | medium | Thought 2 |

## Tomorrow's Watch Items
- [specific things to monitor in the next day's thoughts]
---

8b. Rewrite ${proposalsFileRel} completely. This file is not just a proposal ledger anymore; it is the user's morning-readable, full post-day Dream summary after memory updates, business reconciliation, skill gardener review, investigation/incubation, and proposal generation are complete. Use \`write_file\` so the existing file is replaced in full.

---
# Brain Daily Summary - ${dateStr}
_Last Updated: ${nowStr}_
_Dream Source: ${outFileRel}_

## Day Story
[5-9 paragraphs in the same thoughtful, narrative style as the thought files. Cover what the thoughts noticed, what the dream verified, what the day seemed to mean, what moved, what dragged, where the user had momentum, and what Prometheus learned after investigating. This should be readable as the full post-day account, not a terse queue. Include 1-3 grounded "I wonder if..." observations.]

## What The Thoughts Noted
- [Specific signals from Thought 1 with evidence]
- [Specific signals from Thought 2 with evidence]
- [Specific signals from Thought 3 with evidence]

## What The Dream Verified
- [High-confidence item]: checked [surface/evidence], concluded [result]

## Business Reconciliation
| Candidate | Destination | Change Made | Evidence |
|-----------|-------------|-------------|---------|
| [item or None] | BUSINESS.md or entities/[type]/[id].md | updated / appended event / skipped | [thought/candidate/audit ref] |

## Business Updates Needing Review
| Candidate | Reason Review Is Needed | Suggested Destination | Evidence |
|-----------|-------------------------|-----------------------|---------|
| [item or None] | ambiguous / sensitive / low confidence / duplicate risk | BUSINESS.md or entity path | [ref] |

## Skill Gardener Review
| Skill/Workflow | Evidence | What The Dream Learned | Outcome |
|----------------|----------|------------------------|---------|
| [skill id or workflow] | [skill episode/thought/audit ref] | [skill gap, no-op, or new skill opportunity] | auto-updated / proposed new skill / deferred / no change |

## Thought Skill Updates Audited
| Skill | Thought Change | Dream Decision | Evidence |
|-------|----------------|----------------|---------|
| [skill id or None] | [what Thought wrote] | accepted / modified / removed-superseded / deferred | [thought + skill ledger refs] |

## Skill Updates Applied
| Skill | Resource/Manifest | Change Made | Evidence |
|-------|-------------------|-------------|---------|
| [skill id or None] | SKILL.md / skill.json overlay / resource path | [what Dream changed or what Thought update was accepted] | [skill episode/thought/audit ref] |

## Memory Updates Applied
| Item | File | Recall Trigger | Future Behavior | Staleness Risk | Change Made | Evidence |
|------|------|----------------|-----------------|----------------|-------------|---------|
| [item or None] | USER.md / SOUL.md / MEMORY.md | [when this should be recalled] | [what Prometheus should do differently] | [what could make it wrong/stale] | [what changed or why nothing changed] | [thought/audit ref] |

## Opportunity Incubation
| Seed | Surfaces Inspected | What The Dream Learned | Outcome |
|------|--------------------|------------------------|---------|
| [seed] | [files or areas inspected] | [current-state summary] | proposed / deferred / already pending |

## Proposals

### 1) [Proposal title]
- **Type:** [type]
- **Priority:** high / medium / low
- **Confidence:** high / medium / low
- **Reason:** [why this was flagged, with evidence reference]
- **Status:** submitted
- **Proposal ID:** [id from write_proposal]
- **Affects:** [specific file / job name / skill name / agent]
- **Expected impact:** [what concretely improves]

_(Repeat for each proposal. If none: write "No proposals generated tonight - all items were below the quality gate.")_

## Deferred Ideas
| Idea | Reason | Confidence | First Seen |
|------|--------|-----------|-----------|
| ... | low evidence | medium | Thought 1 |

## Tomorrow's Watch Items
- [specific thing to monitor tomorrow]

## Run Accounting
- Thoughts synthesized: N
- Skill episodes reviewed: N
- Business candidates reviewed: N
- Business/entity updates applied: N
- Memory updates applied: N
- Opportunity seeds incubated: N
- Proposals generated: N (High: N, Medium: N, Low: N)
---

After all writes, print a plain-text summary of what was done tonight.
`;
  }
}

// ─── Global instance (mirrors heartbeat runner pattern) ───────────────────────

let _globalBrainRunner: BrainRunner | null = null;

export function setBrainRunnerInstance(r: BrainRunner): void {
  _globalBrainRunner = r;
}

export function getBrainRunnerInstance(): BrainRunner | null {
  return _globalBrainRunner;
}
