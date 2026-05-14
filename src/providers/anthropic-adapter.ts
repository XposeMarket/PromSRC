/**
 * anthropic-adapter.ts
 *
 * Provider adapter for Anthropic Claude models via api.anthropic.com/v1/messages.
 * Uses Anthropic's native message format (NOT OpenAI-compat).
 *
 * Supports both:
 *   - setup-token auth (sk-ant-oat-*) from Claude Pro/Max subscription
 *   - API key auth (sk-ant-api-*) from Anthropic Console
 *
 * Auth is handled by anthropic-oauth.ts (vault-backed token storage).
 *
 * Mirrors how OpenClaw routes Anthropic requests:
 *   - Bearer auth + anthropic-beta: oauth-2025-04-20 for OAuth tokens
 *   - x-api-key header for API keys
 *   - anthropic-version: 2023-06-01
 */

import type {
  LLMProvider, ChatMessage, ContentPart, ChatOptions, ChatResult,
  GenerateOptions, GenerateResult, ModelInfo, ModelUsage, ToolCall,
} from './LLMProvider';
import {
  buildAuthHeaders, getValidToken, loadTokens,
  ANTHROPIC_API_BASE,
} from '../auth/anthropic-oauth';
import { contentToString } from './content-utils';
import { getConfig } from '../config/config';

// Models available via Anthropic
export const ANTHROPIC_MODELS = [
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5-20250514',
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-20250514',
];

export interface AnthropicDirectConfig {
  providerId: string;
  apiKey: string;
  baseUrl?: string;
  authHeader?: 'bearer' | 'x-api-key';
  staticModels?: string[];
  defaultHeaders?: Record<string, string>;
}

export class AnthropicAdapter implements LLMProvider {
  readonly id: string;
  private configDir?: string;
  private directConfig?: AnthropicDirectConfig;

  constructor(config: string | AnthropicDirectConfig) {
    if (typeof config === 'string') {
      this.id = 'anthropic';
      this.configDir = config;
      return;
    }
    this.id = config.providerId;
    this.directConfig = config;
  }

  private getMessagesEndpoint(): string {
    const baseUrl = String(this.directConfig?.baseUrl || ANTHROPIC_API_BASE).trim().replace(/\/$/, '');
    return `${baseUrl}/v1/messages`;
  }

  private isAssistantToolTurn(message: ChatMessage | undefined): boolean {
    return !!(message && message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0);
  }

  private normalizeToolCallInput(value: unknown): any {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return {};
      try {
        return JSON.parse(trimmed);
      } catch {
        return {};
      }
    }
    if (value && typeof value === 'object') {
      return value;
    }
    return {};
  }

  private normalizeToolMessageContent(message: ChatMessage): string {
    const text = contentToString(message.content).trim();
    if (text) return text;
    return Array.isArray(message.content)
      ? '[non-text tool output omitted]'
      : '';
  }

  private buildToolNoteMessage(message: ChatMessage): ChatMessage {
    const toolName = String((message as any).tool_name || message.name || 'tool').trim() || 'tool';
    const content = this.normalizeToolMessageContent(message) || '[no tool output captured]';
    return {
      role: 'user',
      content: `[tool-note:${toolName}] ${content}`.slice(0, 12000),
    };
  }

  private buildMissingToolResultMessage(toolCallId: string, toolName: string): ChatMessage {
    return {
      role: 'tool',
      tool_call_id: toolCallId,
      name: toolName,
      content: `ERROR: Prometheus did not record a tool result for "${toolName || 'tool'}". Treat this tool call as interrupted and continue safely.`,
    };
  }

  private repairMessagesForAnthropic(messages: ChatMessage[]): ChatMessage[] {
    const repaired: ChatMessage[] = [];
    let fallbackSeq = 0;
    const nextFallbackToolUseId = () => `autocall_${Date.now()}_${++fallbackSeq}`;

    for (let i = 0; i < messages.length; i++) {
      const current = messages[i];
      if (!current) continue;

      if (!this.isAssistantToolTurn(current)) {
        repaired.push(current.role === 'tool' ? this.buildToolNoteMessage(current) : current);
        continue;
      }

      let assistantChanged = false;
      const normalizedToolCalls = (current.tool_calls || []).map((toolCall: ToolCall) => {
        const normalizedId = String(toolCall?.id || '').trim() || nextFallbackToolUseId();
        if (normalizedId !== String(toolCall?.id || '').trim()) assistantChanged = true;
        return {
          ...toolCall,
          id: normalizedId,
        };
      });
      const assistantMessage = assistantChanged
        ? { ...current, tool_calls: normalizedToolCalls }
        : current;

      const pendingIds = normalizedToolCalls.map((toolCall) => toolCall.id);
      const unresolved = new Set(pendingIds);
      const matchedResults = new Map<string, ChatMessage>();
      const remainder: ChatMessage[] = [];

      let j = i + 1;
      for (; j < messages.length; j++) {
        const next = messages[j];
        if (!next) continue;
        if (this.isAssistantToolTurn(next)) break;

        if (next.role !== 'tool') {
          remainder.push(next);
          continue;
        }

        const content = this.normalizeToolMessageContent(next) || '[no tool output captured]';
        const explicitId = String(next.tool_call_id || '').trim();

        if (explicitId) {
          if (!unresolved.has(explicitId) || matchedResults.has(explicitId)) {
            remainder.push(this.buildToolNoteMessage({ ...next, content }));
            continue;
          }
          unresolved.delete(explicitId);
          matchedResults.set(explicitId, { ...next, tool_call_id: explicitId, content });
          continue;
        }

        const observedToolName = String((next as any).tool_name || next.name || '').trim();
        const fallbackId = pendingIds.find((id) => {
          if (!unresolved.has(id) || matchedResults.has(id)) return false;
          if (!observedToolName) return true;
          const pendingToolCall = normalizedToolCalls.find((toolCall) => toolCall.id === id);
          return String(pendingToolCall?.function?.name || '').trim() === observedToolName;
        });
        if (!fallbackId) {
          remainder.push(this.buildToolNoteMessage({ ...next, content }));
          continue;
        }
        unresolved.delete(fallbackId);
        matchedResults.set(fallbackId, { ...next, tool_call_id: fallbackId, content });
      }

      repaired.push(assistantMessage);
      for (const toolCall of normalizedToolCalls) {
        repaired.push(
          matchedResults.get(toolCall.id)
          || this.buildMissingToolResultMessage(toolCall.id, String(toolCall.function?.name || 'tool')),
        );
      }
      repaired.push(...remainder);
      i = j - 1;
    }

    return repaired;
  }

  // ─── Convert Prometheus ChatMessage[] → Anthropic messages format ────────────

  private buildMessages(messages: ChatMessage[], omitIntradayNotes?: boolean): { system: string; messages: any[] } {
    let systemPrompt = '';
    const anthropicMessages: any[] = [];
    const pendingToolUseIds: string[] = [];
    const knownToolUseIds = new Set<string>();
    const consumedToolUseIds = new Set<string>();
    const repairedMessages = this.repairMessagesForAnthropic(messages);

    // Pending tool_result blocks for batching — Anthropic requires all tool results
    // from a single assistant turn to be in ONE user message (not separate messages).
    let pendingToolResults: any[] = [];

    const flushToolResults = () => {
      if (pendingToolResults.length === 0) return;
      anthropicMessages.push({ role: 'user', content: [...pendingToolResults] });
      pendingToolResults = [];
    };

    for (const m of repairedMessages) {
      if (m.role === 'system') {
        // Anthropic uses a top-level `system` param, not a system message in the array
        systemPrompt += (systemPrompt ? '\n\n' : '') + contentToString(m.content);
        continue;
      }

      // Any non-tool message flushes accumulated tool results first
      if (m.role !== 'tool') {
        flushToolResults();
      }

      if (m.role === 'assistant' && m.tool_calls?.length) {
        // Assistant message with tool use
        const content: any[] = [];

        // If there's text content too, add it first
        const textContent = contentToString(m.content);
        if (textContent) {
          content.push({ type: 'text', text: textContent });
        }

        for (const tc of m.tool_calls) {
          const parsedInput = this.normalizeToolCallInput(tc?.function?.arguments);
          const callId = String(tc?.id || '').trim();
          pendingToolUseIds.push(callId);
          knownToolUseIds.add(callId);

          content.push({
            type: 'tool_use',
            id: callId,
            name: tc.function.name,
            input: parsedInput,
          });
        }

        anthropicMessages.push({ role: 'assistant', content });
        continue;
      }

      if (m.role === 'tool') {
        // Tool result message - validate content is non-empty
        const toolContent = this.normalizeToolMessageContent(m) || '[no tool output captured]';

        const explicitToolCallId = String(m.tool_call_id || '').trim();
        let resolvedToolUseId = '';

        if (explicitToolCallId && knownToolUseIds.has(explicitToolCallId)) {
          // Use explicit ID if it matches a known tool_use
          resolvedToolUseId = explicitToolCallId;
          const idx = pendingToolUseIds.indexOf(explicitToolCallId);
          if (idx !== -1) pendingToolUseIds.splice(idx, 1);
        } else if (explicitToolCallId) {
          // Explicit ID provided but not in known set — still use it (may be from previous turn)
          // The API will ignore tool_results for unknown tool_use IDs, which is safe.
          resolvedToolUseId = explicitToolCallId;
        } else if (pendingToolUseIds.length > 0) {
          // No explicit ID — try to auto-match from pending queue (FIFO)
          resolvedToolUseId = pendingToolUseIds.shift() || '';
        }

        const isAlreadyConsumed = resolvedToolUseId ? consumedToolUseIds.has(resolvedToolUseId) : false;

        if (resolvedToolUseId && !isAlreadyConsumed) {
          // Accept both known IDs and explicit-but-unknown IDs (latter will be ignored by API)
          consumedToolUseIds.add(resolvedToolUseId);
          // Accumulate into pending batch instead of pushing immediately —
          // will be flushed as a single user message when a non-tool message arrives.
          const toolResultBlock: any = {
            type: 'tool_result',
            tool_use_id: resolvedToolUseId,
            content: toolContent,
          };
          if ((m as any).error === true || /^ERROR[:\s]/i.test(toolContent)) {
            toolResultBlock.is_error = true;
          }
          pendingToolResults.push(toolResultBlock);
          continue;
        }

        // Fallback: if no ID could be resolved, treat as a note message
        const toolName = String((m as any).tool_name || (m as any).name || 'tool').trim() || 'tool';
        const maxNoteLength = 4000;
        const noteContent = toolContent.length > maxNoteLength
          ? `${toolContent.slice(0, maxNoteLength)}…`
          : toolContent;
        anthropicMessages.push({
          role: 'assistant',
          content: `[tool-note:${toolName}] ${noteContent}`,
        });
        continue;
      }

      // Handle multimodal content (images)
      if (Array.isArray(m.content)) {
        const parts: any[] = m.content
          .map((part: ContentPart | any) => {
            if (part.type === 'text') {
              // Only include text parts that are non-empty
              const text = typeof part.text === 'string' ? part.text.trim() : '';
              return text ? { type: 'text', text } : null;
            }
            if (part.type === 'image') {
              // Already in Anthropic native format (from buildVisionImagePart for Anthropic provider)
              return part;
            }
            if (part.type === 'image_url') {
              // Convert OpenAI-style image_url to Anthropic source format
              const url = part.image_url.url;
              if (url.startsWith('data:')) {
                // Base64 data URI
                const match = url.match(/^data:(image\/\w+);base64,(.+)$/);
                if (match) {
                  return {
                    type: 'image',
                    source: {
                      type: 'base64',
                      media_type: match[1],
                      data: match[2],
                    },
                  };
                }
              }
              // URL-based image
              return {
                type: 'image',
                source: { type: 'url', url },
              };
            }
            return null;
          })
          .filter((part): part is Exclude<any, null> => part !== null);  // Remove null entries (empty text)

        if (parts.length === 0) continue;  // Skip if no content remains
        anthropicMessages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: parts });
        continue;
      }

      // Plain text message - validate content is non-empty
      const textContent = typeof m.content === 'string' ? m.content.trim() : '';
      if (!textContent) continue;  // Skip empty messages

      anthropicMessages.push({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: textContent,
      });
    }

    // Flush any remaining tool results at end of message list
    flushToolResults();

    // Strip [TODAY_NOTES...] block from system prompt when requested (e.g. after switch_model)
    if (omitIntradayNotes && systemPrompt.includes('[TODAY_NOTES')) {
      systemPrompt = systemPrompt.replace(/\[TODAY_NOTES[^\]]*\][\s\S]*?(?=\n\n\[|\n\n##|\s*$)/g, '').trim();
    }

    return { system: systemPrompt, messages: anthropicMessages };
  }


  // ─── Convert Anthropic tools format ──────────────────────────────────────────

  private buildTools(tools?: any[]): any[] | undefined {
    if (!tools?.length) return undefined;
    return tools.map((t: any) => ({
      name:         t.function?.name || t.name,
      description:  t.function?.description || t.description || '',
      input_schema: t.function?.parameters || t.parameters || { type: 'object', properties: {} },
    }));
  }

  // ─── Chat ───────────────────────────────────────────────────────────────────

  // Trim system prompt progressively to fit within Anthropic's 200k token limit.
  // Anthropic counts system + messages + tools together.
  // Use 3.5 chars/token (code-heavy content tokenizes denser than plain text).
  // Target 180k tokens to leave a 20k headroom for response + overhead.
  // Strips in order: TODAY_NOTES → tools policy blocks → USER section → SOUL truncation.
  private trimSystemForBudget(system: string, bodyWithoutSystem: string): string {
    const SAFE_TOKEN_BUDGET = 180_000;
    const CHARS_PER_TOKEN   = 3.5;
    const SAFE_CHAR_BUDGET  = Math.floor(SAFE_TOKEN_BUDGET * CHARS_PER_TOKEN); // 630_000

    const bodyChars = bodyWithoutSystem.length;
    if (bodyChars + system.length <= SAFE_CHAR_BUDGET) return system; // fits — no trim needed

    let s = system;
    const budget = () => SAFE_CHAR_BUDGET - bodyChars;

    // Pass 1: strip [TODAY_NOTES] block
    if (s.length > budget()) {
      s = s.replace(/\[TODAY_NOTES[^\]]*\][\s\S]*?(?=\n\n\[|\s*$)/g, '').trim();
    }

    // Pass 2: strip the [MODEL ROUTING] + per-category tool policy blocks
    if (s.length > budget()) {
      s = s.replace(/\[MODEL ROUTING\][\s\S]*?(?=\n\n\[|\s*$)/g, '').trim();
      s = s.replace(/(?:WEB|BROWSER|DESKTOP|FILE|TASK|SCHEDULE|SHELL|MEMORY|DEBUG|TEAMS|INTEGRATIONS) TOOLS:[\s\S]*?(?=\n\n(?:[A-Z]{2,}[ A-Z]+ TOOLS:|$))/g, '').trim();
    }

    // Pass 3: remove the entire [USER] block
    if (s.length > budget()) {
      s = s.replace(/\[USER\][\s\S]*?(?=\n\n\[|\s*$)/g, '').trim();
    }

    // Pass 4: truncate [SOUL] to its first 800 chars, keeping the header
    if (s.length > budget()) {
      s = s.replace(/(\[SOUL\]\n)([\s\S]{800})[\s\S]*?(?=\n\n\[|\s*$)/, '$1$2\n[... soul truncated for context budget ...]').trim();
    }

    // Pass 5: hard truncate whatever remains to fit.
    // If budget is negative (messages+tools alone fill the limit), strip system entirely
    // so the API at least gets a valid request.
    if (s.length > Math.max(0, budget())) {
      const limit = budget();
      s = limit <= 0
        ? ''
        : s.slice(0, limit) + '\n[... system prompt truncated for Anthropic 200k context limit ...]';
    }

    return s;
  }

  // Only add interleaved-thinking beta when extended thinking is actually enabled.
  // Adding it unconditionally causes 429s on OAuth tokens.
  private buildHeaders(model: string, extendedThinkingEnabled = false): Record<string, string> {
    const headers = this.directConfig
      ? this.buildDirectHeaders()
      : buildAuthHeaders(this.configDir!);
    const isThinkingGeneration = /claude-(sonnet|opus)-4-(6|7)/.test(model);
    if (isThinkingGeneration && extendedThinkingEnabled) {
      const existing = headers['anthropic-beta'];
      if (existing && !existing.includes('interleaved-thinking')) {
        headers['anthropic-beta'] = `${existing},interleaved-thinking-2025-05-14`;
      } else if (!existing) {
        headers['anthropic-beta'] = 'interleaved-thinking-2025-05-14';
      }
    }
    return headers;
  }

  private buildDirectHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...(this.directConfig?.defaultHeaders || {}),
    };
    const apiKey = String(this.directConfig?.apiKey || '').trim();
    if (apiKey) {
      if (this.directConfig?.authHeader === 'bearer') {
        headers['authorization'] = `Bearer ${apiKey}`;
      } else {
        headers['x-api-key'] = apiKey;
      }
    }
    return headers;
  }

  private parseUsage(usage: any): ModelUsage | undefined {
    if (!usage || typeof usage !== 'object') return undefined;
    const inputTokens = Number(usage.input_tokens || 0);
    const outputTokens = Number(usage.output_tokens || 0);
    const cacheReadTokens = Number(usage.cache_read_input_tokens || 0);
    const cacheWriteTokens = Number(usage.cache_creation_input_tokens || 0);
    const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
    return {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens,
      source: 'provider',
    };
  }

  async chat(messages: ChatMessage[], model: string, options?: ChatOptions): Promise<ChatResult> {
    const raw = getConfig().getConfig() as any;
    const anthropicCfg = raw.llm?.providers?.[this.id] || raw.llm?.providers?.anthropic || {};
    const extendedThinkingEnabled = options?.think !== false
      && options?.think !== 'none'
      && (anthropicCfg.extended_thinking === true || !!options?.think);

    const headers = this.buildHeaders(model, extendedThinkingEnabled);
    const { system, messages: anthropicMessages } = this.buildMessages(messages, options?.omitIntradayNotes);

    const body: any = {
      model,
      max_tokens: options?.max_tokens || 8192,
      messages:   anthropicMessages,
    };

    const tools = this.buildTools(options?.tools);
    if (tools) body.tools = tools;

    // Subscription OAuth gate: Anthropic only routes requests to Pro/Max
    // subscription quota when the FIRST system block is the Claude Code identity
    // preamble. Without it, Sonnet/Opus return either a generic 429 "Error" or
    // a 400 "out of extra usage" (the gate masquerades as a quota error). The
    // preamble must be sent on EVERY OAuth request — including subagent calls
    // that may have empty system prompts. API keys don't need this.
    const isOAuth = !this.directConfig
      && this.configDir
      && loadTokens(this.configDir)?.auth_type === 'setup_token';
    const claudeCodePreamble = { type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." };

    if (system) {
      const bodyWithoutSystem = JSON.stringify({ ...body, system: undefined });
      const trimmed = this.trimSystemForBudget(system, bodyWithoutSystem);
      if (isOAuth) {
        body.system = trimmed
          ? [claudeCodePreamble, { type: 'text', text: trimmed }]
          : [claudeCodePreamble];
      } else if (trimmed) {
        body.system = trimmed;
      }
    } else if (isOAuth) {
      body.system = [claudeCodePreamble];
    }

    // Extended thinking: enabled via config setting, suppressed for automation turns (think === false)
    if (extendedThinkingEnabled) {
      const budget = typeof anthropicCfg.thinking_budget === 'number' ? anthropicCfg.thinking_budget : 10000;
      body.thinking = { type: 'enabled', budget_tokens: budget };
      body.max_tokens = Math.max(body.max_tokens, budget + 8192);
    }

    // ─── DEBUG: log request shape so we can diff main-chat vs subagent ────────
    try {
      const sysPreview = Array.isArray(body.system)
        ? `array(${body.system.length}) first="${String(body.system[0]?.text || '').slice(0, 60)}"`
        : `string(${String(body.system || '').length})`;
      const headerKeys = Object.keys(headers).join(',');
      const betaHdr = (headers as any)['anthropic-beta'] || '(none)';
      const uaHdr = (headers as any)['user-agent'] || '(none)';
      const authHdrType = (headers as any)['Authorization'] ? 'Bearer' : (headers as any)['x-api-key'] ? 'x-api-key' : 'none';
      console.log(`[anthropic-debug] model=${model} isOAuth=${isOAuth} system=${sysPreview} auth=${authHdrType} ua=${uaHdr} beta=${betaHdr} headers=[${headerKeys}] tools=${tools?.length || 0} max_tokens=${body.max_tokens}`);
    } catch {}

    // If onToken callback provided, use streaming mode
    if (options?.onToken) {
      body.stream = true;
      const response = await fetch(this.getMessagesEndpoint(), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`${this.id} API error ${response.status}: ${text.slice(0, 500)}`);
      }
      return this.parseStreamingResponse(response, options.onToken, options.onThinking);
    }

    const response = await fetch(this.getMessagesEndpoint(), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`${this.id} API error ${response.status}: ${text.slice(0, 500)}`);
    }

    const data = await response.json() as any;
    return this.parseResponse(data);
  }

  // ─── Parse Anthropic streaming SSE response ──────────────────────────────────

  private async parseStreamingResponse(response: Response, onToken: (chunk: string) => void, onThinking?: (chunk: string) => void): Promise<ChatResult> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body from Anthropic streaming endpoint');

    const decoder = new TextDecoder();
    let buffer = '';
    let textContent = '';
    let thinking = '';
    const toolCalls: any[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    // Track per-block accumulation: blockIndex → { type, id, name, inputJson }
    const blocks: Record<number, any> = {};

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const event = JSON.parse(data);
            const type = event.type as string;

            if (type === 'message_start' && event.message?.usage) {
              const usage = event.message.usage;
              inputTokens = Number(usage.input_tokens || inputTokens || 0);
              cacheReadTokens = Number(usage.cache_read_input_tokens || cacheReadTokens || 0);
              cacheWriteTokens = Number(usage.cache_creation_input_tokens || cacheWriteTokens || 0);
            }

            if (type === 'message_delta' && event.usage) {
              outputTokens = Number(event.usage.output_tokens || outputTokens || 0);
            }

            if (type === 'content_block_start') {
              const idx = event.index ?? 0;
              const block = event.content_block || {};
              blocks[idx] = {
                type: block.type,
                id:   block.id,
                name: block.name,
                inputJson: '',
              };
            }

            if (type === 'content_block_delta') {
              const idx = event.index ?? 0;
              const delta = event.delta || {};
              if (delta.type === 'text_delta') {
                textContent += delta.text || '';
                onToken(delta.text || '');
	              } else if (delta.type === 'thinking_delta') {
	                const thinkDelta = delta.thinking || '';
	                thinking += thinkDelta;
	                if (thinkDelta) onThinking?.(thinkDelta);
	              } else if (delta.type === 'input_json_delta') {
                if (blocks[idx]) blocks[idx].inputJson += delta.partial_json || '';
              }
            }

            if (type === 'content_block_stop') {
              const idx = event.index ?? 0;
              const block = blocks[idx];
              if (block?.type === 'tool_use') {
                let parsedInput: any = {};
                try { parsedInput = JSON.parse(block.inputJson || '{}'); } catch { parsedInput = {}; }
                toolCalls.push({
                  id:   block.id || `call_${Date.now()}`,
                  type: 'function',
                  function: {
                    name:      block.name || '',
                    arguments: JSON.stringify(parsedInput),
                  },
                });
              }
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const message: ChatMessage = {
      role:       'assistant',
      content:    textContent || null,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };
    return {
      message,
      thinking: thinking || undefined,
      usage: this.mergeStreamingUsage(inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens),
    };
  }

  private mergeStreamingUsage(inputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number): ModelUsage | undefined {
    const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
    if (!totalTokens) return undefined;
    return {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens,
      source: 'provider',
    };
  }

  // ─── Parse Anthropic response → ChatResult ──────────────────────────────────

  private parseResponse(data: any): ChatResult {
    let textContent = '';
    let thinking = '';
    const toolCalls: any[] = [];

    for (const block of (data.content || [])) {
      if (block.type === 'text') {
        textContent += block.text || '';
      } else if (block.type === 'thinking') {
        thinking += block.thinking || '';
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id:   block.id,
          type: 'function',
          function: {
            name:      block.name,
            arguments: JSON.stringify(block.input || {}),
          },
        });
      }
    }

    const message: ChatMessage = {
      role:       'assistant',
      content:    textContent || null,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };

    return { message, thinking: thinking || undefined, usage: this.parseUsage(data.usage) };
  }

  // ─── Generate (single prompt) ────────────────────────────────────────────────

  async generate(prompt: string, model: string, options?: GenerateOptions): Promise<GenerateResult> {
    const messages: ChatMessage[] = [];
    if (options?.system) messages.push({ role: 'system', content: options.system });
    messages.push({ role: 'user', content: prompt });

    const result = await this.chat(messages, model, {
      max_tokens: options?.max_tokens,
      think:      options?.think,
    });

    return {
      response: contentToString(result.message.content),
      thinking: result.thinking,
    };
  }

  // ─── List Models ─────────────────────────────────────────────────────────────

  async listModels(): Promise<ModelInfo[]> {
    // Anthropic doesn't have a public model listing endpoint for OAuth tokens.
    // Return the known set.
    const models = this.directConfig?.staticModels?.length ? this.directConfig.staticModels : ANTHROPIC_MODELS;
    return models.map(name => ({ name }));
  }

  // ─── Test Connection ─────────────────────────────────────────────────────────

  async testConnection(): Promise<boolean> {
    try {
      if (!this.directConfig) {
        getValidToken(this.configDir!);
      }
      const headers = this.buildHeaders('claude-haiku-4-5-20251001', false);
      const response = await fetch(this.getMessagesEndpoint(), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model:      this.directConfig?.staticModels?.[0] || 'claude-haiku-4-5-20251001',
          max_tokens: 10,
          messages:   [{ role: 'user', content: 'hi' }],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
