import os from 'os';
import path from 'path';
import { resolveGatewayRestartScope } from '../../../runtime/supervisor-restart-request';
import { lockFreeGitReadOptions } from '../../../runtime/git-read';
import { getConfig, getAgentById } from '../../../config/config';
import { mainChatRoutePatch } from '../../../config/main-chat-route.js';
import { parseProviderModelRef } from '../../../agents/model-routing.js';
import { resetProvider } from '../../../providers/factory.js';
import { handleRequestToolCategory } from '../../tool-category-request';
import { appendAuditEntry } from '../../audit-log';
import { getMCPManager } from '../../mcp-manager';
import { executePromRepoSyncTool } from '../../prom-repo-sync';
import { SubagentManager, validateDirectSubagentAssignment } from '.././subagent-manager';
import { listManagedTeams, getManagedTeam, appendTeamRoomMessage, updateTeamMemberState, upsertTeamPlanItem, shareTeamArtifact } from '../../teams/managed-teams';
import { scheduleTeamMemberAutoWake } from '../../teams/team-member-room';
import { routeTeamEvent } from '../../teams/team-event-router';
import { getSessionChannelHint } from '../../comms/broadcaster';
import { addMessage, flushSession, getChatModelRoute, setChatModelRoute } from '../../session';
import { buildConnectorStatus } from '../../tool-builder';
import { readRawToolResultRange } from '../../tool-result-envelope';
import { ensurePrometheusExtensionRuntimeLoaded } from '../../../extensions/extension-bootstrap';
import { getExtensionRuntimeRegistry } from '../../../extensions/runtime-registry';
import { appendJournal, createTask, listTaskSummaries, saveTask, setTaskStepRunning, updateTaskStatus } from '../../tasks/task-store';
import { bindTaskRunToSession } from '../../tasks/task-run-mirror';
import { getApprovalQueue, serializeApprovalForClient } from '../../verification-flow.js';
import { createPrometheusQuestionPayload, getPrometheusQuestionQueue, serializePrometheusQuestionForClient, type PrometheusQuestionAnswer } from '../../prometheus-questions.js';
import { createDevSourceEditApprovalScope, shouldAutoApproveScopedDevSourceEdit, type DevSourceEditScope, getDevSourceEditContinuation, isCompletedDevSourceEditApply, grantDevSourceEditApproval, getLatestPendingDevSourceEditContinuation, getDevSourceEditGrant, markDevSourceEditContinuationComplete, upsertDevSourceEditContinuation } from '../../dev-source-approvals.js';
import { getCoordinatedDevEdit, listCoordinatedDevEditPeers, beginCoordinatedDevApplyBatch, markCoordinatedDevApplyBatch, recordCoordinatedDevEditVerification, requestCoordinatedDevEditApply, setCoordinatedDevApplyBatchApproval, waitForCoordinatedDevEditFiles } from '../../dev-edit-coordinator.js';
import { formatDevVerificationSummary, resolveDevVerificationPlan, runDevVerificationPlan } from '../../dev-verification.js';
import { createFinalActionApprovalScope, grantFinalActionApproval } from '../../final-action-approvals.js';
import { claimBrainDreamProposalSlot, releaseBrainDreamProposalSlot } from '../../brain/brain-proposal-policy.js';
import { inferAgentIdFromSession, inferApprovalOrigin, inferTeamNoteContext, appendAndBroadcastTeamChat, getTeamChatTargetMetadata, resolveTeammateReference, normalizeShareArtifactArgs, routeMemberProposalToManager, isProposalExecutionSession, resolveTaskForSession, maybeStartTeamStatusTaskMirror, getPromApplySurfacesForFiles, formatPromApplyDevChangesInstruction, executeTool } from '../subagent-executor';
import type { createWorkspaceHelpers } from '../workspace-helpers';
export interface DefaultToolContext extends ReturnType<typeof createWorkspaceHelpers> {
 name: string;
 args: Parameters<typeof import('../subagent-executor').executeTool>[1];
 workspacePath: string;
 deps: import('../subagent-executor').ExecuteToolDeps;
 sessionId: string;
 __dirname: string;
 isGoalAutonomousApprovalBypass: boolean;
}
export async function handleDefaultTool(ctx: DefaultToolContext): Promise<Awaited<ReturnType<typeof import('../subagent-executor').executeTool>>> {
 const { name, args, workspacePath, deps, sessionId, __dirname, resolveProposalExecutionTask, isDevSourceWriteApprovedSession, isGoalAutonomousApprovalBypass, ...workspaceHelpers } = ctx;
 {
        // Handle mcp__serverId__toolName calls
        if (name.startsWith('mcp__')) {
          const parts = name.split('__');
          if (parts.length >= 3) {
            const serverId = parts[1];
            const toolName = parts.slice(2).join('__');
            try {
              const mcpResult = await getMCPManager().callTool(serverId, toolName, args ?? {});
              const text = mcpResult.content
                .map((c: any) => c.text || c.data || '')
                .join('\n')
                .trim();
              return { name, args, result: text || '(empty result)', error: !!mcpResult.isError };
            } catch (mcpErr: any) {
              return { name, args, result: `MCP error (${serverId}/${toolName}): ${mcpErr.message}`, error: true };
            }
          }
        }

        // â”€â”€ Piece 5: dispatch_to_agent â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        if (name === 'dispatch_to_agent') {
          const agentId = String(args.agent_id || '').trim();
          const agentMessage = String(args.message || args.task || args.task_prompt || args.taskPrompt || '').trim();
          const agentContext = args.context ? String(args.context) : undefined;

          if (!agentId) return { name, args, result: 'dispatch_to_agent requires agent_id', error: true };
          if (!agentMessage) return { name, args, result: 'dispatch_to_agent requires message (aliases: task, task_prompt)', error: true };

          try {
            const dispatchResult = await deps.dispatchToAgent(agentId, agentMessage, agentContext, sessionId);
            return { name, args, result: JSON.stringify(dispatchResult), error: false };
          } catch (err: any) {
            return { name, args, result: `dispatch_to_agent error: ${err.message}`, error: true };
          }
        }

        // ── run_task_now ──────────────────────────────────────
        if (name === 'message_subagent') {
          const agentId = String(args.agent_id || '').trim();
          const assignment = String(args.assignment || args.message || '').trim();
          const context = args.context ? String(args.context).trim() : '';

          if (!agentId) return { name, args, result: 'message_subagent requires agent_id', error: true };
          const assignmentValidation = validateDirectSubagentAssignment(assignment);
          if (!assignmentValidation.ok) {
            return { name, args, result: JSON.stringify(assignmentValidation, null, 2), error: true };
          }

          const agent = getAgentById(agentId) as any;
          if (!agent) return { name, args, result: `Unknown subagent: ${agentId}. Call agent_list first.`, error: true };
          if (agent.default === true || agentId === 'main') {
            return { name, args, result: 'message_subagent is for standalone subagents, not the main/default agent.', error: true };
          }

          const team = listManagedTeams().find((t: any) => Array.isArray(t.subagentIds) && t.subagentIds.includes(agentId));
          if (team) {
            return {
              name,
              args,
              result: `Agent "${agentId}" belongs to team "${team.name}" (${team.id}). Use team messaging/dispatch tools for team agents; message_subagent is only for standalone one-off subagents.`,
              error: true,
            };
          }

          const activeRun = listTaskSummaries({ status: ['queued', 'running', 'paused', 'stalled', 'needs_assistance', 'awaiting_user_input'] })
            .filter((task: any) => String(task?.subagentProfile || '') === agentId)
            .sort((a: any, b: any) => Number(b.lastProgressAt || 0) - Number(a.lastProgressAt || 0))[0];
          if (activeRun && args?.force_new_task !== true && args?.forceNewTask !== true) {
            return {
              name,
              args,
              result: JSON.stringify({
                success: false,
                code: 'active_run_exists',
                agent_id: agentId,
                task_id: activeRun.id,
                status: activeRun.status,
                message: `This agent already has an active run. Use agent_run_ops(action="steer", task_id="${activeRun.id}", message=...) to join it. Set force_new_task=true only when the user explicitly requested separate parallel work.`,
              }, null, 2),
              error: true,
            };
          }

          try {
            const workspacePath = getConfig().getConfig().workspace?.path || process.cwd();
            const subagentMgr = new SubagentManager(workspacePath, deps.broadcastWS, deps.handleChat, deps.telegramChannel);
            const result = await subagentMgr.callSubagent(
              {
                subagent_id: agentId,
                task_prompt: assignment,
                context_data: {
                  delegation: { source: 'main_chat', task_already_created: true, delivery_mode: 'task_panel_only' },
                  ...(context ? { main_chat_context: context } : {}),
                },
                run_now: true,
                delivery_mode: 'task_panel_only',
              },
              sessionId
            );
            return {
              name,
              args,
              result: JSON.stringify({
                success: true,
                agent_id: result.subagent_id,
                task_id: result.task_id,
                status: result.status,
                response:
                  `One background task was delegated to subagent "${agentId}". ` +
                  `The working conversation and final result will stay in the subagent task panel, so main chat can continue uninterrupted.`,
              }, null, 2),
              error: false,
            };
          } catch (err: any) {
            return { name, args, result: `message_subagent error: ${err.message}`, error: true };
          }
        }

        if (name === 'run_task_now') {
          const title = String(args.title || '').trim();
          const prompt = String(args.prompt || '').trim();
          if (!title) return { name, args, result: 'run_task_now requires title', error: true };
          if (!prompt) return { name, args, result: 'run_task_now requires prompt', error: true };

          const subagentId = args.subagent_id ? String(args.subagent_id).trim() : undefined;

          try {
            const existingBinding = resolveTaskForSession(sessionId);
            if (existingBinding?.status === 'running' || existingBinding?.status === 'queued') {
              return {
                name,
                args,
                result: JSON.stringify({
                  task_id: existingBinding.id,
                  status: existingBinding.status,
                  message: `This chat turn is already tracking task "${existingBinding.title}" (${existingBinding.id}). Continue executing the current tracked work here.`,
                }),
                error: false,
              };
            }

            const task = createTask({
              title,
              prompt,
              sessionId,
              channel: String(sessionId || '').startsWith('telegram_') ? 'telegram' : 'web',
              taskKind: 'run_once',
              originatingSessionId: sessionId,
              subagentProfile: subagentId,
              plan: [{
                index: 0,
                description: prompt.slice(0, 160) || title,
                status: 'pending',
              }],
            });
            updateTaskStatus(task.id, 'running');
            setTaskStepRunning(task.id, 0);
            appendJournal(task.id, {
              type: 'status_push',
              content: `Live tracked task started from chat: ${title}`,
            });
            bindTaskRunToSession(sessionId, {
              taskId: task.id,
              source: 'run_task_now',
              agentId: subagentId,
            });
            try {
              deps.broadcastWS({ type: 'task_running', taskId: task.id, title, source: 'run_task_now', sessionId });
              deps.broadcastWS({ type: 'task_panel_update', taskId: task.id });
            } catch {}
            try {
              deps.sendSSE?.('info', { message: `Task card "${title}" started. Continuing this work live in chat.` });
            } catch {}
            return {
              name,
              args,
              result: JSON.stringify({
                task_id: task.id,
                status: 'running',
                message:
                  `Task card "${title}" started (${task.id}) and is now tracking this live chat turn. ` +
                  `Do not wait for a background runner. Continue executing the prompt now in this same conversation, using tools as needed. ` +
                  `Task prompt: ${prompt}`,
              }),
              error: false,
            };
          } catch (err: any) {
            return { name, args, result: `run_task_now error: ${err?.message || err}`, error: true };
          }
        }

        // ── write_proposal ──────────────────────────────────────
	        if (name === 'write_proposal') {
	          const proposalTask = resolveProposalExecutionTask();
	          const buildFailure = proposalTask?.proposalExecution?.buildFailure;
	          const allowRepairProposal = !!(
	            buildFailure
	            && buildFailure.status !== 'resolved'
	            && buildFailure.allowWriteProposal
	            && !buildFailure.repairProposalId
	          );
	          if (isProposalExecutionSession(sessionId) && !allowRepairProposal) {
	            const repairMessage = buildFailure?.repairProposalId
	              ? `Repair proposal ${buildFailure.repairProposalId} is already queued for review.`
	              : buildFailure?.status === 'resolved'
	                ? 'The previous build failure was already repaired and handed back; continue the approved task instead of creating another repair proposal.'
	              : 'Execute the approved edits directly and complete the task; do not create a new proposal from inside proposal execution.';
	            return {
	              name,
	              args,
	              result: `BLOCKED: write_proposal is disabled during approved proposal execution. ${repairMessage}`,
	              error: true,
	            };
	          }
          // Gate: team subagents cannot propose directly — must use talk_to_manager.
          // The manager owns proposal submission so team artifacts, proposal caps, and approval state stay coherent.
          const teamNoteForProposal = inferTeamNoteContext(sessionId);
          const isTeamSession = String(sessionId || '').startsWith('team_dispatch_') || teamNoteForProposal?.authorType === 'subagent';
          if (isTeamSession && teamNoteForProposal?.teamId) {
            // Route the member's proposal to the manager as a structured, ready-to-submit
            // request instead of dead-ending. The manager owns submission (caps,
            // approval state, executor assignment), so this keeps the invariant while
            // giving the member a working path.
            const routed = routeMemberProposalToManager(deps, teamNoteForProposal.teamId, teamNoteForProposal.authorId, args);
            return { name, args, result: routed.message, error: !routed.ok };
          }
          if (isTeamSession) {
            return {
              name, args,
              result: 'BLOCKED: Team subagents cannot submit proposals directly. Send the proposal-ready request to the manager instead. For task_trigger/action proposals, include: title, summary, the exact approved action, execution_steps, expected identifiers/artifacts, and any relevant resource paths. For src/code proposals only, include the full implementation plan, affected files, execution_steps, diff preview, executor_prompt, evidence/artifact paths, and risk notes. The manager will review and submit the proposal.',
              error: true,
            };
          }
		          const brainProposalSlot = claimBrainDreamProposalSlot(sessionId);
		          if (brainProposalSlot.isBrainDream && !brainProposalSlot.allowed) {
		            return {
		              name,
		              args,
		              result: `BRAIN DREAM PROPOSAL BUDGET REACHED: this nightly Dream may create at most ${brainProposalSlot.limit} lightweight plan proposals. Record this idea under Deferred Ideas instead of creating another proposal.`,
		              error: true,
		            };
		          }
		          try {
		            const { createProposal, actionProposalPlanError } = require('../../proposals/proposal-store');
                let teamExecution: any = undefined;
                let sourceTeamId: string | undefined = undefined;
                if (teamNoteForProposal?.authorType === 'manager') {
                  const teamId = String(teamNoteForProposal.teamId || '').trim();
                  let executorAgentId = String(args.executor_agent_id || '').trim();
                  try {
                    const { getManagedTeam } = require('../../teams/managed-teams');
                    const { getAgentById } = require('../../../config/config');
                    const team = getManagedTeam(teamId);
                    if (!team) {
                      return { name, args, result: `write_proposal error: team not found: ${teamId}`, error: true };
                    }
                    // Teams v7: the manager stalled on "which executor is authorized?".
                    // The proposal is approval-gated either way, so default to a team member
                    // (the original proposer when forwarded, else the first member).
                    if (!executorAgentId && Array.isArray(team.subagentIds) && team.subagentIds.length) {
                      executorAgentId = String(team.subagentIds[0]);
                      args.executor_agent_id = executorAgentId;
                    }
                    if (!executorAgentId) {
                      return {
                        name,
                        args,
                        result: 'BLOCKED: Team manager proposals must assign executor_agent_id to a subagent on this team.',
                        error: true,
                      };
                    }
                    if (!Array.isArray(team.subagentIds) || !team.subagentIds.includes(executorAgentId)) {
                      return {
                        name,
                        args,
                        result: `BLOCKED: executor_agent_id "${executorAgentId}" is not a member of team "${team.name || teamId}".`,
                        error: true,
                      };
                    }
                    // Teams v7: a post-completion manager wake re-submitted the same
                    // proposal (two pending copies). Same team + same title since the
                    // current goal was set returns the existing proposal instead.
                    try {
                      const { listProposals } = require('../../proposals/proposal-store');
                      const wantTitle = String(args.title || '').trim().slice(0, 120).toLowerCase();
                      const since = Number((team as any).goalSetAt || 0);
                      const dup = wantTitle
                        ? (listProposals(['pending', 'approved', 'executing']) as any[]).find((p: any) =>
                          (p.sourceTeamId === teamId || p.teamExecution?.teamId === teamId)
                          && String(p.title || '').trim().toLowerCase() === wantTitle
                          && Number(p.createdAt || 0) >= since)
                        : undefined;
                      if (dup) {
                        return {
                          name,
                          args,
                          result: `Proposal already submitted for this goal: ${dup.id} ("${dup.title}", ${dup.status}). Not creating a duplicate.`,
                          error: false,
                        };
                      }
                    } catch { /* dedupe is best-effort */ }
                    const executorAgent = getAgentById(executorAgentId);
                    sourceTeamId = teamId;
                    teamExecution = {
                      teamId,
                      managerSessionId: String(sessionId || ''),
                      executorAgentId,
                      executorAgentName: String(executorAgent?.name || executorAgentId),
                      returnTarget: 'team_chat',
                      originatingSessionId: String((team as any)?.originatingSessionId || ''),
                      notifyMainAgentOnError: true,
                    };
                  } catch (teamErr: any) {
                    return { name, args, result: `write_proposal team validation error: ${teamErr?.message || teamErr}`, error: true };
                  }
                }
		            const currentProposalId = String(proposalTask?.proposalExecution?.proposalId || '')
	              || (String(proposalTask?.sessionId || '').startsWith('proposal_')
	                ? String(proposalTask?.sessionId || '').replace(/^proposal_/, '')
	                : '');
	            const repairContext = allowRepairProposal
	              ? {
	                  repairOnly: true,
	                  rootProposalId: String(
	                    proposalTask?.proposalExecution?.repairContext?.rootProposalId
	                    || currentProposalId
	                    || '',
	                  ).trim() || undefined,
	                  rootTaskId: String(
	                    proposalTask?.proposalExecution?.repairContext?.rootTaskId
	                    || proposalTask?.id
	                    || '',
	                  ).trim() || undefined,
	                  parentProposalId: currentProposalId || undefined,
	                  parentTaskId: proposalTask?.id,
	                  resumeOriginalTaskId: String(
	                    proposalTask?.proposalExecution?.repairContext?.resumeOriginalTaskId
	                    || proposalTask?.id
	                    || '',
	                  ).trim() || undefined,
	                  failedAtStepIndex: Number.isFinite(Number(buildFailure?.blockedAtStepIndex))
	                    ? Number(buildFailure?.blockedAtStepIndex)
	                    : proposalTask?.currentStepIndex,
	                  failedStepDescription: String(
	                    buildFailure?.blockedStepDescription
	                    || proposalTask?.plan?.[proposalTask?.currentStepIndex || 0]?.description
	                    || '',
	                  ).trim() || undefined,
	                  failedWorkspaceRoot: String(
	                    proposalTask?.proposalExecution?.projectRoot
	                    || proposalTask?.agentWorkspace
	                    || '',
	                  ).trim() || undefined,
	                  canonicalBuildCommand: String(
	                    buildFailure?.command
	                    || proposalTask?.proposalExecution?.repairContext?.canonicalBuildCommand
	                    || 'npm run build',
	                  ).trim() || 'npm run build',
	                  capturedFailureCommand: String(
	                    proposalTask?.proposalExecution?.repairContext?.capturedFailureCommand
	                    || buildFailure?.command
	                    || '',
	                  ).trim() || undefined,
	                  repairDepth: Math.max(1, Number(proposalTask?.proposalExecution?.repairContext?.repairDepth || 0) + 1),
	                }
	              : undefined;
	            const planError = actionProposalPlanError({
              executionMode: String(args.execution_mode || args.executionMode || '').trim()
                || ((Array.isArray(args.affected_files) && (args.affected_files as Array<{ path?: unknown }>).some((f) => /^(\.\/)?(src|web-ui)\//.test(String(f?.path || '').replace(/\\/g, '/')))) ? 'code_change' : ''),
              executionSteps: args.execution_steps,
              repair: allowRepairProposal,
            });
            if (planError) {
              return { name, args, result: `write_proposal error: ${planError}`, error: true };
            }
            const proposal = createProposal({
	              type: args.type || 'general',
                executionMode: ['code_change', 'action', 'general', 'review'].includes(String(args.execution_mode || args.executionMode || '').trim())
                  ? (String(args.execution_mode || args.executionMode).trim() === 'review' ? 'general' : String(args.execution_mode || args.executionMode).trim()) as any
                  // Omitted lane + src/ or web-ui/ targets: code_change is the only lane
                  // the validator accepts, so infer it instead of rejecting the call.
                  : (Array.isArray(args.affected_files) && args.affected_files.some((f: any) => /^(\.\/)?(src|web-ui)\//.test(String(f?.path || '').replace(/\\/g, '/')))
                    ? 'code_change'
                    : undefined),
	              priority: args.priority || 'medium',
              title: String(args.title || '').slice(0, 120),
              summary: String(args.summary || '').slice(0, 500),
	              details: String(args.details || ''),
	              sourceAgentId: sessionId || 'unknown',
	              sourceSessionId: String(sessionId || '') || undefined,
                sourceTeamId,
		              sourcePipeline: args.source_pipeline || (allowRepairProposal ? 'proposal_build_failure_recovery' : undefined),
              affectedFiles: Array.isArray(args.affected_files) ? args.affected_files : [],
              executionSteps: Array.isArray(args.execution_steps) ? args.execution_steps : undefined,
              diffPreview: args.diff_preview,
              estimatedImpact: args.estimated_impact,
              requiresBuild: args.requires_build === true,
              executorAgentId: args.executor_agent_id,
              executorPrompt: args.executor_prompt,
	              riskTier: args.risk_tier === 'low' || args.risk_tier === 'high' ? args.risk_tier : undefined,
		              executorProviderId: args.executor_provider_id,
		              executorModel: args.executor_model,
                  teamExecution,
		              repairContext,
		            });
            // Broadcast to UI
            try {
              const { broadcastWS } = require('../../comms/broadcaster');
              broadcastWS({ type: 'proposal_created', proposalId: proposal.id, title: proposal.title, priority: proposal.priority, summary: proposal.summary, sessionId: proposal.sourceSessionId });
            } catch { /* non-fatal */ }
            // Send proposal notification to Telegram (if enabled)
	            try {
	              if (deps.telegramChannel && typeof deps.telegramChannel.sendProposalToAllowed === 'function') {
	                deps.telegramChannel.sendProposalToAllowed(proposal).catch(() => {});
	              }
	            } catch { /* non-fatal */ }
	            const existingBuildFailure = proposalTask?.proposalExecution?.buildFailure;
	            if (allowRepairProposal && proposalTask && existingBuildFailure) {
	              proposalTask.proposalExecution = {
	                ...(proposalTask.proposalExecution || {}),
	                buildFailure: {
	                  ...existingBuildFailure,
	                  status: 'blocked',
	                  repairProposalId: proposal.id,
	                  allowWriteProposal: false,
	                },
	              };
	              saveTask(proposalTask);
	              appendJournal(proposalTask.id, {
	                type: 'write_note',
	                content: `[build_failure] Manual repair proposal ${proposal.id} created after build failure.`,
	              });
	              try {
	                deps.broadcastWS({ type: 'task_panel_update', taskId: proposalTask.id });
	              } catch {}
	            }
	            return {
              name, args,
              result: `Proposal created: ${proposal.id}\nTitle: ${proposal.title}\nStatus: pending human approval\nView in Prometheus → Proposals panel.`,
              error: false,
            };
	          } catch (err: any) {
	            if (brainProposalSlot.isBrainDream) releaseBrainDreamProposalSlot(sessionId);
	            return { name, args, result: `write_proposal error: ${err.message}`, error: true };
	          }
        }

        // ── update_heartbeat ──────────────────────────────────────
	        // Lets agents/managers modify their own (or another agent's) heartbeat
	        // config and HEARTBEAT.md at runtime without a human touching the UI.
	        if (name === 'update_heartbeat') {
	          const targetAgentId = String(args.agent_id || 'main').trim();
	          const partial: Record<string, any> = {};
          if (typeof args.enabled === 'boolean') partial.enabled = args.enabled;
          const rawInterval = Number(args.interval_minutes);
          if (Number.isFinite(rawInterval) && rawInterval > 0) {
            partial.intervalMinutes = Math.max(1, Math.min(1440, Math.floor(rawInterval)));
          }
          if (typeof args.model === 'string') partial.model = args.model.trim();
          if (typeof args.instructions === 'string') partial.instructions = args.instructions;

          try {
            // Call the per-agent heartbeat API so config, timer, and
            // HEARTBEAT.md updates are applied through the same path as the UI.
            // (avoids a direct coupling to heartbeatRunner singleton here)
            const runtimeCfg: any = getConfig().getConfig();
            const gatewayPort = Number(runtimeCfg?.gateway?.port) || (process.env.GATEWAY_PORT ? Number(process.env.GATEWAY_PORT) : 18789);
            const configuredHost = String(runtimeCfg?.gateway?.host || process.env.GATEWAY_HOST || '127.0.0.1').trim();
            // Self-calls must use a loopback host when server is bound to wildcard interfaces.
            const gatewayHost = (configuredHost === '0.0.0.0' || configuredHost === '::') ? '127.0.0.1' : configuredHost;
            const apiUrl = `http://${gatewayHost}:${gatewayPort}/api/heartbeat/agents/${encodeURIComponent(targetAgentId)}`;
            const resp = await fetch(apiUrl, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(partial),
            });
            const data = await resp.json() as any;
            if (!data?.success) throw new Error(data?.error || 'Failed to update heartbeat config');

            let resultMsg = `Heartbeat config updated for "${targetAgentId}": ${JSON.stringify(data.config)}`;
            if (data.path) resultMsg += `\nHEARTBEAT.md updated at ${data.path}`;

            return { name, args, result: resultMsg, error: false };
          } catch (err: any) {
            return { name, args, result: `update_heartbeat error: ${err.message}`, error: true };
          }
        }

        // ── mcp_server_manage ─────────────────────────────────────
        // Full lifecycle management for MCP servers.
        // Returns ALL saved servers (connected or not) with live status.
        // Actions: list, status, connect, disconnect, delete, upsert, import,
        //          list_tools, start_enabled
        if (name === 'mcp_server_manage') {
          try {
            const mcpMgr = getMCPManager();
            const action = String(args.action || 'list').trim().toLowerCase();
            const port = process.env.PORT || 3333;
            const baseUrl = `http://localhost:${port}`;

            // ── list / status ────────────────────────────────────────
            // Returns all saved server configs + their live connection status.
            // Servers that are saved but not currently connected show as
            // status:"disconnected" — the AI can see them all.
            if (action === 'list' || action === 'status') {
              const allStatuses = mcpMgr.getStatus();
              const configs = mcpMgr.getConfigs();
              // Merge full config info with live status
              const servers = allStatuses.map(s => {
                const cfg = configs.find(c => c.id === s.id);
                return {
                  id: s.id,
                  name: s.name,
                  enabled: s.enabled,
                  transport: cfg?.transport || 'unknown',
                  url: cfg?.url,
                  command: cfg?.command,
                  status: s.status,
                  tools: s.tools,
                  toolNames: s.toolNames || [],
                  error: s.error,
                  description: cfg?.description,
                };
              });
              const connected = servers.filter(s => s.status === 'connected').length;
              const disconnected = servers.filter(s => s.status === 'disconnected' || s.status === 'error').length;
              const lines = [
                `MCP Servers: ${servers.length} total | ${connected} connected | ${disconnected} not connected`,
                '',
                ...servers.map(s => {
                  const statusIcon = s.status === 'connected' ? '✅' : s.status === 'error' ? '❌' : '⚪';
                  const toolStr = s.tools > 0 ? ` [${s.tools} tools: ${s.toolNames.slice(0, 5).join(', ')}${s.tools > 5 ? '...' : ''}]` : ' [no tools]';
                  const errorStr = s.error ? ` — Error: ${s.error}` : '';
                  const endpointStr = s.url ? ` (${s.url})` : s.command ? ` (${s.command})` : '';
                  return `${statusIcon} ${s.id} (${s.name})${endpointStr} — ${s.status}${toolStr}${errorStr}`;
                }),
              ];
              return { name, args, result: lines.join('\n'), error: false };
            }

            // ── connect ──────────────────────────────────────────────
            // Reinitializes a saved server. Works for disconnected/error servers.
            if (action === 'connect') {
              const id = String(args.id || '').trim();
              if (!id) return { name, args, result: 'connect requires id', error: true };
              const configs = mcpMgr.getConfigs();
              const cfg = configs.find(c => c.id === id);
              if (!cfg) return { name, args, result: `No saved config for server "${id}". Use mcp_server_manage(action:"list") to see available servers.`, error: true };
              const result = await mcpMgr.connect(id);
              if (result.success) {
                const toolNames = (result.tools || []).map((t: any) => t.name);
                return {
                  name, args,
                  result: `✅ Connected to "${id}" — ${toolNames.length} tool(s) available: ${toolNames.join(', ') || '(none)'}`,
                  error: false,
                };
              } else {
                return { name, args, result: `❌ Failed to connect "${id}": ${result.error}`, error: true };
              }
            }

            // ── disconnect ───────────────────────────────────────────
            if (action === 'disconnect') {
              const id = String(args.id || '').trim();
              if (!id) return { name, args, result: 'disconnect requires id', error: true };
              await mcpMgr.disconnect(id);
              return { name, args, result: `Disconnected "${id}"`, error: false };
            }

            // ── list_tools ───────────────────────────────────────────
            // Show tools for a specific connected server, or all connected servers.
            if (action === 'list_tools') {
              const id = String(args.id || '').trim();
              if (id) {
                const statuses = mcpMgr.getStatus();
                const s = statuses.find(st => st.id === id);
                if (!s) return { name, args, result: `Server "${id}" not found`, error: true };
                if (s.status !== 'connected') return { name, args, result: `Server "${id}" is ${s.status} — connect it first`, error: true };
                return { name, args, result: `Tools for "${id}" (${s.tools}):\n${(s.toolNames || []).join('\n')}`, error: false };
              }
              const allTools = mcpMgr.getAllTools();
              if (!allTools.length) return { name, args, result: 'No MCP tools available — no servers connected.', error: false };
              const lines = allTools.map((t: any) => `mcp__${t.serverId}__${t.name}: ${t.description || '(no description)'}`);
              return { name, args, result: `All MCP tools (${allTools.length}):\n${lines.join('\n')}`, error: false };
            }

            // ── delete ───────────────────────────────────────────────
            if (action === 'delete') {
              const id = String(args.id || '').trim();
              if (!id) return { name, args, result: 'delete requires id', error: true };
              if (!args.confirm) return { name, args, result: `Set confirm:true to delete server "${id}"`, error: true };
              const ok = mcpMgr.deleteConfig(id);
              return { name, args, result: ok ? `Deleted server config "${id}"` : `Server "${id}" not found`, error: !ok };
            }

            // ── upsert ───────────────────────────────────────────────
            // Save or update a server config. Pass connect:true to connect immediately.
            if (action === 'upsert') {
              const id = String(args.id || args.config?.id || '').trim();
              if (!id) return { name, args, result: 'upsert requires id', error: true };
              const cfg = args.config || {
                id,
                name: args.name || id,
                enabled: args.enabled !== false,
                transport: args.transport || args.type || 'stdio',
                command: args.command,
                args: args.args,
                env: args.env,
                url: args.url,
                headers: args.headers,
                description: args.description,
              };
              mcpMgr.upsertConfig(cfg);
              let msg = `Saved MCP server config "${id}"`;
              if (args.connect) {
                const r = await mcpMgr.connect(id);
                msg += r.success
                  ? ` and connected (${(r.tools || []).length} tools)`
                  : ` but connection failed: ${r.error}`;
              }
              return { name, args, result: msg, error: false };
            }

            // ── import ───────────────────────────────────────────────
            // Import servers from a JSON object or string ({mcpServers:{...}} format).
            if (action === 'import') {
              const raw = args.json;
              if (!raw) return { name, args, result: 'import requires json', error: true };
              const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
              const servers = parsed?.mcpServers || parsed;
              if (typeof servers !== 'object' || Array.isArray(servers)) {
                return { name, args, result: 'import: expected {mcpServers:{...}} or object of server configs', error: true };
              }
              const imported: string[] = [];
              for (const [id, cfg] of Object.entries(servers)) {
                try {
                  mcpMgr.upsertConfig({ id, ...(cfg as any) });
                  imported.push(id);
                } catch (e: any) { /* skip invalid */ }
              }
              if (args.connect) {
                await mcpMgr.startEnabledServers();
              }
              return { name, args, result: `Imported ${imported.length} server(s): ${imported.join(', ')}`, error: false };
            }

            // ── start_enabled ─────────────────────────────────────────
            // Connect all enabled servers that aren't already connected.
            if (action === 'start_enabled') {
              await mcpMgr.startEnabledServers();
              const statuses = mcpMgr.getStatus();
              const connected = statuses.filter(s => s.status === 'connected');
              return {
                name, args,
                result: `start_enabled complete — ${connected.length}/${statuses.length} servers now connected:\n` +
                  connected.map(s => `  ✅ ${s.id}: ${s.tools} tools`).join('\n'),
                error: false,
              };
            }

            return { name, args, result: `Unknown mcp_server_manage action: "${action}". Valid: list, status, connect, disconnect, delete, upsert, import, list_tools, start_enabled`, error: true };
          } catch (err: any) {
            return { name, args, result: `mcp_server_manage error: ${err.message}`, error: true };
          }
        }

        // ── Team collaboration tools ────────────────────────────────────
        if (name === 'talk_to_teammate') {
          try {
            const rawTargetAgentId = String(args?.agent_id || args?.teammate_id || '').trim();
            const message = String(args?.message || '').trim();
            const messageTypeRaw = String(args?.type || 'chat').trim().toLowerCase();
            const messageType = ['chat', 'feedback', 'blocker', 'plan', 'result'].includes(messageTypeRaw)
              ? messageTypeRaw as 'chat' | 'feedback' | 'blocker' | 'plan' | 'result'
              : 'chat';
            const noteContext = inferTeamNoteContext(sessionId);
            if (noteContext?.authorType === 'manager' && rawTargetAgentId && message) {
              // Manager -> member direct message (previously a hard error, so the
              // manager could only reach members via a full dispatch).
              const mgrTeam = getManagedTeam(noteContext.teamId);
              if (!mgrTeam) return { name, args, result: `ERROR: Team not found: ${noteContext.teamId}`, error: true };
              const target = resolveTeammateReference(mgrTeam, rawTargetAgentId);
              if (!target.ok) return { name, args, result: `ERROR: ${target.error}`, error: true };
              if (target.agentId === 'manager') return { name, args, result: 'ERROR: the manager cannot message itself.', error: true };
              const { queueAgentMessage } = require('../../teams/managed-teams');
              const recipients = target.agentId === 'all' ? mgrTeam.subagentIds : [target.agentId];
              for (const id of recipients) {
                queueAgentMessage(noteContext.teamId, id, `[From Manager] ${message}`);
                scheduleTeamMemberAutoWake(noteContext.teamId, id, { reason: 'The manager sent you a message.', source: 'teammate_message' });
              }
              return { name, args, result: `Message queued for ${recipients.join(', ')}; they will be woken to respond.`, error: false };
            }
            if (!noteContext || noteContext.authorType !== 'subagent') {
              return { name, args, result: 'ERROR: talk_to_teammate only works inside a team session (member or manager).', error: true };
            }
            if (!rawTargetAgentId || !message) {
              return { name, args, result: 'ERROR: talk_to_teammate requires agent_id (teammate id or display name) and message.', error: true };
            }
            const team = getManagedTeam(noteContext.teamId);
            if (!team) return { name, args, result: `ERROR: Team not found: ${noteContext.teamId}`, error: true };
            const resolvedTarget = resolveTeammateReference(team, rawTargetAgentId);
            if (!resolvedTarget.ok) return { name, args, result: `ERROR: ${resolvedTarget.error}`, error: true };
            const targetAgentId = resolvedTarget.agentId;
            const fromAgentId = noteContext.authorId;
            const fromAgent = getAgentById(fromAgentId) as any;
            const fromName = String(fromAgent?.name || fromAgentId).trim();
            const { queueAgentMessage, queueManagerMessage } = require('../../teams/managed-teams');
            const targetMetadata = getTeamChatTargetMetadata(targetAgentId);

            if (targetAgentId === 'manager') {
              const ok = queueManagerMessage(noteContext.teamId, fromAgentId, message);
              if (!ok) return { name, args, result: 'ERROR: Could not queue manager message.', error: true };
            } else if (targetAgentId === 'all') {
              for (const teammateId of team.subagentIds) {
                if (teammateId === fromAgentId) continue;
                queueAgentMessage(noteContext.teamId, teammateId, `[Broadcast from ${fromName}] ${message}`);
                scheduleTeamMemberAutoWake(noteContext.teamId, teammateId, {
                  reason: `${fromName} broadcast a new room message for the team.`,
                  source: 'teammate_message',
                });
              }
              queueManagerMessage(noteContext.teamId, fromAgentId, `[Broadcast to team] ${message}`);
            } else {
              if (!team.subagentIds.includes(targetAgentId)) {
                return { name, args, result: `ERROR: ${targetAgentId} is not a member of team "${team.name}".`, error: true };
              }
              if (targetAgentId === fromAgentId) {
                return { name, args, result: 'ERROR: talk_to_teammate cannot target the same agent.', error: true };
              }
              const ok = queueAgentMessage(noteContext.teamId, targetAgentId, `[From ${fromName}] ${message}`);
              if (!ok) return { name, args, result: `ERROR: Could not queue message for ${targetAgentId}.`, error: true };
              scheduleTeamMemberAutoWake(noteContext.teamId, targetAgentId, {
                reason: `${fromName} sent you a direct teammate message.`,
                source: 'teammate_message',
              });
            }

            appendAndBroadcastTeamChat(deps, team, {
              from: 'subagent',
              fromName,
              fromAgentId,
              content: message,
              metadata: {
                agentId: fromAgentId,
                source: 'talk_to_teammate',
                messageType,
                ...targetMetadata,
              },
            });
            return { name, args, result: `Message sent to ${targetAgentId}: "${message.slice(0, 80)}"`, error: false };
          } catch (err: any) {
            return { name, args, result: `talk_to_teammate error: ${err.message}`, error: true };
          }
        }

        if (name === 'update_my_status') {
          try {
            const noteContext = inferTeamNoteContext(sessionId);
            if (!noteContext || noteContext.authorType !== 'subagent') {
              return { name, args, result: 'ERROR: update_my_status only works inside a team subagent session.', error: true };
            }
            const fromAgentId = noteContext.authorId;
            const fromAgent = getAgentById(fromAgentId) as any;
            const phase = String(args.phase || 'running').trim() || 'running';
            const currentTask = String(args.current_task || '').trim();
            const blockedReason = String(args.blocked_reason || '').trim();
            const agentName = String(fromAgent?.name || fromAgentId).trim();
            const status = updateTeamMemberState(noteContext.teamId, fromAgentId, {
              status: phase,
              currentTask,
              blockedReason,
              lastResult: args.result,
            });
            if (!status) return { name, args, result: `ERROR: Could not update status for ${fromAgentId}.`, error: true };
            const mirroredTaskId = maybeStartTeamStatusTaskMirror(
              sessionId,
              deps,
              noteContext,
              agentName,
              phase,
              currentTask,
              blockedReason,
            );
            const summaryParts = [String(status.status)];
            if (status.currentTask) summaryParts.push(String(status.currentTask));
            if (status.blockedReason) summaryParts.push(`blocked: ${String(status.blockedReason)}`);
            if (status.lastResult) summaryParts.push(`result: ${String(status.lastResult).slice(0, 120)}`);
            const normalizedStatus = String(status.status || '').toLowerCase();
            const isAttentionStatus = normalizedStatus === 'blocked' || normalizedStatus === 'waiting_for_context';
            const shouldMirrorStatusToChat = args?.announce === true || args?.mirror_to_chat === true || isAttentionStatus;
            appendTeamRoomMessage(noteContext.teamId, {
              actorType: 'member',
              actorName: agentName,
              actorId: fromAgentId,
              content: `Status update: ${summaryParts.join(' | ')}`,
              category: 'status',
              target: 'all',
              metadata: {
                agentId: fromAgentId,
                source: 'update_my_status',
              },
            }, {
              mirrorToChat: noteContext.conversationMode !== 'member_direct' && shouldMirrorStatusToChat,
            });
            if (mirroredTaskId) {
              return {
                name,
                args,
                result: `Status updated: ${status.status}${status.currentTask ? ' - ' + status.currentTask.slice(0, 60) : ''} | task mirror: ${mirroredTaskId}`,
                error: false,
              };
            }
            return { name, args, result: `Status updated: ${status.status}${status.currentTask ? ' — ' + status.currentTask.slice(0, 60) : ''}`, error: false };
          } catch (err: any) {
            return { name, args, result: `update_my_status error: ${err.message}`, error: true };
          }
        }

        if (name === 'update_team_goal') {
          try {
            const noteContext = inferTeamNoteContext(sessionId);
            if (!noteContext || noteContext.authorType !== 'subagent') {
              return { name, args, result: 'ERROR: update_team_goal only works inside a team subagent session.', error: true };
            }
            const fromAgentId = noteContext.authorId;
            const fromAgent = getAgentById(fromAgentId) as any;
            const goal = upsertTeamPlanItem(noteContext.teamId, {
              goalId: String(args.goal_id || '').trim() || undefined,
              description: String(args.description || '').trim(),
              priority: args.priority,
              status: args.status,
              reason: String(args.reason || '').trim(),
              createdBy: fromAgentId,
            });
            if (!goal) {
              return { name, args, result: 'ERROR: Could not create or update the team plan item.', error: true };
            }
            appendTeamRoomMessage(noteContext.teamId, {
              actorType: 'member',
              actorName: String(fromAgent?.name || fromAgentId).trim(),
              actorId: fromAgentId,
              content: `${String(args.goal_id || '').trim() ? 'Updated plan item' : 'Proposed new plan item'}: ${goal.description}${goal.reason ? ` (reason: ${goal.reason})` : ''}`,
              category: 'goal_update',
              target: 'all',
              metadata: {
                agentId: fromAgentId,
                source: 'update_team_goal',
              },
            });
            return { name, args, result: `${String(args.goal_id || '').trim() ? 'Goal updated' : 'Goal created'}: ${goal.id} — ${goal.description}`, error: false };
          } catch (err: any) {
            return { name, args, result: `update_team_goal error: ${err.message}`, error: true };
          }
        }

        if (name === 'share_artifact') {
          try {
            const noteContext = inferTeamNoteContext(sessionId);
            if (!noteContext || noteContext.authorType !== 'subagent') {
              return { name, args, result: 'ERROR: share_artifact only works inside a team subagent session.', error: true };
            }
            const fromAgentId = noteContext.authorId;
            const fromAgent = getAgentById(fromAgentId) as any;
            const artifactInput = normalizeShareArtifactArgs(args);
            if (!artifactInput.name) {
              return { name, args, result: 'ERROR: share_artifact requires a name (or a path to derive one from). Pass name/path/description/content at the top level or inside artifact:{...}.', error: true };
            }
            const artifact = shareTeamArtifact(noteContext.teamId, { ...artifactInput, createdBy: fromAgentId });
            if (!artifact) return { name, args, result: `ERROR: Could not share artifact: team ${noteContext.teamId} not found.`, error: true };
            routeTeamEvent({
              type: 'member_shared_artifact',
              teamId: noteContext.teamId,
              agentId: fromAgentId,
              agentName: String(fromAgent?.name || fromAgentId).trim(),
              artifactName: artifact.name,
              artifactPath: artifact.path,
              resultSummary: artifact.description || artifact.content,
              source: 'share_artifact',
            });
            return { name, args, result: `Artifact shared: ${artifact.name} (${artifact.type})`, error: false };
          } catch (err: any) {
            return { name, args, result: `share_artifact error: ${err.message}`, error: true };
          }
        }

        // ── set_agent_model: update a specific agent's model or a type-level default ─
        if (name === 'set_current_model') {
          const modelRef = String(args?.model || '').trim();
          const reason = String(args?.reason || '').trim();
          if (!modelRef) {
            return { name, args, result: 'ERROR: model is required. Format: "provider/model" e.g. "xai/grok-4.3" or "openai_codex/gpt-5.5"', error: true };
          }

          const parsed = parseProviderModelRef(modelRef);
          if (!parsed) {
            return { name, args, result: `ERROR: Invalid model "${modelRef}". Expected a known provider/model route such as "xai/grok-4.3" or "openai_codex/gpt-5.5".`, error: true };
          }

          try {
            const cm = getConfig();
            const current = cm.getConfig() as any;
            cm.updateConfig(mainChatRoutePatch(current, { provider: parsed.providerId, model: parsed.model }) as any);
            resetProvider();
            // A per-chat route (mobile/desktop model selector) outranks the global
            // Main Chat route. Without updating it, the switch reports success but
            // this chat keeps running on its old model.
            let chatRouteUpdated = false;
            try {
              if (sessionId && getChatModelRoute(sessionId)) {
                setChatModelRoute(sessionId, { providerId: parsed.providerId, model: parsed.model } as any);
                chatRouteUpdated = true;
              }
            } catch { /* no live session for this caller */ }
            return {
              name,
              args,
              result: JSON.stringify({
                success: true,
                current_model: `${parsed.providerId}/${parsed.model}`,
                provider: parsed.providerId,
                model: parsed.model,
                reason: reason || null,
                chat_route_updated: chatRouteUpdated,
                note: 'Main Chat Agent route updated; the next model call in this live chat will use it.',
              }, null, 2),
              error: false,
            };
          } catch (err: any) {
            return { name, args, result: `set_current_model error: ${err.message}`, error: true };
          }
        }

        if (name === 'set_agent_model') {
          const targetAgentId = String(args?.agent_id || '').trim();
          const provider      = String(args?.provider   || '').trim();
          const rawModel      = String(args?.model      || '').trim();
          const model         = provider && rawModel && !rawModel.includes('/') ? `${provider}/${rawModel}` : rawModel;
          const hasReasoning  = typeof args?.reasoning_effort === 'string' || typeof args?.reasoning === 'string';
          const reasoningEffort = String(args?.reasoning_effort ?? args?.reasoning ?? '').trim();
          const agentType     = String(args?.agent_type || '').trim();

          if (!model && !hasReasoning) {
            return { name, args, result: 'ERROR: provide model (optionally with provider) and/or reasoning_effort.', error: true };
          }

          const { getConfig: _gc } = require('../../../config/config');
          const _cfg = _gc().getConfig() as any;
          const gatewayPort = Number(_cfg?.gateway?.port) || 18789;
          const configuredHost = String(_cfg?.gateway?.host || '127.0.0.1');
          const gatewayHost = (configuredHost === '0.0.0.0' || configuredHost === '::') ? '127.0.0.1' : configuredHost;

          try {
            if (targetAgentId) {
              // Path 1: update a specific agent definition's model field
              const resp = await fetch(`http://${gatewayHost}:${gatewayPort}/api/agents/${encodeURIComponent(targetAgentId)}/model`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...(model ? { model } : {}), ...(hasReasoning ? { reasoning_effort: reasoningEffort } : {}) }),
              });
              const data = await resp.json() as any;
              if (!data?.success) return { name, args, result: `ERROR: ${data?.error || 'Failed to update agent model'}`, error: true };
              return { name, args, result: `✅ Agent "${targetAgentId}" routing updated: model=${data.agent?.model || 'default'}, reasoning=${data.agent?.reasoning_effort || 'provider default'}. Takes effect on next spawn.`, error: false };
            }

            if (agentType) {
              // Path 2: update a type-level default
              const VALID_TYPES = [
                'main_chat',
                'proposal_executor_high_risk',
                'proposal_executor_low_risk',
                'manager',
                'team_manager',
                'subagent',
                'team_subagent',
                'subagent_planner',
                'subagent_orchestrator',
                'subagent_researcher',
                'subagent_analyst',
                'subagent_builder',
                'subagent_operator',
                'subagent_verifier',
                'switch_model_low',
                'switch_model_medium',
                'coordinator',
                'background_spawn',
                'goal_compactor',
              ];
              if (!VALID_TYPES.includes(agentType)) {
                return { name, args, result: `ERROR: Invalid agent_type "${agentType}". Valid values: ${VALID_TYPES.join(', ')}`, error: true };
              }
              const isGoalSupportRoute = agentType === 'goal_compactor';
              const goalPrefix = 'compaction';
              const endpoint = isGoalSupportRoute ? '/api/settings/session' : '/api/settings/agent-model-defaults';
              const payload = isGoalSupportRoute
                ? { mainChatGoals: {
                    ...(model ? { [`${goalPrefix}Model`]: model } : {}),
                    ...(hasReasoning ? { [`${goalPrefix}Reasoning`]: reasoningEffort } : {}),
                  } }
                : {
                    ...(model ? { [agentType]: model } : {}),
                    ...(hasReasoning ? { reasoning: { [agentType]: reasoningEffort } } : {}),
                  };
              const resp = await fetch(`http://${gatewayHost}:${gatewayPort}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              });
              const data = await resp.json() as any;
              if (!data?.success) return { name, args, result: `ERROR: Failed to update type default`, error: true };
              if (isGoalSupportRoute) {
                const route = data.session?.mainChatGoals || {};
                return { name, args, result: `✅ Goal Support routing for "${agentType}" updated: model=${route[`${goalPrefix}Model`] || 'current main chat'}, reasoning=${route[`${goalPrefix}Reasoning`] || 'provider default'}.`, error: false };
              }
              const savedModel = String((getConfig().getConfig() as any)?.agent_model_defaults?.[agentType] || data.defaults?.[agentType] || '').trim();
              if (model && savedModel !== model) {
                return { name, args, result: `ERROR: set_agent_model for "${agentType}" did not persist: requested "${model}", config now has "${savedModel || 'primary'}".`, error: true };
              }
              return { name, args, result: `Default routing for "${agentType}" updated: model=${savedModel || 'primary'}, reasoning=${data.reasoning?.[agentType] || 'provider default'}.`, error: false };
            }

            return { name, args, result: 'ERROR: Provide either agent_id (to update a specific agent) or agent_type (to set a type-level default).', error: true };
          } catch (err: any) {
            return { name, args, result: `set_agent_model error: ${err.message}`, error: true };
          }
        }

        // ── provider_accounts: list/rename/set_default/remove saved provider accounts ─
        // Writes go through the same Settings routes as the UI so validation,
        // credential cleanup and stale-save protection stay in one place.
        if (name === 'provider_accounts') {
          const action = String(args?.action || '').trim();
          const providerId = String(args?.provider || '').trim();
          const accountId = String(args?.account_id || args?.accountId || '').trim();
          type ProviderAccountRow = { label?: unknown; api_key?: unknown };
          type ProviderCfgSlice = { accounts?: unknown; api_key?: unknown; defaultAccountId?: unknown };
          const cfgNow = getConfig().getConfig() as unknown as {
            gateway?: { port?: unknown; host?: unknown };
            llm?: { provider?: string; accountId?: string; providers?: Record<string, ProviderCfgSlice | undefined> };
          };
          if (action === 'list') {
            const { providerAccountVaultKey, providerOAuthVaultKey } = require('../../../providers/usage-awareness');
            const { getVault } = require('../../../security/vault');
            const keys = new Set<string>(getVault().keys());
            const out: Record<string, Array<{ id: string; label: string; default: boolean; has_saved_credentials: boolean }>> = {};
            for (const pid of ['anthropic', 'openai_codex', 'openai', 'xai']) {
              const pc = cfgNow?.llm?.providers?.[pid];
              if (!pc || typeof pc !== 'object') continue;
              const accounts = (pc.accounts && typeof pc.accounts === 'object' && !Array.isArray(pc.accounts) ? pc.accounts : {}) as Record<string, ProviderAccountRow | undefined>;
              const legacyKey = typeof pc.api_key === 'string' && !!pc.api_key.trim();
              const rows = Object.entries(accounts).map(([id, acct]) => ({
                id,
                label: String(acct?.label || id),
                default: String(pc.defaultAccountId || '') === id,
                has_saved_credentials: keys.has(providerAccountVaultKey(pid, id)) || keys.has(providerOAuthVaultKey(pid, id))
                  || (typeof acct?.api_key === 'string' && !!acct.api_key.trim())
                  || (id === 'default' && (legacyKey || keys.has(providerOAuthVaultKey(pid)))),
              }));
              if (!rows.length && !legacyKey && !keys.has(providerOAuthVaultKey(pid))) continue;
              out[pid] = rows.length ? rows : [{ id: 'default', label: 'Default account', default: true, has_saved_credentials: true }];
            }
            return { name, args, result: JSON.stringify({ providers: out, main_chat: { provider: cfgNow?.llm?.provider || null, account_id: cfgNow?.llm?.accountId || null } }, null, 2), error: false };
          }
          if (!['rename', 'set_default', 'remove'].includes(action)) {
            return { name, args, result: 'ERROR: action must be list, rename, set_default, or remove.', error: true };
          }
          if (!providerId || !accountId) {
            return { name, args, result: 'ERROR: provider and account_id are required. Call provider_accounts with action "list" first.', error: true };
          }
          const port = Number(cfgNow?.gateway?.port) || 18789;
          const host = String(cfgNow?.gateway?.host || '127.0.0.1');
          const base = `http://${host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host}:${port}`;
          const endpoint = action === 'remove' ? '/api/settings/provider-accounts/remove' : '/api/settings/provider-accounts/update';
          const body = action === 'remove'
            ? { providerId, accountId, dryRun: args?.dry_run === true }
            : action === 'rename'
              ? { providerId, accountId, label: String(args?.label ?? '') }
              : { providerId, accountId, makeDefault: true };
          try {
            const resp = await fetch(`${base}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const data = await resp.json() as { success?: boolean; error?: string } & Record<string, unknown>;
            if (!data?.success) return { name, args, result: `ERROR: ${data?.error || `provider_accounts ${action} failed`}`, error: true };
            return { name, args, result: JSON.stringify({ action, provider: providerId, account_id: accountId, ...data }, null, 2), error: false };
          } catch (err: unknown) {
            return { name, args, result: `provider_accounts error: ${err instanceof Error ? err.message : String(err)}`, error: true };
          }
        }

        // ── get_agent_models: read current model config for all agent types ─────
        if (name === 'get_agent_models') {
          try {
            const { getConfig: _gc2 } = require('../../../config/config');
            const cfg2 = _gc2().getConfig() as any;
            const defaults = cfg2.agent_model_defaults || {};
            const defaultReasoning = cfg2.agent_model_default_reasoning || {};
            const activeProvider = String(cfg2.llm?.provider || '').trim() || null;
            const primaryModel = cfg2.llm?.providers?.[cfg2.llm?.provider]?.model || cfg2.models?.primary || null;
            const agents = (cfg2.agents || []).map((a: any) => ({
              id:    a.id,
              name:  a.name,
              model: a.model || null,
              reasoning_effort: a.reasoning_effort || null,
            }));
            const result = {
              current_primary: activeProvider && primaryModel ? `${activeProvider}/${primaryModel}` : primaryModel,
              current_provider: activeProvider,
              global_primary: primaryModel,
              agent_model_defaults: defaults,
              agent_model_default_reasoning: defaultReasoning,
              active_agent_model_default_template: cfg2.active_agent_model_default_template || null,
              agent_model_default_templates: cfg2.agent_model_default_templates || [],
              goal_support: {
                compactor: {
                  model: cfg2.session?.mainChatGoals?.compactionModel || null,
                  reasoning_effort: cfg2.session?.mainChatGoals?.compactionReasoning || null,
                  fallback: 'current_primary',
                },
              },
              individual_agent_overrides: agents,
            };
            return { name, args, result: JSON.stringify(result, null, 2), error: false };
          } catch (err: any) {
            return { name, args, result: `get_agent_models error: ${err.message}`, error: true };
          }
        }

        // ── gateway_restart: quick graceful restart ─────────────────────────
        if (
          name === 'list_agent_model_templates' ||
          name === 'save_agent_model_template' ||
          name === 'update_agent_model_template' ||
          name === 'apply_agent_model_template' ||
          name === 'select_agent_model_template' ||
          name === 'delete_agent_model_template'
        ) {
          const { getConfig: _gc3 } = require('../../../config/config');
          const _cfg3 = _gc3().getConfig() as any;
          const gatewayPort = Number(_cfg3?.gateway?.port) || 18789;
          const configuredHost = String(_cfg3?.gateway?.host || '127.0.0.1');
          const gatewayHost = (configuredHost === '0.0.0.0' || configuredHost === '::') ? '127.0.0.1' : configuredHost;
          const baseUrl = `http://${gatewayHost}:${gatewayPort}/api/settings/agent-model-default-templates`;

          try {
            if (name === 'list_agent_model_templates') {
              const resp = await fetch(baseUrl);
              const data = await resp.json() as any;
              if (!data?.success) return { name, args, result: `ERROR: ${data?.error || 'Failed to list templates'}`, error: true };
              return { name, args, result: JSON.stringify(data, null, 2), error: false };
            }

            if (name === 'save_agent_model_template') {
              const templateName = String(args?.name || '').trim();
              if (!templateName) return { name, args, result: 'ERROR: name is required.', error: true };
              const body: any = { name: templateName };
              if (args?.id) body.id = String(args.id).trim();
              if (args?.defaults && typeof args.defaults === 'object') body.defaults = args.defaults;
              if (args?.reasoning && typeof args.reasoning === 'object') body.reasoning = args.reasoning;
              const resp = await fetch(baseUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              });
              const data = await resp.json() as any;
              if (!data?.success) return { name, args, result: `ERROR: ${data?.error || 'Failed to save template'}`, error: true };
              return { name, args, result: `Saved agent model template "${data.template?.name || templateName}" (${data.template?.id || 'new'}).`, error: false };
            }

            const id = String(args?.id || args?.name || '').trim();
            if (!id) return { name, args, result: 'ERROR: id or name is required.', error: true };

            if (name === 'update_agent_model_template') {
              const body: any = {};
              if (typeof args?.name === 'string' && args.name.trim()) body.name = args.name.trim();
              if (args?.defaults && typeof args.defaults === 'object') body.defaults = args.defaults;
              if (args?.reasoning && typeof args.reasoning === 'object') body.reasoning = args.reasoning;
              if (!Object.keys(body).length) return { name, args, result: 'ERROR: provide name, defaults, and/or reasoning to update.', error: true };
              const resp = await fetch(`${baseUrl}/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              });
              const data = await resp.json() as any;
              if (!data?.success) return { name, args, result: `ERROR: ${data?.error || 'Failed to update template'}`, error: true };
              return { name, args, result: `Updated agent model template "${data.template?.name || id}" (${data.template?.id || id}).`, error: false };
            }

            if (name === 'apply_agent_model_template' || name === 'select_agent_model_template') {
              const resp = await fetch(`${baseUrl}/${encodeURIComponent(id)}/apply`, { method: 'POST' });
              const data = await resp.json() as any;
              if (!data?.success) return { name, args, result: `ERROR: ${data?.error || 'Failed to apply template'}`, error: true };
              return { name, args, result: `Selected and applied agent model template "${data.template?.name || id}". Current defaults: ${JSON.stringify(data.defaults || {}, null, 2)}`, error: false };
            }

            const resp = await fetch(`${baseUrl}/${encodeURIComponent(id)}`, { method: 'DELETE' });
            const data = await resp.json() as any;
            if (!data?.success) return { name, args, result: `ERROR: ${data?.error || 'Failed to delete template'}`, error: true };
            return { name, args, result: `Deleted agent model template "${data.removed?.name || id}".`, error: false };
          } catch (err: any) {
            return { name, args, result: `${name} error: ${err.message}`, error: true };
          }
        }

        if (name === 'await_dev_edit_handoff') {
          const requestedDevEditId = String(args.dev_edit_id || args.devEditId || '').trim();
          const activeDevEdit = requestedDevEditId
            ? getDevSourceEditContinuation(requestedDevEditId)
            : getLatestPendingDevSourceEditContinuation(sessionId);
          if (activeDevEdit?.status === 'complete') {
            return {
              name,
              args,
              result: `prom_apply_dev_changes skipped: dev edit ${activeDevEdit.id} is already complete/live. Do not apply or restart it again; continue with post-restart verification only.`,
              data: { dev_edit_id: activeDevEdit.id, idempotent: true, live_status: 'complete' },
              extra: { dev_edit_id: activeDevEdit.id, idempotent: true, live_status: 'complete' },
              error: false,
            };
          }
          if (!activeDevEdit) {
            return { name, args, result: 'No pending dev edit was found for this handoff wait.', error: true };
          }
          const timeoutSeconds = Math.min(1800, Math.max(1, Number(args.timeout_seconds || args.timeoutSeconds || 900) || 900));
          const coordinated = await waitForCoordinatedDevEditFiles(activeDevEdit.id, timeoutSeconds * 1000);
          if (!coordinated) {
            return { name, args, result: `Dev edit ${activeDevEdit.id} is no longer active in the coordination queue.`, error: true };
          }
          if (coordinated.waitingFiles.length) {
            return {
              name,
              args,
              result: `Dev edit ${activeDevEdit.id} is still waiting for verified handoff of: ${coordinated.waitingFiles.join(', ')}. No files were unlocked during this wait.`,
              error: false,
            };
          }
          return {
            name,
            args,
            result:
              `Verified file handoff completed for dev edit ${activeDevEdit.id}. ` +
              `Unlocked files: ${coordinated.inheritedFiles.join(', ') || coordinated.ownedFiles.join(', ')}. ` +
              'Reread every handed-off file now and apply the remaining edit on top of its latest version; do not reuse a stale patch.',
            data: { dev_edit_id: activeDevEdit.id, unlocked_files: coordinated.ownedFiles, inherited_files: coordinated.inheritedFiles },
            extra: { dev_edit_id: activeDevEdit.id, unlocked_files: coordinated.ownedFiles, inherited_files: coordinated.inheritedFiles },
            error: false,
          };
        }

        if (name === 'prom_apply_dev_changes') {
          const requestedDevEditId = String(args.dev_edit_id || args.devEditId || '').trim();
          const activeDevEdit = requestedDevEditId
            ? getDevSourceEditContinuation(requestedDevEditId)
            : getLatestPendingDevSourceEditContinuation(sessionId);
          // This must happen at the actual apply entrypoint (not only in
          // await_dev_edit_handoff): a repeated tool call after recovery must
          // never run verify, sync, build, or restart a completed edit again.
          if (activeDevEdit && isCompletedDevSourceEditApply(activeDevEdit)) {
            return {
              name,
              args,
              result: `prom_apply_dev_changes skipped: dev edit ${activeDevEdit.id} is already complete/live. Do not apply or restart it again; continue with post-restart verification only.`,
              data: { dev_edit_id: activeDevEdit.id, idempotent: true, live_status: 'complete' },
              extra: { dev_edit_id: activeDevEdit.id, idempotent: true, live_status: 'complete' },
              error: false,
            };
          }
          const explicitAffectedFiles = Array.isArray(args.affected_files)
            ? args.affected_files.map((f: any) => String(f || '').trim()).filter(Boolean)
            : [];
          let affectedFiles = explicitAffectedFiles.length
            ? explicitAffectedFiles
            : Array.isArray(activeDevEdit?.affectedFiles) && activeDevEdit.affectedFiles.length
              ? activeDevEdit.affectedFiles
              : activeDevEdit?.allowedFiles || [];
          const surfaces = Array.isArray(args.changed_surfaces)
            ? args.changed_surfaces.map((s: any) => String(s || '').trim().toLowerCase()).filter(Boolean)
            : [];
          const inferredSurfaces = getPromApplySurfacesForFiles(affectedFiles);
          let normalizedSurfaces: string[] = Array.from(new Set<string>([...surfaces, ...inferredSurfaces].map((surface: string) => {
            if (surface === 'src' || surface === 'gateway') return 'backend';
            return surface;
          })));
          let hasBackend = normalizedSurfaces.some((surface: string) => surface === 'backend' || surface === 'config');
          let hasWeb = normalizedSurfaces.some((surface: string) => surface === 'web-ui' || surface === 'mobile' || surface === 'static');
          const refreshDesktop = args.refresh_desktop !== false;
          const mode = String(args.mode || 'apply_live').trim().toLowerCase();
          const verifyOnly = mode === 'verify_only';
          const reason = String(args.reason || 'Prometheus dev changes applied').trim();
          if (!normalizedSurfaces.length) {
            return { name, args, result: 'prom_apply_dev_changes requires changed_surfaces or affected_files that map to src/ or web-ui/.', error: true };
          }
          if (!['apply_live', 'verify_only'].includes(mode)) {
            return { name, args, result: 'prom_apply_dev_changes mode must be apply_live or verify_only.', error: true };
          }
          const completionNoteTag = String(
            args.completion_note_tag
            || args.completionNoteTag
            || activeDevEdit?.completionNoteTag
            || activeDevEdit?.plan?.completionNoteTag
            || 'dev_edit_complete',
          ).trim().replace(/\s+/g, '_').toLowerCase();

          const runCommand = async (command: string, timeoutMs: number) => {
            const root = path.resolve(__dirname, '..', '..', '..');
            const start = Date.now();
            try {
              const captured = await deps.runCommandCaptured(command, root, timeoutMs);
              const output = [captured.stdout, captured.stderr].filter(Boolean).join('\n');
              return { success: captured.code === 0 && !captured.timedOut, command, output: output.slice(-2500), durationMs: Date.now() - start };
            } catch (err: any) {
              const output = [err?.stdout, err?.stderr, err?.message].filter(Boolean).join('\n');
              return { success: false, command, output: String(output || '').slice(-2500), durationMs: Date.now() - start };
            }
          };

          const steps: any[] = [];
          if (verifyOnly) {
            const coordinatedBeforeVerify = activeDevEdit ? getCoordinatedDevEdit(activeDevEdit.id) : null;
            if (coordinatedBeforeVerify?.waitingFiles.length) {
              return {
                name,
                args,
                result:
                  `prom_apply_dev_changes verify_only deferred: dev edit ${activeDevEdit?.id} is waiting for verified handoff of ` +
                  `${coordinatedBeforeVerify.waitingFiles.join(', ')}. Call dev_source_edit(action:"await_files", dev_edit_id:"${activeDevEdit?.id}") first.`,
                error: false,
              };
            }
            const plan = resolveDevVerificationPlan({
              mode: 'verify_only',
              changedFiles: affectedFiles,
              changedSurfaces: normalizedSurfaces,
              approvedProfiles: activeDevEdit?.verificationProfiles || activeDevEdit?.verificationProfile,
              requestedProfiles: args.verification_profiles || args.verificationProfiles || args.verification_profile || args.verificationProfile,
              rootDir: path.resolve(__dirname, '..', '..', '..'),
            });
            const coordinatedPeers = activeDevEdit ? listCoordinatedDevEditPeers(activeDevEdit.id) : [];
            if (coordinatedPeers.length) {
              // Handoff verification must not blame this edit for another
              // editor's transient cross-file state. The elected batch leader
              // performs the canonical union build/sync after every queue drains.
              plan.steps = plan.steps.filter((step) => step.id === 'syntax_changed');
            }
            const results = await runDevVerificationPlan(plan, path.resolve(__dirname, '..', '..', '..'));
            const failed = results.find((result) => !result.success);
            const verificationSummary = formatDevVerificationSummary(plan, results)
              + (coordinatedPeers.length
                ? `\nGlobal build/sync deferred to the shared batch because ${coordinatedPeers.length} coordinated peer edit(s) are active.`
                : '');
            if (activeDevEdit) {
              upsertDevSourceEditContinuation({
                ...activeDevEdit,
                affectedFiles,
                changedSurfaces: normalizedSurfaces,
                verificationProfiles: plan.profileIds,
                verificationProfile: plan.profileIds[0],
                lastVerification: {
                  profileIds: plan.profileIds,
                  changedFiles: plan.changedFiles,
                  success: !failed,
                  summary: verificationSummary,
                  completedAt: Date.now(),
                },
                updatedAt: Date.now(),
              });
              try {
                const handoff = recordCoordinatedDevEditVerification({
                  id: activeDevEdit.id,
                  files: plan.changedFiles.length ? plan.changedFiles : affectedFiles,
                  success: !failed,
                  summary: verificationSummary,
                });
                if (!failed && handoff?.awakened.length) {
                  for (const awakened of handoff.awakened) {
                    const handoffText =
                      `Dev edit ${activeDevEdit.id} verified successfully and handed off ${awakened.inheritedFiles.join(', ') || awakened.ownedFiles.join(', ')} to your edit ${awakened.id}. ` +
                      'Reread every handed-off file before editing; the verified source on disk is now the version you must build on.';
                    try {
                      addMessage(awakened.sessionId, {
                        role: 'assistant', messageKind: 'restart_status', content: handoffText,
                        timestamp: Date.now(), channel: 'system', channelLabel: 'Dev Edit Handoff',
                      }, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
                      flushSession(awakened.sessionId);
                    } catch {}
                    try {
                      deps.broadcastWS?.({
                        type: 'dev_edit_handoff_ready', sessionId: awakened.sessionId,
                        devEditId: awakened.id, fromDevEditId: activeDevEdit.id,
                        files: awakened.inheritedFiles, text: handoffText, timestamp: Date.now(),
                      });
                    } catch {}
                  }
                }
              } catch {}
            }
            if (failed) {
              const completed = results.filter((result) => result.success);
              return {
                name,
                args,
                result:
                  `prom_apply_dev_changes verify_only failed during ${failed.label} (${failed.durationMs}ms).\n\n` +
                  `${verificationSummary}` +
                  (completed.length ? `\n\nCompleted first:\n${completed.map((s) => `- ${s.label}: ok (${s.durationMs}ms)`).join('\n')}` : '') +
                  `\n\n${failed.output || ''}`,
                error: true,
              };
            }
            return {
              name,
              args,
              result:
                `prom_apply_dev_changes verify_only succeeded.\n` +
                `${verificationSummary}\n` +
                `Gateway was not restarted${hasWeb && refreshDesktop ? ', and no desktop reload was requested' : ''}.`,
              error: false,
            };
          }

          let coordinatedApply: ReturnType<typeof requestCoordinatedDevEditApply> | null = null;
          const coordinatedRecord = activeDevEdit ? getCoordinatedDevEdit(activeDevEdit.id) : null;
          if (activeDevEdit && coordinatedRecord) {
            try {
              coordinatedApply = requestCoordinatedDevEditApply(activeDevEdit.id);
            } catch (err: any) {
              return { name, args, result: `prom_apply_dev_changes apply_live deferred: ${err.message || err}`, error: true };
            }
            try {
              deps.broadcastWS?.({
                type: 'dev_edit_coordination_updated',
                sessionId,
                devEditId: activeDevEdit.id,
                phase: coordinatedApply.edit.phase,
                role: coordinatedApply.role,
                blockers: coordinatedApply.blockers.map((item) => ({ id: item.id, sessionId: item.sessionId, phase: item.phase, waitingFiles: item.waitingFiles })),
                awakened: coordinatedApply.awakened.map((item) => ({ id: item.id, sessionId: item.sessionId, files: item.ownedFiles })),
                batchId: coordinatedApply.batch?.id,
              });
            } catch {}
            if (coordinatedApply.role === 'waiting') {
              if (coordinatedApply.batch && coordinatedApply.batch.leaderId !== activeDevEdit.id && coordinatedApply.blockers.length === 0) {
                const leader = getDevSourceEditContinuation(coordinatedApply.batch.leaderId);
                const leaderText =
                  `Coordinated dev batch ${coordinatedApply.batch.id} is fully verified and ready for its single Apply Live decision. ` +
                  `You are the elected leader for dev edit ${coordinatedApply.batch.leaderId}; call prom_apply_dev_changes apply_live to present the 30-minute approval card.`;
                if (leader) {
                  try {
                    addMessage(leader.sessionId, {
                      role: 'assistant', messageKind: 'restart_status', content: leaderText,
                      timestamp: Date.now(), channel: 'system', channelLabel: 'Dev Apply Ready',
                    }, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
                    flushSession(leader.sessionId);
                  } catch {}
                  try { deps.broadcastWS?.({ type: 'dev_apply_leader_ready', sessionId: leader.sessionId, batchId: coordinatedApply.batch.id, text: leaderText, timestamp: Date.now() }); } catch {}
                }
              }
              const blockerSummary = coordinatedApply.blockers
                .map((item) => `${item.id} (${item.phase}${item.waitingFiles.length ? `; waiting: ${item.waitingFiles.join(', ')}` : ''})`)
                .join('; ');
              const handoffSummary = coordinatedApply.awakened.length
                ? ` Verified handoff unlocked ${coordinatedApply.awakened.map((item) => `${item.id}: ${item.ownedFiles.join(', ')}`).join('; ')}.`
                : '';
              return {
                name,
                args,
                result:
                  `prom_apply_dev_changes is queued without restarting. Dev edit ${activeDevEdit.id} passed its readiness boundary and is waiting for the shared apply batch. ` +
                  `Blockers: ${blockerSummary || 'other active dev edits'}.${handoffSummary} ` +
                  'Do not call write_note yet and do not keep retrying apply_live; this thread will receive its own completion after the batch deploys.',
                data: { dev_edit_id: activeDevEdit.id, coordination_status: 'waiting', blockers: coordinatedApply.blockers.map((item) => item.id) },
                extra: { dev_edit_id: activeDevEdit.id, coordination_status: 'waiting', blockers: coordinatedApply.blockers.map((item) => item.id) },
                error: false,
              };
            }
            if (coordinatedApply.batch) {
              affectedFiles = coordinatedApply.batch.files;
              normalizedSurfaces = Array.from(new Set([...normalizedSurfaces, ...getPromApplySurfacesForFiles(affectedFiles)]));
              hasBackend = normalizedSurfaces.some((surface: string) => surface === 'backend' || surface === 'config');
              hasWeb = normalizedSurfaces.some((surface: string) => surface === 'web-ui' || surface === 'mobile' || surface === 'static');
            }
          }

          // Source-edit approval is automatic locally; making verified code
          // live is deliberately a distinct, user-controlled 30-minute gate.
          if (coordinatedApply?.batch) {
            const batch = coordinatedApply.batch;
            const approvalQueue = getApprovalQueue();
            let approval = batch.approvalId ? approvalQueue.get(batch.approvalId) : null;
            if (!approval) {
              const expiresAt = Date.now() + 30 * 60_000;
              const origin = inferApprovalOrigin(sessionId, resolveTaskForSession(sessionId), args);
              approval = approvalQueue.create({
                sessionId,
                agentId: inferAgentIdFromSession(sessionId, args),
                originType: origin.originType,
                originLabel: origin.originLabel,
                toolName: 'prom_apply_dev_changes',
                toolArgs: { mode: 'apply_live', batch_id: batch.id, dev_edit_ids: batch.memberIds, affected_files: batch.files },
                approvalKind: 'dev_apply_live',
                action: `Apply verified dev batch live: ${batch.memberIds.length} edit(s), ${batch.files.length} file(s)`,
                reason: `Restart/reload the gateway for verified batch ${batch.id}. This card auto-rejects in 30 minutes.`,
                policyTier: 'commit', riskScore: 6,
                affectedSystems: ['Prometheus gateway', ...(hasWeb ? ['Prometheus web UI'] : [])],
                devApplyLive: { batchId: batch.id, memberIds: batch.memberIds, files: batch.files, expiresAt },
              });
              setCoordinatedDevApplyBatchApproval({ batchId: batch.id, approvalId: approval.id, expiresAt });
              try {
                appendAuditEntry({ timestamp: new Date().toISOString(), sessionId, agentId: inferAgentIdFromSession(sessionId, args),
                  actionType: 'approval_requested', toolName: 'prom_apply_dev_changes', toolArgs: approval.toolArgs,
                  policyTier: 'commit', approvalStatus: 'pending', resultSummary: `Queued 30-minute dev apply approval ${approval.id} for ${batch.id}` });
                deps.broadcastWS?.({ type: 'approval_created', sessionId, approvalId: approval.id, summary: approval.action,
                  toolName: 'prom_apply_dev_changes', approval: serializeApprovalForClient(approval) });
              } catch {}
            }
            let approved = approval.status === 'approved';
            if (approval.status === 'pending') {
              approved = await new Promise<boolean>((resolve) => {
                const remaining = Math.max(1, Number(approval!.devApplyLive?.expiresAt || 0) - Date.now());
                const timer = setTimeout(() => approvalQueue.resolve(approval!.id, false, 'policy:timeout'), remaining);
                approvalQueue.onResolve(approval!.id, (isApproved) => { clearTimeout(timer); resolve(isApproved); });
              });
            }
            if (!approved) {
              markCoordinatedDevApplyBatch(batch.id, 'not_live');
              const notice = `Verified dev batch ${batch.id} was not applied live. Source edits remain saved and audited, but the gateway was not restarted.`;
              for (const memberId of batch.memberIds) {
                const member = getDevSourceEditContinuation(memberId);
                if (!member || member.status === 'complete') continue;
                upsertDevSourceEditContinuation({ ...member, status: 'verified_not_live', updatedAt: Date.now() });
                try {
                  addMessage(member.sessionId, { role: 'assistant', messageKind: 'restart_status', content: notice,
                    timestamp: Date.now(), channel: 'system', channelLabel: 'Dev Apply Deferred' },
                    { disableCompactionCheck: true, disableMemoryFlushCheck: true });
                  flushSession(member.sessionId);
                } catch {}
                try { deps.broadcastWS?.({ type: 'session_notification', source: 'dev_apply', previousSessionId: member.sessionId,
                  sessionId: member.sessionId, title: 'Verified changes not live', text: notice, batchId: batch.id, timestamp: Date.now() }); } catch {}
              }
              return { name, args, result: `${notice} Request prom_apply_dev_changes again later to create a new Apply Live batch.`,
                data: { dev_edit_id: activeDevEdit?.id, batch_id: batch.id, live_status: 'verified_not_live' }, error: false };
            }
            if (!beginCoordinatedDevApplyBatch(batch.id)) {
              return { name, args, result: `prom_apply_dev_changes could not start coordinated batch ${batch.id}; its approval state changed.`, error: true };
            }
          }

          if (hasWeb) {
            const sync = await runCommand('npm run sync:web-ui', 120_000);
            steps.push(sync);
            if (!sync.success) {
              if (coordinatedApply?.batch) markCoordinatedDevApplyBatch(coordinatedApply.batch.id, 'failed', sync.output);
              return {
                name,
                args,
                result: `prom_apply_dev_changes failed during ${sync.command} (${sync.durationMs}ms).\n\n${sync.output}`,
                error: true,
              };
            }
          }

          const buildDevEditContinuation = (status: 'applying_live') => activeDevEdit ? {
            ...activeDevEdit,
            status,
            completionNoteTag,
            affectedFiles,
            changedSurfaces: normalizedSurfaces,
            summary: String(args.summary || reason || activeDevEdit.summary || '').trim() || undefined,
            verification: Array.isArray(activeDevEdit.verification) ? activeDevEdit.verification : activeDevEdit.plan?.verification,
            verificationProfile: activeDevEdit.verificationProfile,
            verificationProfiles: activeDevEdit.verificationProfiles,
            updatedAt: Date.now(),
          } : undefined;

          const devEditContinuation = buildDevEditContinuation('applying_live');
          if (devEditContinuation) {
            upsertDevSourceEditContinuation(devEditContinuation);
          }
          const batchDevEditContinuations = coordinatedApply?.batch
            ? coordinatedApply.batch.memberIds
                .flatMap((memberId) => {
                  const member = getDevSourceEditContinuation(memberId);
                  return member ? [member] : [];
                })
                .map((member) => upsertDevSourceEditContinuation({
                  ...member,
                  status: 'applying_live',
                  changedSurfaces: Array.from(new Set([...(member.changedSurfaces || []), ...getPromApplySurfacesForFiles(member.affectedFiles || member.allowedFiles || [])])),
                  updatedAt: Date.now(),
                }))
            : (devEditContinuation ? [devEditContinuation] : []);

          if (hasBackend) {
            try {
              const { buildAndRestart, gracefulRestart } = require('../../lifecycle');
              const restartTask = resolveTaskForSession(sessionId);
              const sessionHint = getSessionChannelHint(sessionId);
              const isTelegramSession = String(sessionId || '').startsWith('telegram_') || sessionHint?.channel === 'telegram';
              const ctx = {
                reason: (args.proposal_id ? 'proposal' : 'build_deploy') as any,
                timestamp: Date.now(),
                proposalId: args.proposal_id || undefined,
                title: args.title || reason,
                summary: args.summary || reason,
                affectedFiles: affectedFiles.length ? affectedFiles : undefined,
                restartScope: resolveGatewayRestartScope({ affectedFiles }),
                testInstructions: args.test_instructions || undefined,
                previousSessionId: sessionId,
                taskId: restartTask?.id,
                taskOriginatingSessionId: restartTask?.originatingSessionId,
                taskInitiatedTool: restartTask ? 'prom_apply_dev_changes' : undefined,
                originChannel: isTelegramSession ? 'telegram' : undefined,
                respondToTelegram: isTelegramSession ? true : undefined,
                previousTelegramChatId: Number.isFinite(Number(sessionHint?.chatId)) ? String(sessionHint?.chatId) : undefined,
                previousTelegramUserId: Number.isFinite(Number(sessionHint?.userId)) ? Number(sessionHint?.userId) : undefined,
                devReload: refreshDesktop
                  ? { enabled: true, batchId: coordinatedApply?.batch?.id, reason, surfaces: normalizedSurfaces, delayMs: 1200 }
                  : undefined,
                devEditContinuation,
                devApplyBatch: coordinatedApply?.batch ? {
                  id: coordinatedApply.batch.id,
                  memberIds: coordinatedApply.batch.memberIds,
                  memberSessionIds: coordinatedApply.batch.memberSessionIds,
                  files: coordinatedApply.batch.files,
                  members: batchDevEditContinuations,
                } : undefined,
              };
              // In the source/tsx dev gateway, verify_only has already run the
              // approved backend build against the exact content hashes that
              // the coordinator just rechecked. Do not make users wait for a
              // second full TypeScript compile before the restart. Packaged
              // gateways still rebuild because their running code is dist/.
              const runningSourceGateway = __filename.endsWith('.ts');
              const backendVerificationIsFresh = batchDevEditContinuations.length > 0
                && batchDevEditContinuations.every((member) => {
                  const { canReuseFreshBackendVerification } = require('../../dev-verification');
                  return canReuseFreshBackendVerification({
                    verification: member.lastVerification,
                    backendFiles: member.affectedFiles || member.allowedFiles,
                  });
                });
              const reuseVerifiedBackendBuild = runningSourceGateway && backendVerificationIsFresh;
              if (reuseVerifiedBackendBuild) {
                await gracefulRestart(ctx);
                return {
                  name,
                  args,
                  result:
                    `prom_apply_dev_changes succeeded. ` +
                    `${hasWeb ? 'Synced web UI, ' : ''}reused the fresh verified backend build and is restarting the gateway` +
                    `${refreshDesktop ? ', and desktop web UI reload will be requested after reconnect.' : '.'}` +
                    (devEditContinuation ? ` After restart, write_note with tag "${completionNoteTag}" will complete dev edit ${devEditContinuation.id}.` : ''),
                  error: false,
                };
              }

              const buildResult = await buildAndRestart(ctx);
              if (!buildResult.success) {
                if (coordinatedApply?.batch) markCoordinatedDevApplyBatch(coordinatedApply.batch.id, 'failed', buildResult.output);
                return {
                  name,
                  args,
                  result:
                    `prom_apply_dev_changes failed during npm run build (${buildResult.durationMs}ms). Gateway was not restarted.` +
                    (steps.length ? `\n\nCompleted first:\n${steps.map((s) => `- ${s.command}: ok (${s.durationMs}ms)`).join('\n')}` : '') +
                    `\n\n${buildResult.output}`,
                  error: true,
                };
              }
              return {
                name,
                args,
                result:
                  `prom_apply_dev_changes succeeded. ` +
                  `${hasWeb ? 'Synced web UI, ' : ''}build passed (${buildResult.durationMs}ms), gateway is restarting` +
                  `${refreshDesktop ? ', and desktop web UI reload will be requested after reconnect.' : '.'}` +
                  (devEditContinuation ? ` After restart, write_note with tag "${completionNoteTag}" will complete dev edit ${devEditContinuation.id}.` : ''),
                error: false,
              };
            } catch (err: any) {
              return { name, args, result: `prom_apply_dev_changes restart error: ${err.message}`, error: true };
            }
          }

          if (coordinatedApply?.batch) {
            markCoordinatedDevApplyBatch(coordinatedApply.batch.id, 'applied');
            const appliedAt = Date.now();
            for (const member of batchDevEditContinuations) {
              const completionTag = String(member.completionNoteTag || 'dev_edit_complete').trim();
              const completionText =
                `Coordinated dev batch ${coordinatedApply.batch.id} applied successfully without a gateway restart. ` +
                `Dev edit ${member.id} is complete, and the shared web UI is now live.`;
              markDevSourceEditContinuationComplete({
                id: member.id,
                tag: completionTag,
                note: completionText,
              });
              try {
                addMessage(member.sessionId, {
                  role: 'assistant',
                  messageKind: 'restart_status',
                  content: completionText,
                  timestamp: appliedAt,
                  channel: 'system',
                  channelLabel: 'Prom Apply',
                }, {
                  disableCompactionCheck: true,
                  disableMemoryFlushCheck: true,
                });
                flushSession(member.sessionId);
              } catch {}
              try {
                deps.broadcastWS?.({
                  type: 'session_notification',
                  source: 'dev_apply',
                  previousSessionId: member.sessionId,
                  sessionId: member.sessionId,
                  title: 'Coordinated dev changes applied',
                  text: completionText,
                  batchId: coordinatedApply.batch.id,
                  timestamp: appliedAt,
                });
                deps.broadcastWS?.({
                  type: 'dev_edit_coordination_updated',
                  sessionId: member.sessionId,
                  devEditId: member.id,
                  phase: 'complete',
                  role: 'applied',
                  blockers: [],
                  awakened: [],
                  batchId: coordinatedApply.batch.id,
                });
              } catch {}
            }
          }

          if (refreshDesktop) {
            try {
              deps.broadcastWS?.({
                type: 'dev_reload_requested',
                target: 'all',
                source: 'prom_apply_dev_changes',
                reason,
                surfaces: normalizedSurfaces,
                batchId: coordinatedApply?.batch?.id,
                timestamp: Date.now(),
              });
            } catch {}
          }
          return {
            name,
            args,
            result:
              `prom_apply_dev_changes succeeded. ` +
              `${steps.map((s) => `${s.command} ok (${s.durationMs}ms)`).join('; ') || 'No build step required'}` +
              `${refreshDesktop ? '; desktop web UI reload requested.' : '.'}` +
              (coordinatedApply?.batch
                ? ` Coordinated batch ${coordinatedApply.batch.id} completed all ${batchDevEditContinuations.length} member dev edits.`
                : devEditContinuation
                  ? ` Next, call write_note with tag "${completionNoteTag}" to complete dev edit ${devEditContinuation.id}.`
                  : ''),
            data: devEditContinuation ? { dev_edit_id: devEditContinuation.id, completion_note_tag: completionNoteTag } : undefined,
            extra: devEditContinuation ? { dev_edit_id: devEditContinuation.id, completion_note_tag: completionNoteTag } : undefined,
            error: false,
          };
        }

        if (name === 'gateway_restart') {
          const { listLiveRuntimes } = require('../../live-runtime-registry') as typeof import('../../live-runtime-registry');
          const { otherActiveRestartRuntimes, restartDeferredMessage } = require('../../runtime/gateway-restart-guard') as typeof import('../../runtime/gateway-restart-guard');
          const otherTurns = otherActiveRestartRuntimes(listLiveRuntimes(), sessionId);
          if (args.force !== true && otherTurns.length) {
            return { name, args, result: restartDeferredMessage(otherTurns), error: false };
          }
          const reason = String(args.reason || 'manual restart').trim();
          try {
            const { gracefulRestart } = require('../../lifecycle');
            const restartTask = resolveTaskForSession(sessionId);
            const sessionHint = getSessionChannelHint(sessionId);
            const isTelegramSession = String(sessionId || '').startsWith('telegram_') || sessionHint?.channel === 'telegram';
            const resolvedTelegramChatId = Number.isFinite(Number(args.telegram_chat_id))
              ? Number(args.telegram_chat_id)
              : Number.isFinite(Number(sessionHint?.chatId))
                ? Number(sessionHint?.chatId)
                : undefined;
            const resolvedTelegramUserId = Number.isFinite(Number(args.telegram_user_id))
              ? Number(args.telegram_user_id)
              : Number.isFinite(Number(sessionHint?.userId))
                ? Number(sessionHint?.userId)
                : undefined;
            const ctx: import('../../lifecycle').RestartContext = {
              reason: (args.proposal_id ? 'proposal' : args.repair_id ? 'repair' : 'manual') as any,
              timestamp: Date.now(),
              proposalId: args.proposal_id || undefined,
              repairId: args.repair_id || undefined,
              title: args.title || reason,
              summary: args.summary || reason,
              affectedFiles: Array.isArray(args.affected_files) ? args.affected_files : undefined,
              restartScope: resolveGatewayRestartScope({
                affectedFiles: args.affected_files,
                requestedScope: args.restart_scope,
                fullSupervisor: args.full_supervisor,
              }),
              testInstructions: args.test_instructions || undefined,
              previousSessionId: sessionId,
              taskId: restartTask?.id,
              taskOriginatingSessionId: restartTask?.originatingSessionId,
              taskInitiatedTool: restartTask ? 'gateway_restart' : undefined,
              quickRestart: !restartTask
                && !args.proposal_id
                && !args.repair_id
                && (!Array.isArray(args.affected_files) || args.affected_files.length === 0)
                && String(args.restart_scope || '').trim().toLowerCase() !== 'supervisor'
                && args.full_supervisor !== true,
              suppressStandaloneRestartMessage: !!restartTask,
              originChannel: isTelegramSession ? 'telegram' : undefined,
              respondToTelegram: isTelegramSession ? true : undefined,
              previousTelegramChatId: Number.isFinite(resolvedTelegramChatId as number) ? String(resolvedTelegramChatId) : undefined,
              previousTelegramUserId: Number.isFinite(resolvedTelegramUserId as number) ? Number(resolvedTelegramUserId) : undefined,
            };
            // Same quick restart path used by Telegram/mobile/terminal /restart.
            // This is async and will kill the process, so it should remain a final action.
            await gracefulRestart(ctx);
            return {
              name, args,
              result: ctx.forwardedToPid !== undefined
                ? `✅ Gateway restart forwarded to the replacement gateway${ctx.forwardedToPid ? ` (pid=${ctx.forwardedToPid})` : ''}. No npm build was run.`
                : `✅ Quick gateway restart initiated. No npm build was run.`,
              error: false,
            };
          } catch (err: any) {
            return { name, args, result: `gateway_restart error: ${err.message}`, error: true };
          }
        }

        // ── prom_repo_push / prom_repo_pull: git sync of the Prometheus repo ───
        if (name === 'prom_repo_push' || name === 'prom_repo_pull' || name === 'prom_repo_sync') {
          // The async engine is the default. It keeps Git outside the gateway event loop,
          // preserves read-only previews, serializes mutations with a cross-process lock,
          // and verifies the staging snapshot before commit. Keep the former inline engine
          // behind an explicit emergency rollback flag until the new path has soaked.
          if (process.env.PROMETHEUS_LEGACY_REPO_SYNC !== '1') {
            const configDir = (() => {
              try { return getConfig().getConfigDir(); } catch { return path.join(os.homedir(), '.prometheus'); }
            })();
            const outcome = await executePromRepoSyncTool({
              name,
              args,
              repoRoot: path.resolve(__dirname, '..', '..', '..'),
              configDir,
            });
            return { name, args, result: outcome.message, error: !outcome.ok };
          }
          const { execSync } = require('child_process');
          const fsmod = require('fs');
          const osmod = require('os');
          const repoRoot = path.resolve(__dirname, '..', '..', '..');
          const run = (command: string, timeoutMs = 120_000) => {
            const start = Date.now();
            try {
              const output = execSync(command, {
                cwd: repoRoot,
                env: lockFreeGitReadOptions([], process.env).env,
                encoding: 'utf-8',
                timeout: timeoutMs,
                stdio: 'pipe',
                windowsHide: true,
              });
              return { success: true, command, output: String(output || '').trim(), durationMs: Date.now() - start };
            } catch (err: any) {
              const output = [err?.stdout, err?.stderr, err?.message].filter(Boolean).join('\n');
              return { success: false, command, output: String(output || '').trim(), durationMs: Date.now() - start };
            }
          };
          const quoteArg = (value: string): string => {
            const s = String(value);
            return process.platform === 'win32'
              ? `"${s.replace(/"/g, '\\"')}"`
              : `'${s.replace(/'/g, `'\\''`)}'`;
          };
          const normalizeSyncExclude = (raw: string): string => {
            let pattern = String(raw || '').trim().replace(/\\/g, '/');
            pattern = pattern.replace(/^\/+/, '');
            if (!pattern || pattern.startsWith('#')) return '';
            if (pattern.endsWith('/')) return `${pattern}**`;
            return pattern;
          };
          const readSyncExcludes = (): string[] => {
            const defaults = [
              'oss-agents/',
              'workspace/oss agents/',
              'workspace/oss-agents/',
              'workspace/audit/',
              'workspace/downloads/',
              'workspace/uploads/',
              'workspace/video-debug/',
              'workspace/logs/',
              'workspace/temp/',
              'workspace/tmp/',
              'workspace/generated/',
              'workspace/creative-projects/',
              'workspace/videos/',
              'workspace/workspace/',
              'workspace/scratch/',
              'workspace/tool-bench-lab/',
              'workspace/automation-bench-cleanup-*/',
              'workspace/automation-retest-*/',
              'workspace/games/**/build*/',
              'videos/',
              'captures/',
              '**/node_modules/',
              '.prometheus/',
              '.agents/',
              '.claude/',
              '*.log',
              '*.tmp',
              '*.bak',
              '*.mp4',
              '*.mov',
              '*.webm',
            ];
            let configured: string[] = [];
            try {
              const ignoreFile = path.join(repoRoot, '.prom-repo-sync-ignore');
              configured = fsmod.existsSync(ignoreFile)
                ? String(fsmod.readFileSync(ignoreFile, 'utf-8')).split(/\r?\n/)
                : [];
            } catch {}
            return Array.from(new Set([...defaults, ...configured].map(normalizeSyncExclude).filter(Boolean)));
          };
          const findEmbeddedGitRepos = (): string[] => {
            const status = run('git status --porcelain=v1 --untracked-files=normal', 30_000);
            if (!status.success) return [];
            const roots = status.output
              .split(/\r?\n/)
              .map((line: string) => line.match(/^\?\?\s+(.+)$/)?.[1])
              .filter((rel: string | undefined): rel is string => Boolean(rel))
              .map((rel: string) => rel.replace(/^"|"$/g, '').replace(/\\/g, '/').replace(/\/$/, ''));
            const found = new Set<string>();
            const skipNames = new Set(['.git', 'node_modules', 'dist', 'release', 'release-public']);
            const visit = (abs: string, rel: string, depth: number) => {
              if (depth > 6) return;
              let stat: any;
              try { stat = fsmod.statSync(abs); } catch { return; }
              if (!stat.isDirectory()) return;
              if (fsmod.existsSync(path.join(abs, '.git'))) {
                found.add(`${rel.replace(/\\/g, '/')}/**`);
                return;
              }
              let entries: any[] = [];
              try { entries = fsmod.readdirSync(abs, { withFileTypes: true }); } catch { return; }
              for (const entry of entries) {
                if (!entry.isDirectory() || skipNames.has(entry.name)) continue;
                visit(path.join(abs, entry.name), `${rel}/${entry.name}`, depth + 1);
              }
            };
            for (const rel of roots) visit(path.join(repoRoot, rel), rel, 0);
            return Array.from(found);
          };
          const parsePorcelainPaths = (output: string): string[] => {
            const paths = new Set<string>();
            const records = String(output || '').split(String.fromCharCode(0)).filter(Boolean);
            for (let i = 0; i < records.length; i += 1) {
              const record = records[i] || '';
              const match = record.match(/^(.{2}) (.+)$/s);
              if (!match) continue;
              const statusCode = match[1] || '';
              const firstPath = String(match[2] || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/$/, '');
              if (!firstPath) continue;
              paths.add(firstPath);
              if ((statusCode.includes('R') || statusCode.includes('C')) && i + 1 < records.length) {
                const secondPath = String(records[i + 1] || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/$/, '');
                if (secondPath) paths.add(secondPath);
                i += 1;
              }
            }
            return Array.from(paths);
          };
          const isTrackedPath = (relPath: string): boolean => {
            const check = run(`git ls-files --error-unmatch -- ${quoteArg(relPath)}`, 15_000);
            return check.success;
          };
          const isValidGitPathspec = (relPath: string): boolean => {
            if (!relPath || relPath.startsWith('../') || path.isAbsolute(relPath)) return false;
            return fsmod.existsSync(path.join(repoRoot, relPath)) || isTrackedPath(relPath);
          };
          const repairSyncPathspec = (relPath: string): string => {
            const normalized = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/$/, '');
            if (isValidGitPathspec(normalized)) return normalized;
            const likelySrc = `s${normalized}`;
            if (normalized.startsWith('rc/') && isValidGitPathspec(likelySrc)) return likelySrc;
            return '';
          };
          const simpleGlobMatches = (pattern: string, value: string): boolean => {
            const parts = String(pattern || '').split('*');
            if (parts.length === 1) return value === pattern;
            let index = 0;
            if (parts[0] && !value.startsWith(parts[0])) return false;
            index = parts[0]?.length || 0;
            for (let i = 1; i < parts.length; i += 1) {
              const part = parts[i] || '';
              if (!part) continue;
              const found = value.indexOf(part, index);
              if (found < 0) return false;
              index = found + part.length;
            }
            const last = parts[parts.length - 1] || '';
            return !last || value.endsWith(last) || pattern.endsWith('*');
          };
          const syncExcludeMatchesPath = (pattern: string, relPath: string): boolean => {
            const normalizedPattern = String(pattern || '').replace(/\\/g, '/').replace(/^\/+/, '');
            const normalizedPath = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/$/, '');
            if (!normalizedPattern || !normalizedPath) return false;
            if (normalizedPattern.endsWith('/**')) {
              const root = normalizedPattern.slice(0, -3).replace(/\/$/, '');
              return normalizedPath === root || normalizedPath.startsWith(`${root}/`);
            }
            if (!normalizedPattern.includes('/')) {
              return simpleGlobMatches(normalizedPattern, path.posix.basename(normalizedPath));
            }
            return simpleGlobMatches(normalizedPattern, normalizedPath);
          };
          const getSyncExcludedDirtyPaths = (excludes: string[]): string[] => {
            const status = run('git status --porcelain=v1 -z --untracked-files=normal', 30_000);
            if (!status.success) return [];
            return Array.from(new Set(parsePorcelainPaths(status.output)
              .map((relPath) => repairSyncPathspec(relPath) || relPath)
              .filter((relPath) => excludes.some((pattern) => syncExcludeMatchesPath(pattern, relPath)))));
          };
          const stashSyncExcludedDirtyPaths = (excludes: string[]) => {
            const paths = getSyncExcludedDirtyPaths(excludes);
            if (!paths.length) {
              return { success: true, didStash: false, paths, output: '', restore: () => ({ success: true, output: '' }) };
            }
            const message = `prom_repo_sync excluded local changes ${Date.now()}`;
            const stash = run(`git stash push -u -m ${quoteArg(message)} -- ${paths.map(quoteArg).join(' ')}`, 60_000);
            return {
              success: stash.success,
              didStash: stash.success,
              paths,
              output: stash.output,
              restore: () => stash.success ? run('git stash pop --index stash@{0}', 60_000) : ({ success: true, output: '' }),
            };
          };
          // File-glob (no-slash) exclude patterns like *.log/*.tmp/*.mp4. Directory patterns
          // (workspace/oss agents/, .claude/, …) are intentionally NOT included here — we only
          // auto-untrack disposable per-file noise, never whole tracked trees.
          const fileGlobExcludes = (excludes: string[]): string[] =>
            excludes.filter((p) => p && !p.includes('/') && !p.endsWith('/**'));
          // Root cause of recurring sync conflicts: files matching the exclude list (e.g. *.log,
          // *.mp4) were committed BEFORE the exclude list existed, so they keep diverging through
          // history on both machines and conflict on every merge. Excluding them from *staging*
          // does nothing once they are tracked. This untracks them (git rm --cached, keeps the
          // working copy) so the removal propagates and they stop being synced for good.
          const untrackSyncExcludedTrackedFiles = (excludes: string[]) => {
            const globs = fileGlobExcludes(excludes);
            if (!globs.length) return { removed: [] as string[], output: '' };
            const listed = run('git ls-files -z', 30_000);
            if (!listed.success) return { removed: [] as string[], output: listed.output };
            const tracked = String(listed.output || '').split(String.fromCharCode(0)).filter(Boolean)
              .map((p) => p.replace(/\\/g, '/'));
            const toUntrack = tracked.filter((rel) => globs.some((pat) => syncExcludeMatchesPath(pat, rel)));
            if (!toUntrack.length) return { removed: [] as string[], output: '' };
            let combined = '';
            for (let i = 0; i < toUntrack.length; i += 80) {
              const batch = toUntrack.slice(i, i + 80);
              const rm = run(`git rm --cached --ignore-unmatch -- ${batch.map(quoteArg).join(' ')}`, 60_000);
              if (rm.output) combined += `${combined ? '\n' : ''}${rm.output}`;
              if (!rm.success) return { removed: toUntrack.slice(0, i), output: combined };
            }
            // Keep them ignored so other workflows (manual git add -A) don't re-track them.
            try {
              const giPath = path.join(repoRoot, '.gitignore');
              const existing = fsmod.existsSync(giPath) ? String(fsmod.readFileSync(giPath, 'utf-8')) : '';
              const lines = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
              const missing = globs.filter((g) => !lines.has(g));
              if (missing.length) {
                const block = `${existing.endsWith('\n') || !existing ? '' : '\n'}# prom_repo_sync: auto-ignored exclude-matched noise\n${missing.join('\n')}\n`;
                fsmod.appendFileSync(giPath, block, 'utf-8');
                run('git add -- .gitignore', 15_000);
              }
            } catch {}
            return { removed: toUntrack, output: combined };
          };
          // When a pull/merge conflicts only on exclude-matched noise files (the other machine
          // still tracked a *.log we just untracked → modify/delete; or both appended to a log),
          // resolve them by removing the file rather than aborting the whole sync.
          const autoResolveExcludedConflicts = (excludes: string[]): string[] => {
            const globs = fileGlobExcludes(excludes);
            if (!globs.length) return [];
            const unmerged = (run('git diff --name-only --diff-filter=U -z', 30_000).output || '')
              .split(String.fromCharCode(0)).filter(Boolean).map((p) => p.replace(/\\/g, '/'));
            const resolvable = unmerged.filter((rel) => globs.some((pat) => syncExcludeMatchesPath(pat, rel)));
            if (!resolvable.length) return [];
            for (let i = 0; i < resolvable.length; i += 80) {
              run(`git rm -f --ignore-unmatch -- ${resolvable.slice(i, i + 80).map(quoteArg).join(' ')}`, 60_000);
            }
            return resolvable;
          };
          const stageSyncEligibleChanges = () => {
            const excludes = Array.from(new Set([...readSyncExcludes(), ...findEmbeddedGitRepos()]));
            const status = run('git status --porcelain=v1 -z --untracked-files=normal', 30_000);
            if (!status.success) return { add: status, excludes };
            const skippedInvalid: string[] = [];
            const eligiblePaths = Array.from(new Set(parsePorcelainPaths(status.output)
              .map((relPath) => {
                const repaired = repairSyncPathspec(relPath);
                if (!repaired) skippedInvalid.push(relPath);
                return repaired;
              })
              .filter(Boolean)))
              .filter((relPath) => !excludes.some((pattern) => syncExcludeMatchesPath(pattern, relPath)));
            if (!eligiblePaths.length) {
              return {
                add: {
                  success: true,
                  command: 'git add -A -- <no sync-eligible changes>',
                  output: skippedInvalid.length ? `Skipped invalid git pathspecs:\n${skippedInvalid.join('\n')}` : '',
                  durationMs: 0,
                },
                excludes,
              };
            }
            let combinedOutput = '';
            let totalDurationMs = 0;
            for (let i = 0; i < eligiblePaths.length; i += 80) {
              const batch = eligiblePaths.slice(i, i + 80);
              const command = `git add -A -- ${batch.map(quoteArg).join(' ')}`;
              const add = run(command, 60_000);
              totalDurationMs += add.durationMs;
              if (add.output) combinedOutput += `${combinedOutput ? '\n' : ''}${add.output}`;
              if (!add.success) {
                return {
                  add: {
                    ...add,
                    output: combinedOutput || add.output,
                    durationMs: totalDurationMs,
                  },
                  excludes,
                };
              }
            }
            return {
              add: {
                success: true,
                command: `git add -A -- <${eligiblePaths.length} sync-eligible path${eligiblePaths.length === 1 ? '' : 's'}>`,
                output: [
                  combinedOutput.trim(),
                  skippedInvalid.length ? `Skipped invalid git pathspecs:\n${skippedInvalid.join('\n')}` : '',
                ].filter(Boolean).join('\n'),
                durationMs: totalDurationMs,
              },
              excludes,
            };
          };

          // Resolve the local PAT store (config dir, never the repo).
          let configDir = path.join(osmod.homedir(), '.prometheus');
          try { configDir = require('../../../config/config').getConfig().getConfigDir() || configDir; } catch {}
          const patFile = path.join(configDir, 'github-pat');
          const readSavedPat = (): string => {
            try { return fsmod.existsSync(patFile) ? String(fsmod.readFileSync(patFile, 'utf-8')).trim() : ''; } catch { return ''; }
          };

          // Optionally persist a PAT handed over by the user, then use it immediately.
          let patSaveNote = '';
          const incomingPat = String(args?.set_pat || args?.pat || '').trim();
          if (incomingPat) {
            try {
              if (!fsmod.existsSync(configDir)) fsmod.mkdirSync(configDir, { recursive: true });
              fsmod.writeFileSync(patFile, incomingPat, 'utf-8');
              try { fsmod.chmodSync(patFile, 0o600); } catch {}
              patSaveNote = `Saved GitHub PAT to ${patFile} (local only, not committed).`;
            } catch (err: any) {
              return { name, args, result: `Failed to save PAT to ${patFile}: ${err?.message || err}`, error: true };
            }
          }

          // Resolve current branch
          const branchRes = run('git rev-parse --abbrev-ref HEAD', 15_000);
          if (!branchRes.success) {
            return { name, args, result: `${name} failed to resolve the current branch:\n${branchRes.output || '(no output)'}`, error: true };
          }
          const branch = (branchRes.output.split(/\r?\n/).pop() || 'main').trim() || 'main';

          // PAT resolution order: env → freshly-handed → saved file.
          const pat = String(process.env.GITHUB_PAT || process.env.GITHUB_TOKEN || incomingPat || readSavedPat() || '').trim();
          const remoteRes = run('git remote get-url origin', 15_000);
          const remoteUrl = remoteRes.success ? (remoteRes.output.split(/\r?\n/)[0] || '').trim() : '';
          let authRemote = '';
          if (pat && /^https:\/\/([^@/]*@)?github\.com\//i.test(remoteUrl)) {
            // PAT is only passed inline to pull/push — never persisted into the git remote via set-url.
            authRemote = remoteUrl.replace(/^https:\/\/([^@/]*@)?github\.com\//i, `https://x-access-token:${pat}@github.com/`);
          }
          const remoteArg = authRemote ? `"${authRemote}"` : 'origin';
          const sanitize = (s: string) => (pat ? String(s || '').split(pat).join('***') : String(s || ''));

          // Detect auth failures so we can ask the user for a PAT instead of returning a raw error.
          const isAuthFailure = (out: string): boolean =>
            /(authentication failed|could not read username|could not read password|terminal prompts disabled|invalid username or password|permission denied|fatal: could not read|remote: (invalid|permission|repository not found)|403 forbidden|401 unauthorized|support for password authentication was removed)/i.test(String(out || ''));
          const patHelp = (action: string): string => {
            const saveTool = name === 'prom_repo_pull' ? 'prom_repo_push' : name;
            return [
            `⚠️ ACTION REQUIRED — git ${action} failed because this machine has no working GitHub credentials and no PAT is saved.`,
            '',
            'Do this:',
            `1. Ask the user for a GitHub Personal Access Token (PAT) with "repo" scope (a classic token like ghp_… or a fine-grained token with read/write contents on XposeMarket/PromSRC).`,
            `2. Once they hand it to you, call ${saveTool} again with set_pat:"<the token>" ${action === 'push' ? '(plus the commit message if you have one)' : '— this saves it'}. It is stored locally at ${patFile} (NOT committed to the repo) and reused automatically afterward.`,
            `3. Then retry the ${action}. No gateway restart is needed — the PAT is read live from disk on each call.`,
            ].join('\n');
          };

          const prefix = patSaveNote ? patSaveNote + '\n\n' : '';

          if (name === 'prom_repo_pull') {
            const pull = run(`git pull ${remoteArg} ${branch} --no-edit`, 180_000);
            if (!pull.success && isAuthFailure(pull.output)) {
              return { name, args, result: `${prefix}${patHelp('pull')}\n\nGit output:\n${sanitize(pull.output) || '(no output)'}`, error: true };
            }
            if (!pull.success) {
              const conflicts = (run('git diff --name-only --diff-filter=U', 30_000).output || '').trim();
              if (conflicts) {
                run('git merge --abort', 30_000);
                return {
                  name,
                  args,
                  result:
                    `${prefix}❌ prom_repo_pull hit merge conflicts in:\n${conflicts}\n\n` +
                    'Merge was aborted — your working tree is unchanged. These files were changed on BOTH machines in overlapping lines. ' +
                    'Resolve by editing them on one machine only, or commit your local work and use prom_repo_sync to merge deliberately.\n\n' +
                    `${sanitize(pull.output) || '(no output)'}`,
                  error: true,
                };
              }
              if (/local changes|overwritten|commit your changes|stash/i.test(pull.output)) {
                return {
                  name,
                  args,
                  result:
                    `${prefix}❌ prom_repo_pull blocked: you have uncommitted local changes that overlap incoming changes. ` +
                    'Use prom_repo_sync — it commits your changes and merges in one safe step.\n\n' +
                    `${sanitize(pull.output) || '(no output)'}`,
                  error: true,
                };
              }
              return { name, args, result: `${prefix}❌ prom_repo_pull failed:\n${sanitize(pull.output) || '(no output)'}`, error: true };
            }
            return {
              name,
              args,
              result:
                `${prefix}✅ prom_repo_pull (${branch}) succeeded (${pull.durationMs}ms).\n\n` +
                `${sanitize(pull.output) || '(no output)'}`,
              error: false,
            };
          }

          // prom_repo_push/sync — stage eligible files first so the diff/auto-message reflects safe untracked files too.
          const { add, excludes: syncExcludes } = stageSyncEligibleChanges();
          if (!add.success) {
            return {
              name,
              args,
              result:
                `${name} failed while staging sync-eligible changes:\n${sanitize(add.output) || '(no output)'}\n\n` +
                `Active sync excludes included:\n${syncExcludes.slice(0, 40).join('\n') || '(none)'}`,
              error: true,
            };
          }

          // Untrack any tracked files matching the file-glob excludes (*.log/*.mp4/…) so the
          // exclude list actually takes effect instead of silently failing. git rm --cached stages
          // the removal (working copies kept), which the commit below then records and propagates.
          const untrackRes = untrackSyncExcludedTrackedFiles(syncExcludes);
          const untrackNote = untrackRes.removed.length
            ? `Untracked ${untrackRes.removed.length} exclude-matched file${untrackRes.removed.length === 1 ? '' : 's'} (kept on disk, now ignored):\n${untrackRes.removed.slice(0, 40).join('\n')}${untrackRes.removed.length > 40 ? `\n… +${untrackRes.removed.length - 40} more` : ''}`
            : '';

          // git diff --cached --quiet exits 0 (success) when there is nothing staged.
          const stagedCheck = run('git diff --cached --quiet', 30_000);
          const hasStaged = !stagedCheck.success;
          const message = String(args?.message || args?.commit_message || '').trim();
          const retryTool = name === 'prom_repo_sync' ? 'prom_repo_sync' : 'prom_repo_push';

          // No explicit message but there ARE staged changes → return the diff so the model can author a real message.
          if (hasStaged && !message) {
            const stat = run('git diff --cached --stat', 30_000);
            const nameStatus = run('git diff --cached --name-status', 30_000);
            const fullDiff = run('git diff --cached --no-color', 60_000);
            const cappedDiff = (() => {
              const d = fullDiff.output || '';
              return d.length > 9000 ? d.slice(0, 9000) + '\n… [diff truncated]' : d;
            })();
            return {
              name,
              args,
              result: [
                `${patSaveNote ? patSaveNote + '\n\n' : ''}📋 No commit message provided. Staged sync-eligible changes — here is what changed. Read it, then call ${retryTool} AGAIN with a concise, accurate message that reflects these specific changes (e.g. "Fix: …", "Features added: …; Bug fixes: …"). Do not use a generic placeholder.`,
                name === 'prom_repo_sync'
                  ? 'Keep using prom_repo_sync for the second call so the no-edit merge + push still happens. Do not switch to prom_repo_push or ad hoc run_command git commands for this sync.'
                  : 'Keep using prom_repo_push for the second call. Do not switch to ad hoc run_command git commands for this push.',
                `Sync excludes applied from .gitignore/.prom-repo-sync-ignore plus embedded repo detection (${syncExcludes.length} patterns).`,
                '',
                '── Files changed (name-status) ──',
                nameStatus.output || '(none)',
                '',
                '── Stat ──',
                stat.output || '(none)',
                '',
                '── Diff ──',
                cappedDiff || '(empty)',
              ].join('\n'),
              error: false,
            };
          }

          let committed = false;
          let commitOut = '';
          if (hasStaged) {
            const tmp = path.join(osmod.tmpdir(), `prom-commit-${Date.now()}.txt`);
            fsmod.writeFileSync(tmp, message, 'utf-8');
            const commit = run(`git commit -F "${tmp}"`, 60_000);
            try { fsmod.unlinkSync(tmp); } catch {}
            commitOut = sanitize(commit.output);
            if (!commit.success) {
              return { name, args, result: `prom_repo_push failed during git commit:\n${commitOut || '(no output)'}`, error: true };
            }
            committed = true;
          }

          // ── prom_repo_sync: commit (done above) → pull/merge → push ──────────
          if (name === 'prom_repo_sync') {
            const beforeMerge = (run('git rev-parse HEAD', 15_000).output || '').trim();
            const excludedStash = stashSyncExcludedDirtyPaths(syncExcludes);
            if (!excludedStash.success) {
              return {
                name,
                args,
                result:
                  `${prefix}❌ prom_repo_sync could not temporarily stash sync-excluded local changes before pull:\n` +
                  `${excludedStash.paths.join('\n') || '(none)'}\n\n` +
                  `${sanitize(excludedStash.output) || '(no output)'}`,
                error: true,
              };
            }
            let autoResolvedNote = '';
            const pull = run(`git pull ${remoteArg} ${branch} --no-edit`, 180_000);
            const commitSafeNote = committed
              ? `Your local commit "${message.split(/\r?\n/)[0]}" is safe locally; nothing was pushed.\n\n`
              : '';
            if (!pull.success) {
              if (isAuthFailure(pull.output)) {
                const restore = excludedStash.restore();
                return {
                  name,
                  args,
                  result:
                    `${prefix}${commitSafeNote}${patHelp('pull')}\n\nGit output:\n${sanitize(pull.output) || '(no output)'}\n\n` +
                    `${excludedStash.didStash ? `Restored sync-excluded local changes after failed pull: ${restore.success ? 'yes' : 'no'}\n${sanitize(restore.output) || ''}` : ''}`,
                  error: true,
                };
              }
              const conflicts = (run('git diff --name-only --diff-filter=U', 30_000).output || '').trim();
              if (conflicts) {
                // Auto-resolve conflicts that are only on exclude-matched noise files (logs, media,
                // or a file we just untracked vs the other machine still tracking it). Removing them
                // clears the conflict so a real diverged source file isn't held hostage by log churn.
                const autoRemoved = autoResolveExcludedConflicts(syncExcludes);
                const conflictsLeft = (run('git diff --name-only --diff-filter=U', 30_000).output || '').trim();
                if (autoRemoved.length && !conflictsLeft) {
                  const finish = run('git commit --no-edit', 60_000);
                  if (finish.success) {
                    autoResolvedNote = `Auto-resolved excluded-file merge conflicts by untracking: ${autoRemoved.slice(0, 40).join(', ')}${autoRemoved.length > 40 ? `, … +${autoRemoved.length - 40} more` : ''}`;
                    // Fall through to the push step below — the merge is now complete.
                  } else {
                    run('git merge --abort', 30_000);
                    const restore = excludedStash.restore();
                    return {
                      name,
                      args,
                      result:
                        `${prefix}❌ prom_repo_sync: could not finalize merge after auto-resolving excluded files:\n${sanitize(finish.output) || '(no output)'}\n\n` +
                        `${commitSafeNote}${excludedStash.didStash ? `Restored sync-excluded local changes: ${restore.success ? 'yes' : 'no'}\n${sanitize(restore.output) || ''}` : ''}`,
                      error: true,
                    };
                  }
                } else {
                  run('git merge --abort', 30_000);
                  const restore = excludedStash.restore();
                  return {
                    name,
                    args,
                    result:
                      `${prefix}❌ prom_repo_sync: merge conflict — these files were changed on BOTH machines in overlapping lines:\n${conflictsLeft || conflicts}\n\n` +
                      `Merge aborted. ${commitSafeNote}` +
                      'Resolve manually: open those files, keep the intended combined content, then run prom_repo_sync again. ' +
                      '(Editing a given file on only one machine at a time avoids this entirely.)\n\n' +
                      `${sanitize(pull.output) || '(no output)'}\n\n` +
                      `${excludedStash.didStash ? `Restored sync-excluded local changes after aborted merge: ${restore.success ? 'yes' : 'no'}\n${sanitize(restore.output) || ''}` : ''}`,
                    error: true,
                  };
                }
              }
              const restore = excludedStash.restore();
              return {
                name,
                args,
                result:
                  `${prefix}❌ prom_repo_sync: pull/merge failed.\n${commitSafeNote}${sanitize(pull.output) || '(no output)'}\n\n` +
                  `${excludedStash.didStash ? `Restored sync-excluded local changes after failed pull: ${restore.success ? 'yes' : 'no'}\n${sanitize(restore.output) || ''}` : ''}`,
                error: true,
              };
            }

            // Push the merged result; retry once if origin advanced between our pull and push.
            let push = run(`git push ${remoteArg} ${branch}`, 180_000);
            if (!push.success && !isAuthFailure(push.output) && /non-fast-forward|fetch first|\[rejected\]|tip of your current branch is behind|updates were rejected/i.test(push.output)) {
              const pull2 = run(`git pull ${remoteArg} ${branch} --no-edit`, 180_000);
              if (pull2.success) {
                push = run(`git push ${remoteArg} ${branch}`, 180_000);
              } else {
                const conflicts2 = (run('git diff --name-only --diff-filter=U', 30_000).output || '').trim();
                if (conflicts2) run('git merge --abort', 30_000);
              }
            }
            if (!push.success && isAuthFailure(push.output)) {
              const restore = excludedStash.restore();
              return {
                name,
                args,
                result:
                  `${prefix}(Merge succeeded locally; your work is committed and safe.)\n\n${patHelp('push')}\n\nGit output:\n${sanitize(push.output) || '(no output)'}\n\n` +
                  `${excludedStash.didStash ? `Restored sync-excluded local changes after failed push: ${restore.success ? 'yes' : 'no'}\n${sanitize(restore.output) || ''}` : ''}`,
                error: true,
              };
            }

            const mergedIn = beforeMerge ? (run(`git diff --name-only ${beforeMerge} HEAD`, 30_000).output || '').trim() : '';
            const lines: string[] = [];
            let restoreFailed = false;
            if (patSaveNote) { lines.push(patSaveNote); lines.push(''); }
            lines.push(committed ? `Committed locally: ${message.split(/\r?\n/)[0]}` : 'No local changes to commit.');
            if (untrackNote) { lines.push(''); lines.push(untrackNote); }
            if (autoResolvedNote) { lines.push(''); lines.push(autoResolvedNote); }
            lines.push('');
            lines.push(mergedIn ? `Merged in from origin/${branch} (no overwrite):\n${mergedIn}` : `Nothing new on origin/${branch} to merge.`);
            lines.push('');
            lines.push(`${push.success ? '✅' : '❌'} push to origin/${branch} ${push.success ? 'succeeded' : 'failed'} (${push.durationMs}ms).`);
            lines.push(sanitize(push.output) || '(no output)');
            if (excludedStash.didStash) {
              const restore = excludedStash.restore();
              lines.push('');
              lines.push(`Temporarily stashed sync-excluded local changes before pull:\n${excludedStash.paths.join('\n')}`);
              lines.push(`Restore after sync: ${restore.success ? 'succeeded' : 'failed'}.`);
              if (restore.output) lines.push(sanitize(restore.output));
              if (!restore.success) {
                restoreFailed = true;
                lines.push('Your sync-excluded changes remain in the latest git stash; recover with git stash list / git stash pop after resolving the message above.');
              }
            }
            if (push.success) {
              lines.push('');
              lines.push(`Done — local and origin/${branch} now hold the combined history. Run prom_repo_sync (or prom_repo_pull) on the OTHER machine to bring these changes down there too.`);
            }
            return { name, args, result: lines.join('\n'), error: !push.success || restoreFailed };
          }

          const push = run(`git push ${remoteArg} ${branch}`, 180_000);
          if (!push.success && !isAuthFailure(push.output) && /non-fast-forward|fetch first|\[rejected\]|tip of your current branch is behind|updates were rejected/i.test(push.output)) {
            return {
              name,
              args,
              result:
                `${prefix}❌ prom_repo_push rejected: origin/${branch} has commits you don't have locally (likely pushed from the other machine). ` +
                'Git blocked the push so nothing gets overwritten. Use prom_repo_sync instead — it merges those in and pushes the combined result safely.\n\n' +
                `${sanitize(push.output) || '(no output)'}`,
              error: true,
            };
          }
          if (!push.success && isAuthFailure(push.output)) {
            return {
              name,
              args,
              result:
                `${patSaveNote ? patSaveNote + '\n\n' : ''}` +
                `${committed ? `(Local commit "${message.split(/\r?\n/)[0]}" was created and is waiting to be pushed.)\n\n` : ''}` +
                `${patHelp('push')}\n\nGit output:\n${sanitize(push.output) || '(no output)'}`,
              error: true,
            };
          }
          const lines: string[] = [];
          if (patSaveNote) { lines.push(patSaveNote); lines.push(''); }
          lines.push(
            committed
              ? `Committed: ${message.split(/\r?\n/)[0]}`
              : 'No local changes to commit — pushing any unpushed commits.',
          );
          if (commitOut) lines.push(commitOut);
          if (untrackNote) { lines.push(''); lines.push(untrackNote); }
          lines.push('');
          lines.push(`${push.success ? '✅' : '❌'} push to origin/${branch} ${push.success ? 'succeeded' : 'failed'} (${push.durationMs}ms).`);
          lines.push(sanitize(push.output) || '(no output)');
          if (!pat) {
            lines.push('');
            lines.push('Note: no PAT in use — relied on the OS git credential helper.');
          }
          return { name, args, result: lines.join('\n'), error: !push.success };
        }

        // ── connector_list: always-available connector discovery ──────────────
        if (name === 'connector_list') {
          return { name, args, result: buildConnectorStatus(), error: false };
        }

        if (name === 'tool_result_read') {
          try {
            const range = await readRawToolResultRange({
              rawRef: String(args?.raw_ref || args?.rawRef || ''),
              sessionId,
              offsetBytes: args?.offset_bytes ?? args?.offsetBytes,
              maxChars: args?.max_chars ?? args?.maxChars,
              workspacePath,
            });
            return { name, args, result: JSON.stringify(range, null, 2), error: false };
          } catch (error: any) {
            return { name, args, result: `tool_result_read failed: ${String(error?.message || error)}`, error: true };
          }
        }

        // ── connector_* tools: dispatch to connector handlers ─────────────
        if (name.startsWith('connector_') && name !== 'connector_list') {
          ensurePrometheusExtensionRuntimeLoaded();
          const extensionRegistry = getExtensionRuntimeRegistry();
          if (!extensionRegistry.isToolAvailable(name)) {
            return { name, args, result: `Connector tool "${name}" is not available for a connected extension. Connect or enable the connector before use.`, error: true };
          }
          const connResult = await extensionRegistry.executeTool(name, args);
          return { name, args, ...connResult };
        }

        // Extension tools that are not connector-prefixed, such as x_search and
        // xai_live_search, are advertised by the runtime registry and should
        // execute through the same extension boundary.
        ensurePrometheusExtensionRuntimeLoaded();
        const extensionRegistry = getExtensionRuntimeRegistry();
        if (extensionRegistry.getTool(name)) {
          if (!extensionRegistry.isToolAvailable(name)) {
            return { name, args, result: `Extension tool "${name}" is not available for a connected extension. Connect or enable the connector before use.`, error: true };
          }
          const extensionResult = await extensionRegistry.executeTool(name, args);
          return { name, args, ...extensionResult };
        }

        if (name === 'ask_prometheus_questions' || name === 'await_prometheus_question_response' || name === 'request_browser_login') {
          const questionQueue = getPrometheusQuestionQueue();
          const activeTask = resolveTaskForSession(sessionId);
          const activeTaskId = String(activeTask?.id || '').trim() || undefined;

          if (name === 'await_prometheus_question_response') {
            const questionId = String(args?.question_id || args?.questionId || '').trim();
            if (!questionId) {
              return { name, args, result: 'await_prometheus_question_response requires question_id.', error: true };
            }
            const existing = questionQueue.get(questionId);
            if (!existing) {
              return { name, args, result: `Prometheus question ${questionId} not found.`, error: true };
            }
            if (existing.sessionId !== sessionId) {
              return { name, args, result: 'Cannot await a Prometheus question from a different session.', error: true };
            }
            if (existing.status !== 'pending') {
              if (existing.status === 'answered') {
                return {
                  name,
                  args,
                  result: `Prometheus question ${questionId} was already answered.\n${JSON.stringify({ answers: existing.answers || [], generalOther: existing.generalOther || '' }, null, 2)}`,
                  data: { question_id: questionId, answers: existing.answers || [], generalOther: existing.generalOther || '' },
                  error: false,
                };
              }
              return { name, args, result: `Prometheus question ${questionId} is ${existing.status}.`, error: true };
            }

            let abortListener: (() => void) | undefined;
            const questionAbortSignal: any = deps.abortSignal?.signal;
            const waitResult = await new Promise<{ answers: PrometheusQuestionAnswer[]; generalOther?: string } | { steerInterrupt: string } | { cancelled: true }>((resolve) => {
              let settled = false;
              const safeResolve = (value: { answers: PrometheusQuestionAnswer[]; generalOther?: string } | { steerInterrupt: string } | { cancelled: true }) => {
                if (settled) return;
                settled = true;
                questionQueue.clearSteerCallback(questionId);
                resolve(value);
              };
              questionQueue.onResolve(questionId, (answerPayload) => safeResolve(answerPayload));
              questionQueue.onCancel(questionId, () => safeResolve({ cancelled: true }));
              questionQueue.onSteer(questionId, (steerMessage) => safeResolve({ steerInterrupt: steerMessage }));
              abortListener = () => {
                // Keep the durable card pending so a later answer can use the
                // restart-resume path, but detach this dead turn's callbacks.
                questionQueue.clearWaiters(questionId);
                safeResolve({ cancelled: true });
              };
              if (questionAbortSignal?.aborted) abortListener();
              else questionAbortSignal?.addEventListener?.('abort', abortListener, { once: true });
            });
            if (abortListener) questionAbortSignal?.removeEventListener?.('abort', abortListener);

            if ('cancelled' in waitResult) {
              return { name, args, result: `Prometheus question ${questionId} was cancelled by the user.`, error: true };
            }

            if ('steerInterrupt' in waitResult) {
              try {
                deps.broadcastWS({ type: 'question_steer_interrupt', sessionId, questionId, steerMessage: waitResult.steerInterrupt.slice(0, 500) });
              } catch {}
              return {
                name,
                args,
                result:
                  `[STEER RECEIVED WHILE WAITING FOR PROMETHEUS QUESTION]\n` +
                  `Steer message: "${waitResult.steerInterrupt}"\n\n` +
                  `Question ${questionId} is still pending. Address the steer, then call await_prometheus_question_response(question_id: "${questionId}") to resume waiting.`,
                error: false,
              };
            }

            return {
              name,
              args,
              result: `Prometheus question ${questionId} answered.\n${JSON.stringify(waitResult, null, 2)}`,
              data: { question_id: questionId, ...waitResult },
              error: false,
            };
          }

          let payload;
          try {
            const origin = inferApprovalOrigin(sessionId, activeTask, args);
            const isLoginHandoff = name === 'request_browser_login';
            const loginSite = String(args?.site || '').trim() || 'this site';
            const loginReason = String(args?.reason || '').trim();
            payload = createPrometheusQuestionPayload({
              sessionId,
              taskId: activeTaskId,
              agentId: inferAgentIdFromSession(sessionId, args),
              originType: origin.originType === 'proposal' ? 'unknown' : origin.originType,
              originLabel: origin.originLabel,
              questions: isLoginHandoff
                ? [{
                    id: 'login',
                    label: `Log in to ${loginSite} in the browser so I can continue.${loginReason ? ` ${loginReason}` : ''}`,
                    mode: 'single_select',
                    options: ["I'm logged in", 'Skip'],
                    allowOther: false,
                  }]
                : args?.questions,
              ttlMs: args?.ttl_ms || args?.ttlMs,
              loginHandoff: isLoginHandoff
                ? { site: loginSite, url: String(args?.url || '').trim(), reason: loginReason, browserSessionId: sessionId }
                : undefined,
            });
          } catch (err: any) {
            return { name, args, result: `ask_prometheus_questions error: ${err.message || err}`, error: true };
          }

          if (activeTaskId) {
            updateTaskStatus(activeTaskId, 'needs_assistance', { pauseReason: 'awaiting_prometheus_question_response' });
            appendJournal(activeTaskId, {
              type: 'pause',
              content: `Waiting for Prometheus question response: ${payload.title.slice(0, 220)}`,
            });
          }

          const question = questionQueue.create(payload);
          // Register the suspension before broadcasting the card or awaiting
          // Telegram delivery. A fast web answer during that delivery gap
          // otherwise sees no waiter and queues a second chat resume even
          // though this tool invocation is still alive.
          let abortListener: (() => void) | undefined;
          const questionAbortSignal: any = deps.abortSignal?.signal;
          const waitForAnswer = new Promise<{ answers: PrometheusQuestionAnswer[]; generalOther?: string } | { cancelled: true }>((resolve) => {
            let settled = false;
            const safeResolve = (value: { answers: PrometheusQuestionAnswer[]; generalOther?: string } | { cancelled: true }) => {
              if (settled) return;
              settled = true;
              resolve(value);
            };
            questionQueue.onResolve(question.id, (answerPayload) => safeResolve(answerPayload));
            questionQueue.onCancel(question.id, () => safeResolve({ cancelled: true }));
            abortListener = () => {
              // The card is durable. Only this turn's in-process waiter is
              // removed, so an answer after restart can produce resumePrompt.
              questionQueue.clearWaiters(question.id);
              safeResolve({ cancelled: true });
            };
            if (questionAbortSignal?.aborted) abortListener();
            else questionAbortSignal?.addEventListener?.('abort', abortListener, { once: true });
          });
          try {
            appendAuditEntry({
              timestamp: new Date().toISOString(),
              sessionId,
              agentId: inferAgentIdFromSession(sessionId, args),
              actionType: 'tool_executed' as any,
              toolName: name,
              toolArgs: { question_id: question.id, questions: question.questions },
              policyTier: 'propose',
              approvalStatus: 'auto_allowed' as any,
              resultSummary: `Queued Prometheus question ${question.id}`,
            });
          } catch {}

          try {
            deps.broadcastWS({
              type: 'question_created',
              sessionId,
              taskId: activeTaskId,
              questionId: question.id,
              summary: question.prompt,
              question: serializePrometheusQuestionForClient(question),
            });
            if (activeTaskId) {
              deps.broadcastWS({
                type: 'task_needs_assistance',
                taskId: activeTaskId,
                title: activeTask?.title,
                reason: 'Prometheus question response required',
                detail: question.prompt,
              });
              deps.broadcastWS({ type: 'task_panel_update', taskId: activeTaskId });
            }
          } catch {}

          try {
            if (deps.telegramChannel?.sendPrometheusQuestion) {
              await deps.telegramChannel.sendPrometheusQuestion(question);
            }
          } catch (err: any) {
            console.warn('[prometheus_questions] Could not send Telegram question:', err?.message || err);
          }

          // This is a hard suspension point, like an approval card. Do not return
          // a normal tool result while the question is pending: doing so lets the
          // model continue the tool loop and emit a follow-up assistant message.
          // The record remains durable, so after a gateway restart the submit
          // endpoint can still resume a question that no longer has this waiter.
          const waitResult = await waitForAnswer;
          if (abortListener) questionAbortSignal?.removeEventListener?.('abort', abortListener);

          const wasCancelled = 'cancelled' in waitResult;
          if (activeTaskId) {
            updateTaskStatus(activeTaskId, 'running', { pauseReason: undefined });
            appendJournal(activeTaskId, {
              type: wasCancelled ? 'status_push' : 'resume',
              content: wasCancelled
                ? `Prometheus question cancelled: ${question.title.slice(0, 220)}`
                : `Prometheus question answered: ${question.title.slice(0, 220)}`,
            });
            try {
              deps.broadcastWS({ type: 'task_running', taskId: activeTaskId, title: activeTask?.title });
              deps.broadcastWS({ type: 'task_panel_update', taskId: activeTaskId });
            } catch {}
          }

          if (wasCancelled) {
            return {
              name,
              args,
              result: `Prometheus question ${question.id} was cancelled by the user.`,
              data: { question_id: question.id, status: 'cancelled' },
              error: true,
            };
          }

          return {
            name,
            args,
            result:
              `Prometheus question ${question.id} answered.\n${JSON.stringify(waitResult, null, 2)}`,
            data: { question_id: question.id, status: 'answered', ...waitResult },
            error: false,
          };
        }

        if (name === 'request_final_action_approval') {
          const scope = createFinalActionApprovalScope({
            actionKind: args?.action_kind || args?.actionKind,
            targetLabel: args?.target_label || args?.targetLabel || args?.button_label || args?.buttonLabel,
            summary: args?.summary || args?.reason,
            surface: args?.surface || args?.app || args?.site,
            nextToolName: args?.next_tool_name || args?.nextToolName,
            nextToolArgs: args?.next_tool_args || args?.nextToolArgs,
            screenshotId: args?.screenshot_id || args?.screenshotId,
            ttlMs: args?.ttl_ms || args?.ttlMs,
          });

          if (isGoalAutonomousApprovalBypass) {
            const autoApprovalId = `goal_autonomous_final_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
            grantFinalActionApproval(sessionId, autoApprovalId, scope, 'goal_autonomous');
            try {
              appendAuditEntry({
                timestamp: new Date().toISOString(),
                sessionId,
                agentId: inferAgentIdFromSession(sessionId, args),
                actionType: 'approval_resolved',
                toolName: name,
                toolArgs: { action_kind: scope.actionKind, target_label: scope.targetLabel, summary: scope.summary },
                policyTier: 'commit',
                approvalStatus: 'approved',
                resultSummary: `Goal autonomous policy approved final action: ${scope.targetLabel}`,
              });
            } catch {}
            return {
              name,
              args,
              result:
                `[GOAL AUTONOMOUS APPROVED] Final ${scope.actionKind} action "${scope.targetLabel}" was approved by the active goal policy. ` +
                `Use final_action_approval_id="${autoApprovalId}" on the exact next ${scope.nextToolName || 'desktop/browser action'} call. This approval is one-shot.`,
              data: { final_action_approval_id: autoApprovalId, next_tool_name: scope.nextToolName || '' },
              error: false,
            };
          }

          const approvalQueue = getApprovalQueue();
          const activeTask = resolveTaskForSession(sessionId);
          const activeTaskId = String(activeTask?.id || '').trim() || undefined;
          const approvalOrigin = inferApprovalOrigin(sessionId, activeTask, args);
          const action = `Approve final ${scope.actionKind} action: ${scope.targetLabel}`;

          if (activeTaskId) {
            updateTaskStatus(activeTaskId, 'needs_assistance', { pauseReason: 'awaiting_final_action_approval' });
            appendJournal(activeTaskId, {
              type: 'pause',
              content: `Waiting for final-action approval: ${action.slice(0, 220)}`,
            });
          }

          const approval = approvalQueue.create({
            sessionId,
            taskId: activeTaskId,
            agentId: inferAgentIdFromSession(sessionId, args),
            originType: approvalOrigin.originType,
            originLabel: approvalOrigin.originLabel,
            toolName: name,
            toolArgs: {
              action_kind: scope.actionKind,
              target_label: scope.targetLabel,
              summary: scope.summary,
              surface: scope.surface,
              next_tool_name: scope.nextToolName,
              next_tool_args: scope.nextToolArgs,
              screenshot_id: scope.screenshotId,
            },
            approvalKind: 'final_action',
            action,
            reason: scope.summary,
            policyTier: 'commit',
            riskScore: scope.actionKind === 'purchase' || scope.actionKind === 'transfer' || scope.actionKind === 'delete' ? 9 : 7,
            affectedSystems: [scope.surface || 'external UI'],
            finalAction: scope,
          });

          try {
            appendAuditEntry({
              timestamp: new Date().toISOString(),
              sessionId,
              agentId: inferAgentIdFromSession(sessionId, args),
              actionType: 'approval_requested',
              toolName: name,
              toolArgs: approval.toolArgs,
              policyTier: 'commit',
              approvalStatus: 'pending',
              resultSummary: `Queued final-action approval ${approval.id}`,
            });
          } catch {}

          try {
            deps.broadcastWS({
              type: 'approval_created',
              sessionId,
              taskId: activeTaskId,
              approvalId: approval.id,
              summary: approval.action,
              toolName: name,
              approval: serializeApprovalForClient(approval),
            });
            if (activeTaskId) {
              deps.broadcastWS({
                type: 'task_needs_assistance',
                taskId: activeTaskId,
                title: activeTask?.title,
                reason: 'Final action approval required',
                detail: action,
              });
              deps.broadcastWS({ type: 'task_panel_update', taskId: activeTaskId });
            }
          } catch {}

          try {
            if (deps.telegramChannel?.sendCommandApproval) {
              await deps.telegramChannel.sendCommandApproval(approval);
            }
          } catch (err: any) {
            console.warn('[final_action_approval] Could not send Telegram approval:', err?.message || err);
          }

          const approved = await new Promise<boolean>((resolve) => {
            approvalQueue.onResolve(approval.id, (isApproved) => {
              if (isApproved) {
                grantFinalActionApproval(sessionId, approval.id, scope, 'approval');
              }
              resolve(isApproved);
            });
          });

          try {
            if (activeTaskId) {
              updateTaskStatus(activeTaskId, 'running', { pauseReason: undefined });
              appendJournal(activeTaskId, {
                type: approved ? 'resume' : 'status_push',
                content: approved
                  ? `Final action approved: ${action.slice(0, 220)}`
                  : `Final action rejected: ${action.slice(0, 220)}`,
              });
              deps.broadcastWS({ type: 'task_running', taskId: activeTaskId, title: activeTask?.title });
              deps.broadcastWS({ type: 'task_panel_update', taskId: activeTaskId });
            }
            deps.broadcastWS({
              type: approved ? 'approval_approved' : 'approval_denied',
              sessionId,
              taskId: activeTaskId,
              approvalId: approval.id,
              summary: approval.action,
              approval: serializeApprovalForClient(approval),
            });
          } catch {}

          if (!approved) {
            return { name, args, result: 'Final action approval was rejected.', error: true };
          }

          return {
            name,
            args,
            result:
              `Approved final ${scope.actionKind} action "${scope.targetLabel}". ` +
              `Use final_action_approval_id="${approval.id}" on the exact next ${scope.nextToolName || 'desktop/browser action'} call. This approval is one-shot.`,
            data: { final_action_approval_id: approval.id, next_tool_name: scope.nextToolName || '' },
            error: false,
          };
        }

        if (name === 'request_dev_source_edit') {
          let scope: DevSourceEditScope;
          try {
            scope = createDevSourceEditApprovalScope({
              sessionId,
              files: args?.files || args?.allowed_files || args?.affected_files,
              verificationCommand: args?.verification_command || args?.verificationCommand,
              verificationProfile: args?.verification_profile || args?.verificationProfile,
              verificationProfiles: args?.verification_profiles || args?.verificationProfiles,
              reason: args?.reason || args?.summary,
              plan: args?.plan || args?.dev_plan || args?.devPlan,
              userRequest: args?.user_request || args?.userRequest,
              reasoning: args?.reasoning,
              evidence: args?.evidence,
              currentState: args?.current_state || args?.currentState,
              fix: args?.fix,
              steps: args?.steps || args?.plan_steps || args?.planSteps,
              verification: args?.verification,
              expectedWorkflow: args?.expected_workflow || args?.expectedWorkflow || args?.after_edit_workflow || args?.afterEditWorkflow,
              completionNoteTag: args?.completion_note_tag || args?.completionNoteTag,
              allowedDirs: args?.allowed_dirs || args?.allowedDirs,
            });
          } catch (err: any) {
            return { name, args, result: `request_dev_source_edit error: ${err.message || err}`, error: true };
          }

          const existingGrant = getDevSourceEditGrant(sessionId);
          const alreadyAllowed = existingGrant
            && scope.allowedFiles.every((file) => existingGrant.allowedFiles.includes(file))
            && scope.allowedDirs.every((dir) => (existingGrant.allowedDirs || []).includes(dir));
          if (alreadyAllowed) {
            return {
              name,
              args,
              result: `Dev source edit scope is already approved for this session: ${scope.allowedFiles.join(', ')}; workspace docs: ${scope.allowedDirs.join(', ')}`,
              error: false,
            };
          }

          const approvalQueue = getApprovalQueue();
          const activeTask = resolveTaskForSession(sessionId);
          const activeTaskId = String(activeTask?.id || '').trim() || undefined;
          const approvalOrigin = inferApprovalOrigin(sessionId, activeTask, args);
          const action = `Allow Prometheus dev source edits to: ${scope.allowedFiles.join(', ')}; workspace self docs: ${scope.allowedDirs.join(', ')}`;
          if (activeTaskId) {
            updateTaskStatus(activeTaskId, 'needs_assistance', { pauseReason: 'awaiting_approval' });
            appendJournal(activeTaskId, {
              type: 'pause',
              content: `Waiting for dev source edit approval: ${action.slice(0, 220)}`,
            });
            try {
              deps.broadcastWS({
                type: 'task_needs_assistance',
                taskId: activeTaskId,
                title: activeTask?.title,
                reason: 'Dev source edit approval required',
                detail: action,
              });
              deps.broadcastWS({ type: 'task_panel_update', taskId: activeTaskId });
            } catch {}
          }
          const approval = approvalQueue.create({
            sessionId,
            taskId: activeTaskId,
            agentId: inferAgentIdFromSession(sessionId, args),
            originType: approvalOrigin.originType,
            originLabel: approvalOrigin.originLabel,
            toolName: name,
            toolArgs: {
              dev_edit_id: scope.devEditId,
              dev_edit_audit_id: scope.auditId,
              files: scope.allowedFiles,
              allowed_dirs: scope.allowedDirs,
              reason: scope.reason,
              verification_command: scope.verificationCommand,
              verification_profile: scope.verificationProfile,
              verification_profiles: scope.verificationProfiles,
              plan: scope.plan,
              plan_hash: scope.planHash,
            },
            approvalKind: 'dev_source_edit',
            action,
            reason: scope.reason || 'Prometheus requested dev-only source edit access for the listed files.',
            policyTier: 'commit',
            riskScore: 8,
            affectedSystems: ['Prometheus source code'],
            devSourceEdit: {
              devEditId: scope.devEditId,
              allowedFiles: scope.allowedFiles,
              allowedDirs: scope.allowedDirs,
              verificationCommand: scope.verificationCommand,
              verificationProfile: scope.verificationProfile,
              verificationProfiles: scope.verificationProfiles,
              reason: scope.reason,
              plan: scope.plan,
              planHash: scope.planHash,
              expiresAt: scope.expiresAt,
            },
          });
          scope.approvalId = approval.id;

          try {
            appendAuditEntry({
              timestamp: new Date().toISOString(),
              sessionId,
              agentId: inferAgentIdFromSession(sessionId, args),
              actionType: 'approval_requested',
              toolName: name,
              toolArgs: approval.toolArgs,
              policyTier: 'commit',
              approvalStatus: 'pending',
              resultSummary: `Queued dev source edit approval ${approval.id}; audit ${scope.auditId || scope.devEditId}`,
            });
          } catch {}

          // Auto mode still creates and resolves the exact same one-shot
          // approval record. It removes only the human wait, never the scoped
          // request, plan hash, audit trail, or source-write boundary.
          if (shouldAutoApproveScopedDevSourceEdit(scope)) {
            const resolved = approvalQueue.resolve(approval.id, true, 'policy:auto_scoped_dev_edit');
            if (!resolved) return { name, args, result: `Could not auto-resolve dev source edit approval ${approval.id}.`, error: true };
            try {
              grantDevSourceEditApproval(sessionId, scope, 'policy:auto_scoped_dev_edit');
            } catch (err: any) {
              return { name, args, result: `Auto-approved dev source edit grant failed: ${err?.message || err}`, error: true };
            }
            try {
              deps.broadcastWS({
                type: 'approval_approved', sessionId, taskId: activeTaskId, approvalId: approval.id,
                summary: approval.action, approval: serializeApprovalForClient(resolved), autoApproved: true,
              });
            } catch {}
            return {
              name,
              args,
              result: `[AUTO-SCOPED APPROVED] Dev source edit scope granted: ${scope.allowedFiles.join(', ')}.\n` +
                `Approval: ${approval.id}; dev_edit_id: ${scope.devEditId}; audit_id: ${scope.auditId || scope.devEditId}; plan_hash: ${scope.planHash || 'none'}.\n` +
                `The request, policy decision, per-mutation diffs, before/after hashes, and verification remain durably recorded. Continue only within the declared files and complete the normal verify/apply_live flow.`,
              data: { devSourceEdit: { devEditId: scope.devEditId, auditId: scope.auditId, allowedFiles: scope.allowedFiles, allowedDirs: scope.allowedDirs, plan: scope.plan, planHash: scope.planHash, verificationProfiles: scope.verificationProfiles, completionNoteTag: scope.plan?.completionNoteTag || 'dev_edit_complete' } },
              extra: { devSourceEdit: { devEditId: scope.devEditId, auditId: scope.auditId, allowedFiles: scope.allowedFiles, allowedDirs: scope.allowedDirs, plan: scope.plan, planHash: scope.planHash, verificationProfiles: scope.verificationProfiles, completionNoteTag: scope.plan?.completionNoteTag || 'dev_edit_complete' } },
              error: false,
            };
          }

          try {
            deps.broadcastWS({
              type: 'approval_created',
              sessionId,
              taskId: activeTaskId,
              approvalId: approval.id,
              summary: approval.action,
              toolName: name,
              approval: serializeApprovalForClient(approval),
            });
          } catch {}

          try {
            if (deps.telegramChannel?.sendCommandApproval) {
              await deps.telegramChannel.sendCommandApproval(approval);
            }
          } catch (err: any) {
            console.warn('[dev_source_approval] Could not send Telegram approval:', err?.message || err);
          }

          // Wait for approval, but allow a live steer to interrupt so Prometheus can
          // react (e.g. call update_dev_source_edit) before the user approves.
          const waitResult = await new Promise<boolean | { steerInterrupt: string }>((resolve) => {
            let settled = false;
            const safeResolve = (val: boolean | { steerInterrupt: string }) => {
              if (settled) return;
              settled = true;
              approvalQueue.clearSteerCallback(approval.id);
              resolve(val);
            };

            approvalQueue.onResolve(approval.id, (isApproved) => {
              if (isApproved) {
                try {
                  grantDevSourceEditApproval(sessionId, scope, 'approval');
                } catch (err: any) {
                  console.warn('[dev_source_approval] Could not grant source edit scope:', err?.message || err);
                  safeResolve(false);
                  return;
                }
              }
              safeResolve(isApproved);
            });

            // Register steer wakeup: if the user sends a steer while we're waiting,
            // interrupt immediately so the LLM can react to it.
            approvalQueue.onSteer(approval.id, (steerMessage) => {
              safeResolve({ steerInterrupt: steerMessage });
            });
          });

          // Steer arrived while waiting — return early so the model can act on it
          if (typeof waitResult === 'object' && 'steerInterrupt' in waitResult) {
            const steerMsg = waitResult.steerInterrupt;
            console.log(`[dev_source_approval] Steer interrupted approval wait for ${approval.id}: ${steerMsg.slice(0, 120)}`);
            try {
              deps.broadcastWS({
                type: 'approval_steer_interrupt',
                sessionId,
                approvalId: approval.id,
                steerMessage: steerMsg.slice(0, 500),
              });
            } catch {}
            return {
              name,
              args,
              result:
                `[STEER RECEIVED WHILE WAITING FOR DEV EDIT APPROVAL]\n` +
                `Steer message: "${steerMsg}"\n\n` +
                `The dev source edit approval (approval_id: "${approval.id}", dev_edit_id: "${scope.devEditId}") is still pending — the user has not yet approved or denied it.\n\n` +
                `You can:\n` +
                `1. Call update_dev_source_edit(approval_id: "${approval.id}", ...) to modify the pending plan, reason, or files before the user approves.\n` +
                `2. Call await_dev_source_edit_approval(approval_id: "${approval.id}") to resume waiting for the same approval.\n` +
                `3. Call request_dev_source_edit again with a fresh plan to replace this approval.\n\n` +
                `Address the steer first — update the plan if needed, then resume waiting.`,
              error: false,
            };
          }

          const approved = waitResult as boolean;
          try {
            if (activeTaskId) {
              updateTaskStatus(activeTaskId, 'running', { pauseReason: undefined });
              appendJournal(activeTaskId, {
                type: approved ? 'resume' : 'status_push',
                content: approved
                  ? `Dev source edit approved: ${action.slice(0, 220)}`
                  : `Dev source edit rejected: ${action.slice(0, 220)}`,
              });
              deps.broadcastWS({ type: 'task_running', taskId: activeTaskId, title: activeTask?.title });
              deps.broadcastWS({ type: 'task_panel_update', taskId: activeTaskId });
            }
            deps.broadcastWS({
              type: approved ? 'approval_approved' : 'approval_denied',
              sessionId,
              taskId: activeTaskId,
              approvalId: approval.id,
              summary: approval.action,
              approval: serializeApprovalForClient(approval),
            });
          } catch {}

          if (!approved) {
            return { name, args, result: 'Dev source edit approval was rejected.', error: true };
          }
          return {
            name,
            args,
            result:
              `Approved dev source edit scope for this session: ${scope.allowedFiles.join(', ')}.\n` +
              `Approved workspace self-doc scope: ${scope.allowedDirs.join(', ')}.\n` +
              `Approved plan hash: ${scope.planHash || 'none'}; dev_edit_id: ${scope.devEditId}.\n` +
              `Use source-specific tools for src/web-ui files and scoped workspace file tools for approved self docs. When edits are verified, enter the shared apply barrier through ${formatPromApplyDevChangesInstruction(scope.allowedFiles, scope.reason || 'Approved Prometheus dev source edits', 'apply_live', scope.devEditId)}. ` +
              `For a no-restart preflight, call the same tool with mode:"verify_only". If a file is queued, use dev_source_edit action=await_files and reread after handoff. Write_note with tag "${scope.plan?.completionNoteTag || 'dev_edit_complete'}" only after the coordinator confirms this batch is live.`,
            data: {
              devSourceEdit: {
                devEditId: scope.devEditId,
                allowedFiles: scope.allowedFiles,
                allowedDirs: scope.allowedDirs,
                plan: scope.plan,
                planHash: scope.planHash,
                verificationProfiles: scope.verificationProfiles,
                completionNoteTag: scope.plan?.completionNoteTag || 'dev_edit_complete',
              },
            },
            extra: {
              devSourceEdit: {
                devEditId: scope.devEditId,
                allowedFiles: scope.allowedFiles,
                allowedDirs: scope.allowedDirs,
                plan: scope.plan,
                planHash: scope.planHash,
                verificationProfiles: scope.verificationProfiles,
                completionNoteTag: scope.plan?.completionNoteTag || 'dev_edit_complete',
              },
            },
            error: false,
          };
        }

	        // ── update_dev_source_edit ─────────────────────────────────────────
        if (name === 'update_dev_source_edit') {
          const approvalId = String(args?.approval_id || '').trim();
          if (!approvalId) {
            return { name, args, result: 'update_dev_source_edit requires approval_id.', error: true };
          }
          const approvalQueue = getApprovalQueue();
          const existing = approvalQueue.get(approvalId);
          if (!existing) {
            return { name, args, result: `Approval ${approvalId} not found.`, error: true };
          }
          if (existing.status !== 'pending') {
            return { name, args, result: `Approval ${approvalId} is already ${existing.status} and cannot be updated.`, error: true };
          }
          if (existing.sessionId !== sessionId) {
            return { name, args, result: 'Cannot update an approval that belongs to a different session.', error: true };
          }

          const updatedFields: Parameters<typeof approvalQueue.update>[1] = {};
          if (args?.reason) updatedFields.reason = String(args.reason);
          if (args?.action) updatedFields.action = String(args.action);

          // Merge plan fields into devSourceEdit.plan
          const planPatch: Record<string, any> = {};
          if (args?.plan) {
            const p = args.plan;
            if (p.user_request) planPatch.userRequest = String(p.user_request);
            if (p.reasoning) planPatch.reasoning = String(p.reasoning);
            if (p.current_state) planPatch.currentState = String(p.current_state);
            if (p.fix) planPatch.fix = String(p.fix);
            if (Array.isArray(p.steps)) planPatch.steps = p.steps.map(String);
            if (Array.isArray(p.verification)) planPatch.verification = p.verification.map(String);
            if (Array.isArray(p.evidence)) planPatch.evidence = p.evidence;
            if (p.completion_note_tag) planPatch.completionNoteTag = String(p.completion_note_tag);
          }
          if (Object.keys(planPatch).length || args?.files) {
            updatedFields.devSourceEdit = {} as any;
            if (Array.isArray(args?.files)) {
              (updatedFields.devSourceEdit as any).allowedFiles = args.files.map(String);
              updatedFields.toolArgs = { ...(existing.toolArgs || {}), files: args.files.map(String) };
            }
            if (Object.keys(planPatch).length) {
              (updatedFields.devSourceEdit as any).plan = planPatch;
            }
          }

          const updated = approvalQueue.update(approvalId, updatedFields);
          if (!updated) {
            return { name, args, result: `Failed to update approval ${approvalId}.`, error: true };
          }

          try {
            deps.broadcastWS({
              type: 'approval_updated',
              sessionId,
              approvalId,
              approval: serializeApprovalForClient(updated),
            });
          } catch {}

          return {
            name,
            args,
            result:
              `Pending approval ${approvalId} updated successfully.\n` +
              `The user will see the revised plan in the approval card.\n` +
              `Call await_dev_source_edit_approval(approval_id: "${approvalId}") to resume waiting for the user to approve or deny.`,
            error: false,
          };
        }

        // ── await_dev_source_edit_approval ────────────────────────────────────
        if (name === 'await_dev_source_edit_approval') {
          const approvalId = String(args?.approval_id || '').trim();
          if (!approvalId) {
            return { name, args, result: 'await_dev_source_edit_approval requires approval_id.', error: true };
          }
          const approvalQueue = getApprovalQueue();
          const existing = approvalQueue.get(approvalId);
          if (!existing) {
            return { name, args, result: `Approval ${approvalId} not found.`, error: true };
          }
          if (existing.sessionId !== sessionId) {
            return { name, args, result: 'Cannot await an approval that belongs to a different session.', error: true };
          }
          if (existing.status !== 'pending') {
            const isApproved = existing.status === 'approved';
            const resolvedTask = resolveTaskForSession(sessionId);
            const resolvedTaskId = String(resolvedTask?.id || '').trim() || undefined;
            if (resolvedTaskId) {
              updateTaskStatus(resolvedTaskId, 'running', { pauseReason: undefined });
              appendJournal(resolvedTaskId, {
                type: isApproved ? 'resume' : 'status_push',
                content: `Dev source edit approval ${approvalId} was already ${existing.status}.`,
              });
              try {
                deps.broadcastWS({ type: 'task_running', taskId: resolvedTaskId, title: resolvedTask?.title });
                deps.broadcastWS({ type: 'task_panel_update', taskId: resolvedTaskId });
              } catch {}
            }
            if (isApproved) {
              const existingGrant = getDevSourceEditGrant(sessionId);
              if (!existingGrant) {
                try {
                  const existingScope = existing.devSourceEdit
                    ? createDevSourceEditApprovalScope({
                        sessionId,
                        files: existing.devSourceEdit.allowedFiles,
                        allowedDirs: (existing.devSourceEdit as any).allowedDirs,
                        verificationProfile: existing.devSourceEdit.verificationProfile,
                        verificationProfiles: (existing.devSourceEdit as any).verificationProfiles,
                        reason: existing.devSourceEdit.reason,
                        plan: existing.devSourceEdit.plan,
                      })
                    : null;
                  if (existingScope) grantDevSourceEditApproval(sessionId, existingScope, 'approval');
                } catch { /* best effort */ }
              }
              return {
                name, args,
                result: `Approval ${approvalId} was already approved. Dev source edit scope is active. Proceed with edits.`,
                error: false,
              };
            }
            return { name, args, result: `Approval ${approvalId} was already ${existing.status}.`, error: true };
          }

          // Re-enter the steer-interruptible wait
          const waitResult2 = await new Promise<boolean | { steerInterrupt: string }>((resolve) => {
            let settled2 = false;
            const safeResolve2 = (val: boolean | { steerInterrupt: string }) => {
              if (settled2) return;
              settled2 = true;
              approvalQueue.clearSteerCallback(approvalId);
              resolve(val);
            };

            approvalQueue.onResolve(approvalId, (isApproved2) => {
              if (isApproved2) {
                try {
                  const existingScope2 = existing.devSourceEdit
                    ? createDevSourceEditApprovalScope({
                        sessionId,
                        files: existing.devSourceEdit.allowedFiles,
                        allowedDirs: (existing.devSourceEdit as any).allowedDirs,
                        verificationProfile: existing.devSourceEdit.verificationProfile,
                        verificationProfiles: (existing.devSourceEdit as any).verificationProfiles,
                        reason: existing.devSourceEdit.reason,
                        plan: existing.devSourceEdit.plan,
                      })
                    : null;
                  if (existingScope2) grantDevSourceEditApproval(sessionId, existingScope2, 'approval');
                } catch (err: any) {
                  console.warn('[await_dev_source_approval] Could not grant source edit scope:', err?.message || err);
                  safeResolve2(false);
                  return;
                }
              }
              safeResolve2(isApproved2);
            });

            approvalQueue.onSteer(approvalId, (steerMsg2) => {
              safeResolve2({ steerInterrupt: steerMsg2 });
            });
          });

          if (typeof waitResult2 === 'object' && 'steerInterrupt' in waitResult2) {
            const steerMsg2 = waitResult2.steerInterrupt;
            try {
              deps.broadcastWS({ type: 'approval_steer_interrupt', sessionId, approvalId, steerMessage: steerMsg2.slice(0, 500) });
            } catch {}
            return {
              name,
              args,
              result:
                `[STEER RECEIVED WHILE WAITING FOR APPROVAL]\n` +
                `Steer message: "${steerMsg2}"\n\n` +
                `Approval ${approvalId} is still pending. Address the steer, update the plan with update_dev_source_edit if needed, then call await_dev_source_edit_approval again.`,
              error: false,
            };
          }

          const approved2 = waitResult2 as boolean;
          try {
            const activeTask2 = resolveTaskForSession(sessionId);
            const activeTaskId2 = String(activeTask2?.id || '').trim() || undefined;
            if (activeTaskId2) {
              updateTaskStatus(activeTaskId2, 'running', { pauseReason: undefined });
              appendJournal(activeTaskId2, {
                type: approved2 ? 'resume' : 'status_push',
                content: approved2
                  ? `Dev source edit approval ${approvalId} approved.`
                  : `Dev source edit approval ${approvalId} rejected.`,
              });
              deps.broadcastWS({ type: 'task_running', taskId: activeTaskId2, title: activeTask2?.title });
              deps.broadcastWS({ type: 'task_panel_update', taskId: activeTaskId2 });
            }
            deps.broadcastWS({
              type: approved2 ? 'approval_approved' : 'approval_denied',
              sessionId,
              taskId: activeTaskId2,
              approvalId,
              approval: serializeApprovalForClient(existing),
            });
          } catch {}

          if (!approved2) {
            return { name, args, result: 'Dev source edit approval was rejected.', error: true };
          }
          return {
            name, args,
            result: `Approval ${approvalId} approved. Dev source edit scope is now active. Proceed with edits.`,
            error: false,
          };
        }

        if (name === 'request_tool_category') {
          return handleRequestToolCategory(args, sessionId, {
            isDevSourceWriteApproved: isDevSourceWriteApprovedSession,
          });
        }

        // ── Composite management and dynamic dispatch ─────────────────────
        const { handleCompositeTool } = await import('../../tools/composite-tools');
        const compositeResult = await handleCompositeTool(name, args, executeTool, workspacePath, deps, sessionId);
        if (compositeResult) return compositeResult;

        return { name, args, result: `Unknown tool: ${name}`, error: true };
      }
}
