/**
 * Optional startup-only async resource tracing.
 *
 * The gateway has several deliberately deferred timers and promise continuations.
 * When one of them monopolizes the event loop, a normal heartbeat only tells us
 * that the loop was late; this records the callback type and the stack that
 * created it. It is enabled with PROMETHEUS_STARTUP_DIAGNOSTICS=1 and is
 * intentionally silent in normal gateway runs, because async_hooks is too
 * expensive for the steady-state gateway fast path.
 */

import { createHook, executionAsyncId } from 'node:async_hooks';

interface TraceRecord {
  type: string;
  createdAt: number;
  stack: string;
}

interface ActiveRecord {
  startedAt: number;
  cpu: NodeJS.CpuUsage;
  trace: TraceRecord;
}

const STARTUP_DIAGNOSTICS = process.env.PROMETHEUS_STARTUP_DIAGNOSTICS === '1';
const TRACE_LIFETIME_MS = 120_000;
const TRACE_THRESHOLD_MS = 500;
const MAX_TRACES = 20_000;
const TRACKED_TYPES = new Set(['Timeout', 'Immediate', 'PROMISE']);
const requestContexts = new Map<number, string>();

export function registerStartupAsyncRequest(label: string): void {
  if (!STARTUP_DIAGNOSTICS) return;
  const asyncId = executionAsyncId();
  if (requestContexts.size >= 5_000) requestContexts.clear();
  requestContexts.set(asyncId, String(label || '').slice(0, 200));
}

function trimStack(): string {
  return String(new Error().stack || '')
    .split('\n')
    .slice(3, 10)
    .map((line) => line.trim())
    .join(' <- ');
}

function emit(line: string): void {
  try { process.stderr.write(`[startup-async] ${line}\n`); } catch { /* diagnostics must never affect startup */ }
}

export function installStartupAsyncDiagnostics(): void {
  if (!STARTUP_DIAGNOSTICS) return;

  const startedAt = Date.now();
  const traces = new Map<number, TraceRecord>();
  const active = new Map<number, ActiveRecord>();

  createHook({
    init(asyncId, type, triggerAsyncId) {
      const request = requestContexts.get(triggerAsyncId);
      if (request) requestContexts.set(asyncId, request);
      if (!TRACKED_TYPES.has(type) || traces.size >= MAX_TRACES) return;
      traces.set(asyncId, {
        type,
        createdAt: Date.now(),
        stack: `${request ? `request=${request} ` : ''}${trimStack()}`,
      });
    },
    before(asyncId) {
      const trace = traces.get(asyncId);
      if (!trace || Date.now() - startedAt > TRACE_LIFETIME_MS) return;
      active.set(asyncId, { startedAt: Date.now(), cpu: process.cpuUsage(), trace });
    },
    after(asyncId) {
      const record = active.get(asyncId);
      if (!record) return;
      active.delete(asyncId);
      const endedAt = Date.now();
      const elapsedMs = endedAt - record.startedAt;
      if (elapsedMs < TRACE_THRESHOLD_MS) return;
      const cpu = process.cpuUsage(record.cpu);
      const cpuMs = Math.round(((cpu.user + cpu.system) / 1000) * 10) / 10;
      emit(`type=${record.trace.type} asyncId=${asyncId} callbackMs=${elapsedMs} cpuMs=${cpuMs} ageMs=${endedAt - record.trace.createdAt} stack=${record.trace.stack}`);
    },
    destroy(asyncId) {
      traces.delete(asyncId);
      active.delete(asyncId);
      requestContexts.delete(asyncId);
    },
  }).enable();

  emit(`enabled lifetimeMs=${TRACE_LIFETIME_MS} thresholdMs=${TRACE_THRESHOLD_MS}`);
}

installStartupAsyncDiagnostics();
