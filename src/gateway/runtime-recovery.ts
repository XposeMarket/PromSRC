import {
  isRuntimeRecoverableAfterRestart,
  listDurableRuntimes,
  listInterruptedRuntimes,
  markActiveRuntimesInterrupted,
  markDurableRuntimeRecovered,
  type LiveRuntimeSnapshot,
} from './live-runtime-registry';
import {
  appendJournal,
  loadTask,
  saveTask,
  updateResumeContext,
  updateTaskStatus,
  type TaskRecord,
} from './tasks/task-store';
import { collectTurnFileChangesFromProcessEntries } from './file-change-summary';
import { addMessage, flushSession, getHistory, getWorkspace } from './session';

const TASK_RUNTIME_KINDS = new Set([
  'background_task',
  'background_agent',
  'subagent',
  'team_subagent',
  'proposal_execution',
]);

export interface HotRestartMainChatRecovery {
  sessionId: string;
  runtimeIds: string[];
  source?: string;
  chatId?: number;
  userId?: number;
  interruptedAt: number;
  summary: string;
}

function isTaskRuntime(runtime: LiveRuntimeSnapshot): boolean {
  return !!runtime.taskId || TASK_RUNTIME_KINDS.has(String(runtime.kind || ''));
}

function buildCheckpointText(runtime: LiveRuntimeSnapshot, reason: string): string {
  const lines = [
    '[Interrupted by gateway restart]',
    `Runtime: ${runtime.label || runtime.kind}`,
    runtime.detail ? `Work: ${runtime.detail}` : '',
    `Reason: ${reason}`,
    runtime.checkpoint?.event ? `Last event: ${runtime.checkpoint.event}` : '',
    runtime.checkpoint?.message ? `Last progress: ${String(runtime.checkpoint.message).slice(0, 1000)}` : '',
    runtime.checkpoint?.toolName ? `Last tool: ${runtime.checkpoint.toolName}` : '',
    '',
    'Prometheus saved this checkpoint before shutdown. Continue from the latest known progress instead of restarting completed work.',
  ].filter(Boolean);
  return lines.join('\n');
}

function addCheckpointMessageToSession(runtime: LiveRuntimeSnapshot, reason: string): void {
  if (!runtime.sessionId) return;
  const content = buildCheckpointText(runtime, reason);
  const recent = getHistory(runtime.sessionId, 8);
  const alreadyPresent = recent.some((msg) =>
    msg.role === 'assistant' && String(msg.content || '').trim() === content.trim()
  );
  if (alreadyPresent) return;
  const rawProcessEntries = Array.isArray(runtime.checkpoint?.processEntries)
    ? runtime.checkpoint.processEntries
    : [];
  const processEntries = rawProcessEntries
    .filter((entry) => entry && typeof entry === 'object')
    .slice(-250);
  const toolLog = processEntries.length
    ? processEntries.map((entry: any) => {
      const type = String(entry.type || 'info').toUpperCase();
      const text = String(entry.content || '').trim();
      const toolName = String(entry.extra?.toolName || entry.toolName || '').trim();
      return `[${type}]${toolName ? ` ${toolName}:` : ''} ${text}`.trim();
    }).join('\n')
    : undefined;
  const workspacePath = getWorkspace(runtime.sessionId) || process.cwd();
  const fileChanges = collectTurnFileChangesFromProcessEntries(processEntries, workspacePath);
  addMessage(runtime.sessionId, {
    role: 'assistant',
    content,
    timestamp: Date.now(),
    channel: runtime.source as any,
    channelLabel: runtime.source || 'system',
    processEntries: processEntries.length ? processEntries : undefined,
    toolLog,
    fileChanges: fileChanges || undefined,
  }, {
    disableCompactionCheck: true,
    disableMemoryFlushCheck: true,
  });
  flushSession(runtime.sessionId);
}

function pauseTaskForRestart(task: TaskRecord, runtime: LiveRuntimeSnapshot, reason: string): void {
  const current = loadTask(task.id) || task;
  if (current.status === 'complete' || current.status === 'failed') return;
  const checkpoint = buildCheckpointText(runtime, reason);
  updateResumeContext(current.id, {
    ...(current.resumeContext || {}),
    onResumeInstruction: [
      current.resumeContext?.onResumeInstruction,
      checkpoint,
      'Resume from the persisted task journal and resumeContext. Do not repeat completed steps unless verification requires it.',
    ].filter(Boolean).join('\n\n'),
  });
  updateTaskStatus(current.id, 'paused', {
    pauseReason: 'gateway_restart',
    pausedAt: Date.now(),
    pausedAtStepIndex: current.currentStepIndex,
  });
  appendJournal(current.id, {
    type: 'pause',
    content: `Paused for gateway restart. Runtime ${runtime.id} was interrupted and context was preserved.`,
    detail: JSON.stringify({ runtimeId: runtime.id, kind: runtime.kind, checkpoint: runtime.checkpoint || null }).slice(0, 6000),
  });
}

export function prepareActiveRuntimesForGatewayShutdown(reason = 'gateway_shutdown'): LiveRuntimeSnapshot[] {
  const interrupted = markActiveRuntimesInterrupted(reason);
  for (const runtime of interrupted) {
    try {
      if (isTaskRuntime(runtime) && runtime.taskId) {
        const task = loadTask(runtime.taskId);
        if (task) pauseTaskForRestart(task, runtime, reason);
        continue;
      }

      if (runtime.kind === 'main_chat' && runtime.sessionId) {
        addCheckpointMessageToSession(runtime, reason);
      }
    } catch (err: any) {
      console.warn('[runtime-recovery] Failed to prepare runtime for shutdown:', runtime.id, err?.message || err);
    }
  }
  return interrupted;
}

function shouldAutoResumeTask(task: TaskRecord): boolean {
  if (process.env.PROMETHEUS_AUTO_RESUME_INTERRUPTED_TASKS !== '1') return false;
  if (task.status !== 'paused') return false;
  if (task.pauseReason !== 'gateway_restart') return false;
  if (task.pendingClarificationQuestion) return false;
  return true;
}

function runtimeTimestamp(runtime: LiveRuntimeSnapshot): number {
  return Number(runtime.interruptedAt || runtime.updatedAt || runtime.startedAt || 0);
}

function numberOrUndefined(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  const s = String(value || '').trim();
  return s || undefined;
}

function formatRuntimeLastProgress(runtime: LiveRuntimeSnapshot, maxLen = 180): string {
  if (runtime.checkpoint?.toolName) return `last tool: ${runtime.checkpoint.toolName}`;
  if (runtime.checkpoint?.message) return `last progress: ${String(runtime.checkpoint.message).slice(0, maxLen)}`;
  if (runtime.detail) return `work: ${String(runtime.detail).slice(0, maxLen)}`;
  return '';
}

export function listHotRestartMainChatRecoveries(maxAgeMs = 30 * 60_000, sinceMs = 0): HotRestartMainChatRecovery[] {
  const cutoff = Math.max(Date.now() - Math.max(60_000, maxAgeMs), Number(sinceMs || 0));
  const runtimes = listDurableRuntimes()
    .filter((runtime) => runtime.kind === 'main_chat')
    .filter((runtime) => isRuntimeRecoverableAfterRestart(runtime))
    .filter((runtime) => !!runtime.sessionId)
    .filter((runtime) => runtimeTimestamp(runtime) >= cutoff)
    .sort((a, b) => runtimeTimestamp(b) - runtimeTimestamp(a));

  const bySession = new Map<string, { runtimes: LiveRuntimeSnapshot[] }>();
  for (const runtime of runtimes) {
    const sessionId = String(runtime.sessionId || '').trim();
    if (!sessionId) continue;
    const entry = bySession.get(sessionId) || { runtimes: [] };
    entry.runtimes.push(runtime);
    bySession.set(sessionId, entry);
  }

  return Array.from(bySession.entries())
    .map(([sessionId, entry]) => {
      const ordered = entry.runtimes.sort((a, b) => runtimeTimestamp(b) - runtimeTimestamp(a));
      const latest = ordered[0];
      const latestRecovery = latest?.recoveryData || {};
      const latestOrigin = latestRecovery.origin || {};
      const source = stringOrUndefined(latest?.source || latestOrigin.channel || latestOrigin.source);
      const chatId = numberOrUndefined(latest?.chatId ?? latestRecovery.chatId ?? latestOrigin.chatId);
      const userId = numberOrUndefined(latestRecovery.userId ?? latestOrigin.userId);
      const lines = ordered.slice(0, 4).map((runtime) => {
        const last = formatRuntimeLastProgress(runtime);
        const recovery = String(runtime.recoveryData?.recovery || '').trim();
        const status = recovery ? `recovery=${recovery}` : 'checkpoint saved';
        return `- main_chat runtime ${runtime.id} (${status})${last ? `; ${last}` : ''}`;
      });
      if (ordered.length > 4) lines.push(`- ${ordered.length - 4} more interrupted main-chat runtime(s) for this session.`);
      return {
        sessionId,
        runtimeIds: ordered.map((runtime) => runtime.id),
        source,
        chatId,
        userId,
        interruptedAt: runtimeTimestamp(latest),
        summary: lines.join('\n'),
      };
    })
    .sort((a, b) => b.interruptedAt - a.interruptedAt);
}

export function buildHotRestartRecoverySummary(maxAgeMs = 30 * 60_000, sinceMs = 0): string {
  const cutoff = Math.max(Date.now() - Math.max(60_000, maxAgeMs), Number(sinceMs || 0));
  const runtimes = listDurableRuntimes()
    .filter((runtime) => isRuntimeRecoverableAfterRestart(runtime))
    .filter((runtime) => runtimeTimestamp(runtime) >= cutoff)
    .sort((a, b) => runtimeTimestamp(b) - runtimeTimestamp(a));

  if (!runtimes.length) return '(No interrupted runtime records were found for this restart window.)';

  const lines: string[] = [];
  for (const runtime of runtimes.slice(0, 12)) {
    const recovery = String(runtime.recoveryData?.recovery || '').trim();
    const label = String(runtime.label || runtime.kind || 'runtime').trim();
    const id = runtime.taskId || runtime.sessionId || runtime.id;
    const kind = String(runtime.kind || 'runtime');
    const last = formatRuntimeLastProgress(runtime, 140);
    if (runtime.taskId) {
      const task = loadTask(runtime.taskId);
      const status = task ? `${task.status}${task.pauseReason ? `/${task.pauseReason}` : ''}` : 'missing_task';
      const team = task?.teamSubagent ? ` team=${task.teamSubagent.teamId} agent=${task.teamSubagent.agentId}` : '';
      const resumeHint = recovery === 'task_auto_resumed'
        ? 'auto-resumed'
        : `paused; ask before resuming. Resume command: task_control(action:"resume", task_id:"${runtime.taskId}")`;
      lines.push(`- ${kind}: ${label} (${runtime.taskId})${team}; status=${status}; ${resumeHint}${last ? `; ${last}` : ''}`);
    } else if (runtime.kind === 'main_chat' && runtime.sessionId) {
      lines.push(`- main_chat: ${label} (session ${runtime.sessionId}); checkpoint saved; ask whether to continue in this chat${last ? `; ${last}` : ''}`);
    } else {
      lines.push(`- ${kind}: ${label} (${id}); marked interrupted${last ? `; ${last}` : ''}`);
    }
  }

  if (runtimes.length > 12) lines.push(`- ${runtimes.length - 12} more interrupted runtime(s) recorded.`);
  return lines.join('\n');
}

export function recoverInterruptedRuntimes(opts: {
  launchBackgroundTaskRunner?: (taskId: string) => void;
  notify?: (message: string) => void;
} = {}): { inspected: number; resumedTasks: string[]; interruptedChats: string[] } {
  const runtimes = listInterruptedRuntimes()
    .filter((runtime) => Number(runtime.pid || 0) !== process.pid);
  const resumedTasks: string[] = [];
  const interruptedChats: string[] = [];

  for (const runtime of runtimes) {
    try {
      if (isTaskRuntime(runtime) && runtime.taskId) {
        const task = loadTask(runtime.taskId);
        if (!task) {
          markDurableRuntimeRecovered(runtime.id, 'interrupted', { recovery: 'missing_task' });
          continue;
        }
        if (task.status === 'running') {
          pauseTaskForRestart(task, runtime, runtime.interruptReason || 'gateway_crash');
        }
        const latest = loadTask(task.id) || task;
        if (shouldAutoResumeTask(latest) && opts.launchBackgroundTaskRunner) {
          latest.status = 'queued';
          latest.pauseReason = undefined;
          latest.lastProgressAt = Date.now();
          latest.resumeContext = {
            ...(latest.resumeContext || {}),
            onResumeInstruction: [
              latest.resumeContext?.onResumeInstruction,
              'Startup recovery: this task was interrupted by a gateway restart and has been automatically resumed. Continue from the latest journal/resumeContext.',
            ].filter(Boolean).join('\n\n'),
          };
          saveTask(latest);
          appendJournal(latest.id, { type: 'resume', content: 'Auto-resumed after gateway restart.' });
          opts.launchBackgroundTaskRunner(latest.id);
          resumedTasks.push(latest.id);
          markDurableRuntimeRecovered(runtime.id, 'interrupted', { recovery: 'task_auto_resumed', taskId: latest.id });
        } else {
          markDurableRuntimeRecovered(runtime.id, 'interrupted', { recovery: 'task_left_paused', taskId: latest.id });
        }
        continue;
      }

      if (runtime.kind === 'main_chat' && runtime.sessionId) {
        addCheckpointMessageToSession(runtime, runtime.interruptReason || 'gateway_restart');
        interruptedChats.push(runtime.sessionId);
        markDurableRuntimeRecovered(runtime.id, 'interrupted', { recovery: 'chat_checkpointed', sessionId: runtime.sessionId });
        continue;
      }

      markDurableRuntimeRecovered(runtime.id, 'interrupted', { recovery: 'marked_interrupted' });
    } catch (err: any) {
      console.warn('[runtime-recovery] Recovery failed for runtime:', runtime.id, err?.message || err);
    }
  }

  if (resumedTasks.length || interruptedChats.length) {
    opts.notify?.(
      `Recovered interrupted work: ${resumedTasks.length} task(s) resumed, ${interruptedChats.length} chat checkpoint(s) preserved.`,
    );
  }

  return { inspected: runtimes.length, resumedTasks, interruptedChats };
}
