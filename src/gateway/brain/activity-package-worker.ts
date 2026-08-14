import {
  RUNTIME_WORKER_PROTOCOL_VERSION,
  boundedRuntimeWorkerError,
  isRuntimeWorkerProtocolMessage,
  runtimeWorkerMessageBytes,
  type RuntimeWorkerChildMessage,
  type RuntimeWorkerParentMessage,
} from '../process/runtime-worker-protocol.js';
import {
  buildThoughtActivityPackage,
  type BuildActivityPackageOptions,
} from './activity-package.js';

const MAX_RESULT_BYTES = Math.max(
  16 * 1024,
  Math.min(64 * 1024 * 1024, Number(process.env.PROMETHEUS_BRAIN_ACTIVITY_MAX_MESSAGE_BYTES || 16 * 1024 * 1024)),
);
const workerName = String(process.env.PROMETHEUS_RUNTIME_WORKER_NAME || 'brain-activity');
let activeRequestId = '';

function send(message: RuntimeWorkerChildMessage): void {
  if (!process.send || !process.connected) return;
  const bytes = runtimeWorkerMessageBytes(message);
  if (bytes > MAX_RESULT_BYTES) {
    process.send({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'error',
      requestId: 'requestId' in message ? message.requestId : undefined,
      code: 'IPC_RESULT_TOO_LARGE',
      message: `Brain activity package exceeded the bounded IPC limit (${bytes} bytes; max ${MAX_RESULT_BYTES}).`,
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

async function execute(payload: BuildActivityPackageOptions) {
  if (!payload || typeof payload !== 'object') throw new Error('Brain activity package payload is required.');
  return buildThoughtActivityPackage(payload);
}

process.on('disconnect', () => process.exit(0));
process.on('message', (raw: unknown) => {
  void (async () => {
    if (!isRuntimeWorkerProtocolMessage(raw)) return;
    const message = raw as RuntimeWorkerParentMessage;
    if (message.type === 'shutdown') {
      if (!activeRequestId) shutdown();
      return;
    }
    if (message.type !== 'run') return;
    if (message.kind !== 'build_thought_activity_package') {
      send({
        protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
        type: 'error',
        requestId: message.requestId,
        code: 'UNKNOWN_JOB_KIND',
        message: `Unsupported Brain activity worker job: ${message.kind}`,
        completedAt: Date.now(),
      });
      return;
    }
    if (activeRequestId) {
      send({
        protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
        type: 'error',
        requestId: message.requestId,
        code: 'WORKER_BUSY',
        message: 'Brain activity worker is already running a job.',
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
    try {
      const result = await execute(message.payload as BuildActivityPackageOptions);
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
        code: 'BRAIN_ACTIVITY_BUILD_FAILED',
        message: boundedRuntimeWorkerError(error),
        completedAt: Date.now(),
      });
    } finally {
      activeRequestId = '';
    }
  })();
});

send({
  protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
  type: 'ready',
  workerName,
  pid: process.pid,
});
