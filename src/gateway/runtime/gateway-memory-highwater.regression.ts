// Memory high-water log: logs once per step above the floor, catches spikes
// that happened between heartbeat samples via the OS max-RSS counter, and
// names what was running.
import assert from 'node:assert/strict';
import {
  buildMemoryHighWaterEvent,
  createMemoryHighWaterState,
  formatMemoryHighWaterLine,
  MEMORY_HIGHWATER_MAX_RUNTIMES,
  nextMemoryHighWater,
  summarizeRuntimesForHighWater,
} from './gateway-memory-highwater';

const MB = 1024 * 1024;
const floorBytes = 1536 * MB;
const stepBytes = 256 * MB;

// Below the floor: never logs.
{
  const state = createMemoryHighWaterState();
  const d = nextMemoryHighWater({ state, rssBytes: 1200 * MB, maxRssBytes: 1400 * MB, floorBytes, stepBytes, now: 1 });
  assert.equal(d.log, false);
  assert.equal(state.lastLoggedPeakBytes, 0);
}

// First crossing logs; small growth does not; a full step does.
{
  const state = createMemoryHighWaterState();
  assert.equal(nextMemoryHighWater({ state, rssBytes: 1600 * MB, maxRssBytes: 1600 * MB, floorBytes, stepBytes, now: 1 }).log, true);
  assert.equal(state.lastLoggedPeakBytes, 1600 * MB);
  assert.equal(nextMemoryHighWater({ state, rssBytes: 1800 * MB, maxRssBytes: 1800 * MB, floorBytes, stepBytes, now: 2 }).log, false);
  assert.equal(nextMemoryHighWater({ state, rssBytes: 1856 * MB, maxRssBytes: 1856 * MB, floorBytes, stepBytes, now: 3 }).log, true);
  assert.equal(state.lastLoggedAt, 3);
  // Memory falling back never logs and never lowers the mark.
  assert.equal(nextMemoryHighWater({ state, rssBytes: 1100 * MB, maxRssBytes: 1856 * MB, floorBytes, stepBytes, now: 4 }).log, false);
  assert.equal(state.lastLoggedPeakBytes, 1856 * MB);
}

// A spike between samples (OS peak far above current RSS) is still caught and flagged.
{
  const state = createMemoryHighWaterState();
  const d = nextMemoryHighWater({ state, rssBytes: 1100 * MB, maxRssBytes: 3900 * MB, floorBytes, stepBytes, now: 5 });
  assert.equal(d.log, true);
  assert.equal(d.peakBytes, 3900 * MB);
  assert.equal(d.caughtBetweenSamples, true);
}

// Missing / garbage max-RSS falls back to current RSS.
{
  const state = createMemoryHighWaterState();
  const d = nextMemoryHighWater({ state, rssBytes: 2000 * MB, maxRssBytes: Number.NaN, floorBytes, stepBytes, now: 6 });
  assert.equal(d.log, true);
  assert.equal(d.peakBytes, 2000 * MB);
  assert.equal(d.caughtBetweenSamples, false);
}

// Bounded lines: climbing from floor to 4 GB in 50 MB ticks logs at most ~ (4096-1536)/256 + 1 times.
{
  const state = createMemoryHighWaterState();
  let lines = 0;
  for (let mb = 1000; mb <= 4096; mb += 50) {
    if (nextMemoryHighWater({ state, rssBytes: mb * MB, maxRssBytes: mb * MB, floorBytes, stepBytes, now: mb }).log) lines += 1;
  }
  assert.ok(lines >= 9 && lines <= 11, `expected ~10 lines, got ${lines}`);
}

// Runtime summary: oldest first, capped, label trimmed, optional ids only when present.
{
  const now = 100_000;
  const runtimes: any[] = Array.from({ length: MEMORY_HIGHWATER_MAX_RUNTIMES + 3 }, (_, i) => ({
    id: `rt${i}` as string,
    kind: i === 0 ? 'main_chat' : 'background_agent',
    label: i === 0 ? 'x'.repeat(300) : `agent ${i}`,
    sessionId: i === 0 ? 'mobile_abc' : undefined,
    startedAt: now - (i + 1) * 1000,
  })) as any[];
  const { runtimes: kept, omitted } = summarizeRuntimesForHighWater(runtimes, now);
  assert.equal(kept.length, MEMORY_HIGHWATER_MAX_RUNTIMES);
  assert.equal(omitted, 3);
  const expectedOldestId: string = 'rt' + String(MEMORY_HIGHWATER_MAX_RUNTIMES + 2);
  assert.equal(String(kept[0].id), expectedOldestId); // oldest first
  const main = summarizeRuntimesForHighWater([runtimes[0]], now).runtimes[0];
  assert.equal(main.label.length, 120);
  assert.equal(main.sessionId, 'mobile_abc');
  assert.equal(main.ageSec, 1);
  assert.equal('agentId' in main, false);
}

// Event shape + console line.
{
  const state = createMemoryHighWaterState();
  const decision = nextMemoryHighWater({ state, rssBytes: 1200 * MB, maxRssBytes: 3900 * MB, floorBytes, stepBytes, now: 1_700_000_000_000 });
  const event: any = buildMemoryHighWaterEvent({
    now: 1_700_000_000_000,
    pid: 42,
    uptimeSec: 612.4,
    decision,
    previousPeakBytes: 0,
    memory: { rss: 1200 * MB, heapUsed: 800 * MB, heapTotal: 900 * MB, external: 100 * MB, arrayBuffers: 90 * MB },
    heapLimitBytes: 4144 * MB,
    modelBusyCount: 1,
    lastMainSessionId: 'mobile_abc',
    runtimes: [{ id: 'r1', kind: 'main_chat', label: 'Check memory', sessionId: 'mobile_abc', startedAt: 1_700_000_000_000 - 30_000 }] as any,
  });
  assert.equal(event.event, 'memory_high_water');
  assert.equal(event.peakMb, 3900);
  assert.equal(event.caughtBetweenSamples, true);
  assert.equal(event.uptimeSec, 612);
  assert.equal(event.memoryMb.heapLimit, 4144);
  assert.equal(event.runningRuntimeCount, 1);
  assert.equal('runtimesOmitted' in event, false);
  assert.equal('runtimeWorkers' in event, false);
  const line = formatMemoryHighWaterLine(event);
  assert.match(line, /New high-water 3900 MB \(spike between samples\)/);
  assert.match(line, /main_chat:Check memory/);
}

console.log('gateway-memory-highwater regression: PASS');
