import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(`Timed out after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function main(): Promise<void> {
  // These must be set before the search-worker client is imported because its
  // worker policy is intentionally fixed for the lifetime of the gateway.
  process.env.PROMETHEUS_AUTOMATIC_MEMORY_SEARCH_WORKERS = '2';
  process.env.PROMETHEUS_AUTOMATIC_MEMORY_SEARCH_IDLE_TTL_MS = '1000';
  process.env.PROMETHEUS_MEMORY_SEARCH_WORKER_TEST_HOOKS = '1';
  process.env.PROMETHEUS_MEMORY_SEARCH_WORKER_TEST_CPU_MS = '0';

  const {
    closeSqliteMemoryConnections,
    refreshMemoryIndexFromAudit,
    shutdownMemoryIndexRefreshWorker,
  } = await import('./index.js');
  const {
    getAutomaticMemorySearchWorkerStatus,
    searchMemoryAutomaticallyInWorker,
    shutdownMemorySearchWorker,
    warmAutomaticMemorySearchWorkers,
  } = await import('./search-worker-client.js');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-automatic-memory-search-'));
  const workspacePath = path.join(tmpRoot, 'workspace');
  const memoryRoot = path.join(workspacePath, 'audit', 'memory', 'root');
  fs.mkdirSync(memoryRoot, { recursive: true });
  fs.writeFileSync(
    path.join(memoryRoot, 'MEMORY.md'),
    [
      '# MEMORY',
      '',
      '## Runtime worker policy',
      '- Automatic memory retrieval keeps one low-latency worker warm.',
      '- Elastic automatic workers may retire after their idle TTL.',
    ].join('\n'),
    'utf8',
  );

  try {
    refreshMemoryIndexFromAudit(workspacePath, {
      force: true,
      minIntervalMs: 0,
      maxChangedFiles: 100,
      syncSqlite: true,
    });

    await warmAutomaticMemorySearchWorkers(workspacePath);
    const warmed = getAutomaticMemorySearchWorkerStatus();
    assert.equal(warmed.workerCount, 2);
    assert.equal(warmed.ready, 2, 'both automatic slots should be warm before exercising retirement');
    assert.equal(warmed.workers[0]?.policy.idleTtlMs, 0, 'the warm-floor worker must not have an idle TTL');
    assert.equal(warmed.workers[1]?.policy.idleTtlMs, 1000, 'the elastic worker should retain its idle TTL');

    const params = {
      query: 'low latency automatic memory retrieval',
      mode: 'quick' as const,
      limit: 4,
      rerank: false,
      queryRoute: 'automatic_memory_worker_regression',
    };
    const first = await searchMemoryAutomaticallyInWorker(
      'memory_search',
      { workspacePath, params },
      { timeoutMs: 250 },
    );
    assert.ok(JSON.parse(first), 'the warmed automatic worker should serve the first retrieval');

    await waitFor(() => {
      const status = getAutomaticMemorySearchWorkerStatus();
      return status.workers[0]?.state === 'ready' && status.workers[1]?.state === 'stopped';
    }, 5_000);

    const startedAt = Date.now();
    const second = await searchMemoryAutomaticallyInWorker(
      'memory_search',
      { workspacePath, params },
      { timeoutMs: 250 },
    );
    const elapsedMs = Date.now() - startedAt;
    assert.ok(JSON.parse(second), 'automatic retrieval must still produce a result after elastic retirement');
    assert.ok(elapsedMs <= 250, `warm-floor retrieval exceeded the automatic SLA (elapsed=${elapsedMs}ms)`);
    const afterRetirement = getAutomaticMemorySearchWorkerStatus();
    assert.equal(afterRetirement.workers[0]?.state, 'ready', 'the warm-floor worker must remain ready');
  } finally {
    await shutdownMemorySearchWorker();
    await shutdownMemoryIndexRefreshWorker();
    closeSqliteMemoryConnections();
    fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

main().then(() => {
  console.log('automatic memory search regression checks passed');
}).catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
