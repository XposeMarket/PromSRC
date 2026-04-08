/**
 * fetch-retry.ts — Resilience & Retry Skill for Web/Fetch Flows
 *
 * Implements:
 *   1. Bounded retry with exponential backoff + jitter
 *   2. Explicit error classification (network vs auth vs DOM/selector vs timeout vs logic)
 *   3. Graceful degradation helpers
 *   4. Lightweight diagnostic (ping check after failure)
 *
 * Usage:
 *   import { fetchWithRetry, classifyFetchError } from './fetch-retry';
 *
 *   const result = await fetchWithRetry('https://example.com/api', { retries: 3 });
 *   if (!result.ok) {
 *     logger(`Fetch failed: ${result.errorType} — ${result.errorMessage}`);
 *   }
 */

export type FetchErrorType = 'network' | 'auth' | 'dom_selector' | 'timeout' | 'logic' | 'unknown';

export interface FetchResult<T = Response> {
  ok: boolean;
  response?: T;
  errorType?: FetchErrorType;
  errorMessage?: string;
  attempts: number;
  durationMs: number;
}

export interface FetchRetryOptions {
  retries?: number;           // default: 3
  baseDelayMs?: number;       // default: 1000 (1s)
  maxDelayMs?: number;        // default: 15000 (15s)
  jitterFactor?: number;      // 0-1, adds random noise to delay. default: 0.3
  timeoutMs?: number;         // per-attempt timeout. default: 30000
  retryOn?: (status: number, err?: Error) => boolean;  // custom retry predicate
  onRetry?: (attempt: number, err: string, delayMs: number) => void;
}

const DEFAULT_OPTS: Required<Omit<FetchRetryOptions, 'retryOn' | 'onRetry'>> = {
  retries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 15000,
  jitterFactor: 0.3,
  timeoutMs: 30000,
};

/** Classify an error into a typed category for observability logging. */
export function classifyFetchError(err: unknown, statusCode?: number): FetchErrorType {
  const msg = String((err as any)?.message || err || '').toLowerCase();

  // Auth errors — HTTP 401/403 or message hints
  if (statusCode === 401 || statusCode === 403) return 'auth';
  if (/unauthorized|forbidden|invalid.token|api.key|authentication/.test(msg)) return 'auth';

  // Network errors — connection refused, DNS failure, ECONNRESET, fetch failed
  if (/econnrefused|enotfound|econnreset|network|fetch.failed|failed.to.fetch|cors|etimedout|socket/.test(msg)) return 'network';
  if (statusCode === 0 || statusCode === 502 || statusCode === 503 || statusCode === 504) return 'network';

  // Timeout
  if (/timeout|timed.out|abort/.test(msg) || statusCode === 408) return 'timeout';

  // DOM/selector errors — browser automation failures
  if (/selector|element|not.found|cannot.read|undefined.is.not|queryselector|xpath/.test(msg)) return 'dom_selector';

  // Logic errors — explicit app-level errors (400, 422, etc.)
  if (statusCode && statusCode >= 400 && statusCode < 500 && statusCode !== 401 && statusCode !== 403 && statusCode !== 408) {
    return 'logic';
  }

  return 'unknown';
}

/** Returns delay in ms for attempt N (1-indexed), with exponential backoff + jitter. */
export function computeRetryDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitterFactor: number,
): number {
  const exponential = baseDelayMs * Math.pow(2, attempt - 1);
  const capped = Math.min(exponential, maxDelayMs);
  const jitter = capped * jitterFactor * Math.random();
  return Math.round(capped + jitter);
}

/** Default retry predicate — don't retry 4xx client errors (except 408, 429). */
function defaultShouldRetry(status: number, err?: Error): boolean {
  if (err) return true; // network-level errors always retry
  if (status === 429 || status === 408) return true; // rate limit / timeout → retry
  if (status >= 400 && status < 500) return false; // client errors → don't retry
  if (status >= 500) return true; // server errors → retry
  return false;
}

/**
 * Fetch with bounded retry, jitter backoff, and structured error output.
 * Returns a FetchResult — never throws.
 */
export async function fetchWithRetry(
  url: string,
  fetchInit?: RequestInit,
  opts?: FetchRetryOptions,
): Promise<FetchResult<Response>> {
  const cfg = { ...DEFAULT_OPTS, ...opts };
  const shouldRetry = opts?.retryOn ?? defaultShouldRetry;
  const startedAt = Date.now();
  let lastError: string = '';
  let lastErrorType: FetchErrorType = 'unknown';

  for (let attempt = 1; attempt <= cfg.retries + 1; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

    try {
      const res = await fetch(url, {
        ...fetchInit,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        return {
          ok: true,
          response: res,
          attempts: attempt,
          durationMs: Date.now() - startedAt,
        };
      }

      // HTTP error status
      const retry = shouldRetry(res.status);
      lastError = `HTTP ${res.status} ${res.statusText}`;
      lastErrorType = classifyFetchError(null, res.status);

      if (!retry || attempt > cfg.retries) {
        return {
          ok: false,
          response: res,
          errorType: lastErrorType,
          errorMessage: lastError,
          attempts: attempt,
          durationMs: Date.now() - startedAt,
        };
      }
    } catch (err: any) {
      clearTimeout(timer);
      lastError = String(err?.message || err);
      lastErrorType = classifyFetchError(err);

      if (attempt > cfg.retries) {
        return {
          ok: false,
          errorType: lastErrorType,
          errorMessage: lastError,
          attempts: attempt,
          durationMs: Date.now() - startedAt,
        };
      }
    }

    // Compute delay and wait before next attempt
    const delayMs = computeRetryDelay(attempt, cfg.baseDelayMs, cfg.maxDelayMs, cfg.jitterFactor);
    opts?.onRetry?.(attempt, lastError, delayMs);
    await new Promise(r => setTimeout(r, delayMs));
  }

  // Unreachable but TypeScript needs it
  return {
    ok: false,
    errorType: lastErrorType,
    errorMessage: lastError,
    attempts: cfg.retries + 1,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Quick reachability ping — used after a fetch failure to classify
 * whether it's a "target is down" vs "our connection is broken" issue.
 *
 * Returns: 'reachable' | 'unreachable' | 'unknown'
 */
export async function pingReachability(
  url: string,
  timeoutMs = 5000,
): Promise<'reachable' | 'unreachable' | 'unknown'> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timer);
    // Any HTTP response (even 4xx) means the server is reachable
    return 'reachable';
  } catch (err: any) {
    const msg = String(err?.message || '').toLowerCase();
    if (/enotfound|econnrefused|network|fetch.failed/.test(msg)) return 'unreachable';
    return 'unknown';
  }
}

/**
 * Graceful degradation wrapper — runs fn(), and on failure logs and skips
 * rather than propagating the error. Pass `shouldHaltOn` to re-throw
 * for error types that require attention (e.g. 'auth' should halt, 'network' can skip).
 */
export async function withGracefulDegradation<T>(
  fn: () => Promise<T>,
  opts: {
    label: string;
    shouldHaltOn?: FetchErrorType[];
    onSkip?: (errorType: FetchErrorType, message: string) => void;
  },
): Promise<{ result?: T; skipped: boolean; errorType?: FetchErrorType; errorMessage?: string }> {
  try {
    const result = await fn();
    return { result, skipped: false };
  } catch (err: any) {
    const errorType = classifyFetchError(err);
    const errorMessage = String(err?.message || err);

    if (opts.shouldHaltOn?.includes(errorType)) {
      throw err; // re-throw for errors we can't gracefully skip
    }

    opts.onSkip?.(errorType, errorMessage);
    console.warn(`[${opts.label}] Graceful skip: ${errorType} — ${errorMessage}`);
    return { skipped: true, errorType, errorMessage };
  }
}
