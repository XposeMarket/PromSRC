import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { MemoryEmbeddingProvider, MemoryEmbeddingResult, MemoryEmbeddingProviderStatus } from '../memory/embeddings/types.js';
import {
  clearHybridMemoryAtomCache,
  retrieveHybridMemoryAtoms,
} from './memory-atoms-hybrid.js';

const fixture = `# MEMORY.md - Hybrid regression fixture

## project_memory
- Atlas source modifications require a safety snapshot before changing repository files.
- Atlas release credentials live in the secure deployment vault and are never copied into chat.
- Mercury mobile companion keeps conversations synchronized through a relay queue.
- Mercury launch remains blocked until legal approval is signed.
- Browser navigation must anchor the page before repeated blind scrolling.

## key_decisions
- SQLite persistence uses WAL so concurrent readers do not stall behind ordinary writes.
- Destructive file removal requires a verified backup and explicit approval first.
- Production deployments require a smoke test after publishing the application.
- The support inbox should receive short direct replies rather than long essays.
- ORANGE_SENTINEL is a ceramic glaze inventory code unrelated to software delivery.

## preferences
- Prefer compact technical status updates that lead with the concrete result.
- Voice requests that fit the direct voice tool allowlist should not be handed to a worker.
`;

type Concept = 'code_safety' | 'release_secret' | 'mobile_sync' | 'legal_block' | 'browser_anchor' | 'sqlite_wal' | 'delete_safety' | 'deploy_smoke' | 'support_style' | 'ceramic' | 'status_style' | 'voice_direct';

const DIMENSIONS: Record<Concept, number> = {
  code_safety: 0,
  release_secret: 1,
  mobile_sync: 2,
  legal_block: 3,
  browser_anchor: 4,
  sqlite_wal: 5,
  delete_safety: 6,
  deploy_smoke: 7,
  support_style: 8,
  ceramic: 9,
  status_style: 10,
  voice_direct: 11,
};

const semanticSignals: Record<Concept, RegExp[]> = {
  code_safety: [/atlas source/i, /safety snapshot/i, /precaution.*touch.*code/i, /protect.*before.*codebase/i, /safeguard.*repository/i],
  release_secret: [/release credentials/i, /deployment vault/i, /where.*shipping secret/i, /publish.*credential/i],
  mobile_sync: [/mercury mobile/i, /relay queue/i, /phone.*conversation.*stay.*same/i, /handset.*chat.*sync/i],
  legal_block: [/mercury launch/i, /legal approval/i, /lawyer.*sign/i, /counsel.*holding.*ship/i],
  browser_anchor: [/browser navigation/i, /blind scrolling/i, /orient.*page.*scroll/i, /anchor.*before.*scroll/i],
  sqlite_wal: [/sqlite persistence/i, /concurrent readers/i, /simultaneous.*read.*write/i, /database.*avoid.*reader.*stall/i],
  delete_safety: [/destructive file removal/i, /verified backup/i, /before.*erase.*disk/i, /purge.*without.*losing/i],
  deploy_smoke: [/production deployments/i, /smoke test/i, /after.*ship.*application/i, /verify.*once.*published/i],
  support_style: [/support inbox/i, /short direct replies/i, /customer.*message.*brief/i],
  ceramic: [/orange_sentinel/i, /ceramic glaze/i, /pottery.*inventory/i],
  status_style: [/compact technical status/i, /lead with the concrete result/i, /update.*bottom line.*first/i],
  voice_direct: [/direct voice tool/i, /handed to a worker/i, /speech.*handle.*itself/i, /voice.*without.*delegat/i],
};

function semanticVector(text: string): number[] {
  const vector = new Array(Object.keys(DIMENSIONS).length).fill(0);
  for (const [concept, patterns] of Object.entries(semanticSignals) as Array<[Concept, RegExp[]]>) {
    if (patterns.some((pattern) => pattern.test(text))) vector[DIMENSIONS[concept]] = 1;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0));
  return magnitude ? vector.map((value) => value / magnitude) : vector;
}

class FakeSemanticProvider implements MemoryEmbeddingProvider {
  id = 'fake-semantic';
  label = 'Fake semantic regression provider';
  defaultModel = 'fixture-concepts-v1';
  local = true;
  batchCalls = 0;
  queryCalls = 0;
  delayMs = 0;
  fail = false;

  async status(): Promise<MemoryEmbeddingProviderStatus> {
    return { ok: !this.fail, providerId: this.id, model: this.defaultModel, dimensions: 12, local: true };
  }

  private async make(text: string): Promise<MemoryEmbeddingResult> {
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.fail) throw new Error('synthetic embedding provider failure');
    const vector = semanticVector(text);
    return { vector, providerId: this.id, model: this.defaultModel, dimensions: vector.length };
  }

  async embedQuery(input: string): Promise<MemoryEmbeddingResult> {
    this.queryCalls += 1;
    return this.make(input);
  }

  async embedBatch(inputs: string[]): Promise<MemoryEmbeddingResult[]> {
    this.batchCalls += 1;
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.fail) throw new Error('synthetic embedding provider failure');
    return inputs.map((input) => {
      const vector = semanticVector(input);
      return { vector, providerId: this.id, model: this.defaultModel, dimensions: vector.length };
    });
  }
}

function selectedText(result: Awaited<ReturnType<typeof retrieveHybridMemoryAtoms>>): string {
  return result.selected.map((entry) => entry.atom.rawText).join('\n');
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-hybrid-memory-'));
  fs.writeFileSync(path.join(root, 'MEMORY.md'), fixture, 'utf-8');
  clearHybridMemoryAtomCache(root);
  const provider = new FakeSemanticProvider();

  // True semantic paraphrases: these deliberately avoid the fixture's important
  // literal nouns wherever possible so lexical overlap alone cannot carry them.
  const semanticCases: Array<[string, RegExp]> = [
    ['What precautions do I take before touching the codebase?', /Atlas source modifications/i],
    ['How do chats on the handset stay the same as the desktop?', /Mercury mobile companion/i],
    ['What work is waiting for the lawyers to sign?', /Mercury launch remains blocked/i],
    ['Which database choice stops readers getting jammed up by writers?', /SQLite persistence uses WAL/i],
    ['What should happen before I erase something from disk?', /Destructive file removal/i],
    ['How do I orient myself on a page before moving far down it?', /Browser navigation must anchor/i],
    ['What check happens once the application has been shipped?', /Production deployments require a smoke test/i],
    ['Where should a shipping secret be kept?', /release credentials live in the secure deployment vault/i],
    ['Can speech handle simple allowed actions itself instead of delegating?', /Voice requests that fit the direct voice tool allowlist/i],
    ['For an update, put the bottom line first and keep it tight.', /Prefer compact technical status updates/i],
  ];
  for (const [query, expected] of semanticCases) {
    const result = await retrieveHybridMemoryAtoms(root, query, { embeddingProvider: provider, semanticBudgetMs: 500, maxAtoms: 6 });
    assert.equal(result.hybrid.semanticUsed, true, `semantic provider should be used for: ${query}`);
    assert.match(selectedText(result), expected, `semantic paraphrase missed: ${query}`);
  }

  // Deterministic path must remain useful with no embedding provider.
  const deterministicCases: Array<[string, RegExp]> = [
    ['Atlas source safety snapshot repository', /Atlas source modifications/i],
    ['Mercury mobile relay queue', /Mercury mobile companion/i],
    ['SQLite WAL concurrent readers', /SQLite persistence uses WAL/i],
    ['destructive file removal verified backup approval', /Destructive file removal/i],
    ['ORANGE_SENTINEL ceramic glaze', /ORANGE_SENTINEL/i],
  ];
  for (const [query, expected] of deterministicCases) {
    const result = await retrieveHybridMemoryAtoms(root, query, { embeddingProvider: null, maxAtoms: 6 });
    assert.equal(result.hybrid.semanticUsed, false);
    assert.match(selectedText(result), expected, `deterministic fallback missed: ${query}`);
  }

  // Important-but-irrelevant memories must not leak into unrelated turns.
  const negatives = [
    'What is the weather tomorrow?',
    'Convert twelve miles to kilometers.',
    'Write a haiku about rain.',
    'Who painted the Mona Lisa?',
    'Explain photosynthesis to a ten year old.',
    'What time is it in Tokyo?',
    'Give me a pancake recipe.',
    'How many moons does Jupiter have?',
    'Tell me a joke about penguins.',
    'What is the capital of Peru?',
    'Summarize the plot of Hamlet.',
    'How do I tune a guitar?',
  ];
  for (const query of negatives) {
    const result = await retrieveHybridMemoryAtoms(root, query, { embeddingProvider: provider, semanticBudgetMs: 500 });
    assert.equal(result.selected.length, 0, `unrelated query injected durable memory: ${query}\n${selectedText(result)}`);
  }

  // Ambiguous one-word terms should not fan out across durable memory.
  for (const query of ['release', 'launch', 'project', 'memory', 'app']) {
    const result = await retrieveHybridMemoryAtoms(root, query, { embeddingProvider: null });
    assert.ok(result.selected.length <= 1, `ambiguous single term flooded memory: ${query}`);
  }

  // Related expansion can bring a genuinely linked sibling, but not a merely
  // important global rule. Mercury sync and launch share a rare entity anchor.
  const related = await retrieveHybridMemoryAtoms(root, 'How do handset chats stay synchronized?', {
    embeddingProvider: provider,
    semanticBudgetMs: 500,
    maxAtoms: 6,
  });
  assert.match(selectedText(related), /Mercury mobile companion/i);
  assert.ok(!/ORANGE_SENTINEL/i.test(selectedText(related)), 'unrelated sentinel must never ride along as helpful context');
  assert.ok(!/Destructive file removal/i.test(selectedText(related)), 'generic safety rule must not ride along with mobile sync');

  // Embeddings for atoms are cached by source hash/provider; repeated queries
  // should not re-embed the entire MEMORY.md.
  clearHybridMemoryAtomCache(root);
  provider.batchCalls = 0;
  await retrieveHybridMemoryAtoms(root, 'How do handset chats stay the same?', { embeddingProvider: provider, semanticBudgetMs: 500 });
  await retrieveHybridMemoryAtoms(root, 'Which database setup keeps readers moving?', { embeddingProvider: provider, semanticBudgetMs: 500 });
  assert.equal(provider.batchCalls, 1, 'atom embeddings should be cached across queries');

  // Changing MEMORY.md invalidates the source-hash cache and makes the new atom
  // retrievable without an explicit process restart.
  fs.appendFileSync(path.join(root, 'MEMORY.md'), '\n- Comet backups are stored in an offline archive before migration.\n');
  const changed = await retrieveHybridMemoryAtoms(root, 'Comet backups offline archive migration', { embeddingProvider: null });
  assert.match(selectedText(changed), /Comet backups are stored/i);

  // Provider failure and timeout must degrade to deterministic recall, never to
  // an empty memory system or an exception in prompt assembly.
  const failing = new FakeSemanticProvider();
  failing.fail = true;
  const failureFallback = await retrieveHybridMemoryAtoms(root, 'SQLite WAL concurrent readers', { embeddingProvider: failing, semanticBudgetMs: 100 });
  assert.match(selectedText(failureFallback), /SQLite persistence uses WAL/i);
  assert.equal(failureFallback.hybrid.semanticUsed, false);
  assert.ok(failureFallback.hybrid.semanticError);

  const slow = new FakeSemanticProvider();
  slow.delayMs = 100;
  const timeoutFallback = await retrieveHybridMemoryAtoms(root, 'destructive file removal verified backup approval', { embeddingProvider: slow, semanticBudgetMs: 40 });
  assert.match(selectedText(timeoutFallback), /Destructive file removal/i);
  assert.equal(timeoutFallback.hybrid.semanticUsed, false);
  assert.equal(timeoutFallback.hybrid.semanticTimedOut, true);

  // Prompt budget gates stay bounded even when a query is broad.
  const broad = await retrieveHybridMemoryAtoms(root, 'Atlas Mercury browser database file deployment support voice status', {
    embeddingProvider: provider,
    semanticBudgetMs: 500,
    maxAtoms: 3,
    maxChars: 1600,
  });
  assert.ok(broad.selected.length <= 3);
  assert.ok(selectedText(broad).length < 1600);

  // Fuzz the semantic paraphrases with conversational wrappers. This is still
  // fully model-less and catches scoring regressions caused by filler language.
  const prefixes = ['Hey, ', 'Quick question: ', 'Can you remind me, ', 'I vaguely remember this — ', 'Before I continue, '];
  const suffixes = ['', ' please', ' from before', ' again', ' if it matters here'];
  let fuzzed = 0;
  for (const [base, expected] of semanticCases) {
    for (const prefix of prefixes) {
      for (const suffix of suffixes) {
        const query = `${prefix}${base}${suffix}`;
        const result = await retrieveHybridMemoryAtoms(root, query, { embeddingProvider: provider, semanticBudgetMs: 500, maxAtoms: 6 });
        assert.match(selectedText(result), expected, `fuzzed semantic paraphrase missed: ${query}`);
        fuzzed += 1;
      }
    }
  }

  console.log(`memory-atoms-hybrid regression passed: ${semanticCases.length} semantic + ${deterministicCases.length} deterministic + ${negatives.length} negative + ${fuzzed} fuzzed paraphrase queries`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
