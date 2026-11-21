/**
 * Windowed /api/bg-tasks list.
 *
 * Unfinished work (running, queued, paused, stalled, needs-you, ...) always
 * ships in full. Finished history (complete/completed/failed/cancelled) ships
 * newest-first in a bounded window, with exact per-status totals so clients can
 * show real counts and ask for older rows on demand. Before this, every Tasks
 * poll (mobile polls every 5 s) projected, serialized and compressed every task
 * ever run: 3,153 rows / 3.1 MB on Raul's gateway to paint 40 cards.
 *
 * Clients opt in with `?finished=<N>` (and optional `q=<text>` to search all
 * finished history server-side). Without `finished` the route keeps returning
 * the full list, so older clients and other gateways' fallbacks keep working.
 */

export const FINISHED_BG_TASK_STATUSES: ReadonlySet<string> = new Set([
  'complete', 'completed', 'done', 'succeeded', 'failed', 'cancelled',
]);

/** Hard cap on one finished window; "load older" grows the window up to this. */
export const MAX_FINISHED_BG_TASK_WINDOW = 2000;

export interface BgTaskListWindow {
  /** Newest finished rows (after the query filter) to include. */
  finished: number;
  /** Lowercased search text; empty = no filter. Applies to finished rows only. */
  query: string;
}

export interface BgTaskListWindowMeta {
  finishedWindow: number;
  finishedReturned: number;
  /** Every finished row on the gateway, ignoring the query. */
  finishedTotal: number;
  /** Finished rows that match the query (= finishedTotal without a query). */
  finishedMatched: number;
  /** Every finished row by raw status, ignoring the query (for tab/column badges). */
  finishedCounts: Record<string, number>;
  hasMoreFinished: boolean;
  query?: string;
}

function firstQueryValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

/** Parse `finished`/`q` from req.query. Returns null when the caller did not opt in. */
export function parseBgTaskListWindow(query: Record<string, unknown> | undefined | null): BgTaskListWindow | null {
  const raw = firstQueryValue(query?.finished);
  if (raw == null || String(raw).trim() === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  const text = String(firstQueryValue(query?.q) ?? '').trim().toLowerCase().slice(0, 200);
  return { finished: Math.min(MAX_FINISHED_BG_TASK_WINDOW, Math.floor(value)), query: text };
}

export function isFinishedBgTaskStatus(status: unknown): boolean {
  return FINISHED_BG_TASK_STATUSES.has(String(status || '').trim().toLowerCase());
}

/**
 * Same fields and substring rule as the desktop Tasks search
 * (web-ui/src/pages/TasksPage.js bgtTaskMatchesSearch), so the server never
 * drops a row the client-side filter would have shown.
 */
export function bgTaskMatchesQuery(task: any, query: string): boolean {
  if (!query) return true;
  const planText = Array.isArray(task?.plan)
    ? task.plan.map((step: any) => step?.description || step?.text || '').join(' ')
    : '';
  const progressText = Array.isArray(task?.runtimeProgress?.items)
    ? task.runtimeProgress.items.map((item: any) => item?.text || item?.description || '').join(' ')
    : '';
  return [task?.title, task?.description, task?.channel, task?.brainJob, task?.brainDate, planText, progressText]
    .some((value) => String(value || '').toLowerCase().includes(query));
}

/**
 * Keep every unfinished item and the newest `window.finished` finished items
 * that match the query. `items` must already be sorted newest-first; order is
 * preserved. `view` maps an item to its task-like record (status, title, plan).
 */
export function windowBgTaskList<T>(
  items: readonly T[],
  window: BgTaskListWindow,
  view: (item: T) => any,
): { items: T[]; meta: BgTaskListWindowMeta } {
  const kept: T[] = [];
  const finishedCounts: Record<string, number> = {};
  let finishedTotal = 0;
  let finishedMatched = 0;
  for (const item of items) {
    const task = view(item);
    const status = String(task?.status || '').trim().toLowerCase();
    if (!FINISHED_BG_TASK_STATUSES.has(status)) {
      kept.push(item);
      continue;
    }
    finishedTotal += 1;
    finishedCounts[status] = (finishedCounts[status] || 0) + 1;
    if (!bgTaskMatchesQuery(task, window.query)) continue;
    finishedMatched += 1;
    if (finishedMatched <= window.finished) kept.push(item);
  }
  return {
    items: kept,
    meta: {
      finishedWindow: window.finished,
      finishedReturned: Math.min(finishedMatched, window.finished),
      finishedTotal,
      finishedMatched,
      finishedCounts,
      hasMoreFinished: finishedMatched > window.finished,
      ...(window.query ? { query: window.query } : {}),
    },
  };
}
