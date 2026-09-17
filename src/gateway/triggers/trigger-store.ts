import fs from 'fs';
import path from 'path';
import {
  TRIGGER_CONTRACT_VERSION,
  type TriggerEvent,
  type TriggerReservationStore,
  type TriggerRule,
  type TriggerRunRecord,
} from './trigger-types';

interface TriggerStoreFile {
  version: 1;
  updatedAt: number;
  rules: TriggerRule[];
  reservations: Array<{
    key: string;
    ruleId: string;
    eventId: string;
    eventDedupeKey?: string;
    reservedAt: number;
  }>;
  lastRunAtByRule: Record<string, number>;
  runs: TriggerRunRecord[];
}

const MAX_RULES = 1_000;
const MAX_RESERVATIONS = 5_000;
const MAX_RUNS = 1_000;
const RESERVATION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

function initialStore(): TriggerStoreFile {
  return {
    version: 1,
    updatedAt: Date.now(),
    rules: [],
    reservations: [],
    lastRunAtByRule: {},
    runs: [],
  };
}

function cleanText(value: unknown, max: number): string {
  return String(value || '').replace(/\0/g, '').trim().slice(0, max);
}

function finiteInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function finiteTimestamp(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function cloneRule(rule: TriggerRule): TriggerRule {
  return JSON.parse(JSON.stringify(rule));
}

export function validateTriggerRule(rule: TriggerRule): TriggerRule {
  if (!rule || typeof rule !== 'object') throw new Error('Trigger rule must be an object.');
  const id = cleanText(rule.id, 160);
  const name = cleanText(rule.name, 240);
  if (!id || !/^[A-Za-z0-9._:-]+$/.test(id)) throw new Error('Trigger rule id must use letters, numbers, dot, underscore, colon, or dash.');
  if (!name) throw new Error('Trigger rule name is required.');
  if (!rule.action?.kind) throw new Error('Trigger rule action is required.');
  const conditions = Array.isArray(rule.matcher?.conditions) ? rule.matcher.conditions : [];
  if (conditions.length > 32) throw new Error('Trigger rule matcher supports at most 32 conditions.');
  const prompt = String(rule.action.prompt || '');
  if (prompt.length > 24_000) throw new Error('Trigger action prompt exceeds 24,000 characters.');
  const cooldownMs = rule.cooldownMs === undefined
    ? undefined
    : finiteInt(rule.cooldownMs, 0, 0, 30 * 24 * 60 * 60 * 1_000);
  const now = Date.now();
  return {
    ...cloneRule(rule),
    version: TRIGGER_CONTRACT_VERSION,
    id,
    name,
    enabled: rule.enabled !== false,
    priority: finiteInt(rule.priority, 100, 0, 10_000),
    cooldownMs,
    createdAt: finiteTimestamp(rule.createdAt, now),
    updatedAt: finiteTimestamp(rule.updatedAt, now),
  };
}

function validatedPersistedRules(value: unknown): TriggerRule[] {
  if (!Array.isArray(value)) return [];
  const out: TriggerRule[] = [];
  for (const candidate of value.slice(0, MAX_RULES)) {
    try {
      out.push(validateTriggerRule(candidate as TriggerRule));
    } catch (error: any) {
      // One damaged or manually edited rule must not erase unrelated healthy
      // automations. Skip only that rule and leave an operator-visible trace.
      console.warn(`[TriggerStore] Ignoring malformed persisted rule: ${String(error?.message || error).slice(0, 300)}`);
    }
  }
  return out;
}

export class JsonTriggerStore implements TriggerReservationStore {
  private cache: TriggerStoreFile | null = null;

  constructor(private readonly filePath: string, private readonly now: () => number = Date.now) {}

  private read(): TriggerStoreFile {
    if (this.cache) return this.cache;
    if (!fs.existsSync(this.filePath)) {
      this.cache = initialStore();
      return this.cache;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as Partial<TriggerStoreFile>;
      this.cache = {
        version: 1,
        updatedAt: finiteTimestamp(parsed.updatedAt, this.now()),
        rules: validatedPersistedRules(parsed.rules),
        reservations: Array.isArray(parsed.reservations) ? parsed.reservations.filter(Boolean).slice(-MAX_RESERVATIONS) : [],
        lastRunAtByRule: parsed.lastRunAtByRule && typeof parsed.lastRunAtByRule === 'object' ? parsed.lastRunAtByRule : {},
        runs: Array.isArray(parsed.runs) ? parsed.runs.filter(Boolean).slice(-MAX_RUNS) : [],
      };
    } catch (error: any) {
      console.warn(`[TriggerStore] Could not parse trigger store; starting from an empty in-memory store: ${String(error?.message || error).slice(0, 300)}`);
      this.cache = initialStore();
    }
    this.prune(this.cache);
    return this.cache;
  }

  private prune(store: TriggerStoreFile): void {
    const cutoff = this.now() - RESERVATION_TTL_MS;
    store.reservations = store.reservations
      .filter((entry) => entry && Number(entry.reservedAt || 0) >= cutoff)
      .slice(-MAX_RESERVATIONS);
    store.runs = store.runs.slice(-MAX_RUNS);
    const validRuleIds = new Set(store.rules.map((rule) => rule.id));
    for (const ruleId of Object.keys(store.lastRunAtByRule)) {
      if (!validRuleIds.has(ruleId)) delete store.lastRunAtByRule[ruleId];
    }
  }

  private write(): void {
    const store = this.read();
    this.prune(store);
    store.updatedAt = this.now();
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}-${this.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
    fs.renameSync(tmp, this.filePath);
  }

  listRules(): TriggerRule[] {
    return this.read().rules.map(cloneRule);
  }

  getRule(id: string): TriggerRule | null {
    const rule = this.read().rules.find((candidate) => candidate.id === id);
    return rule ? cloneRule(rule) : null;
  }

  upsertRule(input: TriggerRule): TriggerRule {
    const store = this.read();
    const rule = validateTriggerRule({ ...input, updatedAt: this.now() });
    const index = store.rules.findIndex((candidate) => candidate.id === rule.id);
    if (index >= 0) {
      rule.createdAt = store.rules[index].createdAt;
      store.rules[index] = rule;
    } else {
      if (store.rules.length >= MAX_RULES) throw new Error(`Trigger rule limit reached (${MAX_RULES}).`);
      store.rules.push(rule);
    }
    this.write();
    return cloneRule(rule);
  }

  deleteRule(id: string): boolean {
    const store = this.read();
    const before = store.rules.length;
    store.rules = store.rules.filter((rule) => rule.id !== id);
    if (store.rules.length === before) return false;
    delete store.lastRunAtByRule[id];
    store.reservations = store.reservations.filter((entry) => entry.ruleId !== id);
    this.write();
    return true;
  }

  reserve(rule: TriggerRule, event: TriggerEvent, now: number): { ok: boolean; reason?: string } {
    const store = this.read();
    this.prune(store);
    const eventKey = cleanText(event.dedupeKey || event.id, 500);
    const key = `${rule.id}:${eventKey}`;
    if (store.reservations.some((entry) => entry.key === key)) {
      return { ok: false, reason: 'duplicate_event' };
    }
    const lastRunAt = Number(store.lastRunAtByRule[rule.id] || 0);
    const cooldownMs = finiteInt(rule.cooldownMs, 0, 0, 30 * 24 * 60 * 60 * 1_000);
    if (cooldownMs > 0 && lastRunAt > 0 && now - lastRunAt < cooldownMs) {
      return { ok: false, reason: 'cooldown_active' };
    }
    store.reservations.push({
      key,
      ruleId: rule.id,
      eventId: event.id,
      eventDedupeKey: event.dedupeKey,
      reservedAt: now,
    });
    store.lastRunAtByRule[rule.id] = now;
    this.write();
    return { ok: true };
  }

  recordRun(record: TriggerRunRecord): void {
    const store = this.read();
    const index = store.runs.findIndex((run) => run.runId === record.runId);
    if (index >= 0) store.runs[index] = JSON.parse(JSON.stringify(record));
    else store.runs.push(JSON.parse(JSON.stringify(record)));
    this.write();
  }

  listRuns(limit = 100): TriggerRunRecord[] {
    const safeLimit = finiteInt(limit, 100, 1, MAX_RUNS);
    return this.read().runs
      .slice(-safeLimit)
      .reverse()
      .map((record) => JSON.parse(JSON.stringify(record)));
  }
}
