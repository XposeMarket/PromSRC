import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { memoryCapabilityExecutor } from './memory-executor';

async function main(): Promise<void> {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-memory-wrapper-'));
  try {
    fs.writeFileSync(path.join(workspacePath, 'MEMORY.md'), '# MEMORY.md\n\n---\n\n## tests\n- existing\n', 'utf8');
    const execute = (args: any) => memoryCapabilityExecutor.execute({
      name: 'memory',
      args,
      workspacePath,
      sessionId: 'regression-memory-wrapper',
      deps: {} as any,
    });

    const invalid = await execute({ action: 'invalid' });
    assert.equal(invalid.error, true);

    const write = await execute({ action: 'write', file: 'memory', category: 'tests', content: 'wrapper wrote this' });
    assert.equal(write.error, false, write.result);

    const read = await execute({ action: 'read', file: 'memory' });
    assert.equal(read.error, false, read.result);
    assert.ok(read.result.includes('wrapper wrote this'));

    const emptySearch = await execute({ action: 'search', query: '' });
    assert.equal(emptySearch.error, true);
  } finally {
    fs.rmSync(workspacePath, { recursive: true, force: true });
  }

  console.log('memory wrapper regression checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
