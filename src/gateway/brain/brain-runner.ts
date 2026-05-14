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
import { isKnownProviderId } from '../../providers/provider-registry.js';
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
        ranToday: state.lastDreamDate === today || daily.dreamRan,
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

    let cursor = state.lastDreamDate
      ? addLocalDays(getDreamTimeForDate(state.lastDreamDate), 1)
      : getDreamTimeForDate(latestDueDate);
    const oldestAllowed = addLocalDays(getDreamTimeForDate(latestDueDate), -(DREAM_CATCHUP_LOOKBACK_DAYS - 1));
    if (cursor.getTime() < oldestAllowed.getTime()) cursor = oldestAllowed;

    while (cursor.getTime() <= latestDueDay.getTime()) {
      const candidateDate = getLocalDateStr(cursor);
      const dailyStatus = loadDailyStatus(candidateDate);
      const legacyCompleted = !!state.lastDreamDate
        && candidateDate < state.lastDreamDate
        && this._hasDreamArtifactForDate(candidateDate);
      if (!dailyStatus.dreamRan && !legacyCompleted && candidateDate !== state.lastDreamDate) {
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
      const elapsedSinceAttempt = now.getTime() - new Date(state.lastThoughtAttemptAt).getTime();
      if (elapsedSinceAttempt < THOUGHT_RETRY_BACKOFF_MS) return null;
    }

    const windowEnd = now;

    if (!state.lastThoughtAt) {
      // First thought of the day/session
      const windowStart = new Date(now.getTime() - THOUGHT_INTERVAL_MS);
      return { windowStart, windowEnd };
    }

    const lastThought = new Date(state.lastThoughtAt);
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
    const elapsedSinceAttempt = now.getTime() - new Date(state.lastDreamAttemptAt).getTime();
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
    const elapsedSinceAttempt = now.getTime() - new Date(state.lastDreamCleanupAttemptAt).getTime();
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
        setSessionMutationScope(sessionId, {
	        allowedFiles: [workspaceOutFile],
	        allowedDirs: [path.posix.dirname(workspaceOutFile)],
	      });
	      const result = await this.deps.handleChat(
	        prompt,
	        sessionId,
        sendSSE,
        undefined,
        abortSignal,
        `CONTEXT: Automated Brain Thought run ${thoughtNumber} for ${dateStr}. Window: ${fmtUtc(windowStart)} → ${fmtUtc(windowEnd)}. Observe only — no memory writes, no proposals.`,
        thoughtModelOverride,
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
        ],
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
      const toolLogLines = toolResults.slice(-8).map((r) => {
        const ok = r.error ? '✗' : '✓';
        const args = r.args ? JSON.stringify(r.args).slice(0, 80) : '';
        const preview = String(r.result || '').slice(0, 120).replace(/\n/g, ' ');
        return `${ok} ${r.name}(${args}): ${preview}`;
      });
      persistToolLog(sessionId, toolLogLines.join('\n'));
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
	      activateToolCategory(sessionId, 'source_read');
	      setSessionMutationScope(sessionId, {
	        allowedFiles: [workspaceOutFile, workspaceProposalsFile],
	        allowedDirs: [path.posix.dirname(workspaceOutFile)],
	      });
	      const result = await this.deps.handleChat(
	        prompt,
	        sessionId,
        sendSSE,
        undefined,
        abortSignal,
        `CONTEXT: Automated Brain Dream run for ${dateStr}. Synthesize the thoughts for that date, write durable memory updates, create proposals. This is the nightly execution run.`,
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
          'memory_write',
          'list_source',
          'source_stats',
          'read_source',
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
          'skill_manifest_write',
          'skill_resource_write',
          'write_proposal',
        ],
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
      const toolLogLines = toolResults.slice(-8).map((r) => {
        const ok = r.error ? '✗' : '✓';
        const args = r.args ? JSON.stringify(r.args).slice(0, 80) : '';
        const preview = String(r.result || '').slice(0, 120).replace(/\n/g, ' ');
        return `${ok} ${r.name}(${args}): ${preview}`;
      });
      persistToolLog(sessionId, toolLogLines.join('\n'));
    }

    const proposalsFilePath = path.join(getBrainDir(), 'proposals.md');
    const dreamExists = fs.existsSync(absOutFile);
    const proposalsExists = fs.existsSync(proposalsFilePath);
    const dreamStats = dreamExists ? fs.statSync(absOutFile) : null;
    const proposalStats = proposalsExists ? fs.statSync(proposalsFilePath) : null;
    const artifactsFresh = !!dreamStats && !!proposalStats
      && dreamStats.size > 0
      && proposalStats.size > 0
      && dreamStats.mtimeMs >= (runStartedAt - 5000)
      && proposalStats.mtimeMs >= (runStartedAt - 5000);
    const runFailed = /^error:/i.test(String(resultText || '').trim());
    const success = artifactsFresh && !runFailed;

	    const state = loadLatestState();
	    if (success) {
	      state.proposalDedupeIds = this._extractProposalIds(toolResults).slice(-100);
	      state.lastDreamDate = dateStr;
	      state.lastDreamCompletedAt = new Date().toISOString();
	      state.lastDreamAttemptDate = dateStr;
	      state.lastDreamStatus = 'success';
	      state.lastDreamError = null;
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
            mode: 'pending',
          });
          this.deps.broadcast({
            type: 'skill_curator_done',
            date: dateStr,
            runId: curator.runId,
            suggestions: curator.suggestions.length,
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
        : `Expected dream artifacts missing/stale: ${outFile}, proposals.md`;
      saveLatestState(state);
    }

    // Broadcast completion
    this.deps.broadcast({
      type: 'brain_dream_done',
      date: dateStr,
      file: outFile,
      summary: resultText.slice(0, 600),
      success,
      error: success ? undefined : (loadLatestState().lastDreamError || 'Unknown dream run failure'),
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
        allowedDirs: [path.posix.dirname(workspaceOutFile)],
      });
      const result = await this.deps.handleChat(
        prompt,
        sessionId,
        sendSSE,
        undefined,
        abortSignal,
        `CONTEXT: Automated Brain Dream cleanup for ${dateStr}. Second pass only: remove or dedupe stale/redundant memory text. No additions, no proposals.`,
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
      const toolLogLines = toolResults.slice(-8).map((r) => {
        const ok = r.error ? 'âœ—' : 'âœ“';
        const args = r.args ? JSON.stringify(r.args).slice(0, 80) : '';
        const preview = String(r.result || '').slice(0, 120).replace(/\n/g, ' ');
        return `${ok} ${r.name}(${args}): ${preview}`;
      });
      persistToolLog(sessionId, toolLogLines.join('\n'));
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
    const memNotesFileRel = path.join('memory', `${dateStr}-intraday-notes.md`);
    const auditDirRel     = 'audit';
    // outFile received here is already absolute — derive the workspace-relative version for the prompt
    const outFileRel = path.relative(this.deps.workspacePath, outFile);

    return `You are Prometheus, running an automated Brain Thought analysis.

════════════════════════════════════════════════════════════
BRAIN THOUGHT ${thoughtNumber} — Observation Only
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
• DO NOT update cron jobs, skills, configs, or team state
• Your ONLY permitted file write is the thought output file listed above

════════════════════════════════════════════════════════════
STEP 1 — SCAN AUDIT WINDOW
════════════════════════════════════════════════════════════

Scan the audit directory for activity between ${wsStart} and ${wsEnd}.
Audit root: ${auditDirRel}

Priority scan order (read in this order, respect the caps):
  1. ${auditDirRel}/chats/sessions/     — chat session snapshots (max 8 most recent)
  2. ${auditDirRel}/tasks/              — task state snapshots (max 15 files)
  3. ${auditDirRel}/cron/runs/          — JSONL run history files (filter by timestamp)
  4. ${auditDirRel}/teams/              — team activity logs (if present)
  5. ${auditDirRel}/proposals/          — proposal state changes (if present)
  6. ${memNotesFileRel}  — today's intraday notes (if file exists)

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
   Format each as a table row with: Item | Target file | Confidence | Evidence

D. IMPROVEMENT CANDIDATES
   Items that might be worthy of proposals — the Dream will evaluate before submitting.
   Format each as: Issue | Proposal type | Confidence | Evidence
   Proposal types: prompt_mutation / skill_evolution / src_edit / config_change / feature_addition / task_trigger / general

E. WINDOW VERDICT
   - Active: yes / no
   - Signal quality: high / medium / low / none
   - Summary: 2–3 sentence plain-language description of the window

════════════════════════════════════════════════════════════
STEP 3 — WRITE THE THOUGHT FILE
════════════════════════════════════════════════════════════

Create the output directory if needed: ${thoughtsDirRel}
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
| Issue | Proposal Type | Confidence | Evidence |
|-------|--------------|-----------|---------|
| ...   | prompt_mutation | high/medium/low | [ref] |

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
  4. EXECUTOR-READY — executorPrompt has enough detail to implement without guesswork

Available proposal types:
  prompt_mutation    — improve a specific cron job prompt (cite job name)
  skill_evolution    — add or update a skill file (specify file path + proposed content)
  src_edit           — source code change (cite specific file + describe change precisely)
  config_change      — cron schedule, settings.json, or config file change
  feature_addition   — new capability (include full design in executorPrompt)
  memory_update      — workspace file change (not USER.md/SOUL.md/MEMORY.md — those are Phase 3)
  task_trigger       — start or schedule a bounded one-shot action, team run, verification, or investigation
  general            — anything that doesn't fit above

Execution modes (required for executable proposals):
  code_change        - Prometheus dev self-edit only; affected_files must be exact src/ and/or web-ui/ files; sandboxed; build/verification required
  action             - approve and do/trigger/create something exactly once; use for team starts, scheduled runs, artifacts, bounded workspace actions
  review             - read-mostly verification/audit/report; do not mutate unless the proposal explicitly approves the exact mutation

Operational proposal rules:
  - Use execution_mode=action for approvals like "start this team/run", "perform this bounded non-code action", or "create this approved artifact".
  - Use execution_mode=review for "verify/check/audit/review and report back" proposals.
  - For task_trigger proposals, affected_files are resource references or expected artifact locations, not a per-file edit plan.
  - Keep executorPrompt action-shaped: inspect necessary state, perform the approved action exactly once, verify the result, write a note, and complete.
  - Include execution_steps with 3-7 concrete approved steps. These become the executor's task checklist after approval.
  - Do not include src proposal headings, diff previews, or build steps unless the proposal truly edits code.

Source-code proposal rules:
  - If a proposal would edit Prometheus source code, it MUST set execution_mode=code_change, type src_edit, and affected_files MUST include the exact src/... or web-ui/... paths.
  - Before calling write_proposal for src_edit, inspect current code with the source tools:
      * Use grep_source or list_source to locate relevant files when the path is uncertain.
      * Use source_stats before reading large or unfamiliar files.
      * Use read_source on every affected src/ file and cite the lines or symbols you inspected.
      * For web-ui code, use webui_source_stats, read_webui_source, and grep_webui_source.
  - Do NOT rely only on audit notes or thought summaries for src_edit proposals. The proposal must be based on the actual current source.
  - The details field for any proposal touching src/ MUST include these exact markdown headings:
      ## Why this change
      ## Exact source edits
      ## Deterministic behavior after patch
      ## Acceptance tests
      ## Risks and compatibility
  - In "Exact source edits", name the files, functions/classes/handlers, and current behavior you verified from read_source.
  - In "Acceptance tests", include the build/test command that should verify the edit, usually npm run build for TypeScript source changes.
  - Set requires_build=true for TypeScript/backend src edits unless there is a specific reason no build is needed.
  - Include execution_steps with the exact approved implementation/verification checklist. The executor will use these steps instead of inventing a fresh plan.
  - Make executorPrompt source-aware: instruct the approved executor to read affected files with read_source/read_webui_source first, then edit with the matching source write tools.

Risk tier rules:
  - Every src_edit proposal MUST set risk_tier to either low or high.
  - risk_tier controls which executor default is used after approval:
      * low  -> Settings > Agent Model Defaults > proposal_executor_low_risk
      * high -> Settings > Agent Model Defaults > proposal_executor_high_risk
  - Use low only for isolated, easy-to-review changes such as comments, copy, small config glue, or a one-file bug fix with narrow behavior.
  - Use high for core runtime logic, auth/security, memory/proposal execution, source-write tools, multi-file edits, data migrations, or anything where a bad patch could break builds or user workflows.
  - If unsure, choose high. Do not hardcode a model name unless executor_provider_id/executor_model is explicitly justified.

For each proposal passing the gate:
  - For action proposals, call write_proposal with: execution_mode="action", type, priority, title, summary, details, affected_files[] as resource refs, execution_steps, executorPrompt, and requires_build=false.
  - For review proposals, call write_proposal with: execution_mode="review", type, priority, title, summary, details, affected_files[] as evidence/resource refs, execution_steps, executorPrompt, and requires_build=false.
  - For code_change proposals, call write_proposal with: execution_mode="code_change", type="src_edit", priority, title, summary, details, affected_files[], execution_steps, executorPrompt, risk_tier
  - Save the returned proposal ID for the output files

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
- Do not update cron jobs, skills, configs, or team state
- Your only permitted file write is the thought output file listed above

PRIMARY PURPOSE:
You are not just auditing for mistakes. You are acting like a proactive second brain. You are trying to notice:
- repeated workflows the user performed manually today that could become a skill, composite tool, browser teaching workflow, desktop workflow, or automation
- unfinished feature ideas the user mentioned but did not complete
- new agents, subagents, teams, or workspace surfaces that now deserve follow-up work
- latent opportunities where Prometheus could proactively help tomorrow, across any context: business, marketing, websites, apps, notifications, communications, code, research, content, or operations
- concrete next-step proposals the Dream could investigate into executor-ready plans
- "the user would probably appreciate if I got ahead on this" moments, even when they were not phrased as explicit tasks
- useful wonderings: thoughtful "I wonder if..." observations that may be seeds for future help, not only defects

STEP 1 - SCAN AUDIT WINDOW

Scan the audit directory for activity between ${wsStart} and ${wsEnd}.
Audit root: ${auditDirRel}

Priority scan order:
1. ${auditDirRel}/chats/sessions/ - chat session snapshots
2. ${auditDirRel}/chats/transcripts/ - inspect transcripts for sessions that look feature-oriented, planning-heavy, or unfinished
3. ${auditDirRel}/tasks/ - task state snapshots
4. ${auditDirRel}/cron/runs/ - JSONL run history files filtered by timestamp
5. ${auditDirRel}/teams/ - team activity logs, new subagents, and manager outputs if present
6. ${auditDirRel}/proposals/ - proposal state changes if present
7. ${skillEpisodesDirRel}/episodes.jsonl - structured skill-use episodes if present
8. ${skillGardenerDirRel}/live-candidates.jsonl and workflow-episodes.jsonl - live skill gardener candidates captured during chat, if present
9. ${memNotesFileRel} - today's intraday notes if the file exists

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

D. Memory Candidates
- Items that might be worthy of USER.md, SOUL.md, or MEMORY.md
- Only flag if durable and not clearly already captured
- Exclude procedural workflow instructions, skill usage improvements, tool-order recipes, and "when doing X, do Y" notes unless they are truly global operating rules
- Format as a table row: Item | Target file | Confidence | Evidence

E. Opportunity Seeds
- Capture unfinished or proactive opportunities the Dream should investigate
- This is the most important section when the user talked about something but did not finish it
- Include repeated manual workflows, partial feature ideas, new agents/subagents/teams created but not yet deployed, placeholder-heavy or underused workspace surfaces, business/marketing/product ideas, notification follow-ups, and concrete "Prometheus should probably help with this next" openings
- Prefer seeds that can become proposals, skills, composite tools, browser/desktop taught workflows, scheduled monitors, or one-shot task triggers
- Format as: Seed | Why it matters | Suggested scouting surface | Confidence | Evidence

F. Improvement Candidates
- Items that might be worthy of proposals
- Format as: Issue | Proposal type | Confidence | Evidence
- Proposal types: prompt_mutation / skill_evolution / src_edit / config_change / feature_addition / task_trigger / general

G. Window Verdict
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

## D. Memory Candidates
| Item | Target | Confidence | Evidence |
|------|--------|-----------|---------|
| ...  | USER.md or SOUL.md or MEMORY.md | high/medium/low | [file ref] |

_(Leave table with a single dash row if nothing found.)_

## E. Opportunity Seeds
| Seed | Why It Matters | Suggested Scouting Surface | Confidence | Evidence |
|------|----------------|----------------------------|-----------|---------|
| ...  | [why Dream should care tomorrow] | [src/... or web-ui/... or teams/... or workspace path] | high/medium/low | [ref] |

_(Leave table with a single dash row if nothing found.)_

## F. Improvement Candidates
| Issue | Proposal Type | Confidence | Evidence |
|-------|--------------|-----------|---------|
| ...   | prompt_mutation | high/medium/low | [ref] |

_(Leave table with a single dash row if nothing found.)_

## G. Window Verdict
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

    return `You are Prometheus, running the second Brain Dream pass: the memory solidifier.

BRAIN DREAM CLEANUP - Memory Solidifier
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
- Do not add new memories, new facts, new preferences, or new sections to USER.md, SOUL.md, or MEMORY.md.
- You may only remove, lightly merge, or dedupe text that is clearly redundant, stale, contradictory, or unimportant after the latest dream.
- If the memory is already good, make no memory edits. This is a successful outcome.
- When uncertain, preserve the memory. It is better to leave a duplicate than erase something important.
- Your only required write is the cleanup report at ${outFileRel}. Memory edits are optional and conservative.

STEP 1 - READ CURRENT MEMORY
Read:
- ${userMdFileRel}
- ${soulMdFileRel}
- ${memoryMdFileRel}

Also list and read the latest main dream artifact in ${latestDreamDirRel} so you understand what was just added or updated.

STEP 2 - LIGHT DEDUPE / CLEANUP REVIEW
Look only for:
- exact or near-exact duplicate bullets
- obsolete wording directly contradicted by newer memory nearby
- tiny one-off details that slipped into durable memory and are not useful weeks from now
- duplicated operational rules where one clearer version can safely remain

Do not perform broad rewrites. Do not polish prose for style alone. Do not compress nuanced memories into vague summaries.

STEP 3 - OPTIONAL EDITS
If and only if an edit is clearly safe:
- Use replace_lines, find_replace, or delete_lines surgically.
- Prefer removing the weaker duplicate and keeping the more specific, more recent, or more actionable version.
- Do not use insert_after unless it is only to repair formatting after removing text.

STEP 4 - WRITE CLEANUP REPORT
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

You have 7 phases tonight. Execute them in order.

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
- ${proposalsFileRel}

List ${skillEpisodesDirRel}. If ${skillEpisodesDirRel}/episodes.jsonl exists, read it. This is the structured skill gardener evidence for the target date: skills read, request excerpts, tool sequences, final responses, errors, touched paths, and outcome hints.

List ${skillGardenerDirRel}. If live-candidates.jsonl or workflow-episodes.jsonl exists, read them. These are always-on skill gardener signals captured during normal chat: reusable workflows, candidate skill updates, candidate resources/templates, missing trigger signals, user-facing offers, lifecycle status, confidence, risk, and evidence.

List ${pendingPropsDirRel} to see what formal proposals are currently pending approval.
You also have prom-root read tools tonight. Use them when the best evidence lives outside plain workspace surfaces:
- list_prom / read_prom_file / grep_prom for scripts/, electron/, .prometheus/, root docs, and allowlisted project-root files
- read_source / grep_source for src/
- read_webui_source / grep_webui_source for web-ui/

If no thought files exist in ${thoughtsDirRel}:
- Note "no thoughts available" in the dream file
- Still check ${skillEpisodesDirRel}/episodes.jsonl if present
- Still check ${skillGardenerDirRel}/live-candidates.jsonl and workflow-episodes.jsonl if present
- Skip any phase that has no evidence
- Still write the dream file and proposals.md

PHASE 2 - CROSS-EXAMINE HIGH-CONFIDENCE ITEMS

For any item marked high confidence in sections C, D, E, or F of any thought:
- Read the cited evidence file or session from ${auditDirRel}
- Verify the finding is real and accurately described
- If evidence does not support the claim, downgrade or discard it
- Only items surviving verification proceed to later phases

Medium and low confidence items:
- Record them in the dream file under "Deferred Ideas"
- Do not write them to memory or propose them yet

When a verified opportunity seed points to a partially-finished idea or a newly-created but idle agent, subagent, or workspace surface, treat that as a first-class signal, not a side note.

PHASE 3 - SKILL GARDENER REVIEW

Use the thought Skill And Workflow Signals, ${skillEpisodesDirRel}/episodes.jsonl, and ${skillGardenerDirRel}/live-candidates.jsonl + workflow-episodes.jsonl to decide whether today's work should improve existing skills or create new ones.

For each skill episode:
- Identify the skillId, requestExcerpt, toolSequence, finalResponseExcerpt, errors, touchedPaths, and outcomeHints
- Call skill_read for the skillId before proposing an update so the proposal is based on the current skill, not only the episode excerpt
- Use skill_inspect and skill_resource_list/read when metadata or bundled resources matter
- Review lifecycle and ownership metadata from skill_inspect: lifecycle, ownership, status, manifestSource, provenance, validation, resources, and recent change history if present
- Compare the current skill to what actually happened in the session
- Look for missing triggers, unclear instructions, missing examples, missing templates/resources, tool-order mistakes, repeated errors, or user corrections
- Aggregate repeated candidate signals across today's thoughts and episodes. Stronger signals include repeated use across days, explicit user correction, positive user feedback, skill was read but ignored, skill caused wrong tool order, skill trigger matched too broadly, or skill_list found a relevant skill but no skill_read followed.

For each live candidate:
- Identify type, status, confidence, risk, suggestedAction, userFacingOffer, toolSequence, outcomeHints, and evidence
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
- Apply the update automatically tonight with skill_resource_write or skill_manifest_write
- Do not write a proposal for existing-skill maintenance
- Keep edits small, evidence-backed, and directly tied to observed workflow friction or repeated success patterns
- After writing, call skill_read or skill_inspect to verify the updated skill is visible
- When calling skill_resource_write or skill_manifest_write, include changeType, evidence, appliedBy="brain_dream", and reason so the skill change ledger is useful
- The skill manager will snapshot the skill before writing and append the change ledger automatically; verify the update by inspecting the skill afterward
- Record the automatic update in the Dream output under "Skill Gardener Review" and "Skill Updates Applied"
- If the update would delete resources, split a skill, radically rewrite a skill, or otherwise feels high-risk, defer it instead of proposing a routine evolution

For a new skill proposal:
- type must be skill_evolution
- affected_files should reference "skill:<new-skill-id>/SKILL.md" and any planned resources
- details should include the proposed id, name, description, triggers, categories, permissions, required tools, and a draft SKILL.md outline
- prefer skill_create_bundle when resources, examples, schemas, or templates would help; use skill_create only for a simple one-file playbook

Do not create new skills directly. New skill creation must go through a skill_evolution proposal and wait for approval.

PHASE 4 - INCUBATE OPPORTUNITY SEEDS

For each verified high-confidence opportunity seed:
- Scout the suggested surface directly before deciding what to propose
- Read the actual current files, configs, pages, agent definitions, or code involved
- Turn vague intent into a concrete morning-ready proposal only if the evidence supports it

Also look for repeated workflows across the thoughts even if no single thought named them as an opportunity. If the user did a similar task multiple times, consider whether Prometheus should propose:
- a new skill
- a composite tool
- a browser teach-mode workflow
- a desktop workflow
- a monitor or notification-to-action flow
- a one-shot task that gets ahead of likely next work

Incubation heuristics:
1. PARTIAL FEATURE IDEA
   If the user talked about a feature but left it unfinished, inspect the relevant src/, web-ui/, or prom-root files and determine what already exists, what is missing, and the smallest meaningful proposal that moves it forward tomorrow.
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

PHASE 5 - MEMORY UPDATES

Memory write gate - all 4 conditions must be true:
1. DURABLE - the fact will still matter weeks from now
2. NEW - it is not already present in equivalent meaning in USER.md, SOUL.md, or MEMORY.md
3. EVIDENCED - repeated signal or one strongly verified signal
4. ACTIONABLE - it should concretely change future behavior

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

PHASE 6 - PROPOSALS

Proposal quality gate - all 4 conditions must be true:
1. CONCRETE - specific file, job, skill, agent, or behavior to change
2. EVIDENCED - clear citation from a thought file or verified audit or source reference
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

Available proposal types:
- prompt_mutation
- skill_evolution
- src_edit
- config_change
- feature_addition
- memory_update
- task_trigger (bounded one-shot action, team run, verification, or investigation)
- general

Execution modes (required for executable proposals):
- code_change: Prometheus dev self-edit only; affected_files must be exact src/ and/or web-ui/ files; sandboxed; build/verification required
- action: approve and do/trigger/create something exactly once; use for team starts, scheduled runs, artifacts, bounded workspace actions
- review: read-mostly verification/audit/report; do not mutate unless the proposal explicitly approves the exact mutation

Operational proposal rules:
  - Use execution_mode=action for approvals like "start this team/run", "perform this bounded non-code action", or "create this approved artifact".
  - Use execution_mode=review for "verify/check/audit/review and report back" proposals.
- For task_trigger proposals, affected_files are resource references or expected artifact locations, not a per-file edit plan.
- Keep executor_prompt action-shaped: inspect necessary state, perform the approved action exactly once, verify the result, write a note, and complete.
- Include execution_steps with 3-7 concrete approved steps. These become the executor's task checklist after approval.
- Do not include src proposal headings, diff previews, or build steps unless the proposal truly edits code.

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
  - Use read_source on every affected src/ file and cite the functions, classes, handlers, constants, or line ranges you inspected
- For web-ui code, use the web-ui source tools
- For scripts/, electron/, .prometheus/, and other allowlisted project-root files, use prom-root read tools before proposing
- Do not rely only on thought summaries for source-edit proposals; base them on actual current files
- Any proposal touching src/ must include these exact markdown headings in details:
  ## Why this change
  ## Exact source edits
  ## Deterministic behavior after patch
  ## Acceptance tests
  ## Risks and compatibility
- In "Exact source edits", include an ordered implementation plan with the exact files and symbols to edit, the current behavior observed from read_source, and the intended replacement behavior.
- In "Acceptance tests", include the build/test command that should verify the edit, usually npm run build for TypeScript source changes.
- Set requires_build=true for TypeScript/backend src edits unless there is a specific reason no build is needed.
- Include execution_steps with the exact approved implementation/verification checklist. The executor will use these steps instead of inventing a fresh plan.
- Set executor_prompt, not executorPrompt. The executor_prompt must restate the ordered plan and instruct the approved executor to read the affected files with read_source/read_webui_source/read_prom_file first, then apply only the approved edits.
- If the needed src files or exact edit points are not known after inspection, do not create the proposal. Record it as deferred with "needs source scouting" instead.

Risk tier rules:
- Every src_edit proposal must set risk_tier to low or high
- Use low only for isolated, easy-to-review changes
- Use high for core runtime logic, proposal execution, source-write tools, multi-file edits, or anything that could break workflows
- If unsure, choose high

For each proposal passing the gate:
- For action proposals, call write_proposal with: execution_mode="action", type, priority, title, summary, details, affected_files as resource refs, execution_steps, executor_prompt, and requires_build=false
- For review proposals, call write_proposal with: execution_mode="review", type, priority, title, summary, details, affected_files as evidence/resource refs, execution_steps, executor_prompt, and requires_build=false
- For code_change proposals, call write_proposal with: execution_mode="code_change", type="src_edit", priority, title, summary, details, affected_files, execution_steps, executor_prompt, risk_tier
- Make the title and summary feel like a morning briefing: obvious, concrete, approval-ready
- Save the returned proposal ID for the output files

If zero proposals pass the gate, note that in the dream file.

PHASE 7 - WRITE OUTPUTS

7a. Create directory ${dreamsDirRel} if needed.
Write ${outFileRel} with this structure. Use \`mkdir\` for the directory and \`write_file\` for the markdown artifact:

---
# Dream - ${dateStr}
_Generated: ${nowStr}_
_Thoughts synthesized: N_

## Day Summary
[3-5 short paragraphs written like a thoughtful day-story rather than a report stub. Put the real summary first: what the day felt like, what moved, what dragged, what Prometheus noticed about the user's momentum, and what proactive openings seem worth waking up to. Include 1-3 grounded "I wonder if..." observations. The wonder can be small or unrelated to proposals, but it should feel like the brain is actually thinking. Do not change any other section formatting.]

## Memory Updates Applied
| Item | File | Change Made | Evidence |
|------|------|------------|---------|
| [item] | USER.md / SOUL.md / MEMORY.md | [what was added or updated] | [thought ref] |

_(If none: "None - no items passed the memory gate tonight.")_

## Proposals Generated
| # | Type | Title | Priority | ID |
|---|------|-------|----------|----|
| 1 | prompt_mutation | ... | high | prop_xxx |

_(If none: "None - no items passed the proposal gate tonight.")_

## Skill Gardener Review
| Skill/Workflow | Evidence | Current Skill Inspected | Outcome |
|----------------|----------|-------------------------|---------|
| [skill id or new workflow] | [skill episode/thought/audit ref] | yes/no/not applicable | auto-updated / proposed new skill / deferred / no change |

## Skill Updates Applied
| Skill | Resource/Manifest | Change Made | Evidence |
|-------|-------------------|-------------|---------|
| [skill id] | SKILL.md / skill.json overlay / resource path | [what was updated] | [skill episode/thought/audit ref] |

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

7b. Rewrite ${proposalsFileRel} completely. This file is not just a proposal ledger anymore; it is the user's morning-readable, full post-day Dream summary after memory updates, skill gardener review, investigation/incubation, and proposal generation are complete. Use \`write_file\` so the existing file is replaced in full.

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

## Skill Gardener Review
| Skill/Workflow | Evidence | What The Dream Learned | Outcome |
|----------------|----------|------------------------|---------|
| [skill id or workflow] | [skill episode/thought/audit ref] | [skill gap, no-op, or new skill opportunity] | auto-updated / proposed new skill / deferred / no change |

## Skill Updates Applied
| Skill | Resource/Manifest | Change Made | Evidence |
|-------|-------------------|-------------|---------|
| [skill id or None] | SKILL.md / skill.json overlay / resource path | [what changed or why nothing changed] | [skill episode/thought/audit ref] |

## Memory Updates Applied
| Item | File | Change Made | Evidence |
|------|------|------------|---------|
| [item or None] | USER.md / SOUL.md / MEMORY.md | [what changed or why nothing changed] | [thought/audit ref] |

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
