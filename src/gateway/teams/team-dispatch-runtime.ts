import fs from 'fs';
import path from 'path';
import { ensureAgentWorkspace, getAgentById, getConfig } from '../../config/config';
import { parseProviderModelRef, resolveConfiguredAgentModel } from '../../agents/model-routing.js';
import {
  getManagedTeam,
  drainAgentMessages,
  recordTeamRun,
  buildTeamRoomSummary,
  buildTeamRunSnapshot,
  getTeamRoomEventsSince,
  markTeamMemberRoomEventsSeen,
} from './managed-teams';
import { getTeamWorkspacePath, buildWorkspaceContextBlock, ensureTeamWorkspace, ensureTeamAgentIdentity } from './team-workspace';
import { loadTask, saveTask } from '../tasks/task-store';
import { bindTaskRunToSession, clearTaskRunBinding, completeNextOpenTaskStep } from '../tasks/task-run-mirror';
import { getRuntimeToolCategories } from '../tool-builder';

// ─── Injected dependencies (set by server-v2 at startup) ───────────────────────────────────────────
// These are injected at runtime to avoid circular imports with server-v2.ts

type HandleChatFn = (
  message: string,
  sessionId: string,
  sendSSE: (event: string, data: any) => void,
  pinnedMessages?: Array<{ role: string; content: string }>,
  abortSignal?: { aborted: boolean },
  callerContext?: string,
  modelOverride?: string,
  executionMode?: 'interactive' | 'background_task' | 'heartbeat' | 'cron' | 'team_subagent',
  toolFilter?: string[],
  attachments?: undefined,
  reasoningOptions?: undefined,
  providerOverride?: string,
) => Promise<{ type: string; text: string; thinking?: string }>;

type BroadcastFn = (data: object) => void;

interface DispatchDeps {
  handleChat: HandleChatFn;
  broadcastTeamEvent: BroadcastFn;
  getMCPManager: () => any;
  buildTools: () => any[];
  createTask: (input: any) => any;
  updateTaskStatus: (id: string, status: string, opts?: any) => void;
  setTaskStepRunning: (id: string, idx: number) => void;
  updateTaskRuntimeProgress: (id: string, progress: any) => void;
  mutatePlan: (id: string, ops: any[]) => void;
  appendJournal: (id: string, entry: any) => void;
  setWorkspace: (sessionId: string, path: string) => void;
  recordAgentRun: (entry: any) => void;
  recordFileWrite: (teamId: string, filename: string, agentId: string) => void;
  listWorkspaceFiles: (teamId: string) => any[];
}

let _dispatchDeps: DispatchDeps | null = null;

export function setDispatchDeps(deps: DispatchDeps): void {
  _dispatchDeps = deps;
}

function parseTeamProviderModel(raw: string): { providerOverride?: string; modelOverride?: string } {
  const v = String(raw || '').trim();
  if (!v) return {};
  const parsed = parseProviderModelRef(v);
  if (parsed) {
    return { providerOverride: parsed.providerId, modelOverride: parsed.model };
  }
  return { modelOverride: v };
}

export function resolveTeamSubagentModelRouting(agentId: string): { providerOverride?: string; modelOverride?: string; executorProvider?: string } {
  const agent = getAgentById(agentId);
  const cfg = getConfig().getConfig() as any;
  const resolved = resolveConfiguredAgentModel(cfg, agent, {
    agentType: 'team_subagent',
    isTeamMember: true,
    fallbackToPrimary: true,
  });
  const routing = parseTeamProviderModel(resolved.model);
  return {
    ...routing,
    executorProvider: routing.modelOverride
      ? routing.providerOverride
        ? `${routing.providerOverride}/${routing.modelOverride}`
        : routing.modelOverride
      : undefined,
  };
}

export function buildTeamSubagentCallerContext(teamId: string, agentId: string, task: string, options: { sourceLabel?: string } = {}): {
  callerContext: string;
  teamWorkspacePath?: string;
  agentName: string;
} {
  const agent = getAgentById(agentId);
  const agentName = agent?.name ?? agentId;
  const team = teamId ? getManagedTeam(teamId) : null;
  let teamWorkspacePath = '';
  if (teamId) {
    try { teamWorkspacePath = ensureTeamWorkspace(teamId); } catch {}
  }

  let agentRoleBlock = '';
  if (agent) {
    try {
      const globalAgentWs = String((agent as any)?.workspace || '') || ensureAgentWorkspace(agent as any);
      const identityWs = teamId
        ? ensureTeamAgentIdentity(teamId, agentId, globalAgentWs || undefined)
        : globalAgentWs;
      const spFile = [path.join(identityWs, 'system_prompt.md'), path.join(identityWs, 'HEARTBEAT.md')]
        .find(f => fs.existsSync(f));
      if (spFile) {
        const raw = fs.readFileSync(spFile, 'utf-8').trim();
        if (raw) agentRoleBlock = `[YOUR ROLE ON THIS TEAM - ${agentName}]\n${raw}`;
      }
    } catch {}
  }

  const pendingMessages = teamId ? drainAgentMessages(teamId, agentId) : [];
  const memberState = team?.roomState?.memberStates?.[agentId];
  const roomDeltaSince = Number(memberState?.lastRoomEventSeenAt || memberState?.lastUpdateAt || 0);
  const roomEventDeltas = teamId
    ? getTeamRoomEventsSince(teamId, roomDeltaSince, { agentId, limit: 12 })
    : [];
  if (teamId && roomEventDeltas.length > 0) {
    markTeamMemberRoomEventsSeen(teamId, agentId);
  }
  const roomDeltaBlock = roomEventDeltas.length > 0
    ? [
        `[ROOM EVENTS SINCE YOUR LAST TURN]`,
        ...roomEventDeltas.map((event, index) => {
          const actor = String(event.actorName || event.actorId || event.actorType || 'system').trim();
          const target = event.target ? ` -> ${event.target}` : '';
          const source = event.metadata?.source ? ` [${event.metadata.source}]` : '';
          return `${index + 1}. ${actor}${target}${source}: ${String(event.content || '').replace(/\s+/g, ' ').slice(0, 400)}`;
        }),
        `Use this delta to understand what changed while you were away.`,
      ].join('\n')
    : '';
  const roomSummary = team ? buildTeamRoomSummary(team, {
    agentId,
    limitMessages: 10,
    includePlan: true,
    includeArtifacts: true,
  }) : '';
  const sourceLabel = options.sourceLabel || 'TEAM DISPATCH';

  const callerContext = [
    `[${sourceLabel} - ${team?.name || teamId} | agent: ${agentId}]`,
    `You are Prometheus. You have been assigned a specific role on this team for this session.`,
    ``,
    teamWorkspacePath
      ? [
          `[YOUR WORKING DIRECTORY]`,
          `${teamWorkspacePath}`,
          ``,
          `This is the team workspace for "${team?.name || teamId}". Write ALL task outputs and shared`,
          `files here. Do NOT write to your own agent workspace or any other path.`,
          `  -> Check existing files here before creating new ones.`,
          `  -> Prior run context: memory.json, last_run.json, pending.json are in this directory.`,
        ].join('\n')
      : '',
    agentRoleBlock ? `\n${agentRoleBlock}` : '',
    roomSummary ? `\n${roomSummary}` : '',
    roomDeltaBlock ? `\n${roomDeltaBlock}` : '',
    pendingMessages.length > 0
      ? `\n[MESSAGES FOR YOU]\n${pendingMessages.map((m, i) => `${i + 1}. ${m}`).join('\n')}\nAcknowledge and act on these as part of your task.`
      : '',
    `\n[TEAM COLLABORATION TOOLS]`,
    `You always have team_ops available in this team execution. Use these tools when appropriate:`,
    `- update_my_status: mark yourself running, blocked, waiting_for_context, ready, or done.`,
    `- talk_to_teammate: message another member, "manager", or "all".`,
    `- request_context / request_manager_help: ask the manager for missing context or escalation.`,
    `- share_artifact: publish reusable outputs/files/findings into shared team state.`,
    `- update_team_goal: propose or update plan items when your work reveals a better next step.`,
    ``,
    `[ESCALATION]`,
    `Post blockers or errors to team chat so the manager can act on them.`,
    task ? `\n[ASSIGNED TASK]\n${String(task).slice(0, 2000)}` : '',
  ].filter(Boolean).join('\n');

  return { callerContext, teamWorkspacePath, agentName };
}

/** Session IDs of agents currently running — used for loop-guard in dispatch_team_agent handler */
export const _activeAgentSessions = new Set<string>();

/** Background agent result registry — keyed by task_id returned to callers */
export interface BgAgentEntry {
  status: 'running' | 'complete' | 'failed';
  agentId: string;
  teamId: string;
  startedAt: number;
  promise: Promise<RunAgentResult>;
  result?: RunAgentResult;
}
export const _bgAgentResults = new Map<string, BgAgentEntry>();

export interface RunAgentResult {
  success: boolean;
  result: string;
  error?: string;
  processLog?: string;
  processEntries?: Array<{
    ts?: string;
    type?: string;
    content?: string;
    actor?: string;
    [key: string]: any;
  }>;
  thinking?: string;
  durationMs: number;
  stepCount?: number;
  agentName: string;
  taskId?: string;
  warning?: string;
}

/**
 * Run a team agent through the full handleChat pipeline.
 * This is the canonical dispatch function for ALL team agent runs.
 * Previously lived in teams.router.ts — moved here so it can be imported
 * by team-manager-runner.ts without a circular dependency through the router.
 */
export async function runTeamAgentViaChat(
  agentId: string,
  task: string,
  teamId: string,
  timeoutMs = 300000,
  trigger: 'team_dispatch' | 'cron' = 'team_dispatch',
): Promise<RunAgentResult> {
  if (!_dispatchDeps) {
    return { success: false, result: '', error: 'Dispatch deps not initialized', durationMs: 0, agentName: agentId };
  }
  const deps = _dispatchDeps;
  const agent = getAgentById(agentId);
  const agentName = agent?.name ?? agentId;
  const startedAt = Date.now();
  const team = teamId ? getManagedTeam(teamId) : null;
  const sessionId = `team_dispatch_${agentId}_${Date.now()}`;
  const resolveAgentModelRouting = (): { providerOverride?: string; modelOverride?: string } => {
    const cfg = getConfig().getConfig() as any;
    const resolved = resolveConfiguredAgentModel(cfg, agent, {
      agentType: 'team_subagent',
      isTeamMember: true,
      fallbackToPrimary: true,
    });
    return parseTeamProviderModel(resolved.model);
  };
  const agentRouting = resolveAgentModelRouting();

  // Team subagents run with their file tools scoped to the team workspace.
  // Source-read tools still resolve against the main Prometheus workspace, but normal
  // file writes land inside this team workspace only.
  let teamWorkspacePath: string | null = null;
  if (teamId) {
    try { teamWorkspacePath = ensureTeamWorkspace(teamId); } catch {}
  }

  // Load agent role from the team-scoped identity directory.
  // ensureTeamAgentIdentity bootstraps system_prompt.md from the global agent workspace
  // on first use, then keeps it isolated — so the same agent ID on two different teams
  // can have independent roles without any context bleed.
  let agentRoleBlock = '';
  let agentIdentityPath = '';
  if (agent) {
    try {
      const globalAgentWs = teamId
        ? String((agent as any)?.workspace || '')
        : ensureAgentWorkspace(agent as any);
      const identityWs = teamId
        ? ensureTeamAgentIdentity(teamId, agentId, globalAgentWs || undefined)
        : globalAgentWs;
      agentIdentityPath = identityWs;
      const spFile = [path.join(identityWs, 'system_prompt.md'), path.join(identityWs, 'HEARTBEAT.md')]
        .find(f => fs.existsSync(f));
      if (spFile) {
        const raw = fs.readFileSync(spFile, 'utf-8').trim();
        if (raw) agentRoleBlock = `[YOUR ROLE ON THIS TEAM — ${agentName}]\n${raw}`;
      }
    } catch {}
  }

  // Build MCP server summary
  let mcpServerSummary = '';
  try {
    const mcpTools = deps.getMCPManager().getAllTools();
    const byServer = new Map<string, string[]>();
    for (const t of mcpTools) {
      const key = `${t.serverName} (mcp__${t.serverId}__*)`;
      if (!byServer.has(key)) byServer.set(key, []);
      byServer.get(key)!.push(t.name);
    }
    if (byServer.size > 0) {
      const lines = [...byServer.entries()].map(([srv, tools]) =>
        `  - ${srv}: ${tools.slice(0, 8).join(', ')}${tools.length > 8 ? ` (+${tools.length - 8} more)` : ''}`
      );
      mcpServerSummary = `[CONNECTED MCP SERVERS]\n${lines.join('\n')}`;
    }
  } catch {}

	  // Team-dispatched agents run with the same runtime category surface as main chat.
	  // Approval policy still gates commit-tier actions such as shell, GitHub, and Vercel.
	  try {
	    const { setActivatedToolCategories } = require('../session');
	    setActivatedToolCategories(sessionId, getRuntimeToolCategories());
	  } catch { /* non-fatal */ }

  // Create task record
  const cronTask = deps.createTask({
    title: `${agentName}: ${task.slice(0, 80)}`,
    prompt: task,
    sessionId,
    channel: 'web',
    plan: [{ index: 0, description: task.slice(0, 120), status: 'pending' }],
  });
  deps.updateTaskStatus(cronTask.id, 'running');
  deps.setTaskStepRunning(cronTask.id, 0);
  deps.broadcastTeamEvent({
    type: 'task_running',
    taskId: cronTask.id,
    teamId,
    agentId,
    agentName,
    taskSummary: task,
    startedAt,
  });

  // Drain any queued messages for this agent
  const pendingMessages = teamId ? drainAgentMessages(teamId, agentId) : [];
  const memberState = team?.roomState?.memberStates?.[agentId];
  const roomDeltaSince = Number(memberState?.lastRoomEventSeenAt || memberState?.lastUpdateAt || 0);
  const roomEventDeltas = teamId
    ? getTeamRoomEventsSince(teamId, roomDeltaSince, { agentId, limit: 12 })
    : [];
  const roomDeltaBlock = roomEventDeltas.length > 0
    ? [
        `[ROOM EVENTS SINCE YOUR LAST TURN]`,
        ...roomEventDeltas.map((event, index) => {
          const actor = String(event.actorName || event.actorId || event.actorType || 'system').trim();
          const target = event.target ? ` -> ${event.target}` : '';
          const source = event.metadata?.source ? ` [${event.metadata.source}]` : '';
          return `${index + 1}. ${actor}${target}${source}: ${String(event.content || '').replace(/\s+/g, ' ').slice(0, 400)}`;
        }),
        `Use this delta to understand what changed while you were away. If you are waking because of a teammate or manager handoff, respond to that reason directly.`,
      ].join('\n')
    : '';
  if (teamId && roomEventDeltas.length > 0) {
    markTeamMemberRoomEventsSeen(teamId, agentId);
  }
  const roomSummary = team ? buildTeamRoomSummary(team, {
    agentId,
    limitMessages: 10,
    includePlan: true,
    includeArtifacts: true,
  }) : '';

  // Detect complex multi-step tasks that should use declare_plan
  const taskLower = task.toLowerCase();
  const isComplexTask = /research|gather|analyze|investigate|compile|summarize|identify.*\d+|interview|survey|collect|evaluate/i.test(task);
  const planRequirementBlock = isComplexTask
    ? `\n[COMPLEX TASK PLANNING]\nThis is a multi-phase task. Call declare_plan with 2-4 meaningful steps IMMEDIATELY:\n  1. First step for initial research/setup\n  2. Execution/gathering phase\n  3. Compilation/analysis phase\n  4. Formatting/output phase (if needed)\nDeclare these steps now, then execute them in order. Do NOT skip planning for a complex task like this.`
    : '';

  // Lean callerContext — subagents get role + workspace + a compact team-room snapshot.
  // We still avoid dumping the full transcript; members see a summarized slice of the
  // room plus direct queued messages so execution stays focused and affordable.
  const callerContext = [
    `[TEAM DISPATCH — ${team?.name || teamId} | agent: ${agentId}]`,
    `You are Prometheus. You have been assigned a specific role on this team for this session.`,
    ``,
    teamWorkspacePath
      ? [
          `[YOUR WORKING DIRECTORY]`,
          `${teamWorkspacePath}`,
          ``,
          `This is the team workspace for "${team?.name || teamId}". Write ALL task outputs and shared`,
          `files here. Do NOT write to your own agent workspace or any other path.`,
          `  → Check existing files here before creating new ones.`,
          `  → Prior run context: memory.json, last_run.json, pending.json are in this directory.`,
        ].join('\n')
      : '',
    agentRoleBlock ? `\n${agentRoleBlock}` : '',
    roomSummary ? `\n${roomSummary}` : '',
    roomDeltaBlock ? `\n${roomDeltaBlock}` : '',
    pendingMessages.length > 0
      ? `\n[MESSAGES FOR YOU]\n${pendingMessages.map((m, i) => `${i + 1}. ${m}`).join('\n')}\nAcknowledge and act on these as part of your task.`
      : '',
    `\n[TEAM COLLABORATION TOOLS]`,
    `You always have team_ops available in this team dispatch. Use these tools when appropriate:`,
    `- update_my_status: mark yourself running, blocked, waiting_for_context, ready, or done.`,
    `- talk_to_teammate: message another member, "manager", or "all".`,
    `- request_context / request_manager_help: ask the manager for missing context or escalation.`,
    `- share_artifact: publish reusable outputs/files/findings into shared team state.`,
    `- update_team_goal: propose or update plan items when your work reveals a better next step.`,
    `\n[PARALLEL EXECUTION]`,
    `Use background_spawn to run independent subtasks in parallel while you continue your main work.`,
    `background_spawn(prompt) — spawns a full LLM agent; result is auto-merged at turn-end.`,
    `  PROMPT MUST BE FULLY SELF-CONTAINED — include all file paths, context, and exact instructions.`,
    `  The bg agent has no session history. Write outputs to the team workspace: ${teamWorkspacePath ?? '<workspace>'}`,
    mcpServerSummary ? `\n${mcpServerSummary}` : '',
    planRequirementBlock,
    ``,
    `[ESCALATION]`,
    `Post blockers or errors to the team workspace (pending.json) so the coordinator can act on them.`,
  ].filter(Boolean).join('\n');

  if (pendingMessages.length > 0) {
    console.log(`[TeamDispatch] Injected ${pendingMessages.length} queued message(s) for agent "${agentId}"`);
  }

  if (teamWorkspacePath) {
    deps.setWorkspace(sessionId, teamWorkspacePath);
    cronTask.agentWorkspace = teamWorkspacePath;
  }
  if (agentRouting.modelOverride) {
    cronTask.executorProvider = agentRouting.providerOverride
      ? `${agentRouting.providerOverride}/${agentRouting.modelOverride}`
      : agentRouting.modelOverride;
  }
  cronTask.teamSubagent = {
    teamId,
    agentId,
    agentName,
    callerContext,
  };
  saveTask(cronTask);

  let stepCount = 0;
  const processLogLines: string[] = [];
  const processEntries: Array<{
    ts?: string;
    type?: string;
    content?: string;
    actor?: string;
    [key: string]: any;
  }> = [];
  let thinkingText = '';
  let liveReplyText = '';

  const nowTs = () => new Date().toLocaleTimeString();
  const safePreview = (value: any, max = 400): string => {
    if (value == null) return '';
    if (typeof value === 'string') return value.slice(0, max);
    try {
      return JSON.stringify(value).slice(0, max);
    } catch {
      return String(value).slice(0, max);
    }
  };
  const pushProcessEntry = (type: string, content: string, extra: Record<string, any> = {}) => {
    const text = String(content || '').trim();
    if (!text) return;
    processEntries.push({
      ts: nowTs(),
      type,
      content: text,
      ...extra,
    });
    if (processEntries.length > 250) processEntries.splice(0, processEntries.length - 250);
  };
  const captureTaskStreamEvent = (event: string, data: any) => {
    if (event === 'token') {
      const chunk = String(data?.text || '');
      if (chunk) liveReplyText = `${liveReplyText}${chunk}`;
      return;
    }
    if (event === 'thinking_delta') {
      const chunk = String(data?.thinking || data?.text || '');
      if (chunk) thinkingText = `${thinkingText}${chunk}`;
      return;
    }
    if (event === 'thinking' || event === 'agent_thought') {
      const thought = String(data?.thinking || data?.text || '').trim();
      if (!thought) return;
      thinkingText = thinkingText ? `${thinkingText}\n\n${thought}` : thought;
      processLogLines.push(`[thinking] ${thought.slice(0, 200)}`);
      pushProcessEntry('think', thought, data?.actor ? { actor: data.actor } : {});
      return;
    }
    if (event === 'info') {
      const info = String(data?.message || '').trim();
      if (!info) return;
      processLogLines.push(`[info] ${info.slice(0, 200)}`);
      pushProcessEntry('info', info, data?.actor ? { actor: data.actor } : {});
      return;
    }
    if (event === 'progress_state') {
      const items = Array.isArray(data?.items) ? data.items : [];
      const activeIndex = Number(data?.activeIndex ?? -1);
      const activeItem = activeIndex >= 0 ? items[activeIndex] : null;
      const activeText = String(activeItem?.text || '').trim();
      if (activeText) {
        processLogLines.push(`[progress] ${activeText.slice(0, 200)}`);
        pushProcessEntry('info', activeText);
      }
      return;
    }
    if (event === 'tool_call') {
      stepCount++;
      const toolName = String(data?.action || data?.tool || data?.name || '?').trim() || '?';
      const argsStr = safePreview(data?.args || data?.input || {}, 220);
      processLogLines.push(`[tool_call] ${toolName}${argsStr ? `(${argsStr})` : '()'}`);
      pushProcessEntry('tool', `${toolName}${argsStr ? ` ${argsStr}` : ''}`, {
        ...(data?.actor ? { actor: data.actor } : {}),
        ...(data?.args && typeof data.args === 'object' ? { args: data.args } : {}),
      });
      return;
    }
    if (event === 'tool_result') {
      const toolName = String(data?.action || data?.tool || data?.name || '?').trim() || '?';
      const resultStr = safePreview(data?.result ?? data?.output ?? data?.content ?? '', 500);
      if (resultStr) processLogLines.push(`[tool_result] ${toolName} => ${resultStr}`);
      pushProcessEntry(data?.error === true ? 'error' : 'result', `${toolName} => ${resultStr || '(no output)'}`, data?.actor ? { actor: data.actor } : {});
      return;
    }
    if (event === 'tool_progress') {
      const toolName = String(data?.action || data?.tool || data?.name || '?').trim() || '?';
      const progressMsg = String(data?.message || '').trim();
      if (!progressMsg) return;
      processLogLines.push(`[tool_progress] ${toolName}: ${progressMsg.slice(0, 240)}`);
      pushProcessEntry('info', `${toolName}: ${progressMsg}`, data?.actor ? { actor: data.actor } : {});
      return;
    }
    if (event === 'final' || event === 'done') {
      const reply = String(data?.reply || data?.text || '').trim();
      if (reply) {
        liveReplyText = reply;
        processLogLines.push(`[final] ${reply.slice(0, 240)}`);
        pushProcessEntry('final', reply);
      }
      const thinking = String(data?.thinking || '').trim();
      if (thinking) thinkingText = thinkingText ? `${thinkingText}\n\n${thinking}` : thinking;
    }
  };
  const broadcastTeamTaskEvent = (data: any) => {
    const payload = {
      ...(data || {}),
      taskId: data?.taskId || cronTask.id,
      teamId,
      agentId,
      agentName,
      taskSummary: task,
      startedAt,
    };
    if (payload.type === 'task_stream_event') {
      captureTaskStreamEvent(String(payload.eventType || ''), payload.data);
    }
    deps.broadcastTeamEvent(payload);
  };

  bindTaskRunToSession(sessionId, {
    taskId: cronTask.id,
    source: 'team_dispatch',
    teamId,
    agentId,
  });
  let runTimeoutHandle: NodeJS.Timeout | undefined;
  _activeAgentSessions.add(sessionId);
  try {
    const abortSignal = { aborted: false };
    const timeoutPromise = new Promise<never>((_, reject) => {
      runTimeoutHandle = setTimeout(() => {
        abortSignal.aborted = true;
        reject(new Error(`Team agent timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      if (typeof (runTimeoutHandle as any)?.unref === 'function') (runTimeoutHandle as any).unref();
    });
    const result = await Promise.race<any>([
      deps.handleChat(
        task,
        sessionId,
        (event, data) => broadcastTeamTaskEvent({
          type: 'task_stream_event',
          eventType: event,
          data,
        }),
        undefined,
        abortSignal,
        callerContext,
        agentRouting.modelOverride,
        'team_subagent',
        undefined,
        undefined,
        undefined,
        agentRouting.providerOverride,
      ),
      timeoutPromise,
    ]);
    if (runTimeoutHandle) clearTimeout(runTimeoutHandle);

    const finalTask = loadTask(cronTask.id);
    const resultText = String(result?.text || finalTask?.finalSummary || finalTask?.pendingClarificationQuestion || liveReplyText || '').trim();
    const finalStatus = abortSignal.aborted
      ? 'failed'
      : (finalTask?.status && finalTask.status !== 'running' ? finalTask.status : (/^\s*ERROR:/i.test(resultText) ? 'failed' : 'complete'));
    if (finalStatus === 'complete') {
      completeNextOpenTaskStep(cronTask.id, resultText.slice(0, 200));
      deps.updateTaskStatus(cronTask.id, 'complete', { finalSummary: resultText });
    } else if (finalStatus === 'failed') {
      deps.updateTaskStatus(cronTask.id, 'failed', { finalSummary: resultText || 'Team agent failed.' });
    }
    const waitingForManager = finalStatus === 'awaiting_user_input' || finalStatus === 'needs_assistance' || finalStatus === 'paused';
    const success = finalStatus === 'complete' && !resultText.startsWith('ERROR:');
    const zeroToolCalls = stepCount === 0;

    // ── Validate result substantiveness for complex tasks ─────────────────────
    let resultWarning = '';
    if (isComplexTask && success) {
      // Check if result is suspiciously empty or just file listings
      const isSuspiciouslyEmpty = /^\s*\[\s*(?:DIR|FILE)\s*\]|^Done\.|^Task complete\.?$/i.test(resultText)
        || resultText.length < 100;
      const isMainlyFileList = /^\s*\[\s*(?:DIR|FILE)\s*\]/m.test(resultText) && resultText.split('\n').filter(l => /\[\s*(?:DIR|FILE)\s*\]/.test(l)).length > resultText.split('\n').length * 0.5;

      // Check for hollow work: claimed research but returned categories/assumptions instead of specific data
      const hasGenericCategories = /^(restaurants|contractors|salons|businesses|companies|services|types|categories|categories of)/im.test(resultText.slice(0, 500));
      const lacksSpecificNames = !/[A-Z][a-z]+\s+(?:[A-Z][a-z]+)?[\s,].*?(?:website|url|phone|contact|email|address)/i.test(resultText);
      const allVariesOrAssumed = (resultText.match(/varies|assumed|likely|probably|may have|could be|not specified/gi) || []).length > 5;
      const isHollowWork = (hasGenericCategories || lacksSpecificNames || allVariesOrAssumed) && resultText.length > 200;

      if (isSuspiciouslyEmpty || isMainlyFileList) {
        resultWarning = `⚠️ INCOMPLETE: Result appears to be mostly file listings or placeholder text for a complex task. The agent may not have executed the research/gathering properly.`;
        console.warn(`[TeamDispatch] Suspicious result for complex task "${agentId}": ${resultText.slice(0, 200)}`);
      } else if (isHollowWork) {
        resultWarning = `⚠️ HOLLOW WORK: Result contains generic categories/assumptions instead of specific extracted data (actual company names, websites, contact info). Agent reported research done but did not deliver substantive lead data.`;
        console.warn(`[TeamDispatch] Hollow work detected for complex task "${agentId}": result has categories/assumptions but no specific extracted data`);
      }
    }

    // ── Issue 9: Record run in team-scoped history ────────────────────────────
    const finishedAt = Date.now();
    if (teamId) {
      recordTeamRun(teamId, {
        agentId,
        agentName,
        trigger,
        taskId: cronTask.id,
        success,
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        stepCount,
        zeroToolCalls,
        error: success ? (resultWarning || undefined) : (waitingForManager ? `Waiting: ${resultText.slice(0, 260)}` : resultText.slice(0, 300)),
        resultPreview: success ? resultText : undefined,
        quality: {
          warning: resultWarning || undefined,
          zeroToolCalls,
          resultLength: resultText.length,
          suspect: !!resultWarning || zeroToolCalls,
        },
        roomSnapshot: buildTeamRunSnapshot(teamId, { agentId, sinceAt: startedAt }) || undefined,
      });
    }

    deps.appendJournal(cronTask.id, { type: 'status_push', content: `${waitingForManager ? 'Waiting' : success ? 'Done' : 'Stopped'}: ${resultText.slice(0, 200)}` });
    deps.broadcastTeamEvent({
      type: waitingForManager ? 'task_paused' : success ? 'task_complete' : 'task_failed',
      taskId: cronTask.id,
      teamId,
      agentId,
      summary: resultText.slice(0, 200),
    });

    return {
      success,
      result: waitingForManager
        ? `WAITING_FOR_MANAGER: ${resultText || 'The subagent paused for manager input.'}`
        : resultWarning ? `${resultWarning}\n\n${resultText}` : resultText,
      processLog: processLogLines.length > 0 ? processLogLines.join('\n') : undefined,
      processEntries: processEntries.length > 0 ? [...processEntries] : undefined,
      thinking: thinkingText.trim() || undefined,
      durationMs: finishedAt - startedAt,
      stepCount,
      agentName,
      taskId: cronTask.id,
      warning: resultWarning || undefined,
    };
  } catch (err: any) {
    const finishedAt = Date.now();

    // ── Issue 9: Record failed run in team history ────────────────────────────
    if (teamId) {
      recordTeamRun(teamId, {
        agentId,
        agentName,
        trigger,
        taskId: cronTask.id,
        success: false,
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        stepCount,
        zeroToolCalls: stepCount === 0,
        error: String(err?.message ?? err).slice(0, 300),
        quality: {
          zeroToolCalls: stepCount === 0,
          resultLength: 0,
          suspect: true,
        },
        roomSnapshot: buildTeamRunSnapshot(teamId, { agentId, sinceAt: startedAt }) || undefined,
      });
    }

    deps.updateTaskStatus(cronTask.id, 'failed', { finalSummary: String(err?.message ?? err).slice(0, 500) });
    deps.appendJournal(cronTask.id, { type: 'status_push', content: `Failed: ${String(err?.message ?? err).slice(0, 200)}` });
    deps.broadcastTeamEvent({
      type: 'task_failed',
      taskId: cronTask.id,
      teamId,
      agentId,
      agentName,
      taskSummary: task,
      startedAt,
      summary: String(err?.message ?? err).slice(0, 200),
    });
    return {
      success: false,
      result: '',
      error: String(err?.message ?? err),
      processLog: processLogLines.length > 0 ? processLogLines.join('\n') : undefined,
      processEntries: processEntries.length > 0 ? [...processEntries] : undefined,
      thinking: thinkingText.trim() || undefined,
      durationMs: finishedAt - startedAt,
      stepCount,
      agentName,
      taskId: cronTask.id,
    };
  } finally {
    if (runTimeoutHandle) clearTimeout(runTimeoutHandle);
    _activeAgentSessions.delete(sessionId);
    clearTaskRunBinding(sessionId, cronTask.id);
    if (teamId) {
      try {
        const { hasPendingAgentMessages, listPendingTeamDirectThreadsForParticipant } = require('./managed-teams');
        if (hasPendingAgentMessages(teamId, agentId)) {
          const { scheduleTeamMemberAutoWake } = require('./team-member-room');
          scheduleTeamMemberAutoWake(teamId, agentId, {
            reason: 'New teammate messages arrived while you were dispatched.',
            delayMs: 500,
            source: 'dispatch_followup',
          });
        }
        const pendingDirectThreads = listPendingTeamDirectThreadsForParticipant(teamId, 'member', agentId);
        if (Array.isArray(pendingDirectThreads) && pendingDirectThreads.length > 0) {
          const { scheduleTeamMemberDirectWake } = require('./team-member-room');
          for (const thread of pendingDirectThreads) {
            if (!thread?.id) continue;
            scheduleTeamMemberDirectWake(teamId, agentId, thread.id, {
              reason: 'The team owner sent you a direct follow-up while you were dispatched.',
              delayMs: 500,
            });
          }
        }
      } catch {
        // Best-effort handoff back into the room.
      }
    }
  }
}

export interface TeamDispatchBuildInput {
  agentId: string;
  task: string;
  /** Optional team ID — when provided, team context and workspace info are injected */
  teamId?: string;
  context?: string;
}

export interface TeamDispatchBuildResult {
  effectiveTask: string;
  usedSystemPrompt: boolean;
}

function normalizeList(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x || '').trim()).filter(Boolean);
}

function unique(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = String(item || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(String(item).trim());
  }
  return out;
}

function tryReadText(filePath: string): string {
  try {
    if (!fs.existsSync(filePath)) return '';
    return String(fs.readFileSync(filePath, 'utf-8') || '').trim();
  } catch {
    return '';
  }
}

function readSubagentConfig(agentId: string, workspace: string): any | null {
  const cfg = getConfig().getConfig() as any;
  const roots = new Set<string>([
    path.join(workspace, 'config.json'),
    path.join(String(cfg?.workspace?.path || process.cwd()), '.prometheus', 'subagents', agentId, 'config.json'),
    path.join(process.cwd(), '.prometheus', 'subagents', agentId, 'config.json'),
  ]);

  for (const p of roots) {
    try {
      if (!fs.existsSync(p)) continue;
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch {}
  }
  return null;
}

export function buildTeamDispatchTask(input: TeamDispatchBuildInput): TeamDispatchBuildResult {
  const agent = getAgentById(input.agentId);
  if (!agent) {
    return { effectiveTask: String(input.task || ''), usedSystemPrompt: false };
  }

  const workspace = ensureAgentWorkspace(agent as any);
  const dynamicConfig = readSubagentConfig(input.agentId, workspace);

  const systemPromptPath = path.join(workspace, 'system_prompt.md');
  const agentsMdPath = path.join(workspace, 'AGENTS.md');
  const systemPrompt = tryReadText(systemPromptPath)
    || String(dynamicConfig?.system_instructions || (agent as any).system_instructions || '').trim()
    || tryReadText(agentsMdPath);

  const constraints = normalizeList(dynamicConfig?.constraints ?? (agent as any).constraints);
  const successCriteria = String(
    dynamicConfig?.success_criteria
      ?? (agent as any).success_criteria
      ?? '',
  ).trim();

  // ── Team context injection (generic — works for any team) ──────────────────
  const teamContextBlock = buildGenericTeamContext(input.agentId, input.teamId);

  const sections: string[] = [
    `[TEAM DISPATCH]`,
    '',
    'YOUR TASK:',
    String(input.task || '').trim(),
  ];

  if (input.context && String(input.context).trim()) {
    sections.push('', 'ADDITIONAL CONTEXT:', String(input.context).trim());
  }

  if (teamContextBlock) {
    sections.push('', teamContextBlock);
  }

  if (constraints.length > 0) {
    sections.push('', 'CONSTRAINTS:', ...constraints.map((c) => `- ${c}`));
  }
  if (successCriteria) {
    sections.push('', `SUCCESS CRITERIA: ${successCriteria}`);
  }

  const focusedPaths: string[] = [];
  if (input.teamId) {
    // On a team: working directory is the team workspace. Point to team paths only —
    // global agent workspace files are not relevant to this dispatched run.
    try {
      const twp: string = getTeamWorkspacePath(input.teamId);
      if (twp) {
        focusedPaths.push(`  - Team workspace (your working directory): ${twp}`);
        const pipelineFile = path.join(twp, 'PIPELINE_STATUS.md');
        if (fs.existsSync(pipelineFile)) focusedPaths.push(`  - Pipeline status:   ${pipelineFile}`);
        const memFile = path.join(twp, 'memory.json');
        if (fs.existsSync(memFile)) focusedPaths.push(`  - Prior run memory:  ${memFile}`);
      }
    } catch { /* non-fatal */ }
  } else {
    // No team — use global agent workspace paths as usual
    const agMdFile = path.join(workspace, 'AGENTS.md');
    if (fs.existsSync(agMdFile)) focusedPaths.push(`  - Your role prompt:  ${agMdFile}`);
    const userFile = path.join(workspace, 'USER.md');
    if (fs.existsSync(userFile)) focusedPaths.push(`  - User profile:      ${userFile}`);
    const soulFile = path.join(workspace, 'SOUL.md');
    if (fs.existsSync(soulFile)) focusedPaths.push(`  - Core identity:     ${soulFile}`);
    const memoryFile = path.join(workspace, 'MEMORY.md');
    if (fs.existsSync(memoryFile)) focusedPaths.push(`  - Long-term memory:  ${memoryFile}`);
  }

  sections.push(
    '',
    'TOOL RULES — follow exactly:',
    '1. You have FULL tool access. NEVER claim you cannot use tools — call them directly.',
    '2. For web/browser automation call browser_open directly.',
    '3. For workspace listing use list_directory with path="." — never path="". Skip .git/ entirely.',
    '4. Do NOT blindly scan directories at startup. Read only what you need, starting from:',
    ...(focusedPaths.length > 0 ? focusedPaths : ['  - Your task instructions above.']),
    '',
    'Execute the task above now. Use your tools, verify results, and report what actually happened.',
  );

  return {
    effectiveTask: sections.join('\n'),
    usedSystemPrompt: !!systemPrompt,
  };
}

/**
 * Builds a generic team context block for any agent dispatched to any team.
 */
function buildGenericTeamContext(agentId: string, teamId?: string): string {
  if (!teamId) {
    const { listManagedTeams } = require('./managed-teams');
    const teams = listManagedTeams();
    const team = teams.find((t: any) => Array.isArray(t.subagentIds) && t.subagentIds.includes(agentId));
    if (!team) return '';
    return buildGenericTeamContext(agentId, team.id);
  }

  try {
    const team = getManagedTeam(teamId);
    if (!team) return '';

    const wsPath = getTeamWorkspacePath(teamId);
    const lines: string[] = [
      `[TEAM CONTEXT — ${team.name}]`,
      `Team workspace (your working directory): ${wsPath}`,
      `Write all task outputs and shared files to this path.`,
    ];

    const purposeStr = String((team as any).purpose || team.mission || team.teamContext || '').trim();
    if (purposeStr) {
      lines.push('', 'Team purpose:', purposeStr);
    }
    const focusStr = String(team.currentFocus || '').trim();
    if (focusStr) {
      lines.push('Current task this run:', focusStr);
    }

    const refs = Array.isArray(team.contextReferences) ? team.contextReferences : [];
    if (refs.length > 0) {
      lines.push('', 'Reference docs:');
      for (const ref of refs.slice(0, 5)) {
        lines.push(`  [${ref.title}]: ${String(ref.content || '').slice(0, 300)}`);
      }
    }

    try {
      const workspaceBlock = buildWorkspaceContextBlock(teamId, agentId);
      if (workspaceBlock) lines.push('', workspaceBlock);
    } catch { /* non-fatal */ }

    try {
      const pipelineStatusPath = path.join(wsPath, 'PIPELINE_STATUS.md');
      if (fs.existsSync(pipelineStatusPath)) {
        const content = fs.readFileSync(pipelineStatusPath, 'utf-8').trim();
        if (content) {
          lines.push('', '[PIPELINE_STATUS.md]:', content.slice(0, 2000));
        }
      }
    } catch { /* non-fatal */ }

    return lines.join('\n');
  } catch {
    return '';
  }
}

/**
 * Build enforced tool filter for team-dispatched runs.
 */
export function buildTeamToolFilter(agentId: string): string[] | null {
  void agentId;
  return null;
}

// ── Src read access ─────────────────────────────────────────────────────────

/**
 * Returns true if this agent has been granted src read access.
 * Checked from config.json: { "src_read_access": true }
 * When true, read_source and list_source are added to the agent’s tool filter.
 */
export function agentHasSrcReadAccess(agentId: string): boolean {
  const agent = getAgentById(agentId);
  if (!agent) return false;
  const workspace = ensureAgentWorkspace(agent as any);
  const dynamicConfig = readSubagentConfig(agentId, workspace);
  return dynamicConfig?.src_read_access === true || (agent as any).src_read_access === true;
}

/**
 * Returns true if this agent is allowed to submit proposals directly.
 * Default: false for all subagents. Set { "can_propose": true } in config.json
 * to allow (intended only for manager agents).
 */
export function agentCanPropose(agentId: string): boolean {
  const agent = getAgentById(agentId);
  if (!agent) return false;
  const workspace = ensureAgentWorkspace(agent as any);
  const dynamicConfig = readSubagentConfig(agentId, workspace);
  return dynamicConfig?.can_propose === true || (agent as any).can_propose === true;
}
