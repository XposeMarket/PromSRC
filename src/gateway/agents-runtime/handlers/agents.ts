import path from 'path';
import { getConfig, getAgentById } from './../../../config/config';
import { SubagentManager } from './../subagent-manager';
import { appendSubagentChatMessage, getSubagentChatHistory } from './../subagent-chat-store';
import { getResourceStore } from './../../resources/resource-store';
import { listManagedTeams, createManagedTeam, getManagedTeam, saveManagedTeam, appendTeamChat, updateTeamMemberState, createTeamDispatchRecord, findActiveTeamDispatch, updateTeamDispatchRecord, getOrCreateTeamDirectThread, enqueueTeamDirectThreadUserMessage } from './../../teams/managed-teams';
import { deleteAgentCompletely, deleteTeamCompletely } from './../entity-delete';
import { triggerManagerReview, handleManagerConversation, verifySubagentResult } from './../../teams/team-manager-runner';
import { runTeamMemberDirectTurn, scheduleTeamMemberDirectWake } from './../../teams/team-member-room';
import { routeTeamEvent } from './../../teams/team-event-router';
import { claimAgentForTeamWorkspace } from './../../teams/team-workspace';
import { recordAgentRun } from './../../../scheduler';
import { getSessionChannelHint } from './../../comms/broadcaster';
import { backgroundSpawn, backgroundJoin, backgroundProgress, backgroundSteer, backgroundWait, compactBackgroundToolPayload, listBackgroundStatuses } from './../../tasks/task-runner';
import { normalizeSpawnToolCategoriesArg } from './../../tasks/spawn-tool-categories-arg';
import { resolveBackgroundWorkDirArg } from './../background-work-dir';
import { listTaskSummaries, loadTask, type TaskRecord } from './../../tasks/task-store';
import { cancelInternalWatch, createInternalWatch, listInternalWatches } from './../../internal-watch/internal-watch-store';
import { observeInternalWatchTarget, refreshInternalWatchObservation } from './../../internal-watch/internal-watch-runner';
import { getBgAgentResults, buildTeamDispatchTaskLazy, inferTeamNoteContext, clampAgentChatTimeoutMs, getStandaloneSubagentChatSessionId, getStandaloneSubagentForChat, parseAgentRunStatusFilter, inferAgentRunOwner, agentOwnsRunTask, agentRunCanRecover, summarizeAgentRunForTool, summarizeAgentRunCompact, buildAgentRunToolSnapshot, resolveAgentRunTaskForTool, runStandaloneSubagentChatFromTool, startAgentConversationBackground, executeTool } from './../subagent-executor';
import type { createWorkspaceHelpers } from '../workspace-helpers';

export interface handleAgentsToolContext extends ReturnType<typeof createWorkspaceHelpers> {
 name: string;
 args: Parameters<typeof import('../subagent-executor').executeTool>[1];
 workspacePath: string;
 deps: import('../subagent-executor').ExecuteToolDeps;
 sessionId: string;
 __dirname: string;
}
export async function handleAgentsTool(ctx: handleAgentsToolContext): Promise<Awaited<ReturnType<typeof import('../subagent-executor').executeTool>>> {
 const { name, args, workspacePath, deps, sessionId, __dirname, _isProposalSession, hasPrometheusSourceShape, candidateProjectRootsFromAllowedWorkspaces, resolveProjectRootForSourceAccess, PROM_ROOT_ALLOWED_ROOT_FILES, PROM_ROOT_ALLOWED_DIRECTORIES, PROM_ROOT_DENIED_TOP_LEVEL, normalizePromPath, isPromDeniedPath, isPromAllowedPath, promAllowlistSummary, resolvePromAllowedPath, resolvePromAllowedFilePath, ensureProposalPromWriteTool, writeToolResultOverflow, maybeSpoolToolOutput, renderNumberedRead, validateSyntaxFileResult, normalizeFindTextForRecovery, tokenSetForRecovery, countCommonTokensForRecovery, renderCandidateSnippetForRecovery, applyTolerantFindReplace, lineNumberAtOffset, formatPostEditContext, buildTextNotFoundRecovery, scorePathSuggestion, buildPathNotFoundRecovery, buildLineOutOfRangeRecovery, recoverWorkspacePathError, renderDirectoryEntries, normalizePathForPermissionCompare, isPathInsideForPermissions, getRuntimeDiagnosticsReadRoots, resolveAllowedWorkspacePath, resolveFilePath, resolveWorkspacePath, snapshotPreMutation, withWorkspaceSnapshots, resolveWorkspaceDirectory, quoteArg, truncateText, isSkippableWorkspaceEntry, walkFiles, countDirectoryFiles, extractPatchTargetPaths, validatePatchTargetPaths, runCapturedToolCommand, readPackageScripts, snapshotRoot, listSnapshots, isCodeFile, getLineAndCharacterFromPos, buildCodeOutlineForFile, collectCodeSymbols, mutationScope, normalizeScopePath, isWithinAllowedDir, enforceMutationScope, resolveProposalExecutionTask, isDevSrcSelfEditProposalSession, isDevSourceWriteApprovedSession, ensureDevSrcSelfEditWriteSession, enforceProposalWriteAccess, resolveRunCommandCwd, getRunCommandAllowedRoots, extractAbsolutePathsFromCommand, boundaryRank, uniqueStrings, mergeCommandBoundary, envPath, userProfileRoots, isInsideUserProfile, commandBoundaryFromPatterns, applyCommandPathBoundary, analyzeRunCommandBoundary, stableToolArgsForPermission, getShellApprovalMode, maybeBlockShellTokenPolicy, normalizeUrlOrigin, buildScopedToolPermissionCandidate } = ctx;
 switch (name) {


      case 'agent_run_ops': {
        const rawAction = String(args?.action || '').trim().toLowerCase();
        const action = rawAction === 'details' || rawAction === 'detail' || rawAction === 'status'
          ? 'get'
          : rawAction === 'chat' || rawAction === 'message'
            ? 'recover'
            : rawAction;
        const includeTask = args?.include_task === true || args?.includeTask === true;
        const includeEvidence = args?.include_evidence !== false && args?.includeEvidence !== false;
        if (!action) return { name, args, result: 'agent_run_ops requires action', error: true };
        const watchPolicy = deps.internalWatchContext;
        const readOnlyAgentRunActions = new Set(['list', 'get']);
        if (watchPolicy && !readOnlyAgentRunActions.has(action)) {
          const explicitTaskId = String(args?.task_id || args?.taskId || args?.id || '').trim();
          const permitted = watchPolicy.actionPolicy === 'recover_same_run'
            ? action === 'steer' || action === 'resume'
            : watchPolicy.actionPolicy === 'full_rerun_allowed'
              ? action === 'steer' || action === 'resume' || action === 'rerun'
              : false;
          if (!permitted || !watchPolicy.targetTaskId || explicitTaskId !== watchPolicy.targetTaskId) {
            return {
              name,
              args,
              result: JSON.stringify({
                success: false,
                action,
                code: 'internal_watch_policy_denied',
                watch_id: watchPolicy.watchId,
                policy: watchPolicy.actionPolicy,
                target_task_id: watchPolicy.targetTaskId || null,
                allowed_actions: watchPolicy.actionPolicy === 'full_rerun_allowed'
                  ? ['list', 'get', 'steer', 'resume', 'rerun']
                  : watchPolicy.actionPolicy === 'recover_same_run'
                    ? ['list', 'get', 'steer', 'resume']
                    : ['list', 'get'],
                message: 'Watch-triggered agent-run mutation requires an explicit task_id matching the watched task and a policy-permitted action.',
              }, null, 2),
              error: true,
            };
          }
        }

        if (action === 'benchmark_disposable') {
          const benchmarkStartedAt = Date.now();
          const timeoutMs = Math.max(10_000, Math.min(300_000, Number(args?.timeout_ms || 120_000)));
          const agentId = `benchmark_disposable_${Date.now().toString(36)}`;
          const workspacePath = getConfig().getConfig().workspace?.path || process.cwd();
          const manager = new SubagentManager(workspacePath, deps.broadcastWS, deps.handleChat, deps.telegramChannel);
          let taskId = '';
          let cleanedAgent = false;
          let cleanedTask = false;
          try {
            const launched = await manager.callSubagent({
              subagent_id: agentId,
              task_prompt: String(args?.prompt || 'Return exactly RESULT=disposable agent operational and SIDE_EFFECTS=none. Do not use tools or change external state.'),
              run_now: true,
              delivery_mode: 'task_panel_only',
              create_if_missing: {
                name: 'Disposable Benchmark Agent',
                description: 'Temporary bounded agent used to verify standalone provisioning, execution, routing, and cleanup.',
                system_instructions: 'Follow the bounded benchmark prompt exactly. Do not use tools or create side effects.',
                constraints: ['No tools', 'No file or external changes', 'Return a concise result'],
                success_criteria: 'Return the requested result and side-effect declaration.',
                max_steps: 2,
                timeout_ms: timeoutMs,
                model: args?.model ? String(args.model) : undefined,
                reasoning_effort: args?.reasoning_effort ? String(args.reasoning_effort) : undefined,
                roleType: String(args?.role || 'researcher'),
              },
            }, sessionId);
            taskId = launched.task_id;
            const deadline = Date.now() + timeoutMs;
            let task = taskId ? loadTask(taskId) : null;
            while (task && !['complete', 'failed', 'paused', 'stalled', 'needs_assistance', 'awaiting_user_input'].includes(String(task.status)) && Date.now() < deadline) {
              await new Promise((resolve) => setTimeout(resolve, 250));
              task = loadTask(taskId);
            }
            const timedOut = Date.now() >= deadline && task && !['complete', 'failed'].includes(String(task.status));
            if (timedOut && taskId) await deps.handleTaskControlAction(sessionId, { action: 'cancel', task_id: taskId, confirm: true, note: 'Disposable benchmark timeout cleanup.' }).catch(() => null);
            const finalTask = taskId ? loadTask(taskId) : task;
            const response = {
              ok: finalTask?.status === 'complete',
              agent_id: agentId,
              task_id: taskId,
              status: finalTask?.status || launched.status,
              model: finalTask?.executorProvider || null,
              executor_reasoning_effort: finalTask?.executorReasoningEffort || null,
              role: String(args?.role || 'researcher'),
              result: String(finalTask?.finalSummary || '').slice(0, 2000),
              timed_out: !!timedOut,
              elapsed_ms: Date.now() - benchmarkStartedAt,
              side_effect_policy: 'no tools or external changes requested',
            };
            if (taskId) {
              const deleted = await deps.handleTaskControlAction(sessionId, { action: 'delete', task_id: taskId, confirm: true }).catch(() => null);
              cleanedTask = deleted?.success === true;
            }
            const agentDelete = deleteAgentCompletely({
              agentId,
              cronScheduler: deps.cronScheduler,
              broadcastTeamEvent: deps.broadcastTeamEvent,
            });
            cleanedAgent = agentDelete.success === true && !getAgentById(agentId);
            cleanedTask = cleanedTask && !loadTask(taskId);
            const cleanupVerified = cleanedAgent && cleanedTask;
            return { name, args, result: JSON.stringify({ ...response, cleanup: { agent_deleted: cleanedAgent, task_deleted: cleanedTask, verified: cleanupVerified } }, null, 2), error: response.ok !== true || !cleanupVerified };
          } catch (error: any) {
            if (taskId) {
              await deps.handleTaskControlAction(sessionId, { action: 'cancel', task_id: taskId, confirm: true }).catch(() => null);
              await deps.handleTaskControlAction(sessionId, { action: 'delete', task_id: taskId, confirm: true }).catch(() => null);
              cleanedTask = !loadTask(taskId);
            }
            const agentDelete = deleteAgentCompletely({
              agentId,
              cronScheduler: deps.cronScheduler,
              broadcastTeamEvent: deps.broadcastTeamEvent,
            });
            cleanedAgent = agentDelete.success === true && !getAgentById(agentId);
            return { name, args, result: JSON.stringify({ ok: false, agent_id: agentId, task_id: taskId || null, error: String(error?.message || error), cleanup: { agent_deleted: cleanedAgent, task_deleted: cleanedTask, verified: cleanedAgent && (!taskId || cleanedTask) } }, null, 2), error: true };
          }
        }

        if (action === 'list') {
          const agentId = String(args?.agent_id || args?.agentId || '').trim();
          if (agentId && !getAgentById(agentId)) {
            return { name, args, result: `Unknown agent: ${agentId}. Call agent_list first.`, error: true };
          }
          const statuses = parseAgentRunStatusFilter(args?.status);
          const recoverableOnly = args?.recoverable_only === true || args?.recoverableOnly === true;
          const limitRaw = Number(args?.limit);
          const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(100, Math.floor(limitRaw)) : 20;
          const detail = String(args?.detail || 'compact').trim().toLowerCase();
          const taskSummaries = listTaskSummaries(statuses ? { status: statuses } : undefined)
            .filter((task) => !!inferAgentRunOwner(task))
            .filter((task) => !agentId || agentOwnsRunTask(agentId, task))
            .filter((task) => !recoverableOnly || agentRunCanRecover(task))
            .sort((a, b) => Number(b.lastProgressAt || b.startedAt || 0) - Number(a.lastProgressAt || a.startedAt || 0))
            .slice(0, limit)
            .map((summary) => loadTask(summary.id))
            .filter((task): task is TaskRecord => !!task);
          const tasks = taskSummaries;
          return {
            name,
            args,
            result: JSON.stringify({
              success: true,
              action,
              agent_id: agentId || null,
              status_filter: statuses || null,
              recoverable_only: recoverableOnly,
              detail,
              runs: tasks.map((task) => detail === 'full' ? summarizeAgentRunForTool(task, agentId || undefined) : summarizeAgentRunCompact(task, agentId || undefined)),
              // Team managers run as live team_manager runtimes, not task records,
              // so they never appeared here and looked like they never ran.
              team_manager_runtimes: (() => {
                try {
                  const { listLiveRuntimes } = require('./../../live-runtime-registry');
                  return (listLiveRuntimes() as any[])
                    .filter((rt) => rt?.kind === 'team_manager' && (!agentId || rt.agentId === agentId || `${rt.teamId}_manager` === agentId))
                    .slice(-10)
                    .map((rt) => ({ id: rt.id, teamId: rt.teamId, agentId: rt.agentId, status: rt.status, sessionId: rt.sessionId, startedAt: rt.startedAt || null, detail: String(rt.detail || '').slice(0, 160) }));
                } catch { return []; }
              })(),
              message: tasks.length
                ? `Found ${tasks.length} agent-owned run(s).`
                : 'No matching agent-owned runs found. Team manager turns are listed under team_manager_runtimes and team_manage(status).',
            }, null, 2),
            error: false,
          };
        }

        if (action === 'get') {
          const resolved = resolveAgentRunTaskForTool(args?.agent_id || args?.agentId, args?.task_id || args?.taskId || args?.id);
          if (!resolved.task) {
            return {
              name,
              args,
              result: JSON.stringify({ success: false, action, code: resolved.code || 'not_found', message: resolved.error }, null, 2),
              error: true,
            };
          }
          return {
            name,
            args,
            result: JSON.stringify({
              success: true,
              action,
              agent_id: resolved.agentId,
              ...buildAgentRunToolSnapshot(resolved.task, resolved.agentId, { includeTask, includeEvidence }),
            }, null, 2),
            error: false,
          };
        }

        if (action === 'steer') {
          const message = String(args?.message || args?.prompt || args?.instruction || '').trim();
          if (!message) return { name, args, result: 'agent_run_ops steer requires message', error: true };
          const resolved = resolveAgentRunTaskForTool(args?.agent_id || args?.agentId, args?.task_id || args?.taskId || args?.id);
          if (!resolved.task) {
            return {
              name,
              args,
              result: JSON.stringify({ success: false, action, code: resolved.code || 'not_found', message: resolved.error }, null, 2),
              error: true,
            };
          }
          const ctl = await deps.handleTaskControlAction(sessionId, {
            action: 'steer',
            task_id: resolved.task.id,
            message,
            source: 'agent_run_ops',
            resume_after_message: args?.resume_after_message === true || args?.resumeAfterMessage === true,
          });
          const updated = loadTask(resolved.task.id) || resolved.task;
          return {
            name,
            args,
            result: JSON.stringify({
              success: ctl.success === true,
              action,
              agent_id: resolved.agentId,
              task_id: resolved.task.id,
              control: ctl,
              ...buildAgentRunToolSnapshot(updated, resolved.agentId, { includeTask, includeEvidence }),
            }, null, 2),
            error: ctl.success !== true,
          };
        }

        if (action === 'recover') {
          const message = String(args?.message || args?.prompt || '').trim();
          if (!message) return { name, args, result: 'agent_run_ops recover requires message', error: true };
          const resolved = resolveAgentRunTaskForTool(args?.agent_id || args?.agentId, args?.task_id || args?.taskId || args?.id);
          if (!resolved.task) {
            return {
              name,
              args,
              result: JSON.stringify({ success: false, action, code: resolved.code || 'not_found', message: resolved.error }, null, 2),
              error: true,
            };
          }
          const sourceRaw = String(args?.source || '').trim();
          const validSources = new Set(['chat', 'subagent_chat', 'team_chat', 'team_manager']);
          const recoverySource = (validSources.has(sourceRaw) ? sourceRaw : 'chat') as 'chat' | 'subagent_chat' | 'team_chat' | 'team_manager';
          try {
            const { handleTaskRecoveryMessage, isTaskRouterInitialized } = await import('./../../tasks/task-router');
            if (!isTaskRouterInitialized()) {
              return { name, args, result: JSON.stringify({ success: false, action, code: 'task_router_not_ready', message: 'Task recovery runtime is not initialized yet. Retry after gateway startup completes.' }, null, 2), error: true };
            }
            const recovery = await handleTaskRecoveryMessage(resolved.task.id, message, {
              sourceSessionId: String(args?.source_session_id || args?.sourceSessionId || sessionId || '').trim(),
              source: recoverySource,
              visibleMessage: String(args?.visible_message || args?.visibleMessage || message).trim(),
            });
            const updated = loadTask(resolved.task.id) || resolved.task;
            return {
              name,
              args,
              result: JSON.stringify({
                success: recovery.handled === true,
                action,
                agent_id: resolved.agentId,
                task_id: resolved.task.id,
                handled: recovery.handled,
                resumed: recovery.resumed,
                recovery_action: recovery.action || null,
                reply: recovery.reply,
                message: recovery.handled
                  ? 'Recovery conversation updated.'
                  : `Task "${resolved.task.id}" is not currently eligible for recovery chat.`,
                ...buildAgentRunToolSnapshot(updated, resolved.agentId, { includeTask, includeEvidence }),
              }, null, 2),
              error: recovery.handled !== true,
            };
          } catch (err: any) {
            return { name, args, result: `agent_run_ops recover error: ${err?.message || err}`, error: true };
          }
        }

        if (action === 'resume' || action === 'rerun' || action === 'pause' || action === 'cancel') {
          const resolved = resolveAgentRunTaskForTool(args?.agent_id || args?.agentId, args?.task_id || args?.taskId || args?.id);
          if (!resolved.task) {
            return {
              name,
              args,
              result: JSON.stringify({ success: false, action, code: resolved.code || 'not_found', message: resolved.error }, null, 2),
              error: true,
            };
          }
          const ctl = await deps.handleTaskControlAction(sessionId, {
            action,
            task_id: resolved.task.id,
            note: String(args?.note || args?.message || '').trim(),
            confirm: args?.confirm === true,
          });
          const updated = loadTask(resolved.task.id) || resolved.task;
          return {
            name,
            args,
            result: JSON.stringify({
              success: ctl.success === true,
              action,
              agent_id: resolved.agentId,
              task_id: resolved.task.id,
              control: ctl,
              ...buildAgentRunToolSnapshot(updated, resolved.agentId, { includeTask, includeEvidence }),
            }, null, 2),
            error: ctl.success !== true,
          };
        }

        return {
          name,
          args,
          result: `Unsupported agent_run_ops action "${rawAction}". Use list, get, steer, recover, resume, rerun, pause, cancel, or benchmark_disposable.`,
          error: true,
        };
      }

      case 'chat_with_subagent': {
        const agentId = String(args?.agent_id || '').trim();
        const message = String(args?.message || '').trim();
        const context = String(args?.context || '').trim();
        if (!message) return { name, args, result: 'chat_with_subagent requires message', error: true };
        {
          // Team members are reachable through the same chat tool: when the caller
          // passes target_type=team_member (or a team_id), or the agent belongs to a
          // team, route to the team direct-thread path instead of rejecting with an
          // error that tells the caller to do exactly what it just did.
          const requestedType = String(args?.target_type || '').trim();
          const owningTeam = agentId
            ? listManagedTeams().find((t: any) => Array.isArray(t.subagentIds) && t.subagentIds.includes(agentId))
            : undefined;
          if (requestedType === 'team_member' || requestedType === 'team_manager' || args?.team_id || owningTeam) {
            const delegated = await executeTool('agent_message_send', {
              target_type: requestedType === 'team_manager' ? 'team_manager' : 'team_member',
              team_id: String(args?.team_id || owningTeam?.id || '').trim(),
              agent_id: agentId,
              message,
              context,
              request_turn: true,
              background: false,
              user_label: args?.user_label,
            }, workspacePath, deps, sessionId);
            return { name, args, result: delegated.result, error: delegated.error };
          }
        }
        const { error } = getStandaloneSubagentForChat(agentId);
        if (error) return { name, args, result: error, error: true };

        const startedAt = Date.now();
        const chatMessage = context ? `${message}\n\nContext:\n${context}` : message;
        try {
          const chat = await runStandaloneSubagentChatFromTool({
            agentId,
            message: chatMessage,
            source: 'chat_with_subagent',
            parentSessionId: sessionId,
            userLabel: String(args?.user_label || 'Main Agent').trim() || 'Main Agent',
            timeoutMs: clampAgentChatTimeoutMs(args?.timeout_ms),
          });
          return {
            name,
            args,
            result: JSON.stringify({
              success: true,
              target_type: 'standalone_subagent',
              agent_id: agentId,
              thread_id: getStandaloneSubagentChatSessionId(agentId),
              after_ts: startedAt,
              reply: chat.result?.text || '',
              thinking: args?.include_thinking === true ? chat.result?.thinking : undefined,
              messages: args?.include_history === true
                ? chat.messages.slice(-Math.max(1, Math.min(20, Number(args?.history_limit || 3))))
                : undefined,
            }, null, 2),
            error: false,
          };
        } catch (err: any) {
          return { name, args, result: `chat_with_subagent error: ${err.message}`, error: true };
        }
      }

      case 'agent_message_send': {
        const targetType = String(args?.target_type || (args?.team_id ? 'team_member' : 'standalone_subagent')).trim();
        const message = String(args?.message || '').trim();
        const context = String(args?.context || '').trim();
        const content = context ? `${message}\n\nContext:\n${context}` : message;
        const requestTurn = args?.request_turn === true;
        const background = args?.background === true;
        const userLabel = String(args?.user_label || 'Main Agent').trim() || 'Main Agent';
        if (!message) return { name, args, result: 'agent_message_send requires message', error: true };

        if (targetType === 'standalone_subagent') {
          const agentId = String(args?.agent_id || '').trim();
          const { error } = getStandaloneSubagentForChat(agentId);
          if (error) return { name, args, result: error, error: true };
          if (requestTurn) {
            const run = async () => {
              const chat = await runStandaloneSubagentChatFromTool({
                agentId,
                message: content,
                source: 'agent_message_send',
                parentSessionId: sessionId,
                userLabel,
                timeoutMs: clampAgentChatTimeoutMs(args?.timeout_ms),
              });
              return {
                success: true,
                target_type: 'standalone_subagent',
                agent_id: agentId,
                thread_id: getStandaloneSubagentChatSessionId(agentId),
                reply: chat.result?.text || '',
                thinking: chat.result?.thinking,
                messages: chat.messages,
              };
            };
            if (background) {
              const taskId = startAgentConversationBackground({
                prefix: 'agent_chat',
                agentId,
                promiseFactory: run,
              });
              return {
                name,
                args,
                result: JSON.stringify({
                  success: true,
                  status: 'running',
                  task_id: taskId,
                  target_type: 'standalone_subagent',
                  agent_id: agentId,
                  thread_id: getStandaloneSubagentChatSessionId(agentId),
                  response: 'Message sent and a background chat turn was started. Use get_agent_result(task_id) or agent_reply_wait(...) to collect the reply.',
                }, null, 2),
                error: false,
              };
            }
            const result = await run();
            return { name, args, result: JSON.stringify(result, null, 2), error: false };
          }

          const chatMsg = appendSubagentChatMessage(agentId, {
            role: 'user',
            content,
            metadata: {
              source: 'agent_message_send',
              parentSessionId: sessionId,
              from: userLabel,
              requestTurn: false,
            },
          });
          deps.broadcastWS?.({ type: 'subagent_chat_message', agentId, message: chatMsg });
          return {
            name,
            args,
            result: JSON.stringify({
              success: true,
              status: 'delivered',
              request_turn: false,
              target_type: 'standalone_subagent',
              agent_id: agentId,
              thread_id: getStandaloneSubagentChatSessionId(agentId),
              message_id: chatMsg.id,
              after_ts: chatMsg.ts,
            }, null, 2),
            error: false,
          };
        }

        if (targetType === 'team_member') {
          const teamId = String(args?.team_id || '').trim();
          const agentId = String(args?.agent_id || '').trim();
          if (!teamId || !agentId) return { name, args, result: 'agent_message_send target_type=team_member requires team_id and agent_id', error: true };
          const team = getManagedTeam(teamId);
          if (!team) return { name, args, result: `Team not found: ${teamId}`, error: true };
          if (team.manager?.paused === true) return { name, args, result: `Team "${team.name}" is paused.`, error: true };
          if (!team.subagentIds.includes(agentId)) return { name, args, result: `Agent "${agentId}" is not a member of team "${team.name}".`, error: true };
          if (team.agentPauseStates?.[agentId]?.paused === true) return { name, args, result: `Agent "${agentId}" is paused on team "${team.name}".`, error: true };

          const agentName = String((getAgentById(agentId) as any)?.name || agentId).trim();
          const thread = getOrCreateTeamDirectThread(teamId, 'member', agentId, agentName);
          if (!thread) return { name, args, result: 'Could not create team direct thread.', error: true };
          const userMsg = appendTeamChat(teamId, {
            from: 'user',
            fromName: userLabel,
            content,
            threadId: String(thread.id || '').trim(),
            metadata: {
              source: 'agent_message_send',
              targetType: 'member',
              targetId: agentId,
              targetLabel: agentName,
            },
          });
          deps.broadcastTeamEvent?.({ type: 'team_chat_message', teamId, teamName: team.name, chatMessage: userMsg, text: userMsg?.content || '' });
          enqueueTeamDirectThreadUserMessage(teamId, 'member', agentId, agentName, content, userMsg?.id);

          if (requestTurn) {
            if (background) {
              const scheduled = scheduleTeamMemberDirectWake(teamId, agentId, String(thread.id || '').trim(), {
                reason: 'A direct agent_message_send requested a team member reply.',
                delayMs: Number.isFinite(Number(args?.delay_ms)) ? Math.max(0, Math.floor(Number(args.delay_ms))) : 0,
              });
              return {
                name,
                args,
                result: JSON.stringify({
                  success: scheduled,
                  status: scheduled ? 'scheduled' : 'not_scheduled',
                  target_type: 'team_member',
                  team_id: teamId,
                  agent_id: agentId,
                  thread_id: thread.id,
                  message_id: userMsg?.id,
                  after_ts: userMsg?.timestamp,
                }, null, 2),
                error: !scheduled,
              };
            }
            const result = await runTeamMemberDirectTurn(teamId, agentId, String(thread.id || '').trim(), {
              autoWakeReason: 'A direct agent_message_send requested a team member reply.',
            });
            return {
              name,
              args,
              result: JSON.stringify({
                success: result.success,
                target_type: 'team_member',
                team_id: teamId,
                agent_id: agentId,
                thread_id: thread.id,
                message_id: userMsg?.id,
                after_ts: userMsg?.timestamp,
                reply: result.result,
                error: result.error,
                duration_ms: result.durationMs,
                step_count: result.stepCount,
              }, null, 2),
              error: result.success !== true,
            };
          }

          return {
            name,
            args,
            result: JSON.stringify({
              success: true,
              status: 'delivered',
              request_turn: false,
              target_type: 'team_member',
              team_id: teamId,
              agent_id: agentId,
              thread_id: thread.id,
              message_id: userMsg?.id,
              after_ts: userMsg?.timestamp,
            }, null, 2),
            error: false,
          };
        }

        if (targetType === 'team_manager') {
          const teamId = String(args?.team_id || '').trim();
          if (!teamId) return { name, args, result: 'agent_message_send target_type=team_manager requires team_id', error: true };
          const team = getManagedTeam(teamId);
          if (!team) return { name, args, result: `Team not found: ${teamId}`, error: true };
          if (team.manager?.paused === true) return { name, args, result: `Team "${team.name}" is paused.`, error: true };
          const thread = getOrCreateTeamDirectThread(teamId, 'manager', 'manager', 'manager');
          if (!thread) return { name, args, result: 'Could not create manager direct thread.', error: true };
          const userMsg = appendTeamChat(teamId, {
            from: 'user',
            fromName: userLabel,
            content,
            threadId: String(thread.id || '').trim(),
            metadata: {
              source: 'agent_message_send',
              targetType: 'manager',
              targetId: 'manager',
              targetLabel: 'manager',
            },
          });
          deps.broadcastTeamEvent?.({ type: 'team_chat_message', teamId, teamName: team.name, chatMessage: userMsg, text: userMsg?.content || '' });

          if (requestTurn) {
            const run = async () => {
              await handleManagerConversation(teamId, content, deps.broadcastTeamEvent, false, {
                sessionIdOverride: String(thread.sessionId || '').trim() || undefined,
                threadId: String(thread.id || '').trim() || undefined,
                replyTargetType: 'user',
                replyTargetId: 'user',
                replyTargetLabel: userLabel,
              });
              return {
                success: true,
                target_type: 'team_manager',
                team_id: teamId,
                thread_id: thread.id,
                message_id: userMsg?.id,
                after_ts: userMsg?.timestamp,
              };
            };
            if (background) {
              const taskId = startAgentConversationBackground({
                prefix: 'team_manager_chat',
                teamId,
                promiseFactory: run,
              });
              return {
                name,
                args,
                result: JSON.stringify({
                  success: true,
                  status: 'running',
                  task_id: taskId,
                  target_type: 'team_manager',
                  team_id: teamId,
                  thread_id: thread.id,
                  message_id: userMsg?.id,
                  after_ts: userMsg?.timestamp,
                }, null, 2),
                error: false,
              };
            }
            const result = await run();
            return { name, args, result: JSON.stringify(result, null, 2), error: false };
          }

          return {
            name,
            args,
            result: JSON.stringify({
              success: true,
              status: 'delivered',
              request_turn: false,
              target_type: 'team_manager',
              team_id: teamId,
              thread_id: thread.id,
              message_id: userMsg?.id,
              after_ts: userMsg?.timestamp,
            }, null, 2),
            error: false,
          };
        }

        return { name, args, result: `Unsupported target_type "${targetType}". Use standalone_subagent, team_member, or team_manager.`, error: true };
      }

      case 'agent_turn_request': {
        const targetType = String(args?.target_type || (args?.team_id ? 'team_member' : 'standalone_subagent')).trim();
        const prompt = String(args?.prompt || args?.message || '').trim();
        if (!prompt) return { name, args, result: 'agent_turn_request requires prompt', error: true };

        if (targetType === 'standalone_subagent') {
          const delegated = await executeTool('chat_with_subagent', {
            agent_id: args?.agent_id,
            message: prompt,
            context: args?.context,
            timeout_ms: args?.timeout_ms,
            user_label: args?.user_label || 'Main Agent',
          }, workspacePath, deps, sessionId);
          return { name, args, result: delegated.result, error: delegated.error };
        }

        if (targetType === 'team_member' || targetType === 'team_manager') {
          const delegated = await executeTool('agent_message_send', {
            target_type: targetType,
            team_id: args?.team_id,
            agent_id: args?.agent_id,
            message: prompt,
            context: args?.context,
            request_turn: true,
            background: args?.background === true,
            delay_ms: args?.delay_ms,
            timeout_ms: args?.timeout_ms,
            user_label: args?.user_label || 'Main Agent',
          }, workspacePath, deps, sessionId);
          return { name, args, result: delegated.result, error: delegated.error };
        }

        return { name, args, result: `Unsupported target_type "${targetType}". Use standalone_subagent, team_member, or team_manager.`, error: true };
      }

      case 'agent_reply_wait': {
        const targetType = String(args?.target_type || (args?.team_id ? 'team_member' : 'standalone_subagent')).trim();
        const afterTs = Math.max(0, Number(args?.after_ts || args?.after || 0) || 0);
        const block = args?.block !== false;
        const timeoutMs = block ? clampAgentChatTimeoutMs(args?.timeout_ms, 15000) : 0;
        const pollMs = Math.max(250, Math.min(5000, Number(args?.poll_ms) || 1000));
        const deadline = Date.now() + timeoutMs;

        const collect = () => {
          if (targetType === 'standalone_subagent') {
            const agentId = String(args?.agent_id || '').trim();
            const { error } = getStandaloneSubagentForChat(agentId);
            if (error) return { error };
            const replies = getSubagentChatHistory(agentId, 100)
              .filter((msg: any) => msg?.role === 'agent' && Number(msg?.ts || 0) > afterTs)
              .map((msg: any) => ({
                id: msg.id,
                ts: msg.ts,
                role: msg.role,
                content: msg.content,
                metadata: msg.metadata,
              }));
            return {
              success: true,
              target_type: 'standalone_subagent',
              agent_id: agentId,
              thread_id: getStandaloneSubagentChatSessionId(agentId),
              replies,
            };
          }

          if (targetType === 'team_member' || targetType === 'team_manager') {
            const teamId = String(args?.team_id || '').trim();
            const agentId = String(args?.agent_id || '').trim();
            const threadId = String(args?.thread_id || '').trim();
            const team = getManagedTeam(teamId);
            if (!team) return { error: `Team not found: ${teamId}` };
            if (targetType === 'team_member' && !agentId) return { error: 'agent_reply_wait target_type=team_member requires agent_id' };
            const messages = (Array.isArray(team.teamChat) ? team.teamChat : [])
              .filter((msg: any) => Number(msg?.timestamp || 0) > afterTs)
              .filter((msg: any) => !threadId || String(msg?.threadId || '') === threadId)
              .filter((msg: any) => {
                if (targetType === 'team_manager') return msg?.from === 'manager';
                return msg?.from === 'subagent' && String(msg?.fromAgentId || '') === agentId;
              })
              .map((msg: any) => ({
                id: msg.id,
                ts: msg.timestamp,
                from: msg.from,
                fromName: msg.fromName,
                fromAgentId: msg.fromAgentId,
                threadId: msg.threadId,
                content: msg.content,
                metadata: msg.metadata,
              }));
            return {
              success: true,
              target_type: targetType,
              team_id: teamId,
              agent_id: targetType === 'team_member' ? agentId : undefined,
              thread_id: threadId || undefined,
              replies: messages,
            };
          }

          return { error: `Unsupported target_type "${targetType}". Use standalone_subagent, team_member, or team_manager.` };
        };

        let snapshot = collect();
        while (!snapshot.error && Array.isArray((snapshot as any).replies) && (snapshot as any).replies.length === 0 && block && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, pollMs));
          snapshot = collect();
        }
        if (snapshot.error) return { name, args, result: snapshot.error, error: true };
        const replies = Array.isArray((snapshot as any).replies) ? (snapshot as any).replies : [];
        const latestTs = replies.reduce((max: number, msg: any) => Math.max(max, Number(msg?.ts || 0)), afterTs);
        const completed = replies.length > 0;
        return {
          name,
          args,
          result: JSON.stringify({
            ...(snapshot as any),
            success: completed,
            completed,
            status: replies.length ? 'reply_available' : block && timeoutMs > 0 ? 'timed_out' : 'no_reply',
            delivered: true,
            waited_ms: block ? Math.min(timeoutMs, Math.max(0, Date.now() - (deadline - timeoutMs))) : 0,
            timeout_ms: timeoutMs,
            latest_ts: latestTs,
          }, null, 2),
          error: false,
        };
      }

      case 'agent_thread_watch': {
        const targetType = String(args?.target_type || (args?.team_id ? 'team_member' : 'standalone_subagent')).trim();
        const watchId = String(args?.watch_id || args?.id || `agent_watch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`).trim();
        const afterTs = Math.max(0, Number(args?.after_ts || args?.after || Date.now()) || Date.now());
        if (args?.block === true) {
          const delegated = await executeTool('agent_reply_wait', {
            target_type: targetType,
            agent_id: args?.agent_id,
            team_id: args?.team_id,
            thread_id: args?.thread_id,
            after_ts: afterTs,
            block: true,
            timeout_ms: args?.timeout_ms,
            poll_ms: args?.poll_ms,
          }, workspacePath, deps, sessionId);
          return { name, args, result: delegated.result, error: delegated.error };
        }
        return {
          name,
          args,
          result: JSON.stringify({
            success: true,
            status: 'watch_descriptor_created',
            watch_id: watchId,
            target_type: targetType,
            agent_id: args?.agent_id,
            team_id: args?.team_id,
            thread_id: args?.thread_id,
            after_ts: afterTs,
            poll_with: 'agent_reply_wait',
            note: 'This is a lightweight agent-thread watch descriptor. Use it from heartbeat/schedule code, or call agent_reply_wait with the returned fields. For durable task completion watches, use internal_watch on a task_id.',
          }, null, 2),
          error: false,
        };
      }

      case 'dispatch_team_agent': {
        const teamId = String(args?.team_id || '').trim();
        const agentId = String(args?.agent_id || '').trim();
        const task = String(args?.task || args?.task_prompt || args?.taskPrompt || args?.message || '').trim();
        const context = args?.context ? String(args.context) : undefined;
        // Default to background when called from outside the team (main chat):
        // a foreground dispatch blocked the caller for the member's whole run
        // (2-7 min each). Inside the manager keep blocking so it can review.
        const callerTeamContext = inferTeamNoteContext(sessionId);
        const background = typeof args?.background === 'boolean'
          ? args.background
          : String(args?.background || '').toLowerCase() === 'true' ? true
          : String(args?.background || '').toLowerCase() === 'false' ? false
          : !callerTeamContext;
        if (!teamId || !agentId || !task) {
          return { name, args, result: 'ERROR: dispatch_team_agent requires team_id, agent_id, and task', error: true };
        }
        const team = getManagedTeam(teamId);
        if (!team) return { name, args, result: `ERROR: Team not found: ${teamId}`, error: true };
        if (team.manager?.paused === true) return { name, args, result: `ERROR: Team "${team.name}" is paused.`, error: true };
        if (!team.subagentIds.includes(agentId)) {
          return { name, args, result: `ERROR: Agent "${agentId}" is not a member of team "${team.name}".`, error: true };
        }
        if (team.agentPauseStates?.[agentId]?.paused === true) {
          return { name, args, result: `ERROR: Agent "${agentId}" is paused on team "${team.name}".`, error: true };
        }

        // One live dispatch per member. Managers re-dispatched the same build
        // when a running record showed no task id; refuse and point them at the
        // live run instead (force:true overrides for a genuinely lost run).
        const forceDispatch = args?.force === true || String(args?.force || '').toLowerCase() === 'true';
        const activeSame = findActiveTeamDispatch(team, agentId);
        if (activeSame && !forceDispatch) {
          const memberName = String((getAgentById(agentId) as any)?.name || agentId);
          return {
            name,
            args,
            result: JSON.stringify({
              success: false,
              status: 'already_running',
              team_id: teamId,
              agent_id: agentId,
              dispatch_id: activeSame.id,
              task_id: activeSame.taskId || null,
              running_task: activeSame.taskSummary,
              note: `${memberName} is already working on this team (dispatch ${activeSame.id}). Do not re-dispatch: you will be woken with the result when it finishes. Pass force:true only if that run is confirmed lost.`,
            }, null, 2),
            error: true,
          };
        }

        deps.bindTeamNotificationTargetFromSession(teamId, sessionId, 'dispatch_team_agent');
        const dispatchPrompt = buildTeamDispatchTaskLazy({ agentId, task, teamId, context });
        // Mint the background handle up front so the dispatch record carries it
        // from the start (it used to stay taskId:null until the run finished).
        const bgTaskId = background
          ? `team_bg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
          : undefined;
        const dispatchRecord = createTeamDispatchRecord(teamId, {
          agentId,
          agentName: String((getAgentById(agentId) as any)?.name || agentId),
          taskSummary: task,
          requestedBy: inferTeamNoteContext(sessionId)?.authorId || 'manager',
          taskId: bgTaskId,
        });
        updateTeamMemberState(teamId, agentId, {
          status: 'running',
          currentTask: task,
          blockedReason: undefined,
        });
        const dispatchChatMsg = appendTeamChat(teamId, {
          from: 'manager',
          fromName: 'Manager',
          content: `Dispatched ${agentId}: ${task}`,
        });
        try {
          const subagentChatMsg = appendSubagentChatMessage(agentId, {
            role: 'user',
            content: context ? `${task}\n\nContext:\n${context}` : task,
            metadata: {
              source: background ? 'dispatch_team_agent_background' : 'dispatch_team_agent',
              teamId,
              requestedBy: dispatchRecord?.requestedBy || inferTeamNoteContext(sessionId)?.authorId || 'manager',
              dispatchId: dispatchRecord?.id,
            },
          });
          deps.broadcastWS?.({ type: 'subagent_chat_message', agentId, message: subagentChatMsg });
        } catch {}
        deps.broadcastTeamEvent({
          type: 'team_chat_message',
          teamId,
          teamName: team.name,
          chatMessage: dispatchChatMsg,
          text: dispatchChatMsg?.content || '',
        });
        deps.broadcastTeamEvent({ type: 'team_dispatch', teamId, teamName: team.name, agentId, task });

        const run = async () => {
          if (dispatchRecord) {
            updateTeamDispatchRecord(teamId, dispatchRecord.id, {
              status: 'running',
              startedAt: Date.now(),
            });
          }
          const result = await deps.runTeamAgentViaChat(agentId, dispatchPrompt.effectiveTask, teamId);
          if (dispatchRecord) {
            updateTeamDispatchRecord(teamId, dispatchRecord.id, {
              status: result.success ? 'completed' : result.admissionCode ? 'capacity_limited' : 'failed',
              finishedAt: Date.now(),
              // Keep the handle the manager was given; fall back to the run's task id.
              taskId: bgTaskId || result.taskId,
              resultPreview: String(result.result || result.error || ''),
              admissionCode: result.admissionCode,
            });
          }
          updateTeamMemberState(teamId, agentId, {
            status: result.success ? 'ready' : result.admissionCode ? 'waiting_for_context' : 'blocked',
            currentTask: result.success ? '' : task,
            blockedReason: result.success ? '' : result.admissionCode
              ? `Capacity limited; retryable admission result (${result.admissionCode}). ${String(result.error || '').slice(0, 400)}`
              : String(result.error || result.result || 'Task failed').slice(0, 500),
            lastResult: String(result.result || result.error || '').slice(0, 1000),
          });
          const resultChatMsg = appendTeamChat(teamId, {
            from: 'subagent',
            fromName: String(result.agentName || (getAgentById(agentId) as any)?.name || agentId),
            fromAgentId: agentId,
            content: result.success
              ? `Task complete: ${String(result.result || '')}`
              : result.admissionCode
                ? `Task queued for retry: ${result.error || result.result || 'runtime capacity is temporarily full'}`
                : `Task failed: ${result.error || result.result || 'unknown error'}`,
            metadata: {
              agentId,
              runSuccess: result.success,
              taskId: result.taskId,
              stepCount: result.stepCount,
              durationMs: result.durationMs,
              thinking: result.thinking,
              processEntries: result.processEntries,
              liveTraceEntries: result.liveTraceEntries,
              admissionCode: result.admissionCode,
            },
          });
          try {
            const subagentChatMsg = appendSubagentChatMessage(agentId, {
              role: 'agent',
              content: result.success
                ? String(result.result || '').trim() || 'Task complete.'
                : result.admissionCode
                  ? `Task queued for retry: ${result.error || result.result || 'runtime capacity is temporarily full'}`
                  : `Task failed: ${result.error || result.result || 'unknown error'}`,
              metadata: {
                source: background ? 'dispatch_team_agent_background' : 'dispatch_team_agent',
                teamId,
                taskId: result.taskId,
                dispatchId: dispatchRecord?.id,
                success: result.success,
                stepCount: result.stepCount,
                durationMs: result.durationMs,
                thinking: result.thinking,
                processEntries: result.processEntries,
                liveTraceEntries: result.liveTraceEntries,
                admissionCode: result.admissionCode,
              },
            });
            deps.broadcastWS?.({ type: 'subagent_chat_message', agentId, message: subagentChatMsg });
          } catch {}
          deps.broadcastTeamEvent({
            type: 'team_chat_message',
            teamId,
            teamName: team.name,
            chatMessage: resultChatMsg,
            text: resultChatMsg?.content || '',
          });
          routeTeamEvent({
            type: result.success ? 'member_completed_task' : 'member_failed_task',
            teamId,
            agentId,
            agentName: result.agentName,
            task,
            resultSummary: String(result.result || '').trim(),
            error: result.error,
            warning: result.warning,
            admissionCode: result.admissionCode,
            taskId: result.taskId,
            dispatchId: dispatchRecord?.id,
            stepCount: result.stepCount,
            durationMs: result.durationMs,
            source: background ? 'dispatch_team_agent_background' : 'dispatch_team_agent',
          });
          deps.broadcastTeamEvent({
            type: 'team_dispatch_complete',
            teamId,
            teamName: team.name,
            agentId,
            agentName: result.agentName,
            taskId: result.taskId,
            success: result.success,
            durationMs: result.durationMs,
            stepCount: result.stepCount,
            resultPreview: String(result.result || result.error || ''),
            admissionCode: result.admissionCode,
          });
          return result;
        };

        if (background && bgTaskId) {
          const taskId = bgTaskId;
          const promise = run()
            .then((result) => {
              const entry = getBgAgentResults().get(taskId);
              if (entry) {
                entry.status = result.admissionCode
                  ? 'capacity_limited'
                  : result.success ? 'complete' : 'failed';
                entry.result = result;
              }
              return result;
            })
            .catch((err: any) => {
              const result = {
                success: false,
                result: '',
                error: String(err?.message || err),
                durationMs: 0,
                agentName: agentId,
              };
              const entry = getBgAgentResults().get(taskId);
              if (entry) {
                entry.status = 'failed';
                entry.result = result;
              }
              return result;
            });
          getBgAgentResults().set(taskId, {
            status: 'running',
            agentId,
            teamId,
            startedAt: Date.now(),
            promise,
          });
          return {
            name,
            args,
            result: JSON.stringify({ success: true, status: 'running', task_id: taskId, team_id: teamId, agent_id: agentId }, null, 2),
            error: false,
          };
        }

        const result = await run();
        return {
          name,
          args,
          result: JSON.stringify({
            success: result.success,
            team_id: teamId,
            agent_id: agentId,
            agent_name: result.agentName,
            task_id: result.taskId,
            duration_ms: result.durationMs,
            step_count: result.stepCount,
            result: result.result,
            error: result.error,
            warning: result.warning,
            admission_code: result.admissionCode,
          }, null, 2),
          error: result.success !== true,
        };
      }

      case 'background_spawn': {
        try {
          const prompt = String(args.task_prompt || args.prompt || '').trim();
          if (!prompt) return { name, args, result: 'background_spawn requires task_prompt', error: true };
          const requestedResourceIds = Array.isArray(args.resource_ids || args.resourceIds)
            ? (args.resource_ids || args.resourceIds).map((value: unknown) => String(value || '').trim()).filter(Boolean).slice(0, 100)
            : [];
          const workDirScope = resolveBackgroundWorkDirArg(args.work_dir ?? args.workDir ?? args.cwd, workspacePath);
          if (workDirScope.error) return { name, args, result: `background_spawn error: ${workDirScope.error}`, error: true };
          const status = backgroundSpawn({
            prompt,
            spawnerSessionId: sessionId,
            ...(workDirScope.workDir ? { workDir: workDirScope.workDir, allowedWorkPaths: workDirScope.allowedWorkPaths } : {}),
            resourceIds: getResourceStore(workspacePath)
              .listThreadResources(sessionId, { limit: 100, resourceIds: requestedResourceIds })
              .map((resource) => resource.id),
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
        return { name, args, result: JSON.stringify(compactBackgroundToolPayload(status)), error: false };
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
          return { name, args, result: JSON.stringify(compactBackgroundToolPayload(result)), error: false };
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
	          // Team managers are woken by dispatch completion events (team-event-router);
	          // task-watch polling caused id mismatches and post-completion wake loops.
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
	          const actionPolicy = String(args.action_policy || args.actionPolicy || '').trim() === 'recover_same_run'
	            ? 'recover_same_run'
	            : String(args.action_policy || args.actionPolicy || '').trim() === 'full_rerun_allowed'
	              ? 'full_rerun_allowed'
	              : 'review_only';
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
	            rationale: String(args.rationale || args.reason || '').trim() || undefined,
	            deliverySessionId: String(args.delivery_session_id || args.deliverySessionId || '').trim() || undefined,
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

      case 'team_manage': {
        try {
          const action = String(args.action || '').trim().toLowerCase();
          if (!action) {
            return { name, args, result: 'team_manage requires action: list|status|create|update|set_allowed_work_paths|start|trigger_review|dispatch|pause|resume|delete', error: true };
          }

          if (action === 'list') {
            const teams = listManagedTeams().map((t) => ({
              id: t.id,
              name: t.name,
              description: t.description,
              emoji: t.emoji,
              subagentIds: t.subagentIds,
              allowedWorkPaths: Array.isArray((t as any).allowedWorkPaths) ? (t as any).allowedWorkPaths : [],
              teamContext: String(t.teamContext || '').slice(0, 220),
              reviewTrigger: t.manager.reviewTrigger,
              paused: t.manager?.paused === true,
              lastReviewAt: t.manager.lastReviewAt || null,
              totalRuns: t.totalRuns || 0,
            }));
            return {
              name,
              args,
              result: JSON.stringify({ success: true, action: 'list', count: teams.length, teams }, null, 2),
              error: false,
            };
          }

          if (action === 'delete') {
            const teamId = String(args.team_id || args.teamId || '').trim();
            if (!teamId) return { name, args, result: 'team_manage(delete) requires team_id', error: true };
            if (args.confirm !== true) {
              return { name, args, result: 'team_manage(delete) requires confirm=true because this permanently deletes the managed team, team workspace files, and member agents by default.', error: true };
            }
            const result = deleteTeamCompletely({
              teamId,
              cronScheduler: deps.cronScheduler,
              broadcastTeamEvent: deps.broadcastTeamEvent,
              deleteAgents: args.delete_agents !== false && args.deleteAgents !== false,
            });
            return {
              name,
              args,
              result: JSON.stringify(result, null, 2),
              error: result.success !== true,
            };
          }

          if (action === 'create') {
            const teamName = String(args.name || '').trim();
            const teamContext = String(args.team_context || args.teamContext || args.purpose || '').trim();
            if (!teamName || !teamContext) {
              return { name, args, result: 'team_manage(create) requires name and team_context (or purpose)', error: true };
            }

            const requestedIds = Array.isArray(args.subagent_ids)
              ? args.subagent_ids.map((v: any) => deps.sanitizeAgentId(v)).filter(Boolean)
              : [];
            const memberIds = new Set<string>(requestedIds);
            const createdSubagents: Array<{ subagent_id: string; status: string }> = [];

            // create_subagents path is disabled — agents must be pre-created via spawn_subagent(run_now:false)
            if (Array.isArray(args.create_subagents) && args.create_subagents.length > 0) {
              return {
                name, args,
                result: 'ERROR: create_subagents is not supported. CORRECT WORKFLOW:\n  STEP 1: Call spawn_subagent(subagent_id, run_now:false, create_if_missing:{...}) for each agent.\n  STEP 2: Then call team_manage(action:"create", subagent_ids:[...those IDs...]).\nRetry from STEP 1.',
                error: true,
              };
            }

            const finalIds = Array.from(memberIds);
            if (finalIds.length === 0) {
              return { name, args, result: 'team_manage(create) requires at least one subagent_id. WORKFLOW: create agents first with spawn_subagent(run_now:false), then pass their IDs here.', error: true };
            }
            const missing = finalIds.filter((id) => !getAgentById(id));
            if (missing.length > 0) {
              return { name, args, result: `Unknown subagent_ids: ${missing.join(', ')}`, error: true };
            }

            const rawTrigger = String(args.review_trigger || '').trim().toLowerCase();
            const reviewTrigger = (['after_each_run', 'after_all_runs', 'daily', 'manual'].includes(rawTrigger)
              ? rawTrigger
              : 'after_each_run') as 'after_each_run' | 'after_all_runs' | 'daily' | 'manual';

            const purposeStr = args.purpose ? String(args.purpose).slice(0, 1000) : undefined;
            const allowedWorkPaths = Array.isArray(args.allowed_work_paths)
              ? args.allowed_work_paths.map((v: any) => String(v).trim()).filter(Boolean)
              : Array.isArray(args.allowedWorkPaths)
                ? args.allowedWorkPaths.map((v: any) => String(v).trim()).filter(Boolean)
                : [];
	            const team = createManagedTeam({
              name: teamName.slice(0, 80),
              description: String(args.description || '').slice(0, 300),
              emoji: String(args.emoji || '🏠').slice(0, 4),
              subagentIds: finalIds,
              purpose: purposeStr,
              teamContext: teamContext.slice(0, 1000),
              managerSystemPrompt: String(
                args.manager_system_prompt || `You are the manager of the "${teamName}" team. Your purpose is: ${purposeStr || teamContext}`
              ).slice(0, 2000),
              managerModel: args.manager_model ? String(args.manager_model) : undefined,
              allowedWorkPaths,
              workDir: String(args.work_dir ?? args.workDir ?? '').trim()
                || (() => {
                  // eslint-disable-next-line @typescript-eslint/no-var-requires
                  const { inferTeamWorkDirFromText, resolveTeamWorkDir } = require('./../../teams/team-dispatch-runtime');
                  const inferred = inferTeamWorkDirFromText(`${purposeStr || ''}\n${teamContext}`);
                  return (inferred && resolveTeamWorkDir({ allowedWorkPaths, workDir: inferred })) || undefined;
                })(),
              reviewTrigger,
	              originatingSessionId: args.originating_session_id ? String(args.originating_session_id) : undefined,
	            });
            const claimedSubagents = finalIds
              .map((id) => ({ subagent_id: id, ...(claimAgentForTeamWorkspace(team.id, id) || {}) }))
              .filter((entry) => !!entry.identityPath);
	            deps.bindTeamNotificationTargetFromSession(team.id, sessionId, 'team_manage:create');

            // Default false — team must be explicitly started via trigger_review or the Start button.
            // Auto-kickoff was removed: teams should wait for the user to assign a first task.
            const kickoffInitial = args.kickoff_initial_review === true;
            const kickoffSecondsRaw = Number(args.kickoff_after_seconds);
            const kickoffSeconds = Number.isFinite(kickoffSecondsRaw)
              ? Math.max(5, Math.min(300, Math.floor(kickoffSecondsRaw)))
              : 30;
            const kickoffAt = kickoffInitial ? Date.now() + (kickoffSeconds * 1000) : null;
            if (kickoffInitial) {
              setTimeout(() => {
                triggerManagerReview(team.id, deps.broadcastTeamEvent).catch(err =>
                  console.error('[Teams] Initial manager review failed:', err?.message || err)
                );
              }, kickoffSeconds * 1000);
            }

            deps.broadcastTeamEvent({
              type: 'team_created',
              teamId: team.id,
              teamName: team.name,
              teamEmoji: team.emoji,
              subagentIds: team.subagentIds,
              kickoffAt,
            });

            return {
              name,
              args,
              result: JSON.stringify({
                success: true,
                action: 'create',
                team: {
                  id: team.id,
                  name: team.name,
                  description: team.description,
                  emoji: team.emoji,
                  subagentIds: team.subagentIds,
                  reviewTrigger: team.manager.reviewTrigger,
	                },
	                createdSubagents,
	                claimedSubagents,
	                kickoffScheduled: kickoffInitial,
                kickoffAfterSeconds: kickoffInitial ? kickoffSeconds : null,
                kickoffAt,
              }, null, 2),
              error: false,
            };
          }

          if (action === 'set_allowed_work_paths' || action === 'set_allowed_paths' || action === 'update_allowed_work_paths') {
            const teamId = String(args.team_id || args.teamId || '').trim();
            if (!teamId) return { name, args, result: 'team_manage(set_allowed_work_paths) requires team_id', error: true };
            const team = getManagedTeam(teamId);
            if (!team) return { name, args, result: `Team not found: ${teamId}`, error: true };
            const rawPaths = Array.isArray(args.allowed_work_paths)
              ? args.allowed_work_paths
              : Array.isArray(args.allowedWorkPaths)
                ? args.allowedWorkPaths
                : Array.isArray(args.paths)
                  ? args.paths
                  : [];
            team.allowedWorkPaths = rawPaths.map((v: any) => String(v).trim()).filter(Boolean);
            team.updatedAt = Date.now();
            saveManagedTeam(team);
            deps.broadcastTeamEvent({
              type: 'team_updated',
              teamId: team.id,
              teamName: team.name,
              allowedWorkPaths: team.allowedWorkPaths,
            });
            return {
              name,
              args,
              result: JSON.stringify({ success: true, action, team_id: team.id, allowedWorkPaths: team.allowedWorkPaths }, null, 2),
              error: false,
            };
          }

          if (action === 'get' || action === 'status' || action === 'info') {
            const teamId = String(args.team_id || args.teamId || '').trim();
            if (!teamId) return { name, args, result: `team_manage(${action}) requires team_id`, error: true };
            const team = getManagedTeam(teamId) as any;
            if (!team) return { name, args, result: `Team not found: ${teamId}`, error: true };
            const chat: any[] = Array.isArray(team.teamChat) ? team.teamChat : [];
            const managerMessages = chat.filter((m) => m?.from === 'manager').slice(-5).map((m) => ({ at: m.timestamp || m.createdAt || null, text: String(m.content || '').slice(0, 400) }));
            const room = team.roomState || {};
            const status = {
              id: team.id,
              name: team.name,
              purpose: team.purpose || team.mission || '',
              currentFocus: team.currentFocus || room.runGoal || '',
              allowedWorkPaths: Array.isArray(team.allowedWorkPaths) ? team.allowedWorkPaths : [],
              workDir: team.workDir || null,
              manager: {
                agentId: team.managerAgentId,
                sessionId: `team_coord_${team.id}`,
                paused: team.manager?.paused === true,
                model: team.manager?.model || null,
                reviewTrigger: team.manager?.reviewTrigger,
                lastReviewAt: team.manager?.lastReviewAt || null,
                inboxPending: Array.isArray(room.managerInbox) ? room.managerInbox.filter((m: any) => !m?.drainedAt).length : 0,
                messageCount: chat.filter((m) => m?.from === 'manager').length,
                recentMessages: managerMessages,
                note: 'Manager turns run in the team_coord session and are not listed by agent_run_ops; use this status for manager activity.',
              },
              members: (team.subagentIds || []).map((id: string) => {
                const st = room.memberStates?.[id] || {};
                return { id, name: String((getAgentById(id) as any)?.name || id), status: st.status || 'idle', currentTask: st.currentTask || '', blockedReason: st.blockedReason || '', lastResult: String(st.lastResult || '').slice(0, 300) };
              }),
              recentDispatches: (room.dispatches || []).slice(-10).map((d: any) => ({ id: d.id, agentId: d.agentId, status: d.status, taskId: d.taskId || null, summary: String(d.taskSummary || '').slice(0, 200) })),
              sharedArtifacts: (room.sharedArtifacts || []).slice(-20).map((a: any) => ({ name: a.name, type: a.type, path: a.path, by: a.createdBy })),
              blockers: (room.blockers || []).slice(-10),
              totalRuns: team.totalRuns || 0,
            };
            return { name, args, result: JSON.stringify({ success: true, action: 'status', team: status }, null, 2), error: false };
          }

          if (action === 'update' || action === 'edit') {
            const teamId = String(args.team_id || args.teamId || '').trim();
            if (!teamId) return { name, args, result: 'team_manage(update) requires team_id', error: true };
            const team = getManagedTeam(teamId) as any;
            if (!team) return { name, args, result: `Team not found: ${teamId}`, error: true };
            const changed: string[] = [];
            const str = (v: any, max: number) => String(v).slice(0, max);
            // Wrapper schemas make models send every field, blank: "" / [] means
            // "not provided", never "clear it". (2026-10-07: the manager's own
            // update wiped purpose, focus and allowed_work_paths this way.)
            const has = (v: any) => v != null && !(typeof v === 'string' && !v.trim());
            if (has(args.name)) { team.name = str(args.name, 80); changed.push('name'); }
            if (has(args.description)) { team.description = str(args.description, 300); changed.push('description'); }
            if (has(args.emoji)) { team.emoji = str(args.emoji, 4); changed.push('emoji'); }
            if (has(args.purpose)) {
              team.purpose = str(args.purpose, 1000); team.mission = team.purpose;
              if (team.roomState) team.roomState.purpose = team.purpose;
              changed.push('purpose');
            }
            const ctx = args.team_context ?? args.teamContext;
            if (has(ctx)) { team.teamContext = str(ctx, 1000); changed.push('team_context'); }
            team.manager = team.manager || {};
            if (has(args.manager_system_prompt)) { team.manager.systemPrompt = str(args.manager_system_prompt, 2000); changed.push('manager_system_prompt'); }
            if (has(args.manager_model)) { team.manager.model = String(args.manager_model).trim() || undefined; changed.push('manager_model'); }
            if (has(args.review_trigger)) {
              const rt = String(args.review_trigger).trim().toLowerCase();
              if (!['after_each_run', 'after_all_runs', 'daily', 'manual'].includes(rt)) {
                return { name, args, result: `Invalid review_trigger "${rt}". Use after_each_run|after_all_runs|daily|manual.`, error: true };
              }
              team.manager.reviewTrigger = rt; changed.push('review_trigger');
            }
            const paths = Array.isArray(args.allowed_work_paths) ? args.allowed_work_paths : Array.isArray(args.allowedWorkPaths) ? args.allowedWorkPaths : null;
            const cleanPaths = paths ? paths.map((v: any) => String(v).trim()).filter(Boolean) : [];
            if (cleanPaths.length) { team.allowedWorkPaths = cleanPaths; changed.push('allowed_work_paths'); }
            const rawWorkDir = args.work_dir ?? args.workDir;
            if (has(rawWorkDir)) {
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const { resolveTeamWorkDir } = require('./../../teams/team-dispatch-runtime');
              const resolvedWorkDir = resolveTeamWorkDir({ ...team, workDir: String(rawWorkDir).trim() });
              if (!resolvedWorkDir) {
                return { name, args, result: `work_dir "${String(rawWorkDir)}" must be inside the main workspace or one of the team allowed_work_paths (${(team.allowedWorkPaths || []).join(', ') || 'none set'}).`, error: true };
              }
              team.workDir = resolvedWorkDir; changed.push('work_dir');
            } else if (args.clear_work_dir === true) { delete team.workDir; changed.push('work_dir'); }
            else if (args.clear_allowed_work_paths === true) { team.allowedWorkPaths = []; changed.push('allowed_work_paths'); }
            else if (has(args.purpose) || has(args.focus ?? args.goal ?? args.current_focus)) {
              // A new goal that names its project folder sets workDir, so members run
              // from that folder instead of the team workspace.
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const { inferTeamWorkDirFromText, resolveTeamWorkDir } = require('./../../teams/team-dispatch-runtime');
              const inferred = inferTeamWorkDirFromText(`${String(args.purpose ?? '')}\n${String(args.focus ?? args.goal ?? args.current_focus ?? '')}`);
              const resolvedInferred = inferred ? resolveTeamWorkDir({ ...team, workDir: inferred }) : null;
              if (resolvedInferred && resolvedInferred !== team.workDir) { team.workDir = resolvedInferred; changed.push('work_dir'); }
            }
            const addIds: string[] = Array.isArray(args.add_subagent_ids) ? args.add_subagent_ids.map((v: any) => String(v).trim()).filter(Boolean) : [];
            const removeIds: string[] = Array.isArray(args.remove_subagent_ids) ? args.remove_subagent_ids.map((v: any) => String(v).trim()).filter(Boolean) : [];
            const unknown = addIds.filter((id) => !getAgentById(id));
            if (unknown.length) return { name, args, result: `Unknown agent id(s): ${unknown.join(', ')}. Create them first with agent_ops spawn.`, error: true };
            team.subagentIds = Array.isArray(team.subagentIds) ? team.subagentIds : [];
            for (const id of addIds) {
              if (!team.subagentIds.includes(id)) {
                team.subagentIds.push(id);
                team.roomState = team.roomState || {};
                team.roomState.memberStates = team.roomState.memberStates || {};
                team.roomState.memberStates[id] = team.roomState.memberStates[id] || { agentId: id, status: 'idle', lastUpdateAt: Date.now() };
              }
            }
            if (removeIds.length) team.subagentIds = team.subagentIds.filter((id: string) => !removeIds.includes(id));
            if (addIds.length) changed.push('add_subagent_ids');
            if (removeIds.length) changed.push('remove_subagent_ids');
            // A new goal must replace the stale run focus, otherwise the manager keeps
            // reviewing the previous (finished) objective and reports "nothing to do".
            const explicitFocus = String(args.focus ?? args.goal ?? args.current_focus ?? '').trim();
            const goalChanged = changed.includes('purpose') || changed.includes('team_context') || !!explicitFocus;
            if (goalChanged) {
              const newFocus = (explicitFocus || String(team.purpose || team.teamContext || '')).slice(0, 1000);
              team.goalSetAt = Date.now();
              team.currentFocus = newFocus;
              team.roomState = team.roomState || {};
              team.roomState.runGoal = newFocus;
              if (explicitFocus) changed.push('focus');
            }
            if (!changed.length) {
              return { name, args, result: 'team_manage(update) needs at least one field: name, description, emoji, purpose, team_context, focus/goal, manager_system_prompt, manager_model, review_trigger, allowed_work_paths, work_dir, add_subagent_ids, remove_subagent_ids.', error: true };
            }
            team.updatedAt = Date.now();
            saveManagedTeam(team);
            for (const id of addIds) {
              try { claimAgentForTeamWorkspace(team.id, id); } catch { /* identity claim is best-effort */ }
            }
            deps.broadcastTeamEvent({ type: 'team_updated', teamId: team.id, teamName: team.name, changed });
            // New goal => wake the manager so the team starts on it without a manual nudge.
            // Pass wake:false to stage a goal without starting work.
            let managerWoken = false;
            if (goalChanged && args.wake !== false && team.manager?.paused !== true) {
              try {
                const { scheduleTeamManagerAutoWake } = require('./../../teams/team-manager-autowake');
                managerWoken = scheduleTeamManagerAutoWake(
                  team.id,
                  `NEW TEAM GOAL set by main agent (previous objective is closed; do not re-review it): ${String(team.currentFocus || '').slice(0, 700)}. Plan the work and dispatch members now.`,
                ) === true;
              } catch { /* wake is best-effort */ }
            }
            return { name, args, result: JSON.stringify({ success: true, action: 'update', team_id: team.id, changed, currentFocus: team.currentFocus || '', manager_woken: managerWoken, subagentIds: team.subagentIds, allowedWorkPaths: team.allowedWorkPaths || [], workDir: team.workDir || null }, null, 2), error: false };
          }

          if (action === 'trigger_review') {
            const teamId = String(args.team_id || '').trim();
            if (!teamId) return { name, args, result: 'team_manage(trigger_review) requires team_id', error: true };
            const team = getManagedTeam(teamId);
            if (!team) return { name, args, result: `Team not found: ${teamId}`, error: true };
            deps.bindTeamNotificationTargetFromSession(teamId, sessionId, 'team_manage:trigger_review');
            if (team.manager?.paused === true) {
              return { name, args, result: `Team "${team.name}" is paused. Resume it before triggering review.`, error: true };
            }
            const result = await triggerManagerReview(teamId, deps.broadcastTeamEvent);
            return {
              name,
              args,
              result: JSON.stringify({ success: true, action: 'trigger_review', teamId, result }, null, 2),
              error: false,
            };
          }

          if (action === 'start') {
            const teamId = String(args.team_id || '').trim();
            const kickoffTaskRaw = String(args.task || '').trim().slice(0, 2000);
            const kickoffTask = (!kickoffTaskRaw || /^n\/?a$/i.test(kickoffTaskRaw)) ? 'N/A' : kickoffTaskRaw;
            if (!teamId) return { name, args, result: 'team_manage(start) requires team_id', error: true };
            const team = getManagedTeam(teamId);
            if (!team) return { name, args, result: `Team not found: ${teamId}`, error: true };
            deps.bindTeamNotificationTargetFromSession(teamId, sessionId, 'team_manage:start');
            if (team.manager?.paused === true) {
              deps.resumeManagedTeamInternal(teamId);
            }

            const chatMsg = appendTeamChat(teamId, {
              from: 'user',
              fromName: 'Team Owner',
              content: `Session started (task: ${kickoffTask})`,
            });
            deps.broadcastTeamEvent({ type: 'team_chat_message', teamId, teamName: team.name, chatMessage: chatMsg, text: chatMsg?.content || '' });

            const purpose = String(
              (team as any)?.purpose
              || team?.mission
              || team?.teamContext
              || team?.description
              || '(no purpose set)',
            ).trim();
            const startPrompt = [
              `[TEAM SESSION STARTED by team owner]`,
              ``,
              `Read the team purpose and current task, then decide which subagents should run now and with what instructions.`,
              `Do NOT launch every subagent by default. Dispatch only the right agents for this run.`,
              ``,
              `Team purpose: ${purpose}`,
              `Current task: ${kickoffTask}`,
              ``,
              `Review what has already been done (team chat + memory files), identify next steps,`,
              `and begin dispatching agents to make concrete progress.`,
              `Work autonomously - dispatch agents, review results, and continue until progress is made`,
              `or you need to ask the team owner a question.`,
            ].join('\n');

            handleManagerConversation(teamId, startPrompt, deps.broadcastTeamEvent, true).catch((err: any) =>
              console.error('[team_manage:start] Coordinator start failed:', err?.message || err)
            );

            return {
              name,
              args,
              result: JSON.stringify({ success: true, action: 'start', teamId, started: true }, null, 2),
              error: false,
            };
          }

          if (action === 'dispatch') {
            const teamId = String(args.team_id || '').trim();
            const agentId = String(args.agent_id || '').trim();
            const task = String(args.task || '').trim();
            const context = args.context ? String(args.context) : undefined;
            if (!teamId || !agentId || !task) {
              return { name, args, result: 'team_manage(dispatch) requires team_id, agent_id, and task', error: true };
            }
            const team = getManagedTeam(teamId);
            if (!team) return { name, args, result: `Team not found: ${teamId}`, error: true };
            deps.bindTeamNotificationTargetFromSession(teamId, sessionId, 'team_manage:dispatch');
            if (team.manager?.paused === true) {
              return { name, args, result: `Team "${team.name}" is paused. Resume it before dispatching tasks.`, error: true };
            }
            if (!team.subagentIds.includes(agentId)) {
              return { name, args, result: `Agent "${agentId}" is not a member of team "${team.name}"`, error: true };
            }

            const dispatchChatMsg = appendTeamChat(teamId, {
              from: 'manager',
              fromName: 'Manager',
              content: `Dispatched one-off task to ${agentId}: ${task}`,
            });
            deps.broadcastTeamEvent({
              type: 'team_chat_message',
              teamId,
              teamName: team.name,
              chatMessage: dispatchChatMsg,
              text: dispatchChatMsg?.content || '',
            });
            deps.broadcastTeamEvent({ type: 'team_dispatch', teamId, teamName: team.name, agentId, task });

            (async () => {
              try {
                const dispatchPrompt = buildTeamDispatchTaskLazy({
                  agentId,
                  task,
                  teamId,
                  context,
                });
                const startedAt = Date.now();
                const result = await deps.runTeamAgentViaChat(agentId, dispatchPrompt.effectiveTask, teamId);
                const finishedAt = Date.now();
                recordAgentRun({
                  agentId,
                  agentName: result.agentName,
                  trigger: 'team_dispatch',
                  success: result.success,
                  startedAt,
                  finishedAt,
                  durationMs: result.durationMs,
                  stepCount: result.stepCount,
                  error: result.error,
                  resultPreview: result.success ? String(result.result || '') : undefined,
                });
                const resultChatMsg = appendTeamChat(teamId, {
                  from: 'subagent',
                  fromName: result.agentName || agentId,
                  fromAgentId: agentId,
                  content: result.success
                    ? `Task complete: ${String(result.result || '')}`
                    : `Task failed: ${result.error || 'unknown error'}`,
                  metadata: {
                    agentId,
                    runSuccess: result.success,
                    taskId: result.taskId,
                    stepCount: result.stepCount,
                    durationMs: result.durationMs,
                    thinking: result.thinking,
                    processEntries: result.processEntries,
                    liveTraceEntries: result.liveTraceEntries,
                  },
                });
                deps.broadcastTeamEvent({
                  type: 'team_chat_message',
                  teamId,
                  teamName: team.name,
                  chatMessage: resultChatMsg,
                  text: resultChatMsg?.content || '',
                });
                deps.broadcastTeamEvent({
                  type: 'team_dispatch_complete',
                  teamId,
                  teamName: team.name,
                  agentId,
                  agentName: result.agentName,
                  taskId: result.taskId,
                  success: result.success,
                  durationMs: result.durationMs,
                  stepCount: result.stepCount,
                  resultPreview: String(result.result || result.error || ''),
                });
                await verifySubagentResult(
                  teamId,
                  agentId,
                  task,
                  result.success ? String(result.result || '') : `Task failed: ${result.error || 'unknown error'}`,
                  deps.broadcastTeamEvent,
                );
              } catch (err: any) {
                const failedChatMsg = appendTeamChat(teamId, {
                  from: 'subagent',
                  fromName: agentId,
                  fromAgentId: agentId,
                  content: `Dispatch failed: ${err.message}`,
                });
                deps.broadcastTeamEvent({
                  type: 'team_chat_message',
                  teamId,
                  teamName: team.name,
                  chatMessage: failedChatMsg,
                  text: failedChatMsg?.content || '',
                });
              }
            })();

            return {
              name,
              args,
              result: JSON.stringify({ success: true, action: 'dispatch', teamId, agentId, message: 'Dispatch queued' }, null, 2),
              error: false,
            };
          }

          if (action === 'pause') {
            const teamId = String(args.team_id || '').trim();
            if (!teamId) return { name, args, result: 'team_manage(pause) requires team_id', error: true };
            deps.bindTeamNotificationTargetFromSession(teamId, sessionId, 'team_manage:pause');
            const out = deps.pauseManagedTeamInternal(teamId, args.reason ? String(args.reason) : undefined);
            return { name, args, result: JSON.stringify(out, null, 2), error: out.success !== true };
          }

          if (action === 'resume') {
            const teamId = String(args.team_id || '').trim();
            if (!teamId) return { name, args, result: 'team_manage(resume) requires team_id', error: true };
            deps.bindTeamNotificationTargetFromSession(teamId, sessionId, 'team_manage:resume');
            const out = deps.resumeManagedTeamInternal(teamId);
            return { name, args, result: JSON.stringify(out, null, 2), error: out.success !== true };
          }

          // ── run_round: trigger a collaborative round (Phase B teams) ───────
          if (action === 'run_round') {
            const teamId = String(args.team_id || '').trim();
            if (!teamId) return { name, args, result: 'team_manage(run_round) requires team_id', error: true };
            const objective = String(args.objective || args.task || '').trim();
            if (!objective) return { name, args, result: 'team_manage(run_round) requires objective', error: true };
            try {
              const { runCollaborativeRound } = require('./../../teams/team-round-runner');
              const result = await runCollaborativeRound(
                teamId,
                { description: objective, agentDirectives: args.agent_directives },
                deps.broadcastWS || (() => {}),
              );
              const summary = [
                `Round ${result.roundNumber} complete (${Math.round(result.durationMs / 1000)}s)`,
                `Agents: ${result.agentResults.map((r: any) => `${r.agentName}: ${r.phase}`).join(', ')}`,
                `Manager: ${result.managerSummary.slice(0, 200)}`,
                `Continue: ${result.shouldContinue}`,
              ].join('\n');
              return { name, args, result: summary, error: false };
            } catch (err: any) {
              return { name, args, result: `run_round error: ${err.message}`, error: true };
            }
          }

          // ── run_session: run multiple collaborative rounds until done ─────
          if (action === 'run_session') {
            const teamId = String(args.team_id || '').trim();
            if (!teamId) return { name, args, result: 'team_manage(run_session) requires team_id', error: true };
            const objective = String(args.objective || args.task || '').trim();
            if (!objective) return { name, args, result: 'team_manage(run_session) requires objective', error: true };
            const maxRounds = Number(args.max_rounds) || 5;
            try {
              const { runCollaborativeSession } = require('./../../teams/team-round-runner');
              const results = await runCollaborativeSession(
                teamId, objective, deps.broadcastWS || (() => {}), maxRounds,
              );
              const summary = [
                `Collaborative session complete: ${results.length} round(s)`,
                ...results.map((r: any) => `  Round ${r.roundNumber}: ${r.managerSummary.slice(0, 100)}`),
              ].join('\n');
              return { name, args, result: summary, error: false };
            } catch (err: any) {
              return { name, args, result: `run_session error: ${err.message}`, error: true };
            }
          }

          return { name, args, result: `Unsupported team_manage action: ${action}. Supported: list, status, create, update, set_allowed_work_paths, start, trigger_review, dispatch, pause, resume, run_round, run_session, delete.`, error: true };
        } catch (err: any) {
          return { name, args, result: `team_manage error: ${err.message}`, error: true };
        }
      }
 }
 throw new Error(`Unsupported agents tool: ${name}`);
}
