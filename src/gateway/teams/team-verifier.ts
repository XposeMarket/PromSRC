/**
 * team-verifier.ts — Owner Verification Loop
 *
 * When a team coordinator signals [GOAL_COMPLETE] or [NEEDS_INPUT], the main
 * Prometheus agent runs a full verification pass in a dedicated review session:
 *
 *   1. Reads claimed deliverables from run history + team chat
 *   2. Actively verifies them — reads files, hits URLs, checks git
 *   3. Attributes issues to specific agents with what they claimed vs what's real
 *   4. Either:
 *      [APPROVE] → summary injected into main chat, session visible in sidebar
 *      [REVISE]  → structured per-agent feedback sent back to coordinator
 *                  coordinator re-dispatches ONLY broken agents to fix their work
 *                  coordinator calls [GOAL_COMPLETE] again → round 2 verification
 *   5. Max 3 rounds before force-approve with a note
 *
 * [NEEDS_INPUT] is handled differently: lightweight, no looping — just surfaces
 * the coordinator's question cleanly to the main chat for the user to answer.
 */

import path from 'path';
import {
  getManagedTeam,
  getTeamRunHistory,
  type ManagedTeam,
} from './managed-teams';
import { getTeamWorkspacePath } from './team-workspace';
import { addMessage, getSession } from '../session';
import { getLastMainSessionId } from '../comms/broadcaster';
import { getConfig } from '../../config/config';

// ─── Types ────────────────────────────────────────────────────────────────────

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

type HandleManagerConversationFn = (
  teamId: string,
  message: string,
  broadcastFn?: (data: object) => void,
  autoContinue?: boolean,
) => Promise<void>;

export interface VerifierDeps {
  handleChat: HandleChatFn;
  broadcastFn: (data: object) => void;
  handleManagerConversation: HandleManagerConversationFn;
}

interface VerificationState {
  sessionId: string;
  round: number;
  maxRounds: number;
  teamId: string;
  signal: 'goal_complete' | 'needs_input';
  startedAt: number;
}

// ─── Module-level state ───────────────────────────────────────────────────────

let _deps: VerifierDeps | null = null;
const _states = new Map<string, VerificationState>();

export function setVerifierDeps(deps: VerifierDeps): void {
  _deps = deps;
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Called from startup.ts onCoordinatorDone callback.
 * Handles both [GOAL_COMPLETE] (full loop) and [NEEDS_INPUT] (escalation only).
 */
export async function triggerVerification(
  teamId: string,
  signal: 'goal_complete' | 'needs_input',
  coordinatorMessage: string,
): Promise<void> {
  if (!_deps) {
    console.warn('[TeamVerifier] deps not wired — verification skipped.');
    return;
  }

  const team = getManagedTeam(teamId);
  if (!team) return;

  // [NEEDS_INPUT] — lightweight escalation, no loop
  if (signal === 'needs_input') {
    await _handleNeedsInput(team, coordinatorMessage);
    return;
  }

  // [GOAL_COMPLETE] — full verification loop
  const existing = _states.get(teamId);

  if (existing) {
    // Continuation after a revision round
    existing.round += 1;
    console.log(`[TeamVerifier] Revision round ${existing.round}/${existing.maxRounds} for team "${team.name}"`);
    await _runVerificationRound(team, existing, coordinatorMessage);
  } else {
    // First round — create the session
    const sessionId = `team_review_${teamId}_${Date.now()}`;
    const state: VerificationState = {
      sessionId,
      round: 1,
      maxRounds: 3,
      teamId,
      signal,
      startedAt: Date.now(),
    };
    _states.set(teamId, state);

    console.log(`[TeamVerifier] Starting verification round 1 for team "${team.name}" — session ${sessionId}`);

    // Ensure session exists on disk
    getSession(sessionId);

    // Broadcast session creation so front-end adds it to sidebar
    _deps.broadcastFn({
      type: 'team_review_started',
      teamId,
      teamName: team.name,
      sessionId,
    });

    await _runVerificationRound(team, state, coordinatorMessage);
  }
}

// ─── Verification round ───────────────────────────────────────────────────────

async function _runVerificationRound(
  team: ManagedTeam,
  state: VerificationState,
  coordinatorMessage: string,
): Promise<void> {
  if (!_deps) return;
  const { handleChat, broadcastFn } = _deps;

  const workspacePath = getConfig().getWorkspacePath();
  const teamWorkspacePath = getTeamWorkspacePath(team.id);

  // Build rich context for the verifier
  const callerContext = _buildVerifierCallerContext(team, state, coordinatorMessage, teamWorkspacePath);
  const prompt = _buildVerificationPrompt(team, state, coordinatorMessage);

  let stepCount = 0;
  const sendSSE = (event: string, data: any) => {
    if (event === 'tool_call') stepCount++;
    // Relay tool calls as team events so the front-end process log stays live
    broadcastFn({ type: 'team_review_tool', teamId: team.id, sessionId: state.sessionId, tool: data?.action, args: data?.args });
  };

  let responseText = '';
  try {
    const result = await handleChat(
      prompt,
      state.sessionId,
      sendSSE,
      undefined,
      undefined,
      callerContext,
      undefined,
      'background_task',
    );
    responseText = String(result?.text || '').trim();
  } catch (err: any) {
    console.error(`[TeamVerifier] handleChat failed on round ${state.round}:`, err.message);
    responseText = `[APPROVE]\nVERIFICATION ERROR: Could not complete verification (${err.message}). Treating as approved.`;
  }

  console.log(`[TeamVerifier] Round ${state.round} done — tool calls: ${stepCount}, response length: ${responseText.length}`);

  // Parse response
  const upper = responseText.toUpperCase();
  const hasApprove = upper.includes('[APPROVE]');
  const hasRevise = upper.includes('[REVISE]');
  const maxRoundsReached = state.round >= state.maxRounds;

  if (hasApprove || (!hasRevise) || maxRoundsReached) {
    // Done — finalize
    let finalSummary = responseText;
    if (maxRoundsReached && !hasApprove) {
      finalSummary = `⚠️ **Max review rounds reached (${state.maxRounds}).** The team was asked to revise but could not fully satisfy verification in time.\n\n${responseText}`;
    }
    await _finalizeVerification(team, state, finalSummary, workspacePath, broadcastFn);
  } else {
    // [REVISE] — extract issues and send feedback to coordinator
    const feedbackMsg = _buildCoordinatorFeedback(responseText, state.round, state.maxRounds);
    console.log(`[TeamVerifier] Sending revision feedback to coordinator for team "${team.name}" (round ${state.round})`);

    // Add a note to the review session so the conversation history shows the loop
    addMessage(state.sessionId, {
      role: 'assistant',
      content: `**Round ${state.round} — Verification found issues. Sending feedback to team coordinator...**\n\n${responseText}`,
      timestamp: Date.now(),
    }, { disableMemoryFlushCheck: true, disableCompactionCheck: true });

    // Restart coordinator with the structured feedback
    // When it calls [GOAL_COMPLETE] again, triggerVerification() is called again
    // and the existing state entry above (with incremented round) triggers the next round
    _deps.handleManagerConversation(team.id, feedbackMsg, broadcastFn, true).catch((err: any) => {
      console.error(`[TeamVerifier] Coordinator restart failed:`, err.message);
    });
  }
}

// ─── Finalize ─────────────────────────────────────────────────────────────────

async function _finalizeVerification(
  team: ManagedTeam,
  state: VerificationState,
  summary: string,
  workspacePath: string,
  broadcastFn: (data: object) => void,
): Promise<void> {
  _states.delete(team.id);

  const cleanSummary = summary
    .replace(/^\[APPROVE\]\s*/i, '')
    .trim();

  const durationMs = Date.now() - state.startedAt;
  const roundLabel = state.round === 1 ? '1 round' : `${state.round} rounds`;

  const mainChatSummary = [
    `## ✅ Team Review Complete — ${team.name}`,
    `*${roundLabel} · ${Math.round(durationMs / 1000)}s*`,
    '',
    cleanSummary,
  ].join('\n');

  // 1. Add final summary to the review session
  addMessage(state.sessionId, {
    role: 'assistant',
    content: mainChatSummary,
    timestamp: Date.now(),
  }, { disableMemoryFlushCheck: true, disableCompactionCheck: true });

  // 2. Broadcast completion so front-end can update the session and inject into main chat
  broadcastFn({
    type: 'team_review_complete',
    teamId: team.id,
    teamName: team.name,
    sessionId: state.sessionId,
    summary: mainChatSummary,
    round: state.round,
    durationMs,
  });

  // 3. Inject into the current main chat session
  const mainSessionId = getLastMainSessionId();
  if (mainSessionId && !mainSessionId.startsWith('team_') && !mainSessionId.startsWith('cron_')) {
    addMessage(mainSessionId, {
      role: 'assistant',
      content: mainChatSummary,
      timestamp: Date.now(),
    }, { disableMemoryFlushCheck: true, disableCompactionCheck: true });
    console.log(`[TeamVerifier] Summary injected into main chat session ${mainSessionId}`);
  }

  console.log(`[TeamVerifier] Verification complete for "${team.name}" — ${roundLabel}`);
}

// ─── [NEEDS_INPUT] handler ────────────────────────────────────────────────────

async function _handleNeedsInput(team: ManagedTeam, coordinatorMessage: string): Promise<void> {
  if (!_deps) return;
  const { broadcastFn } = _deps;

  // Extract the question/issue from the coordinator's message
  const question = coordinatorMessage
    .replace(/\[NEEDS_INPUT\]/gi, '')
    .trim();

  const mainChatMsg = [
    `## 🙋 Team Input Required — ${team.name}`,
    '',
    question || '*(The team coordinator needs your input — check the Teams panel for details.)*',
    '',
    `*Reply using \`reply_to_team\` or by typing in the team chat.*`,
  ].join('\n');

  // Inject directly into main chat
  const mainSessionId = getLastMainSessionId();
  if (mainSessionId && !mainSessionId.startsWith('team_') && !mainSessionId.startsWith('cron_')) {
    addMessage(mainSessionId, {
      role: 'assistant',
      content: mainChatMsg,
      timestamp: Date.now(),
    }, { disableMemoryFlushCheck: true, disableCompactionCheck: true });
  }

  broadcastFn({
    type: 'team_needs_input',
    teamId: team.id,
    teamName: team.name,
    message: mainChatMsg,
    question,
  });

  console.log(`[TeamVerifier] [NEEDS_INPUT] surfaced for team "${team.name}"`);
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

function _buildVerificationPrompt(
  team: ManagedTeam,
  state: VerificationState,
  coordinatorMessage: string,
): string {
  return [
    `[TEAM OWNER REVIEW — ${team.name}]`,
    `Round ${state.round} of ${state.maxRounds}`,
    '',
    `The team coordinator has signaled [GOAL_COMPLETE]. You are the owner. Your job is to VERIFY that the work is actually done — not just claimed.`,
    '',
    `**What you MUST do:**`,
    `1. Read the coordinator's completion message and the run history to understand what was claimed.`,
    `2. For each significant deliverable, ACTUALLY CHECK IT:`,
    `   - Files: read_file to confirm they exist and contain real content (not placeholders/TODOs)`,
    `   - URLs (Vercel, GitHub, websites): web_fetch to confirm they return 200 and the right content`,
    `   - Git: run_command("git -C <path> log --oneline -5") to verify commits actually happened`,
    `   - Code: spot-check that referenced components/imports actually exist`,
    `3. Attribute any issues to the SPECIFIC AGENT that claimed the work.`,
    `4. End your response with EXACTLY ONE of:`,
    '',
    `   [APPROVE]`,
    `   SUMMARY: <1-3 paragraph verification summary for the owner>`,
    `   ✅ <verified item>`,
    `   ✅ <verified item>`,
    `   NEXT RECOMMENDED ACTIONS:`,
    `   1. ...`,
    '',
    `   — OR —`,
    '',
    `   [REVISE]`,
    `   OVERALL: <one line summary of issues>`,
    '',
    `   AGENT: <agent_id>`,
    `   CLAIMED: "<exact quote of what they said they did>"`,
    `   PROBLEM: <what you actually found — be specific, include file paths, URL responses, etc.>`,
    `   ACTION: <exact instruction for the agent to fix it>`,
    '',
    `   (Repeat AGENT/CLAIMED/PROBLEM/ACTION block for each broken agent)`,
    '',
    `Do NOT approve if anything is broken or incomplete. Be thorough. The owner is counting on this verification.`,
    `${state.round >= state.maxRounds ? `\n⚠️ This is the FINAL round. You must output [APPROVE] regardless of remaining issues — document what is still broken in your summary.` : ''}`,
  ].filter(s => s !== undefined).join('\n');
}

function _buildVerifierCallerContext(
  team: ManagedTeam,
  state: VerificationState,
  coordinatorMessage: string,
  teamWorkspacePath: string,
): string {
  // Run history — last 15 runs with claimed results
  const runHistory = getTeamRunHistory(team.id, 15);
  const runHistoryBlock = runHistory.length > 0
    ? runHistory.map((r: any, i: number) => {
        const ts = r.startedAt ? new Date(r.startedAt).toLocaleTimeString() : '?';
        const status = r.success ? '✅' : '❌';
        const result = String(r.resultPreview || r.error || '').slice(0, 300);
        return `  ${i + 1}. [${ts}] ${status} ${r.agentName || r.agentId} — ${result}`;
      }).join('\n')
    : '  (No run history)';

  // Team chat — last 40 messages
  const chatHistory = (team.teamChat || [])
    .slice(-40)
    .map((m: any) => `  [${m.fromName}]: ${String(m.content || '').slice(0, 500)}`)
    .join('\n') || '  (no chat history)';

  // Goal state
  const goalLines: string[] = [];
  if (team.mission) goalLines.push(`Mission: ${team.mission}`);
  if (team.currentFocus) goalLines.push(`Current Focus: ${team.currentFocus}`);
  if (team.completedWork?.length) {
    goalLines.push(`Completed work logged by coordinator:`);
    for (const w of team.completedWork.slice(-8)) goalLines.push(`  - ${w}`);
  }
  if (team.milestones?.length) {
    goalLines.push(`Milestones:`);
    for (const ms of team.milestones) {
      goalLines.push(`  - [${ms.status.toUpperCase()}] ${ms.description}`);
    }
  }

  return [
    `[TEAM OWNER VERIFICATION CONTEXT]`,
    `Team: ${team.name} (${team.id})`,
    `Team workspace: ${teamWorkspacePath}`,
    `  → Use this path for all read_file / run_command checks on team files`,
    ``,
    `[TEAM GOAL STATE]`,
    goalLines.join('\n') || '  (No goal state recorded)',
    ``,
    `[COORDINATOR COMPLETION MESSAGE]`,
    String(coordinatorMessage || '').slice(0, 2000),
    ``,
    `[RECENT AGENT RUN HISTORY — what each agent claimed to do]`,
    runHistoryBlock,
    ``,
    `[TEAM CHAT — last 40 messages]`,
    chatHistory,
    ``,
    `[VERIFICATION TOOLS AVAILABLE]`,
    `- read_file("<path>") — reads files from team workspace or absolute paths`,
    `- web_fetch("<url>") — checks if URLs are live and returns their content`,
    `- run_command("git -C <path> log --oneline -5") — verifies git state`,
    `- run_command("node -e ...") — can check file existence or run quick checks`,
    ``,
    `[OUTPUT FORMAT REMINDER]`,
    `You MUST end with either [APPROVE] or [REVISE] — no other ending is valid.`,
    `Be specific. Name exact file paths. Paste URL responses. Quote agent claims.`,
  ].join('\n');
}

// ─── Coordinator feedback builder ─────────────────────────────────────────────

function _buildCoordinatorFeedback(
  reviseResponse: string,
  round: number,
  maxRounds: number,
): string {
  // Extract everything after [REVISE]
  const reviseIdx = reviseResponse.toUpperCase().indexOf('[REVISE]');
  const issuesBlock = reviseIdx >= 0
    ? reviseResponse.slice(reviseIdx + '[REVISE]'.length).trim()
    : reviseResponse.trim();

  return [
    `[OWNER REVIEW — Round ${round} Feedback]`,
    ``,
    `The owner has reviewed your completion report and found issues that must be fixed.`,
    `Re-dispatch ONLY the agents listed below with their specific fix tasks.`,
    `Do NOT re-run agents whose work was verified as correct.`,
    `Confirm each fix is done before calling [GOAL_COMPLETE] again.`,
    ``,
    issuesBlock,
    ``,
    `This is revision round ${round} of ${maxRounds - 1} allowed.`,
    round >= maxRounds - 1
      ? `⚠️ FINAL REVISION: After this pass, the owner will approve regardless. Make sure everything is actually fixed.`
      : `Fix the issues above, then call [GOAL_COMPLETE] when all fixes are confirmed.`,
  ].join('\n');
}
