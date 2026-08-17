import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-session-search-worker-'));
process.env.PROMETHEUS_DATA_DIR = tempRoot;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(tempRoot, 'workspace');

async function main(): Promise<void> {
  let workerApi: typeof import('./session-search-worker-client') | undefined;
  try {
    const sessionApi = await import('../session');
    workerApi = await import('./session-search-worker-client');

    const addMessage = (id: string, title: string, content: string): void => {
      sessionApi.touchSession(id, { channel: 'mobile', title });
      sessionApi.addMessage(id, {
        role: 'user',
        content,
        timestamp: Date.now(),
      }, {
        disableCompactionCheck: true,
        disableMemoryFlushCheck: true,
      });
      sessionApi.flushSession(id);
    };

    addMessage('session_search_worker_owner', 'Owner thread', 'A normal conversation.');
    addMessage('session_search_worker_target', 'Recent Unity setup', 'Please locate the Unity MCP setup thread.');

    const found = await workerApi.searchSessionSummariesInWorker('Unity MCP', {
      state: 'all',
      limit: 20,
    });
    assert.equal(found.diagnostics.isolation, 'child_process');
    assert.equal(found.diagnostics.complete, true);
    assert.equal(found.results.some((result) => result.id === 'session_search_worker_target'), true);

    console.log('session search worker regression passed');
  } finally {
    await workerApi?.shutdownSessionSearchWorker().catch(() => undefined);
    const resolved = path.resolve(tempRoot);
    const tempBase = path.resolve(os.tmpdir());
    if (resolved.startsWith(`${tempBase}${path.sep}`)) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
}

void main();
