import {
  appendJournal,
  createTask,
  loadTask,
  saveTask,
  updateTaskStatus,
  type BrainTaskJob,
  type TaskRecord,
} from './task-store.js';

export type BrainTaskBroadcast = (data: object) => void;

export interface BrainTaskMirror {
  taskId: string;
  job: BrainTaskJob;
  runId: string;
  date: string;
  broadcast: BrainTaskBroadcast;
  finished?: boolean;
}

interface CreateBrainTaskInput {
  job: BrainTaskJob;
  runId: string;
  date: string;
  sessionId: string;
  title: string;
  prompt: string;
  artifact?: string;
  broadcast: BrainTaskBroadcast;
}

interface FinishBrainTaskInput {
  success: boolean;
  summary?: string;
  error?: string;
  artifact?: string;
  artifacts?: string[];
  aborted?: boolean;
}

function safeText(value: unknown, max = 4_000): string {
  if (value == null) return '';
  if (typeof value === 'string') {
    const text = value.trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    const text = JSON.stringify(value);
    if (!text) return '';
    return text.length > max ? `${text.slice(0, max)}…` : text;
  } catch {
    const text = String(value).trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }
}

function eventAction(data: any): string {
  return String(data?.action || data?.name || data?.toolName || '').trim();
}

function eventVisibility(data: any): string {
  return String(data?.visibility || data?.extra?.visibility || '').trim().toLowerCase();
}

function emit(mirror: BrainTaskMirror, data: object): void {
  try {
    mirror.broadcast(data);
  } catch (error: any) {
    console.warn('[BrainTaskMirror] Broadcast failed:', error?.message || error);
  }
}

function append(mirror: BrainTaskMirror, entry: Parameters<typeof appendJournal>[1]): void {
  try {
    appendJournal(mirror.taskId, entry);
  } catch (error: any) {
    // Task mirroring must never interrupt the Brain run itself.
    console.warn('[BrainTaskMirror] Journal append failed:', error?.message || error);
  }
}

function jobLabel(job: BrainTaskJob): string {
  if (job === 'thought') return 'Brain Thought';
  if (job === 'dream_cleanup') return 'Brain Dream Cleanup';
  return 'Brain Dream';
}

function visibleReasoningEvent(event: string, data: any): boolean {
  const visibility = eventVisibility(data);
  if (visibility === 'private' || visibility === 'internal') return false;
  if (event === 'agent_thought') return true;
  return !visibility || visibility === 'user';
}

function progressText(data: any): string {
  const items = Array.isArray(data?.items)
    ? data.items
      .map((item: any) => String(item?.label || item?.text || item?.title || '').trim())
      .filter(Boolean)
      .slice(-8)
    : [];
  return [
    String(data?.reason || '').trim(),
    items.length ? items.join(' | ') : '',
  ].filter(Boolean).join(': ');
}

export function createBrainTask(input: CreateBrainTaskInput): BrainTaskMirror | null {
  try {
    const label = jobLabel(input.job);
    const task = createTask({
      title: input.title,
      prompt: input.prompt,
      originalAssignment: input.prompt,
      sessionId: input.sessionId,
      channel: 'web',
      brainJob: input.job,
      brainRunId: input.runId,
      brainDate: input.date,
      brainArtifact: input.artifact,
      plan: [{
        index: 0,
        description: `${label} run for ${input.date}`,
        status: 'running',
      }],
    });
    const mirror: BrainTaskMirror = {
      taskId: task.id,
      job: input.job,
      runId: input.runId,
      date: input.date,
      broadcast: input.broadcast,
    };
    updateTaskStatus(task.id, 'running');
    append(mirror, {
      type: 'resume',
      content: `${label} run started.`,
      detail: `Run ${input.runId} · session ${input.sessionId}`,
    });
    emit(mirror, {
      type: 'task_running',
      taskId: task.id,
      brainJob: input.job,
      brainRunId: input.runId,
      date: input.date,
      title: input.title,
    });
    emit(mirror, {
      type: 'task_panel_update',
      taskId: task.id,
      brainJob: input.job,
    });
    return mirror;
  } catch (error: any) {
    console.warn('[BrainTaskMirror] Could not create Brain task:', error?.message || error);
    return null;
  }
}

/**
 * Persist the same meaningful stream boundaries that regular background tasks
 * persist, while forwarding the raw event as task_stream_event so desktop
 * clients can follow the live run without knowing it came from Brain.
 */
export function mirrorBrainStreamEvent(
  mirror: BrainTaskMirror | null,
  event: string,
  data: any,
): void {
  if (!mirror || mirror.finished) return;
  const eventType = String(event || '').trim();
  if (!eventType) return;

  emit(mirror, {
    type: 'task_stream_event',
    taskId: mirror.taskId,
    eventType,
    data,
    brainJob: mirror.job,
    brainRunId: mirror.runId,
  });

  // Heartbeats and token deltas are intentionally transport-only. Persisting
  // each one would make the journal noisy and would block model streaming on
  // synchronous task-file writes.
  if (eventType === 'heartbeat' || eventType === 'token' || eventType === 'thinking_delta') return;

  const visibility = eventVisibility(data);
  if ((eventType === 'thinking' || eventType === 'agent_thought') && !visibleReasoningEvent(eventType, data)) return;
  if (eventType === 'reasoning_summary' || eventType === 'reasoning_summary_delta' || eventType === 'reasoning_delta') {
    if (visibility !== 'user') return;
  }

  const action = eventAction(data);
  if (eventType === 'token_narration_boundary') {
    const text = safeText(data?.text || data?.message || data?.narration, 4_000);
    if (text) {
      append(mirror, {
        type: 'reasoning',
        content: text.slice(0, 1_200),
        detail: text.length > 1_200 ? text : undefined,
      });
      emit(mirror, { type: 'task_reasoning', taskId: mirror.taskId, text: text.slice(0, 1_200), reasoningKind: 'full_thought' });
    }
  } else if (eventType === 'thinking' || eventType === 'agent_thought'
    || eventType === 'reasoning_summary' || eventType === 'reasoning_summary_delta' || eventType === 'reasoning_delta') {
    const text = safeText(data?.thinking || data?.text || data?.summary || data?.message, 4_000);
    if (text) {
      append(mirror, {
        type: 'reasoning',
        content: text.slice(0, 1_200),
        detail: text.length > 1_200 ? text : undefined,
      });
      emit(mirror, { type: 'task_reasoning', taskId: mirror.taskId, text: text.slice(0, 1_200), reasoningKind: eventType.startsWith('reasoning_') ? 'summary' : 'full_thought' });
    }
  } else if (eventType === 'tool_call') {
    const args = safeText(data?.args || {}, 8_000);
    append(mirror, {
      type: 'tool_call',
      content: `${action || 'unknown'}(${args.slice(0, 160)})`,
      detail: args,
    });
    emit(mirror, { type: 'task_tool_call', taskId: mirror.taskId, tool: action, args: data?.args, brainJob: mirror.job });
  } else if (eventType === 'tool_result') {
    const result = safeText(data?.result ?? data?.output, 12_000);
    const prefix = action ? `${action}: ` : '';
    append(mirror, {
      type: data?.error ? 'error' : 'tool_result',
      content: `${prefix}${(result || 'Tool complete').slice(0, 240)}${data?.error ? ' [ERROR]' : ''}`,
      detail: result || undefined,
    });
    emit(mirror, {
      type: 'task_tool_result',
      taskId: mirror.taskId,
      tool: action,
      args: data?.args,
      result: result.slice(0, 1_000),
      error: data?.error === true,
      brainJob: mirror.job,
    });
  } else if (eventType === 'progress_state') {
    const items = Array.isArray(data?.items)
      ? data.items.slice(0, 12).map((item: any, index: number) => ({
        id: String(item?.id || `p${index + 1}`),
        text: String(item?.text || item?.label || item?.title || `Step ${index + 1}`).slice(0, 160),
        status: String(item?.status || 'pending').toLowerCase(),
      }))
      : [];
    try {
      const task = loadTask(mirror.taskId);
      if (task && items.length) {
        task.runtimeProgress = {
          source: data?.source === 'preflight' || data?.source === 'tool_sequence' ? data.source : 'none',
          activeIndex: Number.isFinite(Number(data?.activeIndex)) ? Number(data.activeIndex) : -1,
          items: items as any,
          updatedAt: Date.now(),
        };
        task.plan = items.slice(0, task.maxPlanDepth || 20).map((item: any, index: number) => ({
          index,
          description: item.text,
          status: item.status === 'in_progress' || item.status === 'running'
            ? 'running'
            : item.status === 'done' || item.status === 'complete'
              ? 'done'
              : item.status === 'failed'
                ? 'failed'
                : item.status === 'skipped'
                  ? 'skipped'
                  : 'pending',
        }));
        const activeIndex = Number(task.runtimeProgress.activeIndex);
        if (Number.isFinite(activeIndex) && activeIndex >= 0) {
          task.currentStepIndex = Math.min(activeIndex, Math.max(0, task.plan.length - 1));
        }
        saveTask(task);
      }
    } catch (error: any) {
      console.warn('[BrainTaskMirror] Progress persistence failed:', error?.message || error);
    }
    const text = progressText(data);
    if (text) append(mirror, { type: 'status_push', content: `Progress: ${text}` });
  } else if (eventType === 'error' || eventType === 'warn') {
    const text = safeText(data?.message || data?.text || data?.error || data?.result, 4_000);
    if (text) append(mirror, { type: 'error', content: text.slice(0, 1_200), detail: text.length > 1_200 ? text : undefined });
  } else if (eventType !== 'model_stream_event') {
    const text = safeText(data?.message || data?.text || data?.summary || data?.result, 4_000);
    if (text) append(mirror, { type: 'status_push', content: `${eventType}: ${text.slice(0, 1_200)}`, detail: text.length > 1_200 ? text : undefined });
  }

  emit(mirror, { type: 'task_panel_update', taskId: mirror.taskId, brainJob: mirror.job });
}

export function finishBrainTask(
  mirror: BrainTaskMirror | null,
  input: FinishBrainTaskInput,
): TaskRecord | null {
  if (!mirror || mirror.finished) return null;
  const current = loadTask(mirror.taskId);
  if (!current) return null;
  mirror.finished = true;

  try {
    const label = jobLabel(mirror.job);
    const artifactPaths = [input.artifact, ...(input.artifacts || [])]
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    const summaryParts = [
      input.aborted ? `${label} run aborted.` : input.success ? `${label} run completed successfully.` : `${label} run failed.`,
      String(input.summary || '').trim(),
      input.error ? `Error: ${String(input.error).trim()}` : '',
      artifactPaths.length ? `Artifacts: ${artifactPaths.join(' · ')}` : '',
    ].filter(Boolean);
    const finalSummary = summaryParts.join('\n\n').slice(0, 12_000);

    current.brainArtifact = artifactPaths[0] || current.brainArtifact;
    const finalStep = current.plan[current.plan.length - 1];
    if (finalStep) {
      finalStep.status = input.success ? 'done' : 'failed';
      finalStep.completedAt = Date.now();
      if (!input.success && input.error) finalStep.notes = String(input.error).slice(0, 500);
    }
    current.finalSummary = finalSummary;
    saveTask(current);
    const updated = updateTaskStatus(mirror.taskId, input.success ? 'complete' : 'failed', { finalSummary });
    append(mirror, {
      type: input.success ? 'status_push' : 'error',
      content: input.success ? `${label} run complete.` : `${label} run failed: ${String(input.error || input.summary || 'Unknown error').slice(0, 1_200)}`,
      detail: finalSummary,
    });

    emit(mirror, {
      type: 'task_stream_event',
      taskId: mirror.taskId,
      eventType: input.success ? 'done' : 'error',
      data: { text: finalSummary, brainJob: mirror.job, brainRunId: mirror.runId },
    });
    emit(mirror, {
      type: input.success ? 'task_complete' : 'task_failed',
      taskId: mirror.taskId,
      summary: finalSummary,
      error: input.success ? undefined : String(input.error || '').slice(0, 2_000) || undefined,
      brainJob: mirror.job,
      brainRunId: mirror.runId,
    });
    emit(mirror, { type: 'task_panel_update', taskId: mirror.taskId, brainJob: mirror.job });
    return updated || loadTask(mirror.taskId);
  } catch (error: any) {
    console.warn('[BrainTaskMirror] Could not finalize Brain task:', error?.message || error);
    return null;
  }
}
