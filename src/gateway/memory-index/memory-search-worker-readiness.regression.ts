import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function waitFor(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(`Timed out after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function main(): Promise<void> {
  // Import the client only after the policy is configured. The regression
  // intentionally makes the first query much slower than process startup.
  process.env.PROMETHEUS_MEMORY_SEARCH_WORKER_TEST_HOOKS = '1';
  const warmupDelayMs = 5_000;
  process.env.PROMETHEUS_MEMORY_SEARCH_WARMUP_TIMEOUT_MS = '7000';
  process.env.PROMETHEUS_MEMORY_SEARCH_WORKER_TEST_WARMUP_DELAY_MS = String(warmupDelayMs);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-memory-search-readiness-'));
  const workspacePath = path.join(tmpRoot, 'workspace');
  const memoryRoot = path.join(workspacePath, 'audit', 'memory', 'root');
  fs.mkdirSync(memoryRoot, { recursive: true });
  fs.writeFileSync(path.join(memoryRoot, 'MEMORY.md'), '# MEMORY\n\n- Cold readiness must not kill a healthy worker.\n', 'utf8');

  try {
    const index = await import('./index.js');
    const client = await import('./search-worker-client.js');
    index.refreshMemoryIndexFromAudit(workspacePath, {
      force: true,
      minIntervalMs: 0,
      maxChangedFiles: 100,
      syncSqlite: true,
    });

    const startedAt = Date.now();
    await client.warmMemorySearchWorker(workspacePath, { awaitPrewarm: false });
    const processReadyElapsedMs = Date.now() - startedAt;
    assert.ok(processReadyElapsedMs < warmupDelayMs, `process readiness must not wait for the slow prewarm query (elapsed=${processReadyElapsedMs}ms)`);
    const processReadyStatus = client.getMemorySearchWorkerStatus();
    assert.equal(processReadyStatus.broker.state, 'ready', 'listener readiness should be satisfied once the child IPC process is ready');
    assert.ok(['pending', 'completed'].includes(processReadyStatus.warmup.queryStatus), 'the optional query prewarm should be tracked separately from process readiness');
    await waitFor(() => client.getMemorySearchWorkerStatus().warmup.queryStatus === 'completed');
    const status = client.getMemorySearchWorkerStatus();
    assert.equal(status.broker.state, 'ready', 'a slow first query must not leave the explicit worker stopped');
    assert.equal(status.warmup.queryStatus, 'completed');
    assert.ok((status.warmup.processStartupMs || 0) >= 0);
    assert.ok((status.warmup.queryDurationMs || 0) >= warmupDelayMs, 'the regression must exercise a genuinely slow first-query phase');
    assert.ok(Date.now() - startedAt >= warmupDelayMs);

    const result = await client.searchMemoryInWorker('memory_search', {
      workspacePath,
      params: { query: 'cold readiness', mode: 'quick', limit: 4, rerank: false, queryRoute: 'readiness_regression' },
    });
    assert.ok(JSON.parse(result), 'a worker that survived slow prewarm must serve the next real query');

    console.log('memory search worker readiness regression passed');
  } finally {
    await (await import('./search-worker-client.js')).shutdownMemorySearchWorker();
    await (await import('./index.js')).shutdownMemoryIndexRefreshWorker();
    (await import('./index.js')).closeSqliteMemoryConnections();
    fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
