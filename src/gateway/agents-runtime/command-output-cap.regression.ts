import assert from 'node:assert/strict';
import {
  DEFAULT_COMMAND_OUTPUT_CHARS,
  MAX_COMMAND_OUTPUT_CHARS,
  MIN_COMMAND_OUTPUT_CHARS,
  capCommandOutput,
  resolveCommandOutputLimit,
} from './command-output-cap';

const MARKER_RE = /\n\.\.\.\[output truncated: (\d+) chars total, (\d+) chars omitted; full output: workspace_run\(action:"log", runId:"([^"]+)", maxChars:(\d+)\)\]\n/;

function markerOf(out: string): RegExpExecArray {
  const m = MARKER_RE.exec(out);
  assert.ok(m, `expected a truncation marker in output of length ${out.length}`);
  return m;
}

// Short output and output exactly at the default limit: returned unchanged, no marker.
const short = 'line-1\nEND-MARKER';
assert.equal(capCommandOutput(short, { runId: 'run_x' }), short);
assert.equal(capCommandOutput(''), '');
assert.equal(capCommandOutput(undefined), '');
const exact = 'x'.repeat(DEFAULT_COMMAND_OUTPUT_CHARS);
assert.equal(capCommandOutput(exact), exact);

// Long output: keeps the start and the end, one marker with correct total and omitted counts.
const lines = Array.from({ length: 1500 }, (_, i) => `line-${i + 1}-abcdefghij`);
const long = `${lines.join('\n')}\nEND-MARKER`;
const out = capCommandOutput(long, { runId: 'run_abc123' });
assert.ok(out.startsWith('line-1-abcdefghij\n'), 'keeps the first characters');
assert.ok(out.endsWith('END-MARKER'), 'keeps the last characters');
const m = markerOf(out);
assert.equal(Number(m[1]), long.length, 'marker states total character count');
const omitted = Number(m[2]);
const kept = out.length - m[0].length;
assert.equal(kept + omitted, long.length, 'kept plus omitted equals total');
assert.equal(m[3], 'run_abc123', 'marker names the run id');
assert.equal(Number(m[4]), long.length, 'log maxChars hint covers the whole output');
assert.ok(out.length <= DEFAULT_COMMAND_OUTPUT_CHARS, `length ${out.length} exceeds default limit`);
assert.ok(out.length >= DEFAULT_COMMAND_OUTPUT_CHARS - 50, `length ${out.length} is not close to the limit`);

// Without a run id the marker says so instead of naming one.
const noId = capCommandOutput(long);
assert.ok(noId.includes('no run id'), 'marker says there is no run id');
assert.ok(!noId.includes('workspace_run(action:"log"'), 'marker does not name a log action without a run id');

// Caller limit 12000 on 30000 characters keeps about 12000.
const big = `H${'x'.repeat(29_990)}${'T'.repeat(9)}`;
assert.equal(big.length, 30_000);
const capped = capCommandOutput(big, { maxChars: 12000, runId: 'run_big' });
assert.ok(capped.length <= 12000 && capped.length >= 11_950, `caller limit length ${capped.length}`);
assert.ok(capped.startsWith('H'), 'caller limit keeps the start');
assert.ok(capped.endsWith('T'.repeat(9)), 'caller limit keeps the end');
// Call sites pass args.maxChars ?? args.max_chars; the helper itself takes one value.
assert.equal(capCommandOutput(big, { maxChars: resolveCommandOutputLimit('12000'), runId: 'run_big' }).length, capped.length, 'string limit resolves the same');

// Clamp: missing, zero, or invalid values use the default; below the floor and above the ceiling are clamped.
assert.equal(resolveCommandOutputLimit(undefined), DEFAULT_COMMAND_OUTPUT_CHARS);
assert.equal(resolveCommandOutputLimit(0), DEFAULT_COMMAND_OUTPUT_CHARS);
assert.equal(resolveCommandOutputLimit('not a number'), DEFAULT_COMMAND_OUTPUT_CHARS);
assert.equal(resolveCommandOutputLimit('12000'), 12000);
assert.equal(resolveCommandOutputLimit(200), MIN_COMMAND_OUTPUT_CHARS);
assert.equal(resolveCommandOutputLimit(500_000), MAX_COMMAND_OUTPUT_CHARS);
const floorCut = capCommandOutput('a'.repeat(30_000), { maxChars: 200 });
assert.ok(floorCut.length <= MIN_COMMAND_OUTPUT_CHARS && floorCut.length >= MIN_COMMAND_OUTPUT_CHARS - 50, `floor length ${floorCut.length}`);
const ceilingCut = capCommandOutput('b'.repeat(150_000), { maxChars: 500_000, runId: 'run_c' });
assert.ok(ceilingCut.length <= MAX_COMMAND_OUTPUT_CHARS && ceilingCut.length >= MAX_COMMAND_OUTPUT_CHARS - 50, `ceiling length ${ceilingCut.length}`);

console.log('command-output-cap regression: all assertions passed');
