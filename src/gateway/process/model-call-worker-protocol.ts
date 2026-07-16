import type {
  ChatMessage,
  ChatResult,
  GenerateResult,
  ModelStreamEvent,
} from '../../providers/LLMProvider.js';

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
    temperature?: number;
    maxTokens?: number;
    numCtx?: number;
    tools?: any[];
    think?: ModelCallThinkMode;
    omitIntradayNotes?: boolean;
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
      completedAt: number;
    }
  | {
      protocolVersion: typeof MODEL_CALL_WORKER_PROTOCOL_VERSION;
      type: 'error';
      requestId?: string;
      code: string;
      message: string;
      providerStarted?: boolean;
      completedAt: number;
    }
  | {
      protocolVersion: typeof MODEL_CALL_WORKER_PROTOCOL_VERSION;
      type: 'heartbeat';
      pid: number;
      at: number;
      requestId?: string;
      rssBytes: number;
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

export function boundedModelCallError(error: unknown, maxChars = 2_000): string {
  const raw = error instanceof Error ? error.message : String(error || 'Unknown model worker error');
  return raw.replace(/\0/g, '').slice(0, Math.max(100, maxChars));
}
