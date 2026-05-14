import fs from 'fs';
import path from 'path';
import { getAgentById, getAgents, getConfig } from '../../../config/config';
import { recordAgentRun } from '../../../scheduler';
import { appendSubagentChatMessage } from '../subagent-chat-store';
import {
  appendJournal,
  listTasks,
  saveTask,
} from '../../tasks/task-store';
import {
  buildTeamDispatchTask,
  _bgAgentResults,
} from '../../teams/team-dispatch-runtime';
import {
  addTeamContextReference,
  addTeamMilestone,
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
  saveManagedTeam,
  shareTeamArtifact,
  unpauseTeamAgent,
  updateTeamContextReference,
  updateTeamDispatchRecord,
  updateTeamFocus,
  updateTeamMilestone,
  updateTeamMission,
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
import { SubagentManager } from '../subagent-manager';
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
  'dispatch_to_agent',
  'message_subagent',
  'get_agent_result',
  'talk_to_subagent',
  'talk_to_manager',
  'request_context',
  'request_manager_help',
  'request_team_member_turn',
  'dispatch_team_agent',
  'talk_to_teammate',
  'update_my_status',
  'update_team_goal',
  'share_artifact',
  'post_to_team_chat',
  'message_main_agent',
  'reply_to_team',
  'manage_team_goal',
  'manage_team_context_ref',
  'spawn_subagent',
  'team_manage',
  'ask_team_coordinator',
  'set_agent_model',
  'get_agent_models',
  'list_agent_model_templates',
  'save_agent_model_template',
  'apply_agent_model_template',
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
  'background_task',
  'background_agent',
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
            `- ${a.id}${a.default ? ' (default)' : ''}: ${a.description}${a.executionWorkspace ? ` [cwd: ${a.executionWorkspace}]` : ''}${a.allowedWorkPaths?.length ? ` [allowed: ${a.allowedWorkPaths.join(', ')}]` : ''}${a.schedule ? ` [scheduled: ${a.schedule}]` : ''}`
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
          return { name, args, result: JSON.stringify(agent, null, 2), error: false };
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
                executionWorkspace: updated.executionWorkspace || null,
                allowedWorkPaths: updated.allowedWorkPaths || [],
                max_steps: updated.max_steps,
                timeout_ms: updated.timeout_ms,
                identity: updated.identity || null,
                allowed_tools: updated.allowed_tools || [],
                forbidden_tools: updated.forbidden_tools || [],
                modified_at: updated.modified_at,
              },
            }, null, 2),
            error: false,
          };
        } catch (err: any) {
          return { name, args, result: `agent_update error: ${err.message}`, error: true };
        }
      }

      case 'dispatch_to_agent': {
        const agentId = String(args.agent_id || '').trim();
        const agentMessage = String(args.message || '').trim();
        const agentContext = args.context ? String(args.context) : undefined;

        if (!agentId) return { name, args, result: 'dispatch_to_agent requires agent_id', error: true };
        if (!agentMessage) return { name, args, result: 'dispatch_to_agent requires message', error: true };

        try {
          const dispatchResult = await deps.dispatchToAgent(agentId, agentMessage, agentContext, sessionId);
          return { name, args, result: JSON.stringify(dispatchResult), error: false };
        } catch (err: any) {
          return { name, args, result: `dispatch_to_agent error: ${err.message}`, error: true };
        }
      }

      case 'message_subagent': {
        const agentId = String(args.agent_id || '').trim();
        const message = String(args.message || '').trim();
        const context = args.context ? String(args.context).trim() : '';

        if (!agentId) return { name, args, result: 'message_subagent requires agent_id', error: true };
        if (!message) return { name, args, result: 'message_subagent requires message', error: true };

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

        try {
          const workspacePath = getConfig().getConfig().workspace?.path || process.cwd();
          const subagentMgr = new SubagentManager(workspacePath, deps.broadcastWS, deps.handleChat, deps.telegramChannel);
          const result = await subagentMgr.callSubagent(
            {
              subagent_id: agentId,
              task_prompt: [
                `Direct background message from main chat to standalone subagent "${agentId}".`,
                ``,
                `Message:`,
                message,
                ``,
                `Work in your subagent task thread. Keep intermediate collaboration in the subagent chat/task UI, not the main chat. If you need user input, ask clearly in the task so it can pause for assistance there.`,
              ].join('\n'),
              context_data: context ? { main_chat_context: context } : undefined,
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
                `Message sent to subagent "${agentId}" in the background. ` +
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
          if (!team) return { name, args, result: `ERROR: Could not find a team containing agent "${targetAgentId}". Check the agent ID.`, error: true };
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
          const pausedTask = listTasks({ status: ['awaiting_user_input'] })
            .filter((t: any) => t.teamSubagent?.teamId === team.id && t.teamSubagent?.agentId === targetAgentId)
            .sort((a: any, b: any) => Number(b.startedAt || 0) - Number(a.startedAt || 0))[0];
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
          if (!noteContext || noteContext.authorType !== 'subagent') {
            return { name, args, result: 'ERROR: talk_to_manager only works inside a team subagent session. Could not identify team.', error: true };
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
            const pausedTask = listTasks({ status: ['running', 'queued'] })
              .filter((t: any) => t.sessionId === sessionId)
              .sort((a: any, b: any) => Number(b.startedAt || 0) - Number(a.startedAt || 0))[0];
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
          const pausedTask = listTasks({ status: ['running', 'queued'] })
            .filter((t: any) => t.sessionId === sessionId)
            .sort((a: any, b: any) => Number(b.startedAt || 0) - Number(a.startedAt || 0))[0];
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

        const run = async () => runTeamMemberRoomTurn(teamId, agentId, prompt);

        if (background) {
          const taskId = `team_room_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
          const promise = run()
            .then((result) => {
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
                  },
                });
                deps.broadcastWS?.({ type: 'subagent_chat_message', agentId, message: subagentChatMsg });
              } catch {}
              return result;
            })
            .catch((err: any) => {
              const result = {
                success: false,
                result: '',
                error: String(err?.message || err),
                durationMs: 0,
                agentName,
              };
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

      case 'dispatch_team_agent': {
        const teamId = String(args?.team_id || '').trim();
        const agentId = String(args?.agent_id || '').trim();
        const task = String(args?.task || '').trim();
        const context = args?.context ? String(args.context) : undefined;
        const background = args?.background === true;
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

        deps.bindTeamNotificationTargetFromSession(teamId, sessionId, 'dispatch_team_agent');
        const dispatchPrompt = buildTeamDispatchTask({ agentId, task, teamId, context });
        const dispatchRecord = createTeamDispatchRecord(teamId, {
          agentId,
          agentName: String((getAgentById(agentId) as any)?.name || agentId),
          taskSummary: task,
          requestedBy: inferTeamNoteContext(sessionId)?.authorId || 'manager',
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
              status: result.success ? 'completed' : 'failed',
              finishedAt: Date.now(),
              taskId: result.taskId,
              resultPreview: String(result.result || result.error || ''),
            });
          }
          updateTeamMemberState(teamId, agentId, {
            status: result.success ? 'ready' : 'blocked',
            currentTask: result.success ? '' : task,
            blockedReason: result.success ? '' : String(result.error || result.result || 'Task failed').slice(0, 500),
            lastResult: String(result.result || result.error || '').slice(0, 1000),
          });
          const resultChatMsg = appendTeamChat(teamId, {
            from: 'subagent',
            fromName: String(result.agentName || (getAgentById(agentId) as any)?.name || agentId),
            fromAgentId: agentId,
            content: result.success
              ? `Task complete: ${String(result.result || '')}`
              : `Task failed: ${result.error || result.result || 'unknown error'}`,
            metadata: {
              agentId,
              runSuccess: result.success,
              taskId: result.taskId,
              stepCount: result.stepCount,
              durationMs: result.durationMs,
              thinking: result.thinking,
              processEntries: result.processEntries,
            },
          });
          try {
            const subagentChatMsg = appendSubagentChatMessage(agentId, {
              role: 'agent',
              content: result.success
                ? String(result.result || '').trim() || 'Task complete.'
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
          });
          return result;
        };

        if (background) {
          const taskId = `team_bg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
          const promise = run()
            .then((result) => {
              const entry = _bgAgentResults.get(taskId);
              if (entry) {
                entry.status = result.success ? 'complete' : 'failed';
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
              const entry = _bgAgentResults.get(taskId);
              if (entry) {
                entry.status = 'failed';
                entry.result = result;
              }
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
          }, null, 2),
          error: result.success !== true,
        };
      }

      case 'talk_to_teammate': {
        try {
          const targetAgentId = String(args?.agent_id || '').trim();
          const message = String(args?.message || '').trim();
          const messageTypeRaw = String(args?.type || 'chat').trim().toLowerCase();
          const messageType = ['chat', 'feedback', 'blocker', 'plan', 'result'].includes(messageTypeRaw)
            ? messageTypeRaw as 'chat' | 'feedback' | 'blocker' | 'plan' | 'result'
            : 'chat';
          const noteContext = inferTeamNoteContext(sessionId);
          if (!noteContext || noteContext.authorType !== 'subagent') {
            return { name, args, result: 'ERROR: talk_to_teammate only works inside a team subagent session.', error: true };
          }
          if (!targetAgentId || !message) {
            return { name, args, result: 'ERROR: talk_to_teammate requires agent_id and message.', error: true };
          }
          const team = getManagedTeam(noteContext.teamId);
          if (!team) return { name, args, result: `ERROR: Team not found: ${noteContext.teamId}`, error: true };
          const fromAgentId = noteContext.authorId;
          const fromAgent = getAgentById(fromAgentId) as any;
          const fromName = String(fromAgent?.name || fromAgentId).trim();
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

      case 'share_artifact': {
        try {
          const noteContext = inferTeamNoteContext(sessionId);
          if (!noteContext || noteContext.authorType !== 'subagent') {
            return { name, args, result: 'ERROR: share_artifact only works inside a team subagent session.', error: true };
          }
          const fromAgentId = noteContext.authorId;
          const fromAgent = getAgentById(fromAgentId) as any;
          const artifact = shareTeamArtifact(noteContext.teamId, {
            name: String(args.name || '').trim(),
            type: String(args.type || 'data').trim(),
            description: String(args.description || '').trim(),
            content: args.content,
            path: args.path,
            createdBy: fromAgentId,
          });
          if (!artifact) return { name, args, result: 'ERROR: Could not share artifact.', error: true };
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
        const action = actionRaw === 'update_focus' ? 'set_focus' : actionRaw;
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
        } else if (action === 'set_mission') {
          const value = String(args?.value || args?.mission || '').trim();
          if (!value) return { name, args, result: 'ERROR: set_mission requires value', error: true };
          ok = updateTeamMission(teamId, value);
          data.mission = value;
        } else if (action === 'log_completed') {
          const value = String(args?.value || args?.entry || '').trim();
          if (!value) return { name, args, result: 'ERROR: log_completed requires value', error: true };
          ok = logCompletedWork(teamId, value);
          data.entry = value;
        } else if (action === 'add_milestone') {
          const description = String(args?.milestone_description || args?.value || '').trim();
          if (!description) return { name, args, result: 'ERROR: add_milestone requires milestone_description', error: true };
          const status = ['pending', 'active', 'complete', 'blocked'].includes(String(args?.milestone_status || 'pending'))
            ? String(args?.milestone_status || 'pending') as 'pending' | 'active' | 'complete' | 'blocked'
            : 'pending';
          const milestone = addTeamMilestone(teamId, {
            description,
            status,
            relevantAgentIds: Array.isArray(args?.relevant_agent_ids) ? args.relevant_agent_ids.map((v: any) => String(v)).filter(Boolean) : [],
          });
          ok = !!milestone;
          data.milestone = milestone;
        } else if (action === 'update_milestone') {
          const milestoneId = String(args?.milestone_id || '').trim();
          if (!milestoneId) return { name, args, result: 'ERROR: update_milestone requires milestone_id', error: true };
          const updates: any = {};
          if (args?.milestone_description !== undefined) updates.description = String(args.milestone_description);
          if (['pending', 'active', 'complete', 'blocked'].includes(String(args?.milestone_status || ''))) updates.status = String(args.milestone_status);
          if (Array.isArray(args?.relevant_agent_ids)) updates.relevantAgentIds = args.relevant_agent_ids.map((v: any) => String(v)).filter(Boolean);
          const milestone = updateTeamMilestone(teamId, milestoneId, updates);
          ok = !!milestone;
          data.milestone = milestone;
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
          const subagentId = String(args.subagent_id || '').trim();
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

          if (!subagentId) return { name, args, result: 'spawn_subagent requires subagent_id', error: true };
          if (runNow && !taskPrompt) return { name, args, result: 'spawn_subagent requires task_prompt when run_now=true', error: true };

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

      case 'team_manage': {
        try {
          const action = String(args.action || '').trim().toLowerCase();
          if (!action) {
            return { name, args, result: 'team_manage requires action: list|create|set_allowed_work_paths|start|trigger_review|dispatch|pause|resume', error: true };
          }

          if (action === 'list') {
            const teams = listManagedTeams().map((t: any) => ({
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

            if (Array.isArray(args.create_subagents) && args.create_subagents.length > 0) {
              return {
                name,
                args,
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
              emoji: String(args.emoji || 'team').slice(0, 8),
              subagentIds: finalIds,
              purpose: purposeStr,
              teamContext: teamContext.slice(0, 1000),
              managerSystemPrompt: String(
                args.manager_system_prompt || `You are the manager of the "${teamName}" team. Your purpose is: ${purposeStr || teamContext}`,
              ).slice(0, 2000),
              managerModel: args.manager_model ? String(args.manager_model) : undefined,
              allowedWorkPaths,
              reviewTrigger,
              originatingSessionId: args.originating_session_id ? String(args.originating_session_id) : undefined,
            });
            const claimedSubagents = finalIds
              .map((id) => ({ subagent_id: id, ...(claimAgentForTeamWorkspace(team.id, id) || {}) }))
              .filter((entry: any) => !!entry.identityPath);
            deps.bindTeamNotificationTargetFromSession(team.id, sessionId, 'team_manage:create');

            const kickoffInitial = args.kickoff_initial_review === true;
            const kickoffSecondsRaw = Number(args.kickoff_after_seconds);
            const kickoffSeconds = Number.isFinite(kickoffSecondsRaw)
              ? Math.max(5, Math.min(300, Math.floor(kickoffSecondsRaw)))
              : 30;
            const kickoffAt = kickoffInitial ? Date.now() + (kickoffSeconds * 1000) : null;
            if (kickoffInitial) {
              setTimeout(() => {
                triggerManagerReview(team.id, deps.broadcastTeamEvent).catch((err: any) =>
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
            if (team.manager?.paused === true) deps.resumeManagedTeamInternal(teamId);

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
                const dispatchPrompt = buildTeamDispatchTask({ agentId, task, teamId, context });
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

          if (action === 'run_round') {
            const teamId = String(args.team_id || '').trim();
            if (!teamId) return { name, args, result: 'team_manage(run_round) requires team_id', error: true };
            const objective = String(args.objective || args.task || '').trim();
            if (!objective) return { name, args, result: 'team_manage(run_round) requires objective', error: true };
            try {
              const { runCollaborativeRound } = require('../../teams/team-round-runner');
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

          if (action === 'run_session') {
            const teamId = String(args.team_id || '').trim();
            if (!teamId) return { name, args, result: 'team_manage(run_session) requires team_id', error: true };
            const objective = String(args.objective || args.task || '').trim();
            if (!objective) return { name, args, result: 'team_manage(run_session) requires objective', error: true };
            const maxRounds = Number(args.max_rounds) || 5;
            try {
              const { runCollaborativeSession } = require('../../teams/team-round-runner');
              const results = await runCollaborativeSession(
                teamId,
                objective,
                deps.broadcastWS || (() => {}),
                maxRounds,
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

          return { name, args, result: `Unsupported team_manage action: ${action}`, error: true };
        } catch (err: any) {
          return { name, args, result: `team_manage error: ${err.message}`, error: true };
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

          return {
            name,
            args,
            result: JSON.stringify({
              success: true,
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

      case 'set_agent_model': {
        const targetAgentId = String(args?.agent_id || '').trim();
        const model = String(args?.model || '').trim();
        const agentType = String(args?.agent_type || '').trim();

        if (!model) {
          return { name, args, result: 'ERROR: model is required. Format: "provider/model" e.g. "anthropic/claude-haiku-4-5-20251001" or "openai/gpt-4o"', error: true };
        }

        const { host, port } = resolveGatewayAddress();

        try {
          if (targetAgentId) {
            const resp = await fetch(`http://${host}:${port}/api/agents/${encodeURIComponent(targetAgentId)}/model`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ model }),
            });
            const data = await resp.json() as any;
            if (!data?.success) return { name, args, result: `ERROR: ${data?.error || 'Failed to update agent model'}`, error: true };
            return { name, args, result: `Agent "${targetAgentId}" model set to "${model}". Takes effect on next spawn.`, error: false };
          }

          if (agentType) {
            if (!VALID_AGENT_MODEL_TYPES.includes(agentType)) {
              return { name, args, result: `ERROR: Invalid agent_type "${agentType}". Valid values: ${VALID_AGENT_MODEL_TYPES.join(', ')}`, error: true };
            }
            const resp = await fetch(`http://${host}:${port}/api/settings/agent-model-defaults`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ [agentType]: model }),
            });
            const data = await resp.json() as any;
            if (!data?.success) return { name, args, result: `ERROR: Failed to update type default`, error: true };
            return { name, args, result: `Default model for "${agentType}" agents set to "${model}". New agents of this type will use this model.`, error: false };
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
          const primaryModel = cfg.llm?.providers?.[cfg.llm?.provider]?.model || cfg.models?.primary || null;
          const agents = (cfg.agents || []).map((a: any) => ({
            id: a.id,
            name: a.name,
            model: a.model || null,
          }));
          const result = {
            global_primary: primaryModel,
            agent_model_defaults: defaults,
            active_agent_model_default_template: cfg.active_agent_model_default_template || null,
            agent_model_default_templates: cfg.agent_model_default_templates || [],
            individual_agent_overrides: agents,
          };
          return { name, args, result: JSON.stringify(result, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `get_agent_models error: ${err.message}`, error: true };
        }
      }

      case 'list_agent_model_templates':
      case 'save_agent_model_template':
      case 'apply_agent_model_template':
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

          if (name === 'apply_agent_model_template') {
            const resp = await fetch(`${baseUrl}/${encodeURIComponent(id)}/apply`, { method: 'POST' });
            const data = await resp.json() as any;
            if (!data?.success) return { name, args, result: `ERROR: ${data?.error || 'Failed to apply template'}`, error: true };
            return { name, args, result: `Applied agent model template "${data.template?.name || id}". Current defaults: ${JSON.stringify(data.defaults || {}, null, 2)}`, error: false };
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
