import crypto from 'crypto';
import { normalizeTriggerEvent } from './trigger-engine';
import type { TriggerEvent, TriggerSourceKind } from './trigger-types';

const MAX_PAYLOAD_DEPTH = 6;
const MAX_PAYLOAD_KEYS = 100;
const MAX_ARRAY_ITEMS = 100;
const MAX_STRING_CHARS = 12_000;

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth >= MAX_PAYLOAD_DEPTH) return '[depth-limit]';
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return value.replace(/\0/g, '').slice(0, MAX_STRING_CHARS);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Buffer.isBuffer(value)) return `[buffer:${value.length}]`;
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, MAX_PAYLOAD_KEYS)) {
      const safeKey = String(key).replace(/\0/g, '').slice(0, 160);
      if (!safeKey || safeKey === '__proto__' || safeKey === 'constructor' || safeKey === 'prototype') continue;
      out[safeKey] = sanitizeValue(item, depth + 1);
    }
    return out;
  }
  return String(value).slice(0, MAX_STRING_CHARS);
}

function event(params: {
  source: TriggerSourceKind;
  sourceId?: string;
  eventType: string;
  payload?: unknown;
  occurredAt?: number;
  dedupeKey?: string;
  subject?: string;
  metadata?: Record<string, string | number | boolean | null>;
}): TriggerEvent {
  const payload = sanitizeValue(params.payload || {});
  return normalizeTriggerEvent({
    id: crypto.randomUUID(),
    source: params.source,
    sourceId: params.sourceId,
    eventType: params.eventType,
    occurredAt: params.occurredAt || Date.now(),
    receivedAt: Date.now(),
    dedupeKey: params.dedupeKey,
    subject: params.subject,
    payload: payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : { value: payload },
    metadata: params.metadata,
  });
}

export function webhookTriggerEvent(params: {
  provider: string;
  deliveryId: string;
  eventType: string;
  payload: unknown;
  occurredAt?: number;
}): TriggerEvent {
  const provider = String(params.provider || 'webhook').trim().toLowerCase().slice(0, 120);
  const deliveryId = String(params.deliveryId || crypto.randomUUID()).trim().slice(0, 240);
  return event({
    source: 'webhook',
    sourceId: provider,
    eventType: String(params.eventType || 'unknown').slice(0, 240),
    payload: params.payload,
    occurredAt: params.occurredAt,
    dedupeKey: `${provider}:${deliveryId}`,
    metadata: { provider, deliveryId },
  });
}

export function scheduleTriggerEvent(params: {
  scheduleId: string;
  name?: string;
  phase: 'due' | 'started' | 'completed' | 'failed' | 'paused';
  payload?: unknown;
  occurredAt?: number;
  runId?: string;
}): TriggerEvent {
  const scheduleId = String(params.scheduleId || '').trim().slice(0, 240);
  const runId = String(params.runId || '').trim().slice(0, 240);
  return event({
    source: 'schedule',
    sourceId: scheduleId,
    eventType: params.phase,
    payload: params.payload,
    occurredAt: params.occurredAt,
    dedupeKey: runId ? `${scheduleId}:${runId}:${params.phase}` : undefined,
    subject: params.name,
    metadata: { scheduleId, ...(runId ? { runId } : {}) },
  });
}

export function heartbeatTriggerEvent(params: {
  agentId?: string;
  phase?: 'tick' | 'completed' | 'failed';
  payload?: unknown;
  occurredAt?: number;
  cycleId?: string;
} = {}): TriggerEvent {
  const agentId = String(params.agentId || 'main').trim().slice(0, 240);
  const cycleId = String(params.cycleId || '').trim().slice(0, 240);
  return event({
    source: 'heartbeat',
    sourceId: agentId,
    eventType: params.phase || 'tick',
    payload: params.payload,
    occurredAt: params.occurredAt,
    dedupeKey: cycleId ? `${agentId}:${cycleId}:${params.phase || 'tick'}` : undefined,
    metadata: { agentId, ...(cycleId ? { cycleId } : {}) },
  });
}

export function eventQueueTriggerEvent(params: {
  eventId: string;
  eventType?: string;
  payload?: unknown;
  subject?: string;
  occurredAt?: number;
}): TriggerEvent {
  const eventId = String(params.eventId || crypto.randomUUID()).trim().slice(0, 240);
  return event({
    source: 'event_queue',
    sourceId: 'workspace/events/pending.json',
    eventType: String(params.eventType || 'event').slice(0, 240),
    payload: params.payload,
    subject: params.subject,
    occurredAt: params.occurredAt,
    dedupeKey: eventId,
    metadata: { eventId },
  });
}

export function internalWatchTriggerEvent(params: {
  watchId: string;
  kind: 'match' | 'timeout' | 'failed';
  payload?: unknown;
  occurredAt?: number;
}): TriggerEvent {
  const watchId = String(params.watchId || '').trim().slice(0, 240);
  return event({
    source: 'internal_watch',
    sourceId: watchId,
    eventType: params.kind,
    payload: params.payload,
    occurredAt: params.occurredAt,
    dedupeKey: `${watchId}:${params.kind}:${Number(params.occurredAt || Date.now())}`,
    metadata: { watchId },
  });
}

export function connectorTriggerEvent(params: {
  connectorId: string;
  eventType: string;
  eventId?: string;
  payload?: unknown;
  subject?: string;
  occurredAt?: number;
}): TriggerEvent {
  const connectorId = String(params.connectorId || '').trim().slice(0, 240);
  const eventId = String(params.eventId || '').trim().slice(0, 240);
  return event({
    source: 'connector',
    sourceId: connectorId,
    eventType: String(params.eventType || 'event').slice(0, 240),
    payload: params.payload,
    subject: params.subject,
    occurredAt: params.occurredAt,
    dedupeKey: eventId ? `${connectorId}:${eventId}` : undefined,
    metadata: { connectorId, ...(eventId ? { eventId } : {}) },
  });
}

export function manualTriggerEvent(params: {
  eventType?: string;
  payload?: unknown;
  subject?: string;
  sourceId?: string;
} = {}): TriggerEvent {
  return event({
    source: 'manual',
    sourceId: params.sourceId || 'operator',
    eventType: params.eventType || 'run',
    payload: params.payload,
    subject: params.subject,
  });
}

export const sanitizeTriggerPayload = sanitizeValue;
