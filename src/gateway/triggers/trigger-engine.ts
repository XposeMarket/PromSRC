import crypto from 'crypto';
import {
  TRIGGER_CONTRACT_VERSION,
  type TriggerCondition,
  type TriggerDispatchContext,
  type TriggerDispatchSummary,
  type TriggerEvent,
  type TriggerExecutor,
  type TriggerMatcher,
  type TriggerReservationStore,
  type TriggerRule,
  type TriggerRunRecord,
} from './trigger-types';

const MAX_TEMPLATE_OUTPUT_CHARS = 24_000;
const MAX_TEMPLATE_VALUE_CHARS = 4_000;
const MAX_MATCHER_CONDITIONS = 32;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function pathSegments(path: string): string[] {
  return String(path || '')
    .trim()
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 16);
}

export function getTriggerField(event: TriggerEvent, field: string): unknown {
  const segments = pathSegments(field);
  if (!segments.length) return undefined;
  let current: unknown = event;
  for (const segment of segments) {
    const record = asRecord(current);
    if (!record || !Object.prototype.hasOwnProperty.call(record, segment)) return undefined;
    current = record[segment];
  }
  return current;
}

function comparable(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function matchesTriggerCondition(event: TriggerEvent, condition: TriggerCondition): boolean {
  const actual = getTriggerField(event, condition.field);
  const expected = condition.value;
  switch (condition.operator) {
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'not_exists':
      return actual === undefined || actual === null;
    case 'equals':
      return comparable(actual) === comparable(expected);
    case 'not_equals':
      return comparable(actual) !== comparable(expected);
    case 'contains': {
      if (Array.isArray(actual)) return actual.some((item) => comparable(item) === comparable(expected));
      return comparable(actual).includes(comparable(expected));
    }
    case 'not_contains': {
      if (Array.isArray(actual)) return !actual.some((item) => comparable(item) === comparable(expected));
      return !comparable(actual).includes(comparable(expected));
    }
    case 'in': {
      if (!Array.isArray(expected)) return false;
      return expected.some((item) => comparable(item) === comparable(actual));
    }
    default:
      return false;
  }
}

function matchesOne(value: string, candidates: string[] | undefined): boolean {
  if (!candidates?.length) return true;
  const normalized = String(value || '');
  return candidates.some((candidate) => candidate === '*' || String(candidate) === normalized);
}

export function matchesTriggerMatcher(event: TriggerEvent, matcher: TriggerMatcher): boolean {
  if (matcher.sources?.length && !matcher.sources.includes(event.source)) return false;
  if (!matchesOne(event.eventType, matcher.eventTypes)) return false;
  if (!matchesOne(String(event.sourceId || ''), matcher.sourceIds)) return false;
  const conditions = Array.isArray(matcher.conditions) ? matcher.conditions.slice(0, MAX_MATCHER_CONDITIONS) : [];
  return conditions.every((condition) => matchesTriggerCondition(event, condition));
}

function templateValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.slice(0, MAX_TEMPLATE_VALUE_CHARS);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value).slice(0, MAX_TEMPLATE_VALUE_CHARS);
  } catch {
    return String(value).slice(0, MAX_TEMPLATE_VALUE_CHARS);
  }
}

/**
 * Deliberately tiny renderer: substitutions only. No expressions, function
 * calls, eval, loops, conditionals, or arbitrary property traversal.
 */
export function renderTriggerTemplate(template: string | undefined, event: TriggerEvent): string | undefined {
  const raw = String(template || '');
  if (!raw) return undefined;
  const rendered = raw.replace(/\{\{\s*([a-zA-Z0-9_.-]{1,160})\s*\}\}/g, (_match, field: string) => {
    const normalized = field === 'subject' ? 'subject' : field;
    return templateValue(getTriggerField(event, normalized));
  });
  return rendered.slice(0, MAX_TEMPLATE_OUTPUT_CHARS);
}

export function normalizeTriggerEvent(input: Omit<TriggerEvent, 'version' | 'id' | 'receivedAt'> & {
  id?: string;
  receivedAt?: number;
}): TriggerEvent {
  const now = Date.now();
  return {
    version: TRIGGER_CONTRACT_VERSION,
    id: String(input.id || crypto.randomUUID()).slice(0, 240),
    source: input.source,
    sourceId: input.sourceId ? String(input.sourceId).slice(0, 240) : undefined,
    eventType: String(input.eventType || 'unknown').slice(0, 240),
    occurredAt: Number(input.occurredAt || now),
    receivedAt: Number(input.receivedAt || now),
    dedupeKey: input.dedupeKey ? String(input.dedupeKey).slice(0, 500) : undefined,
    subject: input.subject ? String(input.subject).slice(0, 500) : undefined,
    payload: asRecord(input.payload) || {},
    metadata: input.metadata,
  };
}

export interface TriggerEngineOptions {
  rules: () => TriggerRule[] | Promise<TriggerRule[]>;
  reservationStore: TriggerReservationStore;
  executor: TriggerExecutor;
  now?: () => number;
}

export class TriggerEngine {
  private readonly now: () => number;

  constructor(private readonly options: TriggerEngineOptions) {
    this.now = options.now || Date.now;
  }

  async dispatch(eventInput: TriggerEvent): Promise<TriggerDispatchSummary> {
    const event = normalizeTriggerEvent(eventInput);
    const rules = (await this.options.rules())
      .filter((rule) => rule.enabled && rule.version === TRIGGER_CONTRACT_VERSION)
      .sort((a, b) => (Number(a.priority || 100) - Number(b.priority || 100)) || a.id.localeCompare(b.id));
    const matchedRuleIds: string[] = [];
    const runs: TriggerRunRecord[] = [];

    for (const rule of rules) {
      if (!matchesTriggerMatcher(event, rule.matcher || {})) continue;
      matchedRuleIds.push(rule.id);
      const runId = `trigger_${rule.id}_${event.id}_${crypto.randomBytes(4).toString('hex')}`.slice(0, 320);
      const reservation = this.options.reservationStore.reserve(rule, event, this.now());
      if (!reservation.ok) {
        const skipped: TriggerRunRecord = {
          runId,
          ruleId: rule.id,
          ruleName: rule.name,
          eventId: event.id,
          source: event.source,
          eventType: event.eventType,
          actionKind: rule.action.kind,
          startedAt: this.now(),
          completedAt: this.now(),
          status: 'skipped',
          skipReason: reservation.reason || 'reservation_rejected',
          result: { ok: true, status: 'skipped', result: reservation.reason },
        };
        runs.push(skipped);
        await this.options.reservationStore.recordRun?.(skipped);
        continue;
      }

      const record: TriggerRunRecord = {
        runId,
        ruleId: rule.id,
        ruleName: rule.name,
        eventId: event.id,
        source: event.source,
        eventType: event.eventType,
        actionKind: rule.action.kind,
        startedAt: this.now(),
        status: 'running',
      };
      runs.push(record);
      await this.options.reservationStore.recordRun?.(record);

      const context: TriggerDispatchContext = {
        rule,
        event,
        runId,
        renderedPrompt: renderTriggerTemplate(rule.action.prompt, event),
      };
      try {
        const result = await this.options.executor.execute(context);
        record.completedAt = this.now();
        record.result = result;
        record.status = result.status === 'failed' || !result.ok ? 'failed' : (result.status === 'skipped' ? 'skipped' : 'completed');
      } catch (error: any) {
        record.completedAt = this.now();
        record.status = 'failed';
        record.result = {
          ok: false,
          status: 'failed',
          error: String(error?.message || error || 'Trigger execution failed.').slice(0, 2_000),
        };
      }
      await this.options.reservationStore.recordRun?.(record);
    }

    return { event, matchedRuleIds, runs };
  }
}
