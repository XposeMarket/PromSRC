import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { parseMemoryAtoms } from './memory-atoms.js';
import { clearHybridMemoryAtomCache, retrieveHybridMemoryAtoms } from './memory-atoms-hybrid.js';

const STOP = new Set([
  'about','after','again','also','and','are','been','before','being','but','can','could','current','does','for','from','future','have',
  'into','just','like','more','must','not','only','other','our','over','prometheus','raul','should','some','that','the','their','then','there',
  'these','they','this','through','use','used','using','very','was','were','what','when','where','which','while','with','work','would','your',
  'memory','project','system','user','context','source','file','files','runtime','workspace',
]);

function stem(term: string): string {
  if (term.length > 5 && term.endsWith('ies')) return `${term.slice(0, -3)}y`;
  if (term.length > 5 && term.endsWith('ing')) return term.slice(0, -3);
  if (term.length > 4 && term.endsWith('ed')) return term.slice(0, -2);
  if (term.length > 4 && term.endsWith('es')) return term.slice(0, -2);
  if (term.length > 3 && term.endsWith('s')) return term.slice(0, -1);
  return term;
}

function terms(value: string): string[] {
  return Array.from(new Set(String(value || '').toLowerCase()
    .replace(/[^a-z0-9@._+#/-]+/g, ' ')
    .split(/\s+/)
    .map(stem)
    .filter((term) => term.length >= 3 && !STOP.has(term) && !/^\d+$/.test(term))));
}

async function main(): Promise<void> {
  const workspacePath = path.resolve('workspace');
  const memoryPath = path.join(workspacePath, 'MEMORY.md');
  if (!fs.existsSync(memoryPath)) {
    console.log('memory-atoms real-corpus stress skipped: workspace/MEMORY.md is not present in this checkout');
    return;
  }

  const raw = fs.readFileSync(memoryPath, 'utf-8');
  const atoms = parseMemoryAtoms(raw);
  assert.ok(atoms.length >= 20, `expected a meaningful durable-memory corpus, found ${atoms.length}`);
  const byId = new Map(atoms.map((atom) => [atom.id, atom]));
  const atomTerms = new Map(atoms.map((atom) => [atom.id, terms(atom.rawText)]));
  const df = new Map<string, number>();
  for (const list of atomTerms.values()) {
    for (const term of list) df.set(term, (df.get(term) || 0) + 1);
  }

  function distinctive(atomId: string): string[] {
    return [...(atomTerms.get(atomId) || [])]
      .filter((term) => (df.get(term) || 0) <= Math.max(3, Math.ceil(atoms.length * 0.12)))
      .sort((a, b) => (df.get(a) || 0) - (df.get(b) || 0) || b.length - a.length || a.localeCompare(b));
  }

  clearHybridMemoryAtomCache(workspacePath);
  let positiveQueries = 0;
  let positiveHits = 0;
  let topOneHits = 0;
  let evaluatedAtoms = 0;

  for (const atom of atoms) {
    const rare = distinctive(atom.id);
    if (rare.length < 3) continue;
    evaluatedAtoms += 1;
    const seed3 = rare.slice(0, 3);
    const seed4 = rare.slice(0, 4);
    const entity = atom.entities.find((value) => value.length >= 3 && !/^(?:prometheus|raul)$/i.test(value));
    const variants = [
      seed3.join(' '),
      `remind me about ${seed3.join(' ')}`,
      `what was the context around ${seed3.join(' ')}`,
      `how does ${[...seed4].reverse().join(' ')} fit with what we already know`,
      `from before: ${seed4.join(' ')}`,
      entity ? `${entity} ${seed3.slice(0, 2).join(' ')}` : `previous decision ${seed4.join(' ')}`,
    ];
    for (const query of variants) {
      const result = await retrieveHybridMemoryAtoms(workspacePath, query, {
        embeddingProvider: null,
        maxAtoms: 6,
        maxChars: 14_000,
      });
      positiveQueries += 1;
      const selectedIds = result.selected.map((entry) => entry.atom.id);
      if (selectedIds.includes(atom.id)) positiveHits += 1;
      if (selectedIds[0] === atom.id) topOneHits += 1;
    }
  }

  assert.ok(evaluatedAtoms >= Math.min(20, Math.floor(atoms.length * 0.45)), `too few atoms had enough distinctive terms: ${evaluatedAtoms}/${atoms.length}`);
  const recall = positiveQueries ? positiveHits / positiveQueries : 0;
  const topOne = positiveQueries ? topOneHits / positiveQueries : 0;
  assert.ok(recall >= 0.96, `real-corpus deterministic recall fell below 96%: ${(recall * 100).toFixed(1)}% (${positiveHits}/${positiveQueries})`);
  assert.ok(topOne >= 0.82, `real-corpus top-1 precision fell below 82%: ${(topOne * 100).toFixed(1)}% (${topOneHits}/${positiveQueries})`);

  const unrelatedSeeds = [
    'weather forecast baltimore tomorrow rain temperature',
    'convert twelve miles kilometers arithmetic',
    'write haiku autumn moon poetry',
    'photosynthesis chlorophyll sunlight biology lesson',
    'pancake recipe flour eggs milk breakfast',
    'guitar standard tuning strings music',
    'jupiter moons astronomy telescope',
    'capital peru geography lima',
    'hamlet shakespeare plot summary denmark',
    'penguin joke antarctica funny',
    'periodic table atomic number oxygen chemistry',
    'french translation good morning phrase',
    'triangle hypotenuse pythagorean theorem geometry',
    'roman empire augustus ancient history',
    'ocean tides moon gravity explanation',
    'chess sicilian defense opening moves',
    'bread sourdough starter fermentation recipe',
    'mount everest elevation meters nepal',
    'baseball innings rules sports',
    'piano chord progression music theory',
  ];
  const wrappers = ['', 'quick question ', 'can you explain ', 'help me with ', 'i need to know '];
  let negativeQueries = 0;
  let falsePositiveQueries = 0;
  for (const seed of unrelatedSeeds) {
    for (const wrapper of wrappers) {
      const query = `${wrapper}${seed}`.trim();
      const result = await retrieveHybridMemoryAtoms(workspacePath, query, { embeddingProvider: null, maxAtoms: 6 });
      negativeQueries += 1;
      if (result.selected.length > 0) falsePositiveQueries += 1;
    }
  }
  assert.equal(falsePositiveQueries, 0, `unrelated real-corpus queries injected memory in ${falsePositiveQueries}/${negativeQueries} cases`);

  // Generic/high-level prompts are particularly dangerous because many durable
  // memories are important in isolation. They must not be injected merely for
  // being useful; relevance to this turn is required.
  const helpfulButIrrelevant = [
    'what should i do today',
    'give me some useful advice',
    'anything important i should know',
    'help me think through this',
    'what is the best approach',
    'tell me something relevant',
    'what should we focus on',
    'any safeguards i should remember',
    'what did we learn',
    'what projects matter',
  ];
  let broadInjected = 0;
  for (const query of helpfulButIrrelevant) {
    const result = await retrieveHybridMemoryAtoms(workspacePath, query, { embeddingProvider: null, maxAtoms: 6 });
    if (result.selected.length > 0) broadInjected += 1;
  }
  assert.ok(broadInjected <= 1, `generic helpful-but-irrelevant prompts injected durable memory too often: ${broadInjected}/${helpfulButIrrelevant.length}`);

  // Every selected id must still resolve to the exact parsed source atom. This
  // catches stale-cache/source-line corruption while the hundreds of calls run.
  for (const atom of atoms.slice(0, Math.min(25, atoms.length))) {
    const rare = distinctive(atom.id).slice(0, 3);
    if (rare.length < 3) continue;
    const result = await retrieveHybridMemoryAtoms(workspacePath, rare.join(' '), { embeddingProvider: null, maxAtoms: 6 });
    for (const match of result.selected) {
      assert.equal(byId.get(match.atom.id)?.rawText, match.atom.rawText, `selected atom ${match.atom.id} drifted from parsed source`);
      assert.ok(match.atom.sourceStartLine > 0 && match.atom.sourceEndLine >= match.atom.sourceStartLine);
    }
  }

  console.log(JSON.stringify({
    suite: 'memory-atoms-real-corpus-stress',
    atoms: atoms.length,
    evaluatedAtoms,
    positiveQueries,
    positiveHits,
    recall: Number(recall.toFixed(4)),
    topOne: Number(topOne.toFixed(4)),
    negativeQueries,
    falsePositiveQueries,
    helpfulButIrrelevantQueries: helpfulButIrrelevant.length,
    helpfulButIrrelevantInjected: broadInjected,
    modelCalls: 0,
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
