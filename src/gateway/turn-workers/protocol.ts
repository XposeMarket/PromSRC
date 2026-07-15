/**
 * Versioned, bounded IPC contract for a complete Prometheus turn.
 *
 * The gateway is the control plane and remains the authority for durable state,
 * approvals, tools, and client delivery. A child owns one model/tool loop at a
 * time and communicates only through this contract. Large artifacts belong in
 * the gateway blob store; these messages intentionally reject unbounded values.
 */

export const TURN_WORKER_PROTOCOL_VERSION = 1 as const;
export const DEFAULT_TURN_WORKER_MAX_MESSAGE_BYTES = 256 * 1024;
export const DEFAULT_TURN_WORKER_MAX_PAYLOAD_BYTES = 192 * 1024;
export const DEFAULT_TURN_WORKER_MAX_ERROR_CHARS = 4_000;

export type TurnWorkerErrorCode =
  | 'TURN_CANCELLED'
  | 'TURN_WORKER_BUSY'
  | 'TURN_WORKER_CRASHED'
  | 'TURN_WORKER_DISCONNECTED'
  | 'TURN_WORKER_HEARTBEAT_TIMEOUT'
  | 'TURN_WORKER_PROTOCOL_ERROR'
  | 'TURN_WORKER_SHUTDOWN'
  | 'TURN_WORKER_STARTUP_TIMEOUT'
  | 'TURN_WORKER_UNAVAILABLE'
  | 'TURN_WORKER_UNKNOWN_ERROR';

interface ProtocolMessage {
  protocolVersion: typeof TURN_WORKER_PROTOCOL_VERSION;
  type: string;
}

interface JobMessage extends ProtocolMessage {
  jobId: string;
  /** Monotonic durable attempt number. Stale attempts must never be committed. */
  attempt: number;
}

export interface TurnWorkerStartMessage extends JobMessage {
  type: 'start';
  input: unknown;
  resumeCheckpoint?: unknown;
  /** Opaque lease/fencing token issued by the durable scheduler. */
  leaseToken?: string;
}

export interface TurnWorkerCancelMessage extends JobMessage {
  type: 'cancel';
  reason?: string;
}

export interface TurnWorkerSteerMessage extends JobMessage {
  type: 'steer';
  steerId: string;
  payload: unknown;
}

export interface TurnWorkerRpcResultMessage extends JobMessage {
  type: 'rpc_result';
  rpcId: string;
  ok: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

export interface TurnWorkerShutdownMessage extends ProtocolMessage {
  type: 'shutdown';
  reason?: string;
  graceMs?: number;
}

export type TurnWorkerParentMessage =
  | TurnWorkerStartMessage
  | TurnWorkerCancelMessage
  | TurnWorkerSteerMessage
  | TurnWorkerRpcResultMessage
  | TurnWorkerShutdownMessage;

export interface TurnWorkerReadyMessage extends ProtocolMessage {
  type: 'ready';
  workerId: string;
  pid: number;
  capabilities: {
    rpc: true;
    steering: true;
    checkpoints: true;
  };
}

export interface TurnWorkerStartedMessage extends JobMessage {
  type: 'started';
  workerId: string;
  pid: number;
  startedAt: number;
}

export interface TurnWorkerEventMessage extends JobMessage {
  type: 'event';
  sequence: number;
  event: unknown;
  emittedAt: number;
}

export interface TurnWorkerCheckpointMessage extends JobMessage {
  type: 'checkpoint';
  sequence: number;
  checkpoint: unknown;
  emittedAt: number;
}

export interface TurnWorkerHeartbeatMessage extends ProtocolMessage {
  type: 'heartbeat';
  workerId: string;
  pid: number;
  at: number;
  jobId?: string;
  attempt?: number;
}

export interface TurnWorkerRpcRequestMessage extends JobMessage {
  type: 'rpc_request';
  rpcId: string;
  method: string;
  params: unknown;
  /** Stable effect key used by the gateway to replay side-effect results. */
  idempotencyKey?: string;
  requestedAt: number;
}

export interface TurnWorkerSteerAckMessage extends JobMessage {
  type: 'steer_ack';
  steerId: string;
  accepted: boolean;
  reason?: string;
  acknowledgedAt: number;
}

export interface TurnWorkerFinalMessage extends JobMessage {
  type: 'final';
  sequence: number;
  result: unknown;
  completedAt: number;
}

export interface TurnWorkerErrorMessage extends ProtocolMessage {
  type: 'error';
  code: TurnWorkerErrorCode | string;
  message: string;
  details?: unknown;
  completedAt: number;
  jobId?: string;
  attempt?: number;
  sequence?: number;
}

export interface TurnWorkerShutdownAckMessage extends ProtocolMessage {
  type: 'shutdown_ack';
  workerId: string;
  pid: number;
  at: number;
}

export type TurnWorkerChildMessage =
  | TurnWorkerReadyMessage
  | TurnWorkerStartedMessage
  | TurnWorkerEventMessage
  | TurnWorkerCheckpointMessage
  | TurnWorkerHeartbeatMessage
  | TurnWorkerRpcRequestMessage
  | TurnWorkerSteerAckMessage
  | TurnWorkerFinalMessage
  | TurnWorkerErrorMessage
  | TurnWorkerShutdownAckMessage;

export class TurnWorkerProtocolError extends Error {
  readonly code: TurnWorkerErrorCode;

  constructor(message: string, code: TurnWorkerErrorCode = 'TURN_WORKER_PROTOCOL_ERROR') {
    super(message);
    this.name = 'TurnWorkerProtocolError';
    this.code = code;
  }
}

export function turnWorkerMessageBytes(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return Buffer.byteLength(serialized === undefined ? '' : serialized, 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function boundedTurnWorkerText(value: unknown, maxChars = DEFAULT_TURN_WORKER_MAX_ERROR_CHARS): string {
  const raw = value instanceof Error ? value.message : String(value || 'Unknown turn worker error');
  return raw.replace(/\0/g, '').slice(0, Math.max(100, maxChars));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasProtocolEnvelope(value: unknown): value is Record<string, unknown> & ProtocolMessage {
  if (!isRecord(value)) return false;
  return value.protocolVersion === TURN_WORKER_PROTOCOL_VERSION && typeof value.type === 'string';
}

function hasJobEnvelope(value: Record<string, unknown>): boolean {
  return typeof value.jobId === 'string'
    && value.jobId.length > 0
    && value.jobId.length <= 256
    && Number.isSafeInteger(value.attempt)
    && Number(value.attempt) > 0;
}

function hasSequence(value: Record<string, unknown>): boolean {
  return Number.isSafeInteger(value.sequence) && Number(value.sequence) > 0;
}

export function isTurnWorkerParentMessage(value: unknown): value is TurnWorkerParentMessage {
  if (!hasProtocolEnvelope(value)) return false;
  if (value.type === 'shutdown') return true;
  if (!hasJobEnvelope(value)) return false;
  switch (value.type) {
    case 'start':
      return Object.prototype.hasOwnProperty.call(value, 'input');
    case 'cancel':
      return value.reason === undefined || typeof value.reason === 'string';
    case 'steer':
      return typeof value.steerId === 'string'
        && value.steerId.length > 0
        && Object.prototype.hasOwnProperty.call(value, 'payload');
    case 'rpc_result':
      return typeof value.rpcId === 'string' && value.rpcId.length > 0 && typeof value.ok === 'boolean';
    default:
      return false;
  }
}

export function isTurnWorkerChildMessage(value: unknown): value is TurnWorkerChildMessage {
  if (!hasProtocolEnvelope(value)) return false;
  switch (value.type) {
    case 'ready':
      return typeof value.workerId === 'string' && Number.isSafeInteger(value.pid);
    case 'heartbeat':
      return typeof value.workerId === 'string' && Number.isFinite(value.at);
    case 'shutdown_ack':
      return typeof value.workerId === 'string' && Number.isSafeInteger(value.pid);
    case 'error':
      return typeof value.code === 'string' && typeof value.message === 'string';
    default:
      if (!hasJobEnvelope(value)) return false;
      switch (value.type) {
        case 'started':
          return typeof value.workerId === 'string' && Number.isSafeInteger(value.pid);
        case 'event':
          return hasSequence(value) && Object.prototype.hasOwnProperty.call(value, 'event');
        case 'checkpoint':
          return hasSequence(value) && Object.prototype.hasOwnProperty.call(value, 'checkpoint');
        case 'rpc_request':
          return typeof value.rpcId === 'string'
            && value.rpcId.length > 0
            && typeof value.method === 'string'
            && value.method.length > 0
            && Object.prototype.hasOwnProperty.call(value, 'params');
        case 'steer_ack':
          return typeof value.steerId === 'string' && typeof value.accepted === 'boolean';
        case 'final':
          return hasSequence(value) && Object.prototype.hasOwnProperty.call(value, 'result');
        default:
          return false;
      }
  }
}

function payloadFields(message: Record<string, unknown>): unknown[] {
  switch (message.type) {
    case 'start':
      return [message.input, message.resumeCheckpoint];
    case 'steer':
      return [message.payload];
    case 'rpc_result':
      return [message.result, message.error];
    case 'event':
      return [message.event];
    case 'checkpoint':
      return [message.checkpoint];
    case 'rpc_request':
      return [message.params];
    case 'final':
      return [message.result];
    case 'error':
      return [message.details];
    default:
      return [];
  }
}

export interface TurnWorkerBounds {
  maxMessageBytes?: number;
  maxPayloadBytes?: number;
  label?: string;
}

/** Throws before an IPC send, or immediately after an IPC receive. */
export function assertTurnWorkerMessageBounded(value: unknown, bounds: TurnWorkerBounds = {}): void {
  const maxMessageBytes = Math.max(1_024, Number(bounds.maxMessageBytes || DEFAULT_TURN_WORKER_MAX_MESSAGE_BYTES));
  const maxPayloadBytes = Math.max(512, Math.min(
    maxMessageBytes,
    Number(bounds.maxPayloadBytes || DEFAULT_TURN_WORKER_MAX_PAYLOAD_BYTES),
  ));
  const label = bounds.label || 'Turn worker IPC message';
  const messageBytes = turnWorkerMessageBytes(value);
  if (!Number.isFinite(messageBytes)) {
    throw new TurnWorkerProtocolError(`${label} is not JSON serializable.`);
  }
  if (messageBytes > maxMessageBytes) {
    throw new TurnWorkerProtocolError(`${label} is ${messageBytes} bytes; maximum is ${maxMessageBytes}.`);
  }
  if (!isRecord(value)) return;
  for (const field of payloadFields(value)) {
    if (field === undefined) continue;
    const bytes = turnWorkerMessageBytes(field);
    if (!Number.isFinite(bytes)) {
      throw new TurnWorkerProtocolError(`${label} contains a payload that is not JSON serializable.`);
    }
    if (bytes > maxPayloadBytes) {
      throw new TurnWorkerProtocolError(`${label} contains a ${bytes}-byte payload; maximum is ${maxPayloadBytes}. Use a durable blob reference.`);
    }
  }
}
