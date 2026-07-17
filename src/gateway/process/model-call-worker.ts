import {
  DEFAULT_MODEL_CALL_MAX_EVENT_BATCH_BYTES,
  DEFAULT_MODEL_CALL_MAX_MESSAGE_BYTES,
  MODEL_CALL_WORKER_PROTOCOL_VERSION,
  boundedModelCallError,
  isModelCallWorkerMessage,
  modelCallMessageBytes,
  type ModelCallStreamItem,
  type ModelCallWorkerChildMessage,
  type ModelCallWorkerParentMessage,
  type ModelCallWorkerRequest,
  type ModelCallWorkerResult,
} from './model-call-worker-protocol.js';

const workerMaxMessageBytes = envInt(
  'PROMETHEUS_MODEL_WORKER_MAX_MESSAGE_BYTES',
  DEFAULT_MODEL_CALL_MAX_MESSAGE_BYTES,
  64 * 1024,
  64 * 1024 * 1024,
);
const maxBatchBytes = envInt(
  'PROMETHEUS_MODEL_WORKER_EVENT_BATCH_BYTES',
  DEFAULT_MODEL_CALL_MAX_EVENT_BATCH_BYTES,
  16 * 1024,
  1024 * 1024,
);
const flushIntervalMs = envInt('PROMETHEUS_MODEL_WORKER_EVENT_FLUSH_MS', 30, 20, 50);
const heartbeatIntervalMs = envInt('PROMETHEUS_MODEL_WORKER_HEARTBEAT_MS', 5_000, 1_000, 30_000);

let activeRequestId = '';
let activeController: AbortController | null = null;
let providerStarted = false;
let shuttingDown = false;

function envInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

function send(message: ModelCallWorkerChildMessage): void {
  if (!process.send || !process.connected) return;
  const bytes = modelCallMessageBytes(message);
  if (bytes > workerMaxMessageBytes) {
    const requestId = 'requestId' in message ? message.requestId : activeRequestId || undefined;
    process.send({
      protocolVersion: MODEL_CALL_WORKER_PROTOCOL_VERSION,
      type: 'error',
      requestId,
      code: 'IPC_RESULT_TOO_LARGE',
      message: `Model worker response exceeded the IPC limit (${bytes} bytes; max ${workerMaxMessageBytes}).`,
      providerStarted,
      completedAt: Date.now(),
    } satisfies ModelCallWorkerChildMessage);
    return;
  }
  process.send(message);
}

function abortError(reason?: unknown): Error {
  const message = reason instanceof Error
    ? reason.message
    : String(reason || 'Model call cancelled.');
  const error = new Error(message, reason === undefined ? undefined : { cause: reason });
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal.reason);
}

class EventBatcher {
  private sequence = 0;
  private pending: ModelCallStreamItem[] = [];
  private pendingBytes = 0;
  private timer: NodeJS.Timeout | null = null;
  private failure: Error | null = null;

  constructor(private readonly requestId: string) {}

  enqueue(kind: ModelCallStreamItem['kind'], value: any): void {
    if (this.failure) throw this.failure;
    const event = { sequence: ++this.sequence, kind, value } as ModelCallStreamItem;
    const bytes = modelCallMessageBytes(event);
    if (!Number.isFinite(bytes) || bytes > maxBatchBytes) {
      this.failure = new Error(`Model stream event exceeded the bounded batch limit (${bytes} bytes).`);
      throw this.failure;
    }
    if (this.pending.length && this.pendingBytes + bytes > maxBatchBytes) this.flush();
    this.pending.push(event);
    this.pendingBytes += bytes;
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), flushIntervalMs);
      this.timer.unref?.();
    }
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.pending.length) return;
    const events = this.pending;
    this.pending = [];
    this.pendingBytes = 0;
    send({
      protocolVersion: MODEL_CALL_WORKER_PROTOCOL_VERSION,
      type: 'events',
      requestId: this.requestId,
      events,
    });
  }

  finish(): void {
    this.flush();
    if (this.failure) throw this.failure;
  }
}

function validateRequest(value: unknown): ModelCallWorkerRequest {
  if (!value || typeof value !== 'object') throw new TypeError('Model worker request must be an object.');
  const request = value as Record<string, any>;
  if (request.operation !== 'chat' && request.operation !== 'generate') {
    throw new TypeError('Unsupported model worker operation.');
  }
  if (typeof request.providerId !== 'string' || !request.providerId.trim() || request.providerId.length > 128) {
    throw new TypeError('providerId is invalid.');
  }
  if (request.accountId !== undefined && (typeof request.accountId !== 'string' || request.accountId.length > 256)) {
    throw new TypeError('accountId is invalid.');
  }
  if (typeof request.model !== 'string' || !request.model.trim() || request.model.length > 512) {
    throw new TypeError('model is invalid.');
  }
  if (request.operation === 'chat' && !Array.isArray(request.messages)) {
    throw new TypeError('messages must be an array.');
  }
  if (request.operation === 'generate' && typeof request.prompt !== 'string') {
    throw new TypeError('prompt must be a string.');
  }
  return request as unknown as ModelCallWorkerRequest;
}

async function runSyntheticTestRequest(
  request: ModelCallWorkerRequest,
  batcher: EventBatcher,
  signal: AbortSignal,
): Promise<ModelCallWorkerResult> {
  const options = request.options as any;
  const mode = String(options?.__testMode || '');
  if (mode === 'crash_before_provider') process.exit(91);
  send({
    protocolVersion: MODEL_CALL_WORKER_PROTOCOL_VERSION,
    type: 'provider_started',
    requestId: activeRequestId,
    at: Date.now(),
  });
  providerStarted = true;
  if (mode === 'crash_after_provider') process.exit(92);
  const delayMs = Math.max(0, Math.min(30_000, Number(options?.__testDelayMs || 0)));
  if (delayMs) {
    if (mode === 'ignore_cancel') {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delayMs);
        timer.unref?.();
      });
    } else {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delayMs);
        const onAbort = () => {
          clearTimeout(timer);
          reject(abortError(signal.reason));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        timer.unref?.();
      });
    }
  }
  if (mode !== 'ignore_cancel') throwIfAborted(signal);
  batcher.enqueue('token', 'a');
  batcher.enqueue('thinking', 'b');
  batcher.enqueue('reasoning_summary', 'c');
  batcher.enqueue('model_event', { type: 'provider_event', nativeType: 'synthetic', provider: request.providerId, model: request.model });
  return request.operation === 'chat'
    ? {
        message: {
          role: 'assistant',
          content: JSON.stringify({
            lastMessage: request.messages.at(-1)?.content ?? null,
            tools: request.options?.tools || [],
          }),
          tool_calls: request.options?.tools?.length
            ? [{
                id: 'synthetic_tool_call',
                type: 'function',
                function: {
                  name: String(request.options.tools[0]?.function?.name || 'synthetic_tool'),
                  arguments: '{"ok":true}',
                },
              }]
            : undefined,
        },
        thinking: 'b',
      }
    : { response: 'synthetic', thinking: 'b' };
}

async function execute(request: ModelCallWorkerRequest, signal: AbortSignal, batcher: EventBatcher): Promise<ModelCallWorkerResult> {
  throwIfAborted(signal);
  if (
    process.env.PROMETHEUS_MODEL_WORKER_TEST_HOOKS === '1'
    && request.providerId === '__model_worker_test__'
  ) {
    return runSyntheticTestRequest(request, batcher, signal);
  }
  const [{ getConfig }, { buildProviderById }] = await Promise.all([
    import('../../config/config.js'),
    import('../../providers/factory.js'),
  ]);
  getConfig().reloadConfig();
  throwIfAborted(signal);
  const provider = buildProviderById(request.providerId, request.accountId);
  send({
    protocolVersion: MODEL_CALL_WORKER_PROTOCOL_VERSION,
    type: 'provider_started',
    requestId: activeRequestId,
    at: Date.now(),
  });
  providerStarted = true;
  if (request.operation === 'chat') {
    return provider.chat(request.messages, request.model, {
      temperature: request.options?.temperature,
      max_tokens: request.options?.maxTokens,
      num_ctx: request.options?.numCtx,
      tools: request.options?.tools,
      think: request.options?.think,
      omitIntradayNotes: request.options?.omitIntradayNotes,
      abortSignal: signal,
      onToken: (value) => batcher.enqueue('token', value),
      onThinking: (value) => batcher.enqueue('thinking', value),
      onReasoningSummary: (value) => batcher.enqueue('reasoning_summary', value),
      onModelEvent: (value) => batcher.enqueue('model_event', value),
    });
  }
  return provider.generate(request.prompt, request.model, {
    temperature: request.options?.temperature,
    max_tokens: request.options?.maxTokens,
    num_ctx: request.options?.numCtx,
    format: request.options?.format,
    system: request.options?.system,
    think: request.options?.think,
  });
}

async function handleRun(message: Extract<ModelCallWorkerParentMessage, { type: 'run' }>): Promise<void> {
  if (activeRequestId) {
    send({
      protocolVersion: MODEL_CALL_WORKER_PROTOCOL_VERSION,
      type: 'error',
      requestId: message.requestId,
      code: 'WORKER_BUSY',
      message: 'Model worker is already running a request.',
      providerStarted: false,
      completedAt: Date.now(),
    });
    return;
  }
  activeRequestId = message.requestId;
  activeController = new AbortController();
  providerStarted = false;
  const batcher = new EventBatcher(message.requestId);
  send({
    protocolVersion: MODEL_CALL_WORKER_PROTOCOL_VERSION,
    type: 'started',
    requestId: message.requestId,
    pid: process.pid,
    at: Date.now(),
  });
  try {
    const request = validateRequest(message.request);
    const result = await execute(request, activeController.signal, batcher);
    batcher.finish();
    send({
      protocolVersion: MODEL_CALL_WORKER_PROTOCOL_VERSION,
      type: 'result',
      requestId: message.requestId,
      result,
      rssBytes: process.memoryUsage().rss,
      completedAt: Date.now(),
    });
  } catch (error) {
    batcher.flush();
    send({
      protocolVersion: MODEL_CALL_WORKER_PROTOCOL_VERSION,
      type: 'error',
      requestId: message.requestId,
      code: activeController.signal.aborted ? 'MODEL_CALL_CANCELLED' : 'MODEL_CALL_FAILED',
      message: boundedModelCallError(error),
      providerStarted,
      completedAt: Date.now(),
    });
  } finally {
    activeRequestId = '';
    activeController = null;
    providerStarted = false;
    if (shuttingDown) shutdown();
  }
}

function shutdown(): void {
  try { process.disconnect(); } catch {}
  process.exit(0);
}

process.on('disconnect', () => process.exit(0));
process.on('message', (raw: unknown) => {
  if (modelCallMessageBytes(raw) > workerMaxMessageBytes || !isModelCallWorkerMessage(raw)) return;
  const message = raw as ModelCallWorkerParentMessage;
  if (message.type === 'run') {
    void handleRun(message);
  } else if (message.type === 'cancel' && message.requestId === activeRequestId) {
    activeController?.abort(abortError(message.reason));
  } else if (message.type === 'shutdown') {
    shuttingDown = true;
    if (!activeRequestId) shutdown();
  }
});

const heartbeat = setInterval(() => {
  send({
    protocolVersion: MODEL_CALL_WORKER_PROTOCOL_VERSION,
    type: 'heartbeat',
    pid: process.pid,
    at: Date.now(),
    requestId: activeRequestId || undefined,
    rssBytes: process.memoryUsage().rss,
  });
}, heartbeatIntervalMs);
heartbeat.unref?.();

send({
  protocolVersion: MODEL_CALL_WORKER_PROTOCOL_VERSION,
  type: 'ready',
  pid: process.pid,
});
