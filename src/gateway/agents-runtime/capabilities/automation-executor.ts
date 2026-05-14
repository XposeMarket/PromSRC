import { backgroundJoin, backgroundProgress, backgroundSpawn, backgroundWait } from '../../tasks/task-runner';
import {
  automationDashboardTool,
  scheduleJobDetailTool,
  scheduleJobHistoryTool,
  scheduleJobLogSearchTool,
  scheduleJobOutputsTool,
  scheduleJobPatchTool,
  scheduleJobStuckControlTool,
} from '../../scheduling/schedule-admin-tools';
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
} from '../../internal-watch/internal-watch-store';
import { observeInternalWatchTarget } from '../../internal-watch/internal-watch-runner';
import { getSessionChannelHint } from '../../comms/broadcaster';
import type { CapabilityExecutionContext, CapabilityExecutor } from './types';
import {
  normalizeDeliveryChannel,
  normalizeScheduleJobAction,
  summarizeCronJob,
  type ToolResult,
} from '../../tool-builder';
import { getManagedTeam } from '../../teams/managed-teams';
import { ensureScheduleOwnerAgent, ensureScheduleRuntimeForAgent } from '../../scheduling/schedule-agent';

const AUTOMATION_TOOL_NAMES = new Set([
  'background_spawn',
  'background_status',
  'background_progress',
  'background_wait',
  'background_join',
  'task_control',
  'timer',
  'internal_watch',
  'schedule_job',
  'schedule_job_history',
  'schedule_job_detail',
  'schedule_job_log_search',
  'schedule_job_patch',
  'schedule_job_outputs',
  'schedule_job_stuck_control',
  'automation_dashboard',
]);

export const automationCapabilityExecutor: CapabilityExecutor = {
  id: 'automation',

  canHandle(name: string): boolean {
    return AUTOMATION_TOOL_NAMES.has(name);
  },

  async execute(ctx: CapabilityExecutionContext): Promise<ToolResult> {
    const { name, args, deps, sessionId } = ctx;

    switch (name) {
      case 'background_spawn': {
        try {
          const prompt = String(args.task_prompt || args.prompt || '').trim();
          if (!prompt) return { name, args, result: 'background_spawn requires task_prompt', error: true };
          const modelOverride = String(args.model_override || args.model || '').trim() || undefined;
          const providerOverride = String(args.provider_override || args.provider || '').trim() || undefined;
          const status = backgroundSpawn({
            prompt,
            spawnerSessionId: sessionId,
            joinPolicy: args.join_policy || 'wait_all',
            timeoutMs: args.timeout_ms,
            tags: args.tags,
            modelOverride,
            providerOverride,
          });
          return { name, args, result: JSON.stringify(status), error: false };
        } catch (err: any) {
          return { name, args, result: `background_spawn error: ${err.message}`, error: true };
        }
      }

      case 'background_status':
      case 'background_progress': {
        const bgId = String(args.background_id || '').trim();
        if (!bgId) return { name, args, result: 'background_id is required', error: true };
        const status = backgroundProgress(bgId);
        if (!status) return { name, args, result: `No background agent found with id: ${bgId}`, error: true };
        return { name, args, result: JSON.stringify(status), error: false };
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

      case 'task_control': {
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
        const mainChatOnly = !/^(cron_|task_|background_|dispatch_|self_repair_|team_|agent_|auto_)/i.test(String(sessionId || ''));
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
            sessionId,
            instruction,
            dueAt,
            label: String(args.label || '').trim() || undefined,
          });
          deps.broadcastWS?.({ type: 'timer_created', timer, sessionId });
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
          });
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
          const targetConfig: Record<string, any> = { ...targetRaw };
          delete targetConfig.type;
          if (targetType === 'file') {
            targetConfig.path = String(targetConfig.path || args.path || '').trim();
            if (!targetConfig.path) return { name, args, result: 'internal_watch(create file) requires target.path', error: true };
          } else if (targetType === 'task') {
            targetConfig.taskId = String(targetConfig.taskId || targetConfig.task_id || args.task_id || args.taskId || '').trim();
            if (!targetConfig.taskId) return { name, args, result: 'internal_watch(create task) requires target.task_id', error: true };
          } else if (targetType === 'scheduled_job') {
            targetConfig.jobId = String(targetConfig.jobId || targetConfig.job_id || args.job_id || args.jobId || '').trim();
            if (!targetConfig.jobId) return { name, args, result: 'internal_watch(create scheduled_job) requires target.job_id', error: true };
          } else if (targetType === 'event_queue') {
            targetConfig.match = targetConfig.match || args.match || undefined;
          }

          const onMatch = String(args.on_match || args.onMatch || args.instruction || '').trim();
          if (!onMatch) return { name, args, result: 'internal_watch(create) requires on_match', error: true };
          const ttlMsRaw = Number(args.ttl_ms ?? args.ttlMs);
          const ttlMs = Number.isFinite(ttlMsRaw) && ttlMsRaw > 0 ? Math.floor(ttlMsRaw) : undefined;
          const condition = args.condition && typeof args.condition === 'object' ? args.condition : {};
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
          const rawKind = String(schedule.kind || args.kind || 'recurring').trim().toLowerCase();
          const kind: 'recurring' | 'one-shot' = (rawKind === 'one_shot' || rawKind === 'one-shot') ? 'one-shot' : 'recurring';
          const cron = String(schedule.cron || args.cron || '').trim();
          const runAtRaw = String(schedule.run_at || args.run_at || '').trim();
          const timezone = String(args.timezone || args.tz || '').trim() || undefined;
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

          const requestedTeamId = String(args.team_id || args.teamId || '').trim() || undefined;
          if (requestedTeamId && !getManagedTeam(requestedTeamId)) {
            return { name, args, result: `Team not found: ${requestedTeamId}`, error: true };
          }
          const requestedSubagentId = requestedTeamId ? undefined : (String(args.subagent_id || '').trim() || undefined);

          let created = deps.cronScheduler.createJob({
            name: nameValue,
            prompt: instructionPrompt,
            type: kind,
            schedule: kind === 'recurring' ? cron : undefined,
            runAt: kind === 'one-shot' ? new Date(runAtRaw).toISOString() : undefined,
            tz: timezone,
            sessionTarget: 'isolated',
            model: modelOverride,
            subagent_id: requestedSubagentId,
            team_id: requestedTeamId,
            assignmentTarget: requestedTeamId ? 'team' : (requestedSubagentId ? 'subagent' : 'main'),
            deliverToMainChannel: !requestedTeamId && !requestedSubagentId,
          } as any);
          const owner = requestedTeamId
            ? { agentId: '', created: false }
            : requestedSubagentId
            ? { agentId: requestedSubagentId, created: false }
            : ensureScheduleOwnerAgent({
                scheduleId: created.id,
                scheduleName: created.name,
                prompt: instructionPrompt,
                model: modelOverride,
              });
          if (owner.agentId) {
            ensureScheduleRuntimeForAgent(owner.agentId, {
              scheduleId: created.id,
              scheduleName: created.name,
              prompt: instructionPrompt,
              model: modelOverride,
            });
          }
          if (!requestedTeamId && (created.subagent_id !== owner.agentId || created.sessionTarget !== 'isolated')) {
            created = deps.cronScheduler.updateJob(created.id, {
              subagent_id: owner.agentId,
              sessionTarget: 'isolated',
              assignmentTarget: requestedSubagentId ? 'subagent' : 'main',
              deliverToMainChannel: !requestedSubagentId,
            } as any) || created;
          }

          return {
            name,
            args,
            result: JSON.stringify({
              success: true,
              action: 'create',
              job: summarizeCronJob(created),
              assigned_team: requestedTeamId || undefined,
              assigned_owner: owner.agentId ? {
                subagent_id: owner.agentId,
                created: owner.created,
              } : undefined,
              message: requestedTeamId
                ? `Scheduled team job "${created.name}" created for team "${requestedTeamId}".`
                : `Scheduled job "${created.name}" created and assigned to schedule owner "${owner.agentId}".`,
            }, null, 2),
            error: false,
          };
        }

        if (!jobId) {
          return { name, args, result: `schedule_job(${action}) requires job_id`, error: true };
        }

        if (action === 'pause') {
          const updated = deps.cronScheduler.updateJob(jobId, { status: 'paused', enabled: false } as any);
          if (!updated) return { name, args, result: `Job not found: ${jobId}`, error: true };
          return { name, args, result: JSON.stringify({ success: true, action: 'pause', job: summarizeCronJob(updated) }, null, 2), error: false };
        }

        if (action === 'resume') {
          const updated = deps.cronScheduler.updateJob(jobId, { status: 'scheduled', enabled: true } as any);
          if (!updated) return { name, args, result: `Job not found: ${jobId}`, error: true };
          return { name, args, result: JSON.stringify({ success: true, action: 'resume', job: summarizeCronJob(updated) }, null, 2), error: false };
        }

        if (action === 'run_now') {
          const exists = deps.cronScheduler.getJobs().some((j: any) => j.id === jobId);
          if (!exists) return { name, args, result: `Job not found: ${jobId}`, error: true };
          deps.cronScheduler.runJobNow(jobId, { respectActiveHours: false }).catch((err: any) =>
            console.error(`[schedule_job] run_now failed for ${jobId}:`, err?.message || err)
          );
          return {
            name,
            args,
            result: JSON.stringify({ success: true, action: 'run_now', job_id: jobId, message: 'Job queued for immediate run.' }, null, 2),
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
            if (sessionTarget === 'main' || sessionTarget === 'isolated') patch.sessionTarget = 'isolated';
            if (sessionTarget === 'main') {
              patch.assignmentTarget = 'main';
              patch.deliverToMainChannel = true;
            }
          }
          if (args.subagent_id !== undefined) {
            const subagentId = String(args.subagent_id || '').trim();
            if (subagentId) {
              patch.subagent_id = subagentId;
              patch.team_id = undefined;
              patch.assignmentTarget = 'subagent';
              patch.deliverToMainChannel = false;
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

          let updated = deps.cronScheduler.updateJob(jobId, patch as any);
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
          const owner = String(updated.subagent_id || '').trim()
            ? { agentId: String(updated.subagent_id || '').trim(), created: false }
            : ensureScheduleOwnerAgent({
                scheduleId: updated.id,
                scheduleName: updated.name,
                prompt: updated.prompt,
                model: updated.model,
              });
          ensureScheduleRuntimeForAgent(owner.agentId, {
            scheduleId: updated.id,
            scheduleName: updated.name,
            prompt: updated.prompt,
            model: updated.model,
          });
          if (updated.subagent_id !== owner.agentId || updated.sessionTarget !== 'isolated') {
            updated = deps.cronScheduler.updateJob(updated.id, {
              subagent_id: owner.agentId,
              sessionTarget: 'isolated',
              assignmentTarget: owner.created ? 'main' : updated.assignmentTarget,
              deliverToMainChannel: owner.created ? true : updated.deliverToMainChannel,
            } as any) || updated;
          }
          return {
            name,
            args,
            result: JSON.stringify({
              success: true,
              action: 'update',
              job: summarizeCronJob(updated),
              assigned_owner: {
                subagent_id: owner.agentId,
                created: owner.created,
              },
              message: `Scheduled job "${updated.name}" updated and assigned to schedule owner "${owner.agentId}".`,
            }, null, 2),
            error: false,
          };
        }

        return { name, args, result: `Unsupported schedule_job action: ${action}`, error: true };
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

      default:
        return { name, args, result: `Unhandled automation tool: ${name}`, error: true };
    }
  },
};
