import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// After a gateway restart or a steer, the resumed turn runs on a NEW stream
// whose stepNum counter restarts at 1. The mobile trace paired tool rows by
// stepNum alone, so the resumed step 1 overwrote the pre-restart step 1 and
// no new tool row appeared until the thread was reopened.

async function main() {
  const mod: any = await import(pathToFileURL(path.resolve(__dirname, '../../web-ui/src/tool-activity.js')).href);
  const apply = mod.applyToolActivityEvent;
  assert.equal(typeof apply, 'function');

  const entries: any[] = [];
  // Pre-restart stream A: steps 1 and 2 complete.
  apply(entries, 'call', { action: 'workspace_read', args: { path: 'a.ts' }, stepNum: 1, streamId: 'A', seq: 3 });
  apply(entries, 'result', { action: 'workspace_read', result: 'ok', stepNum: 1, streamId: 'A', seq: 4 });
  apply(entries, 'call', { action: 'workspace_run', args: { command: 'x' }, stepNum: 2, streamId: 'A', seq: 5 });
  apply(entries, 'result', { action: 'workspace_run', result: 'ok', stepNum: 2, streamId: 'A', seq: 6 });
  const opsBefore = entries.filter((e) => e?.activity?.kind === 'operation').length;
  assert.equal(opsBefore, 2);

  // Resumed stream B restarts at stepNum 1.
  apply(entries, 'call', { action: 'workspace_edit', args: { path: 'b.ts' }, stepNum: 1, streamId: 'B', seq: 2 });
  apply(entries, 'result', { action: 'workspace_edit', result: 'ok', stepNum: 1, streamId: 'B', seq: 3 });

  const ops = entries.filter((e) => e?.activity?.kind === 'operation');
  assert.equal(ops.length, 3, 'resumed stream step 1 must add a new tool row, not overwrite the pre-restart step 1');
  assert.equal(ops[0].activity.action, 'workspace_read', 'pre-restart step 1 must keep its own action');
  assert.equal(ops[2].activity.action, 'workspace_edit');
  const results = entries.filter((e) => e?.activity?.kind === 'result');
  assert.equal(results.length, 3, 'resumed result must not replace the pre-restart result');

  // Same-stream pairing by stepNum still works.
  const same: any[] = [];
  apply(same, 'call', { action: 'workspace_read', stepNum: 1, streamId: 'C', seq: 1 });
  apply(same, 'result', { action: 'workspace_read', result: 'ok', stepNum: 1, streamId: 'C', seq: 2 });
  assert.equal(same.filter((e) => e?.activity?.kind === 'operation').length, 1);
  console.log('tool-activity-stream-scope regression: ok');
}

main().catch((err) => { console.error(err); process.exit(1); });
