import crypto from 'node:crypto';
import fs from 'node:fs';
import inspector from 'node:inspector';
import path from 'node:path';
import { getConfig } from '../../config/config';

export interface TurnTimingRecorder {
  readonly enabled: boolean;
  readonly sessionId: string;
  readonly turnId: string;
  readonly startedAt: number;
  mark(label: string, extra?: Record<string, unknown>): number;
  flush(): Promise<void>;
}

type TurnTimingOptions = {
  enabled?: boolean;
  startedAt?: number;
  turnId?: string;
  phase?: string;
  logPath?: string;
  /** Override the per-file retention limit for tests or embedded deployments. */
  maxLogBytes?: number;
  /** Number of rotated log files to retain alongside the active log. */
  maxRotatedLogs?: number;
};

const pendingByPath = new Map<string, Promise<void>>();
const knownSizeByPath = new Map<string, number>();
const DEFAULT_MAX_LOG_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_ROTATED_LOGS = 4;

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}

function serializeTimingLine(payload: Record<string, unknown>, maxLogBytes: number): string {
  const line = `${JSON.stringify(payload)}\n`;
  if (Buffer.byteLength(line, 'utf8') <= maxLogBytes) return line;

  // A timing mark must never let an unexpectedly large diagnostic extra defeat
  // retention. Keep the identifiers and stage name, and discard only extras.
  return `${JSON.stringify({
    timestamp: payload.timestamp,
    elapsedMs: payload.elapsedMs,
    sessionId: String(payload.sessionId || '').slice(0, 256),
    turnId: String(payload.turnId || '').slice(0, 256),
    phase: String(payload.phase || '').slice(0, 256),
    label: String(payload.label || 'mark').slice(0, 512),
    telemetryTruncated: true,
  })}\n`;
}

async function getFileSize(filePath: string): Promise<number | null> {
  try {
    return (await fs.promises.stat(filePath)).size;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function getKnownLogSize(logPath: string): Promise<number> {
  const knownSize = knownSizeByPath.get(logPath);
  if (knownSize !== undefined) return knownSize;
  const size = (await getFileSize(logPath)) || 0;
  knownSizeByPath.set(logPath, size);
  return size;
}

async function removeIfPresent(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath);
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

/**
 * Rotate before an append that would exceed the active-log limit. Every file
 * retained here is bounded, including any oversized legacy log encountered on
 * the first write after upgrading to always-on telemetry.
 */
async function rotateTimingLog(
  logPath: string,
  activeSize: number,
  maxLogBytes: number,
  maxRotatedLogs: number,
): Promise<void> {
  await removeIfPresent(`${logPath}.${maxRotatedLogs}`);
  for (let index = maxRotatedLogs - 1; index >= 1; index -= 1) {
    const source = `${logPath}.${index}`;
    const size = await getFileSize(source);
    if (size === null) continue;
    if (size > maxLogBytes) {
      await removeIfPresent(source);
      continue;
    }
    await fs.promises.rename(source, `${logPath}.${index + 1}`);
  }

  if (activeSize > maxLogBytes) {
    await fs.promises.truncate(logPath, 0);
  } else if (activeSize > 0) {
    await fs.promises.rename(logPath, `${logPath}.1`);
  }
  knownSizeByPath.set(logPath, 0);
}

function appendTimingLine(
  logPath: string,
  line: string,
  maxLogBytes: number,
  maxRotatedLogs: number,
): Promise<void> {
  const previous = pendingByPath.get(logPath) || Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await fs.promises.mkdir(path.dirname(logPath), { recursive: true });
      const currentSize = await getKnownLogSize(logPath);
      const lineBytes = Buffer.byteLength(line, 'utf8');
      if (currentSize + lineBytes > maxLogBytes) {
        await rotateTimingLog(logPath, currentSize, maxLogBytes, maxRotatedLogs);
      }
      try {
        await fs.promises.appendFile(logPath, line, 'utf-8');
        const sizeAfterRotation = knownSizeByPath.get(logPath) || 0;
        knownSizeByPath.set(logPath, sizeAfterRotation + lineBytes);
      } catch (error) {
        // A failed external edit/delete should not poison future telemetry.
        knownSizeByPath.delete(logPath);
        throw error;
      }
    })
    .finally(() => {
      if (pendingByPath.get(logPath) === next) pendingByPath.delete(logPath);
    });
  pendingByPath.set(logPath, next);
  return next;
}

// ── On-demand TTFT CPU profiling ────────────────────────────────────────────
// Turn prep has shown ~1-1.6s main-thread stalls (worker results and budget
// timers delivered late). Touch `<configDir>/logs/ttft-profile.flag` to capture
// a V8 CPU profile from request_received to provider_request_start for the
// next few turns. Profiles land in `<configDir>/logs/ttft-profiles/`.
const TTFT_PROFILE_MAX_TURNS = 3;
let ttftProfileActiveTurn = '';
let ttftProfileSession: any = null;
let ttftProfilesTaken = 0;
let ttftProfileFlagSeenAt = 0;

function ttftProfileFlagPath(configDir: string): string {
  return path.join(configDir, 'logs', 'ttft-profile.flag');
}

function maybeStartTtftProfile(configDir: string, turnId: string): void {
  if (ttftProfileActiveTurn) return;
  let flagMtime = 0;
  try { flagMtime = fs.statSync(ttftProfileFlagPath(configDir)).mtimeMs; } catch { return; }
  if (flagMtime !== ttftProfileFlagSeenAt) { ttftProfileFlagSeenAt = flagMtime; ttftProfilesTaken = 0; }
  if (ttftProfilesTaken >= TTFT_PROFILE_MAX_TURNS) return;
  try {
    const session = new inspector.Session();
    session.connect();
    session.post('Profiler.enable', () => {
      session.post('Profiler.setSamplingInterval', { interval: 500 }, () => {
        session.post('Profiler.start');
      });
    });
    ttftProfileSession = session;
    ttftProfileActiveTurn = turnId;
    ttftProfilesTaken += 1;
  } catch {
    ttftProfileSession = null;
    ttftProfileActiveTurn = '';
  }
}

function maybeStopTtftProfile(configDir: string, turnId: string): void {
  if (!ttftProfileSession || ttftProfileActiveTurn !== turnId) return;
  const session = ttftProfileSession;
  ttftProfileSession = null;
  ttftProfileActiveTurn = '';
  try {
    session.post('Profiler.stop', (error: any, result: any) => {
      try {
        if (!error && result?.profile) {
          const dir = path.join(configDir, 'logs', 'ttft-profiles');
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFile(path.join(dir, `${Date.now()}-${turnId.slice(0, 8)}.cpuprofile`), JSON.stringify(result.profile), () => undefined);
        }
      } finally {
        try { session.disconnect(); } catch {}
      }
    });
  } catch {
    try { session.disconnect(); } catch {}
  }
}

export function createTurnTimingRecorder(
  sessionId: string,
  options: TurnTimingOptions = {},
): TurnTimingRecorder {
  const configDir = getConfig().getConfigDir();
  // Turn timing is intentionally on for every chat turn. It is lightweight,
  // bounded on disk below, and is the only reliable way to diagnose TTFT
  // regressions after the fact. `enabled: false` remains useful for tests.
  const enabled = options.enabled ?? true;
  const startedAt = Number(options.startedAt || Date.now());
  const resolvedSessionId = String(sessionId || 'default').trim() || 'default';
  const turnId = String(options.turnId || crypto.randomUUID());
  const phase = String(options.phase || 'turn');
  const logPath = options.logPath || path.join(configDir, 'logs', 'turn-timing.log');
  const maxLogBytes = Math.max(512, normalizePositiveInteger(options.maxLogBytes, DEFAULT_MAX_LOG_BYTES));
  const maxRotatedLogs = normalizePositiveInteger(options.maxRotatedLogs, DEFAULT_MAX_ROTATED_LOGS);
  let pending = Promise.resolve();

  return {
    enabled,
    sessionId: resolvedSessionId,
    turnId,
    startedAt,
    mark(label: string, extra: Record<string, unknown> = {}): number {
      const now = Date.now();
      if (!enabled) return now;
      if (label === 'request_received') maybeStartTtftProfile(configDir, turnId);
      else if (label === 'provider_request_start') maybeStopTtftProfile(configDir, turnId);
      const payload = {
        timestamp: new Date(now).toISOString(),
        elapsedMs: now - startedAt,
        sessionId: resolvedSessionId,
        turnId,
        phase,
        label: String(label || 'mark'),
        ...extra,
      };
      pending = appendTimingLine(logPath, serializeTimingLine(payload, maxLogBytes), maxLogBytes, maxRotatedLogs);
      return now;
    },
    async flush(): Promise<void> {
      await pending.catch(() => undefined);
    },
  };
}
