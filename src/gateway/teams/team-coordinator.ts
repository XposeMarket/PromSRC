/**
 * team-coordinator.ts — Main Agent as Team Coordinator
 *
 * The main Prometheus agent IS the team coordinator:
 *   - Runs in dedicated session `team_coord_{teamId}` (isolated from main chat)
 *   - Has access to dispatch_team_agent tool to run subagents
 *   - Posts its responses to team chat as 'manager'
 *   - Never writes to the main user chat session
 *   - Can message the main agent via message_main_agent for 2-way planning
 *   - Escalates errors/blockers to main agent BEFORE pausing
 */

import {
  getManagedTeam,
  saveManagedTeam,
  appendTeamChat,
  buildTeamContextRuntimeBlock,
  buildTeamRoomSummary,
  getMainAgentThread,
  drainManagerMessages,
} from './managed-teams';
import { notifyMainAgent } from './notify-bridge';
import { getAgentById, getConfig } from '../../config/config';
import { setWorkspace } from '../session';
import { getTeamWorkspacePath, readTeamMemoryContext, ensureTeamInfoFile } from './team-workspace';
import { registerLiveRuntime, finishLiveRuntime } from '../live-runtime-registry';
import { getRuntimeToolCategories } from '../tool-builder';

type HandleChatFn = (
  message: string,
  sessionId: string,
  sendSSE: (event: string, data: any) => void,
  pinnedMessages?: Array<{ role: string; content: string }>,
  abortSignal?: { aborted: boolean },
  callerContext?: string,
  modelOverride?: string,
  executionMode?: 'interactive' | 'background_task' | 'heartbeat' | 'cron' | 'team_manager' | 'team_subagent',
  toolFilter?: string[],
) => Promise<{ type: string; text: string; thinking?: string }>;

const TEAM_MANAGER_TOOL_FILTER: string[] | undefined = undefined;
const LEGACY_TEAM_MANAGER_TOOL_FILTER = [
  'list_files', 'read_file', 'create_file', 'replace_lines', 'find_replace',
  'mkdir', 'list_directory',
  'memory_write', 'memory_read', 'memory_search',
  'write_note', 'send_telegram',
  'declare_plan', 'complete_plan_step', 'step_complete',
  'write_proposal',
  'agent_list', 'agent_info', 'talk_to_subagent',
  'message_subagent', 'talk_to_teammate', 'update_team_goal',
  'dispatch_team_agent', 'request_team_member_turn', 'get_agent_result',
  'post_to_team_chat', 'message_main_agent', 'reply_to_team', 'manage_team_goal',
];

interface CoordinatorDeps {
  handleChat: HandleChatFn;
  broadcastTeamEvent: (data: object) => void;
  onCoordinatorDone?: (event: { teamId: string; reason: string; turns: number; managerMessage: string }) => Promise<void> | void;
}

export interface CoordinatorConversationOptions {
  sendSSE?: (event: string, data: any) => void;
  abortSignal?: { aborted: boolean };
  sessionIdOverride?: string;
  threadId?: string;
  replyTargetType?: 'room' | 'team' | 'manager' | 'member' | 'user';
  replyTargetId?: string;
  replyTargetLabel?: string;
}

export interface CoordinatorConversationResult {
  teamId: string;
  reason: string;
  turns: number;
  managerMessage: string;
}

type TeamManagerProcessEntry = {
  ts?: string;
  type?: string;
  content?: string;
  actor?: string;
  [key: string]: any;
};

interface TeamManagerTurnTracker {
  streamId: string;
  startedAt: number;
  stepCount: number;
  thinking: string;
  replyText: string;
  processEntries: TeamManagerProcessEntry[];
}

function broadcastTeamChatMessage(
  broadcastFn: (data: object) => void,
  teamId: string,
  teamName: string,
  chatMessage: any,
): void {
  if (!chatMessage) return;
  broadcastFn({
    type: 'team_chat_message',
    teamId,
    teamName,
    chatMessage,
    text: String(chatMessage.content || ''),
  });
}

function safeManagerPreview(value: any, max = 400): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.slice(0, max);
  try {
    return JSON.stringify(value).slice(0, max);
  } catch {
    return String(value).slice(0, max);
  }
}

function createTeamManagerTurnTracker(teamId: string, turn: number): TeamManagerTurnTracker {
  return {
    streamId: `team_manager_${teamId}_${Date.now()}_${turn}`,
    startedAt: Date.now(),
    stepCount: 0,
    thinking: '',
    replyText: '',
    processEntries: [],
  };
}

function pushTeamManagerProcessEntry(
  tracker: TeamManagerTurnTracker,
  type: string,
  content: string,
  extra: Record<string, any> = {},
): void {
  const text = String(content || '').trim();
  if (!text) return;
  tracker.processEntries.push({
    ts: new Date().toLocaleTimeString(),
    type,
    content: text,
    ...extra,
  });
  if (tracker.processEntries.length > 250) {
    tracker.processEntries.splice(0, tracker.processEntries.length - 250);
  }
}

function captureTeamManagerStreamEvent(
  tracker: TeamManagerTurnTracker,
  event: string,
  data: any,
): void {
  if (event === 'token') {
    const chunk = String(data?.text || '');
    if (chunk) tracker.replyText = `${tracker.replyText}${chunk}`;
    return;
  }
  if (event === 'thinking_delta') {
    const chunk = String(data?.thinking || data?.text || '');
    if (chunk) tracker.thinking = `${tracker.thinking}${chunk}`;
    return;
  }
  if (event === 'thinking' || event === 'agent_thought') {
    const thought = String(data?.thinking || data?.text || '').trim();
    if (!thought) return;
    tracker.thinking = tracker.thinking ? `${tracker.thinking}\n\n${thought}` : thought;
    pushTeamManagerProcessEntry(tracker, 'think', thought, data?.actor ? { actor: data.actor } : {});
    return;
  }
  if (event === 'info') {
    const info = String(data?.message || '').trim();
    if (!info) return;
    pushTeamManagerProcessEntry(tracker, 'info', info, data?.actor ? { actor: data.actor } : {});
    return;
  }
  if (event === 'progress_state') {
    const items = Array.isArray(data?.items) ? data.items : [];
    const activeIndex = Number(data?.activeIndex ?? -1);
    const activeItem = activeIndex >= 0 ? items[activeIndex] : null;
    const activeText = String(activeItem?.text || '').trim();
    if (activeText) pushTeamManagerProcessEntry(tracker, 'info', activeText);
    return;
  }
  if (event === 'tool_call') {
    tracker.stepCount += 1;
    const toolName = String(data?.action || data?.tool || data?.name || '?').trim() || '?';
    const argsPreview = safeManagerPreview(data?.args || data?.input || {}, 220);
    pushTeamManagerProcessEntry(
      tracker,
      'tool',
      `${toolName}${argsPreview ? ` ${argsPreview}` : ''}`,
      (data?.args && typeof data.args === 'object')
        ? { args: data.args, ...(data?.actor ? { actor: data.actor } : {}) }
        : (data?.actor ? { actor: data.actor } : {}),
    );
    return;
  }
  if (event === 'tool_result') {
    const toolName = String(data?.action || data?.tool || data?.name || '?').trim() || '?';
    const resultText = safeManagerPreview(data?.result ?? data?.output ?? data?.content ?? '', 500);
    pushTeamManagerProcessEntry(
      tracker,
      data?.error === true ? 'error' : 'result',
      `${toolName} => ${resultText || '(no output)'}`,
      data?.actor ? { actor: data.actor } : {},
    );
    return;
  }
  if (event === 'tool_progress') {
    const toolName = String(data?.action || data?.tool || data?.name || '?').trim() || '?';
    const progressMsg = String(data?.message || '').trim();
    if (!progressMsg) return;
    pushTeamManagerProcessEntry(tracker, 'info', `${toolName}: ${progressMsg}`, data?.actor ? { actor: data.actor } : {});
  }
}

function buildTeamManagerTurnMetadata(
  tracker: TeamManagerTurnTracker,
  finalText: string,
  extra: {
    targetType?: 'room' | 'team' | 'manager' | 'member' | 'user';
    targetId?: string;
    targetLabel?: string;
  } = {},
): {
  runId?: string;
  stepCount?: number;
  durationMs?: number;
  thinking?: string;
  processEntries?: TeamManagerProcessEntry[];
  targetType?: 'room' | 'team' | 'manager' | 'member' | 'user';
  targetId?: string;
  targetLabel?: string;
} {
  const reply = String(finalText || tracker.replyText || '').trim();
  const processEntries = Array.isArray(tracker.processEntries) ? [...tracker.processEntries] : [];
  if (reply && !processEntries.some((entry) => entry?.type === 'final' && String(entry?.content || '').trim() === reply)) {
    processEntries.push({
      ts: new Date().toLocaleTimeString(),
      type: 'final',
      content: reply,
    });
  }
  return {
    runId: tracker.streamId,
    stepCount: tracker.stepCount || undefined,
    durationMs: Math.max(0, Date.now() - tracker.startedAt),
    thinking: String(tracker.thinking || '').trim() || undefined,
    processEntries: processEntries.length > 0 ? processEntries : undefined,
    targetType: extra.targetType,
    targetId: extra.targetId,
    targetLabel: extra.targetLabel,
  };
}

function broadcastTeamManagerStreamStart(
  broadcastFn: (data: object) => void,
  team: any,
  tracker: TeamManagerTurnTracker,
  turn: number,
  source: 'conversation' | 'review',
  autoContinue: boolean,
): void {
  broadcastFn({
    type: 'team_manager_stream_start',
    teamId: team.id,
    teamName: team.name,
    streamId: tracker.streamId,
    turn,
    source,
    autoContinue,
    startedAt: tracker.startedAt,
  });
}

function broadcastTeamManagerStreamEvent(
  broadcastFn: (data: object) => void,
  team: any,
  tracker: TeamManagerTurnTracker,
  turn: number,
  source: 'conversation' | 'review',
  autoContinue: boolean,
  eventType: string,
  data: any,
): void {
  broadcastFn({
    type: 'team_manager_stream_event',
    teamId: team.id,
    teamName: team.name,
    streamId: tracker.streamId,
    turn,
    source,
    autoContinue,
    eventType,
    data,
  });
}

function broadcastTeamManagerStreamDone(
  broadcastFn: (data: object) => void,
  team: any,
  tracker: TeamManagerTurnTracker,
  turn: number,
  source: 'conversation' | 'review',
  autoContinue: boolean,
  reason: string,
): void {
  broadcastFn({
    type: 'team_manager_stream_done',
    teamId: team.id,
    teamName: team.name,
    streamId: tracker.streamId,
    turn,
    source,
    autoContinue,
    reason,
    durationMs: Math.max(0, Date.now() - tracker.startedAt),
    completedAt: Date.now(),
  });
}

let _deps: CoordinatorDeps | null = null;

export function setCoordinatorDeps(deps: CoordinatorDeps): void {
  _deps = deps;
}

function getCoordSessionId(teamId: string): string {
  return `team_coord_${teamId}`;
}

function prepareTeamManagerToolScope(sessionId: string): void {
  try {
    const { setActivatedToolCategories } = require('../session');
    setActivatedToolCategories(sessionId, getRuntimeToolCategories());
  } catch { /* non-fatal */ }
}

function buildTeamCallerContext(teamId: string): string {
  const team = getManagedTeam(teamId);
  if (!team) return '';

  const agentList = team.subagentIds
    .map(id => {
      const a = getAgentById(id) as any;
      const pauseState = team.agentPauseStates?.[id];
      const pauseTag = pauseState?.paused ? ' [PAUSED]' : '';
      if (!a) return `  - ${id}${pauseTag}`;

      const lines = [
        `  - ${a.name} (id: ${id})${pauseTag}: ${a.description || 'no description'}`,
        `    Base preset: ${a.roleType || 'not recorded'}`,
        `    Team role: ${a.teamRole || a.name || 'not recorded'}`,
        `    Team assignment: ${a.teamAssignment || a.description || 'not recorded'}`,
        `    Personality: ${a.identity?.personality?.archetype || 'not recorded'}`,
      ];
      return lines.join('\n');
    })
    .join('\n');

  const teamRoomSummary = buildTeamRoomSummary(team, {
    limitMessages: 20,
    includePlan: true,
    includeArtifacts: true,
  }) || '  (no recent room state)';

  const pendingManagerMessages = drainManagerMessages(teamId);
  const managerInbox = pendingManagerMessages.length > 0
    ? pendingManagerMessages.map((m, i) => `  ${i + 1}. ${m}`).join('\n')
    : '';

  const teamContext = buildTeamContextRuntimeBlock(team);

  // Build purpose/task context
  const purposeStr = (team as any).purpose || team.mission || team.teamContext || (team as any).description || 'Not specified';
  const goalLines: string[] = [];
  goalLines.push(`Purpose: ${purposeStr}`);
  if ((team as any).currentTask) goalLines.push(`Current task (this run): ${(team as any).currentTask}`);
  if (team.currentFocus) goalLines.push(`Current focus: ${team.currentFocus}`);
  if (team.teamMode) goalLines.push(`Team mode: ${team.teamMode}`);
  if (team.completedWork?.length) {
    goalLines.push(`Recent completed work:`);
    for (const w of team.completedWork.slice(-5)) {
      goalLines.push(`  - ${w}`);
    }
  }
  if (team.milestones?.length) {
    goalLines.push(`Milestones:`);
    for (const ms of team.milestones) {
      const agents = ms.relevantAgentIds?.length ? ` (agents: ${ms.relevantAgentIds.join(', ')})` : '';
      goalLines.push(`  - [${ms.status.toUpperCase()}] ${ms.description}${agents}`);
    }
  }
  const goalContext = goalLines.join('\n');

  // Read cross-run memory files (memory.json, last_run.json, pending.json)
  let memoryContext = '';
  try {
    ensureTeamInfoFile(team);
    memoryContext = readTeamMemoryContext(team.id);
  } catch { /* non-fatal */ }

  // Main agent thread context (last 5 messages)
  const threadMsgs = getMainAgentThread(teamId, 5);
  const threadContext = threadMsgs.length > 0
    ? `\n[MAIN AGENT CONVERSATION THREAD — last ${threadMsgs.length} messages]\n` +
      threadMsgs.map(m => `  [${m.from === 'coordinator' ? 'You' : 'Main Agent'}] (${m.type}): ${m.content.slice(0, 400)}`).join('\n')
    : '';

  const teamWsPath = getTeamWorkspacePath(team.id);

  return [
    `=== MANAGER MODE ===`,
    `You are acting as the Manager for the team: "${team.name}" (ID: ${team.id})`,
    `Team workspace: ${teamWsPath}`,
    ``,
    `Team Purpose:`,
    goalContext,
    ``,
    `Subagents on this team:`,
    agentList,
    ``,
    `Recent team room state:`,
    teamRoomSummary,
    managerInbox ? `\n[SUBAGENT MESSAGES WAITING FOR MANAGER]\n${managerInbox}` : '',
    teamContext ? `\nAdditional team context:\n${teamContext}` : '',
    threadContext,
    memoryContext ? `\n[CROSS-RUN MEMORY]\n${memoryContext}` : `\n[CROSS-RUN MEMORY]\n(memory files not yet initialized — write them at end of this run)`,
    ``,
    `COORDINATOR WORKFLOW (purpose → task → execute → validate → write back):`,
    `STEP 1 — DERIVE THIS RUN'S TASK: Read the cross-run memory above. Based on what's already been done, what's pending, and what's new, decide what THIS specific run should accomplish. Call manage_team_goal(action="update_focus", focus="<your derived task>") to record it.`,
    `STEP 2 — COLLABORATE BEFORE EXECUTION WHEN NEEDED: If you need a member's plan, judgment, readiness check, or clarification before assigning concrete work, use request_team_member_turn so they speak in the shared room first. Use background=true when you want multiple members to weigh in concurrently.`,
    `STEP 3 — EXECUTE: Once work is concrete, dispatch agents with specific tasks derived from STEP 1. Don't re-do work that's already in memory.json as completed.`,
    `STEP 4 — VALIDATE RESULTS: After EACH agent completes, carefully review their output:`,
    `  - Is the result SUBSTANTIVE (actual findings, data, analysis — not just directory listings or placeholders)?`,
    `  - Did they execute their task (call tools, return meaningful content)?`,
    `  - If result is empty, suspicious, or incomplete → RED FLAG: re-dispatch that agent with a specific fix request.`,
    `  - Do NOT accept vague/hollow completions without follow-up verification.`,
    `STEP 5 — WRITE BACK: Before posting [GOAL_COMPLETE], update the memory files at ${teamWsPath}:`,
    `  - memory.json: append new findings/knowledge to the entries array`,
    `  - last_run.json: overwrite with what this run did (task, summary, agentsUsed, runAt)`,
    `  - pending.json: add new unresolved items; remove items that were resolved this run`,
    ``,
    `MANAGER RULES:`,
    `1. Use request_team_member_turn when you want a member to think with the team in-room before execution. Use dispatch_team_agent when the member is ready for actual execution work. Always pass team_id="${team.id}" and the agent_id from the list above.`,
    `2. Your text response will be posted to the team chat as the Manager.`,
    `3. This session is isolated from the main user chat — act now, do not defer.`,
    `4. After a subagent completes, the result is returned as the tool output — VALIDATE IT CAREFULLY before accepting it. RED FLAGS that require re-dispatch:`,
    `   ⚠️ Result starts with "⚠️ INCOMPLETE" — agent did NOT properly execute`,
    `   ⚠️ Result is mostly file listings ([DIR], [FILE]) with no actual findings`,
    `   ⚠️ Result is just "Done." or "Task complete." with no substantive output`,
    `   ⚠️ stepCount = 0 (agent made zero tool calls) — agent did nothing`,
    `   ⚠️ Result length < 100 chars for a complex research/analysis task`,
    `   ⚠️ HOLLOW WORK: Agent reports "research complete" but returned:`,
    `      - Generic categories (e.g. "restaurants in Frederick") instead of actual business names`,
    `      - Directory sources instead of extracted lead data`,
    `      - Assumptions instead of real contact info`,
    `      - "Varies" or "TBD" for websites instead of actual URLs`,
    `      - No specific companies with names, websites, contact details`,
    `   GREEN FLAGS that indicate success:`,
    `   ✓ Result contains SPECIFIC findings (actual company names, real data, verified info)`,
    `   ✓ Contains extracted/verified details: company names, websites, phone/email, addresses`,
    `   ✓ stepCount > 0 (agent called tools and gathered data)`,
    `   ✓ Result length > 500 chars with substantive, specific content (not generic categories)`,
    `   ✓ No warning prefix in the result`,
    `5. Be concise and action-oriented. Post status updates to keep the team owner informed.`,
    `6. Work CONTINUOUSLY toward this run's derived task. Keep dispatching agents, reviewing results, and re-dispatching if needed until work is actually SUBSTANTIVELY DONE.`,
    `7. NEVER accept suspicious results — if you see ANY red flag above, immediately re-dispatch that agent with: "Your previous output was not substantive. Actually execute the task and return real findings."`,
    `8. When this run is complete (all tasks substantively done + memory files updated), end with: [GOAL_COMPLETE]`,
    `8. If you need the team owner to make a decision or provide input, end with: [NEEDS_INPUT]`,
    `9. You are the ONLY bridge between this team and the main Prometheus agent. Use message_main_agent(team_id="${team.id}", message="...") to communicate.`,
    `10. NEVER pause or give up before first messaging the main agent. Errors, blockers, missing credentials — all go to the main agent first.`,
    `11. Do NOT create new teams. Explain to the main agent what team would help and why.`,
    `12. When waiting for a main agent reply, post [WAITING_MAIN_AGENT] to pause. You will auto-resume when their reply arrives.`,
    `13. Use manage_team_goal to update focus, log completed work, and manage milestones throughout the run.`,
    `14. Use manage_team_goal with pause_agent/unpause_agent to control which agents are active.`,
    `15. request_team_member_turn and dispatch_team_agent are both available in this coordinator session. Do NOT claim tooling limitations or say a tool is unavailable unless you actually called it and received an explicit tool error in this turn.`,
    `16. Update memory.json, last_run.json, and pending.json before [GOAL_COMPLETE]. Include room discussions, dispatches, subagent results, verification decisions, files touched, unresolved items, and timestamp.`,
    `17. PROPOSALS: You have write_proposal available. Use it selectively:`,
    `    - Use write_proposal for changes that require human approval: src/ code edits, new features, major config changes, risky operations.`,
    `    - For direct source edits, dispatch a suitably scoped subagent or write a proposal instead of assuming manager-local source_write access.`,
    `    - Workspace files (team JSON, markdown, outputs) can always be edited directly — no proposal needed.`,
    `    - NOT everything needs a proposal. Only gate actions where a human should verify before execution.`,
  ].filter(Boolean).join('\n');
}

// Safety cap: absolute max turns to prevent runaway (high enough to not interfere normally)
const SAFETY_MAX_TURNS = 25;
// Idle detection: if coordinator goes this many turns without engaging members or dispatching any agent, stop
const IDLE_TURNS_THRESHOLD = 3;

/**
 * Run a coordinator turn in response to a user message in the team chat.
 * Called when someone types in the team chat UI or when the Start button is pressed.
 *
 * When autoContinue=true (Start button), the coordinator automatically gets
 * follow-up turns until it signals [GOAL_COMPLETE], [NEEDS_INPUT], [WAITING_MAIN_AGENT],
 * or idles (no dispatches for IDLE_TURNS_THRESHOLD turns).
 */
export async function runCoordinatorConversation(
  teamId: string,
  userMessage: string,
  broadcastFn?: (data: object) => void,
  autoContinue: boolean = false,
  options: CoordinatorConversationOptions = {},
): Promise<void> {
  if (!_deps) {
    console.warn('[TeamCoordinator] deps not wired — coordinator conversation skipped.');
    return;
  }
  const team = getManagedTeam(teamId);
  if (!team) return;

  const sessionId = getCoordSessionId(teamId);
  const bfn = broadcastFn || _deps.broadcastTeamEvent;
  const workspacePath = getConfig().getWorkspacePath();
  let currentMessage = userMessage;
  const maxTurns = autoContinue ? SAFETY_MAX_TURNS : 1;
  let consecutiveIdleTurns = 0; // turns without any member-room or dispatch activity
  const abortSignal = { aborted: false };
  const runtimeId = registerLiveRuntime({
    kind: 'team_manager',
    label: `Team manager - ${team.name}`,
    sessionId,
    teamId,
    source: 'system',
    detail: String(userMessage || '').slice(0, 160),
    abortSignal,
  });

  try {
	  for (let turn = 0; turn < maxTurns; turn++) {
	    if (abortSignal.aborted) break;
    // Check if team was paused (user clicked Stop)
    const freshTeam = getManagedTeam(teamId);
    if (!freshTeam || freshTeam.manager?.paused === true) {
      console.log(`[TeamCoordinator] Team "${teamId}" paused — stopping continuation.`);
      break;
    }

    // Rebuild caller context each turn (picks up latest team chat, goal state, thread)
    const callerContext = buildTeamCallerContext(teamId);
    try { setWorkspace(sessionId, getTeamWorkspacePath(teamId)); } catch { /* non-fatal */ }

    // Ensure team_ops + source_write tools are available in the coordinator session every turn
    // (category activation is per-session but must be re-applied after restarts)
    prepareTeamManagerToolScope(sessionId);

	    let responseText = '';
	    let hadTeamActivity = false;
	    const streamTracker = createTeamManagerTurnTracker(teamId, turn + 1);
	    let streamClosed = false;
	    const closeStream = (reason: string) => {
	      if (streamClosed) return;
	      streamClosed = true;
	      broadcastTeamManagerStreamDone(bfn, team, streamTracker, turn + 1, 'conversation', autoContinue, reason);
	    };
	    broadcastTeamManagerStreamStart(bfn, team, streamTracker, turn + 1, 'conversation', autoContinue);
	    try {
      // Track dispatch calls and forward coordinator activity to the originating chat
      // session's process log via WS so the main chat doesn't appear to hang silently.
      const originatingSession = (freshTeam as any)?.originatingSessionId || '';
	      const trackingSse = (event: string, data: any) => {
	        captureTeamManagerStreamEvent(streamTracker, event, data);
	        broadcastTeamManagerStreamEvent(bfn, team, streamTracker, turn + 1, 'conversation', autoContinue, event, data);
	        if (event === 'tool_call') {
	          const toolName = String(data?.action || data?.tool || data?.name || '');
          if (toolName === 'dispatch_team_agent' || toolName === 'request_team_member_turn') {
            hadTeamActivity = true;
          }
          // Forward to process log
          if (toolName) {
            const argsPreview = data.args ? ' ' + JSON.stringify(data.args).slice(0, 100) : '';
            bfn({ type: 'coordinator_progress', sessionId: originatingSession, teamId, message: `${toolName}${argsPreview}` });
          }
        } else if (event === 'tool_result' && data?.action) {
          const ok = !data.error;
          const preview = String(data.result || '').slice(0, 120);
          bfn({ type: 'coordinator_progress', sessionId: originatingSession, teamId, message: `${data.action} ${ok ? '✓' : '✗'}${preview ? ' — ' + preview : ''}` });
        } else if (event === 'info' && data?.message) {
          bfn({ type: 'coordinator_progress', sessionId: originatingSession, teamId, message: String(data.message).slice(0, 150) });
        }
      };

	      const result = await _deps.handleChat(
	        currentMessage,
	        sessionId,
        trackingSse,
        undefined,
        abortSignal,
        callerContext,
        undefined,
        'team_manager',
        TEAM_MANAGER_TOOL_FILTER,
	      );

	      responseText = String(result.text || '').trim();
	      const resultThinking = String(result.thinking || '').trim();
	      if (resultThinking) {
	        streamTracker.thinking = streamTracker.thinking
	          ? `${streamTracker.thinking}\n\n${resultThinking}`
	          : resultThinking;
	      }
	      if (responseText) {
	        captureTeamManagerStreamEvent(streamTracker, 'final', { text: responseText });
	        broadcastTeamManagerStreamEvent(bfn, team, streamTracker, turn + 1, 'conversation', autoContinue, 'final', { text: responseText });
	      }
	      broadcastTeamManagerStreamEvent(bfn, team, streamTracker, turn + 1, 'conversation', autoContinue, 'done', {
	        reply: responseText,
	        thinking: resultThinking,
	      });
	      if (abortSignal.aborted) {
	        closeStream('aborted');
	        break;
	      }
	      if (responseText) {
	        const chatMsg = appendTeamChat(teamId, {
	          from: 'manager',
	          fromName: 'Manager',
	          content: responseText,
	          threadId: String(options.threadId || '').trim() || undefined,
	          metadata: buildTeamManagerTurnMetadata(streamTracker, responseText, {
              targetType: options.replyTargetType,
              targetId: options.replyTargetId,
              targetLabel: options.replyTargetLabel,
            }),
	        });
	        broadcastTeamChatMessage(bfn, teamId, team.name, chatMsg);
	      }
	      closeStream('turn_complete');
	    } catch (err: any) {
	      if (abortSignal.aborted) {
	        closeStream('aborted');
	        break;
	      }
	      console.error('[TeamCoordinator] conversation error:', err.message);
	      pushTeamManagerProcessEntry(streamTracker, 'error', String(err.message || err));
	      const chatMsg = appendTeamChat(teamId, {
	        from: 'manager',
	        fromName: 'Manager',
	        content: `Error processing your request: ${err.message}`,
	        threadId: String(options.threadId || '').trim() || undefined,
	        metadata: buildTeamManagerTurnMetadata(streamTracker, `Error processing your request: ${err.message}`, {
            targetType: options.replyTargetType,
            targetId: options.replyTargetId,
            targetLabel: options.replyTargetLabel,
          }),
	      });
	      broadcastTeamChatMessage(bfn, teamId, team.name, chatMsg);
	      closeStream('error');
	      break; // don't continue on error
	    }

    // ── Continuation logic (only when autoContinue=true) ──────────────────
    if (!autoContinue) break;
    if (abortSignal.aborted) break;

    // Check for explicit stop signals from the coordinator
    const upperResponse = responseText.toUpperCase();
    if (upperResponse.includes('[GOAL_COMPLETE]')) {
      console.log(`[TeamCoordinator] Goal complete signal — stopping. (${turn + 1} turn(s))`);
      const doneEvent = {
        teamId,
        reason: 'goal_complete',
        turns: turn + 1,
        managerMessage: responseText,
      } as const;
      bfn({ type: 'team_coordinator_done', teamId, teamName: team.name, reason: 'goal_complete', turns: turn + 1 });
      notifyMainAgent(workspacePath, teamId, 'team_task_complete', {
        reason: 'goal_complete',
        managerMessage: responseText,
        turns: turn + 1,
        marker: 'GOAL_COMPLETE',
      }, team.name, team.originatingSessionId);
      try {
        await _deps.onCoordinatorDone?.(doneEvent);
      } catch (err: any) {
        console.warn(`[TeamCoordinator] onCoordinatorDone handler failed: ${err?.message || err}`);
      }
      break;
    }
    if (upperResponse.includes('[NEEDS_INPUT]')) {
      console.log(`[TeamCoordinator] Needs input signal — pausing. (${turn + 1} turn(s))`);
      bfn({ type: 'team_coordinator_done', teamId, teamName: team.name, reason: 'needs_input', turns: turn + 1 });
      try {
        await _deps.onCoordinatorDone?.({ teamId, reason: 'needs_input', turns: turn + 1, managerMessage: responseText });
      } catch (err: any) {
        console.warn(`[TeamCoordinator] onCoordinatorDone (needs_input) handler failed: ${err?.message || err}`);
      }
      break;
    }
    if (upperResponse.includes('[WAITING_MAIN_AGENT]')) {
      console.log(`[TeamCoordinator] Waiting for main agent reply — suspending. (${turn + 1} turn(s))`);
      bfn({ type: 'team_coordinator_done', teamId, teamName: team.name, reason: 'waiting_main_agent', turns: turn + 1 });
      break;
    }

    // If this is the last allowed turn (safety cap), stop
    if (turn >= maxTurns - 1) {
      console.log(`[TeamCoordinator] Safety cap reached (${maxTurns} turns).`);
      const chatMsg = appendTeamChat(teamId, {
        from: 'manager',
        fromName: 'System',
        content: `Coordinator paused after ${maxTurns} turns (safety limit). Click Start to continue.`,
      });
      broadcastTeamChatMessage(bfn, teamId, team.name, chatMsg);
      bfn({ type: 'team_coordinator_done', teamId, teamName: team.name, reason: 'safety_cap', turns: maxTurns });
      break;
    }

    // Idle detection: if coordinator hasn't engaged members or dispatched any agent, count it
    if (hadTeamActivity) {
      consecutiveIdleTurns = 0;
    } else {
      consecutiveIdleTurns++;
    }

    // If coordinator gave a very short response with no substance and no team activity, assume done
    if (responseText.length < 80 && !hadTeamActivity) {
      console.log(`[TeamCoordinator] Short idle response — assuming done. (${turn + 1} turn(s))`);
      bfn({ type: 'team_coordinator_done', teamId, teamName: team.name, reason: 'natural_stop', turns: turn + 1 });
      break;
    }

    // If N turns without any team activity, the coordinator is probably done
    if (consecutiveIdleTurns >= IDLE_TURNS_THRESHOLD) {
      console.log(`[TeamCoordinator] ${IDLE_TURNS_THRESHOLD} turns without team activity — idle stop. (${turn + 1} turn(s))`);
      bfn({ type: 'team_coordinator_done', teamId, teamName: team.name, reason: 'idle', turns: turn + 1 });
      break;
    }

    // ── Fire continuation turn ────────────────────────────────────────────
    console.log(`[TeamCoordinator] Continuation turn ${turn + 2}/${maxTurns} for team "${teamId}"`);

    currentMessage = [
      `[CONTINUATION — turn ${turn + 2}]`,
      `Your previous turn has ended. Review the team chat for any new results from agents you dispatched or members you invited into the room.`,
      ``,
      `Continue working toward this run's derived task. Invite members into the room or dispatch more agents as needed, review results, and make progress.`,
      `When this run's task is fully complete AND memory files are updated (memory.json, last_run.json, pending.json), end with [GOAL_COMPLETE].`,
      `If you need the team owner to make a decision, end with [NEEDS_INPUT].`,
      `If you sent a message to the main agent and are waiting, end with [WAITING_MAIN_AGENT].`,
    ].join('\n');
  }
  } finally {
    finishLiveRuntime(runtimeId);
  }
}

export async function runCoordinatorConversationDetailed(
  teamId: string,
  userMessage: string,
  broadcastFn?: (data: object) => void,
  autoContinue: boolean = false,
  options: CoordinatorConversationOptions = {},
): Promise<CoordinatorConversationResult> {
  const nullSse = (_e: string, _d: any) => {};
  const emitSSE = options.sendSSE || nullSse;
  const abortSignal = options.abortSignal || { aborted: false };

  if (!_deps) {
    console.warn('[TeamCoordinator] deps not wired - coordinator conversation skipped.');
    return { teamId, reason: 'deps_not_ready', turns: 0, managerMessage: '' };
  }
  const team = getManagedTeam(teamId);
  if (!team) return { teamId, reason: 'team_not_found', turns: 0, managerMessage: '' };

  const sessionId = String(options.sessionIdOverride || getCoordSessionId(teamId)).trim();
  const bfn = broadcastFn || _deps.broadcastTeamEvent;
  const workspacePath = getConfig().getWorkspacePath();
  let currentMessage = userMessage;
  const maxTurns = autoContinue ? SAFETY_MAX_TURNS : 1;
  let consecutiveIdleTurns = 0;
  let turnsCompleted = 0;
  let finalReason = autoContinue ? 'natural_stop' : 'single_turn';
  let lastManagerMessage = '';
  const runtimeId = registerLiveRuntime({
    kind: 'team_manager',
    label: `Team manager - ${team.name}`,
    sessionId,
    teamId,
    source: 'system',
    detail: String(userMessage || '').slice(0, 160),
    abortSignal,
  });

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      if (abortSignal.aborted) {
        finalReason = 'aborted';
        break;
      }

      const freshTeam = getManagedTeam(teamId);
      if (!freshTeam || freshTeam.manager?.paused === true) {
        console.log(`[TeamCoordinator] Team "${teamId}" paused - stopping continuation.`);
        finalReason = 'paused';
        break;
      }

      const callerContext = buildTeamCallerContext(teamId);
      try { setWorkspace(sessionId, getTeamWorkspacePath(teamId)); } catch { /* non-fatal */ }

      prepareTeamManagerToolScope(sessionId);

	      let responseText = '';
	      let hadTeamActivity = false;
	      const streamTracker = createTeamManagerTurnTracker(teamId, turn + 1);
	      try {
	        const originatingSession = (freshTeam as any)?.originatingSessionId || '';
	        const trackingSse = (event: string, data: any) => {
	          emitSSE(event, data);
	          captureTeamManagerStreamEvent(streamTracker, event, data);
	          if (event === 'tool_call') {
	            const toolName = String(data?.action || data?.tool || data?.name || '');
            if (toolName === 'dispatch_team_agent' || toolName === 'request_team_member_turn') {
              hadTeamActivity = true;
            }
            if (toolName) {
              const argsPreview = data.args ? ' ' + JSON.stringify(data.args).slice(0, 100) : '';
              bfn({ type: 'coordinator_progress', sessionId: originatingSession, teamId, message: `${toolName}${argsPreview}` });
            }
          } else if (event === 'tool_result' && data?.action) {
            const ok = !data.error;
            const preview = String(data.result || '').slice(0, 120);
            bfn({ type: 'coordinator_progress', sessionId: originatingSession, teamId, message: `${data.action} ${ok ? '[ok]' : '[x]'}${preview ? ' - ' + preview : ''}` });
          } else if (event === 'info' && data?.message) {
            bfn({ type: 'coordinator_progress', sessionId: originatingSession, teamId, message: String(data.message).slice(0, 150) });
          }
        };

        const result = await _deps.handleChat(
          currentMessage,
          sessionId,
          trackingSse,
          undefined,
          abortSignal,
          callerContext,
          undefined,
          'team_manager',
          TEAM_MANAGER_TOOL_FILTER,
	        );

	        responseText = String(result.text || '').trim();
	        const resultThinking = String(result.thinking || '').trim();
	        if (resultThinking) {
	          streamTracker.thinking = streamTracker.thinking
	            ? `${streamTracker.thinking}\n\n${resultThinking}`
	            : resultThinking;
	        }
	        if (responseText) {
	          captureTeamManagerStreamEvent(streamTracker, 'final', { text: responseText });
	        }
	        turnsCompleted = turn + 1;
	        if (abortSignal.aborted) {
	          finalReason = 'aborted';
	          const interruptedText = String(responseText || '').trim();
	          if (interruptedText) {
	            lastManagerMessage = `[Interrupted by user]\n\n${interruptedText}\n\nThe coordinator state and process log were preserved for continuation.`;
	            const chatMsg = appendTeamChat(teamId, {
	              from: 'manager',
	              fromName: 'Manager',
	              content: lastManagerMessage,
	              threadId: String(options.threadId || '').trim() || undefined,
	              metadata: buildTeamManagerTurnMetadata(streamTracker, lastManagerMessage, {
	                targetType: options.replyTargetType,
	                targetId: options.replyTargetId,
	                targetLabel: options.replyTargetLabel,
	              }),
	            });
	            broadcastTeamChatMessage(bfn, teamId, team.name, chatMsg);
	          }
	          break;
	        }
	        if (responseText) {
	          lastManagerMessage = responseText;
	          const chatMsg = appendTeamChat(teamId, {
	            from: 'manager',
	            fromName: 'Manager',
	            content: responseText,
	            threadId: String(options.threadId || '').trim() || undefined,
	            metadata: buildTeamManagerTurnMetadata(streamTracker, responseText, {
                targetType: options.replyTargetType,
                targetId: options.replyTargetId,
                targetLabel: options.replyTargetLabel,
              }),
	          });
	          broadcastTeamChatMessage(bfn, teamId, team.name, chatMsg);
	        }
	      } catch (err: any) {
        if (abortSignal.aborted) {
          finalReason = 'aborted';
          break;
        }
	        console.error('[TeamCoordinator] conversation error:', err.message);
	        finalReason = 'error';
	        lastManagerMessage = `Error processing your request: ${err.message}`;
	        pushTeamManagerProcessEntry(streamTracker, 'error', String(err.message || err));
	        const chatMsg = appendTeamChat(teamId, {
	          from: 'manager',
	          fromName: 'Manager',
	          content: lastManagerMessage,
	          threadId: String(options.threadId || '').trim() || undefined,
	          metadata: buildTeamManagerTurnMetadata(streamTracker, lastManagerMessage, {
              targetType: options.replyTargetType,
              targetId: options.replyTargetId,
              targetLabel: options.replyTargetLabel,
            }),
	        });
	        broadcastTeamChatMessage(bfn, teamId, team.name, chatMsg);
	        break;
      }

      if (!autoContinue) {
        finalReason = 'single_turn';
        break;
      }
      if (abortSignal.aborted) {
        finalReason = 'aborted';
        break;
      }

      const upperResponse = responseText.toUpperCase();
      if (upperResponse.includes('[GOAL_COMPLETE]')) {
        console.log(`[TeamCoordinator] Goal complete signal - stopping. (${turn + 1} turn(s))`);
        finalReason = 'goal_complete';
        const doneEvent = {
          teamId,
          reason: 'goal_complete',
          turns: turn + 1,
          managerMessage: responseText,
        } as const;
        bfn({ type: 'team_coordinator_done', teamId, teamName: team.name, reason: 'goal_complete', turns: turn + 1 });
        notifyMainAgent(workspacePath, teamId, 'team_task_complete', {
          reason: 'goal_complete',
          managerMessage: responseText,
          turns: turn + 1,
          marker: 'GOAL_COMPLETE',
        }, team.name, team.originatingSessionId);
        try {
          await _deps.onCoordinatorDone?.(doneEvent);
        } catch (err: any) {
          console.warn(`[TeamCoordinator] onCoordinatorDone handler failed: ${err?.message || err}`);
        }
        break;
      }
      if (upperResponse.includes('[NEEDS_INPUT]')) {
        console.log(`[TeamCoordinator] Needs input signal - pausing. (${turn + 1} turn(s))`);
        finalReason = 'needs_input';
        bfn({ type: 'team_coordinator_done', teamId, teamName: team.name, reason: 'needs_input', turns: turn + 1 });
        try {
          await _deps.onCoordinatorDone?.({ teamId, reason: 'needs_input', turns: turn + 1, managerMessage: responseText });
        } catch (err: any) {
          console.warn(`[TeamCoordinator] onCoordinatorDone (needs_input) handler failed: ${err?.message || err}`);
        }
        break;
      }
      if (upperResponse.includes('[WAITING_MAIN_AGENT]')) {
        console.log(`[TeamCoordinator] Waiting for main agent reply - suspending. (${turn + 1} turn(s))`);
        finalReason = 'waiting_main_agent';
        bfn({ type: 'team_coordinator_done', teamId, teamName: team.name, reason: 'waiting_main_agent', turns: turn + 1 });
        break;
      }

      if (turn >= maxTurns - 1) {
        console.log(`[TeamCoordinator] Safety cap reached (${maxTurns} turns).`);
        finalReason = 'safety_cap';
        const chatMsg = appendTeamChat(teamId, {
          from: 'manager',
          fromName: 'System',
          content: `Coordinator paused after ${maxTurns} turns (safety limit). Click Start to continue.`,
        });
        if (chatMsg?.content) lastManagerMessage = chatMsg.content;
        broadcastTeamChatMessage(bfn, teamId, team.name, chatMsg);
        bfn({ type: 'team_coordinator_done', teamId, teamName: team.name, reason: 'safety_cap', turns: maxTurns });
        break;
      }

      if (hadTeamActivity) {
        consecutiveIdleTurns = 0;
      } else {
        consecutiveIdleTurns++;
      }

      if (responseText.length < 80 && !hadTeamActivity) {
        console.log(`[TeamCoordinator] Short idle response - assuming done. (${turn + 1} turn(s))`);
        finalReason = 'natural_stop';
        bfn({ type: 'team_coordinator_done', teamId, teamName: team.name, reason: 'natural_stop', turns: turn + 1 });
        break;
      }

      if (consecutiveIdleTurns >= IDLE_TURNS_THRESHOLD) {
        console.log(`[TeamCoordinator] ${IDLE_TURNS_THRESHOLD} turns without team activity - idle stop. (${turn + 1} turn(s))`);
        finalReason = 'idle';
        bfn({ type: 'team_coordinator_done', teamId, teamName: team.name, reason: 'idle', turns: turn + 1 });
        break;
      }

      console.log(`[TeamCoordinator] Continuation turn ${turn + 2}/${maxTurns} for team "${teamId}"`);
      currentMessage = [
        `[CONTINUATION - turn ${turn + 2}]`,
        `Your previous turn has ended. Review the team chat for any new results from agents you dispatched or members you invited into the room.`,
        ``,
        `Continue working toward this run's derived task. Invite members into the room or dispatch more agents as needed, review results, and make progress.`,
        `When this run's task is fully complete AND memory files are updated (memory.json, last_run.json, pending.json), end with [GOAL_COMPLETE].`,
        `If you need the team owner to make a decision, end with [NEEDS_INPUT].`,
        `If you sent a message to the main agent and are waiting, end with [WAITING_MAIN_AGENT].`,
      ].join('\n');
    }

    return {
      teamId,
      reason: finalReason,
      turns: turnsCompleted,
      managerMessage: lastManagerMessage,
    };
  } finally {
    finishLiveRuntime(runtimeId);
  }
}

/**
 * Run a coordinator review after a subagent completes a scheduled run.
 * Called from the scheduler post-run hook.
 */
export async function runCoordinatorReview(
  teamId: string,
  broadcastFn?: (data: object) => void,
): Promise<void> {
  if (!_deps) {
    console.warn('[TeamCoordinator] deps not wired — coordinator review skipped.');
    return;
  }
  const team = getManagedTeam(teamId);
  if (!team || team.manager?.paused === true) return;

  const sessionId = getCoordSessionId(teamId);
  const callerContext = buildTeamCallerContext(teamId);
  const bfn = broadcastFn || _deps.broadcastTeamEvent;
  try { setWorkspace(sessionId, getTeamWorkspacePath(teamId)); } catch { /* non-fatal */ }

  // Ensure team_ops + source_write tools are available in the coordinator session
  prepareTeamManagerToolScope(sessionId);

  const reviewPrompt = [
    `A subagent on your team just completed a scheduled run. Review the current team state and decide what (if anything) needs to happen next.`,
    ``,
    `Check: Did the subagent accomplish their goal? Are there follow-up tasks for other agents? Any issues to report to the team owner?`,
    ``,
    `If follow-up work is needed, use request_team_member_turn for more planning/discussion or dispatch_team_agent for concrete execution.`,
    `If work is complete, post a brief status update to the team chat.`,
    `If nothing needs action, reply with a very short acknowledgment.`,
    `Remember to update the team focus and log completed work using manage_team_goal.`,
  ].join('\n');

  const streamTracker = createTeamManagerTurnTracker(teamId, 1);
  let streamClosed = false;
  const closeStream = (reason: string) => {
    if (streamClosed) return;
    streamClosed = true;
    broadcastTeamManagerStreamDone(bfn, team, streamTracker, 1, 'review', false, reason);
  };

  try {
    broadcastTeamManagerStreamStart(bfn, team, streamTracker, 1, 'review', false);
    const trackingSse = (event: string, data: any) => {
      captureTeamManagerStreamEvent(streamTracker, event, data);
      broadcastTeamManagerStreamEvent(bfn, team, streamTracker, 1, 'review', false, event, data);
    };
    const result = await _deps.handleChat(
      reviewPrompt,
      sessionId,
      trackingSse,
      undefined,
      undefined,
      callerContext,
      undefined,
      'team_manager',
      TEAM_MANAGER_TOOL_FILTER,
    );

    const responseText = String(result.text || '').trim();
    const resultThinking = String(result.thinking || '').trim();
    if (resultThinking) {
      streamTracker.thinking = streamTracker.thinking
        ? `${streamTracker.thinking}\n\n${resultThinking}`
        : resultThinking;
    }
    if (responseText) {
      captureTeamManagerStreamEvent(streamTracker, 'final', { text: responseText });
      broadcastTeamManagerStreamEvent(bfn, team, streamTracker, 1, 'review', false, 'final', { text: responseText });
    }
    broadcastTeamManagerStreamEvent(bfn, team, streamTracker, 1, 'review', false, 'done', {
      reply: responseText,
      thinking: resultThinking,
    });
    if (responseText && responseText.length > 20) {
      const chatMsg = appendTeamChat(teamId, {
        from: 'manager',
        fromName: 'Manager',
        content: responseText,
        metadata: buildTeamManagerTurnMetadata(streamTracker, responseText),
      });
      broadcastTeamChatMessage(bfn, teamId, team.name, chatMsg);
    }
    closeStream('turn_complete');
  } catch (err: any) {
    console.error('[TeamCoordinator] review error:', err.message);
    pushTeamManagerProcessEntry(streamTracker, 'error', String(err.message || err));
    const chatMsg = appendTeamChat(teamId, {
      from: 'manager',
      fromName: 'Manager',
      content: `Review error: ${err.message}`,
      metadata: buildTeamManagerTurnMetadata(streamTracker, `Review error: ${err.message}`),
    });
    broadcastTeamChatMessage(bfn, teamId, team.name, chatMsg);
    closeStream('error');
  }

  // Update lastReviewAt
  const freshTeam = getManagedTeam(teamId);
  if (freshTeam) {
    freshTeam.manager.lastReviewAt = Date.now();
    saveManagedTeam(freshTeam);
  }

  bfn({
    type: 'team_manager_review_done',
    teamId,
    teamName: team.name,
    iterations: 1,
    changesProposed: 0,
    changesAutoApplied: 0,
    managerToolsExecuted: 0,
  });
}

export async function runSubagentResultVerification(
  teamId: string,
  agentId: string,
  dispatchPrompt: string,
  agentResult: string,
  broadcastFn?: (data: object) => void,
): Promise<void> {
  const prompt = [
    `[SUBAGENT RESULT TO VERIFY]`,
    `You dispatched ${agentId} for:`,
    dispatchPrompt,
    ``,
    `The agent returned:`,
    agentResult,
    ``,
    `Verify/analyze the work. Check files created or modified by the agent if relevant. If the output is incomplete, re-dispatch with a specific fix. If accepted, update memory.json and last_run.json.`,
  ].join('\n');
  await runCoordinatorConversation(teamId, prompt, broadcastFn, false);
}
