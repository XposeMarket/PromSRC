/**
 * scheduler.ts — Agent run history store.
 *
 * The agent cron scheduler has been removed. Subagent scheduling now runs
 * through CronScheduler jobs with subagent_id. This file retains only the run
 * history helpers used by scheduled jobs and team dispatch.
 */

import fs from 'fs';
import path from 'path';
import { getPrometheusLayout } from './runtime/storage-layout.js';

const layout = getPrometheusLayout();
const legacyHistoryPath = path.join(layout.legacy.activeConfig, 'agents', 'run-history.json');
const historyPath = layout.mode === 'canonical'
  ? path.join(layout.runtime.agents, 'run-history.json')
  : legacyHistoryPath;
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

function ensureCanonicalRunHistory(): void {
  if (layout.mode !== 'canonical' || fs.existsSync(historyPath) || !fs.existsSync(legacyHistoryPath)) return;
  try {
    fs.mkdirSync(path.dirname(historyPath), { recursive: true });
    fs.copyFileSync(legacyHistoryPath, historyPath, fs.constants.COPYFILE_EXCL);
  } catch {
    // The verified migration/backups remain authoritative fallback. A failed
    // compatibility copy must never overwrite an existing canonical history.
  }
}

function loadRunHistory(): AgentRunHistoryEntry[] {
  if (runHistoryCache) return runHistoryCache;
  try {
    ensureCanonicalRunHistory();
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
