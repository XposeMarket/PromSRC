/**
 * In-flight HTTP request registry for memory diagnostics.
 *
 * The memory high-water log names the runtimes that were running at a new
 * peak, but a plain HTTP request (for example a UI screen loading a large
 * agent chat history) is not a runtime. Nov 16 2026: a single
 * GET /api/agents/<id>/chat?limit=20 parsed a 131 MB file and returned 73 MB,
 * and the high-water lines could not show it. This registry records method +
 * path (never the query string, which can carry auth tokens) so the log can
 * name the open requests.
 */
import type http from 'http';

export interface InflightHttpEntry {
  method: string;
  path: string;
  ageMs: number;
}

interface TrackedRequest {
  method: string;
  path: string;
  startedAt: number;
}

const MAX_TRACKED = 2_000;
const MAX_PATH_CHARS = 160;
const inflight = new Map<number, TrackedRequest>();
let nextId = 1;

export function sanitizeRequestPath(rawUrl: unknown): string {
  const raw = String(rawUrl || '');
  const q = raw.search(/[?#]/);
  const pathOnly = (q >= 0 ? raw.slice(0, q) : raw) || '/';
  return pathOnly.slice(0, MAX_PATH_CHARS);
}

/** Register a request; it is removed when the response finishes or the socket closes. */
export function trackInflightHttp(req: http.IncomingMessage, res: http.ServerResponse, now = Date.now()): void {
  if (inflight.size >= MAX_TRACKED) return;
  const id = nextId++;
  inflight.set(id, {
    method: String(req.method || 'GET').toUpperCase().slice(0, 10),
    path: sanitizeRequestPath(req.url),
    startedAt: now,
  });
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    inflight.delete(id);
  };
  res.once('finish', finish);
  res.once('close', finish);
}

/** Open requests, oldest first, capped. Streaming endpoints (SSE/WS upgrades) are included when long-lived. */
export function listInflightHttp(now = Date.now(), max = 15): { requests: InflightHttpEntry[]; total: number } {
  const all = Array.from(inflight.values()).sort((a, b) => a.startedAt - b.startedAt);
  return {
    requests: all.slice(0, Math.max(0, max)).map((r) => ({ method: r.method, path: r.path, ageMs: Math.max(0, now - r.startedAt) })),
    total: all.length,
  };
}

/** Test hook. */
export function resetInflightHttpForTests(): void {
  inflight.clear();
  nextId = 1;
}
