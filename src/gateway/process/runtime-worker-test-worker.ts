import {
  RUNTIME_WORKER_PROTOCOL_VERSION,
  boundedRuntimeWorkerError,
  isRuntimeWorkerProtocolMessage,
  type RuntimeWorkerChildMessage,
  type RuntimeWorkerParentMessage,
} from './runtime-worker-protocol.js';

function send(message: RuntimeWorkerChildMessage): void {
  if (process.connected && process.send) process.send(message);
}

process.on('disconnect', () => process.exit(0));
process.on('message', (raw: unknown) => {
  if (!isRuntimeWorkerProtocolMessage(raw)) return;
  const message = raw as RuntimeWorkerParentMessage;
  if (message.type === 'shutdown') {
    try { process.disconnect(); } catch {}
    process.exit(0);
  }
  if (message.type !== 'run') return;
  send({
    protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
    type: 'started',
    requestId: message.requestId,
    kind: message.kind,
    pid: process.pid,
    startedAt: Date.now(),
  });
  if (message.kind === 'crash') process.exit(17);
  try {
    if (message.kind === 'fail') throw new Error('Synthetic worker failure');
    if (message.kind === 'busy_loop') {
      const payload = message.payload && typeof message.payload === 'object'
        ? message.payload as { durationMs?: unknown }
        : {};
      const durationMs = Math.max(50, Math.min(2000, Number(payload.durationMs || 400)));
      const deadline = Date.now() + durationMs;
      while (Date.now() < deadline) {
        // Deliberately block this child process to prove the gateway-side event
        // loop remains responsive while execution CPU is saturated elsewhere.
      }
    }
    send({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'result',
      requestId: message.requestId,
      result: { pid: process.pid, kind: message.kind, payload: message.payload },
      completedAt: Date.now(),
    });
  } catch (error: any) {
    send({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'error',
      requestId: message.requestId,
      code: 'SYNTHETIC_FAILURE',
      message: boundedRuntimeWorkerError(error),
      completedAt: Date.now(),
    });
  }
});

send({
  protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
  type: 'ready',
  workerName: 'runtime-worker-regression',
  pid: process.pid,
});

