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

const ASSIGNED_TASK_STATUSES = [
  'queued',
  'running',
  'paused',
  'stalled',
  'needs_assistance',
  'awaiting_user_input',
  'failed',
  'waiting_subagent',
] as const;

export function buildSubagentAssignmentBlock(subagentId: string | undefined | null): string {
  const id = String(subagentId || '').trim();
  if (!id) return '';
  // Resolve a display name if this id is a config-registered agent. Standalone
  // subagents live in .prometheus/subagents/<id> (not config.agents), so a null
  // here is fine — we don't gate on it. The block renders only when there are
  // real assignments below, which naturally excludes ephemeral one-shot spawns.
  const agent = getAgentById(id);

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
    const tasks = listTasks({ status: [...ASSIGNED_TASK_STATUSES] })
      .filter((t) => t.teamSubagent?.agentId === id || (t as any).subagentProfile === id)
      .slice(0, 12);
    for (const t of tasks) {
      const step = t.plan?.length ? ` (step ${Math.min(t.currentStepIndex + 1, t.plan.length)}/${t.plan.length})` : '';
      const taskId = String(t.id || '').trim();
      const reason = t.pauseReason ? ` reason=${t.pauseReason}` : '';
      const failure = t.status === 'failed' && t.finalSummary
        ? ` last failure: ${String(t.finalSummary).replace(/\s+/g, ' ').slice(0, 180)}`
        : '';
      const pendingQuestion = t.pendingClarificationQuestion
        ? ` pending question: ${String(t.pendingClarificationQuestion).replace(/\s+/g, ' ').slice(0, 180)}`
        : '';
      const controlHint = taskId
        ? ` Use task_control(action:"get", task_id:"${taskId}") to inspect; use task_control(action:"resume", task_id:"${taskId}") only when the user's message clearly authorizes continuing, or task_control(action:"rerun", task_id:"${taskId}") to restart after a failed run.`
        : '';
      taskLines.push(`  - "${t.title}" [${t.status}${reason}]${step} id=${taskId}.${failure}${pendingQuestion}${controlHint}`);
    }
  } catch {
    // Task store read is best-effort.
  }

  if (!scheduleLines.length && !taskLines.length) return '';

  const out: string[] = ['[YOUR ASSIGNMENTS]', `Standing work assigned to you (${agent?.name || id}, id: ${id}):`];
  if (scheduleLines.length) {
    out.push('Scheduled jobs:');
    out.push(...scheduleLines);
  }
  if (taskLines.length) {
    out.push('Assigned tasks needing attention:');
    out.push(...taskLines);
  }
  out.push('Do not treat a chat message as an implicit task resume by itself. Inspect the assigned task, then call task_control with the exact task_id when resuming/rerunning is warranted.');
  out.push('[/YOUR ASSIGNMENTS]');
  return out.join('\n');
}
