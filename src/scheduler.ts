/**
 * scheduler.ts — Agent run history store.
 *
 * The agent cron scheduler has been removed. Subagent scheduling is now
 * handled exclusively by the heartbeat runner (SubagentHeartbeatManager).
 * This file retains only the run history helpers used by the heartbeat
 * runner and team dispatch to record completed agent runs.
 */

import fs from 'fs';
import path from 'path';

const historyPath = path.join(process.cwd(), '.prometheus', 'agents', 'run-history.json');
const MAX_HISTORY = 300;

export interface AgentRunHistoryEntry {
  id: string;
  agentId: string;
  agentName: string;
  trigger: 'cron' | 'manual' | 'team_dispatch' | 'heartbeat';
  taskId?: string;
  success: boolean;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  stepCount?: number;
  error?: string;
  resultPreview?: string;
}

let runHistoryCache: AgentRunHistoryEntry[] | null = null;

function loadRunHistory(): AgentRunHistoryEntry[] {
  if (runHistoryCache) return runHistoryCache;
  try {
    if (!fs.existsSync(historyPath)) {
      runHistoryCache = [];
      return runHistoryCache;
    }
    const parsed = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    runHistoryCache = Array.isArray(parsed) ? parsed : [];
  } catch {
    runHistoryCache = [];
  }
  return runHistoryCache;
}

function saveRunHistory(entries: AgentRunHistoryEntry[]): void {
  runHistoryCache = entries.slice(-MAX_HISTORY);
  try {
    fs.mkdirSync(path.dirname(historyPath), { recursive: true });
    fs.writeFileSync(historyPath, JSON.stringify(runHistoryCache, null, 2), 'utf-8');
  } catch {}
}

export function recordAgentRun(entry: Omit<AgentRunHistoryEntry, 'id'>): AgentRunHistoryEntry {
  const saved: AgentRunHistoryEntry = {
    ...entry,
    id: `ar_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
  };
  const existing = loadRunHistory();
  existing.push(saved);
  saveRunHistory(existing);
  return saved;
}

export function getAgentRunHistory(agentId?: string, limit = 30): AgentRunHistoryEntry[] {
  const all = loadRunHistory();
  const filtered = agentId ? all.filter(r => r.agentId === agentId) : all;
  return filtered.slice(-Math.max(1, limit)).reverse();
}

export function getAgentLastRun(agentId: string): AgentRunHistoryEntry | null {
  const all = loadRunHistory();
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].agentId === agentId) return all[i];
  }
  return null;
}

// ── Stubs kept for backward-compat imports that haven't been cleaned up yet ──
/** @deprecated Subagent cron scheduling moved to heartbeat runner */
export function initializeAgentSchedules(): void {}
/** @deprecated Subagent cron scheduling moved to heartbeat runner */
export function reloadAgentSchedules(): void {}
/** @deprecated Subagent cron scheduling moved to heartbeat runner */
export function stopAgentSchedules(): void {}
/** @deprecated Broadcast injection no longer needed */
export function setSchedulerBroadcast(_fn: (data: object) => void): void {}
/** @deprecated Run fn injection no longer needed */
export function setSchedulerRunAgentFn(_fn: any): void {}
