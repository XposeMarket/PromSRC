// getContext() runs on every chat turn. It used to reparse and re-sanitize the
// whole registry (18+ MB in real installs) each time, costing ~0.5s of
// time-to-first-token. It now reuses a parsed copy keyed on file mtime/size.
// This test pins that the cache (a) is invalidated by our own writes, and
// (b) is invalidated when another process rewrites the registry file.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-resource-cache-'));
process.env.PROMETHEUS_CONFIG_DIR = tmp;
process.env.PROMETHEUS_DATA_DIR = tmp;

async function main() {
  const { createResourceStore } = await import('./resource-store');
  const workspace = path.join(tmp, 'ws');
  fs.mkdirSync(workspace, { recursive: true });
  const rootDir = path.join(tmp, 'resources');
  const store = createResourceStore({ rootDir, workspacePath: workspace });
  const thread = 'cache_thread_1';

  assert.equal(store.getContext(thread, 'alpha').resourceIds.length, 0, 'empty registry yields no context');

  store.attach({
    threadId: thread, kind: 'file', title: 'alpha notes', mimeType: 'text/plain', origin: 'upload' as any,
    locator: { type: 'file', canonical: 'test:alpha' } as any, content: 'alpha body text', snapshotKind: 'text', actor: 'user' as any,
  } as any);
  const first = store.getContext(thread, 'alpha');
  assert.equal(first.resourceIds.length, 1, 'own write must invalidate the read cache');

  // Repeated reads with no file change must still be correct.
  assert.equal(store.getContext(thread, 'alpha').resourceIds.length, 1);

  // Simulate another process rewriting the registry: drop all links.
  const registryPath = path.join(rootDir, 'registry.json');
  const raw = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  raw.links = [];
  await new Promise((r) => setTimeout(r, 20));
  fs.writeFileSync(registryPath, JSON.stringify(raw), 'utf8');
  assert.equal(store.getContext(thread, 'alpha').resourceIds.length, 0, 'external rewrite must invalidate the read cache');

  console.log('resource-store-read-cache regression: ok');
}

main().catch((error) => { console.error(error); process.exit(1); });
