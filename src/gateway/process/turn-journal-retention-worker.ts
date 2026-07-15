import {
  DEFAULT_RUNTIME_WORKER_MAX_MESSAGE_BYTES,
  RUNTIME_WORKER_PROTOCOL_VERSION,
  boundedRuntimeWorkerError,
  isRuntimeWorkerProtocolMessage,
  runtimeWorkerMessageBytes,
  type RuntimeWorkerChildMessage,
  type RuntimeWorkerParentMessage,
} from './runtime-worker-protocol.js';
import {
  runTurnJournalRetention,
  type TurnJournalRetentionOptions,
} from '../turn-jobs/retention.js';

const workerName = String(process.env.PROMETHEUS_RUNTIME_WORKER_NAME || 'turn-journal-retention');
let activeRequestId = '';
let shutdownRequested = false;

function send(message: RuntimeWorkerChildMessage): void {
  if (!process.send || !process.connected) return;
  const bytes = runtimeWorkerMessageBytes(message);
  if (bytes > DEFAULT_RUNTIME_WORKER_MAX_MESSAGE_BYTES) {
    process.send({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'error',
      requestId: 'requestId' in message ? message.requestId : undefined,
      code: 'IPC_RESULT_TOO_LARGE',
      message: `Retention result exceeded the bounded IPC limit (${bytes} bytes).`,
      completedAt: Date.now(),
    } satisfies RuntimeWorkerChildMessage);
    return;
  }
  process.send(message);
}

function shutdown(): void {
  try { process.disconnect(); } catch {}
  process.exit(0);
}

process.on('disconnect', () => process.exit(0));

function asRetentionOptions(payload: unknown): TurnJournalRetentionOptions {
  if (!payload || typeof payload !== 'object') throw new TypeError('Retention job requires an options object.');
  const raw = payload as Record<string, unknown>;
  return {
    databasePath: String(raw.databasePath || ''),
    blobRoot: String(raw.blobRoot || ''),
    statePath: raw.statePath == null ? undefined : String(raw.statePath),
    now: raw.now == null ? undefined : Number(raw.now),
    jobRetentionMs: Number(raw.jobRetentionMs),
    blobRetentionMs: Number(raw.blobRetentionMs),
    jobBatchLimit: Number(raw.jobBatchLimit),
    blobScanLimit: Number(raw.blobScanLimit),
    blobDeleteLimit: Number(raw.blobDeleteLimit),
  };
}

async function handleMessage(raw: unknown): Promise<void> {
  if (!isRuntimeWorkerProtocolMessage(raw)) return;
  const message = raw as RuntimeWorkerParentMessage;
  if (message.type === 'shutdown') {
    shutdownRequested = true;
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
      message: 'Turn journal retention worker is already running a pass.',
      completedAt: Date.now(),
    });
    return;
  }
  if (message.kind !== 'turn_journal_retention') {
    send({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'error',
      requestId: message.requestId,
      code: 'UNKNOWN_JOB_KIND',
      message: `Unsupported turn journal maintenance job: ${message.kind}`,
      completedAt: Date.now(),
    });
    return;
  }

  activeRequestId = message.requestId;
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
  }, 5_000);
  heartbeat.unref?.();
  try {
    const result = runTurnJournalRetention(asRetentionOptions(message.payload));
    send({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'result',
      requestId: message.requestId,
      result,
      completedAt: Date.now(),
    });
  } catch (error) {
    send({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'error',
      requestId: message.requestId,
      code: 'TURN_RETENTION_FAILED',
      message: boundedRuntimeWorkerError(error),
      completedAt: Date.now(),
    });
  } finally {
    clearInterval(heartbeat);
    activeRequestId = '';
    if (shutdownRequested) shutdown();
  }
}

process.on('message', (raw: unknown) => {
  void handleMessage(raw).catch((error) => {
    send({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'error',
      requestId: activeRequestId || undefined,
      code: 'TURN_RETENTION_UNHANDLED_FAILURE',
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
