/**
 * Serializes managed-team work.
 *
 * A team is a shared state machine: member runs, room turns, and direct
 * follow-ups all read and write the same team state and workspace. Running
 * those operations concurrently makes admission pressure and state races look
 * like agent failures. Keep the queue deliberately small and FIFO so a burst
 * becomes visible queued work instead of a burst of model executions.
 */

export type TeamExecutionQueueErrorCode = 'TEAM_EXECUTION_QUEUE_FULL' | 'TEAM_EXECUTION_ABANDONED';

export class TeamExecutionQueueError extends Error {
  constructor(
    message: string,
    readonly code: TeamExecutionQueueErrorCode,
  ) {
    super(message);
    this.name = 'TeamExecutionQueueError';
  }
}

interface QueueEntry<T> {
  work: () => Promise<T> | T;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (error: unknown) => void;
  onStarted?: () => void;
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed)
    ? Math.max(min, Math.min(max, Math.floor(parsed)))
    : fallback;
}

export interface TeamExecutionQueueSnapshot {
  maxPendingPerTeam: number;
  teams: Array<{ teamId: string; active: boolean; queued: number }>;
}

export class TeamExecutionQueue {
  readonly maxPendingPerTeam: number;
  private readonly activeTeams = new Set<string>();
  readonly leaseMs: number;
  private readonly pending = new Map<string, QueueEntry<unknown>[]>();

  /**
   * `leaseMs` bounds how long one execution may hold its team slot. An
   * execution that never settles (for example a model turn that hangs after a
   * tool error) is abandoned at the lease: the slot is released so queued work
   * proceeds, and the caller rejects with TEAM_EXECUTION_ABANDONED.
   */
  constructor(
    maxPendingPerTeam = envInt('PROMETHEUS_TEAM_MAX_PENDING', 16, 0, 256),
    leaseMs = envInt('PROMETHEUS_TEAM_EXEC_LEASE_MS', 90 * 60_000, 1_000, 24 * 60 * 60_000),
  ) {
    this.maxPendingPerTeam = Math.max(0, Math.floor(maxPendingPerTeam));
    this.leaseMs = Math.max(1, Math.floor(leaseMs));
  }

  run<T>(
    teamId: string,
    work: () => Promise<T> | T,
    options: { onStarted?: () => void } = {},
  ): Promise<T> {
    const normalizedTeamId = String(teamId || '').trim();
    if (!normalizedTeamId) {
      options.onStarted?.();
      return Promise.resolve().then(work);
    }

    const queue = this.pending.get(normalizedTeamId) || [];
    if (!this.activeTeams.has(normalizedTeamId) && queue.length === 0) {
      this.activeTeams.add(normalizedTeamId);
      options.onStarted?.();
      return this.execute(normalizedTeamId, { work, resolve: () => {}, reject: () => {}, onStarted: undefined }, true);
    }

    if (queue.length >= this.maxPendingPerTeam) {
      return Promise.reject(new TeamExecutionQueueError(
        `Team ${normalizedTeamId} already has ${queue.length} queued execution(s); retry after the current team run finishes.`,
        'TEAM_EXECUTION_QUEUE_FULL',
      ));
    }

    return new Promise<T>((resolve, reject) => {
      const entry: QueueEntry<T> = {
        work,
        resolve,
        reject,
        onStarted: options.onStarted,
      };
      const next = [...queue, entry as QueueEntry<unknown>];
      this.pending.set(normalizedTeamId, next);
    });
  }

  snapshot(): TeamExecutionQueueSnapshot {
    const teamIds = new Set<string>([
      ...this.activeTeams,
      ...this.pending.keys(),
    ]);
    return {
      maxPendingPerTeam: this.maxPendingPerTeam,
      teams: Array.from(teamIds).sort().map((teamId) => ({
        teamId,
        active: this.activeTeams.has(teamId),
        queued: this.pending.get(teamId)?.length || 0,
      })),
    };
  }

  clear(): void {
    this.activeTeams.clear();
    this.pending.clear();
  }

  private async execute<T>(
    teamId: string,
    entry: QueueEntry<T>,
    direct: boolean,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const lease = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new TeamExecutionQueueError(
        `Team ${teamId} execution did not settle within ${this.leaseMs}ms and was abandoned; its team slot was released.`,
        'TEAM_EXECUTION_ABANDONED',
      )), this.leaseMs);
      timer.unref?.();
    });
    void lease.catch(() => {});
    try {
      // Start work synchronously, as before; a late settle after the lease is ignored.
      const started = (async () => entry.work())();
      return await Promise.race([started, lease]);
    } catch (error) {
      if (direct) throw error;
      entry.reject(error);
      throw error;
    } finally {
      clearTimeout(timer);
      this.drain(teamId);
    }
  }

  private drain(teamId: string): void {
    const queue = this.pending.get(teamId) || [];
    const next = queue.shift();
    if (!next) {
      this.pending.delete(teamId);
      this.activeTeams.delete(teamId);
      return;
    }
    if (queue.length === 0) this.pending.delete(teamId);
    else this.pending.set(teamId, queue);

    next.onStarted?.();
    void this.execute(teamId, next, false)
      .then(next.resolve)
      .catch(next.reject);
  }
}

export const teamExecutionQueue = new TeamExecutionQueue();
