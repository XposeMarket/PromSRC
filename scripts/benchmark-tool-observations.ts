import fs from 'node:fs';
import path from 'node:path';
import { readAllToolObservations, type ToolObservation } from '../src/gateway/tool-observations.js';
import { getToolRegistry } from '../src/tools/registry.js';
import { inferToolPerformanceFamily } from '../src/gateway/chat/tool-performance-telemetry.js';
import { ensurePrometheusExtensionRuntimeLoaded } from '../src/extensions/legacy-connector-adapter.js';
import { getExtensionRuntimeRegistry } from '../src/extensions/runtime-registry.js';

type Accumulator = {
  calls: number;
  successes: number;
  failures: number;
  retries: number;
  durationMs: number;
  durations: number[];
  argsTokens: number;
  resultTokens: number;
  contextTokens: number;
  resultBytes: number;
  costMicros: number;
  turnIds: Set<string>;
};

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percentile(values: number[], quantile: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))]);
}

function newAccumulator(): Accumulator {
  return {
    calls: 0,
    successes: 0,
    failures: 0,
    retries: 0,
    durationMs: 0,
    durations: [],
    argsTokens: 0,
    resultTokens: 0,
    contextTokens: 0,
    resultBytes: 0,
    costMicros: 0,
    turnIds: new Set<string>(),
  };
}

function addObservation(accumulator: Accumulator, observation: ToolObservation, retry: boolean): void {
  const duration = numberValue(observation.durationMs);
  const estimate = observation.tokenEstimate || {};
  accumulator.calls += 1;
  accumulator.successes += observation.status === 'ok' ? 1 : 0;
  accumulator.failures += observation.status === 'error' ? 1 : 0;
  accumulator.retries += retry ? 1 : 0;
  accumulator.durationMs += duration;
  if (duration > 0) accumulator.durations.push(duration);
  accumulator.argsTokens += numberValue(estimate.argsTokens);
  accumulator.resultTokens += numberValue(estimate.resultTokens);
  accumulator.contextTokens += numberValue(estimate.totalTokens);
  accumulator.resultBytes += numberValue(estimate.resultBytes);
  accumulator.costMicros += numberValue(estimate.totalCostMicros || estimate.contextCostMicros);
  if (observation.turnId) accumulator.turnIds.add(observation.turnId);
}

function serializeAccumulator(accumulator: Accumulator): Record<string, unknown> {
  return {
    calls: accumulator.calls,
    successes: accumulator.successes,
    failures: accumulator.failures,
    errorRate: accumulator.calls ? Number((accumulator.failures / accumulator.calls).toFixed(4)) : 0,
    retries: accumulator.retries,
    turns: accumulator.turnIds.size,
    totalDurationMs: Math.round(accumulator.durationMs),
    avgDurationMs: accumulator.calls ? Number((accumulator.durationMs / accumulator.calls).toFixed(2)) : 0,
    p50Ms: percentile(accumulator.durations, 0.5),
    p95Ms: percentile(accumulator.durations, 0.95),
    p99Ms: percentile(accumulator.durations, 0.99),
    argsTokens: Math.round(accumulator.argsTokens),
    resultTokens: Math.round(accumulator.resultTokens),
    contextTokens: Math.round(accumulator.contextTokens),
    resultBytes: Math.round(accumulator.resultBytes),
    estimatedCostUsd: Number((accumulator.costMicros / 1_000_000).toFixed(6)),
  };
}

function aggregate(observations: ToolObservation[], currentToolNames: Set<string>, extensionNames: Set<string>): Record<string, unknown> {
  const byTool = new Map<string, Accumulator>();
  const byFamily = new Map<string, Accumulator>();
  const previousStatus = new Map<string, ToolObservation['status']>();
  const add = (map: Map<string, Accumulator>, key: string, observation: ToolObservation, retry: boolean) => {
    const accumulator = map.get(key) || newAccumulator();
    addObservation(accumulator, observation, retry);
    map.set(key, accumulator);
  };

  for (const observation of observations) {
    const signature = `${observation.sessionId}:${observation.toolName}`;
    const retry = previousStatus.get(signature) === 'error';
    previousStatus.set(signature, observation.status);
    add(byTool, observation.toolName, observation, retry);
    add(byFamily, inferToolPerformanceFamily(observation.toolName), observation, retry);
  }

  const serializedTools = [...byTool.entries()].map(([tool, accumulator]) => ({
    tool,
    family: inferToolPerformanceFamily(tool),
    source: extensionNames.has(tool) ? 'extension' : currentToolNames.has(tool) ? 'native' : 'historical_only',
    currentlyRegistered: currentToolNames.has(tool),
    ...serializeAccumulator(accumulator),
  }));
  const serializedFamilies = [...byFamily.entries()].map(([family, accumulator]) => ({
    family,
    ...serializeAccumulator(accumulator),
  }));
  const totals = serializeAccumulator(observations.reduce((accumulator, observation) => {
    const retry = false;
    addObservation(accumulator, observation, retry);
    return accumulator;
  }, newAccumulator()));
  const top = (field: string, limit = 20) => [...serializedTools]
    .sort((a: any, b: any) => numberValue(b[field]) - numberValue(a[field]) || String(a.tool).localeCompare(String(b.tool)))
    .slice(0, limit);
  const createdTimes = observations
    .map((observation) => numberValue(observation.createdAt))
    .filter((value) => value > 0)
    .sort((a, b) => a - b);

  return {
    observations: observations.length,
    window: {
      startedAt: createdTimes.length ? new Date(createdTimes[0]).toISOString() : null,
      endedAt: createdTimes.length ? new Date(createdTimes[createdTimes.length - 1]).toISOString() : null,
    },
    uniqueTools: serializedTools.length,
    uniqueFamilies: serializedFamilies.length,
    currentRegisteredTools: serializedTools.filter((row: any) => row.currentlyRegistered).length,
    currentNativeObservedTools: serializedTools.filter((row: any) => row.source === 'native').length,
    historicalOnlyTools: serializedTools.filter((row: any) => row.source === 'historical_only').length,
    totals,
    byFamily: serializedFamilies.sort((a, b) => String(a.family).localeCompare(String(b.family))),
    byTool: serializedTools.sort((a, b) => String(a.tool).localeCompare(String(b.tool))),
    topByTotalDuration: top('totalDurationMs'),
    topByContextTokens: top('contextTokens'),
    topByEstimatedCost: top('estimatedCostUsd'),
    topByFailures: top('failures'),
  };
}

function configuredLimit(): number {
  const parsed = Number(process.env.PROMETHEUS_TOOL_OBSERVATIONS_LIMIT || 50_000);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(250_000, Math.floor(parsed))) : 50_000;
}

function outputPath(): string | undefined {
  const index = process.argv.indexOf('--output');
  if (index >= 0 && process.argv[index + 1]) return path.resolve(process.argv[index + 1]);
  const configured = String(process.env.PROMETHEUS_TOOL_OBSERVATIONS_OUTPUT || '').trim();
  return configured ? path.resolve(configured) : undefined;
}

ensurePrometheusExtensionRuntimeLoaded();
const extensionNames = new Set(getExtensionRuntimeRegistry().listTools().map((tool) => tool.name));
const currentToolNames = new Set(getToolRegistry().list().map((tool) => tool.name));
const observations = readAllToolObservations(configuredLimit());
const report = {
  schemaVersion: 1,
  benchmark: 'prometheus-tool-observations',
  capturedAt: new Date().toISOString(),
  scope: {
    source: 'persisted tool-observations JSONL',
    observationLimit: configuredLimit(),
    activeRuntimeExtensionTools: extensionNames.size,
    currentRegisteredTools: currentToolNames.size,
  },
  measurementContract: {
    latency: 'durationMs from universal tool telemetry; p50/p95/p99 use observed calls with positive duration.',
    tokens: 'args/result/context token estimates recorded with each observation; not provider billing usage.',
    cost: 'estimatedCostMicros from recorded telemetry; not a provider invoice.',
    window: 'The report exposes the oldest and newest retained observation timestamps; persisted history is not a controlled current baseline.',
    privacy: 'Only tool names, families, counts, sizes, timings, and costs are emitted; previews and payload contents are excluded.',
  },
  aggregate: aggregate(observations, currentToolNames, extensionNames),
};
const destination = outputPath();
if (destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify(report, null, 2));
