import path from 'path';
import type { AgentRole } from '../../types.js';
import type { ChatMessage, ModelStreamEvent } from '../../providers/LLMProvider.js';
import { TurnJobBlobStore } from '../turn-jobs/blob-store.js';
import type { JsonValue } from '../turn-jobs/types.js';
import type { TurnWorkerRunContext } from './child-runtime.js';
import {
  MODEL_CALL_REQUEST_VERSION,
  type ChatModelCallRequest,
  type EchoModelCallRequest,
  type GenerateModelCallRequest,
  type ModelCallCheckpoint,
  type ModelCallInputEnvelope,
  type ModelCallOptions,
  type ModelCallRequest,
  type ModelCallResultReference,
  type ModelCallRole,
  type ModelCallStreamEvent,
  type StoredModelCallResult,
} from './model-call-contract.js';

const BLOB_REF_PATTERN = /^turnblob:sha256:[a-f0-9]{64}$/;
const MAX_BLOB_ROOT_CHARS = 4_096;
const MAX_PROVIDER_ID_CHARS = 128;
const MAX_ACCOUNT_ID_CHARS = 256;
const MAX_MODEL_CHARS = 512;
const MAX_MESSAGES = 20_000;
const STREAM_TEXT_CHARS = 8_192;
const MAX_PENDING_EVENT_BYTES = 8 * 1024 * 1024;
const MAX_MODEL_EVENT_BYTES = 48 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(name: string, value: unknown, maximum: number): string {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || normalized.includes('\0')) {
    throw new TypeError(`${name} must contain between 1 and ${maximum} safe characters`);
  }
  return normalized;
}

function optionalBoundedString(name: string, value: unknown, maximum: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return boundedString(name, value, maximum);
}

function positiveInteger(name: string, value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new TypeError(`${name} must be a positive integer`);
  return Number(value);
}

function finiteNumber(name: string, value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

function normalizeRole(value: unknown): ModelCallRole {
  if (value === undefined || value === null || value === '') return 'executor';
  if (value !== 'manager' && value !== 'executor' && value !== 'verifier') {
    throw new TypeError('role must be manager, executor, or verifier');
  }
  return value;
}

function normalizeOptions(value: unknown): ModelCallOptions | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw new TypeError('options must be an object');
  const format = value.format;
  if (format !== undefined && format !== 'json') throw new TypeError('options.format must be json');
  const system = value.system;
  if (system !== undefined && typeof system !== 'string') throw new TypeError('options.system must be a string');
  const tools = value.tools;
  if (tools !== undefined && !Array.isArray(tools)) throw new TypeError('options.tools must be an array');
  const think = value.think;
  if (
    think !== undefined
    && typeof think !== 'boolean'
    && !['ultra', 'max', 'extra_high', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none'].includes(String(think))
  ) {
    throw new TypeError('options.think is invalid');
  }
  return {
    temperature: finiteNumber('options.temperature', value.temperature),
    maxTokens: positiveInteger('options.maxTokens', value.maxTokens),
    numCtx: positiveInteger('options.numCtx', value.numCtx),
    think: think as ModelCallOptions['think'],
    tools: tools as JsonValue[] | undefined,
    omitIntradayNotes: value.omitIntradayNotes === true,
    format,
    system,
  };
}

function normalizeMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value) || value.length > MAX_MESSAGES) {
    throw new TypeError(`messages must be an array with no more than ${MAX_MESSAGES} entries`);
  }
  for (const [index, message] of value.entries()) {
    if (!isRecord(message)) throw new TypeError(`messages[${index}] must be an object`);
    if (!['system', 'user', 'assistant', 'tool'].includes(String(message.role || ''))) {
      throw new TypeError(`messages[${index}].role is invalid`);
    }
    if (message.content !== null && typeof message.content !== 'string' && !Array.isArray(message.content)) {
      throw new TypeError(`messages[${index}].content is invalid`);
    }
  }
  return value as ChatMessage[];
}

function normalizeRequest(value: unknown): ModelCallRequest {
  if (!isRecord(value) || value.version !== MODEL_CALL_REQUEST_VERSION) {
    throw new TypeError(`model-call request version must be ${MODEL_CALL_REQUEST_VERSION}`);
  }
  if (value.operation === 'echo') {
    const delayMs = value.delayMs === undefined ? undefined : positiveInteger('delayMs', value.delayMs);
    return {
      version: MODEL_CALL_REQUEST_VERSION,
      operation: 'echo',
      value: toJsonValue(value.value),
      delayMs,
    } satisfies EchoModelCallRequest;
  }
  if (value.operation !== 'chat' && value.operation !== 'generate') {
    throw new TypeError('operation must be chat, generate, or echo');
  }
  const shared = {
    version: MODEL_CALL_REQUEST_VERSION,
    providerId: boundedString('providerId', value.providerId, MAX_PROVIDER_ID_CHARS),
    accountId: optionalBoundedString('accountId', value.accountId, MAX_ACCOUNT_ID_CHARS),
    model: boundedString('model', value.model, MAX_MODEL_CHARS),
    role: normalizeRole(value.role),
    options: normalizeOptions(value.options),
    usageContext: isRecord(value.usageContext)
      ? {
          sessionId: optionalBoundedString('usageContext.sessionId', value.usageContext.sessionId, 256),
          agentId: optionalBoundedString('usageContext.agentId', value.usageContext.agentId, 256),
          promptManifest: isRecord(value.usageContext.promptManifest)
            ? toJsonValue(value.usageContext.promptManifest) as any
            : undefined,
        }
      : undefined,
  };
  if (value.operation === 'chat') {
    return {
      ...shared,
      operation: 'chat',
      messages: normalizeMessages(value.messages),
    } satisfies ChatModelCallRequest;
  }
  if (typeof value.prompt !== 'string') throw new TypeError('prompt must be a string');
  return {
    ...shared,
    operation: 'generate',
    prompt: value.prompt,
  } satisfies GenerateModelCallRequest;
}

function normalizeInput(value: unknown): ModelCallInputEnvelope {
  if (!isRecord(value)) throw new TypeError('model-call input must be an object');
  const blobRoot = boundedString('blobRoot', value.blobRoot, MAX_BLOB_ROOT_CHARS);
  const requestRef = boundedString('requestRef', value.requestRef, 128);
  if (!BLOB_REF_PATTERN.test(requestRef)) throw new TypeError('requestRef is not a turn-job blob reference');
  return { blobRoot: path.resolve(blobRoot), requestRef };
}

function readMaxBlobBytes(): number {
  const configured = Number(process.env.PROMETHEUS_TURN_BLOB_MAX_BYTES || 0);
  if (Number.isSafeInteger(configured) && configured > 0) return configured;
  return 64 * 1024 * 1024;
}

function toJsonValue(value: unknown): JsonValue {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return null;
  return JSON.parse(serialized) as JsonValue;
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error(String(signal.reason || 'Model call cancelled.'));
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const timer = setTimeout(finish, Math.max(0, ms));
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason instanceof Error ? signal.reason : new Error('Model call cancelled.'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    timer.unref?.();
  });
}

function eventBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function boundedModelEvent(event: ModelStreamEvent): ModelStreamEvent | JsonValue {
  const safe = toJsonValue(event);
  if (eventBytes(safe) <= MAX_MODEL_EVENT_BYTES) return safe;
  const record: Record<string, unknown> = isRecord(event) ? event : {};
  return {
    type: typeof record.type === 'string' ? record.type : 'provider_event',
    nativeType: typeof record.nativeType === 'string' ? record.nativeType : 'oversize_event',
    provider: typeof record.provider === 'string' ? record.provider : '',
    model: typeof record.model === 'string' ? record.model : '',
    truncated: true,
    originalBytes: eventBytes(safe),
  };
}

/** Serializes synchronous provider callbacks onto bounded async IPC sends. */
class ModelEventPump {
  private tail: Promise<void> = Promise.resolve();
  private failure: Error | null = null;
  private pendingBytes = 0;

  constructor(
    private readonly emit: (event: ModelCallStreamEvent) => Promise<void>,
    private readonly signal: AbortSignal,
  ) {}

  enqueue(event: ModelCallStreamEvent): void {
    throwIfAborted(this.signal);
    if (this.failure) throw this.failure;
    const bytes = eventBytes(event);
    if (!Number.isFinite(bytes) || bytes > MAX_MODEL_EVENT_BYTES * 2) {
      throw new Error('Model stream event is not safely bounded.');
    }
    if (this.pendingBytes + bytes > MAX_PENDING_EVENT_BYTES) {
      throw new Error('Model stream IPC backpressure limit exceeded.');
    }
    this.pendingBytes += bytes;
    this.tail = this.tail
      .then(async () => {
        if (!this.failure) await this.emit(event);
      })
      .catch((error) => {
        this.failure = error instanceof Error ? error : new Error(String(error));
      })
      .finally(() => {
        this.pendingBytes = Math.max(0, this.pendingBytes - bytes);
      });
  }

  enqueueText(kind: 'model_token' | 'model_thinking' | 'model_reasoning_summary', text: string): void {
    throwIfAborted(this.signal);
    for (let offset = 0; offset < text.length; offset += STREAM_TEXT_CHARS) {
      this.enqueue({ kind, text: text.slice(offset, offset + STREAM_TEXT_CHARS) });
    }
  }

  async drain(): Promise<void> {
    await this.tail;
    if (this.failure) throw this.failure;
    throwIfAborted(this.signal);
  }
}

function requestIdentity(request: ModelCallRequest): { providerId: string; model: string } {
  if (request.operation === 'echo') return { providerId: 'synthetic', model: 'echo-v1' };
  return { providerId: request.providerId, model: request.model };
}

async function executeEcho(
  request: EchoModelCallRequest,
  pump: ModelEventPump,
  signal: AbortSignal,
): Promise<JsonValue> {
  if (request.delayMs) await delay(request.delayMs, signal);
  throwIfAborted(signal);
  if (typeof request.value === 'string' && request.value) pump.enqueueText('model_token', request.value);
  pump.enqueue({
    kind: 'model_event',
    event: { type: 'provider_event', nativeType: 'synthetic.echo.completed', provider: 'synthetic', model: 'echo-v1' },
  });
  return { value: request.value };
}

async function executeChat(
  request: ChatModelCallRequest,
  pump: ModelEventPump,
  signal: AbortSignal,
): Promise<JsonValue> {
  throwIfAborted(signal);
  const [{ buildProviderById }, { OllamaClient }] = await Promise.all([
    import('../../providers/factory.js'),
    import('../../agents/ollama-client.js'),
  ]);
  throwIfAborted(signal);
  const provider = buildProviderById(request.providerId, request.accountId);
  const client = new OllamaClient();
  const output = await client.chatWithThinking(request.messages, request.role as AgentRole, {
    temperature: request.options?.temperature,
    num_ctx: request.options?.numCtx,
    num_predict: request.options?.maxTokens,
    think: request.options?.think,
    tools: request.options?.tools as any[] | undefined,
    model: request.model,
    onToken: (chunk) => pump.enqueueText('model_token', chunk),
    onThinking: (chunk) => pump.enqueueText('model_thinking', chunk),
    onReasoningSummary: (chunk) => pump.enqueueText('model_reasoning_summary', chunk),
    onModelEvent: (event) => pump.enqueue({ kind: 'model_event', event: boundedModelEvent(event) }),
    abortSignal: signal,
    provider,
    omitIntradayNotes: request.options?.omitIntradayNotes,
    usageContext: request.usageContext,
  });
  throwIfAborted(signal);
  return toJsonValue(output);
}

async function executeGenerate(
  request: GenerateModelCallRequest,
  pump: ModelEventPump,
  signal: AbortSignal,
): Promise<JsonValue> {
  throwIfAborted(signal);
  const [{ buildProviderById }, { OllamaClient }] = await Promise.all([
    import('../../providers/factory.js'),
    import('../../agents/ollama-client.js'),
  ]);
  throwIfAborted(signal);
  const provider = buildProviderById(request.providerId, request.accountId);
  // The provider-neutral generate surface is currently non-callback-based. It
  // still runs in this disposable child; cancellation either reaches adapters
  // that honor the signal internally or the parent process enforces its cancel
  // grace deadline by terminating the child.
  const output = await new OllamaClient().generateWithThinking(request.prompt, request.role as AgentRole, {
    temperature: request.options?.temperature,
    num_predict: request.options?.maxTokens,
    num_ctx: request.options?.numCtx,
    think: request.options?.think,
    format: request.options?.format,
    system: request.options?.system,
    model: request.model,
    provider,
    usageContext: request.usageContext as any,
  });
  throwIfAborted(signal);
  if (output.response) pump.enqueueText('model_token', output.response);
  if (output.thinking) pump.enqueueText('model_thinking', output.thinking);
  pump.enqueue({
    kind: 'model_event',
    event: {
      type: 'provider_event',
      nativeType: 'generate.completed',
      provider: request.providerId,
      model: request.model,
    },
  });
  return toJsonValue(output);
}

export async function runModelCallWorkerJob(
  context: TurnWorkerRunContext<ModelCallInputEnvelope>,
): Promise<ModelCallResultReference> {
  const input = normalizeInput(context.input);
  const blobs = new TurnJobBlobStore(input.blobRoot, { maxBlobBytes: readMaxBlobBytes() });
  const request = normalizeRequest(blobs.getJson(input.requestRef));
  if (request.operation !== 'echo') {
    // Reusable children must not pin the config snapshot from their first job.
    // Provider/model/account identity is explicit in the request, while current
    // endpoints and vault references are reloaded locally from disk.
    const { getConfig } = await import('../../config/config.js');
    getConfig().reloadConfig();
    const providerId = String(request.providerId || '').trim().toLowerCase();
    if (providerId === 'openai_codex' || providerId === 'xai') {
      // Refresh-token rotation is gateway-owned. Reconfirm freshness only when
      // this queued job actually starts, then let the child read the updated
      // vault entry. No token or secret crosses IPC.
      await context.callGateway('prepare_model_credentials', {
        providerId: request.providerId,
        accountId: request.accountId || '',
      }, {
        idempotencyKey: `credential-preflight:${context.jobId}:${context.attempt}`,
        timeoutMs: 60_000,
      });
      throwIfAborted(context.signal);
    }
  }
  const identity = requestIdentity(request);
  const startedAt = Date.now();

  await context.checkpoint({
    kind: 'model_request_start',
    requestRef: input.requestRef,
    operation: request.operation,
    providerId: identity.providerId,
    model: identity.model,
    startedAt,
  } satisfies ModelCallCheckpoint);
  await context.emitEvent({
    kind: 'model_request',
    phase: 'start',
    operation: request.operation,
    providerId: identity.providerId,
    model: identity.model,
    at: startedAt,
  } satisfies ModelCallStreamEvent);

  const pump = new ModelEventPump(
    (event) => context.emitEvent(event),
    context.signal,
  );
  const output = request.operation === 'echo'
    ? await executeEcho(request, pump, context.signal)
    : request.operation === 'chat'
      ? await executeChat(request, pump, context.signal)
      : await executeGenerate(request, pump, context.signal);
  await pump.drain();
  throwIfAborted(context.signal);

  const completedAt = Date.now();
  const stored: StoredModelCallResult = {
    version: MODEL_CALL_REQUEST_VERSION,
    operation: request.operation,
    providerId: identity.providerId,
    model: identity.model,
    startedAt,
    completedAt,
    output,
  };
  const descriptor = blobs.putJson(toJsonValue(stored));

  await context.checkpoint({
    kind: 'model_request_end',
    requestRef: input.requestRef,
    resultRef: descriptor.ref,
    operation: request.operation,
    providerId: identity.providerId,
    model: identity.model,
    completedAt,
  } satisfies ModelCallCheckpoint);
  await context.emitEvent({
    kind: 'model_request',
    phase: 'end',
    operation: request.operation,
    providerId: identity.providerId,
    model: identity.model,
    at: completedAt,
  } satisfies ModelCallStreamEvent);

  return {
    version: MODEL_CALL_REQUEST_VERSION,
    operation: request.operation,
    providerId: identity.providerId,
    model: identity.model,
    resultRef: descriptor.ref,
    resultBytes: descriptor.sizeBytes,
    storedBytes: descriptor.storedBytes,
    durationMs: completedAt - startedAt,
  };
}
