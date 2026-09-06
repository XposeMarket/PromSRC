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
    const sessionDir = sessionApi.getSessionStorageDirectory();
    const privateSession = sessionApi.getSession('background_private_runtime');
    privateSession.channel = 'system';
    privateSession.history.push({ role: 'user', content: 'private background runtime should not be discoverable', timestamp: Date.now() });
    sessionApi.flushSession('background_private_runtime');
    const visibleSession = sessionApi.getSession('visible_session');
    visibleSession.channel = 'web';
    visibleSession.history.push({ role: 'user', content: 'visible session remains searchable', timestamp: Date.now() });
    sessionApi.flushSession('visible_session');
    const discovered = sessionApi.listSessionSummaries({ scope: 'all', state: 'all', limit: 200 });
    assert.equal(discovered.sessions.some((summary) => summary.id === 'background_private_runtime'), false, 'background runtime sessions must stay out of summaries');
    assert.equal(sessionApi.searchSessionSummaries('private background runtime', { scope: 'all', state: 'all' }).some((summary) => summary.id === 'background_private_runtime'), false, 'background runtime sessions must stay out of search');
    assert.equal(discovered.sessions.some((summary) => summary.id === 'visible_session'), true, 'ordinary sessions must remain discoverable');
    const status = sessionApi.getSessionCacheStatus();
    assert.ok(status.estimatedBytes > 0);
    assert.ok(status.estimatedBytes <= status.maxBytes, 'byte-weighted pruning should release idle oversized sessions');
    assert.ok(status.loaded <= 4, 'session visibility checks must not bypass cache limits');
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
