import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The shared chat loop and the background task runner must not regain a
// synthetic step / tool-round cap. (The Reactor half of the old
// test-agent-unbounded-reactor.mjs went away with the Reactor engine.)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

assert.doesNotMatch(read('src/gateway/tasks/task-runner.ts'), /\bmaxSteps\b|\bmax_steps\b/i,
  'task-runner must not retain a step-limit execution input');
assert.doesNotMatch(
  read('src/gateway/routes/chat.router.ts'),
  /MAX_TOOL_ROUNDS|getMaxToolRounds|Hit max steps|PROMETHEUS_FILE_OP_EXTENDED_MAX_ROUNDS/,
  'the shared chat execution loop must not retain a synthetic tool-round boundary',
);
for (const retired of ['src/agents/reactor.ts', 'src/agents/spawner.ts', 'src/agents/provider-reactor.ts']) {
  assert.equal(fs.existsSync(path.join(root, retired)), false, `${retired} is retired and must not come back`);
}
console.log('Unbounded agent loop regression passed.');
