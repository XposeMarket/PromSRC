/**
 * End-to-end turn traces.
 *
 * Every agent turn (main chat, background agent, subagent task, team member,
 * cron, Brain…) runs inside handleChat, which opens a trace. The trace id is
 * carried through AsyncLocalStorage, so anything that happens on that turn's
 * async path (model calls, tool dispatch decisions, tool execution, approvals,
 * child agents) records a span against the same id without threading it
 * through every signature. A child agent spawned from a traced turn gets its
 * own trace whose parentTraceId points back, so a delegation tree can be read
 * from the root.
 *
 * Spans are appended to <configDir>/traces/YYYY-MM-DD.jsonl (bounded) and kept
 * in a small in-memory ring for the API (GET /api/traces/:traceId).
 */
import { AsyncLocalStorage } from 'async_hooks';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export type TraceSpanKind =
  | 'turn'
  | 'model_call'
  | 'tool_dispatch'
  | 'tool'
  | 'approval'
  | 'child_agent';

export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentTraceId?: string;
  kind: TraceSpanKind;
  name: string;
  sessionId?: string;
  status: 'ok' | 'error' | 'refused' | 'pending' | 'approved' | 'rejected' | 'aborted';
  startedAt: number;
  durationMs?: number;
  attrs?: Record<string, string | number | boolean | undefined>;
}

export interface TraceContext {
  traceId: string;
  parentTraceId?: string;
  sessionId: string;
  executionMode?: string;
}

const storage = new AsyncLocalStorage<TraceContext>();
const RING_LIMIT = 4_000;
const ring: TraceSpan[] = [];
const MAX_FILE_BYTES = 20 * 1024 * 1024;
let traceDir: string | null = null;
let sink: ((span: TraceSpan) => void) | null = null;

/** Where spans are persisted. Unset (tests) keeps them in memory only. */
export function setTraceDirectory(dir: string | null): void {
  traceDir = dir;
}

/** Extra sink, e.g. for tests. */
export function setTraceSink(fn: ((span: TraceSpan) => void) | null): void {
  sink = fn;
}

export function newTraceId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export function currentTrace(): TraceContext | undefined {
  return storage.getStore();
}

/**
 * Run fn inside a trace. Reuses the caller's trace when the same session is
 * already traced (nested handleChat for the same turn); otherwise starts a new
 * trace whose parent is the enclosing one (a child agent).
 */
export function runInTrace<T>(input: { sessionId: string; executionMode?: string; traceId?: string }, fn: () => T): T {
  const outer = storage.getStore();
  if (outer && outer.sessionId === input.sessionId && !input.traceId) return fn();
  const ctx: TraceContext = {
    traceId: input.traceId || newTraceId(),
    parentTraceId: outer?.traceId,
    sessionId: input.sessionId,
    executionMode: input.executionMode,
  };
  return storage.run(ctx, fn);
}

function bounded(value: unknown, max = 200): string | number | boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const text = String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function recordSpan(span: Omit<TraceSpan, 'traceId' | 'spanId' | 'parentTraceId' | 'sessionId'> & { traceId?: string; sessionId?: string }): TraceSpan | null {
  const ctx = storage.getStore();
  const traceId = span.traceId || ctx?.traceId;
  if (!traceId) return null;
  const attrs: Record<string, string | number | boolean | undefined> = {};
  for (const [key, value] of Object.entries(span.attrs || {})) {
    const v = bounded(value);
    if (v !== undefined) attrs[key] = v;
  }
  const full: TraceSpan = {
    traceId,
    spanId: crypto.randomUUID().slice(0, 12),
    ...(ctx?.parentTraceId && traceId === ctx.traceId ? { parentTraceId: ctx.parentTraceId } : {}),
    kind: span.kind,
    name: String(span.name || span.kind).slice(0, 120),
    sessionId: span.sessionId || ctx?.sessionId,
    status: span.status,
    startedAt: span.startedAt,
    ...(typeof span.durationMs === 'number' ? { durationMs: Math.max(0, Math.round(span.durationMs)) } : {}),
    ...(Object.keys(attrs).length ? { attrs } : {}),
  };
  ring.push(full);
  if (ring.length > RING_LIMIT) ring.splice(0, ring.length - RING_LIMIT);
  try { sink?.(full); } catch { /* sinks never break the turn */ }
  persist(full);
  return full;
}

/** Time an async operation as a span on the current trace. */
export async function withSpan<T>(
  kind: TraceSpanKind,
  name: string,
  attrs: TraceSpan['attrs'],
  fn: () => Promise<T>,
  statusOf?: (value: T) => TraceSpan['status'],
): Promise<T> {
  if (!storage.getStore()) return fn();
  const startedAt = Date.now();
  try {
    const value = await fn();
    recordSpan({ kind, name, attrs, startedAt, durationMs: Date.now() - startedAt, status: statusOf ? statusOf(value) : 'ok' });
    return value;
  } catch (err: any) {
    recordSpan({ kind, name, attrs: { ...(attrs || {}), error: String(err?.message || err) }, startedAt, durationMs: Date.now() - startedAt, status: 'error' });
    throw err;
  }
}

function persist(span: TraceSpan): void {
  if (!traceDir) return;
  try {
    fs.mkdirSync(traceDir, { recursive: true });
    const file = path.join(traceDir, `${new Date(span.startedAt).toISOString().slice(0, 10)}.jsonl`);
    try {
      if (fs.statSync(file).size > MAX_FILE_BYTES) return;
    } catch { /* new file */ }
    fs.appendFileSync(file, `${JSON.stringify(span)}\n`, 'utf8');
  } catch { /* tracing never breaks a turn */ }
}

/** Spans for a trace, plus its direct child traces (child agents). */
export function getTrace(traceId: string): { traceId: string; spans: TraceSpan[]; childTraceIds: string[] } {
  const id = String(traceId || '').trim();
  let spans = ring.filter((s) => s.traceId === id);
  if (!spans.length && traceDir) spans = readPersisted((s) => s.traceId === id);
  const childTraceIds = Array.from(new Set(
    (ring.some((s) => s.parentTraceId === id) ? ring : (traceDir ? readPersisted((s) => s.parentTraceId === id) : []))
      .filter((s) => s.parentTraceId === id)
      .map((s) => s.traceId),
  ));
  return { traceId: id, spans: spans.sort((a, b) => a.startedAt - b.startedAt), childTraceIds };
}

export function listRecentTraces(limit = 50): Array<{ traceId: string; sessionId?: string; parentTraceId?: string; startedAt: number; spans: number; name?: string }> {
  const byTrace = new Map<string, { traceId: string; sessionId?: string; parentTraceId?: string; startedAt: number; spans: number; name?: string }>();
  for (const span of ring) {
    const entry = byTrace.get(span.traceId) || { traceId: span.traceId, sessionId: span.sessionId, parentTraceId: span.parentTraceId, startedAt: span.startedAt, spans: 0 };
    entry.spans += 1;
    entry.startedAt = Math.min(entry.startedAt, span.startedAt);
    if (span.kind === 'turn') entry.name = span.name;
    byTrace.set(span.traceId, entry);
  }
  return [...byTrace.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, Math.max(1, limit));
}

function readPersisted(match: (s: TraceSpan) => boolean): TraceSpan[] {
  if (!traceDir || !fs.existsSync(traceDir)) return [];
  const out: TraceSpan[] = [];
  const files = fs.readdirSync(traceDir).filter((f) => f.endsWith('.jsonl')).sort().slice(-3);
  for (const file of files) {
    for (const line of fs.readFileSync(path.join(traceDir, file), 'utf8').split('\n')) {
      if (!line) continue;
      try {
        const span = JSON.parse(line) as TraceSpan;
        if (match(span)) out.push(span);
      } catch { /* skip bad line */ }
    }
  }
  return out;
}

export function clearTraceRingForTesting(): void {
  ring.length = 0;
}
