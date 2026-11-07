/**
 * Extra Node execArgv for the gateway child process.
 *
 * Heap limit: --max-old-space-size=min(8192, floor(25% of total RAM in MB)), added only when
 *   that value is at least 4096 (16 GB+ RAM). Below 16 GB no flag is added and V8's default applies.
 *   - PROMETHEUS_GATEWAY_HEAP_LIMIT_MB=<n> overrides the computed value; 0 disables it.
 *   - Skipped when NODE_OPTIONS or the existing execArgv already set max-old-space-size.
 * Near-limit heap snapshots (OFF by default; files can be gigabytes):
 *   - PROMETHEUS_GATEWAY_HEAPSNAPSHOT_NEAR_LIMIT=1 adds
 *     --heapsnapshot-near-heap-limit=1 --diagnostic-dir=<configDir>/logs/heap
 *   - pruneGatewayHeapSnapshots() keeps only the newest .heapsnapshot in that dir.
 *
 * Nothing here is hardcoded to one machine: values come from os.totalmem() at spawn time.
 * electron/main.js does not spawn the gateway node process directly; it spawns the CLI
 * supervisor, which calls gatewayNodeFlagExtras() in src/cli/index.ts.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const GATEWAY_HEAP_MIN_MB = 4096;
export const GATEWAY_HEAP_MAX_MB = 8192;
const MAX_OLD_SPACE_RE = /max[-_]old[-_]space[-_]size/i;
const NEAR_LIMIT_SNAPSHOT_RE = /heapsnapshot-near-heap-limit/i;

/** null = no flag: floor(25% of RAM in MB) is below 4096, so V8's own default already applies (under 16 GB). */
export function computeGatewayHeapLimitMb(totalMemBytes: number): number | null {
  const quarterMb = Math.floor((totalMemBytes * 0.25) / (1024 * 1024));
  if (quarterMb < GATEWAY_HEAP_MIN_MB) return null;
  return Math.min(GATEWAY_HEAP_MAX_MB, quarterMb);
}

export interface GatewayNodeFlagOptions {
  env?: NodeJS.ProcessEnv;
  execArgv?: readonly string[];
  totalMemBytes?: number;
  configDir?: string;
}

function parseOverrideMb(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const value = Number(raw.trim());
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

/** Returns flags to place between process.execArgv and the gateway entry. */
export function gatewayNodeFlagExtras(options: GatewayNodeFlagOptions = {}): string[] {
  const env = options.env ?? process.env;
  const execArgv = options.execArgv ?? process.execArgv;
  const flags: string[] = [];

  const alreadySet = MAX_OLD_SPACE_RE.test(env.NODE_OPTIONS ?? '')
    || execArgv.some((arg) => MAX_OLD_SPACE_RE.test(arg));
  const override = parseOverrideMb(env.PROMETHEUS_GATEWAY_HEAP_LIMIT_MB);
  if (!alreadySet && override !== 0) {
    const mb = override ?? computeGatewayHeapLimitMb(options.totalMemBytes ?? os.totalmem());
    if (mb !== null) flags.push(`--max-old-space-size=${mb}`);
  }

  const snapshotsAlreadySet = execArgv.some((arg) => NEAR_LIMIT_SNAPSHOT_RE.test(arg));
  if (env.PROMETHEUS_GATEWAY_HEAPSNAPSHOT_NEAR_LIMIT === '1' && options.configDir && !snapshotsAlreadySet) {
    flags.push('--heapsnapshot-near-heap-limit=1', `--diagnostic-dir=${path.join(options.configDir, 'logs', 'heap')}`);
  }
  return flags;
}

/** Keeps the newest .heapsnapshot in dir and deletes the rest. Returns the number removed. */
export function pruneGatewayHeapSnapshots(dir: string): number {
  let snapshots: Array<{ full: string; mtimeMs: number }> = [];
  try {
    snapshots = fs.readdirSync(dir)
      .filter((name) => name.endsWith('.heapsnapshot'))
      .map((name) => {
        const full = path.join(dir, name);
        return { full, mtimeMs: fs.statSync(full).mtimeMs };
      });
  } catch {
    return 0;
  }
  snapshots.sort((a, b) => b.mtimeMs - a.mtimeMs);
  let removed = 0;
  for (const snapshot of snapshots.slice(1)) {
    try {
      fs.rmSync(snapshot.full, { force: true });
      removed += 1;
    } catch {
      // Best effort: a locked snapshot is left in place.
    }
  }
  return removed;
}
