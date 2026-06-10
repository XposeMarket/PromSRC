// Shared subagent context helpers.
//
// buildSubagentAssignmentBlock surfaces the standing work a *named* subagent
// owns — scheduled jobs and active background tasks — so a subagent run knows
// what it is responsible for without having to go look. Scoped to persistent
// named subagents (those with an AgentDefinition); ephemeral background_spawn
// agents have no standing assignments and get an empty string.

import { getAgentById } from '../../config/config.js';
import { getCronSchedulerInstance } from '../scheduling/cron-scheduler.js';
import { listTasks } from '../tasks/task-store.js';

const ACTIVE_TASK_STATUSES = ['queued', 'running', 'paused', 'stalled', 'needs_assistance', 'waiting_subagent'] as const;

export function buildSubagentAssignmentBlock(subagentId: string | undefined | null): string {
  const id = String(subagentId || '').trim();
  if (!id) return '';
  const agent = getAgentById(id);
  if (!agent) return ''; // named subagents only

  const scheduleLines: string[] = [];
  try {
    const scheduler = getCronSchedulerInstance();
    const jobs = (scheduler?.getJobs() || [])
      .filter((j) => j.subagent_id === id && j.enabled !== false)
      .slice(0, 12);
    for (const j of jobs) {
      const when = j.schedule ? `cron ${j.schedule}` : j.runAt ? `at ${j.runAt}` : 'on demand';
      const next = j.nextRun ? ` — next ${j.nextRun}` : '';
      scheduleLines.push(`  - "${j.name}" (${j.type}, ${when})${next}`);
    }
  } catch {
    // Scheduler may be unavailable mid-boot; assignments are best-effort.
  }

  const taskLines: string[] = [];
  try {
    const tasks = listTasks({ status: [...ACTIVE_TASK_STATUSES] })
      .filter((t) => t.teamSubagent?.agentId === id)
      .slice(0, 12);
    for (const t of tasks) {
      const step = t.plan?.length ? ` (step ${Math.min(t.currentStepIndex + 1, t.plan.length)}/${t.plan.length})` : '';
      taskLines.push(`  - "${t.title}" [${t.status}]${step}`);
    }
  } catch {
    // Task store read is best-effort.
  }

  if (!scheduleLines.length && !taskLines.length) return '';

  const out: string[] = ['[YOUR ASSIGNMENTS]', `Standing work assigned to you (${agent.name}, id: ${id}):`];
  if (scheduleLines.length) {
    out.push('Scheduled jobs:');
    out.push(...scheduleLines);
  }
  if (taskLines.length) {
    out.push('Active tasks:');
    out.push(...taskLines);
  }
  out.push('[/YOUR ASSIGNMENTS]');
  return out.join('\n');
}
