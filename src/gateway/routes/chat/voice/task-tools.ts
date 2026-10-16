import { runInteractiveTurn } from './dependencies';
import {
  createTask,
  loadTask,
  saveTask,
  updateTaskStatus,
  setTaskStepRunning,
  updateTaskRuntimeProgress,
  appendJournal,
  updateResumeContext,
  listTaskSummaries,
  deleteTask,
  mutatePlan,
  getEvidenceBusSnapshot,
  type TaskRecord,
  type TaskSummary,
  type TaskStatus,
} from '../../../tasks/task-store';
import {
  getConfig,
  getAgents,
  getAgentById,
  ensureAgentWorkspace,
  resolveAgentWorkspace,
} from '../../../../config/config';
import {
  addVoiceWorkgroupWorker,
  createVoiceWorkgroup,
  listVoiceWorkgroupsForSession,
  loadVoiceWorkgroup,
  updateVoiceWorkgroupWorkerStatus,
  type VoiceWorkgroupDelivery,
  type VoiceWorkgroupMode,
} from '../../../voice/voice-workgroup-store';
import {
  initTaskRouter,
  latestTaskForSession,
  findBlockedTaskForSession,
  findClarificationWaitingTask,
  isResumeIntent, isRerunIntent, isCancelIntent,
  isStatusQuestion, isTaskListIntent, isAdjustmentIntent,
  getLatestPauseContext, summarizeTaskRecord, buildBlockedTaskStatusMessage,
  parseTaskStatusFilter, getTaskScopeBuckets, parseTaskIdFromText,
  launchBackgroundTaskRunner, handleTaskControlAction,
  handleTaskRecoveryMessage,
  renderTaskCandidatesForHuman, tryHandleBlockedTaskFollowup,
} from '../../../tasks/task-router';
import {
  createInternalWatch,
  listInternalWatches,
  cancelInternalWatch,
} from '../../../internal-watch/internal-watch-store';
import { observeInternalWatchTarget } from '../../../internal-watch/internal-watch-runner';
import {
  listManagedTeams,
  getManagedTeam,
  saveManagedTeam,
  deleteManagedTeam,
  createManagedTeam,
  appendTeamChat,
  appendManagerNote,
  applyTeamChange,
  rejectTeamChange,
  getTeamMemberAgentIds,
  recordTeamRun,
  addTeamNotificationTarget,
  getTeamNotificationTargets,
  listTeamContextReferences,
  addTeamContextReference,
  updateTeamContextReference,
  deleteTeamContextReference,
  buildTeamContextRuntimeBlock,
} from '../../../teams/managed-teams';
import { SubagentManager } from '../../../agents-runtime/subagent-manager';
import {
  wss as _wssRef, setWss,
  broadcastWS,
  broadcastTeamEvent,
  addTeamSseClient,
  removeTeamSseClient,
  sendTeamNotificationToChannels,
  sendDiscordNotification,
  sendWhatsAppNotification,
  resolveChannelsConfig,
  setTelegramChannelForBroadcaster,
  isModelBusy, setModelBusy,
  getLastMainSessionId, setLastMainSessionId,
  setSessionChannelHint,
  type TelegramChannelConfig,
  type DiscordChannelConfig,
  type WhatsAppChannelConfig,
  type ChannelsConfig,
  normalizeTelegramConfig,
  normalizeDiscordConfig,
  normalizeWhatsAppConfig,
  isGatewayDraining,
} from '../../../comms/broadcaster';
import { buildPrometheusThreadLinksArtifact, executePrometheusThreadOps } from '../../../threads/thread-ops';
import { getSession, addMessage, getHistory, getHistoryForApiCall, getActiveHistoryForApiCall, getActiveHistoryForPersistence, getRecentToolObservationsForContext, getWorkingContextForContext, recordWorkingContextPacket, persistToolLog, getWorkspace, setWorkspace, cleanupSessions, listSessionSummaries, searchSessionSummaries, recordSessionCompaction, deleteSession, renameSession, setSessionPinned, reorderSessionSidebar, autoNameSession, replaceHistory, touchSession, flushSession, markSessionReadForMobile, markSessionUnreadForMobile, getCreativeMode, getCreativeReferences, formatCreativeReferencesForPrompt, getActivatedToolCategories, activateToolCategory, captureToolCategoryActivationState, restoreToolCategoryActivationState, getActivatedSkillIds, getActivatedSkillResources, activateSkillForSession, activateSkillResourceForSession, getSessionDisplayTitle, isBusinessContextEnabled, getSessionPersistenceStatus, type TurnOrigin, type VoiceRoomMetadata, type VoiceRoomParticipant } from '../../../session';
import { compactVoiceText, normalizeVoiceAgentTarget } from './context';
import { voiceToolResult } from './tool-helpers';
import { _cronScheduler, handleChat, _telegramChannel } from './dependencies';


export const VOICE_TASK_CONTROL_STATUSES = new Set(['queued', 'running', 'paused', 'stalled', 'needs_assistance', 'awaiting_user_input', 'failed', 'waiting_subagent']);

export function parseVoiceTaskIds(args: Record<string, any>): string[] {
  const ids = [
    String(args?.task_id || args?.taskId || args?.id || '').trim(),
    ...(Array.isArray(args?.task_ids) ? args.task_ids.map((id: any) => String(id || '').trim()) : []),
    ...(Array.isArray(args?.taskIds) ? args.taskIds.map((id: any) => String(id || '').trim()) : []),
  ].filter(Boolean);
  return Array.from(new Set(ids));
}

export function voiceTaskOwner(task: TaskRecord | TaskSummary): { type: string; id: string; label: string } {
  if (task.voiceDispatch?.workgroupId) return { type: 'voice_worker', id: task.voiceDispatch.workgroupId, label: 'Voice workgroup' };
  if (task.teamSubagent?.agentId) return { type: 'team_member', id: task.teamSubagent.agentId, label: task.teamSubagent.agentName || task.teamSubagent.agentId };
  const teamExecution = (task as any).proposalExecution?.teamExecution;
  const proposalTeamId = String(teamExecution?.teamId || (task as any).proposalTeamId || '').trim();
  if (proposalTeamId) return { type: 'team_manager', id: proposalTeamId, label: `Team ${proposalTeamId}` };
  if (task.subagentProfile) {
    const agent = getAgentById(task.subagentProfile) as any;
    return { type: 'standalone_subagent', id: task.subagentProfile, label: String(agent?.name || task.subagentProfile) };
  }
  return { type: 'prometheus', id: 'main', label: 'Prometheus' };
}

export function voiceTaskSearchScore(task: TaskRecord | TaskSummary, query: string): number {
  const q = String(query || '').toLowerCase().replace(/[^a-z0-9\s_-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return 1;
  const title = String(task.title || '').toLowerCase();
  const prompt = String(task.prompt || '').toLowerCase();
  if (task.id.toLowerCase() === q) return 100;
  if (title === q) return 80;
  if (title.includes(q)) return 60;
  const terms = q.split(' ').filter((term) => term.length > 1);
  const titleHits = terms.filter((term) => title.includes(term)).length;
  const promptHits = terms.filter((term) => prompt.includes(term)).length;
  return titleHits * 8 + promptHits * 2;
}

export function listVoiceDirectoryTasks(args: Record<string, any>): TaskRecord[] {
  const query = String(args?.query || args?.title || args?.name || '').trim();
  const statusFilter = String(args?.status || '').trim().toLowerCase();
  const statuses = new Set(statusFilter.split(/[\s,]+/).filter(Boolean));
  const ownerType = String(args?.owner_type || args?.ownerType || '').trim();
  const limit = Math.max(1, Math.min(20, Number(args?.limit || 10) || 10));
  const candidates = listTaskSummaries()
    .map((task) => ({ task, score: voiceTaskSearchScore(task, query) }))
    .filter(({ score }) => !query || score > 0)
    .filter(({ task }) => !statuses.size || statuses.has(String(task.status || '').toLowerCase()))
    .filter(({ task }) => !ownerType || voiceTaskOwner(task).type === ownerType)
    .filter(({ task }) => !/^run_once_verify_|^task_recovery_|^task_resume_brief_/i.test(String(task.sessionId || '')))
    .sort((a, b) => b.score - a.score || Number(b.task.lastProgressAt || b.task.startedAt || 0) - Number(a.task.lastProgressAt || a.task.startedAt || 0))
    .slice(0, limit)
    .map(({ task }) => loadTask(task.id))
    .filter((task): task is TaskRecord => !!task);
  return candidates;
}

export function selectVoiceTaskControlTargets(sessionId: string, args: Record<string, any>): TaskRecord[] {
  const action = String(args?.action || args?.task_action || args?.taskAction || 'status').trim().toLowerCase();
  const explicitTaskIds = parseVoiceTaskIds(args);
  if (explicitTaskIds.length) {
    return explicitTaskIds
      .map((id) => loadTask(id))
      .filter((task): task is TaskRecord => !!task);
  }

  if (String(args?.scope || '').trim() === 'all_tasks') {
    return listVoiceDirectoryTasks(args).filter((task) => action === 'status' || VOICE_TASK_CONTROL_STATUSES.has(String(task.status || ''))).slice(0, 8);
  }

  const workgroupId = String(args?.workgroup_id || args?.workgroupId || '').trim();
  const workgroups = workgroupId
    ? [loadVoiceWorkgroup(workgroupId)].filter(Boolean)
    : listVoiceWorkgroupsForSession(sessionId)
        .filter((workgroup) => workgroup.workers.some((worker) => {
          const task = loadTask(worker.taskId);
          return task && VOICE_TASK_CONTROL_STATUSES.has(String(task.status || ''));
        }))
        .slice(0, String(args?.scope || '').trim() === 'all_voice_workgroups' ? 4 : 1);

  const fromWorkgroups = workgroups
    .flatMap((workgroup: any) => Array.isArray(workgroup?.workers) ? workgroup.workers : [])
    .map((worker: any) => loadTask(String(worker?.taskId || '')))
    .filter((task): task is TaskRecord => !!task);

  if (fromWorkgroups.length) {
    const unfinished = fromWorkgroups.filter((task) => VOICE_TASK_CONTROL_STATUSES.has(String(task.status || '')));
    return (action === 'status' ? fromWorkgroups : unfinished).slice(0, 8);
  }

  const fallback = listTaskSummaries()
    .filter((task) => (
      task.originatingSessionId === sessionId
      || task.sessionId === sessionId
      || String(task.sessionId || '').includes(sessionId)
    ))
    .filter((task) => action === 'status' || VOICE_TASK_CONTROL_STATUSES.has(String(task.status || '')))
    .sort((a, b) => Number(b.lastProgressAt || b.startedAt || 0) - Number(a.lastProgressAt || a.startedAt || 0));
  return fallback.slice(0, 3)
    .map((summary) => loadTask(summary.id))
    .filter((task): task is TaskRecord => !!task);
}

export function summarizeVoiceTaskTargets(tasks: TaskRecord[]): any[] {
  return tasks.map((task) => ({
    task_id: task.id,
    title: task.title,
    status: task.status,
    pauseReason: task.pauseReason || '',
    currentStepIndex: task.currentStepIndex,
    totalSteps: Array.isArray(task.plan) ? task.plan.length : 0,
    currentStep: Array.isArray(task.plan) ? task.plan[Math.max(0, Number(task.currentStepIndex || 0))]?.description || '' : '',
    finalSummary: compactVoiceText(task.finalSummary || '', 500),
    workgroupId: task.voiceDispatch?.workgroupId || '',
    owner: voiceTaskOwner(task),
    tracking: task.voiceDispatch?.workgroupId ? 'voice_workgroup' : 'none',
    lastProgressAt: task.lastProgressAt || null,
  }));
}

export function executeVoiceTaskDirectory(args: Record<string, any>): string {
  const tasks = listVoiceDirectoryTasks(args);
  return voiceToolResult(true, tasks.length ? `Found ${tasks.length} matching task${tasks.length === 1 ? '' : 's'}.` : 'No matching tasks were found.', {
    tasks: summarizeVoiceTaskTargets(tasks),
    trackingNote: 'Discovery does not subscribe the voice agent to these tasks.',
  });
}

export async function executeVoiceTaskControl(sessionId: string, args: Record<string, any>): Promise<string> {
  const action = String(args?.action || args?.task_action || args?.taskAction || 'status').trim().toLowerCase();
  const normalizedAction = action === 'continue' || action === 'unpause' ? 'resume' : action;
  const message = String(args?.message || args?.note || args?.instruction || args?.guidance || '').trim();
  const targets = selectVoiceTaskControlTargets(sessionId, args);
  if (!targets.length) {
    return voiceToolResult(false, 'No matching task was found for voice task control.', {
      action: normalizedAction,
      requestedTaskIds: parseVoiceTaskIds(args),
      workgroupId: String(args?.workgroup_id || args?.workgroupId || '').trim(),
    });
  }

  const explicitIds = parseVoiceTaskIds(args);
  if (normalizedAction !== 'status' && targets.length > 1 && !explicitIds.length && args?.allow_multiple !== true && args?.allowMultiple !== true) {
    return voiceToolResult(false, 'Multiple tasks match. Ask the user which one, or set allow_multiple only for an explicit plural command.', {
      action: normalizedAction,
      ambiguous: true,
      candidates: summarizeVoiceTaskTargets(targets.slice(0, 5)),
    });
  }

  if (normalizedAction === 'status') {
    return voiceToolResult(true, `Loaded ${targets.length} task${targets.length === 1 ? '' : 's'}.`, {
      action: normalizedAction,
      tasks: summarizeVoiceTaskTargets(targets),
    });
  }

  if (normalizedAction === 'message') {
    if (!message) return voiceToolResult(false, 'A message is required to steer or chat with paused tasks.');
    const resumeAfter = args?.resume_after_message === true || args?.resumeAfterMessage === true;
    const results: any[] = [];
    for (const task of targets) {
      const control: any = await handleTaskControlAction(sessionId, {
        action: 'steer',
        task_id: task.id,
        message,
        source: 'voice_task_control',
        resume_after_message: resumeAfter,
      });
      results.push({
        task_id: task.id,
        title: task.title,
        steered: control?.steered === true,
        queued: control?.queued === true,
        resumed: control?.resumed === true,
        reply: compactVoiceText(control?.message || 'Guidance recorded.', 900),
        control,
      });
    }
    return voiceToolResult(true, `${resumeAfter ? 'Sent guidance and resumed' : 'Sent guidance to'} ${results.length} task${results.length === 1 ? '' : 's'}.`, {
      action: normalizedAction,
      resumeAfter,
      results,
      tracking: 'none',
      trackingNote: 'The task remains outside the voice workgroup unless a task watch is explicitly created.',
    });
  }

  if (!['resume', 'pause', 'rerun', 'cancel'].includes(normalizedAction)) {
    return voiceToolResult(false, `Unsupported voice task action: ${normalizedAction}`);
  }

  const results: any[] = [];
  for (const task of targets) {
    const control = await handleTaskControlAction(sessionId, {
      action: normalizedAction,
      task_id: task.id,
      note: message,
      ...(normalizedAction === 'cancel' ? { confirm: true } : {}),
    });
    results.push({
      task_id: task.id,
      title: task.title,
      ok: control.success === true,
      message: control.message || '',
      task: control.task || null,
    });
  }
  const okCount = results.filter((result) => result.ok).length;
  return voiceToolResult(okCount > 0, `${normalizedAction} applied to ${okCount}/${results.length} task${results.length === 1 ? '' : 's'}.`, {
    action: normalizedAction,
    results,
    tracking: 'none',
    trackingNote: 'Control does not subscribe the voice agent to outside tasks.',
  });
}

export function resolveSingleVoiceTask(args: Record<string, any>): { task?: TaskRecord; candidates?: TaskRecord[]; error?: string } {
  const taskId = String(args?.task_id || args?.taskId || '').trim();
  if (taskId) {
    const task = loadTask(taskId);
    return task ? { task } : { error: `Task not found: ${taskId}` };
  }
  const candidates = listVoiceDirectoryTasks({ ...args, limit: 6 });
  if (candidates.length === 1) return { task: candidates[0] };
  if (!candidates.length) return { error: 'No matching task was found.' };
  const firstScore = voiceTaskSearchScore(candidates[0], String(args?.query || ''));
  const secondScore = voiceTaskSearchScore(candidates[1], String(args?.query || ''));
  if (firstScore >= 60 && firstScore > secondScore) return { task: candidates[0] };
  return { candidates, error: 'Multiple tasks match.' };
}

export function executeVoiceTaskWatch(sessionId: string, args: Record<string, any>): string {
  const action = String(args?.action || args?.watch_action || 'list').trim().toLowerCase();
  if (action === 'list') {
    const watches = listInternalWatches({ sessionId, includeDone: args?.include_done === true })
      .filter((watch) => /^Voice task watch:/i.test(watch.label));
    return voiceToolResult(true, watches.length ? `Found ${watches.length} voice task watch${watches.length === 1 ? '' : 'es'}.` : 'No voice task watches are active.', {
      watches: watches.map((watch) => ({ id: watch.id, label: watch.label, status: watch.status, target: watch.target, condition: watch.condition, expiresAt: watch.expiresAt, firedCount: watch.firedCount })),
    });
  }
  if (action === 'cancel') {
    const watchId = String(args?.watch_id || args?.watchId || args?.id || '').trim();
    const owned = listInternalWatches({ sessionId, includeDone: true }).find((watch) => watch.id === watchId && /^Voice task watch:/i.test(watch.label));
    if (!owned) return voiceToolResult(false, 'That voice task watch was not found.');
    const cancelled = cancelInternalWatch(watchId);
    return voiceToolResult(!!cancelled, cancelled ? `Cancelled watch for ${owned.label.replace(/^Voice task watch:\s*/i, '')}.` : 'Could not cancel the watch.', { watch: cancelled });
  }
  if (action !== 'create') return voiceToolResult(false, `Unsupported task watch action: ${action}`);

  const resolved = resolveSingleVoiceTask(args);
  if (!resolved.task) {
    return voiceToolResult(false, resolved.error || 'A unique task is required.', {
      ambiguous: !!resolved.candidates?.length,
      candidates: summarizeVoiceTaskTargets(resolved.candidates || []),
    });
  }
  const task = resolved.task;
  const notifyOn = String(args?.notify_on || args?.notifyOn || 'terminal').trim().toLowerCase();
  const statusGroups: Record<string, string[]> = {
    completion: ['complete', 'failed'],
    attention: ['paused', 'stalled', 'needs_assistance', 'awaiting_user_input'],
    terminal: ['complete', 'failed', 'paused', 'stalled', 'needs_assistance', 'awaiting_user_input'],
  };
  if (!['completion', 'attention', 'terminal', 'milestones'].includes(notifyOn)) return voiceToolResult(false, `Unsupported notify_on value: ${notifyOn}`);
  const ttlMs = Math.max(60_000, Math.min(24 * 60 * 60_000, Number(args?.expires_in_seconds || args?.expiresInSeconds || 3600) * 1000));
  const condition = notifyOn === 'milestones'
    ? { mode: 'milestones' }
    : { mode: 'terminal', terminalStatuses: statusGroups[notifyOn] };
  const draft: any = {
    id: '', label: `Voice task watch: ${task.title}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + ttlMs).toISOString(), ttlMs,
    origin: { sessionId, channel: 'web' }, target: { type: 'task', config: { taskId: task.id } }, condition,
    onMatch: '', maxFirings: notifyOn === 'milestones' ? 10 : 1, firedCount: 0, status: 'active',
  };
  const initialObservation = observeInternalWatchTarget(draft, _cronScheduler);
  const watch = createInternalWatch({
    label: draft.label,
    ttlMs,
    origin: { sessionId, channel: 'web' },
    target: { type: 'task', config: { taskId: task.id } },
    condition,
    maxFirings: notifyOn === 'milestones' ? 10 : 1,
    initialObservation,
    onMatch: `A voice-requested watch for task "${task.title}" matched. Give the user a natural update from {{observation_json}}. Do not resume, rerun, or otherwise control the task unless the user explicitly asked for that separately.`,
  });
  return voiceToolResult(true, `Watching ${task.title} for ${notifyOn === 'milestones' ? 'milestones and terminal changes' : notifyOn}.`, {
    watch: { id: watch.id, taskId: task.id, notifyOn, expiresAt: watch.expiresAt, status: watch.status },
    tracking: 'watched_external_task',
  });
}

export function standaloneVoiceAgents(): any[] {
  const teams = listManagedTeams();
  return getAgents().filter((agent: any) => agent && agent.default !== true && agent.id !== 'main').map((agent: any) => {
    const team = teams.find((entry: any) => Array.isArray(entry.subagentIds) && entry.subagentIds.includes(agent.id));
    return { id: agent.id, name: agent.name || agent.id, description: compactVoiceText(agent.description || '', 300), teamId: team?.id || '', teamName: team?.name || '', standalone: !team };
  });
}

export async function executeVoiceAgentControl(sessionId: string, args: Record<string, any>): Promise<string> {
  const action = String(args?.action || args?.agent_action || '').trim().toLowerCase();
  const ownerTarget = normalizeVoiceAgentTarget(args?.voiceTarget || {});
  const ownerAgentId = ownerTarget.kind === 'subagent' ? String(ownerTarget.agentId || '').trim() : '';
  const agentId = String(args?.agent_id || args?.agentId || ownerAgentId).trim();
  const taskId = String(args?.task_id || args?.taskId || '').trim();
  const message = String(args?.message || args?.prompt || args?.instruction || '').trim();
  const agents = standaloneVoiceAgents();
  const agent = agentId ? agents.find((entry) => entry.id === agentId) : null;
  if (agentId && !agent) return voiceToolResult(false, `Unknown subagent: ${agentId}. Use agent_directory first.`);
  if (agent && !agent.standalone) return voiceToolResult(false, `${agent.name} belongs to managed team ${agent.teamName || agent.teamId}. Team control is intentionally separate from standalone voice-agent control.`);

  if (action === 'chat') {
    if (!agent || !message) return voiceToolResult(false, 'agent_control chat requires agent_id and message.');
    const { runSubagentChatTurnFromChannel } = require('../../channels.router') as typeof import('../../channels.router');
    const ownerLabel = ownerTarget.kind === 'subagent'
      ? compactVoiceText(ownerTarget.label || agent.name || agentId, 120)
      : 'Prometheus';
    const result = await runSubagentChatTurnFromChannel({
      agentId,
      message,
      source: ownerAgentId === agentId ? 'subagent_voice_worker_chat' : 'voice_agent_chat',
      accountId: 'prometheus',
      peerId: sessionId,
      userLabel: `${ownerLabel} Voice`,
      timeoutMs: 180_000,
      sessionId: `subagent_chat_${agentId}`,
      seedFromSharedChatStore: true,
    });
    return voiceToolResult(true, `${agent.name} replied.`, {
      agentId,
      reply: compactVoiceText(result?.result?.text || '', 5000),
      threadId: `subagent_chat_${agentId}`,
      resumedVoiceTarget: ownerTarget.kind === 'subagent' ? ownerTarget : undefined,
      voiceContinuation: ownerAgentId === agentId
        ? 'The result returned to the same subagent Voice/Live tool call. Summarize it as yourself.'
        : undefined,
    });
  }
  if (action === 'dispatch') {
    if (!agent || !message) return voiceToolResult(false, 'agent_control dispatch requires agent_id and a task message.');
    const manager = new SubagentManager(getConfig().getWorkspacePath(), broadcastWS, handleChat, _telegramChannel);
    const result = await manager.callSubagent({ subagent_id: agentId, task_prompt: message, run_now: true, delivery_mode: 'task_panel_only' }, sessionId);
    return voiceToolResult(true, `Dispatched new background work to ${agent.name}.`, { agentId, taskId: result.task_id, status: result.status, tracking: 'none', trackingNote: 'The subagent run is not watched unless task_watch is explicitly created.' });
  }

  const ownedTasks = taskId ? [] : listTaskSummaries()
    .filter((task) => voiceTaskOwner(task).type === 'standalone_subagent' && voiceTaskOwner(task).id === agentId)
    .sort((a, b) => Number(b.lastProgressAt || 0) - Number(a.lastProgressAt || 0))
    .slice(0, 20)
    .map((summary) => loadTask(summary.id))
    .filter((task): task is TaskRecord => !!task);
  const target = taskId ? loadTask(taskId) : ownedTasks[0];
  if (!target || voiceTaskOwner(target).type !== 'standalone_subagent' || (agentId && voiceTaskOwner(target).id !== agentId)) return voiceToolResult(false, 'No matching standalone-subagent run was found.');
  if (action === 'run_status') return voiceToolResult(true, `Loaded ${target.title}.`, { task: summarizeVoiceTaskTargets([target])[0] });
  if (action === 'run_message') {
    if (!message) return voiceToolResult(false, 'run_message requires a message.');
    const control: any = await handleTaskControlAction(sessionId, { action: 'steer', task_id: target.id, message, source: 'voice_agent_control' });
    return voiceToolResult(control.success === true, control.message || `Sent guidance to ${agent?.name || voiceTaskOwner(target).label}.`, { taskId: target.id, control, tracking: 'none' });
  }
  const actionMap: Record<string, string> = { run_resume: 'resume', run_pause: 'pause', run_rerun: 'rerun', run_cancel: 'cancel' };
  const controlAction = actionMap[action];
  if (!controlAction) return voiceToolResult(false, `Unsupported agent action: ${action}`);
  const control = await handleTaskControlAction(sessionId, { action: controlAction, task_id: target.id, note: message, ...(controlAction === 'cancel' ? { confirm: true } : {}) });
  return voiceToolResult(control.success === true, control.message || `${controlAction} applied.`, { control, tracking: 'none' });
}

export function summarizeVoiceThreadOperation(action: string, output: Record<string, any>): string {
  const session = output?.session || (Array.isArray(output?.created) ? output.created[0] : null);
  const title = String(session?.title || output?.supervision?.targetTitle || '').trim();
  const count = Number(output?.count || (Array.isArray(output?.created) ? output.created.length : 0));
  const target = title ? ` ${title}` : '';
  const mode = String(session?.mode || session?.launch?.notificationMode || '').trim().toLowerCase();
  switch (action) {
    case 'create_and_ping': return `Created and queued thread${target}; I will notify you when its detached turn completes.`;
    case 'create_and_forget': return `Created and queued thread${target}; I will not send a completion notification.`;
    case 'create_and_supervise': return `Created and queued thread${target}; hidden supervision will verify it and report the terminal result.`;
    case 'create': case 'start':
      return mode === 'ping'
        ? `Created and queued thread${target}; I will notify you when its detached turn completes.`
        : mode === 'forget'
          ? `Created and queued thread${target}; I will not send a completion notification.`
          : `Created and queued thread${target}; hidden supervision will verify it and report the terminal result.`;
    case 'create_many': case 'start_many': return `Created and queued ${count || 0} independent threads; each launch route will report according to its explicit mode.`;
    case 'send': case 'chat': return `Sent the thread an update${target}.`;
    case 'steer': return `Steered the active thread${target}.`;
    case 'interrupt': case 'stop': return `Paused the thread${target}.`;
    case 'follow': return `I am now supervising${target}.`;
    case 'unfollow': return `Stopped supervising${target}.`;
    case 'rename': return `Renamed the thread${target}.`;
    case 'pin': return `Pinned the thread${target}.`;
    case 'unpin': return `Unpinned the thread${target}.`;
    case 'revise_supervision': return 'Updated the supervision objective.';
    case 'pause_supervision': return 'Paused supervision.';
    case 'resume_supervision': return 'Resumed supervision.';
    case 'review_decision': return `Recorded the supervision decision: ${String(output?.supervision?.lastDecision || 'updated')}.`;
    case 'read': return `Loaded thread${target}.`;
    case 'status': return `Loaded thread status${target}.`;
    case 'reopen': case 'open': case 'unsettle': return `Reopened the thread${target}.`;
    case 'list': return `Found ${Array.isArray(output?.sessions) ? output.sessions.length : 0} threads.`;
    case 'find': case 'search': return `Found ${Array.isArray(output?.sessions) ? output.sessions.length : 0} matching threads.`;
    case 'supervisions': case 'followed': return `Loaded ${Array.isArray(output?.supervisions) ? output.supervisions.length : 0} supervision records.`;
    default: return 'Thread operation complete.';
  }
}

export async function executeVoiceThreadOps(sessionId: string, args: Record<string, any>): Promise<string> {
  const voiceTarget = args?.voiceTarget && typeof args.voiceTarget === 'object' ? args.voiceTarget : null;
  if (String(voiceTarget?.kind || '').trim() === 'subagent') {
    return voiceToolResult(false, 'Thread orchestration belongs to the main Prometheus voice session. The selected subagent can only control its own work.');
  }
  const action = String(args?.action || '').trim().toLowerCase();
  if (!action) return voiceToolResult(false, 'A thread action is required.');
  const output = await executePrometheusThreadOps(sessionId, args, {
    runInteractiveTurn,
    broadcastWS,
  });
  const summary = summarizeVoiceThreadOperation(action, output);
  const threadLinks = buildPrometheusThreadLinksArtifact(args, output);
  if (threadLinks) {
    addMessage(sessionId, {
      role: 'assistant',
      content: summary,
      timestamp: Date.now(),
      messageKind: 'voice_thread_ops',
      source: 'voice_thread_ops',
      richArtifacts: [threadLinks],
    } as any, { disableMemoryFlushCheck: true, disableCompactionCheck: true } as any);
    broadcastWS({
      type: 'voice_thread_ops',
      sessionId,
      action,
      summary,
      output,
      richArtifacts: [threadLinks],
    });
  }
  return voiceToolResult(true, summary, {
    action,
    output,
    ...(threadLinks ? { richArtifacts: [threadLinks] } : {}),
  });
}
