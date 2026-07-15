import type { ChatMessage, ModelStreamEvent } from '../../providers/LLMProvider.js';
import type { RuntimePromptManifestContext } from '../../runtime/prompt-manifest.js';
import type { JsonValue } from '../turn-jobs/types.js';

export const MODEL_CALL_REQUEST_VERSION = 1 as const;

export type ModelCallOperation = 'chat' | 'generate' | 'echo';
export type ModelCallRole = 'manager' | 'executor' | 'verifier';
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

/**
 * The only model-call payload allowed over turn-worker IPC. The request body is
 * immutable durable data; credentials and provider instances are deliberately
 * absent and are resolved inside the child from Prometheus configuration.
 */
export interface ModelCallInputEnvelope {
  blobRoot: string;
  requestRef: string;
}

export interface ModelCallUsageContext {
  sessionId?: string;
  agentId?: string;
  promptManifest?: RuntimePromptManifestContext;
}

export interface ModelCallOptions {
  temperature?: number;
  maxTokens?: number;
  numCtx?: number;
  think?: ModelCallThinkMode;
  tools?: JsonValue[];
  omitIntradayNotes?: boolean;
  format?: 'json';
  system?: string;
}

export interface ChatModelCallRequest {
  version: typeof MODEL_CALL_REQUEST_VERSION;
  operation: 'chat';
  providerId: string;
  accountId?: string;
  model: string;
  role?: ModelCallRole;
  messages: ChatMessage[];
  options?: ModelCallOptions;
  usageContext?: ModelCallUsageContext;
}

export interface GenerateModelCallRequest {
  version: typeof MODEL_CALL_REQUEST_VERSION;
  operation: 'generate';
  providerId: string;
  accountId?: string;
  model: string;
  role?: ModelCallRole;
  prompt: string;
  options?: ModelCallOptions;
  usageContext?: ModelCallUsageContext;
}

/** Deterministic transport/blob-store probe. It never initializes a provider. */
export interface EchoModelCallRequest {
  version: typeof MODEL_CALL_REQUEST_VERSION;
  operation: 'echo';
  value: JsonValue;
  delayMs?: number;
}

export type ModelCallRequest = ChatModelCallRequest | GenerateModelCallRequest | EchoModelCallRequest;

export interface StoredModelCallResult {
  version: typeof MODEL_CALL_REQUEST_VERSION;
  operation: ModelCallOperation;
  providerId: string;
  model: string;
  startedAt: number;
  completedAt: number;
  output: JsonValue;
}

/** Small, bounded terminal value returned over IPC. */
export interface ModelCallResultReference {
  version: typeof MODEL_CALL_REQUEST_VERSION;
  operation: ModelCallOperation;
  providerId: string;
  model: string;
  resultRef: string;
  resultBytes: number;
  storedBytes: number;
  durationMs: number;
}

export type ModelCallStreamEvent =
  | {
      kind: 'model_request';
      phase: 'start' | 'end';
      operation: ModelCallOperation;
      providerId: string;
      model: string;
      at: number;
    }
  | { kind: 'model_token'; text: string }
  | { kind: 'model_thinking'; text: string }
  | { kind: 'model_reasoning_summary'; text: string }
  | { kind: 'model_event'; event: ModelStreamEvent | JsonValue };

export type ModelCallCheckpoint =
  | {
      kind: 'model_request_start';
      requestRef: string;
      operation: ModelCallOperation;
      providerId: string;
      model: string;
      startedAt: number;
    }
  | {
      kind: 'model_request_end';
      requestRef: string;
      resultRef: string;
      operation: ModelCallOperation;
      providerId: string;
      model: string;
      completedAt: number;
    };
