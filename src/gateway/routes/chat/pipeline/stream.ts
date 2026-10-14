import express from 'express';
import { type MainChatStreamFrame } from '../../../chat/main-chat-stream-store';
import { getSession, replaceHistory } from '../../../session';
import { buildDurableCommentaryContext } from '../../../context/commentary-context';
import { backgroundStatus } from '../../../tasks/task-runner';
import { addTeamNotificationTarget } from '../../../teams/managed-teams';


interface StreamDependencies {
  getMainChatStream: typeof import('../../chat.router').getMainChatStream;
  router: typeof import('../../chat.router').router;
  requireSafeSessionParam: typeof import('../../chat.router').requireSafeSessionParam;
  pruneMainChatStreams: typeof import('../../chat.router').pruneMainChatStreams;
  reconcileMainChatTurn: typeof import('../../chat.router').reconcileMainChatTurn;
  storageAwareStatus: typeof import('../../chat.router').storageAwareStatus;
}
let getMainChatStream: StreamDependencies['getMainChatStream'];
let router: StreamDependencies['router'];
let requireSafeSessionParam: StreamDependencies['requireSafeSessionParam'];
let pruneMainChatStreams: StreamDependencies['pruneMainChatStreams'];
let reconcileMainChatTurn: StreamDependencies['reconcileMainChatTurn'];
let storageAwareStatus: StreamDependencies['storageAwareStatus'];
export function configureStreamDependencies(deps: StreamDependencies): void {
  ({ getMainChatStream, router, requireSafeSessionParam, pruneMainChatStreams, reconcileMainChatTurn, storageAwareStatus } = deps);
}


export function createSSESender(res: express.Response): (event: string, data: any) => void {
  return (type: string, data: any) => {
    try {
      if (res.destroyed || res.writableEnded) return;
      res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    } catch {}
  };
}

export async function streamExistingMainChatToResponse(params: {
  res: express.Response;
  sessionId: string;
  streamId: string;
  clientRequestId?: string;
}): Promise<void> {
  const { res, sessionId, streamId } = params;
  const clientRequestId = String(params.clientRequestId || '').trim();
  let lastSeq = 0;
  let closed = false;
  let terminalSeen = false;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const writeFrame = (frame: MainChatStreamFrame) => {
    if (closed || res.destroyed || res.writableEnded) return;
    const data = frame.data && typeof frame.data === 'object' ? frame.data : {};
    const payload = {
      type: frame.type,
      ...data,
      seq: frame.seq,
      streamId,
      at: frame.at,
      ...(clientRequestId && !data.clientRequestId ? { clientRequestId } : {}),
    };
    try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch { closed = true; }
    lastSeq = Math.max(lastSeq, Number(frame.seq || 0) || 0);
    if (frame.type === 'done' || frame.type === 'final' || frame.type === 'error') terminalSeen = true;
  };
  const writePing = () => {
    if (closed || res.destroyed || res.writableEnded) return;
    try { res.write(': ping\n\n'); } catch { closed = true; }
  };
  const onClose = () => { closed = true; };
  res.on('close', onClose);
  try {
    while (!closed && !res.destroyed && !res.writableEnded) {
      const stream = getMainChatStream(sessionId);
      if (!stream || stream.streamId !== streamId) break;
      const frames = stream.events.filter((frame) => Number(frame.seq || 0) > lastSeq);
      for (const frame of frames) writeFrame(frame);
      if (terminalSeen || !stream.active) break;
      writePing();
      await sleep(750);
    }
    if (!terminalSeen && !closed && !res.destroyed && !res.writableEnded) {
      try {
        res.write(`data: ${JSON.stringify({ type: 'done', duplicate: true, clientRequestId: clientRequestId || undefined })}\n\n`);
      } catch {}
    }
  } finally {
    res.off('close', onClose);
  }
}


export function inferTaskChannelFromSession(sessionId: string): 'web' | 'telegram' {
  return String(sessionId || '').startsWith('telegram_') ? 'telegram' : 'web';
}

export function parseTelegramChatIdFromSessionId(sessionId: string): number | null {
  const v = String(sessionId || '').trim();
  if (!v.startsWith('telegram_')) return null;
  const id = Number(v.replace(/^telegram_/, ''));
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function bindTeamNotificationTargetFromSession(teamId: string, sessionId: string, source = 'session'): void {
  const tgChatId = parseTelegramChatIdFromSessionId(sessionId);
  if (tgChatId) {
    addTeamNotificationTarget(teamId, {
      channel: 'telegram',
      peerId: String(tgChatId),
      source,
    });
  }
}


export function attachRuntimeProcessEntriesToLatestAssistant(
  sessionId: string,
  entries: Record<string, any>[],
  identity?: { goalId?: string; goalTurnId?: string; goalTurnNumber?: number },
): void {
  const sid = String(sessionId || '').trim();
  const processEntries = Array.isArray(entries) ? entries.filter(Boolean) : [];
  if (!sid || !processEntries.length) return;
  try {
    const session = getSession(sid);
    const history = Array.isArray(session.history) ? session.history.slice() : [];
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const msg: any = history[i];
      if (msg?.role !== 'assistant' && msg?.role !== 'ai') continue;
      if (identity?.goalTurnId && String(msg.goalTurnId || '') !== identity.goalTurnId) continue;
      if (!identity?.goalTurnId && identity?.goalId && String(msg.goalId || '') !== identity.goalId) continue;
      if (!identity?.goalTurnId && Number.isFinite(Number(identity?.goalTurnNumber)) && Number(msg.goalTurnNumber || 0) !== Number(identity?.goalTurnNumber)) continue;
      const existing = Array.isArray(msg.processEntries) ? msg.processEntries : [];
      const merged = [...existing];
      const seen = new Set(merged.map((entry: any) => JSON.stringify({
        ts: entry?.ts,
        type: entry?.type,
        actor: entry?.actor,
        content: entry?.content,
        toolName: entry?.toolName,
      })));
      for (const entry of processEntries) {
        const key = JSON.stringify({
          ts: entry?.ts,
          type: entry?.type,
          actor: entry?.actor,
          content: entry?.content,
          toolName: entry?.toolName,
        });
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(entry);
      }
      if (merged.length === existing.length) return;
      history[i] = {
        ...msg,
        processEntries: merged.slice(-300),
        commentaryContext: buildDurableCommentaryContext({
          ...msg,
          processEntries: merged.slice(-300),
        }),
      };
      replaceHistory(sid, history);
      return;
    }
  } catch (err: any) {
    console.warn('[main chat] failed to attach runtime process entries:', err?.message || err);
  }
}





// Mirror of the mobile client's `_isMobileTransientReasoningTraceEntry`
// (web-ui/src/mobile/mobile-pages.js). These entries are streaming-only chatter:
// the client already drops them from its durable thread cache, so shipping them
// in restored history is pure payload weight. Full thoughts are durable journal
// entries and must never be removed, even when a provider echoes a summary
// field alongside them.


// Share of the cap reserved for the OLDEST durable entries when truncating.
// A turn that spans a gateway restart re-materializes with its pre-restart
// events at the front of the list, so a pure tail slice deletes precisely the
// part of the stream a user notices missing after a reconnect.



/**
 * Waiting on spawned background agents is real work, but no foreground tool
 * call is open during the finalization join, so the owner watchdog saw ten
 * quiet minutes and killed the turn (2026-09-26, ChatGPT turn 2da60e76 with
 * two GPT-6 agents still running). Emit a semantic `background_wait` frame
 * every 30s while joining; backgroundJoin's own timeoutMs still bounds it.
 */
export async function withBackgroundJoinKeepalive<T>(
  send: (event: string, data: any) => void,
  backgroundIds: string[],
  join: Promise<T>,
  intervalMs = 30_000,
): Promise<T> {
  const startedAt = Date.now();
  const tick = () => {
    const pending = backgroundIds.filter((id) => {
      const state = backgroundStatus(id)?.state;
      return state === 'queued' || state === 'in_progress';
    }).length;
    try { send('background_wait', { backgroundIds, pending, waitedMs: Date.now() - startedAt }); } catch { /* keepalive is best effort */ }
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  try {
    return await join;
  } finally {
    clearInterval(timer);
  }
}


export function normalizeExcludedSkillIdsInput(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(',') : []);
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of raw) {
    const id = String(item || '').trim();
    const key = id.toLowerCase();
    if (!id || seen.has(key)) continue;
    seen.add(key);
    ids.push(id);
    if (ids.length >= 20) break;
  }
  return ids;
}

export function normalizeForcedSkillIdsInput(value: unknown): string[] {
  return normalizeExcludedSkillIdsInput(value);
}
