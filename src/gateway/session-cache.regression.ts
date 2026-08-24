import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-session-cache-'));
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = root;
  process.env.PROMETHEUS_SESSION_CACHE_MAX_BYTES = String(16 * 1024 * 1024);

  try {
    const sessionApi = await import('./session');
    for (const id of ['cache_large_a', 'cache_large_b']) {
      const session = sessionApi.getSession(id);
      session.history.push({ role: 'user', content: 'x'.repeat(9 * 1024 * 1024), timestamp: Date.now() });
      session.lastActiveAt = Date.now() - 31 * 60 * 1000;
      sessionApi.flushSession(id);
    }

    sessionApi.getSession('cache_small_c');
    const status = sessionApi.getSessionCacheStatus();
    assert.ok(status.estimatedBytes > 0);
    assert.ok(status.estimatedBytes <= status.maxBytes, 'byte-weighted pruning should release idle oversized sessions');
    assert.ok(status.loaded < 3, 'at least one idle oversized session should be evicted');
    assert.equal(status.estimateStale, true, 'status should report a dirty estimate without remeasuring the retained session');
    console.log('session cache byte-budget regression: ok');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
