/**
 * boot.ts - Runs BOOT.md at gateway startup.
 *
 * Daily startup is intentionally lightweight: it summarizes yesterday's
 * intraday notes plus any recent compaction summaries. Hot restarts are
 * conversation-aware and should resume from the previous session context.
 */

import fs from 'fs';
import path from 'path';
import { addMessage, getHistoryForApiCall, getMainChatGoal, getRecentToolObservationsForContext, type ChatMessage } from './session';
import { readRestartContext, clearRestartContext, queueStartupNotification, type RestartContext } from './lifecycle';
import { markDevSourceEditContinuationComplete, type DevSourceEditContinuation } from './dev-source-approvals';
import { markCoordinatedDevApplyBatch } from './dev-edit-coordinator';
import { finalizeMainChatGoalRestartRecovery } from './main-chat-goals';
import {
  listHotRestartMainChatRecoveries,
  type HotRestartMainChatRecovery,
} from './runtime-recovery';

export type BootAutomatedSession = {
  id: string;
  title: string;
  history: Array<{ role: 'assistant' | 'user'; content: string }>;
  automated: true;
  unread: true;
  createdAt: number;
  source: 'boot_startup' | 'hot_restart';
  previousSessionId?: string;
};

type BootResult =
  | { status: 'skipped'; reason: string }
  | {
      status: 'ran';
      reply: string;
      sessionId: string;
      title: string;
      source: 'boot_startup' | 'hot_restart';
      automatedSession?: BootAutomatedSession | null;
      notificationId?: string;
      resumableGoalSessionIds?: string[];
    }
  | { status: 'failed'; reason: string };

type HandleChatFn = (
  message: string,
  sessionId: string,
  sendSSE: (event: string, data: any) => void,
  callerContext?: string,
) => Promise<{ text: string }>;

type BootRunState = {
  lastRunDateLocal?: string;
  lastRunAt?: number;
};

type HotRestartTarget = {
  sessionId: string;
  recoverySummary: string;
  devEdit?: DevSourceEditContinuation;
  telegram: {
    enabled: boolean;
    chatId?: number;
    userId?: number;
  };
};

function getLocalDateKey(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getBootRunStatePath(workspacePath: string): string {
  return path.join(workspacePath, '.prometheus', 'boot-md-state.json');
}

function readBootRunState(workspacePath: string): BootRunState | null {
  try {
    const statePath = getBootRunStatePath(workspacePath);
    if (!fs.existsSync(statePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      lastRunDateLocal: typeof parsed.lastRunDateLocal === 'string' ? parsed.lastRunDateLocal : undefined,
      lastRunAt: Number.isFinite(Number(parsed.lastRunAt)) ? Number(parsed.lastRunAt) : undefined,
    };
  } catch {
    return null;
  }
}

function writeBootRunState(workspacePath: string, state: BootRunState): void {
  try {
    const statePath = getBootRunStatePath(workspacePath);
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
  } catch (e: any) {
    console.warn(`[boot-md] Failed to persist run-state: ${String(e?.message || e)}`);
  }
}

function buildDailyBootPrompt(): string {
  return [
    'DAILY STARTUP SUMMARY:',
    'All relevant startup data has already been pre-fetched for you.',
    'Write a brief 2-3 sentence startup message.',
    'Focus only on what carried over from yesterday\'s intraday notes, whether any compaction summaries suggest something worth resuming, and any recent brain/dream activity worth surfacing from overnight.',
    'You may call write_note once if something from startup is genuinely worth preserving for later (e.g. an unfinished thread to resume); otherwise skip it. Do not call other tools for this startup message.',
    'If there is no meaningful carryover, say so plainly.',
  ].join('\n').trim();
}

function isInternalRestartHistoryMessage(msg: ChatMessage): boolean {
  const text = String(msg?.content || '').trim();
  if (!text) return true;
  if (/^SYSTEM:\s+Context is getting long/i.test(text)) return true;
  if (/^Before continuing:\s+summarize the conversation so far/i.test(text)) return true;
  if (/^\[BACKGROUND_TASK_RESULT\b/i.test(text)) return true;
  if (/^\[Interrupted by gateway restart\]/i.test(text)) return true;
  if (/^\[Hot restart checkpoint: planned by this chat\]/i.test(text)) return true;
  if (/^Restart Context Packet\b/i.test(text)) return true;
  return false;
}

function getRecentConversationForRestart(previousSessionId?: string): {
  excerpt: string;
  lastUserRequest: string;
  lastAssistantResponse: string;
  recentToolLog: string;
} {
  const sid = String(previousSessionId || '').trim();
  if (!sid) {
    return {
      excerpt: '(No previous session was recorded for this restart.)',
      lastUserRequest: '',
      lastAssistantResponse: '',
      recentToolLog: '',
    };
  }

  try {
    const history = getHistoryForApiCall(sid, 12, { maxMessages: 24 })
      .filter((msg) => !isInternalRestartHistoryMessage(msg));
    const recentToolLog = getRecentToolObservationsForContext(sid, 3, 3000);

    if (history.length === 0) {
      return {
        excerpt: `(No recent conversation history was available for session ${sid}.)`,
        lastUserRequest: '',
        lastAssistantResponse: '',
        recentToolLog,
      };
    }

    const excerpt = history.map((msg) => {
      const role = msg.role === 'assistant' ? 'ASSISTANT' : 'USER';
      const content = String(msg.content || '').replace(/\s+/g, ' ').trim().slice(0, 900);
      return `${role}: ${content}`;
    }).join('\n');

    const lastUserRequest = [...history]
      .reverse()
      .find((msg) => msg.role === 'user' && !isInternalRestartHistoryMessage(msg))
      ?.content
      ?.replace(/\s+/g, ' ')
      ?.trim()
      ?.slice(0, 220) || '';
    const lastAssistantResponse = [...history]
      .reverse()
      .find((msg) => msg.role === 'assistant' && !isInternalRestartHistoryMessage(msg))
      ?.content
      ?.replace(/\s+/g, ' ')
      ?.trim()
      ?.slice(0, 320) || '';

    return { excerpt, lastUserRequest, lastAssistantResponse, recentToolLog };
  } catch (err: any) {
    return {
      excerpt: `(Could not load recent conversation history for ${sid}: ${String(err?.message || err || 'unknown error')})`,
      lastUserRequest: '',
      lastAssistantResponse: '',
      recentToolLog: '',
    };
  }
}

function isPlainManualGatewayRestartRequest(value: string): boolean {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(please )?(quickly )?(just )?(restart|reboot) (the )?(gateway|server|prometheus gateway|prometheus server|prometheus)$/.test(normalized)
    || /^(please )?(quickly )?(just )?(gateway|server|prometheus gateway|prometheus server|prometheus) (restart|reboot)$/.test(normalized);
}

function buildHotRestartPrompt(
  lastUserRequest: string,
  lastAssistantResponse: string,
  ctx?: RestartContext,
  targetDevEdit?: DevSourceEditContinuation,
): string {
  const devEdit = targetDevEdit;
  if (devEdit) {
    const tag = devEdit.completionNoteTag || 'dev_edit_complete';
    return [
      'HOT RESTART DEV-EDIT FOLLOW-UP:',
      'A hot restart/reload just completed after an approved Prometheus dev source edit.',
      'Use the restart context, approved dev-edit plan, recent conversation, and recent tool observations as factual memory.',
      'Your FIRST action this turn MUST be a real write_note TOOL CALL — actually invoke the tool, do not print or describe the call as text.',
      `Invoke write_note with these fields: tag set to "${tag}", dev_edit_id set to "${devEdit.id}", and content as a brief summary of files changed, verification, and live status.`,
      'Never output the write_note call as a literal string or code block; emit it through the tool mechanism so the dev-edit plan completes.',
      'After the write_note tool call succeeds, respond to the user with the usual concise edit summary.',
      'Do not redo the source edits unless the context shows apply_live failed.',
      'If the recovery summary shows the main chat was interrupted at gateway_restart or a dev/apply tool, treat that checkpoint as the expected restart boundary from this same chat. Do not describe it as an unexpected interruption and do not ask whether to resume solely because of that checkpoint.',
      lastUserRequest
        ? `Refer to the user's latest request naturally: "${lastUserRequest}".`
        : 'If no prior request is clear, say the approved dev edit was applied and the gateway is back.',
      lastAssistantResponse
        ? `The assistant's latest pre-restart reply was: "${lastAssistantResponse}". Continue from that state; do not pretend it was unseen.`
        : '',
      'Keep it short and concrete.',
    ].filter(Boolean).join('\n').trim();
  }
  const plainManualGatewayRestart = isPlainManualGatewayRestartRequest(lastUserRequest)
    && !ctx?.devEditContinuation
    && (!Array.isArray(ctx?.affectedFiles) || ctx.affectedFiles.length === 0);
  return [
    'HOT RESTART FOLLOW-UP:',
    'A hot restart just completed and you are resuming an existing conversation.',
    'Write the assistant message that should appear right after the restart.',
    'Use the restart context, runtime recovery summary, recent conversation, and recent tool observations only as factual memory.',
    plainManualGatewayRestart
      ? 'The latest user request was a plain manual gateway restart. Reply with only a concise success confirmation that Prometheus/the gateway is back online. Do not continue unrelated prior work, do not mention desktop screenshots, browsers, tools, unavailable tools, verification steps, or next actions.'
      : 'Confirm the restart succeeded, state what was just completed when the context shows it, and give the next verification/action only if it is directly relevant to in-flight work.',
    'If the recovery summary marks a planned restart boundary from gateway_restart or a dev/apply tool, that means Prometheus itself triggered the restart from this chat. Treat it as successful application/restart context, not as an unexpected interruption, and do not ask to resume solely because of that checkpoint.',
    'For any other main-chat interruption that was not a planned restart/apply boundary, explicitly acknowledge the checkpoint and ask whether the user wants you to continue from there.',
    plainManualGatewayRestart
      ? ''
      : 'If any background task, subagent, team run, scheduled task, heartbeat, or brain run was paused/interrupted, mention it briefly and ask whether the user wants it resumed. Include a short identifier when useful.',
    plainManualGatewayRestart
      ? ''
      : (lastUserRequest
        ? `If the work is still in flight, refer to the user's latest request naturally: "${lastUserRequest}".`
        : 'If no prior request is clear, say you are back and ready to continue.'),
    plainManualGatewayRestart
      ? ''
      : (lastAssistantResponse
        ? 'The assistant latest pre-restart reply was available for factual continuity only. Do not quote it or continue it unless it is directly relevant to unfinished work.'
        : ''),
    'Do not claim paused work resumed unless the runtime recovery summary says it auto-resumed.',
    'Never narrate tool availability or say you cannot call tools in this hot-restart message.',
    'Keep it short, natural, and conversational.',
    'Do not call any tools.',
  ].filter(Boolean).join('\n').trim();
}

function buildHotRestartCallerContext(ctx: RestartContext, recentConversation: string, lastUserRequest: string, lastAssistantResponse: string, recentToolLog: string, recoverySummary: string, targetDevEdit?: DevSourceEditContinuation): string {
  const didBuild = ctx.buildOutput !== undefined;
  const affectedFiles = Array.isArray(ctx.affectedFiles) && ctx.affectedFiles.length > 0
    ? ctx.affectedFiles.slice(0, 10).join('\n')
    : '(none recorded)';
  const devEdit = targetDevEdit;
  const devEditLines = devEdit ? [
    '',
    '[DEV EDIT CONTINUATION]',
    `id: ${devEdit.id}`,
    `approval_id: ${devEdit.approvalId || '(none)'}`,
    `plan_hash: ${devEdit.planHash || '(none)'}`,
    `status: ${devEdit.status}`,
    `completion_note_tag: ${devEdit.completionNoteTag || 'dev_edit_complete'}`,
    `summary: ${devEdit.summary || ctx.summary || '(none)'}`,
    'approved_files:',
    ...(Array.isArray(devEdit.allowedFiles) && devEdit.allowedFiles.length ? devEdit.allowedFiles.slice(0, 20) : ['(none recorded)']),
    'plan_steps:',
    ...(Array.isArray(devEdit.plan?.steps) && devEdit.plan.steps.length ? devEdit.plan.steps.slice(0, 8) : ['(none recorded)']),
    'expected_workflow:',
    ...(Array.isArray(devEdit.plan?.expectedWorkflow) && devEdit.plan.expectedWorkflow.length ? devEdit.plan.expectedWorkflow.slice(0, 8) : ['(none recorded)']),
    'verification:',
    ...(Array.isArray(devEdit.verification) && devEdit.verification.length ? devEdit.verification.slice(0, 8) : ['(none recorded)']),
    '[/DEV EDIT CONTINUATION]',
  ] : [];

  return [
    'CONTEXT: Internal hot-restart follow-up turn.',
    'The restart already happened successfully. Use the context below to resume naturally.',
    '[HOT RESTART CONTEXT]',
    `reason: ${ctx.reason}`,
    `title: ${ctx.title || '(none)'}`,
    `summary: ${ctx.summary || '(none)'}`,
    `build_status: ${didBuild ? 'succeeded before restart' : 'restart without build'}`,
    `launcher: ${ctx.restartLauncher || 'unknown'}`,
    `proposal_id: ${ctx.proposalId || '(none)'}`,
    `repair_id: ${ctx.repairId || '(none)'}`,
    `test_instructions: ${ctx.testInstructions || '(none)'}`,
    `last_user_request: ${lastUserRequest || '(none detected)'}`,
    `last_assistant_response: ${lastAssistantResponse || '(none detected)'}`,
    'affected_files:',
    affectedFiles,
    ...devEditLines,
    '',
    'runtime_recovery_summary:',
    recoverySummary || '(none)',
    '',
    'recent_conversation:',
    recentConversation,
    '',
    'recent_tool_log:',
    recentToolLog || '(No recent tool observations recorded.)',
    '[/HOT RESTART CONTEXT]',
  ].join('\n');
}

function buildHotRestartFallbackMessage(lastUserRequest: string, lastAssistantResponse: string): string {
  if (lastAssistantResponse) {
    return `Hey - the restart was successful. I am back in the same thread. Before the restart, my last update was: "${lastAssistantResponse}".`;
  }
  if (lastUserRequest) {
    return `Hey - the restart was successful. I am back in the same thread and ready to keep going on "${lastUserRequest}".`;
  }
  return 'Hey - the restart was successful. I am back in the same thread and ready to continue where we left off.';
}


function sanitizeIdPart(value: string): string {
  const cleaned = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return cleaned || 'startup';
}

function buildAutoSessionMeta(kind: 'boot' | 'restart', restartCtx?: RestartContext): {
  id: string;
  title: string;
  source: 'boot_startup' | 'hot_restart';
  createdAt: number;
} {
  const createdAt = Date.now();
  if (kind === 'restart') {
    const reasonPart = sanitizeIdPart(restartCtx?.reason || 'manual');
    const id = `brain_thought_restart_${reasonPart}_${createdAt}`;
    const title = `Restart (${restartCtx?.reason || 'manual'}) - ${new Date(createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
    return { id, title, source: 'hot_restart', createdAt };
  }
  const id = `auto_boot_${createdAt}`;
  const title = `Startup - ${new Date(createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
  return { id, title, source: 'boot_startup', createdAt };
}

function numberIfPositive(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function buildTargetRecoverySummary(
  sessionId: string,
  sessionRecovery: HotRestartMainChatRecovery | undefined,
  allChatRecoveries: HotRestartMainChatRecovery[],
): string {
  const otherChatCount = allChatRecoveries.filter((recovery) => recovery.sessionId !== sessionId).length;
  const lines: string[] = [];
  if (sessionRecovery) {
    if (sessionRecovery.plannedRestartTool) {
      lines.push(
        `This chat session (${sessionRecovery.sessionId}) reached an expected hot-restart boundary triggered by ${sessionRecovery.plannedRestartTool}:`,
        sessionRecovery.summary,
        'This is evidence that the restart/apply tool was self-triggered from this chat. Do not present it as an unexpected interruption or ask to resume solely because of this main-chat checkpoint.',
      );
    } else {
      lines.push(
        `This chat session (${sessionRecovery.sessionId}) was interrupted during the restart:`,
        sessionRecovery.summary,
      );
    }
  } else {
    lines.push(
      `This chat session (${sessionId}) does not have an interrupted main-chat runtime in this restart window.`,
      'Do not borrow checkpoint details, tool names, or user requests from any other chat session.',
    );
  }
  if (otherChatCount > 0) {
    lines.push(
      '',
      `${otherChatCount} other chat session(s) also had restart checkpoints and will receive their own restart messages.`,
      'Do not mention their request text, tool names, or progress details in this chat.',
    );
  }
  return lines.join('\n');
}

function telegramTargetForRestartSession(
  restartCtx: RestartContext,
  sessionId: string,
  recovery?: HotRestartMainChatRecovery,
): HotRestartTarget['telegram'] {
  const previousSessionId = String(restartCtx.previousSessionId || '').trim();
  const previousChatId = numberIfPositive(restartCtx.previousTelegramChatId);
  if (previousSessionId && previousSessionId === sessionId && restartCtx.respondToTelegram && previousChatId) {
    return {
      enabled: true,
      chatId: previousChatId,
      userId: numberIfPositive(restartCtx.previousTelegramUserId),
    };
  }
  if (recovery?.source === 'telegram' && recovery.chatId) {
    return {
      enabled: true,
      chatId: recovery.chatId,
      userId: recovery.userId,
    };
  }
  return { enabled: false };
}

function buildHotRestartTargets(restartCtx: RestartContext): HotRestartTarget[] {
  const restartWindowStart = Math.max(0, Number(restartCtx.timestamp || 0) - 30_000);
  const recoveries = listHotRestartMainChatRecoveries(30 * 60_000, restartWindowStart);
  const bySession = new Map<string, HotRestartMainChatRecovery>();
  for (const recovery of recoveries) {
    if (recovery.sessionId && !bySession.has(recovery.sessionId)) bySession.set(recovery.sessionId, recovery);
  }

  const targets = new Map<string, HotRestartTarget>();
  const batchMembers = Array.isArray(restartCtx.devApplyBatch?.members) ? restartCtx.devApplyBatch.members : [];
  const batchMemberBySession = new Map(batchMembers.map((member) => [String(member.sessionId || '').trim(), member]));
  // A durable task owns its restart lifecycle. Startup recovery relaunches the
  // task and its normal delivery path reports the result; a separate boot chat
  // message would leak internal task-session state and race the task status.
  if (
    restartCtx.taskId
    && restartCtx.suppressStandaloneRestartMessage
    && restartCtx.taskInitiatedTool === 'gateway_restart'
  ) {
    return [];
  }
  for (const recovery of recoveries) {
    targets.set(recovery.sessionId, {
      sessionId: recovery.sessionId,
      recoverySummary: buildTargetRecoverySummary(recovery.sessionId, recovery, recoveries),
      telegram: telegramTargetForRestartSession(restartCtx, recovery.sessionId, recovery),
      devEdit: batchMemberBySession.get(recovery.sessionId)
        || (restartCtx.devEditContinuation?.sessionId === recovery.sessionId ? restartCtx.devEditContinuation : undefined),
    });
  }

  for (const member of batchMembers) {
    const memberSessionId = String(member.sessionId || '').trim();
    if (!memberSessionId || targets.has(memberSessionId)) continue;
    const recovery = bySession.get(memberSessionId);
    targets.set(memberSessionId, {
      sessionId: memberSessionId,
      recoverySummary: buildTargetRecoverySummary(memberSessionId, recovery, recoveries),
      telegram: telegramTargetForRestartSession(restartCtx, memberSessionId, recovery),
      devEdit: member,
    });
  }

  const previousSessionId = String(restartCtx.previousSessionId || '').trim();
  const previousRecovery = previousSessionId ? bySession.get(previousSessionId) : undefined;
  if (previousSessionId && !targets.has(previousSessionId)) {
    targets.set(previousSessionId, {
      sessionId: previousSessionId,
      recoverySummary: buildTargetRecoverySummary(previousSessionId, previousRecovery, recoveries),
      telegram: telegramTargetForRestartSession(restartCtx, previousSessionId, previousRecovery),
      devEdit: batchMemberBySession.get(previousSessionId)
        || (restartCtx.devEditContinuation?.sessionId === previousSessionId ? restartCtx.devEditContinuation : undefined),
    });
  }

  return Array.from(targets.values());
}

export async function runBootMd(
  workspacePath: string,
  handleChat: HandleChatFn,
): Promise<BootResult> {
  const restartCtx = readRestartContext();
  if (restartCtx) {
    console.log(`[boot-md] Hot restart detected: ${restartCtx.reason} (${restartCtx.title || 'no title'})`);
    clearRestartContext();
    if (restartCtx.devApplyBatch?.id) {
      try { markCoordinatedDevApplyBatch(restartCtx.devApplyBatch.id, 'applied'); } catch {}
    }

    const sessionMeta = buildAutoSessionMeta('restart', restartCtx);
    const targets = buildHotRestartTargets(restartCtx);
    const results = await Promise.all(targets.map(async (target, index) => {
      const { excerpt, lastUserRequest, lastAssistantResponse, recentToolLog } = getRecentConversationForRestart(target.sessionId);
      const internalSessionId = `${sessionMeta.id}_${sanitizeIdPart(target.sessionId)}_${index}`;
      const hotRestartContextPacket = buildHotRestartCallerContext(
        restartCtx,
        excerpt,
        lastUserRequest,
        lastAssistantResponse,
        recentToolLog,
        target.recoverySummary,
        target.devEdit,
      );
      let finalText = '';
      const targetGoal = getMainChatGoal(target.sessionId);
      const targetRestartCheckpoint = targetGoal?.restartCheckpoint;
      const goalOwnedRestart = !!targetGoal
        && ['restarting', 'paused'].includes(String(targetGoal.status || ''))
        && !!targetRestartCheckpoint
        && /restart|prom_apply_dev_changes/i.test(`${targetGoal.pausedReason || ''} ${targetRestartCheckpoint.reason || ''}`);
      const plainManualGatewayRestart = isPlainManualGatewayRestartRequest(lastUserRequest)
        && !target.devEdit
        && (!Array.isArray(restartCtx.affectedFiles) || restartCtx.affectedFiles.length === 0);

      if (goalOwnedRestart) {
        const devEdit = target.devEdit;
        if (devEdit) {
          markDevSourceEditContinuationComplete({
            id: devEdit.id,
            sessionId: target.sessionId,
            tag: devEdit.completionNoteTag || 'dev_edit_complete',
            note: `Gateway restart completed successfully. ${restartCtx.summary || devEdit.summary || 'Approved dev changes are live.'}`,
          });
        }
        finalizeMainChatGoalRestartRecovery(target.sessionId, {
          reason: String(restartCtx.reason || targetRestartCheckpoint?.reason || 'gateway_restart'),
          devEditId: devEdit?.id || targetRestartCheckpoint?.devEditId,
          affectedFiles: restartCtx.affectedFiles || devEdit?.affectedFiles || devEdit?.allowedFiles,
          changedSurfaces: devEdit?.changedSurfaces,
          verificationSummary: devEdit?.lastVerification?.summary,
        });
        finalText = devEdit
          ? 'Dev changes are live and the gateway is healthy. Resuming the same goal iteration for post-restart verification.'
          : 'Gateway restart completed successfully. Resuming the same goal iteration from its persisted checkpoint.';
      } else if (plainManualGatewayRestart) {
        finalText = 'Restarted. Prometheus is back online.';
      } else {
        try {
          const result = await handleChat(
            // Each interrupted thread receives only its own dev-edit member.
            buildHotRestartPrompt(lastUserRequest, lastAssistantResponse, restartCtx, target.devEdit),
            internalSessionId,
            (evt, data) => {
              if (evt === 'tool_call') {
                console.log(`[boot-md]  -> ${String(data?.action || 'unknown')} (unexpected during hot restart)`);
              }
            },
            hotRestartContextPacket,
          );
          finalText = String(result.text || '').trim();
        } catch (err: any) {
          console.warn(`[boot-md] Hot restart follow-up failed for ${target.sessionId}: ${String(err?.message || err)}`);
        }
      }

      if (!finalText) {
        finalText = buildHotRestartFallbackMessage(lastUserRequest, lastAssistantResponse);
      }

      console.log(`[boot-md] Hot restart complete for ${target.sessionId}: ${finalText.slice(0, 120)}`);
      try {
        addMessage(target.sessionId, {
          role: 'assistant',
          messageKind: goalOwnedRestart ? 'restart_status' : undefined,
          goalId: goalOwnedRestart ? targetGoal?.id : undefined,
          content: finalText,
          timestamp: Date.now(),
          toolLog: hotRestartContextPacket,
          processEntries: [{
            ts: new Date().toLocaleTimeString(),
            type: 'info',
            actor: 'Prom Restart',
            content: hotRestartContextPacket,
            extra: {
              packetType: 'hot_restart_context',
              restartReason: restartCtx.reason,
              devEditId: target.devEdit?.id,
            },
          }],
        });
      } catch (e: any) {
        console.warn(`[boot-md] Failed to persist hot restart message for ${target.sessionId}: ${e?.message}`);
      }

      const notification = queueStartupNotification({
        sessionId: target.sessionId,
        title: sessionMeta.title,
        text: finalText,
        source: sessionMeta.source,
        automatedSession: null,
        previousSessionId: target.sessionId,
        telegram: target.telegram,
        devReload: restartCtx.devReload,
      });

      return {
        finalText,
        targetSessionId: target.sessionId,
        notificationId: notification.id,
        goalOwnedRestart,
      };
    }));

    const primary = results[0] || null;

    if (!primary) {
      return { status: 'skipped', reason: 'No hot restart targets found' };
    }

    return {
      status: 'ran',
      reply: primary.finalText,
      sessionId: primary.targetSessionId,
      title: sessionMeta.title,
      source: sessionMeta.source,
      automatedSession: null,
      notificationId: primary.notificationId,
      resumableGoalSessionIds: results
        .filter((result) => result.goalOwnedRestart)
        .map((result) => result.targetSessionId),
    };
  }

  const bootPath = path.join(workspacePath, 'BOOT.md');
  if (!fs.existsSync(bootPath)) return { status: 'skipped', reason: 'BOOT.md not found' };

  const todayLocal = getLocalDateKey();
  const bootState = readBootRunState(workspacePath);
  if (bootState?.lastRunDateLocal === todayLocal) {
    return { status: 'skipped', reason: `BOOT.md already ran today (${todayLocal})` };
  }

  console.log('[boot-md] Running BOOT.md...');

  try {
    const sessionMeta = buildAutoSessionMeta('boot');
    const result = await handleChat(
      buildDailyBootPrompt(),
      sessionMeta.id,
      (evt, data) => {
        if (evt === 'tool_call') {
          console.log(`[boot-md]  -> ${String(data?.action || 'unknown')} (unexpected during boot)`);
        }
      },
    );

    const finalText = String(result.text || '').trim();
    console.log(`[boot-md] Done: ${finalText.slice(0, 120)}`);
    writeBootRunState(workspacePath, {
      lastRunDateLocal: todayLocal,
      lastRunAt: Date.now(),
    });

    try {
      addMessage(sessionMeta.id, {
        role: 'assistant',
        content: finalText,
        timestamp: Date.now(),
      });
    } catch (e: any) {
      console.warn(`[boot-md] Failed to persist boot message: ${e?.message}`);
    }

    const automatedSession: BootAutomatedSession = {
      id: sessionMeta.id,
      title: sessionMeta.title,
      history: [{ role: 'assistant', content: finalText }],
      automated: true,
      unread: true,
      createdAt: sessionMeta.createdAt,
      source: sessionMeta.source,
    };

    const notification = queueStartupNotification({
      sessionId: sessionMeta.id,
      title: sessionMeta.title,
      text: finalText,
      source: sessionMeta.source,
      automatedSession,
      previousSessionId: undefined,
      telegram: { enabled: false },
    });

    return {
      status: 'ran',
      reply: finalText,
      sessionId: sessionMeta.id,
      title: sessionMeta.title,
      source: sessionMeta.source,
      automatedSession,
      notificationId: notification.id,
    };
  } catch (err: any) {
    const reason = String(err?.message || err || 'unknown error');
    console.warn(`[boot-md] Failed: ${reason}`);
    return { status: 'failed', reason };
  }
}

