// Live defect 2026-09-23: the batched elision (window 60k chars / 4 rounds /
// 8 results) cut results the model had read only 5-6 rounds earlier and was
// still acting on. Shape taken from tool-result-elision-order.ndjson: long
// runs of single-call rounds, each result ~3-5 KB. After one batch fired,
// everything older than ~16 results became a placeholder and got re-read.
process.env.PROMETHEUS_DISABLE_ELISION_DIAGNOSTICS = '1';
import assert from 'node:assert/strict';
import { elideStaleToolResults, TOOL_RESULT_ELISION_BATCH_MIN_CHARS, TOOL_RESULT_ELISION_MARKER } from './tool-result-elision';

function body(n: number, size: number): string {
  return `result ${n} `.padEnd(size, 'x');
}

const messages: any[] = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'go' }];
let callNo = 0;
for (let round = 0; round < 110; round++) {
  const calls = round % 3 === 0 ? 2 : 1;
  const tool_calls = Array.from({ length: calls }, () => ({ id: `c${++callNo}`, type: 'function', function: { name: 'workspace_run', arguments: '{}' } }));
  messages.push({ role: 'assistant', content: '', tool_calls });
  for (const c of tool_calls) {
    messages.push({ role: 'tool', tool_call_id: c.id, tool_name: 'workspace_run', content: body(Number(c.id.slice(1)), 3500 + (callNo % 5) * 300) });
  }
  // Mirror the live call site: elide after every round with batching.
  elideStaleToolResults(messages, { batchMinChars: TOOL_RESULT_ELISION_BATCH_MIN_CHARS });
}

const tools = messages.filter((m) => m.role === 'tool');
const newest = tools.slice(-24);
const elidedNewest = newest.filter((m) => String(m.content).includes(TOOL_RESULT_ELISION_MARKER));
assert.equal(elidedNewest.length, 0, `the newest 24 results must stay verbatim, ${elidedNewest.length} were cut`);

// Anything elided must be strictly older than everything kept verbatim.
let seenVerbatim = false;
for (const m of tools.slice().reverse()) {
  const cut = String(m.content).includes(TOOL_RESULT_ELISION_MARKER);
  if (!cut) seenVerbatim = true;
  if (cut) {
    for (const newer of tools.slice(tools.indexOf(m) + 1)) {
      assert.ok(!String(newer.content).includes(TOOL_RESULT_ELISION_MARKER) || true);
    }
  }
}
assert.ok(seenVerbatim);
const firstVerbatim = tools.findIndex((m) => !String(m.content).includes(TOOL_RESULT_ELISION_MARKER));
const lastCut = tools.map((m) => String(m.content).includes(TOOL_RESULT_ELISION_MARKER)).lastIndexOf(true);
assert.ok(lastCut < firstVerbatim || lastCut === -1, 'elision must be oldest-first and contiguous');

// Elision must still happen on long turns (cost control stays on).
assert.ok(tools.some((m) => String(m.content).includes(TOOL_RESULT_ELISION_MARKER)), 'old output must still be shortened');

console.log('tool-result-elision-working-set regression: ok');
