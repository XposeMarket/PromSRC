import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(`Timed out after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function main(): Promise<void> {
  // Make the optional automatic prewarm worker fail after process readiness.
  // This isolates detached-Promise handling from the separate cold-elastic SLA
  // regression, while still exercising the real worker/client path.
  process.env.PROMETHEUS_AUTOMATIC_MEMORY_SEARCH_WORKERS = '2';
  process.env.PROMETHEUS_MEMORY_SEARCH_WORKER_TEST_HOOKS = '1';
  process.env.PROMETHEUS_MEMORY_SEARCH_WORKER_TEST_AUTOMATIC_PREWARM_FAILURE = '1';

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-automatic-memory-prewarm-'));
  const workspacePath = path.join(root, 'workspace');
  const memoryRoot = path.join(workspacePath, 'audit', 'memory', 'root');
  fs.mkdirSync(memoryRoot, { recursive: true });
  fs.writeFileSync(path.join(memoryRoot, 'MEMORY.md'), '# MEMORY\n\n- Prewarm failure handling.\n', 'utf8');

  const {
    closeSqliteMemoryConnections,
    refreshMemoryIndexFromAudit,
    shutdownMemoryIndexRefreshWorker,
  } = await import('./index.js');
  const client = await import('./search-worker-client.js');

  const unhandledRejections: unknown[] = [];
  const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);
  process.on('unhandledRejection', onUnhandledRejection);
  try {
    refreshMemoryIndexFromAudit(workspacePath, {
      force: true,
      minIntervalMs: 0,
      maxChangedFiles: 100,
      syncSqlite: true,
    });

    await client.warmAutomaticMemorySearchWorkers(workspacePath, { awaitPrewarm: false });
    await waitFor(() => client.getAutomaticMemorySearchWorkerStatus().workers.every((worker) => worker.prewarmStatus === 'failed'));
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(unhandledRejections.length, 0, 'a failed detached automatic prewarm must not emit unhandledRejection');
    console.log('automatic memory prewarm rejection regression passed');
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
    delete process.env.PROMETHEUS_MEMORY_SEARCH_WORKER_TEST_AUTOMATIC_PREWARM_FAILURE;
    await client.shutdownMemorySearchWorker();
    await shutdownMemoryIndexRefreshWorker();
    closeSqliteMemoryConnections();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
