/**
 * boot.ts - Runs BOOT.md at gateway startup.
 *
 * Daily startup is intentionally lightweight: it summarizes yesterday's
 * intraday notes plus any recent compaction summaries. Hot restarts are
 * conversation-aware and should resume from the previous session context.
 */

import fs from 'fs';
import path from 'path';
import { addMessage, getHistoryForApiCall, type ChatMessage } from './session';
import { readRestartContext, clearRestartContext, queueStartupNotification, type RestartContext } from './lifecycle';

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
      automatedSession: BootAutomatedSession;
      notificationId?: string;
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
    'Do not call any tools.',
    'Write a brief 2-3 sentence startup message.',
    'Focus only on what carried over from yesterday\'s intraday notes, whether any compaction summaries suggest something worth resuming, and any recent brain/dream activity worth surfacing from overnight.',
    'If there is no meaningful carryover, say so plainly.',
  ].join('\n').trim();
}

function isInternalRestartHistoryMessage(msg: ChatMessage): boolean {
  const text = String(msg?.content || '').trim();
  if (!text) return true;
  if (/^SYSTEM:\s+Context is getting long/i.test(text)) return true;
  if (/^Before continuing:\s+summarize the conversation so far/i.test(text)) return true;
  if (/^\[BACKGROUND_TASK_RESULT\b/i.test(text)) return true;
  return false;
}

function getRecentConversationForRestart(previousSessionId?: string): {
  excerpt: string;
  lastUserRequest: string;
} {
  const sid = String(previousSessionId || '').trim();
  if (!sid) {
    return {
      excerpt: '(No previous session was recorded for this restart.)',
      lastUserRequest: '',
    };
  }

  try {
    const history = getHistoryForApiCall(sid, 6, { maxMessages: 8 })
      .filter((msg) => !isInternalRestartHistoryMessage(msg));

    if (history.length === 0) {
      return {
        excerpt: `(No recent conversation history was available for session ${sid}.)`,
        lastUserRequest: '',
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

    return { excerpt, lastUserRequest };
  } catch (err: any) {
    return {
      excerpt: `(Could not load recent conversation history for ${sid}: ${String(err?.message || err || 'unknown error')})`,
      lastUserRequest: '',
    };
  }
}

function buildHotRestartPrompt(lastUserRequest: string): string {
  return [
    'HOT RESTART FOLLOW-UP:',
    'A hot restart just completed and you are resuming an existing conversation.',
    'Write the assistant message that should appear right after the restart.',
    'First, confirm naturally that the restart succeeded.',
    lastUserRequest
      ? `Then briefly ask whether the user wants you to continue the in-flight work: "${lastUserRequest}".`
      : 'Then briefly ask whether the user wants you to continue where you left off.',
    'Keep it short, natural, and conversational.',
    'Do not call any tools.',
  ].join('\n').trim();
}

function buildHotRestartCallerContext(ctx: RestartContext, recentConversation: string, lastUserRequest: string): string {
  const didBuild = ctx.buildOutput !== undefined;
  const affectedFiles = Array.isArray(ctx.affectedFiles) && ctx.affectedFiles.length > 0
    ? ctx.affectedFiles.slice(0, 10).join('\n')
    : '(none recorded)';

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
    'affected_files:',
    affectedFiles,
    '',
    'recent_conversation:',
    recentConversation,
    '[/HOT RESTART CONTEXT]',
  ].join('\n');
}

function buildHotRestartFallbackMessage(lastUserRequest: string): string {
  if (lastUserRequest) {
    return `Hey - the restart was successful. Do you want me to keep going on "${lastUserRequest}"?`;
  }
  return 'Hey - the restart was successful. Do you want me to continue where we left off?';
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
    const id = `auto_restart_${reasonPart}_${createdAt}`;
    const title = `Restart (${restartCtx?.reason || 'manual'}) - ${new Date(createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
    return { id, title, source: 'hot_restart', createdAt };
  }
  const id = `auto_boot_${createdAt}`;
  const title = `Startup - ${new Date(createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
  return { id, title, source: 'boot_startup', createdAt };
}

export async function runBootMd(
  workspacePath: string,
  handleChat: HandleChatFn,
): Promise<BootResult> {
  const restartCtx = readRestartContext();
  if (restartCtx) {
    console.log(`[boot-md] Hot restart detected: ${restartCtx.reason} (${restartCtx.title || 'no title'})`);
    clearRestartContext();

    const sessionMeta = buildAutoSessionMeta('restart', restartCtx);
    const { excerpt, lastUserRequest } = getRecentConversationForRestart(restartCtx.previousSessionId);

    let finalText = '';
    try {
      const result = await handleChat(
        buildHotRestartPrompt(lastUserRequest),
        sessionMeta.id,
        (evt, data) => {
          if (evt === 'tool_call') {
            console.log(`[boot-md]  -> ${String(data?.action || 'unknown')} (unexpected during hot restart)`);
          }
        },
        buildHotRestartCallerContext(restartCtx, excerpt, lastUserRequest),
      );
      finalText = String(result.text || '').trim();
    } catch (err: any) {
      console.warn(`[boot-md] Hot restart follow-up failed: ${String(err?.message || err)}`);
    }

    if (!finalText) {
      finalText = buildHotRestartFallbackMessage(lastUserRequest);
    }

    console.log(`[boot-md] Hot restart complete: ${finalText.slice(0, 120)}`);
    try {
      addMessage(sessionMeta.id, {
        role: 'assistant',
        content: finalText,
        timestamp: Date.now(),
      });
      if (restartCtx.previousSessionId && restartCtx.previousSessionId !== sessionMeta.id) {
        addMessage(restartCtx.previousSessionId, {
          role: 'assistant',
          content: finalText,
          timestamp: Date.now(),
        });
      }
    } catch (e: any) {
      console.warn(`[boot-md] Failed to persist hot restart message: ${e?.message}`);
    }

    const automatedSession: BootAutomatedSession = {
      id: sessionMeta.id,
      title: sessionMeta.title,
      history: [{ role: 'assistant', content: finalText }],
      automated: true,
      unread: true,
      createdAt: sessionMeta.createdAt,
      source: sessionMeta.source,
      previousSessionId: restartCtx.previousSessionId,
    };

    const notification = queueStartupNotification({
      sessionId: sessionMeta.id,
      title: sessionMeta.title,
      text: finalText,
      source: sessionMeta.source,
      automatedSession,
      previousSessionId: restartCtx.previousSessionId,
      telegram: {
        enabled: !!restartCtx.respondToTelegram,
        chatId: Number(restartCtx.previousTelegramChatId || 0) > 0 ? Number(restartCtx.previousTelegramChatId) : undefined,
        userId: Number.isFinite(Number(restartCtx.previousTelegramUserId)) ? Number(restartCtx.previousTelegramUserId) : undefined,
      },
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
