/**
 * boot.ts - Runs BOOT.md at gateway startup.
 *
 * Pre-executes task_control, reads latest memory, checks schedule status,
 * and reads today's intraday notes — all server-side before the LLM sees anything.
 * LLM only needs to summarize — no tool calls required during boot.
 */

import fs from 'fs';
import path from 'path';
import { addMessage } from './session';
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
    }
  | { status: 'failed'; reason: string };

type HandleChatFn = (
  message: string,
  sessionId: string,
  sendSSE: (event: string, data: any) => void,
) => Promise<{ text: string }>;

type TaskControlFn = (args: Record<string, any>) => Promise<any>;
type ScheduleControlFn = (args: Record<string, any>) => Promise<any>;

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

/**
 * Finds the most recent non-intraday memory file in workspace/memory/
 */
function readLatestMemory(workspacePath: string): { filename: string; content: string } | null {
  const memDir = path.join(workspacePath, 'memory');
  if (!fs.existsSync(memDir)) return null;
  const files = fs.readdirSync(memDir)
    .filter(f => f.endsWith('.md') && !f.includes('intraday-notes'))
    .sort()
    .reverse();
  if (!files.length) return null;
  const filename = files[0];
  const content = fs.readFileSync(path.join(memDir, filename), 'utf-8').trim();
  return { filename, content: content.slice(-3000) };
}

/**
 * Reads today's intraday notes if they exist
 */
function readTodayIntradayNotes(workspacePath: string): string {
  const today = new Date().toISOString().split('T')[0];
  const notesPath = path.join(workspacePath, 'memory', `${today}-intraday-notes.md`);
  if (!fs.existsSync(notesPath)) return '(no notes yet today)';
  const content = fs.readFileSync(notesPath, 'utf-8').trim();
  if (!content) return '(no notes yet today)';
  return content.slice(-1500);
}

function buildDeterministicRestartMessage(ctx: RestartContext): string {
  const lines: string[] = [];
  const didBuild = ctx.buildOutput !== undefined;

  // Header
  if (ctx.reason === 'proposal') {
    lines.push('✅ Proposal deployed — gateway restarted.');
  } else if (ctx.reason === 'repair') {
    lines.push('✅ Self-repair applied — gateway restarted.');
  } else if (ctx.reason === 'self_update') {
    lines.push('✅ Self-update complete — gateway restarted.');
  } else if (didBuild) {
    lines.push('✅ Restart complete (build + restart).');
  } else {
    lines.push('✅ Quick restart complete.');
  }

  if (ctx.title) lines.push(`Action: ${ctx.title}`);
  if (ctx.summary) lines.push(`Summary: ${ctx.summary}`);
  if (ctx.proposalId) lines.push(`Proposal ID: ${ctx.proposalId}`);
  if (ctx.repairId) lines.push(`Repair ID: ${ctx.repairId}`);

  if (didBuild) {
    lines.push('Build: succeeded');
  } else {
    lines.push('Build: not run');
  }

  const files = ctx.affectedFiles || [];
  if (files.length > 0) {
    lines.push(`Files changed (${files.length}):`);
    for (const f of files.slice(0, 10)) lines.push(`  • ${f}`);
    if (files.length > 10) lines.push(`  … and ${files.length - 10} more`);
  } else {
    lines.push('Files changed: none');
  }

  if (ctx.testInstructions) {
    lines.push('');
    lines.push(`Verify: ${ctx.testInstructions}`);
  }

  return lines.join('\n').trim();
}

function buildBootPrompt(taskData: string, memoryData: string, scheduleData: string, intradayNotes: string): string {
  return [
    'BOOT STARTUP SUMMARY:',
    'The following data has already been fetched for you. Do not call any tools.',
    'Read the data below and reply with a 2-3 sentence startup summary.',
    '',
    '## CURRENT TASKS:',
    taskData || '(no tasks found)',
    '',
    '## SCHEDULE STATUS:',
    scheduleData || '(no scheduled jobs)',
    '',
    '## TODAY\'S NOTES:',
    intradayNotes || '(no notes yet today)',
    '',
    '## LATEST MEMORY:',
    memoryData || '(no memory file found)',
    '',
    'Summarize: any tasks needing attention, any scheduled items coming up, today\'s notes if relevant, and one line on where things left off.',
  ].join('\n').trim();
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
    const title = `🔁 Restart (${restartCtx?.reason || 'manual'}) — ${new Date(createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
    return { id, title, source: 'hot_restart', createdAt };
  }
  const id = `auto_boot_${createdAt}`;
  const title = `🌅 Startup — ${new Date(createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
  return { id, title, source: 'boot_startup', createdAt };
}

export async function runBootMd(
  workspacePath: string,
  handleChat: HandleChatFn,
  taskControl?: TaskControlFn,
  scheduleControl?: ScheduleControlFn,
): Promise<BootResult> {
  // ── Hot Restart Detection ─────────────────────────────────────────────────
  const restartCtx = readRestartContext();
  if (restartCtx) {
    console.log(`[boot-md] Hot restart detected: ${restartCtx.reason} (${restartCtx.title || 'no title'})`);
    clearRestartContext();
    const sessionMeta = buildAutoSessionMeta('restart', restartCtx);
    const finalText = buildDeterministicRestartMessage(restartCtx);
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
    queueStartupNotification({
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
    // Pre-fetch tasks server-side
    let taskData = '(task_control unavailable)';
    if (taskControl) {
      try {
        const result = await taskControl({ action: 'list', status: '', include_all_sessions: true, limit: 20 });
        taskData = JSON.stringify(result, null, 2).slice(0, 2000);
      } catch (e: any) {
        taskData = `(task_control failed: ${String(e?.message || e)})`;
      }
    }

    // Pre-fetch schedule status server-side
    let scheduleData = '(schedule unavailable)';
    if (scheduleControl) {
      try {
        const result = await scheduleControl({ action: 'list', limit: 20 });
        scheduleData = JSON.stringify(result, null, 2).slice(0, 2000);
      } catch (e: any) {
        scheduleData = `(schedule read failed: ${String(e?.message || e)})`;
      }
    }

    const latestMemory = readLatestMemory(workspacePath);
    const memoryData = latestMemory
      ? `${latestMemory.filename}\n${latestMemory.content}`
      : '(no memory file found)';

    const intradayNotes = readTodayIntradayNotes(workspacePath);
    const prompt = buildBootPrompt(taskData, memoryData, scheduleData, intradayNotes);
    const sessionMeta = buildAutoSessionMeta('boot');

    const result = await handleChat(
      prompt,
      sessionMeta.id,
      (evt, data) => {
        if (evt === 'tool_call') {
          console.log(`[boot-md]  -> ${String(data?.action || 'unknown')} (unexpected during boot)`);
        }
      },
    );

    const finalText = String(result.text || '');
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
    queueStartupNotification({
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
    };
  } catch (err: any) {
    const reason = String(err?.message || err || 'unknown error');
    console.warn(`[boot-md] Failed: ${reason}`);
    return { status: 'failed', reason };
  }
}
