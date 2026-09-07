import assert from 'node:assert/strict';
import { mergeMobileBackgroundTraceEntries } from '../web-ui/src/mobile/mobile-background-trace-merge.js';

const live = [{ type: 'tool', id: 'evt-1', text: 'live newer' }];
const durable = [
  { type: 'tool', id: 'evt-1', text: 'durable older' },
  { type: 'result', id: 'evt-1', text: 'done' },
  { type: 'think', text: 'durable thought', ts: 7 },
];
const once = mergeMobileBackgroundTraceEntries(live, durable);
const twice = mergeMobileBackgroundTraceEntries(once, durable);
assert.equal(once.length, 3, 'tool + result + thought should remain distinct');
assert.equal(twice.length, once.length, 'repeated recovery must be idempotent');
assert.equal(twice[0].text, 'live newer', 'live entry should win over stale durable duplicate');
assert.deepEqual(twice, once, 'second recovery must not mutate trace ordering/content');
console.log('mobile background trace merge regression passed');
