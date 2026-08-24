/**
 * Bounded IPC contract shared by gateway-owned runtime workers.
 *
 * Keep this module dependency-free: both the gateway and child entry points load
 * it before their heavier runtime modules. The protocol is deliberately small so
 * future turn workers can reuse the same broker without sending full tool logs or
 * session snapshots through a single unbounded message.
 */

export const RUNTIME_WORKER_PROTOCOL_VERSION = 1 as const;
export const DEFAULT_RUNTIME_WORKER_MAX_MESSAGE_BYTES = 256 * 1024;

/**
 * A bounded, transport-safe snapshot of the child process resources. Keep
 * this contract small enough to send with heartbeats while retaining the
 * allocation classes that commonly make RSS diverge from V8 heap usage.
 */
export interface RuntimeWorkerHeapSpaceSample {
  name: string;
  sizeBytes: number;
  usedBytes: number;
  availableBytes: number;
  physicalBytes: number;
}

export interface RuntimeWorkerResourceSample {
  at: number;
  pid: number;
  rssBytes: number;
  heapTotalBytes: number;
  heapUsedBytes: number;
  externalBytes: number;
  arrayBuffersBytes: number;
  cpuUserMicros: number;
  cpuSystemMicros: number;
  heapSpaces: RuntimeWorkerHeapSpaceSample[];
}

export interface RuntimeWorkerRunMessage {
  protocolVersion: typeof RUNTIME_WORKER_PROTOCOL_VERSION;
  type: 'run';
  requestId: string;
  kind: string;
  payload: unknown;
}

export interface RuntimeWorkerShutdownMessage {
  protocolVersion: typeof RUNTIME_WORKER_PROTOCOL_VERSION;
  type: 'shutdown';
  reason?: string;
}

export type RuntimeWorkerParentMessage = RuntimeWorkerRunMessage | RuntimeWorkerShutdownMessage;

export interface RuntimeWorkerReadyMessage {
  protocolVersion: typeof RUNTIME_WORKER_PROTOCOL_VERSION;
  type: 'ready';
  workerName: string;
  pid: number;
  resourceSample?: RuntimeWorkerResourceSample;
}

export interface RuntimeWorkerStartedMessage {
  protocolVersion: typeof RUNTIME_WORKER_PROTOCOL_VERSION;
  type: 'started';
  requestId: string;
  kind: string;
  pid: number;
  startedAt: number;
}

export interface RuntimeWorkerHeartbeatMessage {
  protocolVersion: typeof RUNTIME_WORKER_PROTOCOL_VERSION;
  type: 'heartbeat';
  pid: number;
  at: number;
  activeRequestId?: string;
  resourceSample?: RuntimeWorkerResourceSample;
}

export interface RuntimeWorkerResultMessage {
  protocolVersion: typeof RUNTIME_WORKER_PROTOCOL_VERSION;
  type: 'result';
  requestId: string;
  result: unknown;
  completedAt: number;
  resourceSample?: RuntimeWorkerResourceSample;
}

export interface RuntimeWorkerErrorMessage {
  protocolVersion: typeof RUNTIME_WORKER_PROTOCOL_VERSION;
  type: 'error';
  requestId?: string;
  code: string;
  message: string;
  completedAt: number;
  resourceSample?: RuntimeWorkerResourceSample;
}

export type RuntimeWorkerChildMessage =
  | RuntimeWorkerReadyMessage
  | RuntimeWorkerStartedMessage
  | RuntimeWorkerHeartbeatMessage
  | RuntimeWorkerResultMessage
  | RuntimeWorkerErrorMessage;

export function runtimeWorkerMessageBytes(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return Buffer.byteLength(serialized === undefined ? '' : serialized, 'utf-8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function isRuntimeWorkerProtocolMessage(value: unknown): value is { protocolVersion: number; type: string } {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.protocolVersion === RUNTIME_WORKER_PROTOCOL_VERSION && typeof record.type === 'string';
}

export function boundedRuntimeWorkerError(error: unknown, maxChars = 2000): string {
  const raw = error instanceof Error ? error.message : String(error || 'Unknown worker error');
  return raw.replace(/\0/g, '').slice(0, Math.max(100, maxChars));
}
