import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  closeSqliteMemoryConnections,
  refreshMemoryIndexFromAudit,
  searchMemoryIndexAsync,
  searchMemoryTimeline,
  searchProjectMemory,
  shutdownMemoryIndexRefreshWorker,
} from './index.js';
import {
  getMemorySearchWorkerStatus,
  searchMemoryInWorker,
  shutdownMemorySearchWorker,
} from './search-worker-client.js';
import { buildRetrievedMemoryContext } from '../prompt-context.js';

function idsAndCitations(serialized: string): { ids: string[]; citations: unknown[] } {
  const parsed = JSON.parse(serialized);
  return {
    ids: (parsed.hits || []).map((hit: any) => hit.recordId),
    citations: parsed.citations || [],
  };
}

function normalizedResult(serialized: string): unknown {
  const visit = (value: any): any => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (
        key.endsWith('_ms')
      ) continue;
      out[key] = visit(child);
    }
    return out;
  };
  return visit(JSON.parse(serialized));
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(`Timed out after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function expectReject(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  await assert.rejects(promise, pattern);
}

async function main(): Promise<void> {
  process.env.PROMETHEUS_MEMORY_SEARCH_WORKER_TEST_HOOKS = '1';
  process.env.PROMETHEUS_MEMORY_SEARCH_WORKER_TEST_CPU_MS = '1500';

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-memory-search-worker-'));
  const workspacePath = path.join(tmpRoot, 'workspace');
  const memoryRoot = path.join(workspacePath, 'audit', 'memory', 'root');
  fs.mkdirSync(memoryRoot, { recursive: true });
  fs.writeFileSync(
    path.join(memoryRoot, 'MEMORY.md'),
    [
      '# MEMORY',
      '',
      '## Project Decisions',
      '- The Atlas project keeps command approvals enabled for destructive actions.',
      '- Gateway memory searches must not block unrelated health requests.',
      '',
      '## Timeline',
      '- 2026-07-15: measured a deep memory-search event-loop stall.',
      '- 2026-07-16: isolated live memory queries in a child process.',
    ].join('\n'),
    'utf-8',
  );
  const projectStateRoot = path.join(workspacePath, 'audit', 'projects', 'state', 'atlas');
  fs.mkdirSync(projectStateRoot, { recursive: true });
  fs.writeFileSync(
    path.join(projectStateRoot, 'project.json'),
    JSON.stringify({
      projectId: 'atlas',
      title: 'Atlas command approval project',
      summary: 'Atlas preserves command approvals while isolating memory searches.',
      updatedAt: '2026-07-16T12:00:00.000Z',
    }, null, 2),
    'utf-8',
  );

  try {
    refreshMemoryIndexFromAudit(workspacePath, {
      force: true,
      minIntervalMs: 0,
      maxChangedFiles: 500,
      syncSqlite: true,
    });

    const params = {
      query: 'memory searches gateway health',
      mode: 'quick' as const,
      limit: 8,
      debug: true,
      rerank: false,
      queryRoute: 'worker_regression',
    };
    const legacy = JSON.stringify(
      await searchMemoryIndexAsync(workspacePath, params, { scheduleRefresh: false }),
      null,
      2,
    );

    const worker = await searchMemoryInWorker('memory_search', { workspacePath, params });
    assert.deepStrictEqual(normalizedResult(worker), normalizedResult(legacy), 'worker memory_search must preserve the full result except timing telemetry');
    assert.equal(worker, JSON.stringify(JSON.parse(worker), null, 2), 'worker must preserve pretty JSON output');
    assert.ok(getMemorySearchWorkerStatus().broker.pid !== process.pid, 'memory query must execute outside the gateway PID');

    let eventLoopTicks = 0;
    const ticker = setInterval(() => { eventLoopTicks += 1; }, 20);
    await searchMemoryInWorker('memory_search', {
      workspacePath,
      params: { ...params, query: '__PROMETHEUS_TEST_CPU__' },
    });
    clearInterval(ticker);
    assert.ok(eventLoopTicks >= 40, `gateway event loop should remain responsive during 1.5s of child CPU work (ticks=${eventLoopTicks})`);

    let promptTicks = 0;
    const promptTicker = setInterval(() => { promptTicks += 1; }, 20);
    const automaticContext = await buildRetrievedMemoryContext(
      workspacePath,
      '__PROMETHEUS_TEST_CPU__',
      { mode: 'light_search', reason: 'worker_regression' },
    );
    clearInterval(promptTicker);
    assert.match(automaticContext, /\[MEMORY_SEARCH_ROUTING\]/);
    assert.ok(promptTicks >= 40, `automatic prompt retrieval must remain off the gateway event loop (ticks=${promptTicks})`);

    const projectLegacy = JSON.stringify(
      searchProjectMemory(workspacePath, 'atlas', 'command approvals', 10, { scheduleRefresh: false }),
      null,
      2,
    );
    const projectWorker = await searchMemoryInWorker('memory_search_project', {
      workspacePath,
      projectId: 'atlas',
      query: 'command approvals',
      limit: 10,
    });
    assert.ok(JSON.parse(projectWorker).hits.length > 0, 'project parity fixture must exercise non-empty project results');
    assert.deepStrictEqual(normalizedResult(projectWorker), normalizedResult(projectLegacy), 'project search must preserve the full result except timing telemetry');

    const timelineLegacy = JSON.stringify(
      searchMemoryTimeline(workspacePath, 'memory search', undefined, undefined, 20, { scheduleRefresh: false }),
      null,
      2,
    );
    const timelineWorker = await searchMemoryInWorker('memory_search_timeline', {
      workspacePath,
      query: 'memory search',
      limit: 20,
    });
    assert.deepStrictEqual(normalizedResult(timelineWorker), normalizedResult(timelineLegacy), 'timeline search must preserve the full result except timing telemetry');

    const maxDebugResult = await searchMemoryInWorker('memory_search', {
      workspacePath,
      params: { ...params, limit: 50, debug: true },
    });
    assert.equal(maxDebugResult, JSON.stringify(JSON.parse(maxDebugResult), null, 2), 'limit:50 debug output must fit bounded IPC and remain pretty JSON');

    await expectReject(
      searchMemoryInWorker('memory_search', {
        workspacePath,
        params: { ...params, query: '__PROMETHEUS_TEST_OVERSIZED__' },
      }),
      /exceeded the bounded IPC limit/i,
    );
    await expectReject(
      searchMemoryInWorker('memory_search', {
        workspacePath,
        params: { ...params, query: 'q'.repeat(16_001) },
      }),
      /query exceeds the 16000-character limit/i,
    );

    await expectReject(
      searchMemoryInWorker('memory_search', {
        workspacePath,
        params: { ...params, query: '__PROMETHEUS_TEST_CPU__' },
      }, { timeoutMs: 1000 }),
      /timed out/i,
    );
    const afterTimeout = await searchMemoryInWorker('memory_search', { workspacePath, params });
    assert.deepEqual(idsAndCitations(afterTimeout), idsAndCitations(legacy), 'timeout must recycle the child before the next query');

    const activeAbort = new AbortController();
    const cancelled = searchMemoryInWorker('memory_search', {
      workspacePath,
      params: { ...params, query: '__PROMETHEUS_TEST_CPU__' },
    }, { signal: activeAbort.signal });
    const afterCancelled = searchMemoryInWorker('memory_search', { workspacePath, params });
    await waitFor(() => getMemorySearchWorkerStatus().active);
    activeAbort.abort();
    await expectReject(cancelled, /cancel/i);
    const replacementResult = await afterCancelled;
    assert.deepEqual(idsAndCitations(replacementResult), idsAndCitations(legacy), 'queued query must run in a clean replacement worker after active cancellation');

    const queuedAbort = new AbortController();
    const queueLead = searchMemoryInWorker('memory_search', { workspacePath, params });
    const queuedCancelled = searchMemoryInWorker('memory_search', { workspacePath, params }, { signal: queuedAbort.signal });
    queuedAbort.abort();
    await expectReject(queuedCancelled, /cancel/i);
    await queueLead;

    const timeoutLead = searchMemoryInWorker('memory_search', {
      workspacePath,
      params: { ...params, query: '__PROMETHEUS_TEST_CPU__' },
    });
    const queuedTimeout = searchMemoryInWorker(
      'memory_search',
      { workspacePath, params },
      { timeoutMs: 200 },
    );
    await expectReject(queuedTimeout, /timed out.*queued/i);
    await timeoutLead;

    const queueA = searchMemoryInWorker('memory_search', { workspacePath, params });
    const queueB = searchMemoryInWorker('memory_search', { workspacePath, params });
    const queueC = searchMemoryInWorker('memory_search', { workspacePath, params });
    await expectReject(
      searchMemoryInWorker('memory_search', { workspacePath, params }),
      /one active query and two queued queries maximum/i,
    );
    await Promise.all([queueA, queueB, queueC]);

    await expectReject(
      searchMemoryInWorker('memory_search', {
        workspacePath,
        params: { ...params, query: '__PROMETHEUS_TEST_CRASH__' },
      }),
      /exited/i,
    );
    const afterCrash = await searchMemoryInWorker('memory_search', { workspacePath, params });
    assert.deepEqual(idsAndCitations(afterCrash), idsAndCitations(legacy), 'worker crash must not poison the replacement query');

    const shutdownActive = searchMemoryInWorker('memory_search', {
      workspacePath,
      params: { ...params, query: '__PROMETHEUS_TEST_CPU__' },
    });
    const shutdownQueued = searchMemoryInWorker('memory_search', { workspacePath, params });
    const shutdownActiveOutcome = shutdownActive.then(() => null, (error) => error as Error);
    const shutdownQueuedOutcome = shutdownQueued.then(() => null, (error) => error as Error);
    await waitFor(() => getMemorySearchWorkerStatus().active);
    await shutdownMemorySearchWorker();
    assert.match(String((await shutdownActiveOutcome)?.message || ''), /shutting down/i);
    assert.match(String((await shutdownQueuedOutcome)?.message || ''), /shutting down/i);
    assert.equal(getMemorySearchWorkerStatus().broker.pid, undefined, 'shutdown must not leave an orphan query worker');
  } finally {
    await shutdownMemorySearchWorker();
    await shutdownMemoryIndexRefreshWorker();
    closeSqliteMemoryConnections();
    fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

main().then(() => {
  console.log('memory-search worker regression checks passed');
}).catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
