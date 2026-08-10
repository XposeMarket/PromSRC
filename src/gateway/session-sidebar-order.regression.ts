import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-session-sidebar-order-'));
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = root;

  try {
    const sessionApi = await import('./session');
    const ids = ['sidebar_order_a', 'sidebar_order_b', 'sidebar_order_c'];
    for (const [index, id] of ids.entries()) {
      sessionApi.addMessage(id, { role: 'user', content: `session ${id}`, timestamp: Date.now() + index });
      sessionApi.flushSession(id);
    }

    const reordered = sessionApi.reorderSessionSidebar(['sidebar_order_c', 'sidebar_order_a'], {
      channel: 'web',
      state: 'all',
    });
    assert.deepEqual(reordered.slice(0, 3).map((session) => session.id), ids.length
      ? ['sidebar_order_c', 'sidebar_order_a', 'sidebar_order_b']
      : []);

    const listed = sessionApi.listSessionSummaries({ channel: 'web', scope: 'all', state: 'all', limit: 20, offset: 0 });
    assert.deepEqual(listed.sessions.slice(0, 3).map((session) => session.id), [
      'sidebar_order_c',
      'sidebar_order_a',
      'sidebar_order_b',
    ]);

    const index = JSON.parse(fs.readFileSync(path.join(root, '.prometheus', 'sessions', '_index.json'), 'utf-8'));
    assert.equal(Number(index.summaries.sidebar_order_c.sidebarOrder) > Number(index.summaries.sidebar_order_a.sidebarOrder), true);
    assert.equal(Number(index.summaries.sidebar_order_a.sidebarOrder) > Number(index.summaries.sidebar_order_b.sidebarOrder), true);
    console.log('session sidebar order regression: ok');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
