import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { retrieveMemoryAtoms } from '../src/gateway/memory-index/memory-atoms.js';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-memory-project-context-'));
try {
  fs.writeFileSync(path.join(workspace, 'MEMORY.md'), [
    '# Memory',
    '',
    '## trading',
    '- NY open guardrail: never enter before 9:35 ET after opening volatility settles. [2026-08-01]',
    '',
  ].join('\n'), 'utf8');
  const query = 'What is the NY open guardrail?';
  const baseline = retrieveMemoryAtoms(workspace, query);
  assert.equal(baseline.selected.length, 1, 'baseline direct memory query must recall the durable atom');

  const unrelatedProjectPacket = Array.from({ length: 300 }, (_, i) => `unrelated_project_context_term_${100 + i}`).join(' ');
  const withProject = retrieveMemoryAtoms(workspace, query, { additionalContext: unrelatedProjectPacket });
  assert.equal(withProject.selected.length, 1, 'unrelated project context must not dilute the direct query below recall threshold');
  assert.equal(withProject.selected[0].atom.rawText, baseline.selected[0].atom.rawText);
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}
console.log('atomic memory project-context regression: ok');
