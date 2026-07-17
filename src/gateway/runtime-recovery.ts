import {
  isInterruptedByRestart,
  getRestartInterruptEpoch,
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
import {
  finalizeMainChatGoalCrashRecovery,
  recordMainChatGoalInterruptedForRestart,
} from './main-chat-goals';

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
  plannedRestartTool?: string;
  summary: string;
}

const crashRecoveredMainChatGoalSessionIds = new Set<string>();

export function consumeCrashRecoveredMainChatGoalSessionIds(): string[] {
  const sessionIds = Array.from(crashRecoveredMainChatGoalSessionIds);
  crashRecoveredMainChatGoalSessionIds.clear();
  return sessionIds;
}

function isTaskRuntime(runtime: LiveRuntimeSnapshot): boolean {
  return !!runtime.taskId || TASK_RUNTIME_KINDS.has(String(runtime.kind || ''));
}

function plannedRestartToolName(runtime: LiveRuntimeSnapshot): string | undefined {
  const candidates = [
    runtime.checkpoint?.toolName,
    runtime.interruptReason,
    runtime.recoveryData?.interruptReason,
    runtime.recoveryData?.restartTrigger,
    runtime.recoveryData?.plannedRestartTool,
  ].map((value) => String(value || '').trim()).filter(Boolean);
  for (const toolName of candidates) {
    if (toolName === 'gateway_restart') return toolName;
    if (toolName === 'prom_apply_dev_changes') return toolName;
    if (/^(prom_)?dev_.*apply/i.test(toolName)) return toolName;
    if (/^(apply_)?dev_source_(changes|edit|patch)$/i.test(toolName)) return toolName;
  }
  return undefined;
}

function explicitlyOwnedMainChatRestartToolName(runtime: LiveRuntimeSnapshot): string | undefined {
  const candidates = [
    runtime.checkpoint?.toolName,
    runtime.recoveryData?.restartTrigger,
    runtime.recoveryData?.plannedRestartTool,
  ].map((value) => String(value || '').trim()).filter(Boolean);
  for (const toolName of candidates) {
    if (toolName === 'gateway_restart' || toolName === 'prom_apply_dev_changes') return toolName;
    if (/^(prom_)?dev_.*apply/i.test(toolName)) return toolName;
    if (/^(apply_)?dev_source_(changes|edit|patch)$/i.test(toolName)) return toolName;
  }
  return undefined;
}

function taskOwnedRestartToolName(runtime: LiveRuntimeSnapshot): string | undefined {
  const checkpointTool = String(runtime.checkpoint?.toolName || '').trim();
  if (checkpointTool === 'gateway_restart' || checkpointTool === 'prom_apply_dev_changes') {
    return checkpointTool;
  }
  return undefined;
}

function isPlainGatewayRestartTask(task: TaskRecord): boolean {
  const text = `${task.title || ''} ${task.prompt || ''}`.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!/\b(restart|reboot)\b.*\b(gateway|prometheus|server)\b|\b(gateway|prometheus|server)\b.*\b(restart|reboot)\b/.test(text)) return false;
  return !/\b(build|compile|update|upgrade|apply|edit|change|fix|install|deploy|then|afterwards?|after that|and then|verify files?|run tests?)\b/.test(text);
}

type RestartCheckpointPhase = 'initiated' | 'recovered';
type RestartCheckpointTextOptions = {
  includeProcessPacket?: boolean;
};

function compactCheckpointValue(value: unknown, max = 700): string {
  const text = typeof value === 'string'
    ? value
    : value && typeof value === 'object'
      ? JSON.stringify(value)
      : String(value ?? '');
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, Math.max(0, max - 3))}...` : clean;
}

function formatCheckpointProcessPacket(runtime: LiveRuntimeSnapshot): string[] {
  const checkpoint = runtime.checkpoint || {};
  const rawProcessEntries = Array.isArray(checkpoint.processEntries) ? checkpoint.processEntries : [];
  const entries = rawProcessEntries
    .filter((entry) => entry && typeof entry === 'object')
    .slice(-18);
  const lines: string[] = [];
  if (checkpoint.args) lines.push(`Last tool args: ${compactCheckpointValue(checkpoint.args, 900)}`);
  if (checkpoint.result) lines.push(`Last tool result: ${compactCheckpointValue(checkpoint.result, 1100)}`);
  if (checkpoint.thinkingTail) {
    lines.push('Recent reasoning/thinking tail:');
    lines.push(compactCheckpointValue(checkpoint.thinkingTail, 1400));
  }
  if (entries.length) {
    lines.push('Recent runtime process/tool log:');
    for (const entry of entries) {
      const type = String(entry.type || entry.event || 'info').toUpperCase();
      const toolName = compactCheckpointValue(entry.extra?.toolName || entry.toolName || '', 80);
      const content = compactCheckpointValue(entry.content || entry.message || entry.result || '', 500);
      if (!content && !toolName) continue;
      lines.push(`- [${type}]${toolName ? ` ${toolName}:` : ''} ${content}`.trim());
    }
  }
  return lines.slice(0, 28);
}

function buildCheckpointText(
  runtime: LiveRuntimeSnapshot,
  reason: string,
  phase: RestartCheckpointPhase = 'initiated',
  opts: RestartCheckpointTextOptions = {},
): string {
  const plannedTool = plannedRestartToolName(runtime);
  const includeProcessPacket = opts.includeProcessPacket !== false;
  const processPacket = includeProcessPacket ? formatCheckpointProcessPacket(runtime) : [];
  if (plannedTool) {
    if (phase === 'recovered') {
      return [
        '[Hot restart checkpoint: planned by this chat]',
        'Gateway restart successful. Prometheus is back online.',
        '',
        ...processPacket,
      ].join('\n');
    }
    return [
      '[Hot restart checkpoint: planned by this chat]',
      'Gateway Restart Initiated',
      '',
      `Restart trigger: ${plannedTool}`,
      'Prometheus called this restart tool from this chat.',
      includeProcessPacket ? '' : 'Detailed recovery context was saved internally.',
      '',
      ...processPacket,
    ].join('\n');
  }

  const lines = [
    '[Interrupted by gateway restart]',
    `Runtime: ${runtime.label || runtime.kind}`,
    runtime.detail ? `Work: ${runtime.detail}` : '',
    `Reason: ${reason}`,
    runtime.checkpoint?.event ? `Last event: ${runtime.checkpoint.event}` : '',
    runtime.checkpoint?.message ? `Last progress: ${String(runtime.checkpoint.message).slice(0, 1000)}` : '',
    runtime.checkpoint?.toolName ? `Last tool: ${runtime.checkpoint.toolName}` : '',
    ...processPacket,
    '',
    includeProcessPacket
      ? 'Prometheus saved this checkpoint before shutdown. Continue from the latest known progress instead of restarting completed work.'
      : 'Prometheus saved a checkpoint before shutdown. Continue from the latest known progress if the user asks.',
  ].filter(Boolean);
  return lines.join('\n');
}

function addCheckpointMessageToSession(runtime: LiveRuntimeSnapshot, reason: string, phase: RestartCheckpointPhase = 'initiated'): void {
  if (!runtime.sessionId) return;
  const content = buildCheckpointText(runtime, reason, phase, { includeProcessPacket: false });
  const recoveryPacket = buildCheckpointText(runtime, reason, phase, { includeProcessPacket: true });
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
  const processToolLog = processEntries.length
    ? processEntries.map((entry: any) => {
      const type = String(entry.type || 'info').toUpperCase();
      const text = String(entry.content || '').trim();
      const toolName = String(entry.extra?.toolName || entry.toolName || '').trim();
      return `[${type}]${toolName ? ` ${toolName}:` : ''} ${text}`.trim();
    }).join('\n')
    : undefined;
  const toolLog = [recoveryPacket, processToolLog].filter(Boolean).join('\n\n');
  const workspacePath = getWorkspace(runtime.sessionId) || process.cwd();
  const fileChanges = collectTurnFileChangesFromProcessEntries(processEntries, workspacePath);
  const workStartedAt = Number(runtime.startedAt || 0) || Date.now();
  const workEndedAt = Number(runtime.interruptedAt || runtime.updatedAt || Date.now()) || Date.now();
  addMessage(runtime.sessionId, {
    role: 'assistant',
    messageKind: runtime.kind === 'main_chat_goal' ? 'goal_restart_checkpoint' : undefined,
    activeRunKind: runtime.kind === 'main_chat_goal' ? 'main_chat_goal' : undefined,
    goalId: runtime.checkpoint?.goalId,
    goalTurnNumber: runtime.checkpoint?.goalTurnNumber,
    goalIterationNumber: runtime.checkpoint?.goalIterationNumber,
    goalTurnId: runtime.checkpoint?.goalTurnId,
    content,
    timestamp: workEndedAt,
    workStartedAt,
    workEndedAt,
    workDurationMs: Math.max(0, workEndedAt - workStartedAt),
    channel: runtime.source as any,
    channelLabel: runtime.source || 'system',
    processEntries: processEntries.length ? processEntries : undefined,
    toolLog: toolLog || undefined,
    fileChanges: fileChanges || undefined,
  }, {
    disableCompactionCheck: true,
    disableMemoryFlushCheck: true,
  });
  flushSession(runtime.sessionId);
}

function addCrashRecoveryMessageToSession(runtime: LiveRuntimeSnapshot, reason: string): boolean {
  const sessionId = String(runtime.sessionId || '').trim();
  if (!sessionId) return false;
  const goal = finalizeMainChatGoalCrashRecovery(sessionId, {
    reason,
    recoveredAt: Date.now(),
  });
  if (!goal || goal.restartCheckpoint?.phase !== 'crash_recovered') return false;

  const touchedFiles = goal.restartCheckpoint.touchedFiles || [];
  const checkpointFiles = goal.restartCheckpoint.affectedFiles || [];
  const devEditId = goal.restartCheckpoint.devEditId;
  const content = [
    'The gateway restarted unexpectedly while this goal was still editing.',
    'The partial work was preserved, but the changes were not yet verified, applied, or confirmed live.',
    devEditId ? `Prometheus will resume the existing dev edit (${devEditId}) instead of creating a duplicate.` : '',
    touchedFiles.length
      ? `Before editing further, Prometheus will reread the files known to have been touched: ${touchedFiles.join(', ')}.`
      : checkpointFiles.length
        ? `Partial edits may exist. Before any further mutation, Prometheus will reread the checkpoint file list: ${checkpointFiles.join(', ')}.`
        : 'Partial edits may exist. Before any further mutation, Prometheus will reread the relevant source and persisted work state.',
    'Resuming the same goal from its crash-recovery checkpoint.',
  ].filter(Boolean).join('\n');
  const recent = getHistory(sessionId, 12);
  const alreadyPresent = recent.some((message) =>
    message.role === 'assistant'
    && message.messageKind === 'restart_status'
    && String(message.content || '').trim() === content
  );
  if (!alreadyPresent) {
    addMessage(sessionId, {
      role: 'assistant',
      messageKind: 'restart_status',
      activeRunKind: 'main_chat_goal',
      goalId: goal.id,
      goalTurnNumber: goal.restartCheckpoint.turnNumber,
      content,
      timestamp: Date.now(),
      channel: runtime.source as any,
      channelLabel: runtime.source || 'system',
      processEntries: [{
        ts: new Date().toLocaleTimeString(),
        type: 'warning',
        actor: 'Runtime Recovery',
        content,
        extra: {
          packetType: 'main_chat_goal_crash_recovery',
          restartReason: reason,
          devEditId,
          touchedFiles,
          checkpointFiles,
        },
      }],
    }, {
      disableCompactionCheck: true,
      disableMemoryFlushCheck: true,
    });
  }
  flushSession(sessionId);
  crashRecoveredMainChatGoalSessionIds.add(sessionId);
  return true;
}

function pauseMainChatGoalRuntimeForRestart(runtime: LiveRuntimeSnapshot, reason: string): void {
  if (runtime.kind !== 'main_chat' && runtime.kind !== 'main_chat_goal') return;
  if (!runtime.sessionId) return;
  if (runtime.kind !== 'main_chat_goal' && String(runtime.source || '') !== 'goal' && !/main chat goal/i.test(String(runtime.label || ''))) return;
  recordMainChatGoalInterruptedForRestart(runtime.sessionId, reason, Number(runtime.startedAt || 0));
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

      if ((runtime.kind === 'main_chat' || runtime.kind === 'main_chat_goal') && runtime.sessionId) {
        pauseMainChatGoalRuntimeForRestart(runtime, reason);
        if (runtime.kind === 'main_chat') addCheckpointMessageToSession(runtime, reason);
      }
    } catch (err: any) {
      console.warn('[runtime-recovery] Failed to prepare runtime for shutdown:', runtime.id, err?.message || err);
    }
  }
  return interrupted;
}

function shouldAutoResumeTask(task: TaskRecord, runtime: LiveRuntimeSnapshot): boolean {
  if (task.status !== 'paused') return false;
  if (task.pauseReason !== 'gateway_restart') return false;
  if (task.pendingClarificationQuestion) return false;
  // A task that intentionally crossed a restart boundary must continue on the
  // replacement gateway. Other interrupted tasks retain the global opt-in.
  return !!taskOwnedRestartToolName(runtime)
    || process.env.PROMETHEUS_AUTO_RESUME_INTERRUPTED_TASKS === '1';
}

function runtimeTimestamp(runtime: LiveRuntimeSnapshot): number {
  return Number(runtime.interruptedAt || runtime.updatedAt || runtime.startedAt || 0);
}

function runtimeRestartEpoch(runtime: LiveRuntimeSnapshot): number {
  return Number(runtime.recoveryData?.restartEpoch || 0);
}

// Resolve the epoch of the restart we're recovering from. In the process that did
// the shutdown, getRestartInterruptEpoch() holds it. In a freshly-launched process
// (normal restart), that's 0, so we derive it from the durable ledger: the most
// recent restartEpoch stamped on any not-yet-recovered runtime IS this restart.
// This is what lets us exclude runtimes that were paused/failed before the restart
// (no restartEpoch stamp) and stale records from older crashes (lower epoch).
function resolveActiveRestartEpoch(): number {
  const live = getRestartInterruptEpoch();
  if (live > 0) return live;
  let max = 0;
  for (const runtime of listDurableRuntimes()) {
    const rd = runtime.recoveryData || {};
    if (rd.recoveredAt || rd.recovery) continue;
    const epoch = runtimeRestartEpoch(runtime);
    if (epoch > max) max = epoch;
  }
  return max;
}

function isMainChatHotRestartRecoveryCandidate(runtime: LiveRuntimeSnapshot, sinceEpoch = 0): boolean {
  if ((runtime.kind !== 'main_chat' && runtime.kind !== 'main_chat_goal') || !runtime.sessionId) return false;
  // Only main-chat runtimes this restart actually interrupted.
  if (isInterruptedByRestart(runtime, sinceEpoch)) return true;
  // The explicit shutdown-marked checkpoint path also counts, but only when it
  // belongs to this restart epoch (else it's a stale/older checkpoint).
  const recovery = String(runtime.recoveryData?.recovery || '').trim();
  if (recovery !== 'chat_checkpointed') return false;
  if (sinceEpoch <= 0) return true;
  return runtimeRestartEpoch(runtime) >= sinceEpoch;
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
  const restartEpoch = resolveActiveRestartEpoch();
  const runtimes = listDurableRuntimes()
    .filter((runtime) => isMainChatHotRestartRecoveryCandidate(runtime, restartEpoch))
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
      const plannedRestartTool = ordered.map(plannedRestartToolName).find(Boolean);
      const lines = ordered.slice(0, 4).map((runtime) => {
        const last = formatRuntimeLastProgress(runtime);
        const recovery = String(runtime.recoveryData?.recovery || '').trim();
        const plannedTool = plannedRestartToolName(runtime);
        const status = plannedTool
          ? `planned restart boundary from ${plannedTool}`
          : (recovery ? `recovery=${recovery}` : 'checkpoint saved');
        return `- main_chat runtime ${runtime.id} (${status})${last ? `; ${last}` : ''}`;
      });
      if (ordered.length > 4) lines.push(`- ${ordered.length - 4} more interrupted main-chat runtime(s) for this session.`);
      if (plannedRestartTool) {
        lines.push('Treat this as the expected result of the chat-triggered restart/apply tool, not as work that needs a resume question.');
      }
      return {
        sessionId,
        runtimeIds: ordered.map((runtime) => runtime.id),
        source,
        chatId,
        userId,
        interruptedAt: runtimeTimestamp(latest),
        plannedRestartTool,
        summary: lines.join('\n'),
      };
    })
    .sort((a, b) => b.interruptedAt - a.interruptedAt);
}

export function buildHotRestartRecoverySummary(maxAgeMs = 30 * 60_000, sinceMs = 0, opts: { currentSessionId?: string } = {}): string {
  const cutoff = Math.max(Date.now() - Math.max(60_000, maxAgeMs), Number(sinceMs || 0));
  const restartEpoch = resolveActiveRestartEpoch();
  const currentSessionId = String(opts.currentSessionId || '').trim();

  // Only runtimes THIS restart actually interrupted. Pre-paused/failed work and
  // stale records from older crashes (no matching restartEpoch stamp) are excluded.
  const runtimes = listDurableRuntimes()
    .filter((runtime) => isInterruptedByRestart(runtime, restartEpoch) || isMainChatHotRestartRecoveryCandidate(runtime, restartEpoch))
    .filter((runtime) => runtimeTimestamp(runtime) >= cutoff)
    .sort((a, b) => runtimeTimestamp(b) - runtimeTimestamp(a));

  if (!runtimes.length) return '(No work was interrupted by this restart.)';

  // Split task jobs (resume candidates) from interrupted chat threads.
  const taskLines: string[] = [];
  const otherChatThreads = new Map<string, { label: string; last: string; planned?: string }>();

  for (const runtime of runtimes) {
    const recovery = String(runtime.recoveryData?.recovery || '').trim();
    const label = String(runtime.label || runtime.kind || 'runtime').trim();
    const kind = String(runtime.kind || 'runtime');
    const last = formatRuntimeLastProgress(runtime, 140);
    if (runtime.taskId) {
      const task = loadTask(runtime.taskId);
      const status = task ? `${task.status}${task.pauseReason ? `/${task.pauseReason}` : ''}` : 'missing_task';
      const team = task?.teamSubagent ? ` team=${task.teamSubagent.teamId} agent=${task.teamSubagent.agentId}` : '';
      const resumeHint = recovery === 'task_auto_resumed'
        ? 'auto-resumed'
        : `paused by this restart; ask before resuming. Resume command: task_control(action:"resume", task_id:"${runtime.taskId}")`;
      taskLines.push(`- ${kind}: ${label} (${runtime.taskId})${team}; status=${status}; ${resumeHint}${last ? `; ${last}` : ''}`);
    } else if ((runtime.kind === 'main_chat' || runtime.kind === 'main_chat_goal') && runtime.sessionId) {
      const sessionId = String(runtime.sessionId).trim();
      // The chat we're currently restarting INTO is handled by the live restart
      // confirmation, not listed as an "other thread to go back to".
      if (sessionId && sessionId !== currentSessionId && !otherChatThreads.has(sessionId)) {
        otherChatThreads.set(sessionId, { label, last, planned: plannedRestartToolName(runtime) || undefined });
      }
    }
  }

  const sections: string[] = [];

  if (taskLines.length) {
    sections.push('Tasks interrupted by this restart:');
    sections.push(...taskLines.slice(0, 12));
    if (taskLines.length > 12) sections.push(`- ${taskLines.length - 12} more interrupted task(s) recorded.`);
  }

  if (otherChatThreads.size) {
    if (sections.length) sections.push('');
    sections.push('Other chat threads you had open (interrupted by this restart — you can jump back to them):');
    let count = 0;
    for (const [sessionId, info] of otherChatThreads) {
      if (count >= 8) break;
      const note = info.planned
        ? `planned restart boundary from ${info.planned}`
        : 'checkpoint saved; pick up where you left off';
      sections.push(`- ${info.label} (session ${sessionId}); ${note}${info.last ? `; ${info.last}` : ''}`);
      count++;
    }
    if (otherChatThreads.size > 8) sections.push(`- ${otherChatThreads.size - 8} more interrupted chat thread(s).`);
  }

  if (!sections.length) return '(No work was interrupted by this restart.)';
  return sections.join('\n');
}

export function recoverInterruptedRuntimes(opts: {
  launchBackgroundTaskRunner?: (taskId: string) => void;
  completePlainGatewayRestartTask?: (taskId: string) => boolean;
  notify?: (message: string) => void;
} = {}): {
  inspected: number;
  resumedTasks: string[];
  interruptedChats: string[];
  crashRecoveredGoalSessionIds: string[];
} {
  const runtimes = listInterruptedRuntimes()
    .filter((runtime) => Number(runtime.pid || 0) !== process.pid);
  const resumedTasks: string[] = [];
  const interruptedChats: string[] = [];
  const crashRecoveredGoalSessionIds = new Set<string>();

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
        if (
          taskOwnedRestartToolName(runtime) === 'gateway_restart'
          && isPlainGatewayRestartTask(latest)
          && opts.completePlainGatewayRestartTask?.(latest.id)
        ) {
          resumedTasks.push(latest.id);
          markDurableRuntimeRecovered(runtime.id, 'interrupted', { recovery: 'task_restart_completed', taskId: latest.id });
          continue;
        }
        if (shouldAutoResumeTask(latest, runtime) && opts.launchBackgroundTaskRunner) {
          const ownedRestartTool = taskOwnedRestartToolName(runtime);
          const restartArgs = compactCheckpointValue(runtime.checkpoint?.args || {}, 1200);
          const restartResult = compactCheckpointValue(runtime.checkpoint?.result || '', 1200);
          latest.status = 'queued';
          latest.pauseReason = undefined;
          latest.lastProgressAt = Date.now();
          latest.resumeContext = {
            ...(latest.resumeContext || {}),
            onResumeInstruction: [
              latest.resumeContext?.onResumeInstruction,
              ownedRestartTool === 'prom_apply_dev_changes'
                ? [
                    'Startup recovery: prom_apply_dev_changes completed its build/apply phase and the replacement gateway is now running.',
                    restartArgs ? `Persisted apply arguments: ${restartArgs}` : '',
                    restartResult ? `Persisted apply result: ${restartResult}` : '',
                    'Continue immediately after the successful apply/restart boundary. Do not call prom_apply_dev_changes or gateway_restart again for these same changes.',
                    'Perform only the remaining post-restart verification and required completion write_note, then complete the task and deliver its final result.',
                  ].filter(Boolean).join('\n')
                : ownedRestartTool
                  ? 'Startup recovery: the gateway restart requested by this task succeeded. Continue immediately after the restart tool boundary, verify the gateway is healthy if relevant, and finish the remaining task steps. Do not call gateway_restart again unless a new restart is genuinely required.'
                : 'Startup recovery: this task was interrupted by a gateway restart and has been automatically resumed. Continue from the latest journal/resumeContext.',
            ].filter(Boolean).join('\n\n'),
          };
          saveTask(latest);
          if (ownedRestartTool === 'prom_apply_dev_changes') {
            appendJournal(latest.id, {
              type: 'tool_result',
              content: 'prom_apply_dev_changes: build/apply succeeded and gateway restart completed; continuing with post-restart verification.',
              detail: [restartArgs, restartResult].filter(Boolean).join('\n').slice(0, 2400) || undefined,
            });
          }
          appendJournal(latest.id, { type: 'resume', content: 'Auto-resumed after gateway restart.' });
          opts.launchBackgroundTaskRunner(latest.id);
          resumedTasks.push(latest.id);
          markDurableRuntimeRecovered(runtime.id, 'interrupted', { recovery: 'task_auto_resumed', taskId: latest.id });
        } else {
          markDurableRuntimeRecovered(runtime.id, 'interrupted', { recovery: 'task_left_paused', taskId: latest.id });
        }
        continue;
      }

      if ((runtime.kind === 'main_chat' || runtime.kind === 'main_chat_goal') && runtime.sessionId) {
        const reason = runtime.interruptReason || 'gateway_restart';
        // A generic interruptReason such as "gateway_restart" is also used for
        // supervisor crash recovery, so only explicit tool/checkpoint ownership
        // may route a main-chat goal into BOOT's planned-restart path.
        const plannedRestartTool = explicitlyOwnedMainChatRestartToolName(runtime);
        let crashRecoveryFinalized = false;
        pauseMainChatGoalRuntimeForRestart(runtime, reason);
        if (runtime.kind === 'main_chat') {
          addCheckpointMessageToSession(runtime, reason, 'recovered');
        } else if (!plannedRestartTool) {
          const sessionId = String(runtime.sessionId).trim();
          if (!crashRecoveredGoalSessionIds.has(sessionId) && addCrashRecoveryMessageToSession(runtime, reason)) {
            crashRecoveredGoalSessionIds.add(sessionId);
            crashRecoveryFinalized = true;
          }
        }
        interruptedChats.push(runtime.sessionId);
        markDurableRuntimeRecovered(runtime.id, 'interrupted', {
          recovery: crashRecoveryFinalized
            ? 'main_chat_goal_crash_recovered'
            : 'chat_checkpointed',
          sessionId: runtime.sessionId,
        });
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

  return {
    inspected: runtimes.length,
    resumedTasks,
    interruptedChats,
    crashRecoveredGoalSessionIds: Array.from(crashRecoveredGoalSessionIds),
  };
}


