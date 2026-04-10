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
  getMainAgentThread,
} from './managed-teams';
import { notifyMainAgent } from './notify-bridge';
import { getAgentById, getConfig } from '../../config/config';
import { getTeamWorkspacePath, readTeamMemoryContext } from './team-workspace';

type HandleChatFn = (
  message: string,
  sessionId: string,
  sendSSE: (event: string, data: any) => void,
  pinnedMessages?: Array<{ role: string; content: string }>,
  abortSignal?: { aborted: boolean },
  callerContext?: string,
  modelOverride?: string,
  executionMode?: 'interactive' | 'background_task' | 'heartbeat' | 'cron',
  toolFilter?: string[],
) => Promise<{ type: string; text: string; thinking?: string }>;

interface CoordinatorDeps {
  handleChat: HandleChatFn;
  broadcastTeamEvent: (data: object) => void;
  onCoordinatorDone?: (event: { teamId: string; reason: string; turns: number; managerMessage: string }) => Promise<void> | void;
}

let _deps: CoordinatorDeps | null = null;

export function setCoordinatorDeps(deps: CoordinatorDeps): void {
  _deps = deps;
}

function getCoordSessionId(teamId: string): string {
  return `team_coord_${teamId}`;
}

function buildTeamCallerContext(teamId: string): string {
  const team = getManagedTeam(teamId);
  if (!team) return '';

  const agentList = team.subagentIds
    .map(id => {
      const a = getAgentById(id) as any;
      const pauseState = team.agentPauseStates?.[id];
      const pauseTag = pauseState?.paused ? ' [PAUSED]' : '';
      return a
        ? `  - ${a.name} (id: ${id})${pauseTag}: ${a.description || 'no description'}`
        : `  - ${id}${pauseTag}`;
    })
    .join('\n');

  const recentChat = (team.teamChat || [])
    .slice(-50)
    .map(m => `  [${m.fromName}]: ${String(m.content || '').slice(0, 2000)}`)
    .join('\n') || '  (no recent chat)';

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
    const teamWsPath = getTeamWorkspacePath(team.id);
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
    `=== TEAM COORDINATOR MODE ===`,
    `You are acting as the Manager for the team: "${team.name}" (ID: ${team.id})`,
    `Team workspace: ${teamWsPath}`,
    ``,
    `Team Purpose:`,
    goalContext,
    ``,
    `Subagents on this team:`,
    agentList,
    ``,
    `Recent team chat:`,
    recentChat,
    teamContext ? `\nAdditional team context:\n${teamContext}` : '',
    threadContext,
    memoryContext ? `\n[CROSS-RUN MEMORY]\n${memoryContext}` : `\n[CROSS-RUN MEMORY]\n(memory files not yet initialized — write them at end of this run)`,
    ``,
    `COORDINATOR WORKFLOW (purpose → task → execute → write back):`,
    `STEP 1 — DERIVE THIS RUN'S TASK: Read the cross-run memory above. Based on what's already been done, what's pending, and what's new, decide what THIS specific run should accomplish. Call manage_team_goal(action="update_focus", focus="<your derived task>") to record it.`,
    `STEP 2 — EXECUTE: Dispatch agents with specific tasks derived from STEP 1. Don't re-do work that's already in memory.json as completed.`,
    `STEP 3 — WRITE BACK: Before posting [GOAL_COMPLETE], update the memory files at ${teamWsPath}:`,
    `  - memory.json: append new findings/knowledge to the entries array`,
    `  - last_run.json: overwrite with what this run did (task, summary, agentsUsed, runAt)`,
    `  - pending.json: add new unresolved items; remove items that were resolved this run`,
    ``,
    `COORDINATOR RULES:`,
    `1. Use dispatch_team_agent tool to delegate tasks to subagents. Always pass team_id="${team.id}" and the agent_id from the list above.`,
    `2. Your text response will be posted to the team chat as the Manager.`,
    `3. This session is isolated from the main user chat — act now, do not defer.`,
    `4. After a subagent completes, the result is returned as the tool output — review it and decide next steps.`,
    `5. Be concise and action-oriented. Post status updates to keep the team owner informed.`,
    `6. Work CONTINUOUSLY toward this run's derived task. Keep dispatching agents, reviewing results, and making progress until this run's task is done.`,
    `7. When this run is complete (task done + memory files updated), end with: [GOAL_COMPLETE]`,
    `8. If you need the team owner to make a decision or provide input, end with: [NEEDS_INPUT]`,
    `9. You are the ONLY bridge between this team and the main Prometheus agent. Use message_main_agent(team_id="${team.id}", message="...") to communicate.`,
    `10. NEVER pause or give up before first messaging the main agent. Errors, blockers, missing credentials — all go to the main agent first.`,
    `11. Do NOT create new teams. Explain to the main agent what team would help and why.`,
    `12. When waiting for a main agent reply, post [WAITING_MAIN_AGENT] to pause. You will auto-resume when their reply arrives.`,
    `13. Use manage_team_goal to update focus, log completed work, and manage milestones throughout the run.`,
    `14. Use manage_team_goal with pause_agent/unpause_agent to control which agents are active.`,
    `15. dispatch_team_agent is available in this coordinator session. Do NOT claim tooling limitations or say the tool is unavailable unless you actually called it and received an explicit tool error in this turn.`,
    `16. PROPOSALS: You have write_proposal and full source_write tools available. Use them selectively:`,
    `    - Use write_proposal for changes that require human approval: src/ code edits, new features, major config changes, risky operations.`,
    `    - Use source_write tools (find_replace_source, etc.) directly ONLY for low-risk changes like comments, docs, or minor fixes clearly within your team mandate.`,
    `    - Workspace files (team JSON, markdown, outputs) can always be edited directly — no proposal needed.`,
    `    - NOT everything needs a proposal. Only gate actions where a human should verify before execution.`,
  ].filter(Boolean).join('\n');
}

// Safety cap: absolute max turns to prevent runaway (high enough to not interfere normally)
const SAFETY_MAX_TURNS = 25;
// Idle detection: if coordinator goes this many turns without dispatching any agent, stop
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
): Promise<void> {
  if (!_deps) {
    console.warn('[TeamCoordinator] deps not wired — coordinator conversation skipped.');
    return;
  }
  const team = getManagedTeam(teamId);
  if (!team) return;

  const sessionId = getCoordSessionId(teamId);
  const nullSse = (_e: string, _d: any) => {};
  const bfn = broadcastFn || _deps.broadcastTeamEvent;
  const workspacePath = getConfig().getWorkspacePath();
  let currentMessage = userMessage;
  const maxTurns = autoContinue ? SAFETY_MAX_TURNS : 1;
  let consecutiveIdleTurns = 0; // turns without any dispatch_team_agent call

  for (let turn = 0; turn < maxTurns; turn++) {
    // Check if team was paused (user clicked Stop)
    const freshTeam = getManagedTeam(teamId);
    if (!freshTeam || freshTeam.manager?.paused === true) {
      console.log(`[TeamCoordinator] Team "${teamId}" paused — stopping continuation.`);
      break;
    }

    // Rebuild caller context each turn (picks up latest team chat, goal state, thread)
    const callerContext = buildTeamCallerContext(teamId);

    // Ensure team_ops + source_write tools are available in the coordinator session every turn
    // (category activation is per-session but must be re-applied after restarts)
    try {
      const { activateToolCategory } = require('../session');
      activateToolCategory(sessionId, 'team_ops');
      activateToolCategory(sessionId, 'source_write');
    } catch { /* non-fatal */ }

    let responseText = '';
    let hadDispatch = false;
    try {
      // Track dispatch calls and forward coordinator activity to the originating chat
      // session's process log via WS so the main chat doesn't appear to hang silently.
      const originatingSession = (freshTeam as any)?.originatingSessionId || '';
      const trackingSse = (event: string, data: any) => {
        if (event === 'tool_call') {
          const toolName = String(data?.action || data?.tool || data?.name || '');
          if (toolName === 'dispatch_team_agent') {
            hadDispatch = true;
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
        undefined,
        callerContext,
        undefined,
        'background_task',
      );

      responseText = String(result.text || '').trim();
      if (responseText) {
        const chatMsg = appendTeamChat(teamId, {
          from: 'manager',
          fromName: 'Manager',
          content: responseText,
        });
        bfn({ type: 'team_chat_message', teamId, teamName: team.name, chatMessage: chatMsg, message: responseText });
      }
    } catch (err: any) {
      console.error('[TeamCoordinator] conversation error:', err.message);
      appendTeamChat(teamId, {
        from: 'manager',
        fromName: 'Manager',
        content: `Error processing your request: ${err.message}`,
      });
      bfn({ type: 'team_chat_message', teamId, teamName: team.name });
      break; // don't continue on error
    }

    // ── Continuation logic (only when autoContinue=true) ──────────────────
    if (!autoContinue) break;

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
      appendTeamChat(teamId, {
        from: 'manager',
        fromName: 'System',
        content: `Coordinator paused after ${maxTurns} turns (safety limit). Click Start to continue.`,
      });
      bfn({ type: 'team_coordinator_done', teamId, teamName: team.name, reason: 'safety_cap', turns: maxTurns });
      break;
    }

    // Idle detection: if coordinator hasn't dispatched any agent, count it
    if (hadDispatch) {
      consecutiveIdleTurns = 0;
    } else {
      consecutiveIdleTurns++;
    }

    // If coordinator gave a very short response with no substance and no dispatch, assume done
    if (responseText.length < 80 && !hadDispatch) {
      console.log(`[TeamCoordinator] Short idle response — assuming done. (${turn + 1} turn(s))`);
      bfn({ type: 'team_coordinator_done', teamId, teamName: team.name, reason: 'natural_stop', turns: turn + 1 });
      break;
    }

    // If N turns without any dispatch, the coordinator is probably done
    if (consecutiveIdleTurns >= IDLE_TURNS_THRESHOLD) {
      console.log(`[TeamCoordinator] ${IDLE_TURNS_THRESHOLD} turns without dispatch — idle stop. (${turn + 1} turn(s))`);
      bfn({ type: 'team_coordinator_done', teamId, teamName: team.name, reason: 'idle', turns: turn + 1 });
      break;
    }

    // ── Fire continuation turn ────────────────────────────────────────────
    console.log(`[TeamCoordinator] Continuation turn ${turn + 2}/${maxTurns} for team "${teamId}"`);

    currentMessage = [
      `[CONTINUATION — turn ${turn + 2}]`,
      `Your previous turn has ended. Review the team chat for any new results from agents you dispatched.`,
      ``,
      `Continue working toward this run's derived task. Dispatch more agents if needed, review results, and make progress.`,
      `When this run's task is fully complete AND memory files are updated (memory.json, last_run.json, pending.json), end with [GOAL_COMPLETE].`,
      `If you need the team owner to make a decision, end with [NEEDS_INPUT].`,
      `If you sent a message to the main agent and are waiting, end with [WAITING_MAIN_AGENT].`,
    ].join('\n');
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
  const nullSse = (_e: string, _d: any) => {};
  const bfn = broadcastFn || _deps.broadcastTeamEvent;

  // Ensure team_ops + source_write tools are available in the coordinator session
  try {
    const { activateToolCategory } = require('../session');
    activateToolCategory(sessionId, 'team_ops');
    activateToolCategory(sessionId, 'source_write');
  } catch { /* non-fatal */ }

  const reviewPrompt = [
    `A subagent on your team just completed a scheduled run. Review the current team state and decide what (if anything) needs to happen next.`,
    ``,
    `Check: Did the subagent accomplish their goal? Are there follow-up tasks for other agents? Any issues to report to the team owner?`,
    ``,
    `If follow-up tasks are needed, use dispatch_team_agent to run the appropriate subagent now.`,
    `If work is complete, post a brief status update to the team chat.`,
    `If nothing needs action, reply with a very short acknowledgment.`,
    `Remember to update the team focus and log completed work using manage_team_goal.`,
  ].join('\n');

  try {
    const result = await _deps.handleChat(
      reviewPrompt,
      sessionId,
      nullSse,
      undefined,
      undefined,
      callerContext,
      undefined,
      'background_task',
    );

    const responseText = String(result.text || '').trim();
    if (responseText && responseText.length > 20) {
      const chatMsg = appendTeamChat(teamId, {
        from: 'manager',
        fromName: 'Manager',
        content: responseText,
      });
      bfn({ type: 'team_chat_message', teamId, teamName: team.name, chatMessage: chatMsg, message: responseText });
    }
  } catch (err: any) {
    console.error('[TeamCoordinator] review error:', err.message);
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
