import { RuntimeWorkerBroker } from '../process/runtime-worker-broker.js';
import {
  getSessionStorageDirectory,
  listSessionSummaries,
  type Session,
  type SessionListOptions,
  type SessionSearchResult,
  type SessionSummary,
} from '../session.js';

export interface SessionSearchWorkerOptions {
  channel?: Session['channel'];
  scope?: SessionListOptions['scope'];
  state?: SessionListOptions['state'];
  includeAutomated?: boolean;
  limit?: number;
}

export interface SessionSearchWorkerDiagnostics {
  isolation: 'gateway_index' | 'child_process';
  complete: boolean;
  scannedFiles: number;
  scannedBytes: number;
  skippedFiles: number;
  truncated: boolean;
  elapsedMs: number;
  workerRssBytes?: number;
  error?: string;
}

export interface SessionSearchWorkerResponse {
  results: SessionSearchResult[];
  diagnostics: SessionSearchWorkerDiagnostics;
}

interface SessionSearchWorkerRequest {
  sessionDir: string;
  query: string;
  candidateIds: string[];
  limit: number;
  maxFiles: number;
  maxBytes: number;
  maxFileBytes: number;
  maxDurationMs: number;
}

interface SessionSearchWorkerResult {
  matches?: Array<Pick<SessionSearchResult, 'id' | 'matchedRole' | 'matchedContent' | 'matchedIndex'>>;
  scannedFiles?: number;
  scannedBytes?: number;
  skippedFiles?: number;
  truncated?: boolean;
  elapsedMs?: number;
  rssBytes?: number;
}

function envMs(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, Math.floor(value))) : fallback;
}

function envBytes(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, Math.floor(value))) : fallback;
}

const searchTimeoutMs = envMs('PROMETHEUS_SESSION_SEARCH_TIMEOUT_MS', 15_000, 2_000, 2 * 60_000);
const maxFiles = envMs('PROMETHEUS_SESSION_SEARCH_MAX_FILES', 250, 1, 5000);
const maxBytes = envBytes('PROMETHEUS_SESSION_SEARCH_MAX_BYTES', 64 * 1024 * 1024, 1 * 1024 * 1024, 512 * 1024 * 1024);
const maxFileBytes = envBytes('PROMETHEUS_SESSION_SEARCH_MAX_FILE_BYTES', 8 * 1024 * 1024, 64 * 1024, 64 * 1024 * 1024);
const maxDurationMs = envMs('PROMETHEUS_SESSION_SEARCH_MAX_DURATION_MS', 8_000, 250, 60_000);
const idleShutdownMs = envMs('PROMETHEUS_SESSION_SEARCH_IDLE_SHUTDOWN_MS', 1500, 250, 60_000);
const broker = new RuntimeWorkerBroker({
  name: 'session-history-search',
  entryBasename: '../threads/session-search-worker',
  maxMessageBytes: 2 * 1024 * 1024,
  startupTimeoutMs: envMs('PROMETHEUS_SESSION_SEARCH_STARTUP_TIMEOUT_MS', 30_000, 1000, 2 * 60_000),
  defaultJobTimeoutMs: searchTimeoutMs,
  env: { PROMETHEUS_SESSION_SEARCH_WORKER: '1' },
});

interface QueuedSearch {
  request: SessionSearchWorkerRequest;
  resolve: (result: SessionSearchWorkerResult) => void;
  reject: (error: Error) => void;
}

const queue: QueuedSearch[] = [];
let active = false;
let idleShutdownTimer: NodeJS.Timeout | null = null;

function clearIdleShutdown(): void {
  if (!idleShutdownTimer) return;
  clearTimeout(idleShutdownTimer);
  idleShutdownTimer = null;
}

function scheduleIdleShutdown(): void {
  clearIdleShutdown();
  idleShutdownTimer = setTimeout(() => {
    idleShutdownTimer = null;
    if (active || queue.length) return;
    void broker.shutdown().catch(() => undefined);
  }, idleShutdownMs);
  idleShutdownTimer.unref?.();
}

function scheduleDrain(): void {
  setImmediate(() => void drain());
}

async function drain(): Promise<void> {
  if (active) return;
  const task = queue.shift();
  if (!task) return;
  active = true;
  try {
    const result = await broker.run<SessionSearchWorkerResult>('session_history_search', task.request, searchTimeoutMs);
    task.resolve(result || {});
  } catch (error: any) {
    task.reject(error instanceof Error ? error : new Error(String(error)));
  } finally {
    active = false;
    if (queue.length) scheduleDrain();
    else {
      broker.unref();
      scheduleIdleShutdown();
    }
  }
}

function runWorker(request: SessionSearchWorkerRequest): Promise<SessionSearchWorkerResult> {
  clearIdleShutdown();
  return new Promise((resolve, reject) => {
    queue.push({ request, resolve, reject });
    scheduleDrain();
  });
}

function normalizedLimit(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(200, Math.floor(parsed))) : 50;
}

function listAllSummaries(options: SessionSearchWorkerOptions): SessionSummary[] {
  const summaries: SessionSummary[] = [];
  const pageSize = 200;
  let offset = 0;
  while (true) {
    const page = listSessionSummaries({
      channel: options.channel,
      scope: options.scope,
      state: options.state,
      includeAutomated: options.includeAutomated,
      limit: pageSize,
      offset,
    });
    summaries.push(...page.sessions);
    if (!page.hasMore || page.sessions.length === 0) break;
    offset += page.sessions.length;
  }
  return summaries;
}

function titleMatches(summaries: SessionSummary[], query: string, limit: number): {
  results: SessionSearchResult[];
  matchedIds: Set<string>;
} {
  const q = query.toLowerCase();
  const results: SessionSearchResult[] = [];
  const matchedIds = new Set<string>();
  for (const summary of summaries) {
    const title = String(summary.title || 'New chat');
    const matchedIndex = title.toLowerCase().indexOf(q);
    if (matchedIndex < 0) continue;
    matchedIds.add(summary.id);
    results.push({ ...summary, matchedRole: 'title', matchedContent: title, matchedIndex });
    if (results.length >= limit) break;
  }
  return { results, matchedIds };
}

export async function searchSessionSummariesInWorker(
  query: string,
  options: SessionSearchWorkerOptions = {},
): Promise<SessionSearchWorkerResponse> {
  const normalizedQuery = String(query || '').trim().slice(0, 16_000);
  if (!normalizedQuery) {
    return {
      results: [],
      diagnostics: {
        isolation: 'gateway_index',
        complete: true,
        scannedFiles: 0,
        scannedBytes: 0,
        skippedFiles: 0,
        truncated: false,
        elapsedMs: 0,
      },
    };
  }

  const startedAt = Date.now();
  const limit = normalizedLimit(options.limit);
  const summaries = listAllSummaries(options);
  const titles = titleMatches(summaries, normalizedQuery, limit);
  if (titles.results.length >= limit) {
    return {
      results: titles.results,
      diagnostics: {
        isolation: 'gateway_index',
        complete: true,
        scannedFiles: 0,
        scannedBytes: 0,
        skippedFiles: 0,
        truncated: false,
        elapsedMs: Date.now() - startedAt,
      },
    };
  }
  const contentSearchSummaries = summaries
    .filter((summary) => !titles.matchedIds.has(summary.id))
    .sort((a, b) => (
      Number(b.lastMessageAt || b.lastActiveAt || b.createdAt || 0)
      - Number(a.lastMessageAt || a.lastActiveAt || a.createdAt || 0)
    ));

  const workerResult = await runWorker({
    sessionDir: getSessionStorageDirectory(),
    query: normalizedQuery,
    candidateIds: contentSearchSummaries.map((summary) => summary.id),
    limit: Math.max(1, limit - titles.results.length),
    maxFiles,
    maxBytes,
    maxFileBytes,
    maxDurationMs,
  });
  const summariesById = new Map(summaries.map((summary) => [summary.id, summary]));
  const contentResults = (workerResult.matches || []).flatMap((match) => {
    const summary = summariesById.get(match.id);
    return summary ? [{ ...summary, ...match }] : [];
  });
  return {
    results: [...titles.results, ...contentResults].slice(0, limit),
    diagnostics: {
      isolation: 'child_process',
      complete: workerResult.truncated !== true,
      scannedFiles: Number(workerResult.scannedFiles || 0),
      scannedBytes: Number(workerResult.scannedBytes || 0),
      skippedFiles: Number(workerResult.skippedFiles || 0),
      truncated: workerResult.truncated === true,
      elapsedMs: Date.now() - startedAt,
      workerRssBytes: Number(workerResult.rssBytes || 0) || undefined,
    },
  };
}

/** Stop the persistent worker during an orderly gateway/test shutdown. */
export async function shutdownSessionSearchWorker(): Promise<void> {
  clearIdleShutdown();
  queue.splice(0).forEach((task) => task.reject(new Error('Session search worker is shutting down.')));
  await broker.shutdown();
}
