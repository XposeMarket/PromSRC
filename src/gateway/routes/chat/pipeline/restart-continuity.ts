import { claimRuntimeRecovery } from '../../../runtime/recovery-claims';
import { createMainChatStreamStore, type MainChatStreamFrame, type MainChatStreamState } from '../../../chat/main-chat-stream-store';
import { getSession, addMessage, getHistory, getHistoryForApiCall, getActiveHistoryForApiCall, getActiveHistoryForPersistence, getRecentToolObservationsForContext, getWorkingContextForContext, recordWorkingContextPacket, persistToolLog, getWorkspace, setWorkspace, cleanupSessions, listSessionSummaries, searchSessionSummaries, recordSessionCompaction, deleteSession, renameSession, setSessionPinned, reorderSessionSidebar, autoNameSession, replaceHistory, touchSession, flushSession, markSessionReadForMobile, markSessionUnreadForMobile, getCreativeMode, getCreativeReferences, formatCreativeReferencesForPrompt, getActivatedToolCategories, activateToolCategory, captureToolCategoryActivationState, restoreToolCategoryActivationState, getActivatedSkillIds, getActivatedSkillResources, activateSkillForSession, activateSkillResourceForSession, getSessionDisplayTitle, isBusinessContextEnabled, getSessionPersistenceStatus, type TurnOrigin, type VoiceRoomMetadata, type VoiceRoomParticipant } from '../../../session';
import { extractTurnFileTouches, mergeTurnFileTouches, type TurnFileTouch } from '../../../file-change-summary';
import { bgPlanDeclare, bgPlanAdvance, backgroundJoin, backgroundStatus, backgroundAbort, backgroundSteer, listActiveBackgroundIdsForSession, registerBackgroundCompletionWake } from '../../../tasks/task-runner';
import { formatBackgroundSpawnContinuity } from '../../../tasks/background-spawn-continuity';
import { decideTurnAdmission, mainChatTurnCoordinator, type SessionTurnLease } from '../../../chat/turn-coordinator';
import {
  wss as _wssRef, setWss,
  broadcastWS,
  broadcastTeamEvent,
  addTeamSseClient,
  removeTeamSseClient,
  sendTeamNotificationToChannels,
  sendDiscordNotification,
  sendWhatsAppNotification,
  resolveChannelsConfig,
  setTelegramChannelForBroadcaster,
  isModelBusy, setModelBusy,
  getLastMainSessionId, setLastMainSessionId,
  setSessionChannelHint,
  type TelegramChannelConfig,
  type DiscordChannelConfig,
  type WhatsAppChannelConfig,
  type ChannelsConfig,
  normalizeTelegramConfig,
  normalizeDiscordConfig,
  normalizeWhatsAppConfig,
  isGatewayDraining,
} from '../../../comms/broadcaster';
import {
  registerLiveRuntime,
  finishLiveRuntime,
  hasTerminalRuntimeCheckpoint,
  updateLiveRuntimeCheckpoint,
  markLiveRuntimeProgress,
  interruptLiveRuntimeForRecovery,
  listLiveRuntimes,
  listInterruptedRuntimes,
  getLiveRuntime,
  abortLiveRuntime,
  addPendingRuntimeSteer,
  consumePendingRuntimeSteersForSession,
  isSteerableChatRuntimeKind,
  stripInheritedRecoveryMarks,
  type RuntimeSteerEvent,
} from '../../../live-runtime-registry';
import { resumePlannedRestartMainChats, retriggerDeferredMainChatRuntime, registerRestartContinuityEmitter } from '../../../runtime-recovery';
import type { InterruptedMainChatRuntime } from '../../chat.router';

interface RestartContinuityDependencies {
  normalizeTurnOrigin: typeof import('../../chat.router').normalizeTurnOrigin;
  appendRuntimeNarrationBoundary: typeof import('../../chat.router').appendRuntimeNarrationBoundary;
  runtimeProcessEntryFromSseEvent: typeof import('../../chat.router').runtimeProcessEntryFromSseEvent;
  appendRuntimeFileTouch: typeof import('../../chat.router').appendRuntimeFileTouch;
  runInteractiveTurn: typeof import('./interactive-turn').runInteractiveTurn;
  appendMainChatStreamEvent: typeof import('../../chat.router').appendMainChatStreamEvent;
}
let normalizeTurnOrigin: RestartContinuityDependencies['normalizeTurnOrigin'];
let appendRuntimeNarrationBoundary: RestartContinuityDependencies['appendRuntimeNarrationBoundary'];
let runtimeProcessEntryFromSseEvent: RestartContinuityDependencies['runtimeProcessEntryFromSseEvent'];
let appendRuntimeFileTouch: RestartContinuityDependencies['appendRuntimeFileTouch'];
let runInteractiveTurn: RestartContinuityDependencies['runInteractiveTurn'];
let appendMainChatStreamEvent: RestartContinuityDependencies['appendMainChatStreamEvent'];
export function configureRestartContinuityDependencies(deps: RestartContinuityDependencies): void {
  ({ normalizeTurnOrigin, appendRuntimeNarrationBoundary, runtimeProcessEntryFromSseEvent, appendRuntimeFileTouch, runInteractiveTurn, appendMainChatStreamEvent } = deps);
}

/**
 * Resume an interrupted main-chat turn on the replacement gateway. The original
 * user message is not re-appended; the preserved checkpoint context is replayed.
 */
// Tell the resumed turn WHO caused the restart. Without this the model sees a
// generic "gateway exited" note and cannot tell its own planned gateway_restart
// from an unplanned crash/watchdog drop, so it re-verifies (or re-runs) work it
// already knows the outcome of.
export function describeRestartProvenance(runtime: any): string {
  const toolName = String(runtime?.checkpoint?.toolName || '').trim();
  const reason = String(runtime?.interruptReason || runtime?.recoveryData?.interruptReason || '').trim();
  const interruptedAt = Number(runtime?.interruptedAt || runtime?.recoveryData?.restartEpoch || 0);
  const downSec = interruptedAt > 0 ? Math.max(0, Math.round((Date.now() - interruptedAt) / 1000)) : 0;
  const downtime = downSec > 0 ? ` The gateway was down for about ${downSec}s.` : '';
  if (/^(gateway_restart|prom_apply_dev_changes)$/i.test(toolName)) {
    return `Restart provenance: PLANNED. You (Prometheus, in this chat) started this restart yourself by calling ${toolName}; it was not a crash and the user did not cancel anything.${downtime} Treat the restart as a completed step of your own plan.`;
  }
  if (/watchdog/i.test(reason)) {
    return `Restart provenance: UNPLANNED. The gateway watchdog interrupted this turn (${reason.slice(0, 120)}) because it stopped reporting progress. Neither you nor the user asked for it.${downtime} Re-check whatever was in flight at the last tool boundary before relying on it.`;
  }
  return `Restart provenance: UNPLANNED. The gateway process stopped (${reason ? reason.slice(0, 120) : 'unexpected exit'}) while this turn was running; neither you nor the user asked for it.${downtime} Re-check whatever was in flight at the last tool boundary before relying on it.`;
}

// Compact digest of the work this turn already did before the restart. The
// resumed turn otherwise only sees a truncated commentary row, which is why it
// kept losing track of completed merges/edits and re-verified them from scratch.
export function extractPreRestartArtifacts(entries: any[]): string[] {
  const out = new Set<string>();
  for (const entry of entries) {
    const text = String(entry?.content || entry?.text || '');
    for (const m of text.matchAll(/Pull request created: #(\d+)/g)) out.add(`opened PR #${m[1]}`);
    for (const m of text.matchAll(/Pull request merged: ([0-9a-f]{7,40})/g)) out.add(`merged a PR (merge commit ${m[1].slice(0, 9)})`);
    for (const m of text.matchAll(/\b([0-9a-f]{9}) [^\n]{0,80}\(#(\d+)\)/g)) out.add(`pulled main to ${m[1]} (#${m[2]})`);
    for (const m of text.matchAll(/Note saved[^#]*#(n_[a-z0-9]+)/g)) out.add(`saved note ${m[1]}`);
    if (/BUILD=0\b/.test(text)) out.add('ran a successful build');
    for (const m of text.matchAll(/git checkout -q -b ([\w./-]+)/g)) out.add(`created branch ${m[1]}`);
  }
  return Array.from(out).slice(0, 12);
}

export function buildPreRestartWorkDigest(runtime: any, maxChars = 6000): string {
  const entries: any[] = Array.isArray(runtime?.checkpoint?.processEntries) ? runtime.checkpoint.processEntries : [];
  const lines: string[] = [];
  for (const entry of entries) {
    const type = String(entry?.type || '').toLowerCase();
    if (type !== 'tool' && type !== 'result' && type !== 'error') continue;
    // Checkpoint entries use `content` (live SSE shape) or `text` (runtime
    // checkpoint shape); accept both or real ledgers produce an empty digest.
    const content = String(entry?.content || entry?.text || '').replace(/\s+/g, ' ').trim();
    if (!content || /^(Preparing|Prepared)\b/i.test(content)) continue;
    const toolName = String(entry?.extra?.toolName || entry?.extra?.action || '').trim();
    const label = type === 'tool' ? 'call' : type;
    lines.push(`- ${label}${toolName ? ` ${toolName}` : ''}: ${content.slice(0, 220)}`);
  }
  const narration = String(runtime?.checkpoint?.narrationTail || '').replace(/\s+/g, ' ').trim();
  if (!lines.length && !narration) return '';
  // Pull the durable artifacts out of the step results so the resumed turn
  // recognizes them as its OWN work. Without this, a resumed turn that saw its
  // own PR in `git log` concluded it "was probably shipped from another chat".
  const artifacts = extractPreRestartArtifacts(entries);
  const artifactLine = artifacts.length
    ? `YOU already did these in THIS turn before the restart: ${artifacts.join('; ')}. If git, GitHub, or the build shows them, that is your own work from minutes ago, not another chat. Do not re-investigate or redo them; continue from the next step.\n`
    : '';
  const header = `${artifactLine}Work YOU completed in this same turn before the restart (${lines.length} tool step(s), oldest first; trust these results, do not redo them):`;
  const kept: string[] = [];
  let used = header.length;
  // Keep the most recent steps when over budget; they matter most for the next action.
  for (let i = lines.length - 1; i >= 0; i--) {
    if (used + lines[i].length + 1 > maxChars) {
      kept.unshift(`- (${i + 1} earlier step(s) omitted for length)`);
      break;
    }
    kept.unshift(lines[i]);
    used += lines[i].length + 1;
  }
  const said = narration ? `\nLast thing you told the user before the restart: "${narration.slice(-600)}"` : '';
  return `${header}\n${kept.join('\n')}${said}`;
}

export const pendingBackgroundWakeRetries = new Set<string>();
export function wakeInterruptedBackgroundOwner(sessionId: string): void {
  const interrupted = listInterruptedRuntimes()
    .filter((runtime) => runtime.kind === 'main_chat' && runtime.sessionId === sessionId && !runtime.recoveryData?.recoveredAt)
    .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0))[0];
  if (!interrupted || listActiveBackgroundIdsForSession(sessionId).length > 0) return;
  // Do not race an active owner or duplicate a restart recovery already queued.
  const activeOwner = listLiveRuntimes().some((runtime) => runtime.kind === 'main_chat' && runtime.sessionId === sessionId);
  if (activeOwner) {
    if (!pendingBackgroundWakeRetries.has(sessionId)) {
      pendingBackgroundWakeRetries.add(sessionId);
      setTimeout(() => {
        pendingBackgroundWakeRetries.delete(sessionId);
        wakeInterruptedBackgroundOwner(sessionId);
      }, 1_000).unref?.();
    }
    return;
  }
  if (!retriggerDeferredMainChatRuntime(interrupted, retriggerInterruptedMainChat)
    && !pendingBackgroundWakeRetries.has(sessionId)) {
    pendingBackgroundWakeRetries.add(sessionId);
    setTimeout(() => {
      pendingBackgroundWakeRetries.delete(sessionId);
      wakeInterruptedBackgroundOwner(sessionId);
    }, 1_000).unref?.();
  }
}

export function retriggerInterruptedMainChat(runtime: InterruptedMainChatRuntime): boolean {
  const sessionId = String(runtime?.sessionId || '').trim();
  const recoveryData = runtime?.recoveryData || {};
  const message = String(recoveryData.message || runtime?.detail || '').trim();
  if (!sessionId || !message) return false;

  // Several gateway processes can run a recovery pass for the same lost host
  // during a warm handoff. Only one of them may replay this interrupted turn.
  if (!claimRuntimeRecovery(String(runtime?.id || ''), 'main_chat_retrigger')) {
    console.warn(`[RuntimeRecovery] Skipped retrigger of ${sessionId} (old=${runtime?.id}): another gateway process already claimed it.`);
    return false;
  }

  const admissionLease = mainChatTurnCoordinator.tryAcquire(sessionId);
  if (!admissionLease) {
    console.warn(`[RuntimeRecovery] Could not retrigger ${sessionId}: a replacement turn already owns the session.`);
    return false;
  }

  const origin = normalizeTurnOrigin(
    recoveryData.origin || { channel: runtime.source || 'system', surface: 'restart_recovery', device: 'server' },
    sessionId,
  );
  const priorRecoveryAttempts = Number(recoveryData.restartRecoveryAttempts || 0);
  const restartRecoveryAttempts = Number.isFinite(priorRecoveryAttempts) && priorRecoveryAttempts > 0
    ? Math.floor(priorRecoveryAttempts) + 1
    : 1;
  const abortController = new AbortController();
  const abortSignal = { aborted: false, signal: abortController.signal };
  const rootTurnContextId = String(recoveryData.rootTurnId || runtime.id || '').trim() || undefined;
  // Everything the interrupted runtime changed, plus what it had itself
  // inherited from earlier restarts of the same turn.
  const inheritedFileTouchesForResume: TurnFileTouch[] = mergeTurnFileTouches(
    Array.isArray(recoveryData.inheritedFileTouches) ? recoveryData.inheritedFileTouches : [],
    Array.isArray((runtime as any)?.checkpoint?.fileTouches) ? (runtime as any).checkpoint.fileTouches : [],
  );
  const runtimeId = registerLiveRuntime({
    kind: 'main_chat',
    label: 'Main chat (restart recovery)',
    sessionId,
    source: origin.channel,
    detail: message.slice(0, 160),
    clientRequestId: runtime.clientRequestId || undefined,
    abortSignal,
    deferTerminalCleanup: true,
    onAbort: () => abortController.abort(),
    recoveryPolicy: 'mark_interrupted',
    recoveryData: {
      ...stripInheritedRecoveryMarks(recoveryData),
      // Files changed by every earlier runtime of this turn (all prior restarts).
      inheritedFileTouches: inheritedFileTouchesForResume,
      recoveredFromRuntimeId: runtime.id,
      rootTurnId: rootTurnContextId,
      rootStartedAt: Number(recoveryData.rootStartedAt || 0) || Number((runtime as any).startedAt || 0) || Date.now(),
      restartRecoveryAttempts,
      restartRecoveryAttemptedAt: Date.now(),
    },
  });

  setModelBusy(true);
  // Seed the resumed runtime with the pre-restart trace. The mobile client
  // rebuilds a live turn from this runtime's checkpoint on reopen; starting
  // empty meant a reopened app only ever showed post-restart work.
  const runtimeProcessEntries: Record<string, any>[] = Array.isArray(runtime.checkpoint?.processEntries)
    ? runtime.checkpoint.processEntries
      .filter((entry: any) => entry && typeof entry === 'object')
      .slice(-4_000)
      .map((entry: any) => ({ ...entry, extra: { ...(entry.extra || {}), preRestart: true, priorRuntimeId: runtime.id } }))
    : [];
  // Carry pre-restart file touches forward so a *further* restart still has them.
  const runtimeFileTouches: TurnFileTouch[] = [...inheritedFileTouchesForResume];
  if (runtimeProcessEntries.length || runtimeFileTouches.length) {
    updateLiveRuntimeCheckpoint(runtimeId, {
      event: 'restart_resumed',
      at: Date.now(),
      ...(runtimeProcessEntries.length ? { processEntries: [...runtimeProcessEntries] } : {}),
      ...(runtimeFileTouches.length ? { fileTouches: [...runtimeFileTouches] } : {}),
    });
  }
  let runtimeThinkingTail = '';
  let runtimeNarrationTail = '';
  let lastRuntimeNarrationCheckpointAt = 0;
  const sendSSE = (event: string, data: any) => {
    if (event === 'thinking_delta') {
      const delta = String(data?.thinking || data?.text || '').trim();
      if (delta) runtimeThinkingTail = `${runtimeThinkingTail}${delta}`.slice(-4000);
      updateLiveRuntimeCheckpoint(runtimeId, {
        event,
        at: Date.now(),
        ...(runtimeThinkingTail ? { thinkingTail: runtimeThinkingTail } : {}),
        ...(runtimeNarrationTail ? { narrationTail: runtimeNarrationTail } : {}),
        ...(runtimeProcessEntries.length ? { processEntries: [...runtimeProcessEntries] } : {}),
      }, { persist: false });
      return;
    }
    if (event === 'thinking') {
      const thinking = String(data?.thinking || data?.text || '').trim();
      if (thinking) runtimeThinkingTail = `${runtimeThinkingTail}\n${thinking}`.trim().slice(-4000);
    }
    if (event === 'token') {
      const token = String(data?.text || '');
      if (token.trim()) runtimeNarrationTail = `${runtimeNarrationTail}${token}`.slice(-12_000);
      const now = Date.now();
      const persistNarrationCheckpoint = !!runtimeNarrationTail
        && now - lastRuntimeNarrationCheckpointAt >= 2_000;
      if (persistNarrationCheckpoint) lastRuntimeNarrationCheckpointAt = now;
      updateLiveRuntimeCheckpoint(runtimeId, {
        event,
        at: now,
        ...(runtimeThinkingTail ? { thinkingTail: runtimeThinkingTail } : {}),
        narrationTail: runtimeNarrationTail,
        ...(runtimeProcessEntries.length ? { processEntries: [...runtimeProcessEntries] } : {}),
      }, { persist: persistNarrationCheckpoint });
      return;
    }
    if (event === 'tool_call' && runtimeNarrationTail.trim()) {
      appendRuntimeNarrationBoundary(runtimeProcessEntries, runtimeNarrationTail);
      runtimeNarrationTail = '';
    }
    const checkpoint: Record<string, any> = { event, at: Date.now() };
    if (data?.message) checkpoint.message = String(data.message).slice(0, 1000);
    if (data?.action || data?.name) checkpoint.toolName = String(data.action || data.name);
    if (data?.args && typeof data.args === 'object') checkpoint.args = data.args;
    if (data?.result) checkpoint.result = String(data.result).slice(0, 1000);
    if (runtimeThinkingTail) checkpoint.thinkingTail = runtimeThinkingTail;
    if (runtimeNarrationTail) checkpoint.narrationTail = runtimeNarrationTail;
    const processEntry = runtimeProcessEntryFromSseEvent(event, data);
    if (processEntry) {
      runtimeProcessEntries.push(processEntry);
      if (runtimeProcessEntries.length > 12_000) {
        runtimeProcessEntries.splice(0, runtimeProcessEntries.length - 12_000);
      }
      checkpoint.processEntries = [...runtimeProcessEntries];
      if (appendRuntimeFileTouch(runtimeFileTouches, event, data, processEntry)) {
        checkpoint.fileTouches = [...runtimeFileTouches];
      }
    }
    updateLiveRuntimeCheckpoint(runtimeId, checkpoint);
  };
  const backgroundContinuity = formatBackgroundSpawnContinuity(sessionId, Number(recoveryData.rootStartedAt || (runtime as any).startedAt || 0) - 60_000);
  const checkpointSummary = [
    '[GATEWAY RESTART RECOVERY]',
    `You are resuming YOUR OWN in-flight turn. The gateway restarted in the middle of it (usually because you called the restart yourself); everything listed below was done by you, in this conversation, minutes ago (runtime ${runtime.id}).`,
    describeRestartProvenance(runtime),
    'Continue the same turn automatically. Do not ask the user to send "continue" and do not repeat completed or destructive work.',
    buildPreRestartWorkDigest(runtime),
    backgroundContinuity,
    runtime.checkpoint?.toolName ? `Last tool boundary: ${String(runtime.checkpoint.toolName)}` : '',
    /^(gateway_restart|prom_apply_dev_changes)$/i.test(String(runtime.checkpoint?.toolName || ''))
      ? 'That restart/apply tool boundary completed successfully. Do not invoke that same restart or apply tool again for this work; continue with post-restart verification and every remaining step of the original request.'
      : '',
    runtime.checkpoint?.message ? `Last recorded progress: ${String(runtime.checkpoint.message).slice(0, 1000)}` : '',
    'The interruption checkpoint and prior process/tool evidence are present in this session history. Reconcile them before taking the next action.',
    '[/GATEWAY RESTART RECOVERY]',
  ].filter(Boolean).join('\n');

  void runInteractiveTurn(
    message,
    sessionId,
    sendSSE,
    undefined,
    abortSignal,
    checkpointSummary,
    undefined,
    undefined,
    undefined,
    undefined,
    { syntheticRestartRecovery: true, preAcquiredTurnLease: admissionLease, runtimeId, turnContextId: rootTurnContextId },
    origin,
    { clientRequestId: runtime.clientRequestId },
  ).catch((err: any) => {
    console.error(`[RuntimeRecovery] Retriggered main-chat turn failed for ${sessionId}:`, err?.message || err);
    addMessage(sessionId, {
      role: 'assistant',
      content: `Automatic recovery could not finish the interrupted turn: ${String(err?.message || err || 'unknown error').slice(0, 500)}`,
      timestamp: Date.now(),
      channel: origin.channel,
      channelLabel: 'restart recovery',
    } as any, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
  }).finally(() => {
    finishLiveRuntime(runtimeId);
    mainChatTurnCoordinator.release(admissionLease);
    setModelBusy(false);
  });

  console.log(`[RuntimeRecovery] Automatically retriggered interrupted main-chat turn for ${sessionId} (old=${runtime.id}, new=${runtimeId}).`);
  return true;
}

/**
 * Mirror of the pre-shutdown suspension notice. The suspended event promised the
 * client that this turn would continue; this is the event that redeems it, so it
 * must carry the new streamId the client has to follow.
 */
export function announceRestartContinuityResumed(params: {
  sessionId: string;
  stream: MainChatStreamState | null;
  priorRuntimeId?: string;
  runtimeId?: string;
  clientRequestId?: string;
  reason?: string;
}): void {
  const sessionId = String(params.sessionId || '').trim();
  if (!sessionId) return;
  const stream = params.stream;
  const payload = {
    sessionId,
    phase: 'resumed' as const,
    reason: params.reason || 'gateway_restart',
    priorRuntimeId: params.priorRuntimeId,
    runtimeId: params.runtimeId,
    newStreamId: stream?.streamId,
    clientRequestId: params.clientRequestId,
    at: Date.now(),
  };
  // Record it inside the durable stream too, so a client that reconnects and
  // replays from seq 0 still learns this turn is a continuation.
  if (stream) {
    try { appendMainChatStreamEvent(sessionId, stream.streamId, 'restart_continuity', payload); } catch {}
  }
  try { broadcastWS({ type: 'restart_continuity', ...payload }); } catch {}
}
