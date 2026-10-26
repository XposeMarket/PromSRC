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

export function scheduledRunTimeoutMs(job: { timeoutMs?: number; kind?: string }): number {
  return Number.isInteger(job.timeoutMs) && job.timeoutMs! > 0 && job.timeoutMs! <= 3_600_000
    ? job.timeoutMs! : job.kind === 'script' ? 120_000 : 30 * 60_000;
}
