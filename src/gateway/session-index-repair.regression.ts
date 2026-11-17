import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Regression for the Nov 17 2026 boot stall: one stale index row (for example a
// single-message chat whose 60-char preview equals its 60-char title) used to
// trigger a synchronous rebuild of EVERY transcript on the first sidebar list
// request after boot. On a ~2 GB corpus that blocked the event loop ~25 s, the
// supervisor health probe timed out and every page loaded empty.

function writeSession(dir: string, id: string, data: Record<string, unknown>): void {
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ id, ...data }));
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-session-index-repair-'));
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = root;
  const sessionDir = path.join(root, '.prometheus', 'sessions');
  fs.mkdirSync(sessionDir, { recursive: true });

  try {
    const now = Date.now();
    const longText = 'Pls fix these formatting issues on the approval cards in the task page and chat overlay too';
    const assistant = {
      role: 'assistant',
      content: 'Fixed.',
      timestamp: now - 1_000,
      turnProviderUsage: { lastCall: { provider: 'anthropic', model: 'claude-opus-5-5' } },
    };

    // Healthy row: indexed and current.
    writeSession(sessionDir, 'web_healthy', {
      channel: 'web', createdAt: now - 10_000, lastActiveAt: now - 1_000,
      history: [{ role: 'user', content: 'hello there', timestamp: now - 2_000 }, assistant],
    });
    // Stale row: single long user message, so the truncated preview equals the title.
    writeSession(sessionDir, 'web_stale', {
      channel: 'web', createdAt: now - 20_000, lastActiveAt: now - 5_000,
      history: [{ role: 'user', content: longText, timestamp: now - 5_000 }],
    });
    // On disk but missing from the index. A full rebuild would add it; a targeted
    // repair must not, so its absence proves no corpus scan ran on the request path.
    writeSession(sessionDir, 'web_unindexed', {
      channel: 'web', createdAt: now - 30_000, lastActiveAt: now - 3_000,
      history: [{ role: 'user', content: 'not in the index', timestamp: now - 3_000 }, assistant],
    });

    const indexRow = (id: string, extra: Record<string, unknown>) => ({
      id, channel: 'web', createdAt: now - 10_000, lastActiveAt: now - 1_000, lastMessageAt: now - 1_000,
      lastModelVersion: 2, lastModel: { providerId: 'anthropic', model: 'claude-opus-5-5' }, ...extra,
    });
    fs.writeFileSync(path.join(sessionDir, '_index.json'), JSON.stringify({
      updatedAt: now,
      summaries: {
        web_healthy: indexRow('web_healthy', { messageCount: 2, title: 'hello there', preview: 'Fixed.' }),
        web_stale: indexRow('web_stale', {
          messageCount: 1, title: longText.slice(0, 60), preview: longText, lastModelVersion: 1,
        }),
      },
    }));

    const sessionApi = await import('./session');

    const started = Date.now();
    const first = sessionApi.listSessionSummaries({ channel: 'web', scope: 'all', state: 'all', limit: 50, offset: 0 });
    const ids = first.sessions.map((s) => s.id).sort();
    assert.deepEqual(ids, ['web_healthy', 'web_stale'], 'first list is served from the index without a corpus rebuild');
    assert.ok(Date.now() - started < 2_000, 'first list returns promptly');

    await sessionApi.waitForSessionIndexRepair();

    const index = JSON.parse(fs.readFileSync(path.join(sessionDir, '_index.json'), 'utf-8'));
    assert.equal(index.summaries.web_unindexed, undefined, 'background repair touches only stale rows, never the whole corpus');
    assert.equal(index.summaries.web_stale.lastModelVersion, 2, 'stale row was rehydrated from its transcript');
    assert.equal(index.summaries.web_stale.messageCount, 1);
    assert.equal(index.summaries.web_healthy.title, 'hello there', 'healthy rows are left as-is');

    // A second list in the same process must not schedule another repair pass.
    sessionApi.listSessionSummaries({ channel: 'web', scope: 'all', state: 'all', limit: 50, offset: 0 });
    await sessionApi.waitForSessionIndexRepair();

    console.log('session index repair regression: ok');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function emptyIndexStillRebuilds(): Promise<void> {
  // Separate process-level module state is not available here, so the empty-index
  // path is covered by running this file's second scenario in a child process.
  const { spawnSync } = await import('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-session-index-empty-'));
  try {
    const sessionDir = path.join(root, '.prometheus', 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });
    writeSession(sessionDir, 'web_only', {
      channel: 'web', createdAt: 1, lastActiveAt: 2,
      history: [{ role: 'user', content: 'only chat', timestamp: 2 }],
    });
    const script = `
      process.env.PROMETHEUS_DATA_DIR = ${JSON.stringify(root)};
      process.env.PROMETHEUS_WORKSPACE_DIR = ${JSON.stringify(root)};
      import(${JSON.stringify(pathToFileURL(path.join(__dirname, 'session.ts')).href)}).then((api) => {
        const page = api.listSessionSummaries({ channel: 'web', scope: 'all', state: 'all', limit: 10, offset: 0 });
        process.stdout.write(JSON.stringify(page.sessions.map((s) => s.id)));
      });`;
    const result = spawnSync(process.execPath, ['--import', 'tsx', '-e', script], { encoding: 'utf-8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim().split('\n').pop() || '[]'), ['web_only'], 'a missing/empty index is still rebuilt synchronously');
    console.log('session index empty rebuild: ok');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main()
  .then(emptyIndexStillRebuilds)
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
