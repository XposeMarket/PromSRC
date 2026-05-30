/**
 * LLMProvider.ts
 * Provider-agnostic interface that every backend adapter must implement.
 * ollama-client.ts delegates to whichever provider is active at runtime.
 */

/**
 * A single part inside a multimodal content array.
 * Used only when sending image data to capable secondary models (OpenAI, Codex).
 * Small primary models (Ollama 4B) always receive plain string content.
 */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } };

/**
 * Internal sentinel inserted by prompt-context.ts between the STABLE (cacheable)
 * prefix of the system prompt and the VOLATILE (per-turn) tail. Adapters use it
 * to place provider cache breakpoints (Anthropic) or simply to keep the stable
 * prefix byte-identical across turns (OpenAI / xAI / Codex auto-caching).
 *
 * It MUST never reach a model: the Anthropic adapter consumes it via
 * splitOnCacheMarker(); all other adapters strip it via stripCacheMarker().
 * The token is deliberately unusual so it can't collide with real prompt text.
 */
export const PROMPT_CACHE_MARKER = '\n␞<<<PROMETHEUS_PROMPT_CACHE_BREAKPOINT>>>␞\n';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  /**
   * Plain string for all primary (small) model calls.
   * ContentPart[] only for multimodal secondary advisor calls where the
   * provider is 'openai' or 'openai_codex' and the model supports vision.
   */
  content: string | ContentPart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export type ModelStreamEvent =
  | { type: 'assistant_delta'; text: string; nativeType?: string; provider?: string; model?: string }
  | { type: 'reasoning_delta'; text: string; summary?: boolean; nativeType?: string; provider?: string; model?: string }
  | { type: 'reasoning_done'; text?: string; summary?: boolean; nativeType?: string; provider?: string; model?: string }
  | { type: 'tool_call_start'; id: string; name: string; nativeType?: string; provider?: string; model?: string }
  | { type: 'tool_call_delta'; id: string; name?: string; argumentsDelta: string; nativeType?: string; provider?: string; model?: string }
  | { type: 'tool_call_done'; id: string; name: string; arguments: string; nativeType?: string; provider?: string; model?: string }
  | { type: 'provider_event'; nativeType: string; data?: unknown; provider?: string; model?: string };

export interface ChatOptions {
  temperature?: number;
  max_tokens?: number;
  num_ctx?: number;
  tools?: any[];
  think?: boolean | 'max' | 'extra_high' | 'xhigh' | 'high' | 'medium' | 'low' | 'minimal' | 'none';
  /** Called with each text token as it streams from the model. */
  onToken?: (chunk: string) => void;
  /** Called with provider-visible reasoning/thinking deltas as they stream. */
  onThinking?: (chunk: string) => void;
  /** Called with provider-visible reasoning summary deltas as they stream. */
  onReasoningSummary?: (chunk: string) => void;
  /** Provider-normalized stream events for future UI/runtime lanes. */
  onModelEvent?: (event: ModelStreamEvent) => void;
  /** Cancels the provider request when the owning chat turn is stopped. */
  abortSignal?: AbortSignal;
  /** When true, strip [TODAY_NOTES] intraday context from system prompt (used after switch_model to reduce context). */
  omitIntradayNotes?: boolean;
}

export interface GenerateOptions {
  temperature?: number;
  max_tokens?: number;
  num_ctx?: number;
  format?: 'json';
  system?: string;
  think?: boolean | 'max' | 'extra_high' | 'xhigh' | 'high' | 'medium' | 'low' | 'minimal' | 'none';
}

export interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  source?: 'provider' | 'estimated';
}

export interface ChatResult {
  message: ChatMessage;
  thinking?: string;
  usage?: ModelUsage;
}

export interface GenerateResult {
  response: string;
  thinking?: string;
  usage?: ModelUsage;
}

export interface ModelInfo {
  name: string;
  size?: number;
  parameter_size?: string;
  family?: string;
  modified_at?: string;
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  tokenizer?: string;
  supportsReasoningTokens?: boolean;
}

export interface LLMProvider {
  /** Send a multi-turn chat request. */
  chat(messages: ChatMessage[], model: string, options?: ChatOptions): Promise<ChatResult>;

  /** Single-prompt generation (used by reactor/agents). */
  generate(prompt: string, model: string, options?: GenerateOptions): Promise<GenerateResult>;

  /** List available models. Returns [] if provider doesn't support listing. */
  listModels(): Promise<ModelInfo[]>;

  /** Quick connectivity check. Returns true if reachable. */
  testConnection(): Promise<boolean>;

  /** Provider identifier. */
  readonly id: ProviderID;
}

export type ProviderID = string;
