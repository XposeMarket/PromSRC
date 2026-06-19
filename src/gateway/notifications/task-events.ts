import { sendWebPushToAll } from './web-push';
import type { TaskRecord } from '../tasks/task-store';

export type TaskPushStatus = 'complete' | 'failed' | 'paused' | 'needs_assistance' | 'awaiting_user_input';

function cleanText(input: string | undefined, max = 220): string {
  return String(input || '')
    .replace(/\[[A-Z_]+[^\]]*\]/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_`>~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function taskKind(task: TaskRecord): 'team' | 'subagent' | 'scheduled' | 'run_once' | 'task' {
  if (task.teamSubagent?.teamId || task.proposalExecution?.teamExecution?.teamId) return 'team';
  if (task.subagentProfile) return 'subagent';
  if (task.scheduleId || task.taskKind === 'scheduled' || /^schedule_|^cron_/i.test(String(task.sessionId || ''))) return 'scheduled';
  if (task.taskKind === 'run_once') return 'run_once';
  return 'task';
}

function labelFor(task: TaskRecord, status: TaskPushStatus): string {
  const kind = taskKind(task);
  if (kind === 'team') {
    if (status === 'complete') return 'Team task complete';
    if (status === 'failed') return 'Team task failed';
    return 'Team task needs attention';
  }
  if (kind === 'subagent') {
    if (status === 'complete') return 'Subagent finished';
    if (status === 'failed') return 'Subagent failed';
    return 'Subagent needs attention';
  }
  if (kind === 'scheduled') {
    if (status === 'complete') return 'Scheduled job complete';
    if (status === 'failed') return 'Scheduled job failed';
    return 'Scheduled job paused';
  }
  if (status === 'complete') return 'Task complete';
  if (status === 'failed') return 'Task failed';
  if (status === 'awaiting_user_input') return 'Task needs your reply';
  return 'Task paused';
}

function taskUrl(task: TaskRecord): string {
  if (task.teamSubagent?.teamId || task.proposalExecution?.teamExecution?.teamId) {
    const teamId = task.teamSubagent?.teamId || task.proposalExecution?.teamExecution?.teamId || '';
    return `/?source=pwa#mobile/teams/${encodeURIComponent(teamId)}`;
  }
  if (task.subagentProfile) {
    const agentId = task.teamSubagent?.agentId || task.proposalExecution?.teamExecution?.executorAgentId || '';
    return agentId
      ? `/?source=pwa#mobile/subagents/${encodeURIComponent(agentId)}`
      : `/?source=pwa#mobile/tasks/${encodeURIComponent(task.id)}`;
  }
  if (task.scheduleId || task.taskKind === 'scheduled') {
    return task.scheduleId
      ? `/?source=pwa#mobile/schedule/${encodeURIComponent(task.scheduleId)}`
      : `/?source=pwa#mobile/tasks/${encodeURIComponent(task.id)}`;
  }
  return `/?source=pwa#mobile/tasks/${encodeURIComponent(task.id)}`;
}

export function notifyTaskWebPush(
  task: TaskRecord | null | undefined,
  status: TaskPushStatus,
  detail?: string,
): void {
  if (!task?.id) return;
  const title = labelFor(task, status);
  const taskTitle = cleanText(task.title, 120) || 'Untitled task';
  const summary = cleanText(detail || task.finalSummary || task.pendingClarificationQuestion || task.pauseReason || task.prompt, 240);
  const body = summary ? `${taskTitle}: ${summary}` : taskTitle;
  sendWebPushToAll({
    title,
    body,
    url: taskUrl(task),
    tag: `prometheus-${status}-${task.id}`,
    data: {
      kind: 'task_event',
      taskId: task.id,
      taskTitle,
      status,
      taskKind: taskKind(task),
      sessionId: task.originatingSessionId || task.sessionId || '',
      scheduleId: task.scheduleId || '',
      teamId: task.teamSubagent?.teamId || task.proposalExecution?.teamExecution?.teamId || '',
      agentId: task.teamSubagent?.agentId || task.proposalExecution?.teamExecution?.executorAgentId || '',
    },
  });
}
