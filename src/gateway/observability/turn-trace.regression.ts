/**
 * End-to-end tracing through the real turn loop: one trace per turn, with
 * spans for the model calls, each tool, dispatch refusals and approvals, all
 * sharing the trace id returned on the result. Also checks child traces link
 * to their parent and that concurrent turns do not mix spans.
 *
 * Run: npm run test:turn-trace
 */
import assert from 'node:assert/strict';
import { bootReplayHarness } from '../../testing/replay/harness';

async function main(): Promise<void> {
  const h = await bootReplayHarness();
  const trace = require('./turn-trace') as typeof import('./turn-trace');
  const rows: string[] = [];
  try {
    // 1. A turn with a tool, an unknown tool (refused) and an approval-gated call.
    const run = await h.runTurn({
      message: 'Fetch, try a bad tool, then answer',
      approvals: 'approve',
      tools: { web_fetch: () => ({ result: 'page text (stub)' }) },
      script: [
        { toolCalls: [{ name: 'web_fetch', args: { url: 'https://example.com' } }] },
        { toolCalls: [{ name: 'definitely_not_a_tool', args: {} }] },
        { text: 'Done.' },
      ],
    });
    assert.equal(run.error, null, String(run.error?.message || ''));
    const traceId = run.result?.traceId;
    assert.ok(typeof traceId === 'string' && traceId.length >= 16, 'handleChat result carries a traceId');
    const t = trace.getTrace(traceId);
    const kinds = t.spans.map((s) => `${s.kind}:${s.name}:${s.status}`);
    assert.ok(t.spans.every((s) => s.traceId === traceId), 'all spans share the trace id');
    assert.ok(kinds.some((k) => k.startsWith('turn:')), `turn span recorded (${kinds.join(', ')})`);
    assert.ok(t.spans.filter((s) => s.kind === 'model_call').length >= 3, `one model_call span per round (${kinds.join(', ')})`);
    assert.ok(kinds.includes('tool:web_fetch:ok'), `tool span for web_fetch (${kinds.join(', ')})`);
    assert.ok(kinds.includes('tool_dispatch:definitely_not_a_tool:refused'), `refused dispatch span (${kinds.join(', ')})`);
    assert.ok(t.spans.every((s) => s.sessionId === run.sessionId), 'spans carry the session id');
    rows.push(`  ok  one trace per turn: ${t.spans.length} spans (${[...new Set(t.spans.map((s) => s.kind))].join(', ')})`);

    // 2. Separate turns keep separate traces. (The harness installs one
    // provider override at a time, so the two turns run back to back; the
    // AsyncLocalStorage isolation itself is covered by section 3.)
    const a = await h.runTurn({ message: 'A', tools: { web_fetch: () => ({ result: 'a' }) }, script: [{ toolCalls: [{ name: 'web_fetch', args: { url: 'https://a.test' } }] }, { text: 'A done.' }] });
    const b = await h.runTurn({ message: 'B', script: [{ text: 'B done.' }] });
    const ta = trace.getTrace(a.result?.traceId);
    const tb = trace.getTrace(b.result?.traceId);
    assert.notEqual(a.result?.traceId, b.result?.traceId, 'distinct traces per turn');
    assert.ok(ta.spans.some((s) => s.kind === 'tool' && s.name === 'web_fetch'), 'turn A has its tool span');
    assert.ok(!tb.spans.some((s) => s.kind === 'tool'), 'turn B has no tool spans from turn A');
    rows.push('  ok  separate turns never share spans');

    // 3. Child traces link to the parent (a nested turn on another session).
    let childTraceId = '';
    await trace.runInTrace({ sessionId: 'parent_session' }, async () => {
      const parentId = trace.currentTrace()!.traceId;
      await trace.runInTrace({ sessionId: 'child_session' }, async () => {
        childTraceId = trace.currentTrace()!.traceId;
        trace.recordSpan({ kind: 'turn', name: 'child', startedAt: Date.now(), status: 'ok' });
      });
      trace.recordSpan({ kind: 'turn', name: 'parent', startedAt: Date.now(), status: 'ok' });
      const parent = trace.getTrace(parentId);
      assert.ok(parent.childTraceIds.includes(childTraceId), 'parent lists the child trace');
      const child = trace.getTrace(childTraceId);
      assert.equal(child.spans[0].parentTraceId, parentId, 'child span points at the parent trace');
    });
    rows.push('  ok  child traces link to their parent');

    // 3b. Interleaved concurrent traces stay isolated (AsyncLocalStorage).
    const ids = await Promise.all(['x', 'y', 'z'].map((s) => trace.runInTrace({ sessionId: `concurrent_${s}` }, async () => {
      const id = trace.currentTrace()!.traceId;
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, Math.random() * 10));
        trace.recordSpan({ kind: 'tool', name: `${s}_${i}`, startedAt: Date.now(), status: 'ok' });
      }
      return { s, id };
    })));
    for (const { s, id } of ids) {
      const spans = trace.getTrace(id).spans;
      assert.equal(spans.length, 5, `concurrent trace ${s} has exactly its 5 spans`);
      assert.ok(spans.every((sp) => sp.name.startsWith(`${s}_`)), `concurrent trace ${s} did not pick up another trace's spans`);
    }
    rows.push('  ok  interleaved concurrent traces stay isolated');

    // 4. No trace context = no spans (tracing never runs outside a turn).
    assert.equal(trace.recordSpan({ kind: 'tool', name: 'orphan', startedAt: Date.now(), status: 'ok' }), null);
    rows.push('  ok  spans outside a turn are ignored');
  } finally {
    h.shutdown();
  }
  process.stdout.write(`turn tracing\n${rows.join('\n')}\n`);
  process.exit(0);
}

main().catch((error) => {
  process.stdout.write(`FAIL ${error?.stack || error}\n`);
  process.exit(1);
});
