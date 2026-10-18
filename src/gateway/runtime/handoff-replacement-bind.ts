import type { Server as HttpServer } from 'node:http';

// A supervisor replacement can overlap the predecessor's shutdown while it drains
// streaming connections. Keep this bounded, but cover the observed handoff tail.
export const HANDOFF_BIND_RETRY_WINDOW_MS = 40_000;
export const HANDOFF_BIND_RETRY_INITIAL_DELAY_MS = 200;
export const HANDOFF_LISTENER_CLOSE_TIMEOUT_MS = 5_000;

type BindRetryOptions = {
  enabled: boolean;
  maxWaitMs?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/** Retry only handoff replacement binds; ordinary gateway starts retain fail-fast behaviour. */
export async function listenWithHandoffRetry(
  attempt: () => Promise<void>,
  options: BindRetryOptions,
): Promise<void> {
  if (!options.enabled) return attempt();
  const now = options.now || Date.now;
  const sleep = options.sleep || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + Math.max(0, options.maxWaitMs ?? HANDOFF_BIND_RETRY_WINDOW_MS);
  let delay = Math.max(1, options.initialDelayMs ?? HANDOFF_BIND_RETRY_INITIAL_DELAY_MS);
  const maxDelay = Math.max(delay, options.maxDelayMs ?? 2_000);

  while (true) {
    try {
      await attempt();
      return;
    } catch (error) {
      const bindError = error as NodeJS.ErrnoException;
      if (bindError?.code !== 'EADDRINUSE' || now() >= deadline) throw error;
      const remaining = deadline - now();
      await sleep(Math.min(delay, remaining));
      delay = Math.min(maxDelay, delay * 2);
    }
  }
}

/** Stop accepting connections without waiting for existing streaming responses to finish. */
export async function closeListeningHandle(
  server: Pick<HttpServer, 'close' | 'listening'>,
  timeoutMs = HANDOFF_LISTENER_CLOSE_TIMEOUT_MS,
): Promise<void> {
  if (!server.listening) return;
  try { server.close(); } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ERR_SERVER_NOT_RUNNING') throw error;
  }
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (server.listening && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  if (server.listening) throw new Error(`Gateway listener did not release within ${timeoutMs}ms.`);
  // Let libuv run the listener-handle close callback before the replacement
  // starts binding. Existing SSE sockets may remain alive beyond this point.
  await new Promise<void>((resolve) => setImmediate(resolve));
}

export function runtimeBelongsToLiveHandoffHost(
  runtime: { pid?: number; remoteHostPid?: number; status?: string } | null | undefined,
  hostPid: number,
  currentPid: number,
  isAlive: (pid: number) => boolean,
): boolean {
  if (!runtime || runtime.status !== 'running' || !hostPid || hostPid === currentPid) return false;
  const ownerPid = Number(runtime.remoteHostPid || runtime.pid || 0);
  return ownerPid === hostPid && isAlive(hostPid);
}
