import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { StallProfiler, summarizeCpuProfileWindow, type CpuProfile } from './stall-profiler';

// 1. Window summary on a synthetic profile: idle excluded, trailing window only,
//    full stacks walk leaf -> root.
const frame = (functionName: string, line = 0) => ({ functionName, url: 'file:///C:/x/PromSRC/src/gateway/demo.ts', lineNumber: line, columnNumber: 0 });
const synthetic: CpuProfile = {
  nodes: [
    { id: 1, callFrame: { ...frame('(root)'), url: '' }, children: [2, 3] },
    { id: 2, callFrame: { ...frame('(idle)'), url: '' } },
    { id: 3, callFrame: frame('dreamTick', 9), children: [4] },
    { id: 4, callFrame: frame('scanRuntimes', 41) },
  ],
  startTime: 0,
  endTime: 10_000_000,
  // 1s of idle, then 4s inside scanRuntimes, then 5s dreamTick self time.
  samples: [2, 4, 4, 4, 4, 3, 3, 3, 3, 3],
  timeDeltas: [0, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000],
};
const full = summarizeCpuProfileWindow(synthetic, 60_000);
assert.equal(full.sampleCount, 9, 'idle samples are excluded');
assert.equal(full.sampledMs, 9000);
assert.equal(full.topSelf[0].functionName, 'dreamTick');
assert.equal(full.topSelf[0].selfMs, 5000);
assert.equal(full.topSelf[1].frame, 'scanRuntimes src/gateway/demo.ts:42');
assert.deepEqual(full.topStacks[1].frames, ['scanRuntimes src/gateway/demo.ts:42', 'dreamTick src/gateway/demo.ts:10']);
const tail = summarizeCpuProfileWindow(synthetic, 3_000);
assert.equal(tail.sampleCount, 3, 'only the trailing window is summarized');
assert.deepEqual(tail.topSelf.map((f) => f.functionName), ['dreamTick']);

// 2. Live: a real main-thread freeze is attributed to the function that caused it.
function freezeMainThreadForTest(ms: number): number {
  const until = Date.now() + ms;
  let acc = 0;
  while (Date.now() < until) acc = (acc + Math.sqrt(acc + 1)) % 1e9;
  return acc;
}

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-profiler-'));
  const profiler = new StallProfiler({ samplingIntervalUs: 1000, rotateMs: 60_000, minCaptureGapMs: 0, profileDir: dir });
  try {
    assert.equal(profiler.start(), true, 'profiler starts');
    await new Promise((r) => setTimeout(r, 100));
    freezeMainThreadForTest(1200);
    const summary = await new Promise<any>((resolve) => profiler.capture(2000, 'regression', resolve));
    assert.ok(summary, 'capture returns a summary');
    assert.ok(summary.sampledMs >= 800, `sampled the freeze (${summary.sampledMs}ms)`);
    const top = summary.topSelf.slice(0, 3).map((f: any) => f.functionName);
    const inStacks = summary.topStacks.some((s: any) => s.frames.some((f: string) => f.startsWith('freezeMainThreadForTest ')));
    assert.ok(top.includes('freezeMainThreadForTest') || inStacks, `freeze attributed to its function, got ${JSON.stringify(summary.topSelf.slice(0, 5))}`);
    // Raw profile is dumped for DevTools.
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(summary.profilePath && fs.existsSync(summary.profilePath), 'raw .cpuprofile written');
    // Rate limit: a second capture inside the gap is skipped, not queued.
    const limited = new StallProfiler({ minCaptureGapMs: 60_000 });
    limited.start();
    const first = await new Promise<any>((resolve) => limited.capture(1000, 'a', resolve));
    const second = await new Promise<any>((resolve) => limited.capture(1000, 'b', resolve));
    limited.stop();
    assert.ok(first, 'first capture runs');
    assert.equal(second, null, 'second capture inside the gap is skipped');
    // Sampling resumes after a capture.
    assert.equal(profiler.isRunning(), true);
  } finally {
    profiler.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('PASS stall profiler: window summary + live freeze attribution + rate limit');
}

main().catch((err) => { console.error(err); process.exit(1); });
