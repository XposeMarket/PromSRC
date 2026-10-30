import type {
  ChatMessage,
  ChatResult,
  GenerateResult,
  ModelStreamEvent,
} from '../../providers/LLMProvider.js';
import type { RuntimeWorkerResourceSample } from './runtime-worker-protocol.js';

export const MODEL_CALL_WORKER_PROTOCOL_VERSION = 1 as const;
export const DEFAULT_MODEL_CALL_MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
export const DEFAULT_MODEL_CALL_MAX_EVENT_BATCH_BYTES = 256 * 1024;

export type ModelCallThinkMode =
  | boolean
  | 'ultra'
  | 'max'
  | 'extra_high'
  | 'xhigh'
  | 'high'
  | 'medium'
  | 'low'
  | 'minimal'
  | 'none';

export interface ModelCallChatRequest {
  operation: 'chat';
  providerId: string;
  accountId?: string;
  model: string;
  messages: ChatMessage[];
  options?: {
    sessionId?: string;
    temperature?: number;
    maxTokens?: number;
    numCtx?: number;
    tools?: any[];
    think?: ModelCallThinkMode;
    speed?: 'standard' | 'fast';
    omitIntradayNotes?: boolean;
    cacheWorkload?: string;
  };
}

export interface ModelCallGenerateRequest {
  operation: 'generate';
  providerId: string;
  accountId?: string;
  model: string;
  prompt: string;
  options?: {
    temperature?: number;
    maxTokens?: number;
    numCtx?: number;
    format?: 'json';
    system?: string;
    think?: ModelCallThinkMode;
  };
}

export type ModelCallWorkerRequest = ModelCallChatRequest | ModelCallGenerateRequest;
export type ModelCallWorkerResult = ChatResult | GenerateResult;

export type ModelCallStreamItem =
  | { sequence: number; kind: 'token'; value: string }
  | { sequence: number; kind: 'thinking'; value: string }
  | { sequence: number; kind: 'reasoning_summary'; value: string }
  | { sequence: number; kind: 'model_event'; value: ModelStreamEvent };

export type ModelCallWorkerParentMessage =
  | {
      protocolVersion: typeof MODEL_CALL_WORKER_PROTOCOL_VERSION;
      type: 'run';
      requestId: string;
      request: ModelCallWorkerRequest;
    }
  | {
      protocolVersion: typeof MODEL_CALL_WORKER_PROTOCOL_VERSION;
      type: 'cancel';
      requestId: string;
      reason?: string;
    }
  | {
      protocolVersion: typeof MODEL_CALL_WORKER_PROTOCOL_VERSION;
      type: 'shutdown';
      reason?: string;
    };

export type ModelCallWorkerChildMessage =
  | {
      protocolVersion: typeof MODEL_CALL_WORKER_PROTOCOL_VERSION;
      type: 'ready';
      pid: number;
      resourceSample?: RuntimeWorkerResourceSample;
    }
  | {
      protocolVersion: typeof MODEL_CALL_WORKER_PROTOCOL_VERSION;
      type: 'started';
      requestId: string;
      pid: number;
      at: number;
    }
  | {
      protocolVersion: typeof MODEL_CALL_WORKER_PROTOCOL_VERSION;
      type: 'provider_started';
      requestId: string;
      at: number;
    }
  | {
      protocolVersion: typeof MODEL_CALL_WORKER_PROTOCOL_VERSION;
      type: 'events';
      requestId: string;
      events: ModelCallStreamItem[];
    }
  | {
      protocolVersion: typeof MODEL_CALL_WORKER_PROTOCOL_VERSION;
      type: 'result';
      requestId: string;
      result: ModelCallWorkerResult;
      rssBytes: number;
      resourceSample?: RuntimeWorkerResourceSample;
      completedAt: number;
    }
  | {
      protocolVersion: typeof MODEL_CALL_WORKER_PROTOCOL_VERSION;
      type: 'error';
      requestId?: string;
      code: string;
      message: string;
      providerStarted?: boolean;
      /** Allowlisted provider error code; distinct from the worker transport `code`. */
      providerCode?: ModelCallProviderErrorCode;
      providerDiagnostics?: ModelCallProviderErrorDiagnostics;
      resourceSample?: RuntimeWorkerResourceSample;
      completedAt: number;
    }
  | {
      protocolVersion: typeof MODEL_CALL_WORKER_PROTOCOL_VERSION;
      type: 'heartbeat';
      pid: number;
      at: number;
      requestId?: string;
      rssBytes: number;
      resourceSample?: RuntimeWorkerResourceSample;
    };

export function modelCallMessageBytes(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return Buffer.byteLength(serialized === undefined ? '' : serialized, 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function isModelCallWorkerMessage(value: unknown): value is { protocolVersion: number; type: string } {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.protocolVersion === MODEL_CALL_WORKER_PROTOCOL_VERSION && typeof record.type === 'string';
}

export type ModelCallProviderErrorCode = 'CODEX_INCOMPLETE_STREAM';

/** Category/count-only provider failure facts that may cross the worker IPC boundary. */
export interface ModelCallProviderErrorDiagnostics {
  failureClass?: 'missing_completed' | 'empty_completion' | 'transport_terminated';
  sawCompleted?: boolean;
  finalTextChars?: number;
  toolCallCount?: number;
}

const PROVIDER_ERROR_CODES = new Set<string>(['CODEX_INCOMPLETE_STREAM']);
const PROVIDER_FAILURE_CLASSES = new Set<string>(['missing_completed', 'empty_completion', 'transport_terminated']);

function boundedCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100_000_000 ? value : undefined;
}

/**
 * Strict allowlist for provider error metadata. Unknown codes yield nothing;
 * diagnostics keep only categorical/count fields (never text, usage, or event payloads).
 * Used by the worker when serializing and by the pool when deserializing.
 */
export function modelCallProviderErrorFields(code: unknown, diagnostics: unknown): {
  providerCode?: ModelCallProviderErrorCode;
  providerDiagnostics?: ModelCallProviderErrorDiagnostics;
} {
  if (typeof code !== 'string' || !PROVIDER_ERROR_CODES.has(code)) return {};
  const fields: { providerCode: ModelCallProviderErrorCode; providerDiagnostics?: ModelCallProviderErrorDiagnostics } = {
    providerCode: code as ModelCallProviderErrorCode,
  };
  if (diagnostics && typeof diagnostics === 'object') {
    const raw = diagnostics as Record<string, unknown>;
    const clean: ModelCallProviderErrorDiagnostics = {};
    if (typeof raw.failureClass === 'string' && PROVIDER_FAILURE_CLASSES.has(raw.failureClass)) {
      clean.failureClass = raw.failureClass as ModelCallProviderErrorDiagnostics['failureClass'];
    }
    if (typeof raw.sawCompleted === 'boolean') clean.sawCompleted = raw.sawCompleted;
    const finalTextChars = boundedCount(raw.finalTextChars);
    if (finalTextChars !== undefined) clean.finalTextChars = finalTextChars;
    const toolCallCount = boundedCount(raw.toolCallCount);
    if (toolCallCount !== undefined) clean.toolCallCount = toolCallCount;
    if (Object.keys(clean).length) fields.providerDiagnostics = clean;
  }
  return fields;
}

export function boundedModelCallError(error: unknown, maxChars = 2_000): string {
  const raw = error instanceof Error ? error.message : String(error || 'Unknown model worker error');
  return raw.replace(/\0/g, '').slice(0, Math.max(100, maxChars));
}
