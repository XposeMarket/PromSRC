import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clearHybridMemoryAtomCache, prewarmHybridMemoryAtoms, retrieveHybridMemoryAtoms } from './memory-atoms-hybrid.js';

// Slow fake provider: bulk atom embedding costs 50ms per text, a query costs 5ms.
let batchCalls = 0;
let embeddedTexts = 0;
const provider: any = {
  id: 'fake', label: 'fake', local: true, defaultModel: 'fake-1',
  async status() { return { ok: true, providerId: 'fake', model: 'fake-1', local: true }; },
  async embedQuery(input: string) { await new Promise((r) => setTimeout(r, 5)); return { vector: vec(input), providerId: 'fake', model: 'fake-1', dimensions: 8 }; },
  async embedBatch(inputs: string[]) {
    batchCalls += 1; embeddedTexts += inputs.length;
    await new Promise((r) => setTimeout(r, 50 * inputs.length));
    return inputs.map((input) => ({ vector: vec(input), providerId: 'fake', model: 'fake-1', dimensions: 8 }));
  },
};
function vec(text: string): number[] { const v = new Array(8).fill(0); for (let i = 0; i < text.length; i++) v[i % 8] += text.charCodeAt(i) / 1000; return v; }

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-fast-'));
const bullets = Array.from({ length: 12 }, (_, i) => `- Latency fact ${i}: first token speed matters for topic${i}. [2026-10-08]`);
fs.writeFileSync(path.join(ws, 'MEMORY.md'), `# Memory\n\n## perf\n${bullets.join('\n')}\n`);

(async () => {
  // Cold, no prewarm: hot path must not wait for 12 x 50ms bulk embedding.
  let t = Date.now();
  await retrieveHybridMemoryAtoms(ws, 'first token latency', { embeddingProvider: provider, semanticBudgetMs: 750 });
  assert.ok(Date.now() - t < 200, `cold hot path blocked ${Date.now() - t}ms`);

  // Background backfill started by the cold call; prewarm joins the in-flight job.
  await prewarmHybridMemoryAtoms(ws, provider);
  t = Date.now();
  const warm = await retrieveHybridMemoryAtoms(ws, 'first token latency', { embeddingProvider: provider, semanticBudgetMs: 750 });
  assert.equal(warm.hybrid.semanticUsed, true, 'semantic should be used once vectors exist');
  assert.ok(Date.now() - t < 100, `warm path took ${Date.now() - t}ms`);

  // Edit one bullet: only that atom is re-embedded, and vectors survive a process-level cache clear (disk).
  const before = embeddedTexts;
  fs.appendFileSync(path.join(ws, 'MEMORY.md'), '- New fact about streaming. [2026-10-08]\n');
  clearHybridMemoryAtomCache(ws);
  t = Date.now();
  const edited = await retrieveHybridMemoryAtoms(ws, 'first token latency', { embeddingProvider: provider, semanticBudgetMs: 750 });
  assert.equal(edited.hybrid.semanticUsed, true, 'disk vectors keep semantic retrieval alive after an edit');
  assert.ok(Date.now() - t < 100, `edited path took ${Date.now() - t}ms`);
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(embeddedTexts - before <= 2, `re-embedded ${embeddedTexts - before} atoms after a one-bullet edit`);
  assert.ok(fs.existsSync(path.join(ws, '.prometheus', 'cache', 'memory-atom-vectors.fake_fake-1.json')));
  console.log('memory-atoms-hybrid-fast regression passed', { batchCalls, embeddedTexts });
})().catch((e) => { console.error(e); process.exit(1); });
