import path from 'path';
import { backgroundJoin, backgroundProgress, backgroundSpawn, backgroundSteer, backgroundWait, listBackgroundStatuses } from '../../tasks/task-runner';
import { normalizeSpawnToolCategoriesArg } from '../../tasks/spawn-tool-categories-arg';
import {
  automationDashboardTool,
  scheduleJobDetailTool,
  scheduleJobHistoryTool,
  scheduleJobLogSearchTool,
  scheduleJobOutputsTool,
  scheduleJobPatchTool,
  scheduleJobStuckControlTool,
  normalizeExpectedOutputs,
} from '../../scheduling/schedule-admin-tools';
import { validateCronExpression, validateScheduleTimezone } from '../../scheduling/cron-scheduler';
import { normalizeScheduleSpec } from '../../scheduling/schedule-pattern';
import {
  cancelMainChatTimer,
  createMainChatTimer,
  listMainChatTimers,
  updateMainChatTimer,
} from '../../timers/timer-store';
import {
  cancelInternalWatch,
  createInternalWatch,
  listInternalWatches,
  type InternalWatchActionPolicy,
} from '../../internal-watch/internal-watch-store';
import { observeInternalWatchTarget, refreshInternalWatchObservation } from '../../internal-watch/internal-watch-runner';
import { evaluateInternalWatchTaskControlPolicy } from '../../internal-watch/internal-watch-policy';
import { getSessionChannelHint } from '../../comms/broadcaster';
import type { CapabilityExecutionContext, CapabilityExecutor } from './types';
import {
  normalizeDeliveryChannel,
  normalizeScheduleJobAction,
  summarizeCronJob,
  type ToolResult,
} from '../../tool-builder';
import { getManagedTeam } from '../../teams/managed-teams';
import { ensureScheduleRuntimeForAgent } from '../../scheduling/schedule-agent';
import { systemDiagnosticsTool } from '../../diagnostics/system-diagnostics';
import { createDiagnosticPacket, getDiagnosticPacket, listDiagnosticPackets, updateDiagnosticPacketStatus } from '../../diagnostics/diagnostic-packet-store';
import { buildPrometheusThreadLinksArtifact, executePrometheusThreadOps } from '../../threads/thread-ops';
import { executePrometheusRequestOps } from '../../requests/request-ops';
import { executePrometheusAuditOpsInWorker } from '../../audit/audit-ops-worker-client';
import { getResourceStore } from '../../resources/resource-store';
import { executeTriggerOps } from '../../triggers/trigger-rule-input';

const AUTOMATION_TOOL_NAMES = new Set([
  'background_spawn',
  'background_steer',
  'background_status',
  'background_progress',
  'background_wait',
  'background_join',
  'task_control',
  'timer',
  'internal_watch',
  'trigger_ops',
  'schedule_job',
  'schedule_job_history',
  'schedule_job_detail',
  'schedule_job_log_search',
  'schedule_job_patch',
  'schedule_job_outputs',
  'schedule_job_stuck_control',
  'automation_dashboard',
  'prometheus_thread_ops',
  'prometheus_request_ops',
  'prometheus_audit_ops',
  'system_diagnostics',
  'diagnostic_packet',
]);

/** Map a background_<id> worker session back to the main chat that spawned it. */
export function resolveBackgroundTimerOwnerSession(sessionId: string): string | null {
  const match = /^background_(bg_[A-Za-z0-9-]+)$/.exec(String(sessionId || '').trim());
  if (!match) return null;
  const record = listBackgroundStatuses().find((status) => status.id === match[1]);
  const owner = String(record?.spawnerSessionId || '').trim();
  if (!owner || /^(cron_|task_|background_|dispatch_|self_repair_|team_|agent_|auto_)/i.test(owner)) return null;
  return owner;
}

export const automationCapabilityExecutor: CapabilityExecutor = {
  id: 'automation',

  canHandle(name: string): boolean {
    return AUTOMATION_TOOL_NAMES.has(name);
  },

  async execute(ctx: CapabilityExecutionContext): Promise<ToolResult> {
    const { name, args, deps, sessionId, workspacePath } = ctx;

    switch (name) {
      case 'background_spawn': {
        try {
          const prompt = String(args.task_prompt || args.prompt || '').trim();
          if (!prompt) return { name, args, result: 'background_spawn requires task_prompt', error: true };
          const requestedResourceIds = Array.isArray(args.resource_ids || args.resourceIds)
            ? (args.resource_ids || args.resourceIds).map((value: unknown) => String(value || '').trim()).filter(Boolean).slice(0, 100)
            : [];
          const resourceIds = getResourceStore(workspacePath)
            .listThreadResources(sessionId, { limit: 100, resourceIds: requestedResourceIds })
            .map((resource) => resource.id);
          const status = backgroundSpawn({
            prompt,
            spawnerSessionId: sessionId,
            resourceIds,
            joinPolicy: args.join_policy || 'wait_all',
            timeoutMs: args.timeout_ms,
            tags: args.tags,
            modelOverride: args.model ? String(args.model) : undefined,
            providerOverride: args.provider ? String(args.provider) : undefined,
            reasoningEffort: args.reasoning_effort ? String(args.reasoning_effort) : undefined,
            speed: args.speed ? String(args.speed) : (args.fast_mode === true ? 'fast' : undefined),
            toolCategories: normalizeSpawnToolCategoriesArg(args.tool_categories),
          });
          return { name, args, result: JSON.stringify(status), error: false };
        } catch (err: any) {
          return { name, args, result: `background_spawn error: ${err.message}`, error: true };
        }
      }

      case 'background_status':
      case 'background_progress': {
        const bgId = String(args.background_id || args.id || '').trim();
        if (!bgId) {
          // No id: list this session's background agents instead of failing.
          const mine = listBackgroundStatuses()
            .filter((s) => !s.spawnerSessionId || s.spawnerSessionId === sessionId)
            .slice(0, 20)
            .map((s) => ({ id: s.id, state: s.state, tags: s.tags, model: s.model, startedAt: s.startedAt, promptPreview: s.promptPreview }));
          return { name, args, result: JSON.stringify({ note: 'No background_id given; listing background agents for this session (newest first).', agents: mine }), error: false };
        }
        const status = backgroundProgress(bgId);
        if (!status) return { name, args, result: `No background agent found with id: ${bgId}`, error: true };
        return { name, args, result: JSON.stringify(status), error: false };
      }

      case 'background_steer': {
        const bgId = String(args.background_id || '').trim();
        const message = String(args.message || '').trim();
        if (!bgId) return { name, args, result: 'background_id is required', error: true };
        if (!message) return { name, args, result: 'message is required', error: true };
        const result = backgroundSteer(bgId, message, { source: `background_ops_steer:${sessionId}` });
        return { name, args, result: JSON.stringify(result), error: !result.queued };
      }

      case 'background_wait': {
        try {
          const bgId = String(args.background_id || '').trim();
          const bgIds = Array.isArray(args.background_ids)
            ? args.background_ids.map((id: any) => String(id || '').trim()).filter(Boolean)
            : [];
          const result = await backgroundWait({
            backgroundId: bgId || undefined,
            backgroundIds: bgIds,
            spawnerSessionId: sessionId,
            timeoutMs: args.timeout_ms ?? args.wait_ms,
          });
          return { name, args, result: JSON.stringify(result), error: false };
        } catch (err: any) {
          return { name, args, result: `background_wait error: ${err.message}`, error: true };
        }
      }

      case 'background_join': {
        try {
          const bgId = String(args.background_id || '').trim();
          if (!bgId) return { name, args, result: 'background_id is required', error: true };
          const result = await backgroundJoin({
            backgroundId: bgId,
            joinPolicy: args.join_policy,
            timeoutMs: args.timeout_ms,
          });
          if (!result) return { name, args, result: `No background agent found with id: ${bgId}`, error: true };
          return { name, args, result: JSON.stringify(result), error: result.state === 'failed' };
        } catch (err: any) {
          return { name, args, result: `background_join error: ${err.message}`, error: true };
        }
      }

      case 'trigger_ops': {
        const [result, isError] = await executeTriggerOps(args || {}, sessionId);
        return { name, args, result, error: isError };
      }

      case 'task_control': {
        const denial = evaluateInternalWatchTaskControlPolicy(deps.internalWatchContext, args);
        if (denial) {
          return { name, args, result: JSON.stringify(denial, null, 2), error: true };
        }
        const out = await deps.handleTaskControlAction(sessionId, args);
        return {
          name,
          args,
          result: JSON.stringify(out, null, 2),
          error: out.success !== true,
        };
      }

      case 'timer': {
        const action = String(args.action || '').trim().toLowerCase();
        // Background agents may create timers: they fire into the main chat
        // that spawned the agent. Cron, task, team and other automated
        // sessions stay blocked.
        const timerOwnerSession = resolveBackgroundTimerOwnerSession(String(sessionId || ''));
        const mainChatOnly = !!timerOwnerSession
          || !/^(cron_|task_|background_|dispatch_|self_repair_|team_|agent_|auto_)/i.test(String(sessionId || ''));
        if (!mainChatOnly) {
          return {
            name,
            args,
            result: 'Timers are main-chat only. They cannot be created from cron, background, task, team, or automated sessions.',
            error: true,
          };
        }

        if (action === 'list') {
          const requestedSessionId = String(args.session_id || args.sessionId || '').trim();
          const allSessions = args.all_sessions === true || String(args.scope || '').trim().toLowerCase() === 'all';
          const timers = listMainChatTimers({
            sessionId: allSessions ? undefined : (requestedSessionId || sessionId),
            includeDone: args.include_done === true,
          });
          return {
            name,
            args,
            result: JSON.stringify({
              success: true,
              action: 'list',
              scope: allSessions ? 'all_sessions' : 'session',
              sessionId: allSessions ? null : (requestedSessionId || sessionId),
              count: timers.length,
              timers,
            }, null, 2),
            error: false,
          };
        }

        if (action === 'cancel') {
          const timerId = String(args.timer_id || args.timerId || '').trim();
          if (!timerId) return { name, args, result: 'timer(cancel) requires timer_id', error: true };
          const requestedSessionId = String(args.session_id || args.sessionId || '').trim();
          const allSessions = args.all_sessions === true || String(args.scope || '').trim().toLowerCase() === 'all';
          const existing = listMainChatTimers({
            sessionId: allSessions ? undefined : (requestedSessionId || sessionId),
            includeDone: true,
          }).find((timer) => timer.id === timerId);
          if (!existing) {
            return {
              name,
              args,
              result: allSessions
                ? `Timer not found: ${timerId}`
                : `Timer not found in session ${(requestedSessionId || sessionId)}: ${timerId}`,
              error: true,
            };
          }
          const cancelled = cancelMainChatTimer(timerId);
          if (!cancelled) return { name, args, result: `Timer not found: ${timerId}`, error: true };
          deps.broadcastWS?.({ type: 'timer_cancelled', timer: cancelled, sessionId: cancelled.sessionId });
          return {
            name,
            args,
            result: JSON.stringify({ success: true, action: 'cancel', timer: cancelled }, null, 2),
            error: false,
          };
        }

        if (action === 'update' || action === 'modify' || action === 'reschedule') {
          const timerId = String(args.timer_id || args.timerId || '').trim();
          if (!timerId) return { name, args, result: `timer(${action}) requires timer_id`, error: true };
          const requestedSessionId = String(args.session_id || args.sessionId || '').trim();
          const allSessions = args.all_sessions === true || String(args.scope || '').trim().toLowerCase() === 'all';
          const existing = listMainChatTimers({
            sessionId: allSessions ? undefined : (requestedSessionId || sessionId),
            includeDone: true,
          }).find((timer) => timer.id === timerId);
          if (!existing) {
            return {
              name,
              args,
              result: allSessions
                ? `Timer not found: ${timerId}`
                : `Timer not found in session ${(requestedSessionId || sessionId)}: ${timerId}`,
              error: true,
            };
          }
          if (existing.status === 'running') {
            return { name, args, result: `Timer "${timerId}" is already running and cannot be modified.`, error: true };
          }
          if (existing.status === 'completed' || existing.status === 'cancelled') {
            return { name, args, result: `Timer "${timerId}" is ${existing.status} and cannot be modified. Create a new timer instead.`, error: true };
          }

          const patch: any = {};
          if (args.instruction !== undefined || args.prompt !== undefined) {
            const instruction = String(args.instruction ?? args.prompt ?? '').trim();
            if (!instruction) return { name, args, result: `timer(${action}) instruction/prompt cannot be empty`, error: true };
            patch.instruction = instruction;
            if (args.label === undefined && existing.label === existing.instruction.slice(0, 60)) {
              patch.label = instruction.slice(0, 60) || 'Timer';
            }
          }
          if (args.label !== undefined) {
            const label = String(args.label || '').trim();
            patch.label = label || (patch.instruction || existing.instruction).slice(0, 60) || 'Timer';
          }

          const hasDelay = args.delay_seconds !== undefined || args.delaySeconds !== undefined;
          const hasDueAt = args.due_at !== undefined || args.dueAt !== undefined;
          if (hasDelay || hasDueAt) {
            const now = Date.now();
            const delaySecondsRaw = Number(args.delay_seconds ?? args.delaySeconds);
            const dueAtRaw = String(args.due_at || args.dueAt || '').trim();
            let dueAt: Date | null = null;
            if (Number.isFinite(delaySecondsRaw) && delaySecondsRaw > 0) {
              dueAt = new Date(now + Math.max(5, Math.floor(delaySecondsRaw)) * 1000);
            } else if (dueAtRaw) {
              const parsed = new Date(dueAtRaw);
              if (Number.isFinite(parsed.getTime())) dueAt = parsed;
            }
            if (!dueAt || !Number.isFinite(dueAt.getTime())) {
              return { name, args, result: `timer(${action}) requires a positive delay_seconds or a valid due_at ISO timestamp when changing time`, error: true };
            }
            if (dueAt.getTime() < now + 5000) {
              dueAt = new Date(now + 5000);
            }
            const maxDueAt = now + 30 * 24 * 60 * 60 * 1000;
            if (dueAt.getTime() > maxDueAt) {
              return { name, args, result: 'Timers can be scheduled up to 30 days in the future.', error: true };
            }
            patch.dueAt = dueAt.toISOString();
            patch.status = 'pending';
            patch.firedAt = undefined;
            patch.completedAt = undefined;
            patch.error = undefined;
          }

          if (Object.keys(patch).length === 0) {
            return { name, args, result: `timer(${action}) needs at least one of instruction/prompt, label, delay_seconds, or due_at`, error: true };
          }
          const updated = updateMainChatTimer(timerId, patch);
          if (!updated) return { name, args, result: `Timer not found: ${timerId}`, error: true };
          deps.broadcastWS?.({ type: 'timer_updated', timer: updated, sessionId: updated.sessionId });
          return {
            name,
            args,
            result: JSON.stringify({
              success: true,
              action: 'update',
              timer: updated,
              message: `Timer updated for ${new Date(updated.dueAt).toLocaleString()}.`,
            }, null, 2),
            error: false,
          };
        }

        if (action === 'create') {
          const instruction = String(args.instruction || args.prompt || '').trim();
          if (!instruction) return { name, args, result: 'timer(create) requires instruction', error: true };

          const now = Date.now();
          const delaySecondsRaw = Number(args.delay_seconds ?? args.delaySeconds);
          const dueAtRaw = String(args.due_at || args.dueAt || '').trim();
          let dueAt: Date | null = null;
          if (Number.isFinite(delaySecondsRaw) && delaySecondsRaw > 0) {
            dueAt = new Date(now + Math.max(5, Math.floor(delaySecondsRaw)) * 1000);
          } else if (dueAtRaw) {
            const parsed = new Date(dueAtRaw);
            if (Number.isFinite(parsed.getTime())) dueAt = parsed;
          }
          if (!dueAt || !Number.isFinite(dueAt.getTime())) {
            return { name, args, result: 'timer(create) requires either delay_seconds or a valid due_at ISO timestamp', error: true };
          }
          if (dueAt.getTime() < now + 5000) {
            dueAt = new Date(now + 5000);
          }
          const maxDueAt = now + 30 * 24 * 60 * 60 * 1000;
          if (dueAt.getTime() > maxDueAt) {
            return { name, args, result: 'Timers can be scheduled up to 30 days in the future.', error: true };
          }

          const timer = createMainChatTimer({
            sessionId: timerOwnerSession || sessionId,
            instruction,
            dueAt,
            label: String(args.label || '').trim() || undefined,
          });
          deps.broadcastWS?.({ type: 'timer_created', timer, sessionId: timerOwnerSession || sessionId });
          return {
            name,
            args,
            result: JSON.stringify({
              success: true,
              action: 'create',
              timer,
              message: `Timer created for ${new Date(timer.dueAt).toLocaleString()}.`,
            }, null, 2),
            error: false,
          };
        }

        return {
          name,
          args,
          result: 'timer requires action: create, list, update, modify, reschedule, or cancel',
          error: true,
        };
      }

      case 'internal_watch': {
        const action = String(args.action || '').trim().toLowerCase();

        if (action === 'list') {
          const watches = listInternalWatches({
            sessionId,
            includeDone: args.include_done === true || args.includeDone === true,
          }).map((watch) => refreshInternalWatchObservation(watch, deps.cronScheduler));
          return {
            name,
            args,
            result: JSON.stringify({ success: true, count: watches.length, watches }, null, 2),
            error: false,
          };
        }

        if (action === 'cancel') {
          const watchId = String(args.watch_id || args.watchId || args.id || '').trim();
          if (!watchId) return { name, args, result: 'internal_watch(cancel) requires watch_id', error: true };
          const existing = listInternalWatches({ sessionId, includeDone: true }).find((watch) => watch.id === watchId);
          if (!existing) {
            return { name, args, result: `Internal watch not found in this chat: ${watchId}`, error: true };
          }
          const cancelled = cancelInternalWatch(watchId);
          if (!cancelled) return { name, args, result: `Internal watch not found: ${watchId}`, error: true };
          deps.broadcastWS?.({ type: 'internal_watch_cancelled', watch: cancelled, sessionId });
          return {
            name,
            args,
            result: JSON.stringify({ success: true, action: 'cancel', watch: cancelled }, null, 2),
            error: false,
          };
        }

        if (action === 'create') {
          const targetRaw = args.target && typeof args.target === 'object' ? args.target : {};
          const targetType = String(targetRaw.type || args.target_type || args.targetType || '').trim();
          if (!['file', 'task', 'scheduled_job', 'event_queue'].includes(targetType)) {
            return { name, args, result: 'internal_watch(create) requires target.type: file, task, scheduled_job, or event_queue', error: true };
          }
          // Team managers are woken by dispatch completion events (team-event-router).
          // This registry executor runs before subagent-executor, so the guard must live here.
          if (targetType === 'task' && String(sessionId || '').startsWith('team_coord_')) {
            return {
              name,
              args,
              result: 'internal_watch(create task) is not used by team managers: a background dispatch_team_agent wakes you automatically when the member finishes, fails, shares an artifact, or messages you. End your turn and wait for that wake.',
              error: true,
            };
          }
          const targetConfig: Record<string, any> = { ...targetRaw };
          delete targetConfig.type;
          if (targetType === 'file') {
            targetConfig.path = String(targetConfig.path || args.path || '').trim();
            if (!targetConfig.path) return { name, args, result: 'internal_watch(create file) requires target.path', error: true };
            targetConfig.workspaceRoot = path.resolve(workspacePath);
          } else if (targetType === 'task') {
            targetConfig.taskId = String(targetConfig.taskId || targetConfig.task_id || args.task_id || args.taskId || '').trim();
            if (!targetConfig.taskId) return { name, args, result: 'internal_watch(create task) requires target.task_id', error: true };
          } else if (targetType === 'scheduled_job') {
            targetConfig.jobId = String(targetConfig.jobId || targetConfig.job_id || args.job_id || args.jobId || '').trim();
            if (!targetConfig.jobId) return { name, args, result: 'internal_watch(create scheduled_job) requires target.job_id', error: true };
          } else if (targetType === 'event_queue') {
            targetConfig.match = targetConfig.match || args.match || undefined;
            targetConfig.workspaceRoot = path.resolve(workspacePath);
          }

          const onMatch = String(args.on_match || args.onMatch || args.instruction || '').trim();
          if (!onMatch) return { name, args, result: 'internal_watch(create) requires on_match', error: true };
          const ttlMsRaw = Number(args.ttl_ms ?? args.ttlMs);
          const ttlMs = Number.isFinite(ttlMsRaw) && ttlMsRaw > 0 ? Math.floor(ttlMsRaw) : undefined;
          const condition = args.condition && typeof args.condition === 'object' ? args.condition : {};
          const rawActionPolicy = String(args.action_policy || args.actionPolicy || '').trim();
          const actionPolicy: InternalWatchActionPolicy = rawActionPolicy === 'recover_same_run' || rawActionPolicy === 'full_rerun_allowed'
            ? rawActionPolicy
            : 'review_only';
          const deliverySessionId = String(args.delivery_session_id || args.deliverySessionId || '').trim() || undefined;
          const rationale = String(args.rationale || args.reason || '').trim() || undefined;
          const sessionHint = getSessionChannelHint(sessionId);

          let initialObservation: any = undefined;
          try {
            initialObservation = observeInternalWatchTarget({
              id: 'preview',
              label: String(args.label || 'preview'),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + (ttlMs || 20 * 60 * 1000)).toISOString(),
              ttlMs: ttlMs || 20 * 60 * 1000,
              origin: { sessionId },
              target: { type: targetType as any, config: targetConfig },
              condition,
              onMatch,
              rationale,
              deliverySessionId,
              actionPolicy,
              deliveryMode: String(args.delivery_mode || args.deliveryMode || '').trim() === 'notify_only' ? 'notify_only' : 'run_turn',
              maxFirings: 1,
              firedCount: 0,
              status: 'active',
            }, deps.cronScheduler);
            if (initialObservation?.text) initialObservation.text = `[${String(initialObservation.text).length} chars]`;
          } catch (err: any) {
            return { name, args, result: `internal_watch(create) target validation failed: ${err?.message || err}`, error: true };
          }

          const watch = createInternalWatch({
            id: String(args.id || '').trim() || undefined,
            label: String(args.label || '').trim() || undefined,
            ttlMs,
            origin: {
              sessionId,
              channel: sessionHint?.channel === 'telegram' ? 'telegram' : 'web',
              telegramChatId: Number.isFinite(Number(sessionHint?.chatId)) ? Number(sessionHint?.chatId) : undefined,
              telegramUserId: Number.isFinite(Number(sessionHint?.userId)) ? Number(sessionHint?.userId) : undefined,
            },
            target: { type: targetType as any, config: targetConfig },
            condition,
            onMatch,
            rationale,
            deliverySessionId,
            actionPolicy,
            deliveryMode: String(args.delivery_mode || args.deliveryMode || '').trim() === 'notify_only' ? 'notify_only' : 'run_turn',
            onTimeout: String(args.on_timeout || args.onTimeout || '').trim() || undefined,
            maxFirings: Number(args.max_firings ?? args.maxFirings) || undefined,
            initialObservation,
          });
          deps.broadcastWS?.({ type: 'internal_watch_created', watch, sessionId });
          return {
            name,
            args,
            result: JSON.stringify({
              success: true,
              action: 'create',
              watch,
              message: `Internal watch created: ${watch.label} (${watch.id}), expires ${watch.expiresAt}.`,
            }, null, 2),
            error: false,
          };
        }

        return {
          name,
          args,
          result: 'internal_watch requires action: create, list, or cancel',
          error: true,
        };
      }

      case 'schedule_job': {
        const action = normalizeScheduleJobAction(args.action);
        if (!action) {
          return {
            name,
            args,
            result: 'schedule_job requires a valid action: list, create, update, pause, resume, delete, run_now',
            error: true,
          };
        }

        const requiresConfirm = action === 'create' || action === 'update' || action === 'delete';
        if (requiresConfirm && args.confirm !== true) {
          return {
            name,
            args,
            result: JSON.stringify({
              success: false,
              needs_confirmation: true,
              action,
              message: `Action "${action}" requires explicit confirmation. Re-run with confirm=true after user says yes.`,
            }, null, 2),
            error: true,
          };
        }

        if (action === 'list') {
          const limitRaw = Number(args.limit);
          const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(200, Math.floor(limitRaw)) : 50;
          const jobs = deps.cronScheduler.getJobs().map(summarizeCronJob).slice(0, limit);
          return {
            name,
            args,
            result: JSON.stringify({ success: true, count: jobs.length, jobs }, null, 2),
            error: false,
          };
        }

        const jobId = String(args.job_id || args.jobId || '').trim();

        if (action === 'create') {
          const instructionPrompt = String(args.instruction_prompt || args.prompt || '').trim();
          if (!instructionPrompt) {
            return { name, args, result: 'schedule_job(create) requires instruction_prompt', error: true };
          }

          const schedule = (args.schedule && typeof args.schedule === 'object') ? args.schedule : {};
          const timezone = String(args.timezone || args.tz || '').trim() || undefined;
          let kind: 'recurring' | 'one-shot' = 'recurring';
          let cron = String(schedule.cron || args.cron || '').trim();
          let runAtRaw = String(schedule.run_at || args.run_at || '').trim();
          // Friendly fields (text, repeat/time, days_of_week, every_hours,
          // every_days) are advertised by the schema; compile them to cron.
          try {
            const normalized = normalizeScheduleSpec({
              ...schedule,
              kind: schedule.kind || args.kind || undefined,
              cron: schedule.cron || args.cron,
              run_at: schedule.run_at || args.run_at,
            }, timezone);
            kind = normalized.kind === 'one-shot' ? 'one-shot' : 'recurring';
            if (normalized.kind === 'one-shot') runAtRaw = String(normalized.runAt || runAtRaw);
            else cron = String(normalized.cron || cron);
          } catch (err: any) {
            const rawKind = String(schedule.kind || args.kind || '').trim().toLowerCase();
            const wantsOneShot = rawKind === 'one_shot' || rawKind === 'one-shot' || !!runAtRaw;
            if (wantsOneShot && !runAtRaw) return { name, args, result: 'schedule.kind=one_shot requires schedule.run_at (ISO datetime)', error: true };
            if (!wantsOneShot && !cron) {
              return { name, args, result: `schedule.kind=recurring requires schedule.cron or a friendly schedule (text, repeat+time, every_hours): ${err?.message || err}`, error: true };
            }
            kind = wantsOneShot ? 'one-shot' : 'recurring';
          }
          const delivery = (args.delivery && typeof args.delivery === 'object') ? args.delivery : {};
          const channel = normalizeDeliveryChannel(delivery.channel || args.channel);
          const modelOverride = String(args.model_override || args.model || '').trim() || undefined;
          const nameValue = String(args.name || '').trim() || `Scheduled task ${new Date().toLocaleString()}`;

          if (channel !== 'web') {
            return {
              name,
              args,
              result: `Delivery channel "${channel}" is not enabled for scheduler jobs yet. Use channel "web" for now.`,
              error: true,
            };
          }

          if (kind === 'one-shot') {
            if (!runAtRaw) return { name, args, result: 'schedule.kind=one_shot requires schedule.run_at (ISO datetime)', error: true };
            const parsed = new Date(runAtRaw);
            if (!Number.isFinite(parsed.getTime())) {
              return { name, args, result: `Invalid run_at value: "${runAtRaw}"`, error: true };
            }
          } else if (!cron) {
            return { name, args, result: 'schedule.kind=recurring requires schedule.cron', error: true };
          }

          const tzError = validateScheduleTimezone(timezone);
          if (tzError) return { name, args, result: tzError, error: true };
          if (kind === 'recurring') {
            const cronError = validateCronExpression(cron, timezone);
            if (cronError) return { name, args, result: cronError, error: true };
          }

          const requestedTeamId = String(args.team_id || args.teamId || '').trim() || undefined;
          if (requestedTeamId && !getManagedTeam(requestedTeamId)) {
            return { name, args, result: `Team not found: ${requestedTeamId}`, error: true };
          }
          const requestedSubagentId = requestedTeamId ? undefined : (String(args.subagent_id || '').trim() || undefined);
          const assignmentTarget = requestedTeamId ? 'team' : (requestedSubagentId ? 'subagent' : 'main');
          const previewOnlyRaw = args.preview_only ?? args.previewOnly;
          const expectedOutputsRaw = args.expected_outputs ?? args.expectedOutputs;

          let created = deps.cronScheduler.createJob({
            name: nameValue,
            prompt: instructionPrompt,
            type: kind,
            schedule: kind === 'recurring' ? cron : undefined,
            runAt: kind === 'one-shot' ? new Date(runAtRaw).toISOString() : undefined,
            tz: timezone,
            sessionTarget: assignmentTarget === 'main' ? 'main' : 'isolated',
            model: modelOverride,
            subagent_id: requestedSubagentId,
            team_id: requestedTeamId,
            assignmentTarget,
            deliverToMainChannel: assignmentTarget === 'main',
            previewOnly: previewOnlyRaw === true || String(previewOnlyRaw).toLowerCase() === 'true',
            ...(Array.isArray(args.skillIds) ? { skillIds: args.skillIds } : {}),
            ...((args.context_refs || args.contextReferences) ? { context_refs: args.context_refs || args.contextReferences } : {}),
            ...(expectedOutputsRaw !== undefined ? { expectedOutputs: normalizeExpectedOutputs(expectedOutputsRaw) } : {}),
          } as any);
          if (requestedSubagentId) {
            ensureScheduleRuntimeForAgent(requestedSubagentId, {
              scheduleId: created.id,
              scheduleName: created.name,
              prompt: instructionPrompt,
              model: modelOverride,
            });
          }

          return {
            name,
            args,
            result: JSON.stringify({
              success: true,
              action: 'create',
              job: summarizeCronJob(created),
              assigned_team: requestedTeamId || undefined,
              assigned_owner: requestedSubagentId ? { subagent_id: requestedSubagentId, created: false } : { agent_id: 'main', created: false },
              message: requestedTeamId
                ? `Scheduled team job "${created.name}" created for team "${requestedTeamId}".`
                : requestedSubagentId
                ? `Scheduled job "${created.name}" created and assigned to subagent "${requestedSubagentId}".`
                : `Scheduled job "${created.name}" created and assigned to Prometheus itself.`,
            }, null, 2),
            error: false,
          };
        }

        if (!jobId) {
          return { name, args, result: `schedule_job(${action}) requires job_id`, error: true };
        }

        if (action === 'pause') {
          const updated = deps.cronScheduler.updateJob(jobId, { status: 'paused', enabled: false, pausedReason: 'manual' } as any);
          if (!updated) return { name, args, result: `Job not found: ${jobId}`, error: true };
          return { name, args, result: JSON.stringify({ success: true, action: 'pause', job: summarizeCronJob(updated) }, null, 2), error: false };
        }

        if (action === 'resume') {
          const updated = deps.cronScheduler.updateJob(jobId, { status: 'scheduled', enabled: true, pausedReason: undefined } as any);
          if (!updated) return { name, args, result: `Job not found: ${jobId}`, error: true };
          return { name, args, result: JSON.stringify({ success: true, action: 'resume', job: summarizeCronJob(updated) }, null, 2), error: false };
        }

        if (action === 'run_now') {
          const exists = deps.cronScheduler.getJobs().some((j: any) => j.id === jobId);
          if (!exists) return { name, args, result: `Job not found: ${jobId}`, error: true };
          const waitSecondsRaw = Number(args.wait_seconds ?? args.waitSeconds);
          const waitMs = Number.isFinite(waitSecondsRaw) && waitSecondsRaw > 0
            ? Math.min(600, waitSecondsRaw) * 1000
            : (args.wait === true ? 300_000 : 1500);
          let runError: string | null = null;
          const runPromise = deps.cronScheduler.runJobNow(jobId, { respectActiveHours: false }).catch((err: any) => {
            runError = String(err?.message || err);
            console.error(`[schedule_job] run_now failed for ${jobId}:`, runError);
          });
          // Surface immediate rejections (already running, missing team, ...)
          // and fast results instead of always reporting "queued".
          const settled = await Promise.race([
            runPromise.then(() => true),
            new Promise<boolean>((resolve) => setTimeout(() => resolve(false), waitMs)),
          ]);
          if (runError) {
            return {
              name,
              args,
              result: JSON.stringify({ success: false, action: 'run_now', job_id: jobId, status: 'rejected', error: runError }, null, 2),
              error: true,
            };
          }
          const after = deps.cronScheduler.getJobs().find((j: any) => j.id === jobId);
          if (settled) {
            const lastResult = String(after?.lastResult || '');
            const failed = /^\s*ERROR:/i.test(lastResult);
            return {
              name,
              args,
              result: JSON.stringify({
                success: !failed,
                action: 'run_now',
                job_id: jobId,
                status: failed ? 'failed' : 'completed',
                last_run: after?.lastRun || null,
                result_excerpt: lastResult.slice(0, 1200),
              }, null, 2),
              error: failed,
            };
          }
          return {
            name,
            args,
            result: JSON.stringify({
              success: true,
              action: 'run_now',
              job_id: jobId,
              status: 'running',
              message: 'Run started and is still in progress (not finished). Check schedule_job(list) or automation_dashboard for the outcome, or call run_now with wait:true to wait for completion.',
            }, null, 2),
            error: false,
          };
        }

        if (action === 'delete') {
          const ok = deps.cronScheduler.deleteJob(jobId);
          if (!ok) return { name, args, result: `Job not found: ${jobId}`, error: true };
          return {
            name,
            args,
            result: JSON.stringify({ success: true, action: 'delete', job_id: jobId, message: 'Job deleted.' }, null, 2),
            error: false,
          };
        }

        if (action === 'update') {
          const schedule = (args.schedule && typeof args.schedule === 'object') ? args.schedule : {};
          const patch: Record<string, any> = {};

          if (args.name !== undefined) patch.name = String(args.name || '').trim();
          if (args.instruction_prompt !== undefined || args.prompt !== undefined) {
            patch.prompt = String(args.instruction_prompt || args.prompt || '').trim();
          }
          if (args.timezone !== undefined || args.tz !== undefined) {
            patch.tz = String(args.timezone || args.tz || '').trim();
          }
          if (args.model_override !== undefined || args.model !== undefined) {
            const mv = String(args.model_override || args.model || '').trim();
            patch.model = mv || undefined;
          }
          if (args.delivery !== undefined || args.channel !== undefined) {
            const delivery = (args.delivery && typeof args.delivery === 'object') ? args.delivery : {};
            const channel = normalizeDeliveryChannel(delivery.channel || args.channel);
            if (channel !== 'web') {
              return {
                name,
                args,
                result: `Delivery channel "${channel}" is not enabled for scheduler jobs yet. Use channel "web" for now.`,
                error: true,
              };
            }
            const sessionTarget = String(delivery.session_target || args.session_target || '').toLowerCase();
            if (sessionTarget === 'main' || sessionTarget === 'isolated') patch.sessionTarget = sessionTarget;
            if (sessionTarget === 'main') {
              patch.assignmentTarget = 'main';
              patch.deliverToMainChannel = true;
              patch.subagent_id = undefined;
              patch.team_id = undefined;
            }
          }
          if (args.subagent_id !== undefined) {
            const subagentId = String(args.subagent_id || '').trim();
            if (subagentId) {
              patch.subagent_id = subagentId;
              patch.team_id = undefined;
              patch.assignmentTarget = 'subagent';
              patch.deliverToMainChannel = false;
              patch.sessionTarget = 'isolated';
            } else {
              patch.subagent_id = undefined;
              patch.team_id = undefined;
              patch.assignmentTarget = 'main';
              patch.deliverToMainChannel = true;
              patch.sessionTarget = 'main';
            }
          }
          if (args.team_id !== undefined || args.teamId !== undefined) {
            const teamId = String(args.team_id || args.teamId || '').trim();
            if (teamId && !getManagedTeam(teamId)) {
              return { name, args, result: `Team not found: ${teamId}`, error: true };
            }
            patch.team_id = teamId || undefined;
            if (teamId) {
              patch.subagent_id = undefined;
              patch.assignmentTarget = 'team';
              patch.deliverToMainChannel = false;
              patch.sessionTarget = 'isolated';
            }
          }

          const rawKind = String(schedule.kind || args.kind || '').trim().toLowerCase();
          if (rawKind === 'one_shot' || rawKind === 'one-shot') patch.type = 'one-shot';
          if (rawKind === 'recurring') patch.type = 'recurring';
          if (schedule.cron !== undefined || args.cron !== undefined) patch.schedule = String(schedule.cron || args.cron || '').trim();
          if (schedule.run_at !== undefined || args.run_at !== undefined) patch.runAt = String(schedule.run_at || args.run_at || '').trim();
          const hasFriendlySchedule = ['text', 'repeat', 'time', 'days_of_week', 'daysOfWeek', 'every_hours', 'everyHours', 'every_days', 'everyDays']
            .some((key) => schedule[key] !== undefined);
          if (hasFriendlySchedule && patch.schedule === undefined && patch.runAt === undefined) {
            try {
              const normalized = normalizeScheduleSpec({ ...schedule, kind: schedule.kind || args.kind || undefined }, patch.tz || undefined);
              patch.type = normalized.kind === 'one-shot' ? 'one-shot' : 'recurring';
              if (normalized.kind === 'recurring') {
                patch.schedule = normalized.cron;
                patch.runAt = null;
              } else {
                patch.runAt = normalized.runAt;
                patch.schedule = null;
              }
            } catch (err: any) {
              return { name, args, result: `Invalid schedule: ${err?.message || err}`, error: true };
            }
          }
          if (Array.isArray(args.skillIds)) patch.skillIds = args.skillIds;
          if (args.context_refs !== undefined || args.contextReferences !== undefined) {
            patch.context_refs = args.context_refs || args.contextReferences || [];
          }
          if (args.preview_only !== undefined || args.previewOnly !== undefined) {
            const raw = args.preview_only ?? args.previewOnly;
            patch.previewOnly = raw === true || String(raw).toLowerCase() === 'true';
          }
          if (args.expected_outputs !== undefined || args.expectedOutputs !== undefined) {
            patch.expectedOutputs = normalizeExpectedOutputs(args.expected_outputs ?? args.expectedOutputs);
          }
          if (patch.tz !== undefined) {
            const tzError = validateScheduleTimezone(patch.tz);
            if (tzError) return { name, args, result: tzError, error: true };
          }
          if (patch.schedule) {
            const existingJob = deps.cronScheduler.getJobs().find((j: any) => j.id === jobId);
            const cronError = validateCronExpression(patch.schedule, patch.tz !== undefined ? patch.tz : existingJob?.tz);
            if (cronError) return { name, args, result: cronError, error: true };
          }

          if (Object.keys(patch).length === 0) {
            return { name, args, result: 'No update fields provided for schedule_job(update).', error: true };
          }

          if (patch.type === 'one-shot' && !patch.runAt) {
            return { name, args, result: 'Updating to one_shot requires schedule.run_at', error: true };
          }
          if (patch.type === 'recurring' && patch.schedule === '') {
            return { name, args, result: 'Updating to recurring requires schedule.cron', error: true };
          }
          if (patch.runAt) {
            const parsed = new Date(String(patch.runAt));
            if (!Number.isFinite(parsed.getTime())) {
              return { name, args, result: `Invalid run_at value: "${patch.runAt}"`, error: true };
            }
            patch.runAt = parsed.toISOString();
          }

          let updated: any;
          try {
            updated = deps.cronScheduler.updateJob(jobId, patch as any);
          } catch (err: any) {
            return { name, args, result: `schedule_job(update) rejected: ${err?.message || err}`, error: true };
          }
          if (!updated) return { name, args, result: `Job not found: ${jobId}`, error: true };
          if (String(updated.team_id || '').trim()) {
            return {
              name,
              args,
              result: JSON.stringify({
                success: true,
                action: 'update',
                job: summarizeCronJob(updated),
                assigned_team: updated.team_id,
                message: `Scheduled team job "${updated.name}" updated for team "${updated.team_id}".`,
              }, null, 2),
              error: false,
            };
          }
          const ownerId = String(updated.subagent_id || '').trim();
          if (ownerId) {
            ensureScheduleRuntimeForAgent(ownerId, {
              scheduleId: updated.id,
              scheduleName: updated.name,
              prompt: updated.prompt,
              model: updated.model,
            });
          } else if (updated.assignmentTarget !== 'main' || updated.sessionTarget !== 'main' || updated.deliverToMainChannel !== true) {
            updated = deps.cronScheduler.updateJob(updated.id, {
              assignmentTarget: 'main',
              sessionTarget: 'main',
              deliverToMainChannel: true,
            } as any) || updated;
          }
          return {
            name,
            args,
            result: JSON.stringify({
              success: true,
              action: 'update',
              job: summarizeCronJob(updated),
              assigned_owner: ownerId ? { subagent_id: ownerId, created: false } : { agent_id: 'main', created: false },
              message: ownerId
                ? `Scheduled job "${updated.name}" updated and assigned to subagent "${ownerId}".`
                : `Scheduled job "${updated.name}" updated and assigned to Prometheus itself.`,
            }, null, 2),
            error: false,
          };
        }

        return { name, args, result: `Unsupported schedule_job action: ${action}`, error: true };
      }

      case 'system_diagnostics': {
        try {
          const out = systemDiagnosticsTool({ scheduler: deps.cronScheduler, workspacePath }, args);
          return { name, args, result: JSON.stringify(out.data), error: false };
        } catch (err: any) {
          return { name, args, result: `system_diagnostics error: ${err.message}`, error: true };
        }
      }

      case 'diagnostic_packet': {
        try {
          const action = String(args.action || 'create').toLowerCase();
          const data = action === 'create' ? createDiagnosticPacket(workspacePath, args)
            : action === 'get' ? getDiagnosticPacket(workspacePath, String(args.packet_id || args.id || ''))
            : action === 'list' ? listDiagnosticPackets(workspacePath, Number(args.limit) || 20)
            : action === 'resolve' ? updateDiagnosticPacketStatus(workspacePath, String(args.packet_id || args.id || ''), 'resolved')
            : null;
          if (!data) return { name, args, result: `diagnostic_packet ${action} found no result.`, error: true };
          return { name, args, result: JSON.stringify(data), error: false };
        } catch (err: any) {
          return { name, args, result: `diagnostic_packet error: ${err.message}`, error: true };
        }
      }

      case 'schedule_job_history': {
        const out = scheduleJobHistoryTool(deps.cronScheduler, args);
        return {
          name,
          args,
          result: JSON.stringify(out, null, 2),
          error: !out.success,
        };
      }

      case 'schedule_job_detail': {
        const out = scheduleJobDetailTool(deps.cronScheduler, args);
        return {
          name,
          args,
          result: JSON.stringify(out, null, 2),
          error: !out.success,
        };
      }

      case 'schedule_job_log_search': {
        const out = scheduleJobLogSearchTool(deps.cronScheduler, args);
        return {
          name,
          args,
          result: JSON.stringify(out, null, 2),
          error: !out.success,
        };
      }

      case 'schedule_job_patch': {
        const out = scheduleJobPatchTool(deps.cronScheduler, args);
        return {
          name,
          args,
          result: JSON.stringify(out, null, 2),
          error: !out.success,
        };
      }

      case 'schedule_job_outputs': {
        const out = scheduleJobOutputsTool(deps.cronScheduler, args);
        return {
          name,
          args,
          result: JSON.stringify(out, null, 2),
          error: !out.success,
        };
      }

      case 'schedule_job_stuck_control': {
        const out = await scheduleJobStuckControlTool(deps.cronScheduler, args);
        return {
          name,
          args,
          result: JSON.stringify(out, null, 2),
          error: !out.success,
        };
      }

      case 'automation_dashboard': {
        const out = automationDashboardTool(deps.cronScheduler, args);
        return {
          name,
          args,
          result: JSON.stringify(out, null, 2),
          error: !out.success,
        };
      }

      case 'prometheus_thread_ops': {
        try {
          const out = await executePrometheusThreadOps(sessionId, args, {
            runInteractiveTurn: deps.runInteractiveTurn,
            broadcastWS: deps.broadcastWS,
            ownerSessionIdOverride: deps.threadOpsOwnerSessionId,
            supervisionIdOverride: deps.threadOpsSupervisionId,
            abortSignal: deps.abortSignal,
          });
          const threadLinks = buildPrometheusThreadLinksArtifact(args, out);
          // Compact JSON: pretty-printing added ~30% tokens to results that
          // already averaged 6-12k tokens (read/list/find/status).
          return {
            name,
            args,
            result: JSON.stringify({ success: true, ...out }),
            error: false,
            extra: threadLinks ? { richArtifacts: [threadLinks] } : undefined,
          };
        } catch (err: any) {
          return { name, args, result: `prometheus_thread_ops error: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'prometheus_request_ops': {
        try {
          const out = await executePrometheusRequestOps(sessionId, args, {
            runInteractiveTurn: deps.runInteractiveTurn,
            broadcastWS: deps.broadcastWS,
          });
          return {
            name,
            args,
            result: JSON.stringify(out, null, 2),
            error: out.success === false,
          };
        } catch (err: any) {
          return { name, args, result: `prometheus_request_ops error: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'prometheus_audit_ops': {
        try {
          const out = await executePrometheusAuditOpsInWorker(sessionId, args);
          return { name, args, result: JSON.stringify({ success: true, ...out }, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `prometheus_audit_ops error: ${String(err?.message || err)}`, error: true };
        }
      }

      default:
        return { name, args, result: `Unhandled automation tool: ${name}`, error: true };
    }
  },
};
