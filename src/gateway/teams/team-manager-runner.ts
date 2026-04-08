/**
 * team-manager-runner.ts — Team Coordinator Facade
 *
 * The manager AI loop has been replaced by the main Prometheus agent acting
 * as coordinator (see team-coordinator.ts). This file now:
 *   - Exports the public API consumed by teams.router.ts and server-v2.ts
 *   - Delegates triggerManagerReview / handleManagerConversation to the coordinator
 *   - Retains applyChangeToAgent for manual / UI-driven changes
 */

import fs from 'fs';
import path from 'path';
import {
  getManagedTeam,
  saveManagedTeam,
  applyTeamChange,
  getTeamForAgent,
  addTeamContextReference,
  normalizeTeamChangeType,
  type TeamChange,
} from './managed-teams';
import { getAgentById, ensureAgentWorkspace, getConfig } from '../../config/config';
import { runTeamAgentViaChat } from './team-dispatch-runtime';
import { runCoordinatorReview, runCoordinatorConversation } from './team-coordinator';

// Backward-compat no-op (server-v2.ts calls this)
export function setTeamRunAgentFn(_fn: any): void { /* no-op */ }

// ─── applyChangeToAgent helpers ───────────────────────────────────────────────

/**
 * Convert a natural-language or cron schedule string to intervalMinutes for the
 * heartbeat runner. Returns null if the input can't be mapped.
 */
function scheduleToIntervalMinutes(raw: string): number | null {
  const v = String(raw || '').trim();
  if (!v) return null;
  const lower = v.toLowerCase();

  // Natural language
  if (lower === 'daily' || lower === 'every day' || lower === 'once daily') return 1440;
  if (lower === 'hourly' || lower === 'every hour') return 60;
  if (lower === 'twice daily' || lower === 'twice a day') return 720;
  if (lower === 'weekly') return 10080;
  if (lower === 'every 2 hours') return 120;
  if (lower === 'every 3 hours') return 180;
  if (lower === 'every 4 hours') return 240;
  if (lower === 'every 6 hours') return 360;
  const everyMinMatch = lower.match(/^every\s+(\d+)\s+min/);
  if (everyMinMatch) return parseInt(everyMinMatch[1], 10);
  const everyHourMatch = lower.match(/^every\s+(\d+)\s+hour/);
  if (everyHourMatch) return parseInt(everyHourMatch[1], 10) * 60;

  // Cron expression heuristics (convert simple patterns to interval)
  const minuteInterval = v.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (minuteInterval) return parseInt(minuteInterval[1], 10);
  const hourInterval = v.match(/^0\s+\*\/(\d+)\s+\*\s+\*\s+\*$/);
  if (hourInterval) return parseInt(hourInterval[1], 10) * 60;
  if (/^0\s+\*\s+\*\s+\*\s+\*$/.test(v)) return 60;
  if (/^0\s+\d+\s+\*\s+\*\s+[*\d,]+$/.test(v)) return 1440;

  // Plain number = minutes
  const n = Number(v);
  if (Number.isFinite(n) && n >= 1 && n <= 1440) return Math.floor(n);

  return null;
}

// Kept for back-compat (resolveScheduleAfter uses it indirectly)
function normalizeScheduleValue(raw: string): string {
  const v = String(raw || '').trim();
  if (!v) return '';
  const lower = v.toLowerCase();
  if (lower === 'daily' || lower === 'every day' || lower === 'once daily') return '0 9 * * *';
  if (lower === 'hourly' || lower === 'every hour') return '0 * * * *';
  if (lower === 'twice daily' || lower === 'twice a day') return '0 9,17 * * *';
  if (lower === 'weekly') return '0 9 * * 1';
  if (lower === 'every 2 hours') return '0 */2 * * *';
  if (lower === 'every 3 hours') return '0 */3 * * *';
  if (lower === 'every 4 hours') return '0 */4 * * *';
  if (lower === 'every 6 hours') return '0 */6 * * *';
  return v;
}

function pickChangeString(obj: any, keys: string[]): string {
  if (!obj || typeof obj !== 'object') return '';
  for (const key of keys) {
    const value = obj[key];
    if (value === undefined || value === null) continue;
    const s = String(value).trim();
    if (s) return s;
  }
  return '';
}

function resolveScheduleAfter(rawAfter: any): string {
  if (typeof rawAfter === 'string' || typeof rawAfter === 'number') return String(rawAfter).trim();
  return pickChangeString(rawAfter, ['cron', 'cronSchedule', 'cron_schedule', 'schedule', 'value', 'after']);
}

function resolveMaxStepsAfter(rawAfter: any): number | null {
  if (typeof rawAfter === 'number') return Number.isFinite(rawAfter) && rawAfter > 0 ? rawAfter : null;
  const raw = typeof rawAfter === 'string'
    ? rawAfter
    : pickChangeString(rawAfter, ['maxSteps', 'max_steps', 'steps', 'value', 'after']);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function resolvePromptAfter(rawAfter: any): string {
  if (typeof rawAfter === 'string' || typeof rawAfter === 'number') return String(rawAfter).trim();
  return pickChangeString(rawAfter, [
    'prompt', 'instruction_prompt', 'instructions', 'system_prompt',
    'systemPrompt', 'system_instructions', 'value', 'text', 'after',
  ]);
}

function resolveContextAfter(rawAfter: any): { title: string; content: string } | null {
  if (typeof rawAfter === 'string' || typeof rawAfter === 'number') {
    const text = String(rawAfter).trim();
    if (!text) return null;
    return { title: 'Manager Context Update', content: text };
  }
  if (!rawAfter || typeof rawAfter !== 'object') return null;
  const title = pickChangeString(rawAfter, ['title', 'name', 'label']) || 'Manager Context Update';
  const content = pickChangeString(rawAfter, ['content', 'context', 'value', 'after', 'text']);
  if (!content) return null;
  return { title: title.slice(0, 120), content };
}

// ─── Change Application ────────────────────────────────────────────────────────

export async function applyChangeToAgent(change: TeamChange, teamId?: string): Promise<boolean> {
  try {
    const { getConfig: gc } = await import('../../config/config');
    const effectiveType = normalizeTeamChangeType((change as any).type, (change as any)?.diff?.field);
    if (!effectiveType) return false;

    if (effectiveType === 'modify_goal') {
      const resolvedTeamId = String(teamId || '').trim()
        || (change.targetSubagentId ? (getTeamForAgent(change.targetSubagentId)?.id || '') : '');
      if (!resolvedTeamId) return false;
      const newGoal = String(change?.diff?.after || '').trim();
      if (!newGoal) return false;
      const goalTeam = getManagedTeam(resolvedTeamId);
      if (!goalTeam) return false;
      const prevGoal = goalTeam.teamContext;
      goalTeam.teamContext = newGoal.slice(0, 2000);
      if (goalTeam.manager.systemPrompt?.includes(prevGoal)) {
        goalTeam.manager.systemPrompt = goalTeam.manager.systemPrompt.replace(prevGoal, newGoal.slice(0, 2000));
      }
      saveManagedTeam(goalTeam);
      if (change?.diff) {
        change.diff.before = prevGoal;
        change.diff.after = newGoal.slice(0, 2000);
      }
      return true;
    }

    if (effectiveType === 'modify_context') {
      const resolvedTeamId = String(teamId || '').trim()
        || (change.targetSubagentId ? (getTeamForAgent(change.targetSubagentId)?.id || '') : '');
      if (!resolvedTeamId) return false;
      const contextAfter = resolveContextAfter(change?.diff?.after);
      if (!contextAfter) return false;
      const created = addTeamContextReference(resolvedTeamId, {
        title: contextAfter.title,
        content: contextAfter.content,
        actor: 'manager_change',
      });
      if (!created) return false;
      if (change?.diff) {
        change.diff.after = { id: created.id, title: created.title, content: created.content };
      }
      return true;
    }

    if (!change.targetSubagentId) return false;
    const cm = gc();
    const current = cm.getConfig() as any;
    const agents = Array.isArray(current.agents) ? [...current.agents] : [];
    const idx = agents.findIndex((a: any) => a.id === change.targetSubagentId);
    if (idx === -1) return false;
    const agent = { ...agents[idx] };

    switch (effectiveType) {
      case 'modify_schedule': {
        const rawSchedule = resolveScheduleAfter(change?.diff?.after);
        const intervalMinutes = scheduleToIntervalMinutes(rawSchedule);
        if (!intervalMinutes) {
          console.warn('[TeamCoordinator] Could not convert schedule to interval minutes:', rawSchedule);
          return false;
        }
        // Update heartbeat config for this agent (enables heartbeat at the given interval)
        try {
          const { getHeartbeatRunnerInstance } = await import('../scheduling/heartbeat-runner.js');
          const runner = getHeartbeatRunnerInstance();
          if (runner) {
            runner.updateAgentConfig(change.targetSubagentId!, { enabled: true, intervalMinutes });
          } else {
            console.warn('[TeamCoordinator] Heartbeat runner not available — schedule not applied.');
          }
        } catch (e: any) {
          console.warn('[TeamCoordinator] Failed to update heartbeat config:', e.message);
        }
        if (change?.diff) change.diff.after = `every ${intervalMinutes} minutes`;
        // Return early — no agent config field to write, no save needed
        return true;
      }
      case 'modify_max_steps': {
        const maxSteps = resolveMaxStepsAfter(change?.diff?.after);
        if (maxSteps === null) return false;
        agent.maxSteps = maxSteps;
        break;
      }
      case 'modify_prompt': {
        const prompt = resolvePromptAfter(change?.diff?.after);
        if (!prompt) return false;
        const ws = ensureAgentWorkspace(agent);
        const systemPromptPath = path.join(ws, 'system_prompt.md');
        const heartbeatPath = path.join(ws, 'HEARTBEAT.md');
        const targetPath = fs.existsSync(systemPromptPath) ? systemPromptPath : heartbeatPath;
        fs.writeFileSync(targetPath, prompt, 'utf-8');
        if (change?.diff) change.diff.after = prompt;
        break;
      }
      case 'add_subagent': {
        const resolvedTeamId = String(teamId || '').trim()
          || (change.targetSubagentId ? (getTeamForAgent(change.targetSubagentId)?.id || '') : '');
        if (!resolvedTeamId) return false;
        const agentToAdd = String(change?.diff?.after || change?.targetSubagentId || '').trim();
        if (!agentToAdd) return false;
        const agentDef = getAgentById(agentToAdd);
        if (!agentDef) return false;
        const addTeam = getManagedTeam(resolvedTeamId);
        if (!addTeam) return false;
        if (addTeam.subagentIds.includes(agentToAdd)) return true;
        addTeam.subagentIds = [...addTeam.subagentIds, agentToAdd];
        saveManagedTeam(addTeam);
        return true;
      }
      case 'remove_subagent': {
        const resolvedTeamId = String(teamId || '').trim()
          || (change.targetSubagentId ? (getTeamForAgent(change.targetSubagentId)?.id || '') : '');
        if (!resolvedTeamId) return false;
        const agentToRemove = String(change?.diff?.before || change?.targetSubagentId || '').trim();
        if (!agentToRemove) return false;
        const removeTeam = getManagedTeam(resolvedTeamId);
        if (!removeTeam) return false;
        const before = removeTeam.subagentIds.length;
        removeTeam.subagentIds = removeTeam.subagentIds.filter(id => id !== agentToRemove);
        if (removeTeam.subagentIds.length === before) return false;
        saveManagedTeam(removeTeam);
        return true;
      }
      default:
        return false;
    }

    agents[idx] = agent;
    cm.updateConfig({ agents } as any);
    return true;
  } catch (err: any) {
    console.error('[TeamCoordinator] Failed to apply change:', err.message);
    return false;
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

export interface ManagerReviewResult {
  teamId: string;
  analysisPreview: string;
  changesProposed: number;
  changesAutoApplied: number;
  chatMessagePosted: boolean;
  managerToolsExecuted: number;
}

/**
 * Trigger a coordinator review for the team that owns agentId.
 * Called from scheduler.ts after recordAgentRun().
 */
export async function triggerManagerReviewForAgent(
  agentId: string,
  broadcastFn?: (data: object) => void,
): Promise<ManagerReviewResult | null> {
  const team = getTeamForAgent(agentId);
  if (!team) return null;
  if (team.manager?.paused === true) return null;
  if (team.manager.reviewTrigger === 'manual') return null;
  return triggerManagerReview(team.id, broadcastFn);
}

/**
 * Trigger a coordinator review for the given team.
 * Called from teams.router.ts and server-v2.ts.
 */
export async function triggerManagerReview(
  teamId: string,
  broadcastFn?: (data: object) => void,
): Promise<ManagerReviewResult | null> {
  const team = getManagedTeam(teamId);
  if (!team) return null;
  if (team.manager?.paused === true) {
    console.log(`[TeamCoordinator] Skipping review for paused team "${team.name}" (${team.id})`);
    return null;
  }

  console.log(`[TeamCoordinator] Running coordinator review for team "${team.name}" (${team.id})`);
  await runCoordinatorReview(teamId, broadcastFn);

  return {
    teamId,
    analysisPreview: '',
    changesProposed: 0,
    changesAutoApplied: 0,
    chatMessagePosted: false,
    managerToolsExecuted: 0,
  };
}

/**
 * Handle a user message sent in the team chat.
 * Called from teams.router.ts.
 *
 * @param autoContinue — when true, coordinator auto-loops until goal complete (used by Start button)
 */
export async function handleManagerConversation(
  teamId: string,
  userMessage: string,
  broadcastFn?: (data: object) => void,
  autoContinue: boolean = false,
): Promise<void> {
  const team = getManagedTeam(teamId);
  if (!team) return;
  await runCoordinatorConversation(teamId, userMessage, broadcastFn, autoContinue);
}
