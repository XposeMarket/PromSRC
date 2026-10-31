/** Bound the entire summary transaction, including repair and batch calls. */
export async function withCompactionDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  parent?: AbortSignal,
  timeoutMs = 120_000,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: () => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    onAbort = () => {
      controller.abort();
      reject(new Error('Context compaction cancelled; original transcript retained.'));
    };
    if (parent?.aborted) { onAbort(); return; }
    parent?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Context compaction exceeded its 120-second deadline; original transcript retained.'));
    }, timeoutMs);
  });
  try {
    // Do not start work for an already-cancelled caller. Promise.race also
    // releases the caller if a provider does not promptly honor cancellation.
    return await Promise.race([stopped, ...(controller.signal.aborted ? [] : [run(controller.signal)])]);
  } finally {
    if (timer) clearTimeout(timer);
    parent?.removeEventListener('abort', onAbort);
  }
}
