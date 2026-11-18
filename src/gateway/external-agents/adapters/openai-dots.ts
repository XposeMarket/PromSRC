/**
 * OpenAI Dots as a connected agent. Unlike a harness, a dot is a CONTACT: one
 * persistent conversation per dot, created by dots-sync.ts, never from the
 * new-chat picker. A turn posts the user's message into the dot's room and
 * waits a bounded time for the dot's reply; anything later arrives through
 * the background sync. No model choice (OpenAI fixes it for a dot), no
 * approvals (the dot acts with its own access inside ChatGPT).
 */
import crypto from 'crypto';
import { DotsApiError, hasOpenAISignIn, listRoomMessages, sendRoomMessage, type DotMessage } from '../../dots/dots-api';
import { cancelDotsSync, getDots, getSeenIds, getUncertainSend, rememberSeen, rememberSent, setDotRoomBusy, setUncertainSend } from '../../dots/dots-sync';
import type { ExternalAgentAdapter, ExternalAgentVerifyResult, ExternalTurnInput, ExternalTurnResult } from '../types';

const POLL_MS = 2_500;
const REPLY_WAIT_MS = 180_000;
/** Dots often answer in several messages; stop once they have been quiet this long. */
const QUIET_MS = 6_000;
/** How long an unanswered send is remembered, so the same message sent again reuses its token. */
const UNCERTAIN_SEND_MS = 10 * 60_000;
/** Consecutive failed checks for a reply before the wait ends and says so. */
const MAX_POLL_FAILURES = 5;
/** If the chat never confirms it saved the reply, the room is freed anyway after this long. */
const RELEASE_SAFETY_MS = 15_000;

/** A retried send had already reached the dot, and the background sync already put the reply in the chat. */
export const DOT_ALREADY_TEXT = '_That message had already reached your dot. Its reply is above._';
export const DOT_PENDING_TEXT = "_Sent. Your dot hasn't replied yet. Its reply will show up here when it does._";

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }
    signal.addEventListener('abort', done, { once: true });
  });
}

export class OpenAIDotsAdapter implements ExternalAgentAdapter {
  id = 'openai-dots' as const;
  name = 'OpenAI Dots';
  tile = 'OD';
  kind = 'contact' as const;
  capabilities = { resume: true, interrupt: true, approvals: false, images: false, modelList: false };

  constructor(private readonly timing: { pollMs?: number; replyWaitMs?: number; quietMs?: number } = {}) {}

  async detect(): Promise<{ found: boolean }> {
    return { found: hasOpenAISignIn() };
  }

  async verify(): Promise<ExternalAgentVerifyResult> {
    const capabilities = this.capabilities;
    if (!hasOpenAISignIn()) {
      return { status: 'signed_out', statusText: 'Sign in to OpenAI in Settings > Models, then Check again.', capabilities };
    }
    try {
      const dots = await getDots(true);
      if (!dots.length) {
        return { status: 'unsupported', statusText: "This ChatGPT account doesn't have a dot yet. Create one in ChatGPT, then Check again.", capabilities };
      }
      const names = dots.map((dot) => dot.name).join(', ');
      return {
        status: 'ready',
        statusText: `Connected · ${names}`,
        account: { kind: 'chatgpt', label: `${dots.length} dot${dots.length === 1 ? '' : 's'}` },
        capabilities,
      };
    } catch (error: any) {
      const status = error instanceof DotsApiError && (error.status === 401 || error.status === 403) ? 'signed_out' : 'error';
      return { status, statusText: String(error?.message || error).slice(0, 160), capabilities };
    }
  }

  async runTurn(input: ExternalTurnInput): Promise<ExternalTurnResult> {
    const roomId = String(input.upstreamSessionId || '').trim();
    if (!roomId) return { upstreamSessionId: '', status: 'failed', finalText: '', error: 'This chat is not linked to a dot.' };
    const pollMs = this.timing.pollMs ?? POLL_MS;
    const quietMs = this.timing.quietMs ?? QUIET_MS;
    const deadline = Date.now() + (this.timing.replyWaitMs ?? REPLY_WAIT_MS);
    setDotRoomBusy(roomId, true);
    const seenIds: string[] = [];
    const replies: DotMessage[] = [];
    // Replies are marked seen only once the chat has saved them, and the room stays busy until
    // then, so the background sync can neither lose them nor mirror them a second time.
    let released = false;
    let safety: NodeJS.Timeout | null = null;
    const release = (acknowledge: boolean): void => {
      if (released) return;
      released = true;
      if (safety) clearTimeout(safety);
      if (acknowledge) {
        try { rememberSeen(roomId, [...seenIds, ...replies.map((r) => r.id)]); } catch { /* the sync may show a reply twice, never loses one */ }
      }
      setDotRoomBusy(roomId, false);
    };
    const afterPersist = (): void => release(true);
    const armSafety = (): void => { safety = setTimeout(() => release(false), RELEASE_SAFETY_MS); safety.unref?.(); };
    const textHash = crypto.createHash('sha256').update(String(input.text || '')).digest('hex');
    const pending = getUncertainSend(roomId);
    const reuse = pending && pending.textHash === textHash && Date.now() - pending.at < UNCERTAIN_SEND_MS ? pending.token : '';
    const token = reuse || crypto.randomUUID();
    let stopReason = '';
    let alreadyShown = false;
    // The wait for a reply ends at the deadline even mid-request, and at once when the user stops the turn.
    const wait = new AbortController();
    const stopWait = (): void => wait.abort();
    input.signal.addEventListener('abort', stopWait, { once: true });
    const deadlineTimer = setTimeout(stopWait, Math.max(0, deadline - Date.now()));
    deadlineTimer.unref?.();
    try {
      input.emit({ type: 'state', phase: 'running' });
      const sentAt = Date.now();
      // An earlier send of this same message got no answer. If it did reach the dot, it is not posted again.
      let landed: DotMessage | null = null;
      if (reuse) {
        try { landed = (await listRoomMessages(roomId, 30, input.signal)).find((msg) => msg.requestId === reuse) || null; } catch { landed = null; }
      }
      // Replies the background sync already put in the chat while the first try was unanswered are not shown again.
      const already = landed ? getSeenIds(roomId) : new Set<string>();
      if (landed) {
        seenIds.push(landed.id);
      } else {
        // Saved before the request goes out, so the token survives a timeout or a restart.
        rememberSent(roomId, token);
        setUncertainSend(roomId, { token, textHash, at: Date.now() });
        const { message } = await sendRoomMessage(roomId, input.text, input.signal, token);
        if (message?.id) seenIds.push(message.id);
      }
      setUncertainSend(roomId, null);
      let lastNewAt = 0;
      let failures = 0;
      let lastPollFailed = false;
      while (Date.now() < deadline && !wait.signal.aborted) {
        await sleep(pollMs, wait.signal);
        if (wait.signal.aborted) break;
        let messages: DotMessage[];
        try {
          messages = await listRoomMessages(roomId, 30, wait.signal);
          failures = 0;
          lastPollFailed = false;
        } catch (error) {
          if (wait.signal.aborted) break;
          lastPollFailed = true;
          // A rejected sign-in or a run of failures ends the wait; it is reported, not hidden.
          const status = error instanceof DotsApiError ? error.status : 0;
          if (status === 401 || status === 403) { stopReason = 'ChatGPT rejected the OpenAI sign-in'; break; }
          failures += 1;
          if (failures >= MAX_POLL_FAILURES) { stopReason = 'ChatGPT could not be reached'; break; }
          const pause = Math.max(error instanceof DotsApiError ? error.retryAfterMs : 0, Math.min(30_000, pollMs * 2 ** failures));
          await sleep(Math.max(0, Math.min(pause, deadline - Date.now())), wait.signal);
          continue;
        }
        const mine = messages.find((msg) => msg.requestId === token);
        if (mine && !seenIds.includes(mine.id)) seenIds.push(mine.id);
        const cutoff = mine?.at || landed?.at || sentAt - 2_000;
        let gotNew = false;
        for (const msg of messages) {
          if (!msg.fromDot || msg.at < cutoff || replies.some((r) => r.id === msg.id)) continue;
          if (already.has(msg.id)) { alreadyShown = true; continue; }
          if (replies.length) input.emit({ type: 'text_delta', text: '\n\n' });
          input.emit({ type: 'text_delta', text: msg.text });
          replies.push(msg);
          gotNew = true;
        }
        if (gotNew) lastNewAt = Date.now();
        else if (alreadyShown && !lastNewAt) lastNewAt = Date.now();
        else if ((replies.length || alreadyShown) && Date.now() - lastNewAt >= quietMs) break;
      }
      // The wait ran out while ChatGPT was failing: that is "could not check", not "no reply yet".
      if (!stopReason && lastPollFailed && !replies.length) stopReason = 'ChatGPT could not be reached';
    } catch (error: any) {
      // A clear refusal means nothing was posted. Anything else (timeout, dropped connection)
      // leaves the send marked uncertain, so the next try reuses its token.
      if (error instanceof DotsApiError && error.status >= 400 && error.status < 500) {
        try { setUncertainSend(roomId, null); } catch { /* state file unavailable */ }
      }
      armSafety();
      if (input.signal.aborted) return { upstreamSessionId: roomId, status: 'interrupted', finalText: '', afterPersist };
      return { upstreamSessionId: roomId, status: 'failed', finalText: '', error: String(error?.message || error).slice(0, 200), afterPersist };
    } finally {
      clearTimeout(deadlineTimer);
      input.signal.removeEventListener('abort', stopWait);
    }
    armSafety();
    const finalText = replies.map((r) => r.text).join('\n\n');
    if (input.signal.aborted) return { upstreamSessionId: roomId, status: 'interrupted', finalText, afterPersist };
    const unreachable = stopReason
      ? `_Sent, but Prometheus could not check for a reply (${stopReason}). The reply will show up here once ChatGPT can be reached again._`
      : '';
    return { upstreamSessionId: roomId, status: 'completed', finalText: [finalText, unreachable].filter(Boolean).join('\n\n') || (alreadyShown ? DOT_ALREADY_TEXT : DOT_PENDING_TEXT), afterPersist };
  }

  /** Turned off, or the gateway is stopping: no child process, but a sync that is mid-request is cancelled. */
  async shutdown(): Promise<void> { cancelDotsSync(); }
  isRunning(): boolean { return false; }
}
