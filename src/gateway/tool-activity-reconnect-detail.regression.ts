import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Mobile IMG_0738/0739: live rows read "Memory completed · 1.6 s", but after a
// connection drop the recovered turn re-applied reduced checkpoint/process
// copies of the same tool results (no durationMs, no args). The result merge
// replaced the live activity wholesale, so every row became a bare
// "Memory completed". A replayed/reduced payload must never erase detail the
// row already has.

async function main() {
  const mod: any = await import(pathToFileURL(path.resolve(__dirname, '../../web-ui/src/tool-activity.js')).href);
  const { applyToolActivityEvent: apply, coalesceToolActivityEntries: coalesce } = mod;
  assert.equal(typeof apply, 'function');
  assert.equal(typeof coalesce, 'function');

  const args = { action: 'search', query: 'only players 16 and older can play, age verification' };
  const entries: any[] = [];
  apply(entries, 'call', { action: 'memory', args, toolCallId: 'c1', stepNum: 1, streamId: 'S', seq: 3 });
  apply(entries, 'result', { action: 'memory', args, toolCallId: 'c1', result: 'hits: 3', durationMs: 1600, stepNum: 1, streamId: 'S', seq: 4 });
  const liveResult = entries.find((e) => e?.activity?.kind === 'result');
  const liveText = liveResult.text;
  assert.match(liveText, /1\.6\s*s/, `live row should show the duration, got "${liveText}"`);

  // Reconnect: reduced recovery payload for the same call (checkpoint row).
  apply(entries, 'result', { action: 'memory', toolCallId: 'c1', result: '' });
  const after = entries.find((e) => e?.activity?.kind === 'result');
  assert.equal(entries.filter((e) => e?.activity?.kind === 'result').length, 1, 'replay must not add a second row');
  assert.equal(after.text, liveText, 'replayed result must keep the live label + duration');
  assert.equal(after.activity.durationMs, 1600);
  assert.deepEqual(after.activity.args, args, 'args preview survives replay');
  assert.equal(after.activity.result, 'hits: 3', 'live output survives an empty replayed result');

  // Rendering path: live activity rows followed by a legacy recovered process
  // row for the same call coalesce into exactly the live row.
  const recovered = [
    ...entries,
    { type: 'result', text: 'memory complete', extra: { source: 'runtime_checkpoint', event: 'tool_result', toolName: 'memory', toolCallId: 'c1' } },
  ];
  const rows = coalesce(recovered).filter((e: any) => e?.activity);
  assert.equal(rows.length, 1, 'one call renders as one row after recovery');
  assert.match(rows[0].text, /1\.6\s*s/, `coalesced row keeps duration, got "${rows[0].text}"`);

  // A genuinely newer payload still updates the row.
  apply(entries, 'result', { action: 'memory', toolCallId: 'c1', result: 'hits: 3', durationMs: 8700 });
  assert.match(entries.find((e) => e?.activity?.kind === 'result').text, /8\.7\s*s/);

  console.log('tool-activity-reconnect-detail regression: ok');
}

main().catch((err) => { console.error(err); process.exit(1); });
