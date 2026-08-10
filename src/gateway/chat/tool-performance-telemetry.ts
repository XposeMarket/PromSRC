import crypto from 'node:crypto';
import type { TurnTimingRecorder } from './turn-timing';

export type ToolPerformanceFamily =
  | 'desktop'
  | 'browser'
  | 'workspace'
  | 'terminal'
  | 'web_search_fetch'
  | 'mcp_connector'
  | 'subagent_task'
  | 'creative_media'
  | 'skills_memory'
  | 'automation'
  | 'core'
  | 'other';

export interface ToolPerformanceRecord {
  telemetryId: string;
  toolName: string;
  family: ToolPerformanceFamily;
  providerToolCallId?: string;
  round: number;
  emittedAt: number;
  dispatchStartedAt?: number;
  executorStartedAt?: number;
  firstEventAt?: number;
  completedAt?: number;
  serializedAt?: number;
  deliveredAt?: number;
  modelDeliveredAt?: number;
  nextVisibleTokenAt?: number;
  error?: boolean;
  resultBytes?: number;
  resultTokens?: number;
  eventCount: number;
  state: 'emitted' | 'running' | 'completed' | 'failed' | 'cancelled' | 'abandoned';
}

function safeToolName(value: unknown): string {
  return String(value || 'unknown_tool').trim().replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 120) || 'unknown_tool';
}

export function inferToolPerformanceFamily(toolName: unknown): ToolPerformanceFamily {
  const name = String(toolName || '').trim().toLowerCase();
  if (name.startsWith('desktop_')) return 'desktop';
  if (name.startsWith('browser_')) return 'browser';
  if (name.startsWith('mcp__')) return 'mcp_connector';
  if (name.startsWith('connector_') || name.startsWith('x_') || name.startsWith('vercel_')) return 'mcp_connector';
  if (name.includes('subagent') || name.includes('team_') || name.includes('agent_') || name.includes('background_') || name.includes('dispatch')) return 'subagent_task';
  if (name.startsWith('web_') || name.includes('search') || name.includes('fetch')) return 'web_search_fetch';
  if (name.startsWith('terminal') || name.startsWith('run_command') || name.startsWith('start_process') || name.startsWith('process_') || name === 'shell' || name === 'workspace_run') return 'terminal';
  if (name.startsWith('workspace_') || name.startsWith('dev_source_') || name.includes('file') || name.includes('source_') || name === 'grep_file' || name === 'list_directory') return 'workspace';
  if (name.startsWith('creative_') || name.startsWith('media_') || name.startsWith('generate_') || name.includes('video') || name.includes('image')) return 'creative_media';
  if (name.startsWith('skill') || name.startsWith('memory') || name.includes('context')) return 'skills_memory';
  if (name.startsWith('schedule') || name.startsWith('automation') || name.startsWith('cron_')) return 'automation';
  if (name === 'request_tool_category' || name === 'declare_plan' || name === 'complete_plan_step' || name === 'tool_loop_continue' || name === 'timer') return 'core';
  return 'other';
}

function durationMs(startedAt: number | undefined, finishedAt: number | undefined): number | undefined {
  if (!Number.isFinite(Number(startedAt)) || !Number.isFinite(Number(finishedAt))) return undefined;
  return Math.max(0, Math.round(Number(finishedAt) - Number(startedAt)));
}

function resultByteLength(result: unknown): number {
  const text = typeof result === 'string' ? result : (() => {
    try { return JSON.stringify(result ?? null) || ''; } catch { return ''; }
  })();
  return Buffer.byteLength(text, 'utf8');
}

/**
 * Cross-boundary tool timing with numeric/category fields only. The tracker
 * never receives or writes tool arguments or result contents; it only uses
 * their byte length for bounded transport diagnostics.
 */
export class ToolPerformanceTracker {
  private readonly records = new Map<string, ToolPerformanceRecord>();
  private readonly byProviderCallId = new Map<string, string>();
  private readonly startedAt = Date.now();

  constructor(
    private readonly timing: TurnTimingRecorder,
    abortSignal?: AbortSignal,
  ) {
    abortSignal?.addEventListener('abort', () => {
      for (const record of this.records.values()) {
        if (record.state === 'emitted' || record.state === 'running') {
          record.state = 'cancelled';
          this.emit(record, 'cancelled');
        }
      }
    }, { once: true });
  }

  start(toolName: unknown, providerToolCallId: unknown, round: number): ToolPerformanceRecord {
    const providerId = String(providerToolCallId || '').trim();
    const record: ToolPerformanceRecord = {
      telemetryId: `tool_${crypto.randomBytes(8).toString('hex')}`,
      toolName: safeToolName(toolName),
      family: inferToolPerformanceFamily(toolName),
      providerToolCallId: providerId || undefined,
      round: Math.max(0, Math.floor(Number(round) || 0)),
      emittedAt: Date.now(),
      eventCount: 0,
      state: 'emitted',
    };
    this.records.set(record.telemetryId, record);
    if (providerId) this.byProviderCallId.set(providerId, record.telemetryId);
    this.emit(record, 'call_emitted', { round: record.round });
    return record;
  }

  find(providerToolCallId?: unknown, telemetryId?: unknown, toolName?: unknown): ToolPerformanceRecord | undefined {
    const direct = String(telemetryId || '').trim();
    if (direct && this.records.has(direct)) return this.records.get(direct);
    const providerId = String(providerToolCallId || '').trim();
    const mapped = providerId ? this.byProviderCallId.get(providerId) : undefined;
    if (mapped) return this.records.get(mapped);
    const name = safeToolName(toolName);
    return [...this.records.values()].reverse().find((record) => record.toolName === name && !record.completedAt);
  }

  dispatch(record: ToolPerformanceRecord | undefined): void {
    if (!record || record.dispatchStartedAt) return;
    record.dispatchStartedAt = Date.now();
    record.state = 'running';
    this.emit(record, 'dispatch_start');
  }

  executorStart(record: ToolPerformanceRecord | undefined): void {
    if (!record || record.executorStartedAt) return;
    record.executorStartedAt = Date.now();
    this.emit(record, 'executor_start');
  }

  event(record: ToolPerformanceRecord | undefined, eventKind = 'tool_event'): void {
    if (!record) return;
    record.eventCount += 1;
    if (!record.firstEventAt) {
      record.firstEventAt = Date.now();
      this.emit(record, 'first_output', { eventKind });
    }
  }

  complete(record: ToolPerformanceRecord | undefined, result: unknown, error = false): void {
    if (!record || record.completedAt) return;
    record.completedAt = Date.now();
    record.error = Boolean(error);
    record.resultBytes = resultByteLength(result);
    record.resultTokens = Math.max(0, Math.ceil(record.resultBytes / 4));
    record.state = error ? 'failed' : 'completed';
    this.emit(record, 'complete', {
      error: record.error,
      resultBytes: record.resultBytes,
      resultTokens: record.resultTokens,
      eventCount: record.eventCount,
    });
  }

  transport(record: ToolPerformanceRecord | undefined, phase: 'serialized' | 'delivered', payload?: unknown): void {
    if (!record) return;
    const at = Date.now();
    if (phase === 'serialized') {
      record.serializedAt ||= at;
      this.emit(record, 'result_serialized', { resultBytes: record.resultBytes ?? resultByteLength(payload) });
    } else {
      record.deliveredAt ||= at;
      this.emit(record, 'result_delivered', {
        resultBytes: record.resultBytes,
        transportMs: durationMs(record.serializedAt, at),
      });
    }
  }

  beforeModelRound(): void {
    const at = Date.now();
    for (const record of this.records.values()) {
      if (record.completedAt && !record.modelDeliveredAt) {
        record.modelDeliveredAt = at;
        this.emit(record, 'result_to_model', {
          modelDeliveryMs: durationMs(record.completedAt, at),
          totalWallMs: durationMs(record.emittedAt, at),
        });
      }
    }
  }

  nextVisibleToken(): void {
    const at = Date.now();
    for (const record of this.records.values()) {
      if (record.modelDeliveredAt && !record.nextVisibleTokenAt) {
        record.nextVisibleTokenAt = at;
        this.emit(record, 'next_visible_token', {
          modelToVisibleMs: durationMs(record.modelDeliveredAt, at),
        });
      }
    }
  }

  markStreamEvent(providerToolCallId: unknown, telemetryId: unknown, toolName: unknown, eventKind: string): void {
    this.event(this.find(providerToolCallId, telemetryId, toolName), eventKind);
  }

  markSse(event: string, data: any, phase: 'before' | 'after'): void {
    if (event !== 'tool_call' && event !== 'tool_progress' && event !== 'tool_result') return;
    const record = this.find(data?.toolCallId || data?.tool_call_id, data?.telemetryId, data?.action || data?.name);
    if (!record) return;
    if (event === 'tool_progress') this.event(record, 'tool_progress');
    if (event === 'tool_result') {
      if (phase === 'before') {
        this.complete(record, data?.result, Boolean(data?.error || data?.success === false));
        this.transport(record, 'serialized', data?.result);
      }
      else this.transport(record, 'delivered');
    }
  }

  decorate(event: string, data: any): any {
    if (event !== 'tool_call' && event !== 'tool_progress' && event !== 'tool_result') return data;
    const record = this.find(data?.toolCallId || data?.tool_call_id, data?.telemetryId, data?.action || data?.name);
    if (!record) return data;
    return {
      ...(data || {}),
      traceId: this.timing.turnId,
      telemetryId: record.telemetryId,
      telemetry: {
        ...(data?.telemetry && typeof data.telemetry === 'object' ? data.telemetry : {}),
        ...this.snapshot(record),
      },
    };
  }

  markClientVisible(telemetryId: unknown): void {
    const record = this.find(undefined, telemetryId);
    if (!record) return;
    this.emit(record, 'client_visible');
  }

  closeUnfinished(): void {
    for (const record of this.records.values()) {
      if (!record.completedAt && (record.state === 'emitted' || record.state === 'running')) {
        record.state = 'abandoned';
        this.emit(record, 'abandoned');
      }
    }
  }

  snapshot(record: ToolPerformanceRecord | undefined): Record<string, unknown> {
    if (!record) return {};
    return {
      telemetryId: record.telemetryId,
      toolCallId: record.telemetryId,
      toolFamily: record.family,
      toolName: record.toolName,
      eventCount: record.eventCount,
      resultBytes: record.resultBytes,
      resultTokens: record.resultTokens,
      dispatchMs: durationMs(record.dispatchStartedAt, record.completedAt),
      executorMs: durationMs(record.executorStartedAt, record.completedAt),
      firstOutputMs: durationMs(record.dispatchStartedAt, record.firstEventAt),
      resultToModelMs: durationMs(record.completedAt, record.modelDeliveredAt),
      modelToVisibleMs: durationMs(record.modelDeliveredAt, record.nextVisibleTokenAt),
      toolWallMs: durationMs(record.emittedAt, record.completedAt),
      transportMs: durationMs(record.serializedAt, record.deliveredAt),
      state: record.state,
      error: record.error,
    };
  }

  getRecords(): ToolPerformanceRecord[] {
    return [...this.records.values()].map((record) => ({ ...record }));
  }

  private emit(record: ToolPerformanceRecord, stage: string, extra: Record<string, unknown> = {}): void {
    this.timing.mark(`tool.${stage}`, {
      traceId: this.timing.turnId,
      telemetryId: record.telemetryId,
      toolCallId: record.telemetryId,
      toolName: record.toolName,
      toolFamily: record.family,
      round: record.round,
      eventCount: record.eventCount,
      toolWallMs: durationMs(record.emittedAt, Date.now()),
      ...extra,
    });
  }
}
