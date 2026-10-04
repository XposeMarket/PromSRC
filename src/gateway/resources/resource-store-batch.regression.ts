// Registering a turn's card artifacts must cost one registry read/write, not
// one per card. Per-card writes of a 35 MB registry blocked the gateway event
// loop for ~35 s on a 21-card reply; the stall watchdog restarted the gateway
// before the reply was saved, so the phone got the push but no message.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createResourceStore } from './resource-store';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'res-batch-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'res-batch-ws-'));
const store: any = createResourceStore({ rootDir: root, workspacePath: workspace });

let writes = 0;
const realWrite = fs.writeFileSync;
(fs as any).writeFileSync = (file: any, ...rest: any[]) => {
  if (String(file).includes('registry.json')) writes += 1;
  return (realWrite as any)(file, ...rest);
};
try {
  const cards = Array.from({ length: 21 }, (_, i) => ({ type: 'currency', id: `card-${i}`, title: `Card ${i}`, base: 'USD', quote: 'EUR' }));
  cards.push({ type: 'sources', id: 'src', title: 'Sources', items: [{ url: 'https://example.com/a', title: 'A' }] } as any);
  const count = store.registerArtifacts('thread_batch', cards, 'assistant');
  assert.equal(count, 22, 'every artifact registered');
  assert.equal(writes, 1, `one registry write for the whole batch (got ${writes})`);

  writes = 0;
  store.registerArtifact('thread_batch', { type: 'currency', id: 'single', title: 'Single' });
  assert.equal(writes, 1, 'single registration still persists immediately');

  const listed = store.listThreadResources('thread_batch', { limit: 100 });
  assert.ok(listed.length >= 22, `resources visible after batch (${listed.length})`);
  const raw = fs.readFileSync(path.join(root, 'registry.json'), 'utf8');
  assert.ok(!raw.includes('\n  '), 'registry is written as compact JSON');
} finally {
  (fs as any).writeFileSync = realWrite;
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
}
console.log('resource-store batch regression: ok');
