/**
 * OpenAI Dots as a connected agent. Unlike a harness, a dot is a CONTACT: one
 * persistent conversation per dot, created by dots-sync.ts, never from the
 * new-chat picker. A turn posts the user's message into the dot's room and
 * waits a bounded time for the dot's reply; anything later arrives through
 * the background sync. No model choice (OpenAI fixes it for a dot), no
 * approvals (the dot acts with its own access inside ChatGPT).
 */
import { DotsApiError, hasOpenAISignIn, listRoomMessages, sendRoomMessage, type DotMessage } from '../../dots/dots-api';
import { getDots, rememberSeen, setDotRoomBusy } from '../../dots/dots-sync';
import type { ExternalAgentAdapter, ExternalAgentVerifyResult, ExternalTurnInput, ExternalTurnResult } from '../types';

const POLL_MS = 2_500;
const REPLY_WAIT_MS = 180_000;
/** Dots often answer in several messages; stop once they have been quiet this long. */
const QUIET_MS = 6_000;

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
    try {
      input.emit({ type: 'state', phase: 'running' });
      const sentAt = Date.now();
      const { requestId, message } = await sendRoomMessage(roomId, input.text, input.signal);
      if (message?.id) seenIds.push(message.id);
      let lastNewAt = 0;
      while (Date.now() < deadline && !input.signal.aborted) {
        await sleep(pollMs, input.signal);
        if (input.signal.aborted) break;
        let messages: DotMessage[];
        try { messages = await listRoomMessages(roomId, 30, input.signal); } catch { continue; }
        const mine = messages.find((msg) => msg.requestId === requestId);
        if (mine && !seenIds.includes(mine.id)) seenIds.push(mine.id);
        const cutoff = mine?.at || sentAt - 2_000;
        let gotNew = false;
        for (const msg of messages) {
          if (!msg.fromDot || msg.at < cutoff || replies.some((r) => r.id === msg.id)) continue;
          if (replies.length) input.emit({ type: 'text_delta', text: '\n\n' });
          input.emit({ type: 'text_delta', text: msg.text });
          replies.push(msg);
          gotNew = true;
        }
        if (gotNew) lastNewAt = Date.now();
        else if (replies.length && Date.now() - lastNewAt >= quietMs) break;
      }
    } catch (error: any) {
      if (input.signal.aborted) return { upstreamSessionId: roomId, status: 'interrupted', finalText: '' };
      return { upstreamSessionId: roomId, status: 'failed', finalText: '', error: String(error?.message || error).slice(0, 200) };
    } finally {
      try { rememberSeen(roomId, [...seenIds, ...replies.map((r) => r.id)], { lastAt: Math.max(0, ...replies.map((r) => r.at)) }); } catch { /* sync may re-import, never loses */ }
      setDotRoomBusy(roomId, false);
    }
    const finalText = replies.map((r) => r.text).join('\n\n');
    if (input.signal.aborted) return { upstreamSessionId: roomId, status: 'interrupted', finalText };
    return { upstreamSessionId: roomId, status: 'completed', finalText: finalText || DOT_PENDING_TEXT };
  }

  async shutdown(): Promise<void> { /* no child process */ }
  isRunning(): boolean { return false; }
}
