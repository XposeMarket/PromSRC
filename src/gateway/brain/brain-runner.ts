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
 *              Synthesizes all of today's thoughts, applies durable memory
 *              updates directly, generates formal proposals for everything else,
 *              and rewrites Brain/proposals.md as the morning briefing.
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
import { addMessage, clearHistory, persistToolLog } from '../session';
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

// ─── Constants ────────────────────────────────────────────────────────────────

const THOUGHT_INTERVAL_MS  = 6 * 60 * 60 * 1000;   // 6 hours
const CATCHUP_CAP_MS       = 12 * 60 * 60 * 1000;  // max window for catch-up thought
const CHECK_INTERVAL_MS    = 15 * 60 * 1000;        // 15-minute ticker
const DREAM_HOUR           = 23;                    // local hour for dream eligibility
const DREAM_MIN            = 30;                    // local minute for dream eligibility
const DREAM_BUFFER_MIN     = 90;                    // don't start thought if dream is ≤90 min away
const THOUGHT_RETRY_BACKOFF_MS = 30 * 60 * 1000;    // wait 30m after a failed attempt
const DREAM_RETRY_BACKOFF_MS   = 60 * 60 * 1000;    // wait 60m after a failed attempt

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
  todayCount?: number;
  ranToday?: boolean;
  thoughtModel?: string;
  dreamModel?: string;
  lastAttempt?: string | null;
  lastOutcome?: 'idle' | 'success' | 'failed';
  lastError?: string | null;
}

export class BrainRunner {
  private deps: BrainRunnerDeps;
  private ticker: NodeJS.Timeout | null = null;
  private thoughtRunning = false;
  private dreamRunning   = false;

  constructor(deps: BrainRunnerDeps) {
    this.deps = deps;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  getBrainStatus(): { thought: BrainJobStatus; dream: BrainJobStatus } {
    const state   = loadLatestState();
    const today   = getLocalDateStr();
    const daily   = loadDailyStatus(today);
    const now     = new Date();

    // Next thought
    const lastThought = state.lastThoughtAt ? new Date(state.lastThoughtAt) : null;
    const nextThoughtMs = lastThought
      ? Math.max(lastThought.getTime() + THOUGHT_INTERVAL_MS, now.getTime())
      : now.getTime();

    // Next dream
    const dreamTime = new Date(now);
    dreamTime.setHours(DREAM_HOUR, DREAM_MIN, 0, 0);
    if (dreamTime.getTime() <= now.getTime()) {
      dreamTime.setDate(dreamTime.getDate() + 1);
    }

    return {
      thought: {
        id: 'brain_thought',
        name: '🧠 Brain Thought',
        description: 'Observes the last 6h of activity and writes a reflection',
        enabled: state.thoughtEnabled !== false,
        running: this.thoughtRunning,
        lastRun: state.lastThoughtAt,
        nextRun: new Date(nextThoughtMs).toISOString(),
        schedule: 'Every 6 hours',
        todayCount: daily.thoughts.length,
        thoughtModel: state.thoughtModel || '',
        dreamModel:   state.dreamModel  || '',
        lastAttempt: state.lastThoughtAttemptAt,
        lastOutcome: state.lastThoughtStatus,
        lastError: state.lastThoughtError,
      },
      dream: {
        id: 'brain_dream',
        name: '💤 Brain Dream',
        description: 'Nightly synthesis: updates memory and generates proposals',
        enabled: state.dreamEnabled !== false,
        running: this.dreamRunning,
        lastRun: state.lastDreamCompletedAt || daily.dreamCompletedAt,
        nextRun: dreamTime.toISOString(),
        schedule: `Nightly at ${String(DREAM_HOUR).padStart(2,'0')}:${String(DREAM_MIN).padStart(2,'0')} local`,
        ranToday: daily.dreamRan,
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
    if (partial.thoughtModel  !== undefined) state.thoughtModel  = String(partial.thoughtModel || '');
    if (partial.dreamModel    !== undefined) state.dreamModel    = String(partial.dreamModel   || '');
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
      const daily = loadDailyStatus(today);
      const ok = await this._runDream(today, daily.thoughts.length);
      if (!ok) throw new Error('Brain dream run did not produce verified artifacts');
    }
  }

  start(): void {
    if (this.ticker) return;
    ensureBrainDirs();
    markGatewayStarted();

    // Tick immediately on start, then every 15 minutes
    this._tick().catch(err =>
      console.warn('[BrainRunner] Initial tick error:', err?.message)
    );
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

    // Dream check first — takes priority if eligible
    if (
      !this.dreamRunning
      && !daily.dreamRan
      && latest.dreamEnabled !== false
      && this._isDreamEligible(now)
      && this._isDreamRetryReady(now, latest)
    ) {
      if (this.thoughtRunning) {
        console.log('[BrainRunner] Dream eligible but waiting for thought to finish');
        return;
      }
      this._runDream(today, daily.thoughts.length)
        .then((ok) => {
          if (!ok) console.warn('[BrainRunner] Dream run finished with failure status');
        })
        .catch(err =>
          console.error('[BrainRunner] Dream run error:', err?.message)
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

  private _isDreamRetryReady(now: Date, state: BrainLatestState): boolean {
    if (state.lastDreamStatus !== 'failed' || !state.lastDreamAttemptAt) return true;
    const elapsedSinceAttempt = now.getTime() - new Date(state.lastDreamAttemptAt).getTime();
    return elapsedSinceAttempt >= DREAM_RETRY_BACKOFF_MS;
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
    const prompt = this._buildThoughtPrompt({
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
      const result = await this.deps.handleChat(
        prompt,
        sessionId,
        sendSSE,
        undefined,
        undefined,
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
          'replace_lines',
          'find_replace',
          'insert_after',
          'delete_lines',
        ],
      );
      resultText = result?.text || '';
      toolResults = Array.isArray(result?.toolResults) ? result.toolResults : [];
    } catch (err: any) {
      resultText = `Error: ${err?.message || String(err)}`;
      console.error(`[BrainRunner] Thought ${thoughtNumber} failed:`, err?.message);
    } finally {
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

    // Create automated session for UI visibility
    this.deps.broadcast({
      type: 'automated_session_created',
      session: {
        id: sessionId,
        title: `🧠 Thought ${thoughtNumber} — ${dateStr} ${windowLabel}`,
        jobName: 'Brain Thought',
        jobId: 'brain_thought',
        automated: true,
        createdAt: Date.now(),
        history: [
          { role: 'user', content: `[Brain Thought ${thoughtNumber}] Window: ${fmtUtc(windowStart)} → ${fmtUtc(windowEnd)}` },
          { role: 'ai', content: resultText.slice(0, 6000) },
        ],
      },
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

    console.log(`[BrainRunner] Starting Dream for ${dateStr} (${thoughtCount} thoughts available)`);

    clearHistory(sessionId);
    addMessage(
      sessionId,
      { role: 'user', content: `[Brain Dream] Nightly synthesis for ${dateStr} — ${thoughtCount} thought(s)`, timestamp: Date.now() },
      { disableCompactionCheck: true, disableMemoryFlushCheck: true },
    );

    const outFile    = `dreams/${dateStr}/${dreamLabel}-dream.md`;
    const absOutFile = path.join(getBrainDir(), outFile);
    const prompt     = this._buildDreamPrompt({ dateStr, dreamLabel, thoughtCount, outFile: absOutFile });

    const sendSSE = (event: string, data: any) => {
      if (['tool_call', 'tool_result', 'thinking', 'info'].includes(event)) {
        this.deps.broadcast({ type: 'brain_dream_sse', date: dateStr, event, data });
      }
    };

    const dreamState = loadLatestState();
    dreamState.lastDreamAttemptAt = new Date().toISOString();
    dreamState.lastDreamStatus = 'idle';
    dreamState.lastDreamError = null;
    saveLatestState(dreamState);

    const dreamModelOverride = loadLatestState().dreamModel?.trim() || undefined;
    let resultText = '';
    let toolResults: Array<{ name: string; args: any; result: string; error: boolean }> = [];
    try {
      const result = await this.deps.handleChat(
        prompt,
        sessionId,
        sendSSE,
        undefined,
        undefined,
        `CONTEXT: Automated Brain Dream run for ${dateStr}. Synthesize today's thoughts, write durable memory updates, create proposals. This is the nightly execution run.`,
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
          'replace_lines',
          'find_replace',
          'insert_after',
          'delete_lines',
          'memory_browse',
          'memory_write',
          'write_proposal',
        ],
      );
      resultText = result?.text || '';
      toolResults = Array.isArray(result?.toolResults) ? result.toolResults : [];
    } catch (err: any) {
      resultText = `Error: ${err?.message || String(err)}`;
      console.error(`[BrainRunner] Dream for ${dateStr} failed:`, err?.message);
    } finally {
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
      state.lastDreamDate = dateStr;
      state.lastDreamCompletedAt = new Date().toISOString();
      state.lastDreamStatus = 'success';
      state.lastDreamError = null;
      saveLatestState(state);

      const daily = loadDailyStatus(dateStr);
      daily.dreamRan         = true;
      daily.dreamFile        = outFile;
      daily.dreamCompletedAt = new Date().toISOString();
      saveDailyStatus(daily);
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

    // Automated session for UI
    this.deps.broadcast({
      type: 'automated_session_created',
      session: {
        id: sessionId,
        title: `💤 Dream — ${dateStr}`,
        jobName: 'Brain Dream',
        jobId: 'brain_dream',
        automated: true,
        createdAt: Date.now(),
        history: [
          { role: 'user', content: `[Brain Dream] Nightly synthesis for ${dateStr} — ${thoughtCount} thought(s)` },
          { role: 'ai', content: resultText.slice(0, 6000) },
        ],
      },
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
    const thoughtsDir = path.join(getBrainDir(), 'thoughts', dateStr);
    const memNotesFile = path.join(this.deps.workspacePath, 'memory', `${dateStr}-intraday-notes.md`);
    const auditDir     = path.join(this.deps.workspacePath, 'audit');

    return `You are Prometheus, running an automated Brain Thought analysis.

════════════════════════════════════════════════════════════
BRAIN THOUGHT ${thoughtNumber} — Observation Only
Window:  ${wsStart} → ${wsEnd}
Date:    ${dateStr}
Output:  ${outFile}
════════════════════════════════════════════════════════════

STRICT RULES — do not violate under any circumstances:
• DO NOT write to USER.md, SOUL.md, or any memory files
• DO NOT call write_proposal or create any proposals
• DO NOT update cron jobs, skills, configs, or team state
• Your ONLY permitted file write is the thought output file listed above

════════════════════════════════════════════════════════════
STEP 1 — SCAN AUDIT WINDOW
════════════════════════════════════════════════════════════

Scan the audit directory for activity between ${wsStart} and ${wsEnd}.
Audit root: ${auditDir}

Priority scan order (read in this order, respect the caps):
  1. ${auditDir}/chats/sessions/     — chat session snapshots (max 8 most recent)
  2. ${auditDir}/tasks/              — task state snapshots (max 15 files)
  3. ${auditDir}/cron/runs/          — JSONL run history files (filter by timestamp)
  4. ${auditDir}/teams/              — team activity logs (if present)
  5. ${auditDir}/proposals/          — proposal state changes (if present)
  6. ${memNotesFile}  — today's intraday notes (if file exists)

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

Create the output directory if needed: ${thoughtsDir}
Write the thought file to: ${outFile}

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
    const brainDir    = getBrainDir();
    const thoughtsDir = path.join(brainDir, 'thoughts', dateStr);
    const dreamsDir   = path.join(brainDir, 'dreams', dateStr);
    const proposalsFile  = path.join(brainDir, 'proposals.md');
    const userMdFile     = path.join(this.deps.workspacePath, 'USER.md');
    const soulMdFile     = path.join(this.deps.workspacePath, 'SOUL.md');
    const memoryMdFile   = path.join(this.deps.workspacePath, 'MEMORY.md');
    const pendingPropsDir = path.join(this.deps.workspacePath, 'proposals', 'pending');
    const auditDir        = path.join(this.deps.workspacePath, 'audit');

    return `You are Prometheus, running an automated Brain Dream — the nightly synthesis and execution run.

════════════════════════════════════════════════════════════
BRAIN DREAM — Nightly Synthesis + Execution
Date:    ${dateStr}
Time:    ${nowStr}
Thoughts available: ${thoughtCount}
Output:  ${outFile}
         ${proposalsFile} (REWRITE)
════════════════════════════════════════════════════════════

You have 5 phases tonight. Execute them in order.

════════════════════════════════════════════════════════════
PHASE 1 — LOAD TODAY'S THOUGHTS
════════════════════════════════════════════════════════════

List directory: ${thoughtsDir}
Read ALL *-thought.md files found there.

Also load for context:
  - ${userMdFile}     — current USER.md (needed for memory dedup)
  - ${soulMdFile}     — current SOUL.md (needed for memory dedup)
  - ${memoryMdFile}   — current MEMORY.md (needed for long-term memory dedup)
  - ${proposalsFile}  — current proposals.md (to see what's already pending/recent)

List ${pendingPropsDir} to see what formal proposals are currently pending approval.
(You need this for dedup in Phase 4.)

If no thought files exist in ${thoughtsDir}:
  - Note "no thoughts available" in the dream file
  - Skip Phases 2–4
  - Still write the dream file and proposals.md

════════════════════════════════════════════════════════════
PHASE 2 — CROSS-EXAMINE HIGH-CONFIDENCE ITEMS
════════════════════════════════════════════════════════════

For any item marked confidence: HIGH in sections C or D of ANY thought:
  - Read the cited evidence file/session from ${auditDir}
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
  task_trigger       — schedule a one-shot investigation task
  general            — anything that doesn't fit above

For each proposal passing the gate:
  - Call write_proposal with: type, priority, title, summary, details, affectedFiles[], executorPrompt
  - Save the returned proposal ID for the output files

If 0 proposals pass the gate: note this in the dream file. This is normal.

════════════════════════════════════════════════════════════
PHASE 5 — WRITE OUTPUTS
════════════════════════════════════════════════════════════

5a. Create directory ${dreamsDir} if needed.
    Write ${outFile}:

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

5b. REWRITE ${proposalsFile} completely (not append):

---
# Brain Proposal Ledger
_Last Updated: ${nowStr}_
_Dream Source: ${outFile}_

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
}

// ─── Global instance (mirrors heartbeat runner pattern) ───────────────────────

let _globalBrainRunner: BrainRunner | null = null;

export function setBrainRunnerInstance(r: BrainRunner): void {
  _globalBrainRunner = r;
}

export function getBrainRunnerInstance(): BrainRunner | null {
  return _globalBrainRunner;
}
