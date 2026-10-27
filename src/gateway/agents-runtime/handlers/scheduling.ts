import { getManagedTeam } from './../../teams/managed-teams';
import { normalizeScheduleSpec } from './../../scheduling/schedule-pattern';
import { normalizeScheduleJobAction, summarizeCronJob, normalizeDeliveryChannel } from './../../tool-builder';
import { ensureScheduleRuntimeForAgent } from './../../scheduling/schedule-agent';
import { cancelMainChatTimer, createMainChatTimer, listMainChatTimers, updateMainChatTimer } from './../../timers/timer-store';
import { automationDashboardTool, scheduleJobDetailTool, scheduleJobHistoryTool, scheduleJobLogSearchTool, scheduleJobOutputsTool, scheduleJobPatchTool, scheduleJobStuckControlTool } from './../../scheduling/schedule-admin-tools';
import { normalizeScheduleToolSkillIds, normalizeScheduleToolContextRefs } from './../subagent-executor';
import type { createWorkspaceHelpers } from '../workspace-helpers';

export interface handleSchedulingToolContext extends ReturnType<typeof createWorkspaceHelpers> {
 name: string;
 args: Parameters<typeof import('../subagent-executor').executeTool>[1];
 workspacePath: string;
 deps: import('../subagent-executor').ExecuteToolDeps;
 sessionId: string;
 __dirname: string;
}
export async function handleSchedulingTool(ctx: handleSchedulingToolContext): Promise<Awaited<ReturnType<typeof import('../subagent-executor').executeTool>>> {
 const { name, args, workspacePath, deps, sessionId, __dirname, _isProposalSession, hasPrometheusSourceShape, candidateProjectRootsFromAllowedWorkspaces, resolveProjectRootForSourceAccess, PROM_ROOT_ALLOWED_ROOT_FILES, PROM_ROOT_ALLOWED_DIRECTORIES, PROM_ROOT_DENIED_TOP_LEVEL, normalizePromPath, isPromDeniedPath, isPromAllowedPath, promAllowlistSummary, resolvePromAllowedPath, resolvePromAllowedFilePath, ensureProposalPromWriteTool, writeToolResultOverflow, maybeSpoolToolOutput, renderNumberedRead, validateSyntaxFileResult, normalizeFindTextForRecovery, tokenSetForRecovery, countCommonTokensForRecovery, renderCandidateSnippetForRecovery, applyTolerantFindReplace, lineNumberAtOffset, formatPostEditContext, buildTextNotFoundRecovery, scorePathSuggestion, buildPathNotFoundRecovery, buildLineOutOfRangeRecovery, recoverWorkspacePathError, renderDirectoryEntries, normalizePathForPermissionCompare, isPathInsideForPermissions, getRuntimeDiagnosticsReadRoots, resolveAllowedWorkspacePath, resolveFilePath, resolveWorkspacePath, snapshotPreMutation, withWorkspaceSnapshots, resolveWorkspaceDirectory, quoteArg, truncateText, isSkippableWorkspaceEntry, walkFiles, countDirectoryFiles, extractPatchTargetPaths, validatePatchTargetPaths, runCapturedToolCommand, readPackageScripts, snapshotRoot, listSnapshots, isCodeFile, getLineAndCharacterFromPos, buildCodeOutlineForFile, collectCodeSymbols, mutationScope, normalizeScopePath, isWithinAllowedDir, enforceMutationScope, resolveProposalExecutionTask, isDevSrcSelfEditProposalSession, isDevSourceWriteApprovedSession, ensureDevSrcSelfEditWriteSession, enforceProposalWriteAccess, resolveRunCommandCwd, getRunCommandAllowedRoots, extractAbsolutePathsFromCommand, boundaryRank, uniqueStrings, mergeCommandBoundary, envPath, userProfileRoots, isInsideUserProfile, commandBoundaryFromPatterns, applyCommandPathBoundary, analyzeRunCommandBoundary, stableToolArgsForPermission, getShellApprovalMode, maybeBlockShellTokenPolicy, normalizeUrlOrigin, buildScopedToolPermissionCandidate } = ctx;
 switch (name) {


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
	            fromGoalTurn: true,
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
          let normalizedSchedule;
          try {
            normalizedSchedule = normalizeScheduleSpec({
              ...schedule,
              kind: schedule.kind || args.kind || 'recurring',
              cron: schedule.cron || args.cron,
              run_at: schedule.run_at || args.run_at,
            }, timezone);
          } catch (err: any) {
            return { name, args, result: err.message, error: true };
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

          const requestedTeamId = String(args.team_id || args.teamId || '').trim() || undefined;
          if (requestedTeamId && !getManagedTeam(requestedTeamId)) {
            return { name, args, result: `Team not found: ${requestedTeamId}`, error: true };
          }
          const requestedSubagentId = requestedTeamId ? undefined : (String(args.subagent_id || '').trim() || undefined);
          const assignmentTarget = requestedTeamId ? 'team' : (requestedSubagentId ? 'subagent' : 'main');

          let created = deps.cronScheduler.createJob({
            name: nameValue,
            prompt: instructionPrompt,
            precheck: args.precheck,
            type: normalizedSchedule.kind === 'one-shot' ? 'one-shot' : 'recurring',
            schedule: normalizedSchedule.kind === 'recurring' ? normalizedSchedule.cron : undefined,
            runAt: normalizedSchedule.kind === 'one-shot' ? normalizedSchedule.runAt : undefined,
            tz: timezone,
            sessionTarget: assignmentTarget === 'main' ? 'main' : 'isolated',
            model: modelOverride,
            subagent_id: requestedSubagentId,
            team_id: requestedTeamId,
            assignmentTarget,
            deliverToMainChannel: assignmentTarget === 'main',
            skillIds: normalizeScheduleToolSkillIds(args.skillIds),
            context_refs: normalizeScheduleToolContextRefs(args.context_refs || args.contextReferences),
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
          if (args.precheck !== undefined) patch.precheck = args.precheck;

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
          if (args.skillIds !== undefined) {
            patch.skillIds = normalizeScheduleToolSkillIds(args.skillIds);
          }
          if (args.context_refs !== undefined || args.contextReferences !== undefined) {
            const existingJob = deps.cronScheduler.getJobStatus(jobId)?.job;
            patch.context_refs = normalizeScheduleToolContextRefs(
              args.context_refs || args.contextReferences,
              existingJob?.context_refs || existingJob?.contextReferences || []
            );
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
          const hasScheduleUpdate = rawKind || schedule.cron !== undefined || args.cron !== undefined || schedule.run_at !== undefined || args.run_at !== undefined || schedule.text !== undefined || schedule.time !== undefined || schedule.days_of_week !== undefined || schedule.daysOfWeek !== undefined || schedule.repeat !== undefined || schedule.every_hours !== undefined || schedule.everyHours !== undefined || schedule.every_days !== undefined || schedule.everyDays !== undefined;
          if (hasScheduleUpdate) {
            try {
              const normalizedSchedule = normalizeScheduleSpec({
                ...schedule,
                kind: schedule.kind || args.kind || undefined,
                cron: schedule.cron ?? args.cron,
                run_at: schedule.run_at ?? args.run_at,
              }, String(args.timezone || args.tz || '').trim() || undefined);
              patch.type = normalizedSchedule.kind === 'one-shot' ? 'one-shot' : 'recurring';
              if (normalizedSchedule.kind === 'recurring') {
                patch.schedule = normalizedSchedule.cron;
                patch.runAt = null;
              } else {
                patch.runAt = normalizedSchedule.runAt;
                patch.schedule = null;
              }
            } catch (err: any) {
              return { name, args, result: err.message, error: true };
            }
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
 }
 throw new Error(`Unsupported scheduling tool: ${name}`);
}
