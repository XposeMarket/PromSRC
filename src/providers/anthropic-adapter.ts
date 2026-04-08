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
  GenerateOptions, GenerateResult, ModelInfo,
} from './LLMProvider';
import {
  buildAuthHeaders, getValidToken, loadTokens,
  ANTHROPIC_API_BASE,
} from '../auth/anthropic-oauth';
import { contentToString } from './content-utils';
import { getConfig } from '../config/config';

const MESSAGES_ENDPOINT = `${ANTHROPIC_API_BASE}/v1/messages`;

// Models available via Anthropic
export const ANTHROPIC_MODELS = [
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5-20250514',
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-20250514',
];

export class AnthropicAdapter implements LLMProvider {
  readonly id = 'anthropic' as const;
  private configDir: string;

  constructor(configDir: string) {
    this.configDir = configDir;
  }

  // ─── Convert Prometheus ChatMessage[] → Anthropic messages format ────────────

  private buildMessages(messages: ChatMessage[], omitIntradayNotes?: boolean): { system: string; messages: any[] } {
    let systemPrompt = '';
    const anthropicMessages: any[] = [];
    const pendingToolUseIds: string[] = [];
    const knownToolUseIds = new Set<string>();
    const consumedToolUseIds = new Set<string>();
    let fallbackSeq = 0;
    const nextFallbackToolUseId = () => `autocall_${Date.now()}_${++fallbackSeq}`;

    // Pending tool_result blocks for batching — Anthropic requires all tool results
    // from a single assistant turn to be in ONE user message (not separate messages).
    let pendingToolResults: any[] = [];

    const flushToolResults = () => {
      if (pendingToolResults.length === 0) return;
      anthropicMessages.push({ role: 'user', content: [...pendingToolResults] });
      pendingToolResults = [];
    };

    for (const m of messages) {
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
          let parsedInput: any = {};
          try {
            parsedInput = JSON.parse(tc.function.arguments || '{}');
          } catch {
            parsedInput = {};
          }

          const explicitId = String(tc?.id || '').trim();
          const callId = explicitId || nextFallbackToolUseId();
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
        const toolContent = typeof m.content === 'string' ? m.content.trim() : '';
        if (!toolContent) continue;  // Skip empty tool results

        const explicitToolCallId = String(m.tool_call_id || '').trim();
        let resolvedToolUseId = '';

        if (explicitToolCallId && knownToolUseIds.has(explicitToolCallId)) {
          // Use explicit ID if it matches a known tool_use
          resolvedToolUseId = explicitToolCallId;
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
          pendingToolResults.push({
            type: 'tool_result',
            tool_use_id: resolvedToolUseId,
            content: toolContent,
          });
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
    const headers = buildAuthHeaders(this.configDir);
    const isThinkingGeneration = /claude-(sonnet|opus)-4-6/.test(model);
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

  async chat(messages: ChatMessage[], model: string, options?: ChatOptions): Promise<ChatResult> {
    const raw = getConfig().getConfig() as any;
    const anthropicCfg = raw.llm?.providers?.anthropic || {};
    const extendedThinkingEnabled = options?.think !== false && anthropicCfg.extended_thinking === true;

    const headers = this.buildHeaders(model, extendedThinkingEnabled);
    const { system, messages: anthropicMessages } = this.buildMessages(messages, options?.omitIntradayNotes);

    const body: any = {
      model,
      max_tokens: options?.max_tokens || 8192,
      messages:   anthropicMessages,
    };

    const tools = this.buildTools(options?.tools);
    if (tools) body.tools = tools;

    // Trim system prompt to stay within the 200k token limit.
    // We compute the budget against the body-without-system so trimming is accurate.
    if (system) {
      const bodyWithoutSystem = JSON.stringify({ ...body, system: undefined });
      body.system = this.trimSystemForBudget(system, bodyWithoutSystem);
    }

    // Extended thinking: enabled via config setting, suppressed for automation turns (think === false)
    if (extendedThinkingEnabled) {
      const budget = typeof anthropicCfg.thinking_budget === 'number' ? anthropicCfg.thinking_budget : 10000;
      body.thinking = { type: 'enabled', budget_tokens: budget };
      body.max_tokens = Math.max(body.max_tokens, budget + 8192);
    }

    // If onToken callback provided, use streaming mode
    if (options?.onToken) {
      body.stream = true;
      const response = await fetch(MESSAGES_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Anthropic API error ${response.status}: ${text.slice(0, 500)}`);
      }
      return this.parseStreamingResponse(response, options.onToken);
    }

    const response = await fetch(MESSAGES_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Anthropic API error ${response.status}: ${text.slice(0, 500)}`);
    }

    const data = await response.json() as any;
    return this.parseResponse(data);
  }

  // ─── Parse Anthropic streaming SSE response ──────────────────────────────────

  private async parseStreamingResponse(response: Response, onToken: (chunk: string) => void): Promise<ChatResult> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body from Anthropic streaming endpoint');

    const decoder = new TextDecoder();
    let buffer = '';
    let textContent = '';
    let thinking = '';
    const toolCalls: any[] = [];
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
                thinking += delta.thinking || '';
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
    return { message, thinking: thinking || undefined };
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

    return { message, thinking: thinking || undefined };
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
    return ANTHROPIC_MODELS.map(name => ({ name }));
  }

  // ─── Test Connection ─────────────────────────────────────────────────────────

  async testConnection(): Promise<boolean> {
    try {
      getValidToken(this.configDir);
      // Optionally do a lightweight API call to verify the token works
      const headers = buildAuthHeaders(this.configDir);
      const response = await fetch(MESSAGES_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model:      'claude-haiku-4-5-20251001',
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
