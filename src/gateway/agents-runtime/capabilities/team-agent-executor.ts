import fs from 'fs';
import path from 'path';
import { getAgentById, getAgents, getConfig } from '../../../config/config';
import { mainChatRoutePatch } from '../../../config/main-chat-route.js';
import { parseProviderModelRef } from '../../../agents/model-routing.js';
import { resetProvider } from '../../../providers/factory.js';
import { recordAgentRun } from '../../../scheduler';
import { appendSubagentChatMessage } from '../subagent-chat-store';
import {
  appendJournal,
  listTaskSummaries,
  loadTask,
  saveTask,
} from '../../tasks/task-store';
import {
  buildTeamDispatchTask,
  _bgAgentResults,
} from '../../teams/team-dispatch-runtime';
import {
  addTeamContextReference,
  appendMainAgentThread,
  appendTeamChat,
  appendTeamRoomMessage,
  createManagedTeam,
  createTeamDispatchRecord,
  deleteTeamContextReference,
  getManagedTeam,
  listTeamContextReferences,
  listManagedTeams,
  logCompletedWork,
  pauseTeamAgent,
  queueAgentMessage,
  queueManagerMessage,
  recordTeamRun,
  saveManagedTeam,
  shareTeamArtifact,
  unpauseTeamAgent,
  updateTeamContextReference,
  updateTeamDispatchRecord,
  updateTeamFocus,
  updateTeamMemberState,
  upsertTeamPlanItem,
} from '../../teams/managed-teams';
import {
  handleManagerConversation,
  triggerManagerReview,
  verifySubagentResult,
} from '../../teams/team-manager-runner';
import { routeTeamEvent } from '../../teams/team-event-router';
import {
  runTeamMemberRoomTurn,
  scheduleTeamMemberAutoWake,
} from '../../teams/team-member-room';
import { claimAgentForTeamWorkspace } from '../../teams/team-workspace';
import { notifyMainAgent } from '../../teams/notify-bridge';
import { SubagentManager, validateDirectSubagentAssignment } from '../subagent-manager';
import { deleteAgentCompletely, deleteTeamCompletely } from '../entity-delete';
import type { CapabilityExecutionContext, CapabilityExecutor } from './types';
import type { ToolResult } from '../../tool-builder';
import {
  appendAndBroadcastTeamChat,
  getTeamChatTargetMetadata,
  inferTeamNoteContext,
  maybeStartTeamStatusTaskMirror,
} from './team-agent-helpers';

const TEAM_AGENT_TOOL_NAMES = new Set([
  'agent_list',
  'agent_info',
  'agent_update',
  'delete_agent',
  'dispatch_to_agent',
  'message_subagent',
  'get_agent_result',
  'talk_to_subagent',
  'talk_to_manager',
  'request_context',
  'request_manager_help',
  'request_team_member_turn',
  // dispatch_team_agent, talk_to_teammate, share_artifact and team_manage are
  // intentionally NOT routed here: the canonical (PR #542-patched) handlers live in
  // subagent-executor.ts. This executor runs first, so listing them here shadowed
  // those fixes (background dispatch, display-name lookup, flat/nested artifacts,
  // team_manage status/update/delete, dispatched-member team context).
  'update_my_status',
  'update_team_goal',
  'post_to_team_chat',
  'message_main_agent',
  'reply_to_team',
  'manage_team_goal',
  'manage_team_context_ref',
  'spawn_subagent',
  'ask_team_coordinator',
  'set_current_model',
  'set_agent_model',
  'get_agent_models',
  'list_agent_model_templates',
  'save_agent_model_template',
  'update_agent_model_template',
  'apply_agent_model_template',
  'select_agent_model_template',
  'delete_agent_model_template',
]);

const VALID_AGENT_MODEL_TYPES = [
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
  'background_agent',
  'goal_compactor',
];

function resolveGatewayAddress(): { host: string; port: number } {
  const cfg = getConfig().getConfig() as any;
  const port = Number(cfg?.gateway?.port) || 18789;
  const configuredHost = String(cfg?.gateway?.host || '127.0.0.1');
  const host = (configuredHost === '0.0.0.0' || configuredHost === '::')
    ? '127.0.0.1'
    : configuredHost;
  return { host, port };
}

type MainAgentTeamRoute = {
  route: 'team' | 'member' | 'manager';
  targetLabel?: string;
  targetAgentId?: string;
  text: string;
};

function normalizeTeamRouteKey(value: any): string {
  return String(value || '').trim().toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9]+/g, '');
}

function parseMainAgentTeamRoute(message: string): MainAgentTeamRoute {
  const raw = String(message || '').trim();
  const managerMatch = raw.match(/^\s*\[TO_MANAGER\]\s*/i);
  if (managerMatch) {
    return { route: 'manager', text: raw.slice(managerMatch[0].length).trim() || raw };
  }

  const askMatch = raw.match(/^\s*\[ASK_AGENT:([^\]]+)\]\s*/i);
  if (askMatch) {
    const targetLabel = String(askMatch[1] || '').trim();
    return {
      route: 'member',
      targetLabel,
      text: raw.slice(askMatch[0].length).trim() || raw,
    };
  }

  const broadcastMatch = raw.match(/^\s*\[BROADCAST_TO_TEAM\]\s*/i);
  if (broadcastMatch) {
    return { route: 'team', targetLabel: 'team', text: raw.slice(broadcastMatch[0].length).trim() || raw };
  }

  return { route: 'team', targetLabel: 'team', text: raw };
}

function resolveMainAgentTeamMemberId(team: any, label: string): string | null {
  const wanted = normalizeTeamRouteKey(label);
  if (!wanted) return null;
  for (const memberAgentId of Array.isArray(team?.subagentIds) ? team.subagentIds : []) {
    const agent = getAgentById(memberAgentId) as any;
    const candidates = [
      memberAgentId,
      agent?.id,
      agent?.name,
      agent?.teamRole,
      agent?.role,
      agent?.description,
    ];
    if (candidates.some((candidate) => normalizeTeamRouteKey(candidate) === wanted)) {
      return memberAgentId;
    }
  }
  return null;
}

function buildMainAgentTeamBroadcastPrompt(message: string): string {
  return [
    `[TEAM BROADCAST FROM MAIN AGENT]`,
    `The main Prometheus agent addressed @team:`,
    message,
    ``,
    `Reply once in the shared room. Be conversational and useful.`,
    `Do not start execution work unless the message explicitly asks for work to begin.`,
  ].join('\n');
}

function buildMainAgentDirectMemberPrompt(message: string, targetLabel: string): string {
  return [
    `[DIRECT TEAM MESSAGE FROM MAIN AGENT]`,
    `The main Prometheus agent addressed you (${targetLabel || 'this team member'}):`,
    message,
    ``,
    `Reply once in the shared room so the rest of the team can follow the exchange.`,
  ].join('\n');
}

async function deliverMainAgentMessageToTeamMembers(
  teamId: string,
  team: any,
  message: string,
  targetAgentId?: string,
  targetLabel?: string,
): Promise<{ deliveredCount: number; completedCount: number }> {
  const memberAgentIds = targetAgentId
    ? [targetAgentId]
    : (Array.isArray(team?.subagentIds) ? team.subagentIds : []).filter((memberAgentId: string) =>
        memberAgentId && team?.agentPauseStates?.[memberAgentId]?.paused !== true
      );

  for (const memberAgentId of memberAgentIds) {
    queueAgentMessage(
      teamId,
      memberAgentId,
      targetAgentId
        ? `[From Main Agent to ${targetLabel || memberAgentId}] ${message}`
        : `[From Main Agent to @team] ${message}`,
    );
  }

  const results = await Promise.allSettled(
    memberAgentIds.map((memberAgentId: string) =>
      runTeamMemberRoomTurn(
        teamId,
        memberAgentId,
        targetAgentId
          ? buildMainAgentDirectMemberPrompt(message, targetLabel || memberAgentId)
          : buildMainAgentTeamBroadcastPrompt(message),
        {
          autoWakeReason: targetAgentId
            ? 'The main agent addressed this member in the team room.'
            : 'The main agent addressed the whole team in the room.',
          autoWakeSource: 'manager_message',
        },
      )
    ),
  );

  return {
    deliveredCount: memberAgentIds.length,
    completedCount: results.filter((result) => result.status === 'fulfilled').length,
  };
}

function buildMainAgentMembersRespondedPrompt(
  message: string,
  deliveredCount: number,
  completedCount: number,
  targetLabel?: string,
): string {
  const audience = targetLabel ? `member "${targetLabel}"` : '@team';
  return [
    `[TEAM BROADCAST MEMBERS RESPONDED]`,
    `The main Prometheus agent addressed ${audience}. The system delivered the message to ${deliveredCount} unpaused member(s), and ${completedCount} member room turn(s) have settled.`,
    `Review the current team room messages before replying. The addressed members have already had their chance to answer, so do not call request_team_member_turn for this message and do not re-ask members to weigh in.`,
    `Reply last as the manager with a concise synthesis or acknowledgement if useful.`,
    ``,
    `[MAIN AGENT MESSAGE]`,
    message,
  ].join('\n');
}

/** Aliases agents naturally reach for (e.g. "log_completion") -> canonical manage_team_goal actions. */
export function normalizeTeamGoalAction(raw: string): string {
  const a = String(raw || '').trim().toLowerCase();
  const aliases: Record<string, string> = {
    update_focus: 'set_focus',
    focus: 'set_focus',
    set_goal: 'set_focus',
    log_completion: 'log_completed',
    log_complete: 'log_completed',
    log_completed_work: 'log_completed',
    complete: 'log_completed',
    completed: 'log_completed',
  };
  return aliases[a] || a;
}

export const teamAgentCapabilityExecutor: CapabilityExecutor = {
  id: 'team-agent',

  canHandle(name: string): boolean {
    return TEAM_AGENT_TOOL_NAMES.has(name);
  },

  async execute(ctx: CapabilityExecutionContext): Promise<ToolResult> {
    const { name, args, deps, sessionId, workspacePath } = ctx;

    switch (name) {
      case 'agent_list': {
        try {
          const configuredAgents = getAgents();
          if (!configuredAgents || configuredAgents.length === 0) {
            return { name, args, result: 'No agents configured. You can create one via the Agents UI or by defining one in .prometheus/config.json under the "agents" array.', error: false };
          }
          const agentSummaries = configuredAgents.map((a: any) => ({
            id: a.id,
            name: a.name || a.id,
            description: a.description || '(no description)',
            default: a.default === true,
            executionWorkspace: a.executionWorkspace || null,
            allowedWorkPaths: Array.isArray(a.allowedWorkPaths) ? a.allowedWorkPaths : [],
            schedule: a.schedule || null,
          }));
          const lines = agentSummaries.map((a: any) =>
            `- ${a.name} (id: ${a.id})${a.default ? ' (default)' : ''}: ${a.description}${a.executionWorkspace ? ` [cwd: ${a.executionWorkspace}]` : ''}${a.allowedWorkPaths?.length ? ` [allowed: ${a.allowedWorkPaths.join(', ')}]` : ''}${a.schedule ? ` [scheduled: ${a.schedule}]` : ''}`
          );
          return { name, args, result: `${agentSummaries.length} agent(s) configured:\n${lines.join('\n')}`, error: false };
        } catch (err: any) {
          return { name, args, result: `agent_list error: ${err.message}`, error: true };
        }
      }

      case 'agent_info': {
        try {
          const agentId = String(args.agent_id || '').trim();
          if (!agentId) {
            return { name, args, result: 'agent_info requires agent_id. Call agent_list first to get IDs.', error: true };
          }
          const agent = getAgentById(agentId);
          if (!agent) {
            const allAgents = getAgents();
            const ids = allAgents.map((a: any) => a.id).join(', ') || 'none';
            return { name, args, result: `Agent "${agentId}" not found. Available IDs: ${ids}`, error: true };
          }
          let contextRefs: any[] = [];
          try {
            const workspacePath = getConfig().getConfig().workspace?.path || process.cwd();
            contextRefs = new SubagentManager(workspacePath).listContextReferences(agentId);
          } catch {}
          return { name, args, result: JSON.stringify({ ...agent, context_refs: contextRefs }, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `agent_info error: ${err.message}`, error: true };
        }
      }

      case 'agent_update': {
        try {
          const agentId = String(args.agent_id || '').trim();
          if (!agentId) {
            return { name, args, result: 'agent_update requires agent_id. Call agent_list first to get IDs.', error: true };
          }
          if (agentId === 'main') {
            return { name, args, result: 'ERROR: agent_update cannot modify the synthetic main agent. Use settings/config for main-agent changes.', error: true };
          }
          const workspacePath = getConfig().getConfig().workspace?.path || process.cwd();
          const subagentMgr = new SubagentManager(workspacePath, deps.broadcastWS, deps.handleChat, deps.telegramChannel);
          const patch = { ...args };
          delete (patch as any).agent_id;
          const updated = subagentMgr.updateSubagent(agentId, patch);
          return {
            name,
            args,
            result: JSON.stringify({
              success: true,
              agent: {
                id: updated.id,
                name: updated.name,
                description: updated.description,
                model: updated.model || null,
                reasoning_effort: updated.reasoning_effort || null,
                executionWorkspace: updated.executionWorkspace || null,
                allowedWorkPaths: updated.allowedWorkPaths || [],
                max_steps: updated.max_steps,
                timeout_ms: updated.timeout_ms,
                identity: updated.identity || null,
                allowed_tools: updated.allowed_tools || [],
                forbidden_tools: updated.forbidden_tools || [],
                skillIds: updated.skillIds || [],
                context_refs: subagentMgr.listContextReferences(agentId),
                modified_at: updated.modified_at,
              },
            }, null, 2),
            error: false,
          };
        } catch (err: any) {
          return { name, args, result: `agent_update error: ${err.message}`, error: true };
        }
      }

      case 'delete_agent': {
        try {
          const agentId = String(args.agent_id || args.agentId || args.id || '').trim();
          if (!agentId) return { name, args, result: 'delete_agent requires agent_id. Call agent_list first to get IDs.', error: true };
          if (args.confirm !== true) {
            return { name, args, result: 'delete_agent requires confirm=true because this permanently deletes the subagent, workspace files, stored chat, schedules, and team membership.', error: true };
          }
          const result = deleteAgentCompletely({
            agentId,
            cronScheduler: deps.cronScheduler,
            broadcastTeamEvent: deps.broadcastTeamEvent,
          });
          return { name, args, result: JSON.stringify(result, null, 2), error: result.success !== true };
        } catch (err: any) {
          return { name, args, result: `delete_agent error: ${err.message}`, error: true };
        }
      }

      case 'dispatch_to_agent': {
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

      case 'message_subagent': {
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
              message: `This agent already has an active run. Steer task ${activeRun.id} instead of creating another task. Set force_new_task=true only for explicitly separate parallel work.`,
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
            sessionId,
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

      case 'get_agent_result': {
        const taskId = String(args?.task_id || '').trim();
        const block = args?.block !== false;
        const timeoutMs = Math.max(1000, Math.min(1800000, Number(args?.timeout_ms) || 300000));
        if (!taskId) return { name, args, result: 'ERROR: get_agent_result requires task_id', error: true };
        const entry = _bgAgentResults.get(taskId);
        if (!entry) return { name, args, result: `ERROR: Unknown background team task_id: ${taskId}`, error: true };
        if (!block || entry.status !== 'running') {
          return { name, args, result: JSON.stringify({ success: entry.status === 'complete', status: entry.status, task_id: taskId, result: entry.result || null }, null, 2), error: entry.status === 'failed' };
        }
        const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
        const completed = await Promise.race([entry.promise, timeout]);
        if (!completed) {
          return { name, args, result: JSON.stringify({ success: true, status: 'running', task_id: taskId, message: 'Still running.' }, null, 2), error: false };
        }
        return { name, args, result: JSON.stringify({ success: completed.success, status: completed.success ? 'complete' : 'failed', task_id: taskId, result: completed }, null, 2), error: completed.success !== true };
      }

      case 'talk_to_subagent': {
        const targetAgentId = String(args?.agent_id || '').trim();
        const message = String(args?.message || '').trim();
        if (!targetAgentId) return { name, args, result: 'ERROR: agent_id is required', error: true };
        if (!message) return { name, args, result: 'ERROR: message is required', error: true };
        try {
          const team = listManagedTeams().find((t: any) => Array.isArray(t.subagentIds) && t.subagentIds.includes(targetAgentId));
          if (!team) return { name, args, result: `ERROR: Agent "${targetAgentId}" is not a managed-team member. For standalone agents use chat_with_subagent (conversation) or message_subagent (background task).`, error: true };
          queueAgentMessage(team.id, targetAgentId, message);
          appendAndBroadcastTeamChat(deps, team, {
            from: 'manager',
            fromName: 'Manager',
            content: message,
            metadata: {
              source: 'talk_to_subagent',
              agentId: targetAgentId,
              ...getTeamChatTargetMetadata(targetAgentId),
            },
          });
          try {
            const subagentChatMsg = appendSubagentChatMessage(targetAgentId, {
              role: 'user',
              content: message,
              metadata: {
                source: 'talk_to_subagent',
                teamId: team.id,
                from: 'manager',
              },
            });
            deps.broadcastWS?.({ type: 'subagent_chat_message', agentId: targetAgentId, message: subagentChatMsg });
          } catch {}
          const pausedTaskSummary = listTaskSummaries({ status: ['awaiting_user_input'] })
            .filter((t: any) => t.teamSubagent?.teamId === team.id && t.teamSubagent?.agentId === targetAgentId)
            .sort((a: any, b: any) => Number(b.startedAt || 0) - Number(a.startedAt || 0))[0];
          const pausedTask = pausedTaskSummary ? loadTask(pausedTaskSummary.id) : null;
          if (pausedTask) {
            pausedTask.status = 'queued';
            pausedTask.pauseReason = undefined;
            pausedTask.pendingClarificationQuestion = undefined;
            pausedTask.resumeContext = pausedTask.resumeContext || { messages: [], browserSessionActive: false, round: 0 };
            pausedTask.resumeContext.messages = [
              ...(Array.isArray(pausedTask.resumeContext.messages) ? pausedTask.resumeContext.messages : []),
              {
                role: 'user',
                content: `[MANAGER RESPONSE]\n${message}`,
                timestamp: Date.now(),
              },
            ].slice(-10);
            pausedTask.resumeContext.onResumeInstruction = `[MANAGER RESPONSE]\n${message}\n\nResume the paused team task using this manager response.`;
            pausedTask.lastProgressAt = Date.now();
            saveTask(pausedTask);
            appendJournal(pausedTask.id, { type: 'resume', content: `Manager answered and resumed ${targetAgentId}.` });
            try {
              const { BackgroundTaskRunner } = require('../../tasks/background-task-runner');
              const runner = new BackgroundTaskRunner(
                pausedTask.id,
                deps.handleChat,
                deps.broadcastWS || (() => {}),
                deps.telegramChannel || null,
              );
              runner.start().catch((e: any) => console.warn('[talk_to_subagent] Resume failed:', e?.message || e));
            } catch (resumeErr: any) {
              console.warn('[talk_to_subagent] Could not resume paused subagent:', resumeErr?.message || resumeErr);
            }
          }
          console.log(`[talk_to_subagent] Queued message for "${targetAgentId}" in team "${team.name}"`);
          return {
            name,
            args,
            result: pausedTask
              ? `Message delivered to ${targetAgentId} (team: ${team.name}) and their paused task is resuming.`
              : `Message queued for ${targetAgentId} (team: ${team.name}). They will receive it on their next run.`,
            error: false,
          };
        } catch (e: any) {
          return { name, args, result: `ERROR: ${e.message}`, error: true };
        }
      }

      case 'talk_to_manager': {
        const message = String(args?.message || '').trim();
        const waitForReply = args?.wait_for_reply === true;
        if (!message) return { name, args, result: 'ERROR: message is required', error: true };
        try {
          const noteContext = inferTeamNoteContext(sessionId);
          if (noteContext?.authorType === 'manager' && noteContext.teamId) {
            // The manager has no manager above it: route "talk to manager" to the
            // main agent instead of erroring (Gauntlet v2 friction).
            return teamAgentCapabilityExecutor.execute({
              ...ctx,
              name: 'message_main_agent',
              args: {
                team_id: noteContext.teamId,
                message,
                wait_for_reply: waitForReply,
                message_type: waitForReply ? 'planning' : 'status',
              },
            });
          }
          if (!noteContext || noteContext.authorType !== 'subagent') {
            return { name, args, result: 'ERROR: talk_to_manager only works inside a team session. Could not identify team.', error: true };
          }
          const team = getManagedTeam(noteContext.teamId);
          const fromAgentId = noteContext.authorId;
          if (!team) return { name, args, result: `ERROR: Team not found: ${noteContext.teamId}`, error: true };
          const fromAgent = getAgentById(fromAgentId) as any;
          queueManagerMessage(team.id, fromAgentId, message);
          appendAndBroadcastTeamChat(deps, team, {
            from: 'subagent',
            fromName: String(fromAgent?.name || fromAgentId).trim(),
            fromAgentId,
            content: message,
            metadata: {
              source: 'talk_to_manager',
              agentId: fromAgentId,
              waitForReply,
              messageType: waitForReply ? 'blocker' : 'chat',
              ...getTeamChatTargetMetadata('manager'),
            },
          });
          try {
            const subagentChatMsg = appendSubagentChatMessage(fromAgentId, {
              role: 'agent',
              content: `${waitForReply ? 'Question for manager' : 'Message to manager'}: ${message}`,
              metadata: {
                source: 'talk_to_manager',
                teamId: team.id,
                waitForReply,
              },
            });
            deps.broadcastWS?.({ type: 'subagent_chat_message', agentId: fromAgentId, message: subagentChatMsg });
          } catch {}
          if (waitForReply) {
            const pausedTaskSummary = listTaskSummaries({ status: ['running', 'queued'] })
              .filter((t: any) => t.sessionId === sessionId)
              .sort((a: any, b: any) => Number(b.startedAt || 0) - Number(a.startedAt || 0))[0];
            const pausedTask = pausedTaskSummary ? loadTask(pausedTaskSummary.id) : null;
            if (pausedTask) {
              pausedTask.status = 'awaiting_user_input';
              pausedTask.pauseReason = 'awaiting_user_input';
              pausedTask.pendingClarificationQuestion = message;
              pausedTask.lastProgressAt = Date.now();
              saveTask(pausedTask);
              appendJournal(pausedTask.id, { type: 'pause', content: `Paused waiting for manager response: ${message.slice(0, 200)}` });
              try { deps.broadcastWS({ type: 'task_awaiting_input', taskId: pausedTask.id, question: message, teamId: team.id, agentId: fromAgentId }); } catch {}
            } else {
              updateTeamMemberState(team.id, fromAgentId, {
                status: 'waiting_for_context',
                currentTask: message,
                blockedReason: message,
              });
            }
          }
          console.log(`[talk_to_manager] Agent "${fromAgentId}" queued message to manager in team "${team.name}"`);
          return {
            name,
            args,
            result: waitForReply
              ? `Message sent to manager of team "${team.name}". ${sessionId.startsWith('team_dispatch_') ? 'This task is paused waiting for their reply.' : 'They can answer in the team room.'}`
              : `Message sent to manager of team "${team.name}". They will see it on their next review cycle.`,
            error: false,
          };
        } catch (e: any) {
          return { name, args, result: `ERROR: ${e.message}`, error: true };
        }
      }

      case 'request_context':
      case 'request_manager_help': {
        const rawMessage = name === 'request_context'
          ? String(args?.question || args?.message || '').trim()
          : String(args?.message || args?.question || '').trim();
        const waitForReply = args?.wait_for_reply !== false;
        if (!rawMessage) {
          return {
            name,
            args,
            result: `ERROR: ${name === 'request_context' ? 'question' : 'message'} is required`,
            error: true,
          };
        }
        const noteContext = inferTeamNoteContext(sessionId);
        if (!noteContext || noteContext.authorType !== 'subagent') {
          return { name, args, result: `ERROR: ${name} only works inside a team subagent session.`, error: true };
        }
        const team = getManagedTeam(noteContext.teamId);
        if (!team) return { name, args, result: `ERROR: Team not found: ${noteContext.teamId}`, error: true };
        const fromAgentId = noteContext.authorId;
        const fromAgent = getAgentById(fromAgentId) as any;
        const prefix = name === 'request_context' ? 'Context request' : 'Manager help request';
        const message = `${prefix}: ${rawMessage}`;
        try {
          const subagentChatMsg = appendSubagentChatMessage(fromAgentId, {
            role: 'agent',
            content: message,
            metadata: {
              source: name,
              teamId: team.id,
              waitForReply,
            },
          });
          deps.broadcastWS?.({ type: 'subagent_chat_message', agentId: fromAgentId, message: subagentChatMsg });
        } catch {}

        appendAndBroadcastTeamChat(deps, team, {
          from: 'subagent',
          fromName: String(fromAgent?.name || fromAgentId).trim(),
          fromAgentId,
          content: message,
          metadata: {
            source: name,
            agentId: fromAgentId,
            waitForReply,
            messageType: 'blocker',
            ...getTeamChatTargetMetadata('manager'),
          },
        });

        routeTeamEvent({
          type: 'member_blocked',
          teamId: team.id,
          agentId: fromAgentId,
          agentName: String(fromAgent?.name || fromAgentId).trim(),
          task: String(args?.current_task || '').trim(),
          resultSummary: rawMessage,
          source: name,
        });
        updateTeamMemberState(team.id, fromAgentId, {
          status: 'waiting_for_context',
          currentTask: String(args?.current_task || rawMessage).slice(0, 500),
          blockedReason: rawMessage,
        });

        if (waitForReply) {
          const pausedTaskSummary = listTaskSummaries({ status: ['running', 'queued'] })
            .filter((t: any) => t.sessionId === sessionId)
            .sort((a: any, b: any) => Number(b.startedAt || 0) - Number(a.startedAt || 0))[0];
          const pausedTask = pausedTaskSummary ? loadTask(pausedTaskSummary.id) : null;
          if (pausedTask) {
            pausedTask.status = 'awaiting_user_input';
            pausedTask.pauseReason = 'awaiting_user_input';
            pausedTask.pendingClarificationQuestion = message;
            pausedTask.lastProgressAt = Date.now();
            saveTask(pausedTask);
            appendJournal(pausedTask.id, { type: 'pause', content: `Paused waiting for manager response: ${message.slice(0, 200)}` });
            try { deps.broadcastWS({ type: 'task_awaiting_input', taskId: pausedTask.id, question: message, teamId: team.id, agentId: fromAgentId }); } catch {}
          }
        }

        return {
          name,
          args,
          result: waitForReply
            ? `${prefix} sent to manager of team "${team.name}". This session is waiting for a manager reply.`
            : `${prefix} sent to manager of team "${team.name}".`,
          error: false,
        };
      }

      case 'request_team_member_turn': {
        const teamId = String(args?.team_id || '').trim();
        const agentId = String(args?.agent_id || '').trim();
        const prompt = String(args?.prompt || args?.message || '').trim();
        const background = args?.background === true;
        if (!teamId || !agentId || !prompt) {
          return { name, args, result: 'ERROR: request_team_member_turn requires team_id, agent_id, and prompt', error: true };
        }
        const noteContext = inferTeamNoteContext(sessionId);
        if (!noteContext || noteContext.authorType !== 'manager' || noteContext.teamId !== teamId) {
          return { name, args, result: 'ERROR: request_team_member_turn only works from the team manager session for the same team.', error: true };
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

        deps.bindTeamNotificationTargetFromSession(teamId, sessionId, 'request_team_member_turn');
        const agentName = String((getAgentById(agentId) as any)?.name || agentId).trim();
        const inviteChatMsg = appendTeamChat(teamId, {
          from: 'manager',
          fromName: 'Manager',
          content: `Asked ${agentName} to weigh in: ${prompt}`,
          metadata: { agentId },
        });
        try {
          const subagentChatMsg = appendSubagentChatMessage(agentId, {
            role: 'user',
            content: prompt,
            metadata: {
              source: background ? 'request_team_member_turn_background' : 'request_team_member_turn',
              teamId,
              from: 'manager',
            },
          });
          deps.broadcastWS?.({ type: 'subagent_chat_message', agentId, message: subagentChatMsg });
        } catch {}
        deps.broadcastTeamEvent({
          type: 'team_chat_message',
          teamId,
          teamName: team.name,
          chatMessage: inviteChatMsg,
          text: String(inviteChatMsg?.content || ''),
        });

        const startedAt = Date.now();
        const publishTeamMemberRoomResult = (result: any, fallbackTaskId?: string) => {
          const finishedAt = Date.now();
          recordTeamRun(teamId, {
            agentId,
            agentName: result?.agentName || agentName,
            trigger: 'manual',
            taskId: result?.taskId || fallbackTaskId,
            success: result?.success === true,
            startedAt,
            finishedAt,
            durationMs: Number(result?.durationMs || Math.max(0, finishedAt - startedAt)),
            stepCount: Number(result?.stepCount || 0),
            error: result?.success === true ? undefined : String(result?.error || result?.result || 'unknown error'),
            resultPreview: result?.success === true ? String(result?.result || '').slice(0, 3000) : undefined,
            processEntries: result?.processEntries,
            liveTraceEntries: result?.liveTraceEntries,
          });
          deps.broadcastTeamEvent({
            type: 'team_subagent_completed',
            teamId,
            teamName: team.name,
            agentId,
            agentName: result?.agentName || agentName,
            taskId: result?.taskId || fallbackTaskId,
            success: result?.success === true,
            resultPreview: String(result?.result || result?.error || '').slice(0, 800),
            trigger: 'manual',
          });
        };
        const run = async () => runTeamMemberRoomTurn(teamId, agentId, prompt);

        if (background) {
          const taskId = `team_room_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
          const promise = run()
            .then((result) => {
              publishTeamMemberRoomResult(result, taskId);
              const entry = _bgAgentResults.get(taskId);
              if (entry) {
                entry.status = result.success ? 'complete' : 'failed';
                entry.result = result;
              }
              try {
                const subagentChatMsg = appendSubagentChatMessage(agentId, {
                  role: 'agent',
                  content: result.success
                    ? String(result.result || '').trim() || 'Turn complete.'
                    : `Turn failed: ${result.error || result.result || 'unknown error'}`,
                  metadata: {
                    source: 'request_team_member_turn_background',
                    teamId,
                    taskId,
                    success: result.success,
                    durationMs: result.durationMs,
                    stepCount: result.stepCount,
                    thinking: result.thinking,
                    processEntries: result.processEntries,
                    liveTraceEntries: result.liveTraceEntries,
                  },
                });
                deps.broadcastWS?.({ type: 'subagent_chat_message', agentId, message: subagentChatMsg });
              } catch {}
              return result;
            })
            .catch((err: any) => {
              const result: any = {
                success: false,
                result: '',
                error: String(err?.message || err),
                durationMs: 0,
                agentName,
              };
              publishTeamMemberRoomResult(result, taskId);
              const entry = _bgAgentResults.get(taskId);
              if (entry) {
                entry.status = 'failed';
                entry.result = result;
              }
              try {
                const subagentChatMsg = appendSubagentChatMessage(agentId, {
                  role: 'agent',
                  content: `Turn failed: ${result.error}`,
                  metadata: {
                    source: 'request_team_member_turn_background',
                    teamId,
                    taskId,
                    success: false,
                    thinking: result.thinking,
                    processEntries: result.processEntries,
                    liveTraceEntries: result.liveTraceEntries,
                  },
                });
                deps.broadcastWS?.({ type: 'subagent_chat_message', agentId, message: subagentChatMsg });
              } catch {}
              return result;
            });
          _bgAgentResults.set(taskId, {
            status: 'running',
            agentId,
            teamId,
            startedAt: Date.now(),
            promise,
          });
          return {
            name,
            args,
            result: JSON.stringify({
              success: true,
              status: 'running',
              task_id: taskId,
              team_id: teamId,
              agent_id: agentId,
              mode: 'room_turn',
            }, null, 2),
            error: false,
          };
        }

        const result = await run();
        publishTeamMemberRoomResult(result);
        try {
          const subagentChatMsg = appendSubagentChatMessage(agentId, {
            role: 'agent',
            content: result.success
              ? String(result.result || '').trim() || 'Turn complete.'
              : `Turn failed: ${result.error || result.result || 'unknown error'}`,
            metadata: {
              source: 'request_team_member_turn',
              teamId,
              taskId: result.taskId,
              success: result.success,
              durationMs: result.durationMs,
              stepCount: result.stepCount,
              thinking: result.thinking,
              processEntries: result.processEntries,
              liveTraceEntries: result.liveTraceEntries,
            },
          });
          deps.broadcastWS?.({ type: 'subagent_chat_message', agentId, message: subagentChatMsg });
        } catch {}
        return {
          name,
          args,
          result: JSON.stringify({
            success: result.success,
            team_id: teamId,
            agent_id: agentId,
            agent_name: result.agentName,
            run_id: result.taskId,
            duration_ms: result.durationMs,
            step_count: result.stepCount,
            mode: 'room_turn',
            result: result.result,
            error: result.error,
          }, null, 2),
          error: result.success !== true,
        };
      }

      case 'update_my_status': {
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
          return { name, args, result: `Status updated: ${status.status}${status.currentTask ? ' - ' + status.currentTask.slice(0, 60) : ''}`, error: false };
        } catch (err: any) {
          return { name, args, result: `update_my_status error: ${err.message}`, error: true };
        }
      }

      case 'update_team_goal': {
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
          return { name, args, result: `${String(args.goal_id || '').trim() ? 'Goal updated' : 'Goal created'}: ${goal.id} - ${goal.description}`, error: false };
        } catch (err: any) {
          return { name, args, result: `update_team_goal error: ${err.message}`, error: true };
        }
      }

      case 'post_to_team_chat': {
        const teamId = String(args?.team_id || '').trim();
        const message = String(args?.message || '').trim();
        if (!teamId || !message) return { name, args, result: 'ERROR: post_to_team_chat requires team_id and message', error: true };
        const team = getManagedTeam(teamId);
        if (!team) return { name, args, result: `ERROR: Team not found: ${teamId}`, error: true };
        const teamContext = inferTeamNoteContext(sessionId);
        const isSubagentSpeaker = teamContext?.teamId === teamId && teamContext.authorType === 'subagent';
        const speakerAgentId = isSubagentSpeaker ? teamContext?.authorId : undefined;
        const speakerAgent = speakerAgentId ? getAgentById(speakerAgentId) as any : null;
        const chatMsg = appendAndBroadcastTeamChat(deps, team, {
          from: isSubagentSpeaker ? 'subagent' : 'manager',
          fromName: isSubagentSpeaker
            ? String(speakerAgent?.name || speakerAgentId || 'Subagent')
            : 'Manager',
          fromAgentId: speakerAgentId,
          content: message,
          metadata: {
            source: 'post_to_team_chat',
            agentId: speakerAgentId,
            ...getTeamChatTargetMetadata('all'),
          },
        });
        return { name, args, result: JSON.stringify({ success: true, team_id: teamId, message_id: chatMsg?.id || null }, null, 2), error: false };
      }

      case 'message_main_agent': {
        const teamId = String(args?.team_id || '').trim();
        const message = String(args?.message || '').trim();
        const waitForReply = args?.wait_for_reply !== false;
        const messageType = String(args?.message_type || 'planning').trim().toLowerCase();
        if (!teamId || !message) return { name, args, result: 'ERROR: message_main_agent requires team_id and message', error: true };
        const team = getManagedTeam(teamId);
        if (!team) return { name, args, result: `ERROR: Team not found: ${teamId}`, error: true };
        const type = (['planning', 'error', 'status'].includes(messageType) ? messageType : 'planning') as 'planning' | 'error' | 'status';
        const threadMsg = appendMainAgentThread(teamId, { from: 'coordinator', content: message, read: false, type });
        const chatMsg = appendTeamChat(teamId, { from: 'manager', fromName: 'Manager', content: `Message to main agent (${type}): ${message}` });
        try {
          const mainWorkspacePath = getConfig().getWorkspacePath() || workspacePath;
          notifyMainAgent(mainWorkspacePath, teamId, type === 'error' ? 'team_error' : 'team_task_complete', {
            task: 'Coordinator message',
            result: message,
            messageType: type,
            waitForReply,
            threadMessageId: threadMsg?.id,
          }, team.name, team.originatingSessionId);
        } catch {}
        deps.broadcastTeamEvent({ type: 'team_chat_message', teamId, teamName: team.name, chatMessage: chatMsg, message });
        return { name, args, result: JSON.stringify({ success: true, team_id: teamId, waiting_for_reply: waitForReply, thread_message_id: threadMsg?.id || null }, null, 2), error: false };
      }

      case 'reply_to_team': {
        const teamId = String(args?.team_id || '').trim();
        const message = String(args?.message || '').trim();
        if (!teamId || !message) return { name, args, result: 'ERROR: reply_to_team requires team_id and message', error: true };
        const team = getManagedTeam(teamId);
        if (!team) return { name, args, result: `ERROR: Team not found: ${teamId}`, error: true };
        const route = parseMainAgentTeamRoute(message);
        const visibleMessage = route.text || message;
        if (route.route === 'member') {
          const targetAgentId = resolveMainAgentTeamMemberId(team, route.targetLabel || '');
          if (!targetAgentId) {
            return {
              name,
              args,
              result: `ERROR: Could not find team member "${route.targetLabel || ''}" on team "${team.name}".`,
              error: true,
            };
          }
          route.targetAgentId = targetAgentId;
        }

        appendMainAgentThread(teamId, {
          from: 'main_agent',
          content: visibleMessage,
          read: true,
          type: 'reply',
        });
        const chatMsg = appendTeamChat(teamId, {
          from: 'user',
          fromName: 'Main Agent',
          content: visibleMessage,
          metadata: {
            source: 'reply_to_team',
            targetType: route.route,
            targetLabel: route.targetLabel,
            targetId: route.targetAgentId,
          },
        });
        deps.broadcastTeamEvent({ type: 'team_chat_message', teamId, teamName: team.name, chatMessage: chatMsg, message: visibleMessage });

        if (route.route === 'manager') {
          handleManagerConversation(teamId, `[MAIN AGENT REPLY]\n${visibleMessage}`, deps.broadcastTeamEvent, true).catch((err: any) =>
            console.error('[reply_to_team] Coordinator resume failed:', err?.message || err)
          );
          return { name, args, result: JSON.stringify({ success: true, team_id: teamId, routed_to: 'manager', resumed: true }, null, 2), error: false };
        }

        (async () => {
          const delivery = await deliverMainAgentMessageToTeamMembers(
            teamId,
            team,
            visibleMessage,
            route.targetAgentId,
            route.route === 'member' ? route.targetLabel : undefined,
          );
          const managerPrompt = buildMainAgentMembersRespondedPrompt(
            visibleMessage,
            delivery.deliveredCount,
            delivery.completedCount,
            route.route === 'member' ? route.targetLabel : undefined,
          );
          await handleManagerConversation(teamId, managerPrompt, deps.broadcastTeamEvent, false);
        })().catch((err: any) =>
          console.error('[reply_to_team] Team broadcast delivery failed:', err?.message || err)
        );

        return {
          name,
          args,
          result: JSON.stringify({
            success: true,
            team_id: teamId,
            routed_to: route.route,
            target_agent_id: route.targetAgentId || null,
            team_delivery_started: true,
            manager_resumes_after_member_responses: true,
          }, null, 2),
          error: false,
        };
      }

      case 'manage_team_goal': {
        const teamId = String(args?.team_id || '').trim();
        const actionRaw = String(args?.action || '').trim().toLowerCase();
        const action = normalizeTeamGoalAction(actionRaw);
        if (!teamId || !action) return { name, args, result: 'ERROR: manage_team_goal requires team_id and action', error: true };
        const team = getManagedTeam(teamId);
        if (!team) return { name, args, result: `ERROR: Team not found: ${teamId}`, error: true };
        let ok = false;
        let data: any = { team_id: teamId, action };
        let shouldMirrorGoalUpdateToChat = action !== 'set_focus';
        if (action === 'set_focus') {
          const value = String(args?.value || args?.focus || '').trim();
          if (!value) return { name, args, result: 'ERROR: set_focus requires value', error: true };
          const currentFocus = String((team as any)?.currentFocus || (team as any)?.roomState?.runGoal || '').trim();
          if (currentFocus && currentFocus === value) {
            return { name, args, result: JSON.stringify({ success: true, unchanged: true, ...data, focus: value }, null, 2), error: false };
          }
          ok = updateTeamFocus(teamId, value);
          data.focus = value;
          shouldMirrorGoalUpdateToChat = args?.announce === true || args?.mirror_to_chat === true;
        } else if (action === 'set_mission' || action === 'add_milestone' || action === 'update_milestone') {
          return { name, args, result: `ERROR: manage_team_goal action "${action}" was removed. Use set_focus or log_completed; change the team purpose with team_manage(update).`, error: true };
        } else if (action === 'log_completed') {
          const value = String(args?.value || args?.entry || '').trim();
          if (!value) return { name, args, result: 'ERROR: log_completed requires value', error: true };
          ok = logCompletedWork(teamId, value);
          data.entry = value;
        } else if (action === 'pause_agent') {
          const agentId = String(args?.agent_id || '').trim();
          if (!agentId) return { name, args, result: 'ERROR: pause_agent requires agent_id', error: true };
          ok = pauseTeamAgent(teamId, agentId, String(args?.reason || '').trim() || undefined);
          data.agent_id = agentId;
        } else if (action === 'unpause_agent') {
          const agentId = String(args?.agent_id || '').trim();
          if (!agentId) return { name, args, result: 'ERROR: unpause_agent requires agent_id', error: true };
          ok = unpauseTeamAgent(teamId, agentId);
          data.agent_id = agentId;
        } else {
          return { name, args, result: `ERROR: Unknown manage_team_goal action "${actionRaw}".`, error: true };
        }
        if (ok) {
          deps.broadcastTeamEvent({ type: 'team_goal_updated', teamId, teamName: team.name, action, data });
          if (shouldMirrorGoalUpdateToChat) {
            const chatMsg = appendTeamChat(teamId, { from: 'manager', fromName: 'Manager', content: `Goal update (${action}): ${JSON.stringify(data).slice(0, 500)}` });
            deps.broadcastTeamEvent({ type: 'team_chat_message', teamId, teamName: team.name, chatMessage: chatMsg });
          }
        }
        return { name, args, result: JSON.stringify({ success: ok, ...data }, null, 2), error: !ok };
      }

      case 'manage_team_context_ref': {
        const action = String(args?.action || '').trim().toLowerCase();
        const teamId = String(args?.team_id || '').trim();
        if (!action) return { name, args, result: 'ERROR: manage_team_context_ref requires action', error: true };

        if (action === 'list') {
          if (teamId) {
            const team = getManagedTeam(teamId);
            if (!team) return { name, args, result: `ERROR: Team not found: ${teamId}`, error: true };
            const references = listTeamContextReferences(teamId);
            return {
              name,
              args,
              result: JSON.stringify({ success: true, team_id: teamId, team_name: team.name, references }, null, 2),
              error: false,
            };
          }
          const teams = listManagedTeams().map((team: any) => ({
            id: team.id,
            name: team.name,
            reference_count: listTeamContextReferences(team.id).length,
          }));
          return { name, args, result: JSON.stringify({ success: true, teams }, null, 2), error: false };
        }

        if (!teamId) return { name, args, result: 'ERROR: team_id is required for add/update/delete', error: true };
        const team = getManagedTeam(teamId);
        if (!team) return { name, args, result: `ERROR: Team not found: ${teamId}`, error: true };

        if (action === 'add') {
          const title = String(args?.title || '').trim();
          const content = String(args?.content || '').trim();
          if (!title || !content) return { name, args, result: 'ERROR: title and content are required for add', error: true };
          const reference = addTeamContextReference(teamId, {
            title,
            content,
            actor: 'tool:manage_team_context_ref',
          });
          if (!reference) return { name, args, result: 'ERROR: Could not create context reference', error: true };
          deps.broadcastTeamEvent({ type: 'team_updated', teamId, teamName: team.name });
          return {
            name,
            args,
            result: JSON.stringify({ success: true, action, team_id: teamId, reference }, null, 2),
            error: false,
          };
        }

        if (action === 'update') {
          const refId = String(args?.ref_id || '').trim();
          if (!refId) return { name, args, result: 'ERROR: ref_id is required for update', error: true };
          const patch: { title?: string; content?: string; actor?: string } = { actor: 'tool:manage_team_context_ref' };
          if (args?.title !== undefined) patch.title = String(args.title);
          if (args?.content !== undefined) patch.content = String(args.content);
          if (patch.title === undefined && patch.content === undefined) {
            return { name, args, result: 'ERROR: update requires title or content', error: true };
          }
          const reference = updateTeamContextReference(teamId, refId, patch);
          if (!reference) return { name, args, result: `ERROR: Context reference not found or invalid update: ${refId}`, error: true };
          deps.broadcastTeamEvent({ type: 'team_updated', teamId, teamName: team.name });
          return {
            name,
            args,
            result: JSON.stringify({ success: true, action, team_id: teamId, reference }, null, 2),
            error: false,
          };
        }

        if (action === 'delete') {
          const refId = String(args?.ref_id || '').trim();
          if (!refId) return { name, args, result: 'ERROR: ref_id is required for delete', error: true };
          const success = deleteTeamContextReference(teamId, refId);
          if (!success) return { name, args, result: `ERROR: Context reference not found: ${refId}`, error: true };
          deps.broadcastTeamEvent({ type: 'team_updated', teamId, teamName: team.name });
          return {
            name,
            args,
            result: JSON.stringify({ success: true, action, team_id: teamId, ref_id: refId }, null, 2),
            error: false,
          };
        }

        return { name, args, result: `ERROR: Unknown manage_team_context_ref action "${action}". Valid: list, add, update, delete`, error: true };
      }

      case 'spawn_subagent': {
        try {
          let subagentId = String(args.subagent_id || '').trim();
          const taskPrompt = String(args.task_prompt || '').trim();
          const runNow = args.run_now !== false;
          const contextData = args.context_data && typeof args.context_data === 'object' ? args.context_data : undefined;
          let createIfMissing = args.create_if_missing && typeof args.create_if_missing === 'object' ? { ...args.create_if_missing } : undefined;

          const fromRole = args.from_role ? String(args.from_role).trim().toLowerCase() : null;
          if (fromRole) {
            try {
              const configDir = getConfig().getConfigDir ? getConfig().getConfigDir() : path.join(process.cwd(), '.prometheus');
              const registryPath = path.join(configDir, 'agents', `${fromRole}.json`);
              if (fs.existsSync(registryPath)) {
                const roleDef = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
                const specialization = String(args.specialization || createIfMissing?.teamAssignment || createIfMissing?.teamRole || '').trim();
                const roleName = String(roleDef.name || fromRole.charAt(0).toUpperCase() + fromRole.slice(1)).trim();
                const derivedTeamRole = String(createIfMissing?.teamRole || '').trim()
                  || (specialization
                    ? specialization.split(/[.!?\n]/)[0].replace(/^focus on\s+/i, '').slice(0, 80)
                    : roleName);
                const derivedDescription = String(createIfMissing?.description || '').trim()
                  || (specialization || roleDef.description || '');
                const combinedSystemInstructions = [
                  `[BASE PRESET ROLE - ${roleName}]`,
                  String(roleDef.system_prompt || '').trim(),
                  ``,
                  `[SUBAGENT SPECIALIZATION - ${derivedTeamRole}]`,
                  specialization || 'No specialization was provided. Infer the assignment from the direct task message.',
                  ``,
                  `When the specialization conflicts with the generic preset, follow the specialization while preserving the preset's quality bar and deliverable discipline.`,
                ].filter(Boolean).join('\n');
                createIfMissing = {
                  name: createIfMissing?.name,
                  description: derivedDescription,
                  system_instructions: createIfMissing?.system_instructions || combinedSystemInstructions,
                  forbidden_tools: createIfMissing?.forbidden_tools || [],
                  constraints: createIfMissing?.constraints || [],
                  success_criteria: createIfMissing?.success_criteria || `Complete the assigned task and post the done signal.`,
                  max_steps: createIfMissing?.max_steps || 20,
                  model: createIfMissing?.model || roleDef.model || undefined,
                  roleType: fromRole,
                  teamRole: derivedTeamRole,
                  teamAssignment: String(createIfMissing?.teamAssignment || specialization || '').trim(),
                  baseRolePrompt: String(roleDef.system_prompt || '').trim(),
                };
              } else {
                console.warn(`[spawn_subagent] Role registry file not found: ${registryPath}`);
              }
            } catch (roleErr: any) {
              console.warn(`[spawn_subagent] Failed to load role "${fromRole}": ${roleErr.message}`);
            }
          }

          if (createIfMissing) {
            if (args.personality_style !== undefined && createIfMissing.personality_style === undefined) {
              createIfMissing.personality_style = String(args.personality_style || '').trim();
            }
            if (args.name_style !== undefined && createIfMissing.name_style === undefined) {
              createIfMissing.name_style = String(args.name_style || '').trim();
            }
          }

          if (!subagentId) {
            if (!createIfMissing) return { name, args, result: 'spawn_subagent requires subagent_id unless create_if_missing is provided', error: true };
            const seed = String(createIfMissing.name || createIfMissing.description || fromRole || 'disposable_agent')
              .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'disposable_agent';
            subagentId = `${seed}_${Date.now().toString(36)}`;
          }
          if (runNow && !taskPrompt) return { name, args, result: 'spawn_subagent requires task_prompt when run_now=true', error: true };
          if (createIfMissing) {
            createIfMissing.description = String(createIfMissing.description || `Standalone subagent ${subagentId}`).trim();
            createIfMissing.system_instructions = String(createIfMissing.system_instructions || 'Complete assigned tasks accurately, efficiently, and report concrete results.').trim();
            createIfMissing.constraints = createIfMissing.constraints == null ? [] : createIfMissing.constraints;
            createIfMissing.success_criteria = String(createIfMissing.success_criteria || (taskPrompt ? `Complete the assigned task: ${taskPrompt.slice(0, 240)}` : 'Complete assigned tasks and return a concrete result.')).trim();
            const fieldErrors: string[] = [];
            if (!Array.isArray(createIfMissing.constraints)) fieldErrors.push('create_if_missing.constraints must be an array (use [] when none)');
            for (const field of ['allowed_tools', 'forbidden_tools', 'mcp_servers', 'skillIds', 'context_refs']) {
              if (createIfMissing[field] != null && !Array.isArray(createIfMissing[field])) fieldErrors.push(`create_if_missing.${field} must be an array`);
            }
            if (fieldErrors.length) return { name, args, result: JSON.stringify({ ok: false, code: 'INVALID_CREATE_SCHEMA', generated_subagent_id: subagentId, errors: fieldErrors }, null, 2), error: true };
          }

          const managerWorkspacePath = getConfig().getConfig().workspace?.path || process.cwd();
          const subagentMgr = new SubagentManager(managerWorkspacePath, deps.broadcastWS, deps.handleChat, deps.telegramChannel);
          const result = await subagentMgr.callSubagent(
            {
              subagent_id: subagentId,
              task_prompt: taskPrompt,
              run_now: runNow,
              context_data: contextData,
              create_if_missing: createIfMissing,
            },
            sessionId,
          );

          return {
            name,
            args,
            result: JSON.stringify(result, null, 2),
            error: false,
          };
        } catch (err: any) {
          return { name, args, result: `spawn_subagent error: ${err.message}`, error: true };
        }
      }

      case 'ask_team_coordinator': {
        try {
          const goal = String(args.goal || '').trim();
          const extraContext = String(args.context || '').trim();
          if (!goal) return { name, args, result: 'ask_team_coordinator requires goal', error: true };

          const coordSessionId = `meta_coordinator_${Date.now().toString(36)}`;
          const originatingSessionId = sessionId;
          const configDir = (getConfig() as any).getConfigDir
            ? (getConfig() as any).getConfigDir()
            : path.join(process.cwd(), '.prometheus');
          const registryPath = path.join(configDir, 'agents');

          let rolesBlock = '(no role registry found - use spawn_subagent with full create_if_missing)';
          try {
            if (fs.existsSync(registryPath)) {
              const roleFiles = fs.readdirSync(registryPath).filter((f: string) => f.endsWith('.json'));
              const roleLines = roleFiles.map((f: string) => {
                try {
                  const r = JSON.parse(fs.readFileSync(path.join(registryPath, f), 'utf-8'));
                  return `- ${r.role}: ${r.description}`;
                } catch {
                  return null;
                }
              }).filter(Boolean);
              if (roleLines.length > 0) rolesBlock = roleLines.join('\n');
            }
          } catch {}

          const coordinatorCallerContext = [
            `=== META-COORDINATOR MODE ===`,
            `You are the Team Coordinator for Prometheus. Your ONLY job is to compose and launch ONE team for the given purpose, then return a summary. You do nothing else.`,
            ``,
            `ORIGINATING_SESSION_ID: ${originatingSessionId}`,
            ``,
            `AVAILABLE ROLE TYPES (role registry):`,
            rolesBlock,
            ``,
            `YOUR WORKFLOW (execute immediately, no clarifying questions):`,
            `0. Run memory_search for the goal and additional context before creating anything. Use relevant business/user/project memory to enrich the team purpose, role specializations, and context references.`,
            `1. Analyze the purpose - pick 2-4 roles that cover the ongoing work`,
            `2. For each role, call spawn_subagent with:`,
            `   - subagent_id: "<role>_<shortname>_v1" (e.g. "researcher_growth_v1")`,
            `   - from_role: "<role>" (e.g. "researcher")`,
            `   - specialization: a concrete team-specific assignment, not a generic role.`,
            `   - optional create_if_missing.teamRole: a short title like "Website/SEO Qualifier"`,
            `   - optional create_if_missing.teamAssignment: the full concrete assignment if it needs more detail than specialization`,
            `   - run_now: false`,
            `3. Call team_manage(action="create") with:`,
            `   - name, purpose (the static team purpose - NOT a one-time task), subagent_ids (all created agents)`,
            `   - originating_session_id: "${originatingSessionId}"`,
            `   PURPOSE NOTE: The team's purpose is static ("why this team exists"). Each run, the coordinator reads memory files and generates a fresh task from accumulated context. Do NOT set purpose to a one-time task - it should be an enduring mandate.`,
            `4. Respond with a brief summary: team name, team_id, agents created, purpose, status "ready (not started)".`,
            `5. End with this exact follow-up question to the main agent:`,
            `   "Team is ready. Would you like to start it now? If yes, what should the first task be?"`,
            `   Mention that team_info.md was created automatically in the team workspace and that context reference cards should be used for relevant memory/context found during preflight.`,
            ``,
            `STRICT RULES:`,
            `- Maximum 5 agents`,
            `- Do NOT ask questions - make decisions and act`,
            `- Do NOT use browser, desktop, scheduling, or memory tools`,
            `- Exception: do use memory_search before creating agents or the team`,
            `- Do NOT create nested teams`,
            `- NEVER start the team from this meta-coordinator flow. "Create now" means create the team now, not run it. The main chat agent or user must explicitly call team_manage(action="start") later with a first task.`,
            `- Do NOT call team_manage(action="start"), team_manage(action="dispatch"), dispatch_team_agent, schedule_job(action="run_now"), or kickoff_initial_review:true in this flow.`,
            `- Do NOT inspect random workspace files, pending tasks, or agent_info on the team ID after setup`,
            `- team_ops tools are available in this coordinator session. Do NOT claim tooling limitations or say a team_ops tool is unavailable unless you actually called it and received an explicit tool error in this turn`,
            `- Your session ends after the summary - the team manager takes over`,
            `=== END META-COORDINATOR MODE ===`,
          ].join('\n');

          const { activateToolCategory } = require('../../session');
          activateToolCategory(coordSessionId, 'team_ops');

          const coordModelStr: string | undefined = (getConfig().getConfig() as any)?.agent_model_defaults?.coordinator;
          const coordForwardSse = (event: string, data: any) => {
            if (!data || typeof data !== 'object') return;
            let msg: string | null = null;
            if (event === 'tool_call' && data.action) {
              const argsPreview = data.args ? ' ' + JSON.stringify(data.args).slice(0, 100) : '';
              msg = `${data.action}${argsPreview}`;
            } else if (event === 'tool_result' && data.action) {
              const ok = !data.error;
              const preview = String(data.result || '').slice(0, 120);
              msg = `${data.action} ${ok ? 'ok' : 'error'}${preview ? ' - ' + preview : ''}`;
            } else if (event === 'info' && data.message) {
              msg = String(data.message).slice(0, 150);
            }
            if (msg) {
              deps.broadcastWS({
                type: 'coordinator_progress',
                sessionId: originatingSessionId,
                message: msg,
              });
            }
          };

          // Snapshot existing teams so we can verify the coordinator actually
          // created one. The coordinator sub-session can hallucinate a "team
          // created" summary without calling team_manage(create); returning
          // success unconditionally surfaces a phantom team that never appears in
          // the UI.
          const beforeTeamIds = new Set(listManagedTeams().map((t: any) => String(t.id)));
          const coordStartedAt = Date.now();

          const result = await deps.handleChat(
            goal + (extraContext ? `\n\nAdditional context: ${extraContext}` : ''),
            coordSessionId,
            coordForwardSse,
            undefined,
            undefined,
            coordinatorCallerContext,
            coordModelStr || undefined,
            'background_task',
          );

          const createdTeams = listManagedTeams().filter((t: any) => {
            if (beforeTeamIds.has(String(t.id))) return false;
            return t.originatingSessionId === originatingSessionId
              || Number(t.createdAt || 0) >= coordStartedAt;
          });

          if (createdTeams.length === 0) {
            return {
              name,
              args,
              result: JSON.stringify({
                success: false,
                error: 'Coordinator finished but no team was actually created (no team_manage(action="create") persisted). Do NOT tell the user a team was created. Retry ask_team_coordinator, or create the team directly with spawn_subagent + team_manage(action="create").',
                coordinator_summary: String(result?.text || '').slice(0, 1200),
                originating_session: originatingSessionId,
              }, null, 2),
              error: true,
            };
          }

          return {
            name,
            args,
            result: JSON.stringify({
              success: true,
              teams_created: createdTeams.map((t: any) => ({
                team_id: String(t.id),
                name: String(t.name || ''),
                purpose: String(t.purpose || '').slice(0, 300),
                agent_count: Array.isArray(t.subagentIds) ? t.subagentIds.length : 0,
              })),
              coordinator_summary: String(result?.text || '').slice(0, 1200),
              originating_session: originatingSessionId,
              next_step: 'ask_user_for_first_task_before_starting_team',
            }, null, 2),
            error: false,
          };
        } catch (err: any) {
          return { name, args, result: `ask_team_coordinator error: ${err.message}`, error: true };
        }
      }

      case 'set_current_model': {
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
          return {
            name,
            args,
            result: JSON.stringify({
              success: true,
              current_model: `${parsed.providerId}/${parsed.model}`,
              provider: parsed.providerId,
              model: parsed.model,
              reason: reason || null,
              note: 'Main Chat Agent route updated.',
            }, null, 2),
            error: false,
          };
        } catch (err: any) {
          return { name, args, result: `set_current_model error: ${err.message}`, error: true };
        }
      }

      case 'set_agent_model': {
        const targetAgentId = String(args?.agent_id || '').trim();
        const provider = String(args?.provider || '').trim();
        const rawModel = String(args?.model || '').trim();
        const model = provider && rawModel && !rawModel.includes('/') ? `${provider}/${rawModel}` : rawModel;
        const hasReasoning = typeof args?.reasoning_effort === 'string' || typeof args?.reasoning === 'string';
        const reasoningEffort = String(args?.reasoning_effort ?? args?.reasoning ?? '').trim();
        const agentType = String(args?.agent_type || '').trim();

        if (!model && !hasReasoning) {
          return { name, args, result: 'ERROR: provide model (optionally with provider) and/or reasoning_effort.', error: true };
        }

        const { host, port } = resolveGatewayAddress();

        try {
          if (targetAgentId) {
            const resp = await fetch(`http://${host}:${port}/api/agents/${encodeURIComponent(targetAgentId)}/model`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...(model ? { model } : {}), ...(hasReasoning ? { reasoning_effort: reasoningEffort } : {}) }),
            });
            const data = await resp.json() as any;
            if (!data?.success) return { name, args, result: `ERROR: ${data?.error || 'Failed to update agent model'}`, error: true };
            return { name, args, result: `Agent "${targetAgentId}" model set to "${model}". Takes effect on next spawn.`, error: false };
          }

          if (agentType) {
            if (!VALID_AGENT_MODEL_TYPES.includes(agentType)) {
              return { name, args, result: `ERROR: Invalid agent_type "${agentType}". Valid values: ${VALID_AGENT_MODEL_TYPES.join(', ')}`, error: true };
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
            const resp = await fetch(`http://${host}:${port}${endpoint}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const data = await resp.json() as any;
            if (!data?.success) return { name, args, result: `ERROR: Failed to update type default`, error: true };
            if (isGoalSupportRoute) {
              const route = data.session?.mainChatGoals || {};
              return { name, args, result: `Goal Support routing for "${agentType}" updated: model=${route[`${goalPrefix}Model`] || 'current main chat'}, reasoning=${route[`${goalPrefix}Reasoning`] || 'provider default'}.`, error: false };
            }
            // Report what was actually persisted, never the requested value.
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

      case 'get_agent_models': {
        try {
          const cfg = getConfig().getConfig() as any;
          const defaults = cfg.agent_model_defaults || {};
          const activeProvider = String(cfg.llm?.provider || '').trim() || null;
          const primaryModel = cfg.llm?.providers?.[cfg.llm?.provider]?.model || cfg.models?.primary || null;
          const agents = (cfg.agents || []).map((a: any) => ({
            id: a.id,
            name: a.name,
            model: a.model || null,
          }));
          const result = {
            current_primary: activeProvider && primaryModel ? `${activeProvider}/${primaryModel}` : primaryModel,
            current_provider: activeProvider,
            global_primary: primaryModel,
            agent_model_defaults: defaults,
            active_agent_model_default_template: cfg.active_agent_model_default_template || null,
            agent_model_default_templates: cfg.agent_model_default_templates || [],
            goal_support: {
              compactor: {
                model: cfg.session?.mainChatGoals?.compactionModel || null,
                reasoning_effort: cfg.session?.mainChatGoals?.compactionReasoning || null,
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

      case 'list_agent_model_templates':
      case 'save_agent_model_template':
      case 'update_agent_model_template':
      case 'apply_agent_model_template':
      case 'select_agent_model_template':
      case 'delete_agent_model_template': {
        const { host, port } = resolveGatewayAddress();
        const baseUrl = `http://${host}:${port}/api/settings/agent-model-default-templates`;

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
            if (!Object.keys(body).length) return { name, args, result: 'ERROR: provide name and/or defaults to update.', error: true };
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

      default:
        return { name, args, result: `Unhandled team/agent tool: ${name}`, error: true };
    }
  },
};
