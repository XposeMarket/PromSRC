import crypto from 'node:crypto';
import fs from 'node:fs';
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
};

const pendingByPath = new Map<string, Promise<void>>();

function appendTimingLine(logPath: string, line: string): Promise<void> {
  const previous = pendingByPath.get(logPath) || Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await fs.promises.mkdir(path.dirname(logPath), { recursive: true });
      await fs.promises.appendFile(logPath, line, 'utf-8');
    })
    .finally(() => {
      if (pendingByPath.get(logPath) === next) pendingByPath.delete(logPath);
    });
  pendingByPath.set(logPath, next);
  return next;
}

export function createTurnTimingRecorder(
  sessionId: string,
  options: TurnTimingOptions = {},
): TurnTimingRecorder {
  const configDir = getConfig().getConfigDir();
  const enabled = options.enabled ?? (
    process.env.PROMETHEUS_TURN_TIMING === '1'
    || fs.existsSync(path.join(configDir, 'turn-timing.enabled'))
  );
  const startedAt = Number(options.startedAt || Date.now());
  const resolvedSessionId = String(sessionId || 'default').trim() || 'default';
  const turnId = String(options.turnId || crypto.randomUUID());
  const phase = String(options.phase || 'turn');
  const logPath = options.logPath || path.join(configDir, 'logs', 'turn-timing.log');
  let pending = Promise.resolve();

  return {
    enabled,
    sessionId: resolvedSessionId,
    turnId,
    startedAt,
    mark(label: string, extra: Record<string, unknown> = {}): number {
      const now = Date.now();
      if (!enabled) return now;
      const payload = {
        timestamp: new Date(now).toISOString(),
        elapsedMs: now - startedAt,
        sessionId: resolvedSessionId,
        turnId,
        phase,
        label: String(label || 'mark'),
        ...extra,
      };
      pending = appendTimingLine(logPath, `${JSON.stringify(payload)}\n`);
      return now;
    },
    async flush(): Promise<void> {
      await pending.catch(() => undefined);
    },
  };
}
