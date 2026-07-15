import fs from 'fs';
import path from 'path';
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
  formatToolStateSummaryForContext,
  persistToolResultsAsObservations,
  type ToolObservation,
} from '../tool-observations.js';

const workerName = String(process.env.PROMETHEUS_RUNTIME_WORKER_NAME || 'tool-observation-persistence');
const configuredMaxSnapshotBytes = Number(process.env.PROMETHEUS_TOOL_OBSERVATION_MAX_SNAPSHOT_BYTES);
const maxSnapshotBytes = Number.isFinite(configuredMaxSnapshotBytes)
  ? Math.max(16 * 1024 * 1024, Math.min(512 * 1024 * 1024, configuredMaxSnapshotBytes))
  : 192 * 1024 * 1024;
let activeRequestId = '';
let shutdownRequested = false;

function send(message: RuntimeWorkerChildMessage): void {
  if (!process.send || !process.connected) return;
  if (runtimeWorkerMessageBytes(message) > DEFAULT_RUNTIME_WORKER_MAX_MESSAGE_BYTES) {
    process.send({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'error',
      requestId: 'requestId' in message ? message.requestId : undefined,
      code: 'IPC_RESULT_TOO_LARGE',
      message: 'Tool-observation worker result exceeded the bounded IPC limit.',
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

function compactForGateway(observation: ToolObservation): ToolObservation {
  return {
    id: observation.id,
    sessionId: observation.sessionId,
    turnId: observation.turnId,
    stepNum: observation.stepNum,
    toolName: observation.toolName,
    category: observation.category,
    status: observation.status,
    argsPreview: '',
    resultPreview: '',
    resultRawRef: observation.resultRawRef,
    pathsTouched: observation.pathsTouched,
    exitCode: observation.exitCode,
    durationMs: observation.durationMs,
    startedAt: observation.startedAt,
    finishedAt: observation.finishedAt,
    tokenEstimate: observation.tokenEstimate,
    createdAt: observation.createdAt,
  };
}

function resolvePayload(payload: unknown): { sessionId: string; turnId: string; toolResults: any[] } {
  if (!payload || typeof payload !== 'object') throw new TypeError('Tool-observation payload is required.');
  const raw = payload as Record<string, unknown>;
  const configDir = path.resolve(String(raw.configDir || ''));
  const snapshotPath = path.resolve(String(raw.snapshotPath || ''));
  const snapshotRoot = path.resolve(configDir, 'runtime', 'tool-observations');
  const relative = path.relative(snapshotRoot, snapshotPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Tool-observation snapshot escaped its runtime directory.');
  const stat = fs.statSync(snapshotPath);
  if (!stat.isFile() || stat.size > maxSnapshotBytes) throw new RangeError('Tool-observation snapshot is not a bounded file.');
  const toolResults = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  if (!Array.isArray(toolResults)) throw new TypeError('Tool-observation snapshot must contain an array.');
  return { sessionId: String(raw.sessionId || ''), turnId: String(raw.turnId || ''), toolResults };
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
  if (activeRequestId) throw new Error('Tool-observation worker is already running.');
  if (message.kind !== 'persist_tool_observations') throw new Error(`Unsupported job kind: ${message.kind}`);
  activeRequestId = message.requestId;
  send({ protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION, type: 'started', requestId: message.requestId, kind: message.kind, pid: process.pid, startedAt: Date.now() });
  const heartbeat = setInterval(() => send({ protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION, type: 'heartbeat', pid: process.pid, at: Date.now(), activeRequestId: message.requestId }), 5_000);
  heartbeat.unref?.();
  try {
    const input = resolvePayload(message.payload);
    const observations = persistToolResultsAsObservations(input.sessionId, input.turnId, input.toolResults);
    const toolLogText = observations.length > 0
      ? formatToolStateSummaryForContext(observations, { includeHeader: true, maxChars: 2200, maxObservations: 14, includeTelemetry: true })
      : '';
    send({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'result',
      requestId: message.requestId,
      result: { observations: observations.map(compactForGateway), toolLogText },
      completedAt: Date.now(),
    });
  } catch (error) {
    send({ protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION, type: 'error', requestId: message.requestId, code: 'TOOL_OBSERVATION_PERSIST_FAILED', message: boundedRuntimeWorkerError(error), completedAt: Date.now() });
  } finally {
    clearInterval(heartbeat);
    activeRequestId = '';
    if (shutdownRequested) shutdown();
  }
}

process.on('disconnect', () => process.exit(0));
process.on('message', (raw: unknown) => { void handleMessage(raw); });
send({ protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION, type: 'ready', workerName, pid: process.pid });
