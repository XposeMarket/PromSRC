import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildMemoryAtomReferenceContext,
  invalidateMemoryAtomSnapshot,
  parseMemoryAtoms,
  retrieveMemoryAtoms,
} from './memory-atoms.js';
import { routeMemorySearchMode } from '../prompt-context.js';

type CorpusQuery = { query: string; expectedLine: number };

const workspacePath = path.resolve(process.env.PROMETHEUS_MEMORY_ATOM_TEST_WORKSPACE || 'workspace');
const memoryPath = path.join(workspacePath, 'MEMORY.md');
const raw = fs.readFileSync(memoryPath, 'utf8');
const atoms = parseMemoryAtoms(raw);

assert.equal(atoms.length, 61, 'the current MEMORY.md corpus should parse into 61 bullet atoms');
assert.equal(new Set(atoms.map((atom) => atom.id)).size, atoms.length, 'atom ids must be unique');
for (const atom of atoms) {
  assert.ok(atom.sourceStartLine <= atom.sourceEndLine, `invalid source range for ${atom.id}`);
  assert.ok(atom.rawText.startsWith('- '), `atom ${atom.id} must preserve its bullet source text`);
  assert.ok(raw.includes(atom.rawText), `atom ${atom.id} must be an exact source substring`);
  assert.equal(atom.sourcePath, 'workspace/MEMORY.md');
  assert.equal(atom.authority, 'durable_memory_file');
}

const corpusQueries: CorpusQuery[] = [
  { query: 'How should Prometheus edit its own source?', expectedLine: 7 },
  { query: 'What is Raul’s NY open trading guardrail?', expectedLine: 9 },
  { query: 'Where is the Xpose Market website repo?', expectedLine: 11 },
  { query: 'What is the 90 second Prometheus promo video direction?', expectedLine: 13 },
  { query: 'What was the auto shop business operating layer thesis?', expectedLine: 14 },
  { query: 'What was the Xpose cold outreach roadmap?', expectedLine: 15 },
  { query: 'What is the Everything AI launch campaign?', expectedLine: 17 },
  { query: 'How does Prometheus compare with Hermes OpenClaw?', expectedLine: 18 },
  { query: 'What was the HyperFrames promo smoke milestone?', expectedLine: 19 },
  { query: 'What was the media downloader clipping idea?', expectedLine: 20 },
  { query: 'What are Brain context capsules?', expectedLine: 21 },
  { query: 'What voice testing problems were observed?', expectedLine: 22 },
  { query: 'What agent dashboard visibility matters?', expectedLine: 23 },
  { query: 'What can the voice agent call directly?', expectedLine: 24 },
  { query: 'What is the mobile edit prerequisite?', expectedLine: 25 },
  { query: 'What is the release marketing visual direction?', expectedLine: 27 },
  { query: 'What are Mara scheduled X rules?', expectedLine: 29 },
  { query: 'What is the Robinhood MCP OAuth status?', expectedLine: 31 },
  { query: 'Why did Skill Gardener misclassify workflows?', expectedLine: 32 },
  { query: 'What was the Prometheus tool latency benchmark?', expectedLine: 34 },
  { query: 'What was the Pocket Zombies and Galaxy Drift lab?', expectedLine: 35 },
  { query: 'What was verified in the Brain Dream?', expectedLine: 36 },
  { query: 'What is the Brain continuity direction?', expectedLine: 37 },
  { query: 'What is the runtime isolation direction?', expectedLine: 39 },
  { query: 'What is the command approval policy?', expectedLine: 40 },
  { query: 'What is the browser blind scroll guard?', expectedLine: 41 },
  { query: 'What is the generated web UI build sync rule?', expectedLine: 43 },
  { query: 'What FPS should HyperFrames exports use?', expectedLine: 44 },
  { query: 'What is the spend approval product direction?', expectedLine: 45 },
  { query: 'What is the Prometheus business readiness gap?', expectedLine: 46 },
  { query: 'What is the public release runbook?', expectedLine: 47 },
  { query: 'How should Prometheus be positioned against terminal agents?', expectedLine: 48 },
  { query: 'What is Prometheus One visual identity?', expectedLine: 49 },
  { query: 'What is the creative editor storage quota blocker?', expectedLine: 51 },
  { query: 'What is the true 3D HyperFrames contract?', expectedLine: 58 },
  { query: 'What is the catalog first HyperFrames recovery rule?', expectedLine: 60 },
  { query: 'What is the context compaction silent write rule?', expectedLine: 62 },
  { query: 'What is the runtime model routing rule?', expectedLine: 63 },
  { query: 'What is the bundled skill reading rule?', expectedLine: 64 },
  { query: 'What is the skill as living memory rule?', expectedLine: 65 },
  { query: 'What is the browser session hygiene rule?', expectedLine: 70 },
  { query: 'What are workspace file edit memory tool rules?', expectedLine: 71 },
  { query: 'What is the investigation evidence source?', expectedLine: 72 },
  { query: 'How do Vita Windows builds recover?', expectedLine: 73 },
  { query: 'When is BUSINESS.md injected?', expectedLine: 75 },
  { query: 'What is the entity file rule?', expectedLine: 76 },
  { query: 'What must happen before claiming connector access?', expectedLine: 77 },
  { query: 'What is the events queue?', expectedLine: 78 },
  { query: 'What is the daytrading reminder window?', expectedLine: 79 },
  { query: 'How should desktop UI clicks work?', expectedLine: 80 },
  { query: 'Where are Prometheus self docs?', expectedLine: 81 },
  { query: 'How should blocking decisions be asked?', expectedLine: 82 },
  { query: 'What is the self edit route?', expectedLine: 83 },
  { query: 'What should tool improvement reporting do?', expectedLine: 84 },
  { query: 'What is the skill reading rule?', expectedLine: 85 },
  { query: 'What is the local lead hunting workflow?', expectedLine: 86 },
  { query: 'How should subagents be named?', expectedLine: 87 },
  { query: 'What is the gateway local UI QA rule?', expectedLine: 88 },
  { query: 'What are task delegation semantics?', expectedLine: 90 },
  { query: 'What is the NebulaX milestone lifecycle?', expectedLine: 91 },
  { query: 'What replaced the special Prometheus self-edit workflow?', expectedLine: 92 },
];

const failures: string[] = [];
for (const item of corpusQueries) {
  const result = retrieveMemoryAtoms(workspacePath, item.query);
  const expected = result.selected.find((match) => match.atom.sourceStartLine === item.expectedLine);
  if (!expected) {
    failures.push(`${item.expectedLine}: ${item.query} -> ${result.selected.map((match) => match.atom.sourceStartLine).join(',')}`);
    continue;
  }
  const context = buildMemoryAtomReferenceContext(workspacePath, item.query);
  assert.match(context, /\[MEMORY_REFERENCE\]/);
  assert.match(context, new RegExp(`source=workspace/MEMORY\\.md:${item.expectedLine}-`));
  assert.ok(context.includes(expected.atom.rawText), `reference should preserve source text for line ${item.expectedLine}`);
}
assert.deepEqual(failures, [], `corpus queries missed expected atoms:\n${failures.join('\n')}`);

const directTradingQuery = 'What is the NY open trading guardrail?';
const directTrading = retrieveMemoryAtoms(workspacePath, directTradingQuery);
assert.ok(
  directTrading.selected.some((match) => match.atom.sourceStartLine === 9),
  'baseline direct durable-memory query should recall the trading guardrail',
);
const noisyProjectContext = Array.from({ length: 300 }, (_, index) => `unrelated_project_context_term_${index}`).join(' ');
const tradingWithProjectContext = retrieveMemoryAtoms(workspacePath, directTradingQuery, {
  additionalContext: noisyProjectContext,
});
assert.ok(
  tradingWithProjectContext.selected.some((match) => match.atom.sourceStartLine === 9),
  'large unrelated project context must not dilute a direct user-query memory hit below threshold',
);

for (const query of [
  'hi Prometheus',
  'Thanks, that works',
]) {
  const routing = routeMemorySearchMode(query, { automatic: true });
  assert.equal(routing.mode, 'no_search', `low-signal automatic query should be skipped: ${query}`);
}
for (const query of ['What is the weather forecast?', 'Tell me a joke', 'What is my favorite color?']) {
  const result = retrieveMemoryAtoms(workspacePath, query);
  assert.equal(result.selected.length, 0, `unrelated query should not recall durable atoms: ${query}`);
}

const broad = retrieveMemoryAtoms(
  workspacePath,
  'Prometheus Xpose HyperFrames Brain voice browser business release skills runtime',
);
assert.ok(broad.selected.length > 8, 'main-path retrieval must be able to return more than the old eight-atom cap');
assert.equal(new Set(broad.selected.map((match) => match.atom.id)).size, broad.selected.length, 'selected atoms must be deduplicated');

const invalidationWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-memory-atoms-'));
try {
  const invalidationMemoryPath = path.join(invalidationWorkspace, 'MEMORY.md');
  fs.writeFileSync(invalidationMemoryPath, '# Memory\n\n## project_memory\n- First cached fact\n', 'utf8');
  assert.equal(retrieveMemoryAtoms(invalidationWorkspace, 'first cached fact').selected.length, 1);
  fs.writeFileSync(invalidationMemoryPath, '# Memory\n\n## project_memory\n- Second refreshed fact\n', 'utf8');
  invalidateMemoryAtomSnapshot(invalidationWorkspace);
  const refreshed = retrieveMemoryAtoms(invalidationWorkspace, 'second refreshed fact');
  assert.equal(refreshed.selected.length, 1, 'explicit MEMORY.md writes must become visible after invalidation');
  assert.equal(refreshed.selected[0].atom.rawText, '- Second refreshed fact');
} finally {
  fs.rmSync(invalidationWorkspace, { recursive: true, force: true });
}

const duplicateWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-memory-atoms-dedupe-'));
try {
  fs.writeFileSync(
    path.join(duplicateWorkspace, 'MEMORY.md'),
    '# Memory\n\n## First section\n- Keep the gateway worker warm.\n\n## Second section\n- Keep the gateway-worker warm!\n',
    'utf8',
  );
  const duplicateAtoms = parseMemoryAtoms(fs.readFileSync(path.join(duplicateWorkspace, 'MEMORY.md'), 'utf8'));
  assert.equal(duplicateAtoms.length, 1, 'normalized duplicate memory bullets should produce one atom');
  assert.equal(duplicateAtoms[0]?.sourceSection, 'First section', 'dedupe should preserve the first authoritative source range');
} finally {
  fs.rmSync(duplicateWorkspace, { recursive: true, force: true });
}

console.log(JSON.stringify({
  memoryPath,
  rawChars: raw.length,
  atomCount: atoms.length,
  corpusQueries: corpusQueries.length,
  broadSelected: broad.selected.length,
  broadRelated: broad.related.length,
  broadReferenceChars: buildMemoryAtomReferenceContext(workspacePath, 'Prometheus Xpose HyperFrames Brain voice browser business release skills runtime').length,
  cacheWarmDurationMs: retrieveMemoryAtoms(workspacePath, 'What is the NebulaX milestone lifecycle?').stats.durationMs,
}, null, 2));
