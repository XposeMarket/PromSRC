/**
 * Gateway memory high-water log.
 *
 * The OS keeps only the process's peak RSS, with no timestamp, so a spike that
 * a later GC gives back (Nov 16 2026: 3.9 GB peak, back to 1.1 GB within the
 * hour) cannot be explained after the fact. The runtime heartbeat calls
 * `nextMemoryHighWater` every 5 s. It looks at the larger of the current RSS
 * and the OS max-RSS counter (process.resourceUsage().maxRSS), so a spike that
 * rose and fell between two heartbeats is still caught. Whenever that peak
 * climbs a full step above the last logged peak (and is above a floor), one
 * line is appended to `<configDir>/logs/gateway-memory-highwater.ndjson`
 * naming what was running at that moment.
 *
 * Diagnostics only: nothing here changes the memory-pressure recycle logic.
 * Lines per process are bounded by (peak - floor) / step, so the file stays
 * small (tens of lines per gateway lifetime at most).
 */
import type { LiveRuntimeSnapshot } from '../live-runtime-registry';

export const MEMORY_HIGHWATER_DEFAULT_FLOOR_BYTES = 1536 * 1024 * 1024;
export const MEMORY_HIGHWATER_DEFAULT_STEP_BYTES = 256 * 1024 * 1024;
export const MEMORY_HIGHWATER_MAX_RUNTIMES = 20;
export const MEMORY_HIGHWATER_LOG_FILE = 'gateway-memory-highwater.ndjson';

export interface MemoryHighWaterState {
  /** Peak bytes at the last logged line; 0 = nothing logged yet. */
  lastLoggedPeakBytes: number;
  lastLoggedAt: number;
}

export function createMemoryHighWaterState(): MemoryHighWaterState {
  return { lastLoggedPeakBytes: 0, lastLoggedAt: 0 };
}

export interface MemoryHighWaterDecision {
  log: boolean;
  peakBytes: number;
  /** The OS peak is well above the current reading: the spike happened between samples. */
  caughtBetweenSamples: boolean;
}

export function nextMemoryHighWater(input: {
  state: MemoryHighWaterState;
  rssBytes: number;
  /** process.resourceUsage().maxRSS converted to bytes; 0 when unavailable. */
  maxRssBytes: number;
  floorBytes?: number;
  stepBytes?: number;
  now: number;
}): MemoryHighWaterDecision {
  const floor = Math.max(0, input.floorBytes ?? MEMORY_HIGHWATER_DEFAULT_FLOOR_BYTES);
  const step = Math.max(1, input.stepBytes ?? MEMORY_HIGHWATER_DEFAULT_STEP_BYTES);
  const rss = Math.max(0, Number(input.rssBytes) || 0);
  const maxRss = Math.max(0, Number(input.maxRssBytes) || 0);
  const peakBytes = Math.max(rss, maxRss);
  const caughtBetweenSamples = maxRss > rss + step;
  if (peakBytes < floor) return { log: false, peakBytes, caughtBetweenSamples };
  const last = input.state.lastLoggedPeakBytes;
  if (last > 0 && peakBytes < last + step) return { log: false, peakBytes, caughtBetweenSamples };
  input.state.lastLoggedPeakBytes = peakBytes;
  input.state.lastLoggedAt = input.now;
  return { log: true, peakBytes, caughtBetweenSamples };
}

export interface MemoryHighWaterRuntimeSummary {
  id: string;
  kind: string;
  label: string;
  sessionId?: string;
  agentId?: string;
  taskId?: string;
  teamId?: string;
  ageSec: number;
}

export function summarizeRuntimesForHighWater(
  runtimes: Array<Pick<LiveRuntimeSnapshot, 'id' | 'kind' | 'label' | 'sessionId' | 'agentId' | 'taskId' | 'teamId' | 'startedAt'>>,
  now: number,
  max = MEMORY_HIGHWATER_MAX_RUNTIMES,
): { runtimes: MemoryHighWaterRuntimeSummary[]; omitted: number } {
  const sorted = [...(runtimes || [])].sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
  const kept = sorted.slice(0, Math.max(0, max)).map((r) => {
    const out: MemoryHighWaterRuntimeSummary = {
      id: String(r.id || ''),
      kind: String(r.kind || ''),
      label: String(r.label || '').slice(0, 120),
      ageSec: r.startedAt ? Math.max(0, Math.round((now - r.startedAt) / 1000)) : 0,
    };
    if (r.sessionId) out.sessionId = String(r.sessionId);
    if (r.agentId) out.agentId = String(r.agentId);
    if (r.taskId) out.taskId = String(r.taskId);
    if (r.teamId) out.teamId = String(r.teamId);
    return out;
  });
  return { runtimes: kept, omitted: Math.max(0, sorted.length - kept.length) };
}

const MB = 1024 * 1024;
const toMb = (bytes: number) => Math.round((Number(bytes) || 0) / MB);

export function buildMemoryHighWaterEvent(input: {
  now: number;
  pid: number;
  uptimeSec: number;
  decision: MemoryHighWaterDecision;
  previousPeakBytes: number;
  memory: Pick<NodeJS.MemoryUsage, 'rss' | 'heapUsed' | 'heapTotal' | 'external' | 'arrayBuffers'>;
  heapLimitBytes: number;
  modelBusyCount: number;
  lastMainSessionId: string;
  runtimes: Array<Pick<LiveRuntimeSnapshot, 'id' | 'kind' | 'label' | 'sessionId' | 'agentId' | 'taskId' | 'teamId' | 'startedAt'>>;
  runtimeWorkers?: unknown;
}): Record<string, unknown> {
  const { runtimes, omitted } = summarizeRuntimesForHighWater(input.runtimes, input.now);
  return {
    timestamp: new Date(input.now).toISOString(),
    event: 'memory_high_water',
    pid: input.pid,
    uptimeSec: Math.round(input.uptimeSec),
    peakMb: toMb(input.decision.peakBytes),
    previousPeakMb: toMb(input.previousPeakBytes),
    caughtBetweenSamples: input.decision.caughtBetweenSamples,
    memoryMb: {
      rss: toMb(input.memory.rss),
      heapUsed: toMb(input.memory.heapUsed),
      heapTotal: toMb(input.memory.heapTotal),
      external: toMb(input.memory.external),
      arrayBuffers: toMb(input.memory.arrayBuffers),
      heapLimit: toMb(input.heapLimitBytes),
    },
    modelBusyCount: input.modelBusyCount,
    lastMainSessionId: input.lastMainSessionId,
    runningRuntimeCount: runtimes.length + omitted,
    runtimes,
    ...(omitted > 0 ? { runtimesOmitted: omitted } : {}),
    ...(input.runtimeWorkers !== undefined ? { runtimeWorkers: input.runtimeWorkers } : {}),
  };
}

/** One-line console summary, e.g. for the gateway stdout log. */
export function formatMemoryHighWaterLine(event: Record<string, any>): string {
  const kinds = Array.isArray(event.runtimes)
    ? event.runtimes.map((r: MemoryHighWaterRuntimeSummary) => `${r.kind}:${r.label || r.sessionId || r.id}`).slice(0, 5).join(', ')
    : '';
  const between = event.caughtBetweenSamples ? ' (spike between samples)' : '';
  return `[GatewayMemory] New high-water ${event.peakMb} MB${between}; rss ${event.memoryMb?.rss} MB, heap ${event.memoryMb?.heapUsed}/${event.memoryMb?.heapLimit} MB; running ${event.runningRuntimeCount}${kinds ? `: ${kinds}` : ''}`;
}
