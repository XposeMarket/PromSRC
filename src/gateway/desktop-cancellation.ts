/** Cooperative cancellation primitives shared by desktop orchestration layers. */

export class DesktopCancellationError extends Error {
  readonly code = 'DESKTOP_CANCELLED';

  constructor(message = 'Desktop operation was interrupted.') {
    super(message);
    this.name = 'DesktopCancellationError';
  }
}

export function throwIfDesktopCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DesktopCancellationError();
}

export function isDesktopCancellationError(error: unknown): boolean {
  return error instanceof DesktopCancellationError
    || (error instanceof Error && (error.name === 'AbortError' || (error as any).code === 'DESKTOP_CANCELLED'));
}

export function desktopAbortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfDesktopCancelled(signal);
  const duration = Math.max(0, Math.floor(Number(ms) || 0));
  if (!signal) return new Promise((resolve) => setTimeout(resolve, duration));

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, duration);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(new DesktopCancellationError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

