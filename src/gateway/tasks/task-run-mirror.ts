import {
  appendJournal,
  loadTask,
  mutatePlan,
  saveTask,
  updateTaskRuntimeProgress,
  type TaskPlanStep,
} from './task-store';

export interface TaskRunBinding {
  taskId: string;
  source?: string;
  scheduleId?: string;
  teamId?: string;
  agentId?: string;
}

const activeTaskRunsBySession = new Map<string, TaskRunBinding>();

function normalizeSessionId(sessionId: string): string {
  return String(sessionId || '').trim();
}

export function bindTaskRunToSession(sessionId: string, binding: TaskRunBinding): void {
  const sid = normalizeSessionId(sessionId);
  const taskId = String(binding?.taskId || '').trim();
  if (!sid || !taskId) return;
  activeTaskRunsBySession.set(sid, { ...binding, taskId });
}

export function clearTaskRunBinding(sessionId: string, taskId?: string): void {
  const sid = normalizeSessionId(sessionId);
  if (!sid) return;
  const current = activeTaskRunsBySession.get(sid);
  if (!current) return;
  if (taskId && current.taskId !== taskId) return;
  activeTaskRunsBySession.delete(sid);
}

export function getTaskRunBinding(sessionId: string): TaskRunBinding | undefined {
  const sid = normalizeSessionId(sessionId);
  if (!sid) return undefined;
  return activeTaskRunsBySession.get(sid);
}

function toPlanStatus(status: any): TaskPlanStep['status'] {
  const value = String(status || '').toLowerCase();
  if (value === 'in_progress' || value === 'running') return 'running';
  if (value === 'done' || value === 'complete') return 'done';
  if (value === 'failed') return 'failed';
  if (value === 'skipped') return 'skipped';
  return 'pending';
}

export function setTaskPlanFromProgress(taskId: string, data: any): void {
  const items = Array.isArray(data?.items) ? data.items : [];
  if (!items.length) return;
  const task = loadTask(taskId);
  if (!task) return;
  task.plan = items.slice(0, task.maxPlanDepth || 20).map((item: any, index: number) => ({
    index,
    description: String(item?.text || `Step ${index + 1}`).slice(0, 240),
    status: toPlanStatus(item?.status),
  }));
  const activeIndex = Number(data?.activeIndex);
  task.currentStepIndex = Number.isFinite(activeIndex) && activeIndex >= 0
    ? Math.min(activeIndex, Math.max(0, task.plan.length - 1))
    : task.currentStepIndex;
  task.lastProgressAt = Date.now();
  saveTask(task);
}

export function setTaskPlanFromDeclaredSteps(taskId: string, steps: any[]): void {
  const cleanSteps = Array.isArray(steps)
    ? steps.map((step) => String(step || '').trim()).filter(Boolean).slice(0, 8)
    : [];
  if (!cleanSteps.length) return;
  const task = loadTask(taskId);
  if (!task) return;
  task.plan = cleanSteps.map((description, index) => ({
    index,
    description: description.slice(0, 240),
    status: index === 0 ? 'running' : 'pending',
  }));
  task.currentStepIndex = 0;
  task.lastProgressAt = Date.now();
  saveTask(task);
}

export function completeNextOpenTaskStep(taskId: string, note?: string): void {
  const task = loadTask(taskId);
  if (!task) return;
  const idx = task.plan.findIndex((step) => step.status === 'running' || step.status === 'pending');
  if (idx < 0) return;
  mutatePlan(taskId, [{
    op: 'complete',
    step_index: idx,
    notes: note ? String(note).slice(0, 500) : undefined,
  }]);
}

export function mirrorChatEventToTask(
  taskId: string,
  event: string,
  data: any,
  broadcast?: (data: any) => void,
  opts?: { scheduleId?: string; teamId?: string; agentId?: string; agentName?: string },
): void {
  try {
    if (!taskId || !loadTask(taskId)) return;
    if (event === 'tool_call') {
      const action = String(data?.action || 'unknown');
      appendJournal(taskId, {
        type: 'tool_call',
        content: `${action}(${JSON.stringify(data?.args || {}).slice(0, 120)})`,
      });
      if (action === 'declare_plan') {
        setTaskPlanFromDeclaredSteps(taskId, Array.isArray(data?.args?.steps) ? data.args.steps : []);
      }
      broadcast?.({
        type: 'task_tool_call',
        taskId,
        tool: action,
        args: data?.args,
        scheduleId: opts?.scheduleId,
        teamId: opts?.teamId,
        agentId: opts?.agentId,
      });
      broadcast?.({ type: 'task_panel_update', taskId, teamId: opts?.teamId, agentId: opts?.agentId });
      return;
    }

    if (event === 'tool_result') {
      const action = String(data?.action || 'unknown');
      const result = String(data?.result || '');
      appendJournal(taskId, {
        type: data?.error ? 'error' : 'tool_result',
        content: `${action}: ${result.slice(0, 220)}`,
        detail: result.length > 220 || data?.error ? result.slice(0, 2000) : undefined,
      });
      broadcast?.({ type: 'task_panel_update', taskId, teamId: opts?.teamId, agentId: opts?.agentId });
      return;
    }

    if (event === 'progress_state') {
      updateTaskRuntimeProgress(taskId, {
        source: data?.source,
        activeIndex: Number(data?.activeIndex ?? -1),
        items: Array.isArray(data?.items)
          ? data.items.map((item: any, idx: number) => ({
            id: String(item?.id || `p${idx + 1}`),
            text: String(item?.text || ''),
            status: String(item?.status || 'pending') as any,
          }))
          : [],
      });
      setTaskPlanFromProgress(taskId, data);
      broadcast?.({ type: 'task_panel_update', taskId, teamId: opts?.teamId, agentId: opts?.agentId });
      return;
    }

    if (event === 'task_step_done') {
      completeNextOpenTaskStep(taskId, data?.note);
      appendJournal(taskId, { type: 'status_push', content: `Step complete signal received.` });
      broadcast?.({ type: 'task_step_done', taskId, ...data, teamId: opts?.teamId, agentId: opts?.agentId });
      broadcast?.({ type: 'task_panel_update', taskId, teamId: opts?.teamId, agentId: opts?.agentId });
      return;
    }

    if (event === 'info' || event === 'warning' || event === 'error') {
      appendJournal(taskId, {
        type: event === 'error' ? 'error' : 'status_push',
        content: String(data?.message || data?.text || event).slice(0, 500),
      });
      broadcast?.({ type: 'task_panel_update', taskId, teamId: opts?.teamId, agentId: opts?.agentId });
      return;
    }

    if (event === 'final' || event === 'done') {
      const finalText = String(data?.reply || data?.text || '').trim();
      if (!finalText) return;
      appendJournal(taskId, {
        type: 'status_push',
        content: `Final: ${finalText.slice(0, 240)}`,
        detail: finalText.slice(0, 2000),
      });
      broadcast?.({ type: 'task_panel_update', taskId, teamId: opts?.teamId, agentId: opts?.agentId });
    }
  } catch (err: any) {
    console.warn(`[TaskRunMirror] Failed to mirror ${event} into task ${taskId}:`, err?.message || err);
  }
}

export function mirrorSessionChatEvent(
  sessionId: string,
  event: string,
  data: any,
  broadcast?: (data: any) => void,
): void {
  const binding = getTaskRunBinding(sessionId);
  if (!binding?.taskId) return;
  mirrorChatEventToTask(binding.taskId, event, data, broadcast, binding);
}
