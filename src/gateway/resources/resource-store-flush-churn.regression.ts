// Gateway memory recycles (2026-10-27): every registry flush deep-copied and
// regex-redacted the whole 28 MB registry, and task journals kept 20 versions
// plus 60 provenance events each. Pins: (1) flush persists the live state
// without a whole-registry copy, (2) every write path is still redacted on
// disk, (3) task resources keep a small history while other kinds keep 20.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-resource-churn-'));
process.env.PROMETHEUS_CONFIG_DIR = tmp;
process.env.PROMETHEUS_DATA_DIR = tmp;

const SECRET = 'sk-live-ABCDEF0123456789';

async function main() {
  const { createResourceStore } = await import('./resource-store');
  const workspace = path.join(tmp, 'ws');
  fs.mkdirSync(workspace, { recursive: true });
  const rootDir = path.join(tmp, 'resources');
  const registryPath = path.join(rootDir, 'registry.json');
  const store = createResourceStore({ rootDir, workspacePath: workspace });

  // (2) Privacy on every provenance/link write path that used to rely on the
  // per-flush sanitize.
  const base = store.attach({
    threadId: 'churn_a', kind: 'link', title: 'base', origin: 'tool_observation' as any,
    locator: { type: 'url', url: 'https://example.com/base' } as any, actor: `Bearer ${SECRET}` as any,
  } as any);
  const id = base.resource.id;
  store.setPinned('churn_a', id, true, `Bearer ${SECRET}`);
  store.markStatus(id, 'stale', `token=${SECRET}`, { token: SECRET, url: `https://example.com/?api_key=${SECRET}` });
  store.markStatus(id, 'available', 'system');
  store.recordBrowserVisit({ url: `https://example.com/visited?access_token=${SECRET}`, title: 'visit', threadId: 'churn_a', browserSessionId: 's1' } as any);
  store.copyThreadResources('churn_a', 'churn_b', { actor: `Bearer ${SECRET}`, inheritedBy: `password=${SECRET}` });

  // (1) Flush writes the live object itself (no sanitizeResourceState copy).
  const liveBefore = (store as any).live?.state;
  assert.ok(liveBefore, 'store has a live state before flush');
  store.flushSync();
  assert.equal((store as any).live.state, liveBefore, 'flush must not replace the live state with a sanitized deep copy');
  const raw = fs.readFileSync(registryPath, 'utf8');
  assert.ok(!raw.includes(SECRET), 'no write path may persist an unredacted secret');
  assert.ok(raw.includes('[REDACTED]'), 'redaction markers are persisted');

  // (3) Task retention: repeated journal syncs keep a short history.
  let lastTask: any;
  for (let i = 0; i < 30; i += 1) {
    lastTask = store.syncTaskJournal({
      id: 'task_churn_1', title: 'Churn task', sessionId: 'churn_task_thread', status: 'running',
      journal: Array.from({ length: i + 1 }, (_, n) => ({ timestamp: `t${n}`, type: 'step', content: `step ${n}` })) as any,
      updatedAt: new Date(Date.now() + i).toISOString(),
    });
  }
  // A non-task resource with the same churn keeps the normal 20.
  let lastFile: any;
  for (let i = 0; i < 30; i += 1) {
    lastFile = store.attach({
      threadId: 'churn_file_thread', kind: 'file', title: 'notes', mimeType: 'text/plain', origin: 'upload' as any,
      locator: { type: 'file', canonical: 'test:notes' } as any, content: `notes v${i}`, snapshotKind: 'text', actor: 'user' as any,
    } as any);
  }
  store.flushSync();
  const state = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const taskId = lastTask.resource.id;
  const taskVersions = state.versions.filter((v: any) => v.resourceId === taskId);
  const taskProvenance = state.provenance.filter((p: any) => p.resourceId === taskId);
  assert.ok(taskVersions.length <= 3, `task versions capped at 3, got ${taskVersions.length}`);
  assert.ok(taskProvenance.length <= 8, `task provenance capped at 8, got ${taskProvenance.length}`);
  const taskResource = state.resources.find((r: any) => r.id === taskId);
  assert.ok(taskVersions.some((v: any) => v.id === taskResource.currentVersionId), 'current task version is never pruned');
  const taskLink = state.links.find((l: any) => l.resourceId === taskId && l.threadId === 'churn_task_thread');
  assert.ok(taskVersions.some((v: any) => v.id === taskLink.versionId), 'link-pinned task version is never pruned');
  const text = store.getThreadResourceContent('churn_task_thread', taskId).text || '';
  assert.ok(text.includes('step 29'), 'newest journal content is still readable');
  const fileVersions = state.versions.filter((v: any) => v.resourceId === lastFile.resource.id);
  assert.equal(fileVersions.length, 20, 'non-task resources keep 20 versions');

  console.log('resource-store flush churn regression: ok');
}

main().catch((error) => { console.error(error); process.exit(1); });
