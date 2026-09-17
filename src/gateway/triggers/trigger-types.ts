export const TRIGGER_CONTRACT_VERSION = 1 as const;

export type TriggerSourceKind =
  | 'webhook'
  | 'schedule'
  | 'heartbeat'
  | 'event_queue'
  | 'internal_watch'
  | 'connector'
  | 'manual';

export type TriggerConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'exists'
  | 'not_exists'
  | 'in';

export type TriggerActionKind = 'wake' | 'agent' | 'task' | 'team' | 'notify';

export interface TriggerEvent {
  version: typeof TRIGGER_CONTRACT_VERSION;
  id: string;
  source: TriggerSourceKind;
  sourceId?: string;
  eventType: string;
  occurredAt: number;
  receivedAt: number;
  dedupeKey?: string;
  subject?: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface TriggerCondition {
  field: string;
  operator: TriggerConditionOperator;
  value?: unknown;
}

export interface TriggerMatcher {
  sources?: TriggerSourceKind[];
  eventTypes?: string[];
  sourceIds?: string[];
  conditions?: TriggerCondition[];
}

export interface TriggerVerificationContract {
  expectedResult?: {
    requiredText?: string;
    absentText?: string;
  };
  expectedOutputs?: Array<{
    path: string;
    requiredText?: string;
    absentText?: string;
  }>;
}

export interface TriggerDelivery {
  channel?: string;
  target?: string;
  onlyOnChange?: boolean;
  onlyOnFailure?: boolean;
  suppressEmpty?: boolean;
}

export interface TriggerAction {
  kind: TriggerActionKind;
  targetId?: string;
  prompt?: string;
  model?: string;
  delivery?: TriggerDelivery;
  verification?: TriggerVerificationContract;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface TriggerRule {
  version: typeof TRIGGER_CONTRACT_VERSION;
  id: string;
  name: string;
  enabled: boolean;
  matcher: TriggerMatcher;
  action: TriggerAction;
  cooldownMs?: number;
  priority?: number;
  createdAt: number;
  updatedAt: number;
}

export interface TriggerDispatchContext {
  rule: TriggerRule;
  event: TriggerEvent;
  runId: string;
  renderedPrompt?: string;
}

export interface TriggerExecutionResult {
  ok: boolean;
  status: 'completed' | 'failed' | 'queued' | 'skipped';
  result?: string;
  taskId?: string;
  sessionId?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface TriggerRunRecord {
  runId: string;
  ruleId: string;
  ruleName: string;
  eventId: string;
  source: TriggerSourceKind;
  eventType: string;
  actionKind: TriggerActionKind;
  startedAt: number;
  completedAt?: number;
  status: 'running' | 'completed' | 'failed' | 'skipped';
  skipReason?: string;
  result?: TriggerExecutionResult;
}

export interface TriggerDispatchSummary {
  event: TriggerEvent;
  matchedRuleIds: string[];
  runs: TriggerRunRecord[];
}

export interface TriggerExecutor {
  execute(context: TriggerDispatchContext): Promise<TriggerExecutionResult>;
}

export interface TriggerReservationStore {
  reserve(rule: TriggerRule, event: TriggerEvent, now: number): { ok: boolean; reason?: string };
  recordRun?(record: TriggerRunRecord): void | Promise<void>;
}
