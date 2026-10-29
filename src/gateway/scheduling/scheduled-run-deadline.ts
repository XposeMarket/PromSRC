/** One deadline shared by all waits in a scheduled run, including synthesis. */
export class ScheduledRunDeadline {
  readonly abortSignal = { aborted: false, reason: '' };
  private error?: Error;
  private reject!: (error: Error) => void;
  private readonly stopped = new Promise<never>((_resolve, reject) => { this.reject = reject; });
  private readonly timer: ReturnType<typeof setTimeout>;
  constructor(readonly timeoutMs: number) {
    // Attach immediately: a deadline can expire between awaited operations.
    void this.stopped.catch(() => {});
    this.timer = setTimeout(() => this.fail(new Error(`Scheduled run timed out after ${timeoutMs}ms.`)), timeoutMs);
    this.timer.unref?.();
  }
  fail(error: Error): void {
    if (this.error) return;
    this.error = error;
    this.abortSignal.aborted = true;
    this.abortSignal.reason = error.message;
    this.reject(error);
  }
  async wait<T>(operation: () => Promise<T>): Promise<T> {
    if (this.error) throw this.error;
    const result = await Promise.race([operation(), this.stopped]);
    if (this.error) throw this.error;
    return result;
  }
  get cancellationError(): Error | undefined { return this.error; }
  dispose(): void { clearTimeout(this.timer); }
}

export const SCHEDULED_RUN_DEFAULT_TIMEOUT_MS = 90 * 60_000;
export const SCHEDULED_RUN_MAX_TIMEOUT_MS = 4 * 60 * 60_000;

/**
 * Per-job `timeoutMs` wins when it is a positive integer within the 4h cap.
 * Otherwise the default is 90 min (script jobs keep their short 2-min default).
 */
export function scheduledRunTimeoutMs(job: { timeoutMs?: number; kind?: string }): number {
  return Number.isInteger(job.timeoutMs) && job.timeoutMs! > 0 && job.timeoutMs! <= SCHEDULED_RUN_MAX_TIMEOUT_MS
    ? job.timeoutMs!
    : job.kind === 'script' ? 120_000 : SCHEDULED_RUN_DEFAULT_TIMEOUT_MS;
}
