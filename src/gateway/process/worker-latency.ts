import {
  MODEL_CALL_WORKER_PROTOCOL_VERSION,
  modelCallMessageBytes,
  type ModelCallStreamItem,
  type ModelCallWorkerChildMessage,
} from './model-call-worker-protocol.js';

/** Call only after IPC ready. Never put optional warming on the request path. */
export function scheduleWorkerWarmup(warmup: () => Promise<unknown>): void {
  setImmediate(() => { void Promise.resolve().then(warmup).catch(() => {}); });
}

export class EventBatcher {
  private sequence = 0;
  private pending: ModelCallStreamItem[] = [];
  private pendingBytes = 0;
  private timer: NodeJS.Timeout | null = null;
  private failure: Error | null = null;
  private readonly firstContentKinds = new Set<ModelCallStreamItem['kind']>();
  private firstModelEvent = false;

  constructor(
    private readonly requestId: string,
    private readonly send: (message: ModelCallWorkerChildMessage) => void,
    private readonly maxBatchBytes: number,
    private readonly flushIntervalMs: number,
  ) {}

  enqueue(kind: ModelCallStreamItem['kind'], value: any): void {
    if (this.failure) throw this.failure;
    const event = { sequence: ++this.sequence, kind, value } as ModelCallStreamItem;
    const bytes = modelCallMessageBytes(event);
    if (!Number.isFinite(bytes) || bytes > this.maxBatchBytes) {
      this.failure = new Error(`Model stream event exceeded the bounded batch limit (${bytes} bytes).`);
      throw this.failure;
    }
    if (this.pending.length && this.pendingBytes + bytes > this.maxBatchBytes) this.flush();
    this.pending.push(event);
    this.pendingBytes += bytes;
    // Model metadata must not consume the first real text/thinking fast path.
    const content = kind !== 'model_event' && typeof value === 'string' && value.length > 0;
    const immediate = (content && !this.firstContentKinds.has(kind)) || (kind === 'model_event' && !this.firstModelEvent);
    if (content) this.firstContentKinds.add(kind);
    if (kind === 'model_event') this.firstModelEvent = true;
    if (immediate) {
      this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.flushIntervalMs);
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
    this.send({ protocolVersion: MODEL_CALL_WORKER_PROTOCOL_VERSION, type: 'events', requestId: this.requestId, events });
  }

  finish(): void {
    this.flush();
    if (this.failure) throw this.failure;
  }
}
