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

const fixture = `# MEMORY.md

## project_memory
- Atlas desktop client source edits must preserve uncommitted work and run validation before release.
- Atlas release credentials stay only in the encrypted vault and must never be committed to source control.
- Mercury mobile companion syncs conversations through the gateway relay.
- Mercury launch remains blocked on legal approval; resume the pricing page after approval arrives.
- ORANGE_SENTINEL is an unrelated durable fact about a ceramic collection.

## key_decisions
- We chose SQLite WAL mode for the local job database because concurrent readers must remain responsive.

## operational_rules
- Before destructive file removal, create a backup and require approval.
- Browser automation must anchor the page before repeated scrolling.
  This continuation line is part of the same browser rule.
- Application deployments must run smoke tests before publishing.

## continuity
- Customer support prefers short explanations and no giant tables.
`;

function matchContaining(result: ReturnType<typeof retrieveMemoryAtoms>, needle: string) {
  return result.selected.find((match) => match.atom.rawText.includes(needle));
}

const parsed = parseMemoryAtoms(fixture);
assert.equal(parsed.length, 10, 'every bullet under a durable section should become one atom');
assert.equal(new Set(parsed.map((atom) => atom.id)).size, parsed.length, 'atom ids must be unique');
const browserAtom = parsed.find((atom) => atom.rawText.includes('Browser automation'));
assert.ok(browserAtom, 'browser rule should parse');
assert.match(browserAtom.rawText, /continuation line/, 'continuation lines must stay attached to their bullet atom');
assert.equal(browserAtom?.kind, 'workflow_rule');
assert.equal(parsed.find((atom) => atom.rawText.includes('SQLite WAL'))?.kind, 'decision');
assert.equal(parsed.find((atom) => atom.rawText.includes('Customer support'))?.kind, 'continuity');

const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-memory-semantic-'));
try {
  const memoryPath = path.join(workspacePath, 'MEMORY.md');
  fs.writeFileSync(memoryPath, fixture, 'utf8');

  const paraphraseCases = [
    {
      query: 'When changing the Atlas codebase, what safeguards do I follow?',
      expected: 'Atlas desktop client source edits',
    },
    {
      query: 'What should happen before I purge something from disk?',
      expected: 'destructive file removal',
    },
    {
      query: 'What work is stuck until the lawyers sign off?',
      expected: 'Mercury launch remains blocked',
    },
    {
      query: 'What persistence choice prevents simultaneous reads from stalling?',
      expected: 'SQLite WAL mode',
    },
    {
      query: 'How does the phone conversation sync work?',
      expected: 'Mercury mobile companion syncs conversations',
    },
  ];

  for (const item of paraphraseCases) {
    const result = retrieveMemoryAtoms(workspacePath, item.query);
    assert.ok(
      matchContaining(result, item.expected),
      `paraphrase should recall ${item.expected}: ${item.query}\nselected=${result.selected.map((match) => match.atom.rawText).join(' || ')}`,
    );
  }

  const sectionOnly = retrieveMemoryAtoms(workspacePath, 'project');
  assert.equal(sectionOnly.selected.length, 0, 'a generic section-name noun must not recall every atom in that section');

  for (const query of ['release', 'launch']) {
    assert.equal(retrieveMemoryAtoms(workspacePath, query).selected.length, 0, `ambiguous one-word topic must not flood prompt context: ${query}`);
  }

  const launchPlan = retrieveMemoryAtoms(workspacePath, 'What is the launch plan?');
  assert.ok(matchContaining(launchPlan, 'Mercury launch remains blocked'), 'a specific multiword launch query should recall the literal launch atom');
  assert.equal(
    Boolean(matchContaining(launchPlan, 'Atlas release credentials')),
    false,
    'concept expansion must not turn a weak release synonym into an unrelated direct memory',
  );

  const uniqueSpecific = retrieveMemoryAtoms(workspacePath, 'SQLite');
  assert.ok(matchContaining(uniqueSpecific, 'SQLite WAL mode'), 'a unique specific one-word query should still recall its atom');

  for (const query of ['What is the weather forecast?', 'Tell me a joke about penguins', 'How many cups are in a gallon?']) {
    assert.equal(retrieveMemoryAtoms(workspacePath, query).selected.length, 0, `unrelated query must not inject durable memory: ${query}`);
  }

  const related = retrieveMemoryAtoms(workspacePath, 'How does the phone conversation sync work?');
  const relatedLaunch = related.related.find((match) => match.atom.rawText.includes('Mercury launch remains blocked'));
  assert.ok(relatedLaunch, 'a directly recalled atom should expand to a genuinely related sibling even when that sibling has no query-term overlap');
  assert.match(String(relatedLaunch?.relationReason || ''), /shared_(?:anchor_)?term|shared_entity/);

  const atlasResult = retrieveMemoryAtoms(workspacePath, 'When changing the Atlas codebase, what safeguards do I follow?');
  assert.ok(atlasResult.selected.length > 0 && atlasResult.selected.length < parsed.length, 'normal recall must select a strict subset of the durable corpus');
  const atlasContext = buildMemoryAtomReferenceContext(workspacePath, 'When changing the Atlas codebase, what safeguards do I follow?');
  assert.match(atlasContext, /\[MEMORY_REFERENCE\]/);
  assert.match(atlasContext, /Atlas desktop client source edits/);
  assert.doesNotMatch(atlasContext, /ORANGE_SENTINEL/, 'irrelevant atoms must stay out of the prompt reference');

  const bounded = retrieveMemoryAtoms(workspacePath, 'Atlas source release credentials', { maxAtoms: 1 });
  assert.equal(bounded.selected.length, 1, 'explicit small-surface callers must be able to enforce an atom cap');

  const first = retrieveMemoryAtoms(workspacePath, 'SQLite').selected[0];
  assert.ok(first, 'cache baseline should find SQLite');
  assert.equal(retrieveMemoryAtoms(workspacePath, 'SQLite').stats.cacheHit, true, 'second read should use the in-process snapshot');

  fs.writeFileSync(memoryPath, fixture.replace('SQLite WAL mode', 'Postgres serializable mode'), 'utf8');
  invalidateMemoryAtomSnapshot(workspacePath);
  assert.ok(
    matchContaining(retrieveMemoryAtoms(workspacePath, 'Postgres serializable'), 'Postgres serializable mode'),
    'explicit invalidation must expose updated MEMORY.md content on the next retrieval',
  );
  assert.equal(
    Boolean(matchContaining(retrieveMemoryAtoms(workspacePath, 'SQLite'), 'SQLite WAL mode')),
    false,
    'updated source text must replace stale cached atoms',
  );
} finally {
  invalidateMemoryAtomSnapshot(workspacePath);
  fs.rmSync(workspacePath, { recursive: true, force: true });
}

// The checked-in workspace is useful as an optional smoke corpus today, but the
// regression contract must not depend on personal workspace data remaining in
// Git. Storage-layout v2 intentionally moves that data out of the source tree.
const realMemoryPath = path.resolve('workspace', 'MEMORY.md');
if (fs.existsSync(realMemoryPath)) {
  const realRaw = fs.readFileSync(realMemoryPath, 'utf8');
  const realAtoms = parseMemoryAtoms(realRaw);
  assert.ok(realAtoms.length > 0, 'current real MEMORY.md should still parse into atoms when present');
  assert.equal(new Set(realAtoms.map((atom) => atom.id)).size, realAtoms.length, 'real MEMORY.md atom ids must remain unique');
}

console.log(JSON.stringify({
  fixtureAtoms: parsed.length,
  realCorpusPresent: fs.existsSync(realMemoryPath),
}, null, 2));
