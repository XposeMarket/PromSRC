import type { ModelUsageEvent } from '../providers/model-usage.js';

export type HubUsageAnalyticsRange = '24h' | '7d' | '30d';

export interface HubUsageTotals {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  requests: number;
  costMicros: number;
  pricedRequests: number;
  cacheHitPercent: number;
}

type UsageRow = HubUsageTotals & { provider?: string; model?: string; name?: string; averageDurationMs?: number };

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function emptyTotals(): HubUsageTotals {
  return { totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, requests: 0, costMicros: 0, pricedRequests: 0, cacheHitPercent: 0 };
}

function rangeMs(range: HubUsageAnalyticsRange): number {
  return range === '24h' ? 24 * 60 * 60_000 : range === '7d' ? 7 * 24 * 60 * 60_000 : 30 * 24 * 60 * 60_000;
}

export function normalizeHubUsageAnalyticsRange(value: unknown): HubUsageAnalyticsRange {
  const range = String(value || '').trim().toLowerCase();
  return range === '24h' || range === '7d' || range === '30d' ? range : '7d';
}

function add(target: HubUsageTotals, event: ModelUsageEvent): { durationMs: number } {
  const inputTokens = number(event.inputTokens);
  const outputTokens = number(event.outputTokens);
  const cacheReadTokens = number(event.cacheReadTokens);
  const cacheWriteTokens = number(event.cacheWriteTokens);
  const totalTokens = number(event.totalTokens) || inputTokens + outputTokens + number(event.reasoningTokens) + cacheReadTokens + cacheWriteTokens;
  // Only count prices recorded on usage events; do not manufacture costs for unpriced logs.
  const hasRecordedCost = typeof event.totalCostMicros === 'number'
    && Object.prototype.hasOwnProperty.call(event, 'totalCostMicros')
    && Number.isFinite(Number(event.totalCostMicros))
    && Number(event.totalCostMicros) >= 0;
  const costMicros = hasRecordedCost ? number(event.totalCostMicros) : 0;
  target.inputTokens += inputTokens;
  target.outputTokens += outputTokens;
  target.cacheReadTokens += cacheReadTokens;
  target.cacheWriteTokens += cacheWriteTokens;
  target.totalTokens += totalTokens;
  target.requests += 1;
  target.costMicros += costMicros;
  if (hasRecordedCost) target.pricedRequests += 1;
  return { durationMs: number(event.durationMs) };
}

function finalize<T extends HubUsageTotals>(row: T): T {
  row.cacheHitPercent = row.inputTokens + row.cacheReadTokens > 0
    ? Math.round((row.cacheReadTokens / (row.inputTokens + row.cacheReadTokens)) * 10_000) / 100
    : 0;
  return row;
}

/** Pure deterministic aggregation for the Hub analytics endpoint. */
export function aggregateHubUsageAnalytics(events: ModelUsageEvent[], input: { range?: unknown; provider?: unknown; now?: number } = {}) {
  const range = normalizeHubUsageAnalyticsRange(input.range);
  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
  const since = now - rangeMs(range);
  const providerFilter = String(input.provider || '').trim();
  const bucketMs = range === '24h' ? 60 * 60_000 : 24 * 60 * 60_000;
  const totals = emptyTotals();
  const providers = new Set<string>();
  const models = new Map<string, UsageRow & { durationTotal: number; durationRequests: number }>();
  const agents = new Map<string, UsageRow>();
  const surfaces = new Map<string, UsageRow>();
  const series = new Map<number, Record<string, number>>();
  // Preserve real time spacing, including quiet hours/days and partial edge buckets.
  for (let at = Math.floor(since / bucketMs) * bucketMs; at <= now; at += bucketMs) series.set(at, Object.create(null));
  let validTimestampEvents = 0;
  let inRangeEvents = 0;

  for (const event of events) {
    const timestamp = Date.parse(event.timestamp || '');
    if (!Number.isFinite(timestamp)) continue;
    validTimestampEvents += 1;
    if (timestamp < since || timestamp > now) continue;
    const provider = String(event.provider || 'unknown').trim() || 'unknown';
    // Provider choices describe all in-range data, even when this response is filtered.
    providers.add(provider);
    if (providerFilter && provider !== providerFilter) continue;
    inRangeEvents += 1;
    const model = String(event.model || 'unknown').trim() || 'unknown';
    const modelKey = `${provider}\u0000${model}`;
    let modelRow = models.get(modelKey);
    if (!modelRow) { modelRow = { ...emptyTotals(), provider, model, durationTotal: 0, durationRequests: 0 }; models.set(modelKey, modelRow); }
    const duration = add(totals, event);
    add(modelRow, event);
    if (duration.durationMs > 0) { modelRow.durationTotal += duration.durationMs; modelRow.durationRequests += 1; }
    const agentName = String(event.agentId || '').trim() || 'unattributed';
    let agent = agents.get(agentName);
    if (!agent) { agent = { ...emptyTotals(), name: agentName }; agents.set(agentName, agent); }
    add(agent, event);
    // executionMode is the recorded client surface; deliberately do not infer mobile.
    const surfaceName = String(event.executionMode || '').trim() || 'unknown';
    let surface = surfaces.get(surfaceName);
    if (!surface) { surface = { ...emptyTotals(), name: surfaceName }; surfaces.set(surfaceName, surface); }
    add(surface, event);
    const bucket = Math.floor(timestamp / bucketMs) * bucketMs;
    const values = series.get(bucket) || Object.create(null);
    const seriesKey = `${provider}/${model}`;
    values[seriesKey] = (values[seriesKey] || 0) + (number(event.totalTokens) || number(event.inputTokens) + number(event.outputTokens) + number(event.reasoningTokens) + number(event.cacheReadTokens) + number(event.cacheWriteTokens));
    series.set(bucket, values);
  }

  const modelRows = [...models.values()].map((row) => {
    const { durationTotal, durationRequests, ...result } = row;
    return finalize({ ...result, averageDurationMs: durationRequests ? Math.round(durationTotal / durationRequests) : undefined });
  }).sort((a, b) => b.totalTokens - a.totalTokens || `${a.provider}/${a.model}`.localeCompare(`${b.provider}/${b.model}`));
  const named = (rows: Map<string, UsageRow>) => [...rows.values()].map((row) => finalize(row)).sort((a, b) => b.totalTokens - a.totalTokens || String(a.name).localeCompare(String(b.name)));
  return {
    range,
    providers: [...providers].sort(),
    totals: finalize(totals),
    models: modelRows,
    series: [...series.entries()].sort(([a], [b]) => a - b).map(([timestamp, values]) => ({ timestamp: new Date(timestamp).toISOString(), values })),
    agents: named(agents),
    surfaces: named(surfaces),
    activity: [],
    coverage: { since: new Date(since).toISOString(), until: new Date(now).toISOString(), sourceEvents: events.length, validTimestampEvents, inRangeEvents, providerFilter: providerFilter || null, bucket: range === '24h' ? 'hour' : 'day' },
  };
}
