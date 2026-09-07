import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Reactor } from '../dist/agents/reactor.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
for (const relativePath of [
  'src/agents/reactor.ts',
  'src/agents/spawner.ts',
  'src/gateway/tasks/task-runner.ts',
]) {
  assert.doesNotMatch(read(relativePath), /\bmaxSteps\b|\bmax_steps\b/i, `${relativePath} must not retain a step-limit execution input`);
}
assert.doesNotMatch(
  read('src/gateway/routes/chat.router.ts'),
  /MAX_TOOL_ROUNDS|getMaxToolRounds|Hit max steps|PROMETHEUS_FILE_OP_EXTENDED_MAX_ROUNDS/,
  'the shared chat execution loop must not retain a synthetic tool-round boundary',
);

let calls = 0;
const client = {
  isCloudProvider: true,
  async chatWithThinking() {
    calls += 1;
    if (calls <= 6) {
      return {
        message: {
          content: '',
          tool_calls: [{
            id: `missing-${calls}`,
            function: { name: `regression_missing_tool_${calls}`, arguments: '{}' },
          }],
        },
        thinking: '',
      };
    }
    return { message: { content: 'completed after the former cap', tool_calls: [] }, thinking: '' };
  },
};

const result = await new Reactor(client).run('Exercise more than four autonomous tool rounds.', {
  role: 'executor',
  promptMode: 'minimal',
  label: 'unbounded-regression',
});

assert.equal(calls, 7, 'the reactor must continue past the former four-round native cap');
assert.equal(result, 'completed after the former cap');
console.log('Unbounded agent reactor regression passed.');
