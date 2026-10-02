import assert from 'node:assert/strict';

import {
  isRestartCheckpointMessage,
  planRestartCheckpointTreatment,
  stripBackgroundReceipts,
} from './restart-checkpoint-compaction';
import { capDescription, compactToolDefinitionForModel } from '../tools/schema-compaction';

const ckpt = (n: number) => ({
  role: 'assistant',
  content: `[Hot restart checkpoint: planned by this chat]\nGateway Restart Initiated\n\nBackground agents spawned by this session (durable receipts; do not claim they were not launched):\n- bg_${n}aaa: completed; task: x; outcome: y\n- bg_${n}bbb: completed; task: x; outcome: y\nDetailed recovery context was saved internally.`,
});

// Finished turn: every checkpoint is a stub. In-flight turn: only the newest stays full.
const history = [
  { role: 'user', content: 'do the thing' },
  ckpt(1), ckpt(2),
  { role: 'assistant', content: 'Done.' },
  { role: 'user', content: 'next thing' },
  ckpt(3), ckpt(4),
];
const plan = planRestartCheckpointTreatment(history);
assert.equal(plan.get(1), 'stub');
assert.equal(plan.get(2), 'stub');
assert.equal(plan.get(5), 'stub');
assert.equal(plan.get(6), 'full');
assert.equal(plan.has(3), false, 'regular assistant answers are untouched');
assert.equal(isRestartCheckpointMessage({ role: 'user', content: '[Hot restart checkpoint: planned by this chat]' }), false);
assert.equal(isRestartCheckpointMessage({ role: 'assistant', content: 'x', messageKind: 'restart_checkpoint' }), true);

const stripped = stripBackgroundReceipts(ckpt(9).content);
assert.doesNotMatch(stripped, /bg_9/);
assert.match(stripped, /Gateway Restart Initiated/);
assert.match(stripped, /Detailed recovery context/);

// Schema compaction: optional alias props dropped, required kept, long text capped, input not mutated.
const def = {
  type: 'function',
  function: {
    name: 't',
    description: 'top level stays as-is',
    parameters: {
      type: 'object',
      required: ['action', 'file'],
      properties: {
        action: { type: 'string', enum: ['a', 'b'], description: 'Read action to perform.' },
        path: { type: 'string', description: 'Path.' },
        filename: { type: 'string', description: 'Alias for path when targeting one file.' },
        file: { type: 'string', description: 'Alias for path (required here, so kept).' },
        timeoutMs: { type: 'number', description: 'Legacy camelCase timeout alias.' },
        long: { type: 'string', description: `${'First sentence is reasonably long and explains things. '.repeat(3)}Second part.` },
        nested: { type: 'object', properties: { inner: { type: 'string', description: 'Alias for outer.' } } },
      },
    },
  },
};
const compact = compactToolDefinitionForModel(def);
const props = compact.function.parameters.properties;
assert.equal(props.filename, undefined);
assert.equal(props.timeoutMs, undefined);
assert.ok(props.file, 'required alias props are kept');
assert.equal(props.action.description, undefined, 'trivial enum restatement removed');
assert.ok(props.long.description.length <= 160);
assert.equal(props.nested.properties.inner, undefined);
assert.ok(def.function.parameters.properties.filename, 'source definition is not mutated');
assert.equal(compactToolDefinitionForModel(def), compact, 'memoized per definition');
assert.equal(capDescription('short'), 'short');
const contract = `Full replacement content for this file and some more filler words here to pass the cap. Must include the rule: reply exactly HEARTBEAT_OK and nothing else.`;
assert.equal(capDescription(contract), contract, 'contract descriptions are never truncated');

console.log('restart checkpoint + schema compaction regression passed');
