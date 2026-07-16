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

async function executeSearch(kind: SearchKind, payload: SearchPayload): Promise<SerializedSearchResult> {
  const workspacePath = String(payload.workspacePath || '').trim();
  if (!workspacePath) throw new Error(`${kind} requires workspacePath.`);
  const query = kind === 'memory_search'
    ? String(payload.params?.query || '')
    : String(payload.query || '');
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
    serialized: JSON.stringify(result, null, 2),
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
