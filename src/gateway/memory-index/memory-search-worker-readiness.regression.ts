import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main(): Promise<void> {
  // Import the client only after the policy is configured. The regression
  // intentionally makes the first query exceed the old 2s warmup gate.
  process.env.PROMETHEUS_MEMORY_SEARCH_WORKER_TEST_HOOKS = '1';
  process.env.PROMETHEUS_MEMORY_SEARCH_WARMUP_TIMEOUT_MS = '2000';
  process.env.PROMETHEUS_MEMORY_SEARCH_WORKER_TEST_WARMUP_DELAY_MS = '2500';

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
    await client.warmMemorySearchWorker(workspacePath);
    const status = client.getMemorySearchWorkerStatus();
    assert.equal(status.broker.state, 'ready', 'a slow first query must not leave the explicit worker stopped');
    assert.equal(status.warmup.queryStatus, 'completed');
    assert.ok((status.warmup.processStartupMs || 0) >= 0);
    assert.ok((status.warmup.queryDurationMs || 0) >= 2_000, 'the regression must exercise a genuinely slow first-query phase');
    assert.ok(Date.now() - startedAt >= 2_000);

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
