import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  formatResumeEvidence,
  recordToolCall,
  recordToolResult,
  shouldDeleteExecutionSnapshot,
  type LedgerCall,
  type LedgerEvidence,
} from './background-tool-ledger';

// 1. id-less call + result pair leaves nothing outstanding
{
  const outstanding = recordToolCall([], { name: 'web_fetch', args: { url: 'x' } });
  assert.equal(outstanding.length, 1);
  const r = recordToolResult(outstanding, [], { name: 'web_fetch', result: 'ok' });
  assert.deepEqual(r.outstanding, []);
  assert.equal(r.evidence.length, 1);
  assert.equal(r.evidence[0].name, 'web_fetch');
}

// 2. mismatched id pairs by name
{
  const outstanding = recordToolCall([], { id: 'step:1:web_fetch', name: 'web_fetch' });
  const r = recordToolResult(outstanding, [], { id: 'other-id', name: 'web_fetch', result: 'x' });
  assert.deepEqual(r.outstanding, []);
  assert.equal(r.evidence.length, 1);
}

// 3. unmatched result never creates outstanding
{
  const r = recordToolResult([], [], { id: 'nope', name: 'bash', result: 'x' });
  assert.deepEqual(r.outstanding, []);
}

// 4. genuine outstanding call stays
{
  let outstanding: LedgerCall[] = recordToolCall([], { id: 'call-a', name: 'write' });
  outstanding = recordToolCall(outstanding, { id: 'call-b', name: 'write' });
  const r = recordToolResult(outstanding, [], { id: 'call-b', name: 'write', result: 1 });
  assert.deepEqual(r.outstanding.map((call) => call.id), ['call-a']);
}

// 5. 100 large results -> bounded evidence
{
  let evidence: LedgerEvidence[] = [];
  let outstanding: LedgerCall[] = [];
  for (let i = 0; i < 100; i++) {
    const r = recordToolResult(outstanding, evidence, { name: 'web_fetch', result: 'x'.repeat(5000) + i });
    outstanding = r.outstanding;
    evidence = r.evidence;
  }
  assert.equal(evidence.length, 40);
  for (const entry of evidence) assert.ok(entry.result.length <= 600 + '…[truncated]'.length);
}

// 6. formatResumeEvidence stays under 6000 chars
{
  const big: LedgerEvidence[] = Array.from({ length: 100 }, (_, i) => ({
    id: `s${i}`, name: 'web_fetch', result: 'y'.repeat(600) + '…[truncated]',
  }));
  const out = formatResumeEvidence(big);
  assert.ok(out.length <= 6000, `resume evidence ${out.length} chars`);
  assert.match(out, /earlier results omitted/);
  assert.equal(formatResumeEvidence([]), '(none)');
}

// 7. snapshot prune truth table
{
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  assert.equal(shouldDeleteExecutionSnapshot({ state: 'in_progress', spawnerSessionId: 's', mergedAt: now }, now), false);
  assert.equal(shouldDeleteExecutionSnapshot({ state: 'completed', spawnerSessionId: 's', completedAt: now, mergedAt: now }, now), true);
  assert.equal(shouldDeleteExecutionSnapshot({ state: 'completed', spawnerSessionId: 's', completedAt: now }, now), false);
  assert.equal(shouldDeleteExecutionSnapshot({ state: 'completed', spawnerSessionId: 's', completedAt: now - 8 * day }, now), true);
  assert.equal(shouldDeleteExecutionSnapshot({ state: 'failed', completedAt: now }, now), true);
}

// 8. behavioral store test: delete removes the snapshot file (isolated config dir)
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-ledger-'));
  try {
    const config = require('../../config/config').getConfig();
    config.getConfigDir = () => tmp;
    const store = require('./background-execution-store');
    const id = 'bg_ledger-test-1';
    const file = path.join(tmp, 'background-executions', `${id}.json`);
    store.saveBackgroundExecution({
      id, state: 'completed', prompt: 'p', startedAt: Date.now(), timeoutMs: 1000, joinPolicy: 'wait_all',
      toolCategories: [], outstandingTools: [], workDir: tmp, completedAt: Date.now(), mergedAt: Date.now(), spawnerSessionId: 's1',
    });
    assert.ok(fs.existsSync(file), 'snapshot saved');
    store.deleteBackgroundExecution(id);
    assert.ok(!fs.existsSync(file), 'snapshot deleted');
    store.deleteBackgroundExecution(id); // ENOENT is ignored
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('PASS background tool ledger: id-less/mismatched pairing, unmatched results, bounded evidence, resume cap, prune truth table, snapshot delete');
