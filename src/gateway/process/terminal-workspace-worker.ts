import { createTerminalWorkspaceTracker, type TerminalWorkspaceTracker } from '../coding/terminal-change-tracker';
import {
  RUNTIME_WORKER_PROTOCOL_VERSION,
  boundedRuntimeWorkerError,
  isRuntimeWorkerProtocolMessage,
  type RuntimeWorkerChildMessage,
  type RuntimeWorkerParentMessage,
} from './runtime-worker-protocol';
import {
  sampleRuntimeWorkerResources,
  startRuntimeWorkerResourceHeartbeat,
} from './runtime-worker-resources';

const trackers = new Map<string, TerminalWorkspaceTracker>();
let activeRequestId: string | undefined;

function send(message: RuntimeWorkerChildMessage): void {
  if (process.connected && process.send) process.send(message);
}

const heartbeat = startRuntimeWorkerResourceHeartbeat(send, () => activeRequestId);
process.once('disconnect', () => {
  clearInterval(heartbeat);
  process.exit(0);
});

process.on('message', (raw: unknown) => {
  if (!isRuntimeWorkerProtocolMessage(raw)) return;
  const message = raw as RuntimeWorkerParentMessage;
  if (message.type === 'shutdown') {
    clearInterval(heartbeat);
    trackers.clear();
    try { process.disconnect(); } catch {}
    process.exit(0);
  }
  if (message.type !== 'run') return;
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
    const payload = message.payload && typeof message.payload === 'object'
      ? message.payload as { runId?: string; input?: Parameters<typeof createTerminalWorkspaceTracker>[0] }
      : {};
    const runId = String(payload.runId || '').trim();
    if (!runId) throw new Error('runId is required');
    let result: unknown;
    if (message.kind === 'begin') {
      if (!payload.input || trackers.has(runId)) throw new Error('Invalid or duplicate terminal baseline');
      const tracker = createTerminalWorkspaceTracker(payload.input);
      if (tracker) trackers.set(runId, tracker);
      result = { active: Boolean(tracker) };
    } else if (message.kind === 'finalize') {
      const tracker = trackers.get(runId);
      trackers.delete(runId);
      result = tracker ? tracker.finalize() : null;
    } else {
      throw new Error(`Unsupported terminal workspace action: ${message.kind}`);
    }
    send({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'result',
      requestId: message.requestId,
      result,
      completedAt: Date.now(),
      resourceSample: sampleRuntimeWorkerResources(),
    });
  } catch (error) {
    send({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'error',
      requestId: message.requestId,
      code: 'TERMINAL_WORKSPACE_ERROR',
      message: boundedRuntimeWorkerError(error),
      completedAt: Date.now(),
      resourceSample: sampleRuntimeWorkerResources(),
    });
  } finally {
    activeRequestId = undefined;
  }
});

send({
  protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
  type: 'ready',
  workerName: 'terminal-workspace',
  pid: process.pid,
  resourceSample: sampleRuntimeWorkerResources(),
});
