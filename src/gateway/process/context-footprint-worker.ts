import path from 'path';
import fs from 'fs';
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
  calculateStoredThreadFootprint,
  type StoredThreadFootprintInput,
} from '../context-window/stored-thread-footprint.js';
import type { TokenizerFamily } from '../context/model-context.js';

const workerName = String(process.env.PROMETHEUS_RUNTIME_WORKER_NAME || 'context-footprint');
const configuredMaxSnapshotBytes = Number(process.env.PROMETHEUS_CONTEXT_FOOTPRINT_MAX_SNAPSHOT_BYTES);
const maxSnapshotBytes = Number.isFinite(configuredMaxSnapshotBytes)
  ? Math.max(16 * 1024 * 1024, Math.min(256 * 1024 * 1024, configuredMaxSnapshotBytes))
  : 96 * 1024 * 1024;
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
      message: 'Context-footprint result exceeded the bounded IPC limit.',
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

function tokenizer(value: unknown): TokenizerFamily {
  const normalized = String(value || 'heuristic');
  return ['openai', 'anthropic', 'gemini', 'llama', 'qwen', 'heuristic'].includes(normalized)
    ? normalized as TokenizerFamily
    : 'heuristic';
}

function resolveInput(payload: unknown): StoredThreadFootprintInput {
  if (!payload || typeof payload !== 'object') throw new TypeError('Context-footprint payload is required.');
  const raw = payload as Record<string, unknown>;
  const configDir = path.resolve(String(raw.configDir || ''));
  const snapshotPath = path.resolve(String(raw.snapshotPath || ''));
  const snapshotRoot = path.resolve(configDir, 'runtime', 'context-footprint');
  const relative = path.relative(snapshotRoot, snapshotPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Context-footprint snapshot escaped its runtime directory.');
  }
  const stat = fs.statSync(snapshotPath);
  if (!stat.isFile() || stat.size > maxSnapshotBytes) throw new RangeError('Context-footprint snapshot is not a bounded file.');
  return {
    sessionId: String(raw.sessionId || ''),
    session: JSON.parse(fs.readFileSync(snapshotPath, 'utf8')),
    configDir,
    tokenizer: tokenizer(raw.tokenizer),
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
  if (activeRequestId) throw new Error('Context-footprint worker is already running.');
  if (message.kind !== 'context_footprint') throw new Error(`Unsupported job kind: ${message.kind}`);
  activeRequestId = message.requestId;
  send({
    protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
    type: 'started',
    requestId: message.requestId,
    kind: message.kind,
    pid: process.pid,
    startedAt: Date.now(),
  });
  const heartbeat = setInterval(() => send({
    protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
    type: 'heartbeat',
    pid: process.pid,
    at: Date.now(),
    activeRequestId: message.requestId,
  }), 5_000);
  heartbeat.unref?.();
  try {
    const result = calculateStoredThreadFootprint(resolveInput(message.payload));
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
      code: 'CONTEXT_FOOTPRINT_FAILED',
      message: boundedRuntimeWorkerError(error),
      completedAt: Date.now(),
    });
  } finally {
    clearInterval(heartbeat);
    activeRequestId = '';
    if (shutdownRequested) shutdown();
  }
}

process.on('disconnect', () => process.exit(0));
process.on('message', (raw: unknown) => { void handleMessage(raw); });
send({
  protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
  type: 'ready',
  workerName,
  pid: process.pid,
});
