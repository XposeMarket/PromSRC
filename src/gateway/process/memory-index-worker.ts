import {
  RUNTIME_WORKER_PROTOCOL_VERSION,
  boundedRuntimeWorkerError,
  isRuntimeWorkerProtocolMessage,
  runtimeWorkerMessageBytes,
  DEFAULT_RUNTIME_WORKER_MAX_MESSAGE_BYTES,
  type RuntimeWorkerChildMessage,
  type RuntimeWorkerParentMessage,
} from './runtime-worker-protocol.js';
import {
  backfillSqliteMemoryEmbeddings,
  refreshMemoryIndexFromAudit,
  runAutomaticMemoryEmbeddingBackfill,
} from '../memory-index/index.js';
import type { MemoryEmbeddingBackfillOptions, MemoryRefreshOptions } from '../memory-index/refresh-worker-client.js';

const workerName = String(process.env.PROMETHEUS_RUNTIME_WORKER_NAME || 'memory-index-maintenance');
let activeRequestId = '';

function send(message: RuntimeWorkerChildMessage): void {
  if (!process.send || !process.connected) return;
  const bytes = runtimeWorkerMessageBytes(message);
  if (bytes > DEFAULT_RUNTIME_WORKER_MAX_MESSAGE_BYTES) {
    const fallback: RuntimeWorkerChildMessage = {
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'error',
      requestId: 'requestId' in message ? message.requestId : undefined,
      code: 'IPC_RESULT_TOO_LARGE',
      message: `Worker result exceeded the bounded IPC limit (${bytes} bytes).`,
      completedAt: Date.now(),
    };
    process.send(fallback);
    return;
  }
  process.send(message);
}

function shutdown(): void {
  try { process.disconnect(); } catch {}
  process.exit(0);
}

process.on('disconnect', () => process.exit(0));

async function handleMessage(raw: unknown): Promise<void> {
  if (!isRuntimeWorkerProtocolMessage(raw)) return;
  const message = raw as RuntimeWorkerParentMessage;
  if (message.type === 'shutdown') {
    if (!activeRequestId) shutdown();
    return;
  }
  if (message.type !== 'run') return;
  if (activeRequestId) {
    send({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'error',
      requestId: message.requestId,
      code: 'WORKER_BUSY',
      message: 'Memory index maintenance worker is already running a job.',
      completedAt: Date.now(),
    });
    return;
  }
  if (!['memory_index_refresh', 'memory_embedding_backfill', 'memory_embedding_auto_backfill'].includes(message.kind)) {
    send({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'error',
      requestId: message.requestId,
      code: 'UNKNOWN_JOB_KIND',
      message: `Unsupported memory maintenance job: ${message.kind}`,
      completedAt: Date.now(),
    });
    return;
  }

  activeRequestId = message.requestId;
  const payload = message.payload && typeof message.payload === 'object'
    ? message.payload as { workspacePath?: unknown; options?: MemoryRefreshOptions & MemoryEmbeddingBackfillOptions }
    : {};
  const workspacePath = String(payload.workspacePath || '').trim();
  send({
    protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
    type: 'started',
    requestId: message.requestId,
    kind: message.kind,
    pid: process.pid,
    startedAt: Date.now(),
  });

  const heartbeat = setInterval(() => {
    send({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'heartbeat',
      pid: process.pid,
      at: Date.now(),
      activeRequestId: message.requestId,
    });
  }, 5000);
  heartbeat.unref?.();
  try {
    if (!workspacePath) throw new Error(`${message.kind} requires workspacePath.`);
    const result = message.kind === 'memory_index_refresh'
      ? refreshMemoryIndexFromAudit(workspacePath, payload.options)
      : message.kind === 'memory_embedding_backfill'
        ? await backfillSqliteMemoryEmbeddings(workspacePath, payload.options)
        : await runAutomaticMemoryEmbeddingBackfill(workspacePath);
    send({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'result',
      requestId: message.requestId,
      result,
      completedAt: Date.now(),
    });
  } catch (error: any) {
    send({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'error',
      requestId: message.requestId,
      code: 'MEMORY_MAINTENANCE_FAILED',
      message: boundedRuntimeWorkerError(error),
      completedAt: Date.now(),
    });
  } finally {
    clearInterval(heartbeat);
    activeRequestId = '';
  }
}

process.on('message', (raw: unknown) => {
  void handleMessage(raw).catch((error) => {
    send({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'error',
      requestId: activeRequestId || undefined,
      code: 'MEMORY_WORKER_UNHANDLED_FAILURE',
      message: boundedRuntimeWorkerError(error),
      completedAt: Date.now(),
    });
    activeRequestId = '';
  });
});

send({
  protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
  type: 'ready',
  workerName,
  pid: process.pid,
});
