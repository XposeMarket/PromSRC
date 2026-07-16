import {
  RUNTIME_WORKER_PROTOCOL_VERSION,
  boundedRuntimeWorkerError,
  isRuntimeWorkerProtocolMessage,
  runtimeWorkerMessageBytes,
  DEFAULT_RUNTIME_WORKER_MAX_MESSAGE_BYTES,
  type RuntimeWorkerChildMessage,
  type RuntimeWorkerParentMessage,
} from './runtime-worker-protocol.js';
import {
  searchMemoryIndexAsync,
  searchMemoryTimeline,
  searchProjectMemory,
  type MemorySearchParams,
  type MemorySearchResult,
} from '../memory-index/index.js';

type SearchKind = 'memory_search' | 'memory_search_project' | 'memory_search_timeline';

interface SearchPayload {
  workspacePath?: unknown;
  params?: MemorySearchParams;
  projectId?: unknown;
  query?: unknown;
  dateFrom?: unknown;
  dateTo?: unknown;
  limit?: unknown;
}

interface SerializedSearchResult {
  serialized: string;
  backend?: string;
  usedJsonFallback: boolean;
  rssBytes: number;
}

const workerName = String(process.env.PROMETHEUS_RUNTIME_WORKER_NAME || 'memory-search-query');
const MAX_QUERY_CHARS = 16_000;
const MAX_SERIALIZED_RESULT_BYTES = 192 * 1024;
let activeRequestId = '';

function send(message: RuntimeWorkerChildMessage): void {
  if (!process.send || !process.connected) return;
  const bytes = runtimeWorkerMessageBytes(message);
  if (bytes > DEFAULT_RUNTIME_WORKER_MAX_MESSAGE_BYTES) {
    process.send({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'error',
      requestId: 'requestId' in message ? message.requestId : undefined,
      code: 'IPC_RESULT_TOO_LARGE',
      message: `Memory query result exceeded the bounded IPC limit (${bytes} bytes; max ${DEFAULT_RUNTIME_WORKER_MAX_MESSAGE_BYTES}).`,
      completedAt: Date.now(),
    } satisfies RuntimeWorkerChildMessage);
    return;
  }
  process.send(message);
}

function shutdown(): void {
  try { process.disconnect(); } catch {}
  process.exit(0);
}

function resultMetadata(result: MemorySearchResult): Omit<SerializedSearchResult, 'serialized' | 'rssBytes'> {
  const stats = result?.stats as any;
  const telemetry = stats?.telemetry || {};
  const backend = typeof stats?.backend === 'string' ? stats.backend : undefined;
  return {
    backend,
    usedJsonFallback: telemetry.fallback === true || backend === 'json_hybrid',
  };
}

function boundJsonValue(value: unknown, state: { chars: number }, depth = 0): unknown {
  if (state.chars >= 160_000) return '[TRUNCATED]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    const remaining = Math.max(0, 160_000 - state.chars);
    const bounded = value.slice(0, Math.min(16_000, remaining));
    state.chars += bounded.length;
    return bounded.length < value.length ? `${bounded}\n[TRUNCATED]` : bounded;
  }
  if (depth >= 8) return '[MAX_DEPTH]';
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((entry) => boundJsonValue(entry, state, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value).slice(0, 100)) {
      out[key.slice(0, 200)] = boundJsonValue(entry, state, depth + 1);
      if (state.chars >= 160_000) break;
    }
    return out;
  }
  return String(value).slice(0, 1000);
}

export function serializeBoundedMemorySearchResult(result: MemorySearchResult): string {
  const bounded = boundJsonValue(result, { chars: 0 });
  let serialized = JSON.stringify(bounded, null, 2);
  if (Buffer.byteLength(serialized, 'utf8') <= MAX_SERIALIZED_RESULT_BYTES) return serialized;

  const compact = {
    query: String(result.query || '').slice(0, 4000),
    mode: result.mode,
    totalCandidates: result.totalCandidates,
    hits: (result.hits || []).slice(0, 25).map((hit) => ({
      ...hit,
      title: String(hit.title || '').slice(0, 1000),
      preview: String(hit.preview || '').slice(0, 4000),
      diagnostics: undefined,
    })),
    citations: (result.citations || []).slice(0, 25),
    stats: {
      records: result.stats?.records,
      chunks: result.stats?.chunks,
      indexedAt: result.stats?.indexedAt,
      backend: result.stats?.backend,
      rerank: result.stats?.rerank,
      telemetry: result.stats?.telemetry,
      outputTruncated: true,
    },
  };
  serialized = JSON.stringify(boundJsonValue(compact, { chars: 0 }), null, 2);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_SERIALIZED_RESULT_BYTES) {
    throw new Error(`Memory search result exceeded the safe serialized output limit (${MAX_SERIALIZED_RESULT_BYTES} bytes).`);
  }
  return serialized;
}

async function executeSearch(kind: SearchKind, payload: SearchPayload): Promise<SerializedSearchResult> {
  const workspacePath = String(payload.workspacePath || '').trim();
  if (!workspacePath) throw new Error(`${kind} requires workspacePath.`);
  const query = kind === 'memory_search'
    ? String(payload.params?.query || '')
    : String(payload.query || '');
  if (query.length > MAX_QUERY_CHARS) {
    throw new Error(`Memory search query exceeds the ${MAX_QUERY_CHARS}-character limit.`);
  }
  if (
    process.env.PROMETHEUS_MEMORY_SEARCH_WORKER_TEST_HOOKS === '1'
    && query === '__PROMETHEUS_TEST_CRASH__'
  ) {
    process.exit(86);
  }
  if (
    process.env.PROMETHEUS_MEMORY_SEARCH_WORKER_TEST_HOOKS === '1'
    && query === '__PROMETHEUS_TEST_OVERSIZED__'
  ) {
    return {
      serialized: 'x'.repeat(DEFAULT_RUNTIME_WORKER_MAX_MESSAGE_BYTES),
      backend: 'test',
      usedJsonFallback: false,
      rssBytes: process.memoryUsage().rss,
    };
  }

  const testCpuMs = Math.max(0, Math.min(10_000, Number(process.env.PROMETHEUS_MEMORY_SEARCH_WORKER_TEST_CPU_MS || 0)));
  if (
    process.env.PROMETHEUS_MEMORY_SEARCH_WORKER_TEST_HOOKS === '1'
    && query === '__PROMETHEUS_TEST_CPU__'
    && testCpuMs > 0
  ) {
    const until = Date.now() + testCpuMs;
    while (Date.now() < until) {
      Math.sqrt(Date.now());
    }
  }

  let result: MemorySearchResult;
  if (kind === 'memory_search') {
    result = await searchMemoryIndexAsync(workspacePath, payload.params || { query: '' }, { scheduleRefresh: false });
  } else if (kind === 'memory_search_project') {
    result = searchProjectMemory(
      workspacePath,
      String(payload.projectId || ''),
      String(payload.query || ''),
      Number(payload.limit || 10),
      { scheduleRefresh: false },
    );
  } else {
    result = searchMemoryTimeline(
      workspacePath,
      String(payload.query || ''),
      payload.dateFrom ? String(payload.dateFrom) : undefined,
      payload.dateTo ? String(payload.dateTo) : undefined,
      Number(payload.limit || 20),
      { scheduleRefresh: false },
    );
  }

  return {
    serialized: serializeBoundedMemorySearchResult(result),
    ...resultMetadata(result),
    rssBytes: process.memoryUsage().rss,
  };
}

process.on('disconnect', () => process.exit(0));
process.on('message', (raw: unknown) => {
  void (async () => {
    if (!isRuntimeWorkerProtocolMessage(raw)) return;
    const message = raw as RuntimeWorkerParentMessage;
    if (message.type === 'shutdown') {
      if (!activeRequestId) shutdown();
      return;
    }
    if (message.type !== 'run') return;
    if (activeRequestId) {
      send({
        protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
        type: 'error',
        requestId: message.requestId,
        code: 'WORKER_BUSY',
        message: 'Memory query worker is already running a job.',
        completedAt: Date.now(),
      });
      return;
    }
    if (!['memory_search', 'memory_search_project', 'memory_search_timeline'].includes(message.kind)) {
      send({
        protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
        type: 'error',
        requestId: message.requestId,
        code: 'UNKNOWN_JOB_KIND',
        message: `Unsupported memory query job: ${message.kind}`,
        completedAt: Date.now(),
      });
      return;
    }

    activeRequestId = message.requestId;
    send({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'started',
      requestId: message.requestId,
      kind: message.kind,
      pid: process.pid,
      startedAt: Date.now(),
    });
    try {
      const result = await executeSearch(message.kind as SearchKind, (message.payload || {}) as SearchPayload);
      send({
        protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
        type: 'result',
        requestId: message.requestId,
        result,
        completedAt: Date.now(),
      });
    } catch (error: any) {
      send({
        protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
        type: 'error',
        requestId: message.requestId,
        code: 'MEMORY_SEARCH_FAILED',
        message: boundedRuntimeWorkerError(error),
        completedAt: Date.now(),
      });
    } finally {
      activeRequestId = '';
    }
  })().catch((error) => {
    send({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'error',
      requestId: activeRequestId || undefined,
      code: 'MEMORY_SEARCH_WORKER_UNHANDLED_FAILURE',
      message: boundedRuntimeWorkerError(error),
      completedAt: Date.now(),
    });
    activeRequestId = '';
  });
});

send({
  protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
  type: 'ready',
  workerName,
  pid: process.pid,
});
