import {
  RUNTIME_WORKER_PROTOCOL_VERSION,
  boundedRuntimeWorkerError,
  isRuntimeWorkerProtocolMessage,
  runtimeWorkerMessageBytes,
  type RuntimeWorkerChildMessage,
  type RuntimeWorkerParentMessage,
} from '../process/runtime-worker-protocol.js';
import {
  sampleRuntimeWorkerResources,
  startRuntimeWorkerResourceHeartbeat,
} from '../process/runtime-worker-resources.js';
import { executePrometheusAuditOps } from './audit-ops.js';

const workerName = String(process.env.PROMETHEUS_RUNTIME_WORKER_NAME || 'audit-ops');
const MAX_IPC_MESSAGE_BYTES = 4 * 1024 * 1024;
let activeRequestId = '';

function send(message: RuntimeWorkerChildMessage): void {
  if (!process.send || !process.connected) return;
  if (runtimeWorkerMessageBytes(message) > MAX_IPC_MESSAGE_BYTES) {
    process.send({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'error',
      requestId: 'requestId' in message ? message.requestId : undefined,
      code: 'IPC_RESULT_TOO_LARGE',
      message: `Audit result exceeded the bounded IPC limit (${MAX_IPC_MESSAGE_BYTES} bytes).`,
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
process.on('message', (raw: unknown) => {
  void (async () => {
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
        message: 'Audit worker is already running a job.',
        completedAt: Date.now(),
      });
      return;
    }
    if (message.kind !== 'audit_ops') {
      send({
        protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
        type: 'error',
        requestId: message.requestId,
        code: 'UNKNOWN_JOB_KIND',
        message: `Unsupported audit worker job: ${message.kind}`,
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
      const payload: any = message.payload && typeof message.payload === 'object' ? message.payload : {};
      const result = executePrometheusAuditOps(String(payload.ownerSessionId || ''), payload.args || {});
      send({
        protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
        type: 'result',
        requestId: message.requestId,
        result,
        completedAt: Date.now(),
        resourceSample: sampleRuntimeWorkerResources(),
      });
    } catch (error: any) {
      send({
        protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
        type: 'error',
        requestId: message.requestId,
        code: 'AUDIT_OPS_FAILED',
        message: boundedRuntimeWorkerError(error),
        completedAt: Date.now(),
      });
    } finally {
      activeRequestId = '';
    }
  })().catch((error) => {
    send({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'error',
      requestId: activeRequestId || undefined,
      code: 'AUDIT_OPS_UNHANDLED',
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
  resourceSample: sampleRuntimeWorkerResources(),
});

const resourceHeartbeat = startRuntimeWorkerResourceHeartbeat(send, () => activeRequestId || undefined);
process.once('disconnect', () => clearInterval(resourceHeartbeat));
