/**
 * heartbeat-runner.ts — SubagentHeartbeatManager
 *
 * Replaces the old single-global HeartbeatRunner.
 *
 * Architecture:
 *   - One timer per registered agent (main + each subagent)
 *   - Each agent reads its own HEARTBEAT.md from its own workspace
 *   - Each agent gets an isolated session: heartbeat_<agentId>
 *   - Global defaults: enabled=false, intervalMinutes=30
 *   - Per-agent overrides stored in config under agents.<id>.heartbeat
 *   - HEARTBEAT_OK response → silent (no broadcast, no delivery)
 *   - Real content → broadcast heartbeat_done with agentId, create automated session
 *   - AI/manager can call update_heartbeat tool to modify any agent's config at runtime
 */

import fs from 'fs';
import path from 'path';
import { listTaskSummaries } from '../tasks/task-store';
import { BackgroundTaskRunner } from '../tasks/background-task-runner';
import { pruneHeartbeatOneOffTasks } from '../teams/managed-teams';
import { registerLiveRuntime, finishLiveRuntime } from '../live-runtime-registry';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * System-level heartbeat settings (not per-agent).
 * Active hours gate all heartbeats. reviewTeamsAfterRun fires after the main agent.
 */
export interface SystemHeartbeatConfig {
  activeHoursStart: number;    // 0–23
  activeHoursEnd: number;      // 0–23
  reviewTeamsAfterRun: boolean;
}

/**
 * GlobalHeartbeatConfig — kept for backward-compat with API routes.
 * Represents the merged view of system config + main agent config.
 */
export interface GlobalHeartbeatConfig {
  enabled: boolean;
  intervalMinutes: number;
  activeHoursStart: number;
  activeHoursEnd: number;
  model: string;
  reviewTeamsAfterRun: boolean;
}

export interface AgentHeartbeatConfig {
  enabled: boolean;
  intervalMinutes: number;
  model?: string;
}

export interface AgentHeartbeatEntry {
  agentId: string;
  workspacePath: string;
  config: AgentHeartbeatConfig;
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  lastRunAt: number | null;
  lastResult: 'ok' | 'active' | 'error' | null;
}

interface HeartbeatRunnerDeps {
  configPath: string;               // .prometheus/heartbeat/config.json
  handleChat: (
    message: string,
    sessionId: string,
    sendSSE: (event: string, data: any) => void,
    pinnedMessages?: Array<{ role: string; content: string }>,
    abortSignal?: { aborted: boolean },
    callerContext?: string,
    modelOverride?: string,
    executionMode?: 'interactive' | 'background_task' | 'heartbeat' | 'cron',
    toolFilter?: string[],
  ) => Promise<{ type: string; text: string; thinking?: string }>;
  getMainSessionId: () => string;
  broadcast?: (data: object) => void;
  deliverChannels?: (text: string) => Promise<void> | void;
  reviewAllTeams?: () => Promise<{ reviewed: number; failed: number }>;
  /** Resolve a named agent's workspace path */
  resolveAgentWorkspace?: (agentId: string) => string | null;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_SYSTEM: SystemHeartbeatConfig = {
  activeHoursStart: 0,
  activeHoursEnd: 24,
  reviewTeamsAfterRun: false,
};

const DEFAULT_AGENT: AgentHeartbeatConfig = {
  enabled: false,
  intervalMinutes: 30,
  model: '',
};

// ─── Persistence helpers ───────────────────────────────────────────────────────

interface PersistedConfig {
  system: SystemHeartbeatConfig;
  agents: Record<string, AgentHeartbeatConfig>;
}

function loadPersistedConfig(configPath: string): PersistedConfig {
  try {
    if (!fs.existsSync(configPath)) return { system: { ...DEFAULT_SYSTEM }, agents: {} };
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    // Back-compat: very old flat format (pre-system key)
    if (!raw.global && !raw.system && (raw.enabled !== undefined || raw.intervalMinutes !== undefined)) {
      return {
        system: {
          activeHoursStart: raw.activeHoursStart ?? DEFAULT_SYSTEM.activeHoursStart,
          activeHoursEnd: raw.activeHoursEnd ?? DEFAULT_SYSTEM.activeHoursEnd,
          reviewTeamsAfterRun: raw.reviewTeamsAfterRun ?? false,
        },
        agents: {
          main: {
            enabled: raw.enabled ?? false,
            intervalMinutes: clampInterval(raw.intervalMinutes),
            model: raw.model ?? '',
          },
        },
      };
    }

    // Back-compat: old format used "global" key — migrate to "system" + agents.main
    if (raw.global && !raw.system) {
      const g = raw.global;
      const existingAgents = raw.agents || {};
      if (!existingAgents.main) {
        existingAgents.main = {
          enabled: g.enabled ?? false,
          intervalMinutes: clampInterval(g.intervalMinutes),
          model: g.model ?? '',
        };
      }
      return {
        system: {
          activeHoursStart: g.activeHoursStart ?? DEFAULT_SYSTEM.activeHoursStart,
          activeHoursEnd: g.activeHoursEnd ?? DEFAULT_SYSTEM.activeHoursEnd,
          reviewTeamsAfterRun: g.reviewTeamsAfterRun ?? false,
        },
        agents: existingAgents,
      };
    }

    return {
      system: { ...DEFAULT_SYSTEM, ...(raw.system || {}) },
      agents: raw.agents || {},
    };
  } catch {
    return { system: { ...DEFAULT_SYSTEM }, agents: {} };
  }
}

function savePersistedConfig(configPath: string, data: PersistedConfig): void {
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const tmp = `${configPath}.tmp-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, configPath);
  } catch (err: any) {
    console.warn('[HeartbeatRunner] Failed to save config:', err?.message);
  }
}

function clampInterval(raw: any): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(1, Math.min(1440, Math.floor(n))) : DEFAULT_AGENT.intervalMinutes;
}

// ─── Heartbeat content helpers ────────────────────────────────────────────────

function readHeartbeatMd(workspacePath: string): string | null {
  const mdPath = path.join(workspacePath, 'HEARTBEAT.md');
  try {
    if (!fs.existsSync(mdPath)) return null;
    return fs.readFileSync(mdPath, 'utf-8');
  } catch {
    return null;
  }
}

function isHeartbeatEffectivelyEmpty(raw: string): boolean {
  const lines = String(raw || '').split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('#')) continue;
    if (t.startsWith('//')) continue;
    if (/^<!--.*-->$/.test(t)) continue;
    if (/^[-*+]\s*(\[[ xX]\])?\s*$/.test(t)) continue;
    if (/^## (What to do|Example Tasks|Rules)\b/.test(t)) continue;
    if (/^- (Check for new trends|Post a draft|Update USER\.md or SOUL\.md)\b/.test(t)) continue;
    if (/^- (Always write outputs|If nothing|Keep runs under)\b/.test(t)) continue;
    return false;
  }
  return true;
}

// ─── SubagentHeartbeatManager ─────────────────────────────────────────────────

export class SubagentHeartbeatManager {
  private deps: HeartbeatRunnerDeps;
  private configPath: string;
  private persisted: PersistedConfig;
  private agents: Map<string, AgentHeartbeatEntry> = new Map();

  constructor(deps: HeartbeatRunnerDeps) {
    this.deps = deps;
    this.configPath = deps.configPath;
    this.persisted = loadPersistedConfig(this.configPath);
  }

  // ─── Public: merged config view (back-compat with API routes) ────────────────

  /**
   * Returns a merged GlobalHeartbeatConfig view: main agent config + system settings.
   * Used by existing API routes without breaking changes.
   */
  getConfig(): GlobalHeartbeatConfig {
    const main = this.getAgentConfig('main');
    return {
      enabled: main.enabled,
      intervalMinutes: main.intervalMinutes,
      model: main.model || '',
      activeHoursStart: this.persisted.system.activeHoursStart,
      activeHoursEnd: this.persisted.system.activeHoursEnd,
      reviewTeamsAfterRun: this.persisted.system.reviewTeamsAfterRun,
    };
  }

  /**
   * Updates the merged config. Agent-specific fields (enabled, intervalMinutes, model)
   * go to agents.main; system fields (activeHours*, reviewTeamsAfterRun) go to system.
   */
  updateConfig(partial: Partial<GlobalHeartbeatConfig>): GlobalHeartbeatConfig {
    // Split into per-agent vs system fields
    const agentPartial: Partial<AgentHeartbeatConfig> = {};
    if (partial.enabled !== undefined) agentPartial.enabled = partial.enabled;
    if (partial.intervalMinutes !== undefined) agentPartial.intervalMinutes = partial.intervalMinutes;
    if (partial.model !== undefined) agentPartial.model = partial.model;
    if (Object.keys(agentPartial).length > 0) this.updateAgentConfig('main', agentPartial);

    const systemPartial: Partial<SystemHeartbeatConfig> = {};
    if (partial.activeHoursStart !== undefined) systemPartial.activeHoursStart = partial.activeHoursStart;
    if (partial.activeHoursEnd !== undefined) systemPartial.activeHoursEnd = partial.activeHoursEnd;
    if (partial.reviewTeamsAfterRun !== undefined) systemPartial.reviewTeamsAfterRun = partial.reviewTeamsAfterRun;
    if (Object.keys(systemPartial).length > 0) {
      this.persisted.system = { ...this.persisted.system, ...systemPartial };
      savePersistedConfig(this.configPath, this.persisted);
    }

    return this.getConfig();
  }

  /** Get the system-level settings (active hours, reviewTeamsAfterRun) */
  getSystemConfig(): SystemHeartbeatConfig {
    return { ...this.persisted.system };
  }

  // ─── Public: per-agent config ─────────────────────────────────────────────

  getAgentConfig(agentId: string): AgentHeartbeatConfig {
    return { ...DEFAULT_AGENT, ...(this.persisted.agents[agentId] || {}) };
  }

  /** Called by the AI tool `update_heartbeat` and the settings UI */
  updateAgentConfig(agentId: string, partial: Partial<AgentHeartbeatConfig>): AgentHeartbeatConfig {
    const current = this.getAgentConfig(agentId);
    const next: AgentHeartbeatConfig = {
      ...current,
      ...partial,
      intervalMinutes: partial.intervalMinutes !== undefined
        ? clampInterval(partial.intervalMinutes)
        : current.intervalMinutes,
    };
    this.persisted.agents[agentId] = next;
    savePersistedConfig(this.configPath, this.persisted);

    // Restart that agent's timer
    const entry = this.agents.get(agentId);
    if (entry) {
      entry.config = next;
      this._stopTimer(entry);
      this._scheduleNext(entry);
    }

    console.log(`[HeartbeatRunner] Agent "${agentId}" config updated:`, next);
    return next;
  }

  /** Return all registered agents and their configs — used by the settings UI */
  listAgentConfigs(): Array<{ agentId: string; config: AgentHeartbeatConfig; lastRunAt: number | null; lastResult: string | null }> {
    const out: Array<{ agentId: string; config: AgentHeartbeatConfig; lastRunAt: number | null; lastResult: string | null }> = [];
    for (const [agentId, entry] of this.agents) {
      out.push({ agentId, config: entry.config, lastRunAt: entry.lastRunAt, lastResult: entry.lastResult });
    }
    return out;
  }

  // ─── Agent registration ───────────────────────────────────────────────────

  /**
   * Register an agent for heartbeat management.
   * Call this on startup for main + each subagent that exists on disk.
   * Agents with enabled=false in config will be registered but not ticking.
   */
  registerAgent(agentId: string, workspacePath: string): void {
    if (this.agents.has(agentId)) {
      // Update workspace path if it changed
      const entry = this.agents.get(agentId)!;
      entry.workspacePath = workspacePath;
      return;
    }

    const config = this.getAgentConfig(agentId);
    const entry: AgentHeartbeatEntry = {
      agentId,
      workspacePath,
      config,
      timer: null,
      running: false,
      lastRunAt: null,
      lastResult: null,
    };
    this.agents.set(agentId, entry);
    console.log(`[HeartbeatRunner] Registered agent "${agentId}" (enabled=${config.enabled}, interval=${config.intervalMinutes}min)`);
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  start(): void {
    for (const entry of this.agents.values()) {
      this._scheduleNext(entry);
    }
    const enabled = [...this.agents.values()].filter(e => e.config.enabled).length;
    console.log(`[HeartbeatRunner] Started — ${this.agents.size} agent(s) registered, ${enabled} enabled`);
  }

  stop(): void {
    for (const entry of this.agents.values()) {
      this._stopTimer(entry);
    }
  }

  /** Manually trigger a heartbeat for a specific agent (used by tasks router) */
  async tick(agentId: string): Promise<void> {
    const entry = this.agents.get(agentId);
    if (!entry) {
      console.warn(`[HeartbeatRunner] tick() called for unregistered agent "${agentId}"`);
      return;
    }
    await this._runHeartbeat(entry);
  }

  // ─── Internal scheduling ──────────────────────────────────────────────────

  private _stopTimer(entry: AgentHeartbeatEntry): void {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
  }

  private _effectiveInterval(entry: AgentHeartbeatEntry): number {
    const agentMinutes = entry.config.intervalMinutes || DEFAULT_AGENT.intervalMinutes;
    return Math.max(60_000, clampInterval(agentMinutes) * 60_000);
  }

  private _scheduleNext(entry: AgentHeartbeatEntry): void {
    this._stopTimer(entry);

    // Only schedule if this specific agent is enabled
    if (!entry.config.enabled) return;

    const delayMs = this._effectiveInterval(entry);
    entry.timer = setTimeout(() => {
      this._runHeartbeat(entry).catch(err =>
        console.warn(`[HeartbeatRunner] Tick error for "${entry.agentId}":`, err?.message)
      );
    }, delayMs);

    if (entry.timer && typeof (entry.timer as any).unref === 'function') {
      (entry.timer as any).unref();
    }
  }

  private _isWithinActiveHours(): boolean {
    const { activeHoursStart, activeHoursEnd } = this.persisted.system;
    // If full day configured (0 to 24), always active
    if (activeHoursStart === 0 && activeHoursEnd >= 24) return true;
    const hour = new Date().getHours();
    if (activeHoursStart <= activeHoursEnd) return hour >= activeHoursStart && hour < activeHoursEnd;
    return hour >= activeHoursStart || hour < activeHoursEnd;
  }

  private _resumePausedTasks(): void {
    try {
      const allTasks = listTaskSummaries();
      const paused = allTasks.filter(
        t => t.status === 'paused' && (t as any).pausedByScheduleId && (t as any).shouldResumeAfterSchedule,
      );
      for (const task of paused) {
        BackgroundTaskRunner.resumeTaskAfterSchedule(task.id, (task as any).pausedByScheduleId);
      }
    } catch { /* non-fatal */ }
  }

  private async _runHeartbeat(entry: AgentHeartbeatEntry): Promise<void> {
    // Skip if:
    // 1. This agent is already running
    // 2. Outside active hours (only applies to agents, not if user manually triggers)
    if (entry.running) {
      this._scheduleNext(entry);
      return;
    }
    if (!this._isWithinActiveHours()) {
      this._scheduleNext(entry);
      return;
    }

    // Resume any background tasks paused by schedules
    this._resumePausedTasks();

    entry.running = true;
    entry.lastRunAt = Date.now();

    // Build prompt from HEARTBEAT.md
    const rawMd = readHeartbeatMd(entry.workspacePath);
    const isEmpty = !rawMd || isHeartbeatEffectivelyEmpty(rawMd);

    if (isEmpty) {
      // Nothing to do — reschedule silently
      entry.running = false;
      entry.lastResult = 'ok';
      this._scheduleNext(entry);
      return;
    }

    const prompt = rawMd!.trim();
    const sessionId = `heartbeat_${entry.agentId}`;
    const abortSignal = { aborted: false };
    const runtimeId = registerLiveRuntime({
      kind: 'heartbeat',
      label: `Heartbeat - ${entry.agentId}`,
      sessionId,
      agentId: entry.agentId,
      source: 'system',
      detail: prompt.slice(0, 160),
      abortSignal,
    });

    // Effective model: per-agent override → main agent model → default
    const modelOverride =
      (entry.config.model?.trim() || this.getAgentConfig('main').model?.trim() || undefined);

    const sendSSE = (event: string, data: any): void => {
      if (!this.deps.broadcast) return;
      if (['tool_call', 'tool_result', 'thinking', 'info'].includes(event)) {
        this.deps.broadcast({
          type: 'heartbeat_sse',
          agentId: entry.agentId,
          event,
          data,
        });
      }
    };

    try {
      const result = await this.deps.handleChat(
        prompt,
        sessionId,
        sendSSE,
        undefined,
        abortSignal,
        `CONTEXT: Internal HEARTBEAT tick for agent "${entry.agentId}". Read HEARTBEAT.md instructions and execute them. If nothing is actionable, reply HEARTBEAT_OK.`,
        modelOverride,
        'heartbeat',
      );
      if (abortSignal.aborted) {
        entry.lastResult = 'error';
        return;
      }

      const rawText = String(result?.text || '').trim();
      const isOk = /^\s*HEARTBEAT_OK\s*$/i.test(rawText || 'HEARTBEAT_OK');
      entry.lastResult = isOk ? 'ok' : 'active';

      let finalText = rawText || 'HEARTBEAT_OK';

      // Only for the main agent: optionally review teams
      const isMain = entry.agentId === 'main' || entry.agentId === 'default';
      if (isMain && !isOk && this.persisted.system.reviewTeamsAfterRun && this.deps.reviewAllTeams) {
        try {
          const review = await this.deps.reviewAllTeams();
          if (review.reviewed > 0 || review.failed > 0) {
            finalText += `\n\n[Team Reviews] Reviewed: ${review.reviewed} Failed: ${review.failed}`;
          }
        } catch { /* non-fatal */ }
      }

      // Build automated session for the UI
      const automatedSession = {
        id: `heartbeat_${entry.agentId}_${Date.now()}`,
        title: `💓 ${entry.agentId} — ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
        jobName: 'Heartbeat',
        jobId: `heartbeat_${entry.agentId}`,
        agentId: entry.agentId,
        automated: true as const,
        createdAt: Date.now(),
        history: [
          { role: 'user', content: `[Heartbeat: ${entry.agentId}]\n\n${prompt.slice(0, 3000)}` },
          { role: 'ai', content: finalText },
        ],
      };

      // Always broadcast heartbeat_done (UI uses it to update last-run indicators)
      this.deps.broadcast?.({
        type: 'heartbeat_done',
        agentId: entry.agentId,
        isOk,
        text: isOk ? '' : finalText.slice(0, 8000),
        at: Date.now(),
        automatedSession: isOk ? null : automatedSession,
      });

      // Deliver to channels only if there is real content
      if (!isOk && finalText.trim() && this.deps.deliverChannels) {
        const msg = `💓 Heartbeat [${entry.agentId}]\n\n${finalText}`;
        Promise.resolve(this.deps.deliverChannels(msg)).catch(() => {});
      }

      // Always prune one-off task blocks from HEARTBEAT.md after a run.
      // If the agent executed queued one-off tasks (from the manager), strip
      // those blocks so they never repeat on the next heartbeat tick.
      // This is a no-op if no one-off blocks are present.
      try {
        pruneHeartbeatOneOffTasks(entry.agentId);
      } catch { /* non-fatal */ }

    } catch (err: any) {
      entry.lastResult = 'error';
      console.warn(`[HeartbeatRunner] Heartbeat failed for "${entry.agentId}":`, err?.message);
    } finally {
      finishLiveRuntime(runtimeId);
      entry.running = false;
      this._scheduleNext(entry);
    }
  }
}

// ─── Global instance accessor ────────────────────────────────────────────────
// Allows team-manager-runner and other modules to access the running instance
// without full dependency injection (mirrors setSchedulerBroadcast pattern).

let _globalInstance: SubagentHeartbeatManager | null = null;

export function setHeartbeatRunnerInstance(r: SubagentHeartbeatManager): void {
  _globalInstance = r;
}

export function getHeartbeatRunnerInstance(): SubagentHeartbeatManager | null {
  return _globalInstance;
}

// ─── Back-compat alias ────────────────────────────────────────────────────────
export { SubagentHeartbeatManager as HeartbeatRunner };
