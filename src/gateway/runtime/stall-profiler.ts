// Rolling low-rate V8 CPU profile for the gateway main thread.
//
// Event-loop stall records used to carry only timings (drift, cpuMs), so a
// 90s freeze could be shown to happen but never attributed to code. V8's
// sampling profiler runs on its own thread and keeps sampling while JS blocks
// the main thread, and window rotation runs on a main-thread timer that cannot
// fire during a freeze. So when the heartbeat notices a stall, the current
// profile window always spans the whole stall; stopping it then names the code
// that burned the time.

import inspector from 'node:inspector';
import fs from 'fs';
import path from 'path';

export interface CpuProfileCallFrame {
  functionName: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
  scriptId?: string;
}

export interface CpuProfileNode {
  id: number;
  callFrame: CpuProfileCallFrame;
  children?: number[];
  hitCount?: number;
}

export interface CpuProfile {
  nodes: CpuProfileNode[];
  startTime: number;
  endTime: number;
  samples?: number[];
  timeDeltas?: number[];
}

export interface StallProfileFrame {
  frame: string;
  functionName: string;
  selfMs: number;
  percent: number;
}

export interface StallProfileStack {
  selfMs: number;
  percent: number;
  /** Leaf first. */
  frames: string[];
}

export interface StallProfileSummary {
  windowMs: number;
  sampledMs: number;
  sampleCount: number;
  topSelf: StallProfileFrame[];
  topStacks: StallProfileStack[];
  profilePath?: string;
}

const IDLE_FRAME = '(idle)';
const ROOT_FRAME = '(root)';

function shortUrl(url: string): string {
  if (!url) return '';
  const clean = url.replace(/^file:\/\/\/?/, '').replace(/\\/g, '/');
  const idx = clean.search(/\/(src|dist|node_modules)\//);
  return idx >= 0 ? clean.slice(idx + 1) : clean.split('/').slice(-3).join('/');
}

export function describeFrame(frame: CpuProfileCallFrame): string {
  const name = frame.functionName || '(anonymous)';
  const url = shortUrl(frame.url);
  return url ? `${name} ${url}:${frame.lineNumber + 1}` : name;
}

function roundMs(us: number): number {
  return Math.round(us / 100) / 10;
}

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

/**
 * Summarize the trailing `windowMs` of a V8 CPU profile: top self-time frames
 * and the heaviest full stacks. Idle samples are excluded; GC and "(program)"
 * are kept because they are real main-thread time.
 */
export function summarizeCpuProfileWindow(
  profile: CpuProfile,
  windowMs: number,
  options: { topSelf?: number; topStacks?: number; stackDepth?: number } = {},
): StallProfileSummary {
  const topSelfLimit = options.topSelf ?? 12;
  const topStackLimit = options.topStacks ?? 5;
  const stackDepth = options.stackDepth ?? 14;
  const samples = profile.samples || [];
  const deltas = profile.timeDeltas || [];
  const byId = new Map<number, CpuProfileNode>();
  const parentOf = new Map<number, number>();
  for (const node of profile.nodes || []) {
    byId.set(node.id, node);
    for (const child of node.children || []) parentOf.set(child, node.id);
  }

  const times: number[] = new Array(samples.length);
  let cursor = Number(profile.startTime) || 0;
  for (let i = 0; i < samples.length; i++) {
    cursor += Number(deltas[i]) || 0;
    times[i] = cursor;
  }
  const lastSample = samples.length ? times[samples.length - 1] : 0;
  const endUs = Math.max(Number(profile.endTime) || 0, lastSample);
  const fromUs = endUs - Math.max(0, windowMs) * 1000;

  const selfByNode = new Map<number, number>();
  let sampledUs = 0;
  let sampleCount = 0;
  for (let i = 0; i < samples.length; i++) {
    if (times[i] < fromUs) continue;
    const next = i + 1 < samples.length ? times[i + 1] : endUs;
    const weight = Math.max(0, next - times[i]);
    const node = byId.get(samples[i]);
    if (!node || node.callFrame.functionName === IDLE_FRAME) continue;
    selfByNode.set(node.id, (selfByNode.get(node.id) || 0) + weight);
    sampledUs += weight;
    sampleCount += 1;
  }

  const selfByFrame = new Map<string, { functionName: string; us: number }>();
  for (const [id, us] of selfByNode) {
    const frame = byId.get(id)!.callFrame;
    const key = describeFrame(frame);
    const entry = selfByFrame.get(key) || { functionName: frame.functionName || '(anonymous)', us: 0 };
    entry.us += us;
    selfByFrame.set(key, entry);
  }
  const topSelf = [...selfByFrame.entries()]
    .sort((a, b) => b[1].us - a[1].us)
    .slice(0, topSelfLimit)
    .map(([frame, entry]) => ({ frame, functionName: entry.functionName, selfMs: roundMs(entry.us), percent: pct(entry.us, sampledUs) }));

  const topStacks = [...selfByNode.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topStackLimit)
    .map(([id, us]) => {
      const frames: string[] = [];
      let current: number | undefined = id;
      while (current !== undefined && frames.length < stackDepth) {
        const node = byId.get(current);
        if (!node || node.callFrame.functionName === ROOT_FRAME) break;
        frames.push(describeFrame(node.callFrame));
        current = parentOf.get(current);
      }
      return { selfMs: roundMs(us), percent: pct(us, sampledUs), frames };
    });

  return { windowMs, sampledMs: roundMs(sampledUs), sampleCount, topSelf, topStacks };
}

// ─── Rolling profiler ──────────────────────────────────────────────────────────

export interface StallProfilerOptions {
  /** V8 sampling interval in microseconds. 10ms keeps overhead negligible. */
  samplingIntervalUs?: number;
  /** Discard and restart the rolling profile this often (bounds memory). */
  rotateMs?: number;
  /** Minimum gap between two captures. */
  minCaptureGapMs?: number;
  /** Keep at most this many .cpuprofile files on disk. */
  maxProfileFiles?: number;
  /** Directory for raw .cpuprofile dumps; omit to skip writing them. */
  profileDir?: string;
}

type PostFn = (method: string, params?: Record<string, unknown>, cb?: (err: Error | null, result?: any) => void) => void;

export class StallProfiler {
  private session: inspector.Session | null = null;
  private rotateTimer: NodeJS.Timeout | null = null;
  private running = false;
  private capturing = false;
  private lastCaptureAt = 0;
  private readonly opts: Required<Omit<StallProfilerOptions, 'profileDir'>> & { profileDir?: string };

  constructor(options: StallProfilerOptions = {}) {
    this.opts = {
      samplingIntervalUs: Math.max(1000, options.samplingIntervalUs ?? 10_000),
      rotateMs: Math.max(5_000, options.rotateMs ?? 60_000),
      minCaptureGapMs: Math.max(0, options.minCaptureGapMs ?? 30_000),
      maxProfileFiles: Math.max(1, options.maxProfileFiles ?? 12),
      profileDir: options.profileDir,
    };
  }

  isRunning(): boolean { return this.running; }

  private post: PostFn = (method, params, cb) => {
    const session = this.session;
    if (!session) { cb?.(new Error('profiler session closed')); return; }
    try {
      session.post(method, params || {}, (err: Error | null, result?: any) => cb?.(err, result));
    } catch (err: any) {
      cb?.(err instanceof Error ? err : new Error(String(err)));
    }
  };

  start(): boolean {
    if (this.running) return true;
    try {
      this.session = new inspector.Session();
      this.session.connect();
    } catch {
      this.session = null;
      return false;
    }
    this.running = true;
    this.post('Profiler.enable', {}, () => {
      this.post('Profiler.setSamplingInterval', { interval: this.opts.samplingIntervalUs }, () => {
        this.post('Profiler.start');
      });
    });
    // The rotation timer runs on the main thread, so it can never fire in the
    // middle of a freeze: the live window always contains the whole stall.
    this.rotateTimer = setInterval(() => this.rotate(), this.opts.rotateMs);
    this.rotateTimer.unref?.();
    return true;
  }

  stop(): void {
    if (this.rotateTimer) { clearInterval(this.rotateTimer); this.rotateTimer = null; }
    if (!this.running) return;
    this.running = false;
    const session = this.session;
    this.session = null;
    try { session?.post('Profiler.stop', () => { try { session.disconnect(); } catch {} }); } catch {
      try { session?.disconnect(); } catch {}
    }
  }

  private rotate(): void {
    if (!this.running || this.capturing) return;
    this.post('Profiler.stop', {}, () => this.post('Profiler.start'));
  }

  /**
   * Stop the current window, summarize its trailing `stallMs`, optionally dump
   * the raw profile, then resume sampling. `done` always fires exactly once.
   */
  capture(stallMs: number, label: string, done: (summary: StallProfileSummary | null) => void): void {
    let settled = false;
    const finish = (summary: StallProfileSummary | null) => {
      if (settled) return;
      settled = true;
      this.capturing = false;
      if (this.running) this.post('Profiler.start');
      done(summary);
    };
    const now = Date.now();
    if (!this.running || this.capturing || now - this.lastCaptureAt < this.opts.minCaptureGapMs) {
      settled = true;
      done(null);
      return;
    }
    this.capturing = true;
    this.lastCaptureAt = now;
    this.post('Profiler.stop', {}, (err, result) => {
      if (err || !result?.profile) { finish(null); return; }
      let summary: StallProfileSummary | null = null;
      try {
        summary = summarizeCpuProfileWindow(result.profile as CpuProfile, stallMs);
        const filePath = this.writeProfile(result.profile, label, now);
        if (filePath) summary.profilePath = filePath;
      } catch {}
      finish(summary);
    });
  }

  private writeProfile(profile: unknown, label: string, now: number): string | undefined {
    const dir = this.opts.profileDir;
    if (!dir) return undefined;
    fs.mkdirSync(dir, { recursive: true });
    const safe = String(label || 'stall').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40);
    const filePath = path.join(dir, `${new Date(now).toISOString().replace(/[:.]/g, '-')}-${safe}.cpuprofile`);
    fs.writeFile(filePath, JSON.stringify(profile), () => this.pruneProfiles(dir));
    return filePath;
  }

  private pruneProfiles(dir: string): void {
    fs.readdir(dir, (err, names) => {
      if (err) return;
      const profiles = names.filter((n) => n.endsWith('.cpuprofile')).sort();
      for (const name of profiles.slice(0, Math.max(0, profiles.length - this.opts.maxProfileFiles))) {
        fs.unlink(path.join(dir, name), () => undefined);
      }
    });
  }
}
