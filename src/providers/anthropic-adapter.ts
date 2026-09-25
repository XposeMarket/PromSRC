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

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { classifyToolFromManifest } from '../runtime/tool-category-manifest';

/** Context window used for the system-prompt budget (mirrors model-context known table). */
export function anthropicContextWindowTokens(model: string): number {
  return /^(claude-fable-5|claude-opus-(?:5|4-(?:6|7|8))|claude-sonnet-(?:5|4-6))(?:\b|[-_])/i.test(String(model || ''))
    ? 1_000_000
    : 200_000;
}

/**
 * Anthropic's rejection when a setup-token request is billed to extra usage
 * and extra usage is disabled/exhausted. Matched on the message text because
 * it arrives as a generic 400 invalid_request_error.
 */
/**
 * Categories the gateway already exposed this turn, read from the
 * [ACTIVE_TOOL_CATEGORIES] line of the system prompt. Session- and
 * planner-activated categories never go through request_tool_category, so the
 * retry must read them from here or it drops them while the prompt still says
 * they are active (2026-09-25 turn dd89c525: 130 tools built, retry sent core only).
 */
export function activeCategoriesFromSystem(system: unknown): Set<string> {
  const out = new Set<string>();
  const text = Array.isArray(system)
    ? system.map((block: any) => String(block?.text || '')).join('\n')
    : String(system || '');
  const re = /\[ACTIVE_TOOL_CATEGORIES\][^:\n]*:\s*([^\n.]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    for (const raw of match[1].split(',')) {
      const category = raw.trim();
      if (/^[a-z_]+$/.test(category)) out.add(category);
    }
  }
  return out;
}

/**
 * Direct tools that a wrapper already covers. On a slim retry the wrapper
 * stays and the direct duplicates go (x_api_* -> x_* wrappers, ~50 tools;
 * connector_vercel_* -> vercel_ops, ~21 tools).
 */
const WRAPPER_COVERED_DIRECT_TOOLS: Array<{ wrapper: string; direct: RegExp }> = [
  { wrapper: 'x_posts', direct: /^x_api_/ },
  { wrapper: 'vercel_ops', direct: /^connector_vercel_/ },
];

export const SLIM_RETRY_NOTICE_MARKER = '[TOOL_SURFACE_NOTICE]';

export interface SlimRetryResult {
  tools: any[];
  /** Categories whose tools were dropped even though they were not wrapper duplicates. */
  droppedCategories: string[];
  droppedDirectDuplicates: number;
}

/**
 * Tools to keep on an extra-usage retry: core, every tool already called,
 * every tool in a category the model unlocked or the gateway reports active,
 * minus direct tools that a wrapper covers. Returns null when slimming would
 * not shrink the list (then the retry reuses the same body).
 */
export function slimToolsForExtraUsageRetryDetailed(
  tools: any[] | undefined,
  messages: any[] | undefined,
  system?: unknown,
  mode: 'active' | 'minimal' = 'active',
): SlimRetryResult | null {
  if (!Array.isArray(tools) || tools.length < 60) return null;
  const CORE = new Set([
    'web_search', 'web_fetch', 'memory', 'write_note', 'delivery_send', 'switch_model', 'set_current_model',
    'ask_prometheus_questions', 'request_tool_category', 'skill_list', 'skill_read', 'background_ops',
    'declare_plan', 'complete_plan_step', 'tool_result_read', 'show_ui_card', 'timer', 'read_file', 'search_files',
  ]);
  const used = new Set<string>();
  // Categories the model explicitly unlocked with request_tool_category, plus
  // those the gateway reports as already active in the system prompt.
  // 'minimal' is the second-retry fallback: gateway-active categories are not
  // kept, only explicit unlocks (the pre-2026-09-25 behavior).
  const keptCategories = mode === 'active' ? activeCategoriesFromSystem(system) : new Set<string>();
  for (const m of messages || []) {
    if (!Array.isArray(m?.content)) continue;
    for (const part of m.content) {
      if (part?.type !== 'tool_use' || !part.name) continue;
      used.add(String(part.name));
      if (part.name === 'request_tool_category') {
        const category = String(part.input?.category || '').trim();
        if (category) keptCategories.add(category);
      }
    }
  }
  const categoryOf = (name: string): string | null => {
    try { return classifyToolFromManifest(name) || null; } catch { return null; }
  };
  const present = new Set(tools.map((t) => String(t?.name || '')));
  const isWrapperDuplicate = (name: string): boolean =>
    WRAPPER_COVERED_DIRECT_TOOLS.some((rule) => present.has(rule.wrapper) && rule.direct.test(name));

  const kept: any[] = [];
  const dropped = new Set<string>();
  let droppedDirectDuplicates = 0;
  for (const t of tools) {
    const name = String(t?.name || '');
    const category = categoryOf(name);
    const keep = CORE.has(name) || used.has(name)
      // Uncategorized tools are the always-on surface (e.g. request_browser_login).
      || (mode === 'active' && !category)
      || (!!category && keptCategories.has(category) && !isWrapperDuplicate(name));
    if (keep) {
      const { cache_control, ...rest } = t;
      kept.push(rest);
    } else if (isWrapperDuplicate(name)) {
      droppedDirectDuplicates += 1;
    } else if (category) {
      dropped.add(category);
    }
  }
  if (kept.length >= tools.length - 5) return null;
  if (kept.length) (kept[kept.length - 1] as any).cache_control = { type: 'ephemeral' };
  return { tools: kept, droppedCategories: Array.from(dropped).sort(), droppedDirectDuplicates };
}

export function slimToolsForExtraUsageRetry(
  tools: any[] | undefined,
  messages: any[] | undefined,
  system?: unknown,
  mode: 'active' | 'minimal' = 'active',
): any[] | null {
  return slimToolsForExtraUsageRetryDetailed(tools, messages, system, mode)?.tools || null;
}

/** One-line notice so the model knows the retry changed its tool surface. */
export function buildSlimRetryNotice(result: SlimRetryResult): string {
  const parts: string[] = [];
  if (result.droppedDirectDuplicates > 0) {
    parts.push('direct x_api_*/connector_vercel_* tools were omitted; use the x_posts/x_users/x_lists/x_dm/x_admin/x_search_ops and vercel_ops wrappers');
  }
  if (result.droppedCategories.length > 0) {
    parts.push(`tools from these categories were omitted: ${result.droppedCategories.join(', ')}. They are NOT callable this request even if listed as active; call request_tool_category to reload one`);
  }
  if (!parts.length) return '';
  return `${SLIM_RETRY_NOTICE_MARKER} The provider rejected the full tool list, so this request was retried with a smaller one: ${parts.join('; ')}.`;
}


export function isOutOfExtraUsageError(raw: unknown): boolean {
  return /out of extra usage/i.test(String(raw || ''));
}
import { join } from 'node:path';
import type {
  LLMProvider, ChatMessage, ContentPart, ChatOptions, ChatResult,
  GenerateOptions, GenerateResult, ModelInfo, ModelUsage, ToolCall,
} from './LLMProvider';
import { PROMPT_CACHE_MARKER } from './LLMProvider';
import {
  buildAuthHeaders, loadTokens,
  ANTHROPIC_API_BASE,
  invalidateClaudeCliVersionCache, isClaudeCodeVersionTooOldError,
} from '../auth/anthropic-oauth';
import type { AnthropicTokens } from '../auth/anthropic-oauth';
import { contentToString, splitOnCacheMarker } from './content-utils';
import { getConfig } from '../config/config';
import { getReasoningCapability, normalizeReasoningEffort, normalizeSpeed, supportsFastSpeed } from './reasoning-capabilities';
import { recordAnthropicRateLimitHeaders } from './usage-awareness';

// Anthropic ignores cache breakpoints on segments below the minimum cacheable
// size, but to avoid emitting pointless cache writes we only mark the system
// prefix when it is comfortably large. ~1024 tokens ≈ 3500 chars at 3.5 ch/tok.
const ANTHROPIC_MIN_CACHE_CHARS = 3500;

// Models available via Anthropic
export const ANTHROPIC_MODELS = [
  'claude-fable-5-1',
  'claude-fable-5',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-5',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5-20250929',
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
  private accountId?: string;
  private directConfig?: AnthropicDirectConfig;

  constructor(config: string | (AnthropicDirectConfig & { accountId?: string }) | { configDir: string; accountId?: string }) {
    if (typeof config === 'string') {
      this.id = 'anthropic';
      this.configDir = config;
      return;
    }
    if ('configDir' in config) {
      this.id = 'anthropic';
      this.configDir = config.configDir;
      this.accountId = String(config.accountId || '').trim() || undefined;
      return;
    }
    this.id = config.providerId;
    this.directConfig = config;
    this.accountId = String(config.accountId || '').trim() || undefined;
  }

  private isAdaptiveThinkingCapableModel(model: string): boolean {
    return /^claude-fable-5(?:\b|[-_])/.test(model)
      || /^claude-opus-5(?:\b|[-_])/.test(model)
      || /^claude-opus-4-(6|7|8)(?:\b|[-_])/.test(model)
      || /^claude-sonnet-5(?:\b|[-_])/.test(model)
      || /^claude-sonnet-4-6(?:\b|[-_])/.test(model);
  }

  private supportsXHighEffort(model: string): boolean {
    return /^claude-fable-5(?:\b|[-_])/.test(model)
      || /^claude-opus-5(?:\b|[-_])/.test(model)
      || /^claude-opus-4-(7|8)(?:\b|[-_])/.test(model)
      || /^claude-sonnet-5(?:\b|[-_])/.test(model);
  }

  // Claude Fast Mode (Messages API `speed: 'fast'`) — faster output on the same
  // model, no intelligence downgrade. Supported on Opus 5 and Opus 4.8 only
  // (it was removed on Opus 4.7); sending it elsewhere errors, so gate strictly.
  private isFastModeCapableModel(model: string): boolean {
    return supportsFastSpeed('anthropic', model);
  }

  private supportsEffort(model: string): boolean {
    return /^claude-fable-5(?:\b|[-_])/.test(model)
      || /^claude-opus-5(?:\b|[-_])/.test(model)
      || /^claude-opus-4-(5|6|7|8)(?:\b|[-_])/.test(model)
      || /^claude-sonnet-5(?:\b|[-_])/.test(model)
      || /^claude-sonnet-4-6(?:\b|[-_])/.test(model)
      || /^claude-mythos-preview(?:\b|[-_])/.test(model);
  }

  private normalizeEffort(value: unknown, model: string): 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined {
    return normalizeReasoningEffort('anthropic', model, value) as 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined;
  }

  private getKnownModelInfo(name: string): Partial<ModelInfo> {
    if (/^(claude-fable-5|claude-opus-(?:5|4-(?:6|7|8))|claude-sonnet-(?:5|4-6))(?:\b|[-_])/.test(name)) {
      return {
        contextWindowTokens: 1_000_000,
        maxOutputTokens: 128_000,
        tokenizer: 'anthropic',
        supportsReasoningTokens: true,
      };
    }
    if (/^claude-haiku-4-5(?:\b|[-_])/.test(name)) {
      return {
        contextWindowTokens: 200_000,
        maxOutputTokens: 64_000,
        tokenizer: 'anthropic',
        supportsReasoningTokens: true,
      };
    }
    return {};
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

    // Runtime acknowledgements and orphan tool notes can leave an assistant
    // tail after a steer. This adapter never intentionally requests prefill.
    // Preserve that history, but end the request with a user continuation.
    if (anthropicMessages.at(-1)?.role === 'assistant') {
      anthropicMessages.push({
        role: 'user',
        content: 'Continue the active user request from the completed results above.',
      });
    }

    // Prompt-cache breakpoint #3 (rolling history): tag the last content block of
    // the final message. Anthropic caches the longest matching prefix, so each new
    // turn reads the prior conversation from cache and only the newest delta is
    // billed at full input rate. Convert string content to a block so the marker
    // can attach; this is shape-equivalent for the API.
    const lastMsg = anthropicMessages[anthropicMessages.length - 1];
    if (lastMsg) {
      if (Array.isArray(lastMsg.content) && lastMsg.content.length > 0) {
        const lastBlock = lastMsg.content[lastMsg.content.length - 1];
        if (lastBlock && typeof lastBlock === 'object') lastBlock.cache_control = { type: 'ephemeral' };
      } else if (typeof lastMsg.content === 'string' && lastMsg.content.trim()) {
        lastMsg.content = [{ type: 'text', text: lastMsg.content, cache_control: { type: 'ephemeral' } }];
      }
    }

    // Strip [TODAY_NOTES...] block from system prompt when requested (e.g. after switch_model)
    if (omitIntradayNotes && systemPrompt.includes('[TODAY_NOTES')) {
      systemPrompt = systemPrompt.replace(/\[TODAY_NOTES[^\]]*\][\s\S]*?(?=\n\n\[|\n\n##|\s*$)/g, '').trim();
    }

    return { system: systemPrompt, messages: anthropicMessages };
  }


  // ─── Convert Anthropic tools format ──────────────────────────────────────────

  private buildTools(tools?: any[]): any[] | undefined {
    if (!tools?.length) return undefined;
    const mapped = tools.map((t: any) => ({
      name:         t.function?.name || t.name,
      description:  t.function?.description || t.description || '',
      input_schema: t.function?.parameters || t.parameters || { type: 'object', properties: {} },
    }));
    // Prompt-cache breakpoint #1: tools are the largest stable payload (hundreds
    // of schemas). Tagging the LAST tool caches the entire tools array as a
    // prefix segment. When a category is activated mid-session the tool list
    // changes and this re-caches once — expected, then re-stabilizes.
    if (mapped.length > 0) {
      (mapped[mapped.length - 1] as any).cache_control = { type: 'ephemeral' };
    }
    return mapped;
  }

  // ─── Chat ───────────────────────────────────────────────────────────────────

  // Trim system prompt progressively to fit within Anthropic's 200k token limit.
  // Anthropic counts system + messages + tools together.
  // Use 3.5 chars/token (code-heavy content tokenizes denser than plain text).
  // Target 180k tokens to leave a 20k headroom for response + overhead.
  // Strips in order: TODAY_NOTES → tools policy blocks → USER section → SOUL truncation.
  private trimSystemForBudget(system: string, bodyWithoutSystem: string, model = ''): string {
    // The budget used to be a flat 180k tokens for every model. Opus 5.x /
    // Sonnet 4.6+ have a 1M window, so once a chat passed ~180k tokens the
    // budget went negative and the ENTIRE system prompt was dropped (logged
    // systemChars=57): no memory, notes, or restart-recovery context.
    const SAFE_TOKEN_BUDGET = Math.floor(anthropicContextWindowTokens(model) * 0.9);
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
    // Never lose the restart/continuation context: it is the only thing that
    // tells a resumed turn what it already did. Re-attach it after truncation.
    const protectedBlocks = (s.match(/\[(GATEWAY RESTART RECOVERY|HOT RESTART CONTEXT)\][\s\S]*?\[\/\1\]/g) || []).join('\n\n');
    if (s.length > Math.max(0, budget())) {
      const limit = budget() - protectedBlocks.length;
      if (protectedBlocks) {
        const rest = s.replace(/\[(GATEWAY RESTART RECOVERY|HOT RESTART CONTEXT)\][\s\S]*?\[\/\1\]/g, '').trim();
        return (limit > 0 ? rest.slice(0, limit) + '\n[... system prompt truncated for context budget ...]\n\n' : '') + protectedBlocks;
      }
      s = limit <= 0
        ? ''
        : s.slice(0, limit) + '\n[... system prompt truncated for Anthropic 200k context limit ...]';
    }

    return s;
  }

  // Build the Anthropic `system` block array from a (already budget-trimmed)
  // system string. Splits on the cache marker so the STABLE prefix
  // (persona/memory/tool-policy) is cached while the VOLATILE tail
  // (today's notes, retrieved memory, skill turn-context) stays uncached.
  // For OAuth the Claude Code preamble MUST remain the first block (subscription
  // gate) — caching attaches to the stable block that follows it.
  private buildSystemBlocks(systemText: string, includePreamble: boolean): any[] {
    const preamble = { type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." };
    const blocks: any[] = [];
    if (includePreamble) blocks.push(preamble);

    const { stable, volatile } = splitOnCacheMarker(systemText);
    const stableTrimmed = stable.trim();
    const volatileTrimmed = volatile.trim();

    if (stableTrimmed) {
      const block: any = { type: 'text', text: stableTrimmed };
      // Prompt-cache breakpoint #2: stable system prefix.
      if (stableTrimmed.length >= ANTHROPIC_MIN_CACHE_CHARS) {
        block.cache_control = { type: 'ephemeral' };
      }
      blocks.push(block);
    }
    if (volatileTrimmed) blocks.push({ type: 'text', text: volatileTrimmed });
    return blocks;
  }

  // Only add interleaved-thinking beta when extended thinking is actually enabled.
  // Adding it unconditionally causes 429s on OAuth tokens.
  private buildHeaders(model: string, extendedThinkingEnabled = false, fastSpeed = false, tokens?: AnthropicTokens | null): Record<string, string> {
    const headers = this.directConfig
      ? this.buildDirectHeaders()
      : buildAuthHeaders(this.configDir!, this.accountId, tokens);
    const isThinkingGeneration = /claude-(sonnet|opus)-4-(6|7|8)/.test(model);
    if (isThinkingGeneration && extendedThinkingEnabled) {
      const existing = headers['anthropic-beta'];
      if (existing && !existing.includes('interleaved-thinking')) {
        headers['anthropic-beta'] = `${existing},interleaved-thinking-2025-05-14`;
      } else if (!existing) {
        headers['anthropic-beta'] = 'interleaved-thinking-2025-05-14';
      }
    }
    if (fastSpeed) {
      const existing = headers['anthropic-beta'];
      if (!existing?.includes('fast-mode-2026-02-01')) {
        headers['anthropic-beta'] = existing ? `${existing},fast-mode-2026-02-01` : 'fast-mode-2026-02-01';
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
    const configuredEffort = this.normalizeEffort((anthropicCfg as any).reasoning_effort, model);
    const requestedEffort = this.normalizeEffort(options?.think, model);
    const effort = requestedEffort || configuredEffort;
    const extendedThinkingEnabled = options?.think !== false
      && options?.think !== 'none'
      && (anthropicCfg.extended_thinking === true || !!options?.think);

    const fastSpeed = normalizeSpeed('anthropic', model, options?.speed || anthropicCfg.speed || (anthropicCfg.fast_mode === true ? 'fast' : 'standard')) === 'fast';
    const vaultTokens = !this.directConfig && this.configDir
      ? loadTokens(this.configDir, this.accountId)
      : null;
    const headers = this.buildHeaders(model, extendedThinkingEnabled, fastSpeed, vaultTokens);
    const { system, messages: anthropicMessages } = this.buildMessages(messages, options?.omitIntradayNotes);

    const body: any = {
      model,
      max_tokens: options?.max_tokens || 8192,
      messages:   anthropicMessages,
    };

    const tools = this.buildTools(options?.tools);
    if (tools) body.tools = tools;

    // Keep the Claude Code identity block first for setup-token requests,
    // including calls with an otherwise empty system prompt. A provider-side
    // usage rejection still needs its own diagnosis; this block does not prove
    // which account or usage pool Anthropic applied.
    const isOAuth = !this.directConfig && !!headers['Authorization'];
    const claudeCodePreamble = { type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." };

    if (system) {
      // Base64 image payloads are not tokens at 3.5 chars/token: a 1.8MB body
      // that was mostly screenshots drove the budget negative and stripped the
      // ENTIRE system prompt (logged 2026-09-23/24 as systemChars=57). Count
      // each image at a flat ~1,600 tokens instead of its base64 length.
      let imageCount = 0;
      const bodyWithoutSystem = JSON.stringify({ ...body, system: undefined }, (key, value) => {
        if (key === 'data' && typeof value === 'string' && value.length > 1000) { imageCount += 1; return ''; }
        return value;
      }) + ' '.repeat(Math.min(imageCount * 5_600, 400_000));
      const trimmed = this.trimSystemForBudget(system, bodyWithoutSystem, model);
      if (trimmed.length < system.length) {
        console.warn(`[anthropic] system prompt trimmed ${system.length} -> ${trimmed.length} chars for ${model} (body ${bodyWithoutSystem.length} chars)`);
      }
      const blocks = this.buildSystemBlocks(trimmed, !!isOAuth);
      if (blocks.length > 0) {
        body.system = blocks;
      } else if (isOAuth) {
        body.system = [claudeCodePreamble];
      }
    } else if (isOAuth) {
      body.system = [claudeCodePreamble];
    }
    if (isOAuth && body.system?.[0]?.text !== claudeCodePreamble.text) {
      throw new Error('Claude setup-token request is missing its first system block.');
    }

    // `output_config.effort` only goes to models that accept it natively
    // (nativeEffort). Manual-thinking-only models (Sonnet 4.5, Haiku 4.5,
    // Opus 4.0/4.1) reject it, so their effort becomes a thinking budget
    // below. Opus 4.5 is manual-thinking AND effort-native, so it gets both.
    const capability = getReasoningCapability('anthropic', model);
    const manualThinking = capability.thinkingMode === 'manual';
    const effortNative = capability.nativeEffort === true;
    if (effort && effortNative) {
      body.output_config = { ...(body.output_config || {}), effort };
    }

    // Claude Fast Mode: faster output on the same Opus model. Gated to capable
    // models so it never 400s on Sonnet/Haiku or older Opus.
    if (fastSpeed) {
      body.speed = 'fast';
    }

    // Thinking: enabled via config setting, suppressed for automation turns (think === false).
    // Claude Opus 4.7+ rejects manual budgets; Claude Opus/Sonnet 4.6 support
    // adaptive thinking and deprecate manual budgets, so prefer adaptive there too.
    if (extendedThinkingEnabled) {
      if (capability.thinkingMode === 'adaptive') {
        body.thinking = { type: 'adaptive', display: 'summarized' };
      } else {
        const MANUAL_EFFORT_BUDGETS: Record<string, number> = { low: 4000, medium: 10000, high: 24000 };
        const budget = typeof anthropicCfg.thinking_budget === 'number'
          ? anthropicCfg.thinking_budget
          : (manualThinking && !effortNative && effort && MANUAL_EFFORT_BUDGETS[effort]) || 10000;
        body.thinking = { type: 'enabled', budget_tokens: budget };
        body.max_tokens = Math.max(body.max_tokens, budget + 8192);
      }
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

    const collectRateLimitHeaders = (response: Response): Record<string, string> => {
      const out: Record<string, string> = {};
      try {
        response.headers.forEach((value, key) => {
          const k = key.toLowerCase();
          if (k.startsWith('anthropic-ratelimit') || k === 'retry-after' || k === 'x-should-retry') {
            out[k] = String(value).slice(0, 200);
          }
        });
      } catch { /* headers are optional diagnostics */ }
      return out;
    };

    const requestShape = () => ({
      speed: body.speed || 'standard',
      effort: body.output_config?.effort || null,
      anthropicBeta: String((headers as any)['anthropic-beta'] || '').slice(0, 300),
      model,
      accountId: this.accountId || null,
      authMode: isOAuth ? 'setup_token' : (headers['x-api-key'] ? 'api_key' : 'other'),
      firstSystemIsPreamble: body.system?.[0]?.text === claudeCodePreamble.text,
      systemBlocks: Array.isArray(body.system) ? body.system.length : 0,
      systemChars: Array.isArray(body.system) ? body.system.reduce((sum: number, block: any) => sum + String(block?.text || '').length, 0) : 0,
      messageCount: body.messages.length,
      // Count what is actually sent: an extra-usage retry replaces body.tools,
      // and logging the pre-slim list hid that (2026-09-25 logged 130, sent ~20).
      toolCount: Array.isArray(body.tools) ? body.tools.length : 0,
      builtToolCount: tools?.length || 0,
      requestBytes: Buffer.byteLength(JSON.stringify(body)),
    });

    // Successful setup-token requests are logged too (headers + request shape),
    // so a request Anthropic billed to extra usage can be diffed against the
    // ones it billed to the plan. Rotated at 4 MB to stay bounded.
    const logSuccess = (response: Response, attempt: number) => {
      if (!isOAuth) return;
      // Feed plan-usage awareness from headers we already receive (no extra
      // request). Never allowed to affect provider handling.
      try { recordAnthropicRateLimitHeaders(collectRateLimitHeaders(response)); } catch { /* best-effort */ }
      if (!this.configDir) return;
      try {
        const logDir = join(this.configDir, 'logs');
        mkdirSync(logDir, { recursive: true });
        const file = join(logDir, 'anthropic-request-ok.ndjson');
        try {
          if (existsSync(file) && statSync(file).size > 4 * 1024 * 1024) renameSync(file, `${file}.1`);
        } catch { /* rotation is best-effort */ }
        appendFileSync(file, JSON.stringify({
          at: new Date().toISOString(),
          status: response.status,
          attempt,
          requestId: String(response.headers.get('request-id') || '').slice(0, 100),
          rateLimitHeaders: collectRateLimitHeaders(response),
          ...requestShape(),
        }) + '\n', 'utf8');
      } catch { /* Diagnostics must never change provider handling. */ }
    };

    const rejectRequest = async (response: Response, raw: string, attempt: number): Promise<never> => {
      try {
        const payload = JSON.parse(raw);
        if (this.configDir) {
          const logDir = join(this.configDir, 'logs');
          mkdirSync(logDir, { recursive: true });
          appendFileSync(join(logDir, 'anthropic-request-errors.ndjson'), JSON.stringify({
            at: new Date().toISOString(),
            status: response.status,
            attempt,
            requestId: String(payload?.request_id || response.headers.get('request-id') || '').slice(0, 100),
            errorType: String(payload?.error?.type || '').slice(0, 100),
            // The message distinguishes "out of extra usage" from a version gate
            // or a plain rate limit; errorType alone collapses them all to 400/429.
            message: String(payload?.error?.message || '').slice(0, 300),
            // Anthropic's unified rate-limit headers name the limit/pool the
            // request was charged against (5h, weekly, per-model, overage).
            rateLimitHeaders: collectRateLimitHeaders(response),
            ...requestShape(),
          }) + '\n', 'utf8');
        }
      } catch { /* Diagnostics must never change provider handling. */ }
      if (isClaudeCodeVersionTooOldError(raw)) {
        // The locally installed Claude Code CLI may have been updated since the
        // version was detected. Drop the cache so the next request re-detects
        // it instead of requiring a gateway restart.
        invalidateClaudeCliVersionCache();
        throw new Error(
          `${this.id} API error ${response.status}: the installed Claude Code client is too old for ${model}. `
          + `Run \`claude update\` (the next request re-detects the version automatically; no restart needed). `
          + `Provider said: ${raw.slice(0, 300)}`,
        );
      }
      throw new Error(`${this.id} API error ${response.status}: ${raw.slice(0, 500)}`);
    };

    // Anthropic intermittently bills a single setup-token request to extra
    // usage ("out of extra usage") while identical requests seconds later are
    // billed to the plan (observed 2026-09-23: failure at 17:05:26, same thread
    // succeeded at 17:05:58 and for 12 requests after). Nothing has been sent
    // to the caller before the status check, so one delayed retry is safe for
    // both streaming and non-streaming calls.
    const EXTRA_USAGE_RETRY_DELAY_MS = 4_000;
    const send = async (): Promise<Response> => {
      for (let attempt = 1; ; attempt += 1) {
        const response = await fetch(this.getMessagesEndpoint(), {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: options?.abortSignal
            ? AbortSignal.any([options.abortSignal, AbortSignal.timeout(180_000)])
            : AbortSignal.timeout(180_000),
        });
        if (response.ok) {
          logSuccess(response, attempt);
          return response;
        }
        const raw = await response.text().catch(() => '');
        // Attempt 1 rejected -> retry keeping every active category (minus
        // wrapper-covered duplicates). Attempt 2 rejected too -> last retry
        // with the minimal core surface. Either way the model is told which
        // tools were omitted, so "active" in the prompt never lies silently.
        if (attempt <= 2 && isOAuth && isOutOfExtraUsageError(raw) && !options?.abortSignal?.aborted) {
          try {
            await rejectRequest(response, raw, attempt);
          } catch { /* logged; retrying */ }
          // Every logged rejection (70/70, 2026-09-23..25) carried 123-150
          // tool schemas; requests that succeeded right after carried far
          // fewer. Retry with a slimmer tool list instead of the same body.
          const originalTools = Array.isArray(tools) ? tools : body.tools;
          const result = slimToolsForExtraUsageRetryDetailed(
            originalTools,
            body.messages,
            body.system,
            attempt === 1 ? 'active' : 'minimal',
          );
          if (result) {
            console.warn(`[anthropic] ${model}: retry ${attempt + 1} after extra-usage rejection with ${result.tools.length}/${originalTools.length} tools (dropped categories: ${result.droppedCategories.join(', ') || 'none'}; wrapper duplicates: ${result.droppedDirectDuplicates})`);
            body.tools = result.tools;
            const notice = buildSlimRetryNotice(result);
            if (Array.isArray(body.system)) {
              body.system = body.system.filter((block: any) => !String(block?.text || '').startsWith(SLIM_RETRY_NOTICE_MARKER));
              if (notice) body.system.push({ type: 'text', text: notice });
            }
          } else if (attempt === 2) {
            // Nothing left to slim; a third identical request would fail the same way.
            return rejectRequest(response, raw, attempt);
          }
          console.warn(`[anthropic] ${model}: request billed to extra usage (rejected); retrying in ${EXTRA_USAGE_RETRY_DELAY_MS}ms`);
          await new Promise((resolve) => setTimeout(resolve, EXTRA_USAGE_RETRY_DELAY_MS));
          if (options?.abortSignal?.aborted) return rejectRequest(response, raw, attempt);
          continue;
        }
        return rejectRequest(response, raw, attempt);
      }
    };

    // If onToken callback provided, use streaming mode
    if (options?.onToken) {
      body.stream = true;
      const response = await send();
      return this.parseStreamingResponse(response, model, options);
    }

    const response = await send();


    const data = await response.json() as any;
    return this.parseResponse(data);
  }

  // ─── Parse Anthropic streaming SSE response ──────────────────────────────────

  private async parseStreamingResponse(response: Response, model: string, options: ChatOptions): Promise<ChatResult> {
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
    let stopReason: unknown;
    let stopDetails: any;
    let messageStopped = false;
    let invalidToolInput = false;
    // Track per-block accumulation: blockIndex → { type, id, name, inputJson }
    const blocks: Record<number, any> = {};

    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer += done ? decoder.decode() + '\n' : decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;
          let event: any;
          try { event = JSON.parse(data); } catch { continue; }
            const type = event.type as string;

            if (type === 'error') {
              throw new Error(`${this.id} stream error: ${String(event.error?.type || 'unknown')}: ${String(event.error?.message || 'Provider stream failed').slice(0, 500)}`);
            }
            if (type === 'message_stop') messageStopped = true;

            if (type === 'message_start' && event.message?.usage) {
              const usage = event.message.usage;
              inputTokens = Number(usage.input_tokens || inputTokens || 0);
              cacheReadTokens = Number(usage.cache_read_input_tokens || cacheReadTokens || 0);
              cacheWriteTokens = Number(usage.cache_creation_input_tokens || cacheWriteTokens || 0);
            }

            if (type === 'message_delta' && event.delta && 'stop_reason' in event.delta) {
              stopReason = event.delta.stop_reason;
              stopDetails = event.delta.stop_details;
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
                initialInput: block.input,
                stopped: false,
              };
              if (block.type === 'tool_use') {
                options.onModelEvent?.({ type: 'tool_call_start', id: block.id || `tool_${idx}`, name: block.name || '', nativeType: 'content_block_start.tool_use', provider: this.id, model });
              }
            }

            if (type === 'content_block_delta') {
              const idx = event.index ?? 0;
              const delta = event.delta || {};
              if (delta.type === 'text_delta') {
                textContent += delta.text || '';
                options.onToken?.(delta.text || '');
                if (delta.text) options.onModelEvent?.({ type: 'assistant_delta', text: delta.text, nativeType: 'content_block_delta.text_delta', provider: this.id, model });
	              } else if (delta.type === 'thinking_delta') {
	                const thinkDelta = delta.thinking || '';
	                thinking += thinkDelta;
	                if (thinkDelta) {
	                  options.onThinking?.(thinkDelta);
	                  options.onModelEvent?.({ type: 'reasoning_delta', text: thinkDelta, nativeType: 'content_block_delta.thinking_delta', provider: this.id, model });
	                }
	              } else if (delta.type === 'input_json_delta') {
                if (blocks[idx]) {
                  const part = delta.partial_json || '';
                  blocks[idx].inputJson += part;
                  if (part && blocks[idx].type === 'tool_use') {
                    options.onModelEvent?.({ type: 'tool_call_delta', id: blocks[idx].id || `tool_${idx}`, name: blocks[idx].name || '', argumentsDelta: part, nativeType: 'content_block_delta.input_json_delta', provider: this.id, model });
                  }
                }
              }
            }

            if (type === 'content_block_stop') {
              const idx = event.index ?? 0;
              const block = blocks[idx];
              if (block) block.stopped = true;
              if (block?.type === 'tool_use') {
                let parsedInput: any;
                try {
                  parsedInput = block.inputJson ? JSON.parse(block.inputJson) : (block.initialInput || {});
                  if (!parsedInput || typeof parsedInput !== 'object' || Array.isArray(parsedInput)) throw new Error('Invalid tool input');
                } catch {
                  invalidToolInput = true;
                  continue;
                }
                toolCalls.push({
                  id:   block.id || `call_${Date.now()}`,
                  type: 'function',
                  function: {
                    name:      block.name || '',
                    arguments: JSON.stringify(parsedInput),
                  },
                });
                options.onModelEvent?.({
                  type: 'tool_call_done',
                  id: block.id || `call_${Date.now()}`,
                  name: block.name || '',
                  arguments: JSON.stringify(parsedInput),
                  nativeType: 'content_block_stop.tool_use',
                  provider: this.id,
                  model,
                });
              }
            }
        }
        if (done) break;
      }
    } finally {
      reader.releaseLock();
    }

    const refusal = this.refusalText(stopReason, stopDetails);
    if (refusal && !textContent) options.onToken?.(refusal);

    // Never execute a partial batch or fabricate {} for truncated arguments.
    const incomplete = !messageStopped || invalidToolInput
      || Object.values(blocks).some(block => block.type === 'tool_use' && !block.stopped);
    if (incomplete) toolCalls.length = 0;
    const nativeStopReason = typeof stopReason === 'string' ? stopReason : undefined;
    const effectiveStopReason = incomplete && nativeStopReason !== 'max_tokens' && nativeStopReason !== 'refusal'
      ? 'incomplete_stream' : nativeStopReason;
    console.log(`[anthropic] response stop_reason=${effectiveStopReason || 'unknown'} output_tokens=${outputTokens} tools=${toolCalls.length} incomplete=${incomplete}`);

    const message: ChatMessage = {
      role:       'assistant',
      content:    textContent || refusal || null,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };
    return {
      message,
      thinking: thinking || undefined,
      usage: this.mergeStreamingUsage(inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens),
      stopReason: effectiveStopReason,
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

  // Claude Opus 4.7+ (and every 5-series model) can end a turn with
  // stop_reason: 'refusal' — HTTP 200, but no content. Without this the caller
  // sees a silently empty assistant turn instead of an explanation.
  // stop_details is populated ONLY for refusals, so guard before reading it.
  private refusalText(stopReason: unknown, stopDetails: any): string | undefined {
    if (String(stopReason || '') !== 'refusal') return undefined;
    const category = String(stopDetails?.category || '').trim();
    const explanation = String(stopDetails?.explanation || '').trim();
    return [
      'Claude declined this request for safety reasons.',
      category ? `Category: ${category}.` : '',
      explanation,
    ].filter(Boolean).join(' ');
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

    const refusal = this.refusalText(data.stop_reason, data.stop_details);

    const message: ChatMessage = {
      role:       'assistant',
      content:    textContent || refusal || null,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };

    return { message, thinking: thinking || undefined, usage: this.parseUsage(data.usage), stopReason: data.stop_reason || undefined };
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
    return models.map(name => ({ name, ...this.getKnownModelInfo(name) }));
  }

  // ─── Test Connection ─────────────────────────────────────────────────────────

  async diagnoseConnection(model = 'claude-haiku-4-5-20251001', variant: 'plain' | 'matched-skill' = 'plain'): Promise<{
    success: boolean;
    model: string;
    variant: string;
    error?: string;
    requestId?: string;
  }> {
    try {
      const messages: ChatMessage[] = variant === 'matched-skill'
        ? [
            { role: 'system', content: `Stable instructions${PROMPT_CACHE_MARKER}Matched skill reference: imagegen` },
            { role: 'user', content: 'Use the imagegen skill. Reply OK.' },
          ]
        : [{ role: 'user', content: 'Reply OK.' }];
      await this.chat(messages, model, {
        think: false,
        max_tokens: 32,
      });
      return { success: true, model, variant };
    } catch (error: any) {
      const raw = String(error?.message || error);
      const match = raw.match(/API error \d+: (\{.*\})$/s);
      if (match) {
        try {
          const payload = JSON.parse(match[1]);
          return {
            success: false,
            model,
            variant,
            error: String(payload?.error?.message || payload?.error?.type || 'Anthropic rejected the request').slice(0, 300),
            requestId: String(payload?.request_id || '').slice(0, 100) || undefined,
          };
        } catch { /* Keep a concise generic error below. */ }
      }
      return { success: false, model, variant, error: raw.slice(0, 300) };
    }
  }

  async testConnection(): Promise<boolean> {
    return (await this.diagnoseConnection(this.directConfig?.staticModels?.[0] || 'claude-haiku-4-5-20251001')).success;
  }
}
