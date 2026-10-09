/**
 * Scripted LLM provider for the replay harness.
 *
 * Each call to chat() consumes the next step of a script. A step is either a
 * canned assistant reply (text and/or tool calls), a thrown error, or a
 * function that inspects the incoming messages and decides what to return.
 * Every request is recorded so scenarios can assert on what the runtime sent
 * to the model (tool results, system prompt, tool schemas).
 */
import type {
  ChatMessage,
  ChatOptions,
  ChatResult,
  GenerateResult,
  LLMProvider,
  ModelInfo,
  ToolCall,
} from '../../providers/LLMProvider';

export interface ScriptedToolCall {
  name: string;
  args?: Record<string, unknown>;
  /** Raw argument string; overrides args (use for malformed-JSON scenarios). */
  rawArguments?: string;
  id?: string;
}

export interface ScriptedReply {
  text?: string;
  toolCalls?: ScriptedToolCall[];
  thinking?: string;
  stopReason?: string;
  incompleteCause?: ChatResult['incompleteCause'];
  /** Milliseconds to wait before replying (honours abort). */
  delayMs?: number;
}

export interface RecordedRequest {
  index: number;
  model: string;
  messages: ChatMessage[];
  toolNames: string[];
  aborted: boolean;
}

export type ScriptStep =
  | ScriptedReply
  | { throw: string | Error }
  | ((request: RecordedRequest) => ScriptedReply | Promise<ScriptedReply>);

export interface ScriptedProviderOptions {
  /** What to do when the script runs out. Default: reply with a final text. */
  onExhausted?: 'final_text' | 'throw';
  exhaustedText?: string;
}

let toolCallSeq = 0;

function toToolCall(call: ScriptedToolCall): ToolCall {
  toolCallSeq += 1;
  return {
    id: call.id || `call_replay_${toolCallSeq}`,
    type: 'function',
    function: {
      name: call.name,
      arguments: call.rawArguments ?? JSON.stringify(call.args ?? {}),
    },
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    }, { once: true });
  });
}

export class ScriptedProvider implements LLMProvider {
  readonly id = 'replay';
  readonly requests: RecordedRequest[] = [];
  private cursor = 0;

  constructor(private readonly script: ScriptStep[], private readonly options: ScriptedProviderOptions = {}) {}

  get remaining(): number {
    return Math.max(0, this.script.length - this.cursor);
  }

  async chat(messages: ChatMessage[], model: string, options?: ChatOptions): Promise<ChatResult> {
    const request: RecordedRequest = {
      index: this.requests.length,
      model,
      messages: JSON.parse(JSON.stringify(messages ?? [])),
      toolNames: (options?.tools || [])
        .map((tool: any) => String(tool?.function?.name || tool?.name || ''))
        .filter(Boolean),
      aborted: Boolean(options?.abortSignal?.aborted),
    };
    this.requests.push(request);

    const step = this.script[this.cursor];
    this.cursor += 1;
    if (step === undefined) {
      if (this.options.onExhausted === 'throw') {
        throw new Error(`ScriptedProvider: script exhausted at request #${request.index}`);
      }
      return this.toResult({ text: this.options.exhaustedText ?? 'Done.' }, options);
    }
    if (typeof step === 'function') {
      return this.toResult(await step(request), options);
    }
    if ('throw' in step) {
      throw typeof step.throw === 'string' ? new Error(step.throw) : step.throw;
    }
    return this.toResult(step, options);
  }

  private async toResult(reply: ScriptedReply, options?: ChatOptions): Promise<ChatResult> {
    if (reply.delayMs) await sleep(reply.delayMs, options?.abortSignal);
    if (options?.abortSignal?.aborted) {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }
    const text = reply.text ?? '';
    if (text && options?.onToken) options.onToken(text);
    if (reply.thinking && options?.onThinking) options.onThinking(reply.thinking);
    const toolCalls = (reply.toolCalls || []).map(toToolCall);
    return {
      message: {
        role: 'assistant',
        content: text,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      },
      thinking: reply.thinking,
      stopReason: reply.stopReason ?? (toolCalls.length ? 'tool_use' : 'end_turn'),
      incompleteCause: reply.incompleteCause,
      usage: { inputTokens: 100, outputTokens: Math.max(1, Math.ceil(text.length / 4)) },
    };
  }

  async generate(prompt: string): Promise<GenerateResult> {
    // Side-channel generate() calls (titles, digests) get a deterministic stub
    // and are not part of the scripted main loop.
    return { response: `replay:${String(prompt || '').slice(0, 24)}` };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{ name: 'replay-model' }];
  }

  async testConnection(): Promise<boolean> {
    return true;
  }
}

/** Tool messages the runtime fed back to the model for a given request. */
export function toolMessagesIn(request: RecordedRequest): ChatMessage[] {
  return request.messages.filter((message) => message.role === 'tool');
}

export function lastToolResultText(request: RecordedRequest): string {
  const tools = toolMessagesIn(request);
  const last = tools[tools.length - 1];
  return typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content ?? '');
}
