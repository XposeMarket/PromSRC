/**
 * chatgpt-web-adapter.ts
 *
 * Runs the "chatgpt" model of the openai_codex provider against ChatGPT's own
 * web backend, reusing the Codex OAuth session (no second login).
 *
 * Prometheus tools are NOT passed as function definitions: the ChatGPT
 * conversation endpoint does not accept them. Instead, when the Prometheus
 * MCP bridge is registered as a ChatGPT dev-mode connector, it is attached to
 * each message via selected_mcp_sources and ChatGPT calls Prometheus tools
 * itself. Every tool ChatGPT runs (its own web search / python / connectors,
 * including the Prometheus bridge) is surfaced as a normal tool_call_start /
 * tool_call_done model event, so the chat UI renders it like any other tool.
 */

import crypto from 'crypto';
import fs from 'fs';
import type { ChatMessage, ChatOptions, ChatResult, ModelStreamEvent } from '../LLMProvider';
import { contentToString, stripCacheMarker } from '../content-utils';
import { startConversation, hideConversation, ChatGPTWebError, type ChatGPTWebCredentials } from './chatgpt-web-client';
import { ChatGPTWebStreamParser, type ChatGPTWebStreamEvent } from './chatgpt-web-stream';
import { resolveChatGPTWebMode, CHATGPT_WEB_MODEL } from './chatgpt-web-models';

const REQUEST_TIMEOUT_MS = 15 * 60_000;
const IDLE_TIMEOUT_MS = 4 * 60_000;
/** ChatGPT caps a single message; keep the system block well under it. */
const MAX_SYSTEM_CHARS = 60_000;
const MAX_MESSAGE_CHARS = 40_000;

export interface ChatGPTWebBridgeSource {
  id: string;
  name: string;
  /** Link id; ChatGPT addresses connector tools as /<name>/<linkId>/<tool>. */
  linkId?: string;
}

export interface ChatGPTWebAdapterDeps {
  getCredentials: () => Promise<ChatGPTWebCredentials>;
  /** Registered dev-mode connector for the Prometheus MCP bridge, if any. */
  getBridgeSource?: (sessionHint?: string) => Promise<ChatGPTWebBridgeSource | null>;
  temporaryChats?: () => boolean;
  providerId?: string;
}

function textOf(content: unknown): string {
  return stripCacheMarker(contentToString(content as any)).trim();
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.floor(max * 0.35))}\n\n[... ${text.length - max} characters omitted ...]\n\n${text.slice(-Math.floor(max * 0.65))}`;
}

/**
 * Convert the Prometheus transcript into ChatGPT messages. The system prompt
 * becomes a hidden system message (verified: the backend honors it). Tool
 * turns from earlier providers are folded into readable assistant notes, since
 * ChatGPT has no function-call message type on this endpoint.
 */
export function buildChatGPTWebMessages(messages: ChatMessage[], bridge: boolean | ChatGPTWebBridgeSource | null) {
  const bridgeAvailable = !!bridge;
  const toolPath = bridge && typeof bridge === 'object' && bridge.linkId ? `/${bridge.name}/${bridge.linkId}/<tool_name>` : '';
  const out: Array<{ id: string; author: { role: string }; content: any; metadata: Record<string, unknown> }> = [];
  const push = (role: 'system' | 'user' | 'assistant', text: string, metadata: Record<string, unknown> = {}) => {
    const value = String(text || '').trim();
    if (!value) return;
    const previous = out[out.length - 1];
    // Merge consecutive same-role turns; ChatGPT expects alternation.
    if (previous && previous.author.role === role && role !== 'system') {
      previous.content.parts[0] = `${previous.content.parts[0]}\n\n${value}`;
      return;
    }
    out.push({ id: crypto.randomUUID(), author: { role }, content: { content_type: 'text', parts: [value] }, metadata });
  };

  const systemText = messages.filter((m) => m.role === 'system').map((m) => textOf(m.content)).filter(Boolean).join('\n\n');
  const bridgeNote = bridgeAvailable
    ? [
      '[PROMETHEUS BRIDGE]',
      'You are running inside Prometheus through the ChatGPT backend. The "Prometheus" connector (app) is attached and connected in this chat: it exposes the Prometheus tools named in the instructions above and runs them on the user\'s own computer (files, shell, browser, memory, notes).',
      `Call them with api_tool.call_tool${toolPath ? ` using path "${toolPath}"` : ''} and the tool\'s JSON arguments. They are available right now: never say the connector or a tool is unavailable without calling it first. Prefer calling a tool over guessing.`,
    ].join('\n')
    : '[PROMETHEUS BRIDGE]\nYou are running inside Prometheus through the ChatGPT backend. The Prometheus tool bridge is not connected for this chat, so you cannot act on the user\'s computer; say so plainly if a request needs local tools.';
  const system = [clip(systemText, MAX_SYSTEM_CHARS), bridgeNote].filter(Boolean).join('\n\n');
  push('system', system, { is_visually_hidden_from_conversation: true });

  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      const name = String((m as any).tool_name || m.name || 'tool');
      push('assistant', `[Prometheus tool result: ${name}]\n${clip(textOf(m.content), 8_000)}`);
      continue;
    }
    if (m.role === 'assistant') {
      const calls = Array.isArray(m.tool_calls) ? m.tool_calls : [];
      const callText = calls.map((c) => `[Prometheus tool call: ${c?.function?.name || 'tool'}(${String(typeof c?.function?.arguments === 'string' ? c.function.arguments : JSON.stringify(c?.function?.arguments || {})).slice(0, 1_500)})]`).join('\n');
      push('assistant', [clip(textOf(m.content), MAX_MESSAGE_CHARS), callText].filter(Boolean).join('\n'));
      continue;
    }
    const parts = Array.isArray(m.content) ? m.content : null;
    const imageCount = parts ? parts.filter((p: any) => p?.type === 'image_url').length : 0;
    const text = clip(textOf(m.content), MAX_MESSAGE_CHARS);
    push('user', imageCount ? `${text}\n\n[${imageCount} image attachment(s) omitted: images are not forwarded to ChatGPT yet]` : text);
  }

  // ChatGPT needs the turn to end on a user message.
  if (!out.length || out[out.length - 1].author.role !== 'user') push('user', 'Continue.');
  return out;
}

export class ChatGPTWebAdapter {
  constructor(private readonly deps: ChatGPTWebAdapterDeps) {}

  async chat(messages: ChatMessage[], _model: string, options?: ChatOptions): Promise<ChatResult> {
    const providerId = this.deps.providerId || 'openai_codex';
    const mode = resolveChatGPTWebMode(typeof options?.think === 'string' ? options.think : undefined);
    const emit = (event: ModelStreamEvent) => {
      try { options?.onModelEvent?.({ ...event, provider: providerId, model: CHATGPT_WEB_MODEL } as ModelStreamEvent); } catch { /* UI callbacks never break the call */ }
    };

    const creds = await this.deps.getCredentials();
    const bridge = this.deps.getBridgeSource ? await this.deps.getBridgeSource().catch(() => null) : null;
    const chatMessages = buildChatGPTWebMessages(messages, bridge);

    const controller = new AbortController();
    let abortReason = '';
    const abortFor = (reason: string) => {
      if (controller.signal.aborted) return;
      abortReason = reason;
      controller.abort();
    };
    const onExternalAbort = () => abortFor('ChatGPT request canceled by client');
    options?.abortSignal?.addEventListener?.('abort', onExternalAbort, { once: true });
    const requestTimer = setTimeout(() => abortFor(`ChatGPT request exceeded ${Math.round(REQUEST_TIMEOUT_MS / 60_000)} minutes`), REQUEST_TIMEOUT_MS);
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => abortFor(`ChatGPT stream had no activity for ${Math.round(IDLE_TIMEOUT_MS / 1000)}s`), IDLE_TIMEOUT_MS);
    };

    const parser = new ChatGPTWebStreamParser();
    let streamedText = '';
    let thinking = '';
    let actualModel = '';
    let streamError = '';
    let assistantStarted = false;

    const handle = (events: ChatGPTWebStreamEvent[]) => {
      for (const ev of events) {
        switch (ev.type) {
          case 'text_delta':
            if (!assistantStarted) {
              assistantStarted = true;
              emit({ type: 'assistant_item_start', itemId: ev.messageId, phase: 'final_answer', nativeType: 'chatgpt.message' });
            }
            streamedText += ev.text;
            options?.onToken?.(ev.text);
            emit({ type: 'assistant_delta', text: ev.text, itemId: ev.messageId, phase: 'final_answer', nativeType: 'chatgpt.delta' });
            break;
          case 'reasoning': {
            const line = `${ev.text}\n`;
            thinking += line;
            options?.onReasoningSummary?.(line);
            emit({ type: 'reasoning_delta', text: line, summary: true, nativeType: 'chatgpt.thoughts' });
            break;
          }
          case 'tool_start': {
            // Calls into the Prometheus connector already run (and render) as real
            // Prometheus tool rows through the bridge executor; only ChatGPT's own
            // tools and other apps get a ChatGPT-origin row here.
            const viaBridge = !!bridge && ev.connector?.connector === bridge.name;
            if (!viaBridge) {
              emit({ type: 'tool_call_start', id: `chatgpt_${ev.id}`, name: ev.name, nativeType: 'chatgpt.tool_call' });
              emit({ type: 'tool_call_done', id: `chatgpt_${ev.id}`, name: ev.name, arguments: ev.args, nativeType: 'chatgpt.tool_call' });
            }
            emit({ type: 'provider_event', nativeType: 'chatgpt.tool_start', data: { id: `chatgpt_${ev.id}`, name: ev.name, args: ev.args, viaBridge, ...(ev.connector ? { connector: ev.connector.connector, tool: ev.connector.tool } : {}) } });
            break;
          }
          case 'tool_result': {
            const viaBridge = !!bridge && ev.connector?.connector === bridge.name;
            emit({ type: 'provider_event', nativeType: 'chatgpt.tool_result', data: { id: `chatgpt_${ev.id}`, name: ev.name, result: ev.result, error: !!ev.error, viaBridge } });
            break;
          }
          case 'model':
            actualModel = ev.model;
            break;
          case 'error':
            streamError = ev.message;
            break;
          default:
            break;
        }
      }
    };

    const wantTemporary = this.deps.temporaryChats ? this.deps.temporaryChats() : true;
    try {
      resetIdle();
      const response = await startConversation(creds, {
        messages: chatMessages,
        model: mode.slug,
        thinkingEffort: mode.thinkingEffort,
        temporary: wantTemporary,
        mcpSources: bridge ? [{ id: bridge.id, name: bridge.name, status: 'ONLY_ME' }] : undefined,
      }, controller.signal);
      resetIdle();
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        resetIdle();
        const text = decoder.decode(value, { stream: true });
        // Debug: PROMETHEUS_CHATGPT_WEB_TRACE=<file> appends the raw SSE stream.
        if (process.env.PROMETHEUS_CHATGPT_WEB_TRACE) {
          try { fs.appendFileSync(process.env.PROMETHEUS_CHATGPT_WEB_TRACE, text); } catch { /* debug only */ }
        }
        handle(parser.push(text));
      }
      handle(parser.push(decoder.decode()));
      handle(parser.end());
    } catch (error: any) {
      if (controller.signal.aborted) {
        const err = new Error(abortReason || 'ChatGPT request aborted') as Error & { code?: string };
        err.code = options?.abortSignal?.aborted ? 'ABORTED' : 'CHATGPT_WEB_TIMEOUT';
        throw err;
      }
      throw error;
    } finally {
      clearTimeout(requestTimer);
      if (idleTimer) clearTimeout(idleTimer);
      options?.abortSignal?.removeEventListener?.('abort', onExternalAbort);
      // Connector turns cannot be Temporary Chats (ChatGPT drops apps there),
      // so hide the saved conversation instead to keep the sidebar clean.
      if (bridge && wantTemporary && parser.getConversationId()) {
        void hideConversation(creds, parser.getConversationId());
      }
    }

    const finalText = parser.getFinalText() || streamedText.trim();
    if (assistantStarted) emit({ type: 'assistant_item_done', text: finalText, phase: 'final_answer', nativeType: 'chatgpt.message' });
    if (!finalText) {
      throw new ChatGPTWebError('CHATGPT_WEB_STREAM', streamError ? `ChatGPT stream error: ${streamError}` : 'ChatGPT returned no answer text.');
    }
    return {
      message: { role: 'assistant', content: finalText },
      thinking: thinking.trim() || undefined,
      stopReason: 'stop',
      ...(actualModel ? { actualModel } : {}),
    } as ChatResult;
  }
}
