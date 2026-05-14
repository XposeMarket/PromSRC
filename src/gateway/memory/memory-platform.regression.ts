import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { hashMemoryEmbeddingProvider } from './embeddings/hash-provider';
import { rerankMmr } from './ranking/mmr';
import { temporalDecayMultiplier } from './ranking/temporal-decay';
import { consolidateMemory, reviewMemoryClaim } from './consolidation/runner';

async function testHashProvider() {
  const status = await hashMemoryEmbeddingProvider.status();
  assert.equal(status.ok, true);
  const result = await hashMemoryEmbeddingProvider.embedQuery('Prometheus memory platform');
  assert.equal(result.providerId, 'hash');
  assert.equal(result.dimensions, 96);
  assert.equal(result.vector.length, 96);
}

function testMmr() {
  const ranked = rerankMmr([
    { id: 'a', score: 1, vector: [1, 0], text: 'alpha memory' },
    { id: 'b', score: 0.99, vector: [1, 0], text: 'alpha memory duplicate' },
    { id: 'c', score: 0.92, vector: [0, 1], text: 'beta different memory' },
  ], 2, { enabled: true, lambda: 0.55, candidatePool: 3 });
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].id, 'a');
  assert.equal(ranked[1].id, 'c');
}

function testTemporalDecay() {
  const oldRaw = temporalDecayMultiplier({
    timestampMs: Date.now() - 180 * 86400000,
    sourceType: 'chat_session',
    sourcePath: 'chats/sessions/example.json',
  });
  const oldEvergreen = temporalDecayMultiplier({
    timestampMs: Date.now() - 180 * 86400000,
    sourceType: 'memory_root',
    sourcePath: 'memory/root/MEMORY.md',
  });
  assert.ok(oldRaw < 0.2, `expected old raw transcript to decay, got ${oldRaw}`);
  assert.equal(oldEvergreen, 1);
}

function testConsolidation() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-memory-platform-'));
  try {
    const auditChat = path.join(root, 'audit', 'chats', 'sessions');
    fs.mkdirSync(auditChat, { recursive: true });
    fs.writeFileSync(
      path.join(auditChat, 'session.json'),
      [
        'User preference: prefers local-first embeddings when privacy matters.',
        'Decision: use MMR reranking for memory search results.',
      ].join('\n'),
      'utf-8',
    );
    const result = consolidateMemory(root, { maxSources: 20, maxClaims: 10 });
    assert.ok(result.proposed >= 2, `expected at least two claims, got ${result.proposed}`);
    const claim = result.claims[0];
    assert.ok(claim?.id);
    const accepted = reviewMemoryClaim(root, claim.id, 'accept', 'regression');
    assert.equal(accepted.ok, true);
    assert.ok(accepted.sourcePath?.includes('memory/files/curated-claims/'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function main() {
  await testHashProvider();
  testMmr();
  testTemporalDecay();
  testConsolidation();
  console.log('memory-platform regression ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
