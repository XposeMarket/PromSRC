export type ProcessOutputStream = 'stdout' | 'stderr' | 'combined';

/** Keep a noisy command from turning each pipe chunk into a gateway and UI event. */
export class ProcessOutputBatcher {
  private pending = '';
  private stream: ProcessOutputStream = 'stdout';
  private sequence = 0;
  private omittedChars = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly emit: (stream: ProcessOutputStream, chunk: string, sequence: number) => void,
    private readonly intervalMs = 75,
    private readonly maxPendingChars = 32 * 1024,
  ) {}

  push(stream: 'stdout' | 'stderr', chunk: string, sequence: number): void {
    if (!chunk) return;
    this.stream = this.pending && this.stream !== stream ? 'combined' : stream;
    this.pending += chunk;
    this.sequence = sequence;
    if (this.pending.length > this.maxPendingChars) {
      const excess = this.pending.length - this.maxPendingChars;
      this.pending = this.pending.slice(excess);
      this.omittedChars += excess;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.intervalMs);
      this.timer.unref?.();
    }
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.pending) return;
    const prefix = this.omittedChars
      ? `[Live terminal output omitted ${this.omittedChars} characters; open the saved log for more output.]\n`
      : '';
    this.emit(this.stream, `${prefix}${this.pending}`, this.sequence);
    this.pending = '';
    this.omittedChars = 0;
    this.stream = 'stdout';
  }
}
