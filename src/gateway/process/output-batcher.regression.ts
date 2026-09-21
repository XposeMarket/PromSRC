import assert from 'node:assert/strict';
import { ProcessOutputBatcher } from './output-batcher';

const events: Array<{ stream: string; chunk: string; sequence: number }> = [];
const batcher = new ProcessOutputBatcher((stream, chunk, sequence) => {
  events.push({ stream, chunk, sequence });
}, 60_000, 32);

batcher.push('stdout', 'first\n', 1);
batcher.push('stderr', 'warning\n', 2);
assert.equal(events.length, 0, 'chunks should not broadcast individually');
batcher.flush();
assert.deepEqual(events, [{ stream: 'combined', chunk: 'first\nwarning\n', sequence: 2 }]);

batcher.push('stdout', 'a'.repeat(40), 3);
batcher.push('stdout', 'last', 4);
batcher.flush();
assert.equal(events.length, 2, 'a burst should produce one bounded update');
assert.match(events[1].chunk, /Live terminal output omitted 12 characters/);
assert.ok(events[1].chunk.endsWith('last'));
assert.equal(events[1].sequence, 4);
batcher.flush();
assert.equal(events.length, 2, 'flushing again must not duplicate output');

console.log('[output-batcher] ordered batches, bounded live output, and exit flush passed');
