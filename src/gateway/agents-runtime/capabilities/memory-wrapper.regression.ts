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

    const writtenMemory = fs.readFileSync(path.join(workspacePath, 'MEMORY.md'), 'utf8');
    const writtenBullet = writtenMemory.split(/\r?\n/).find((line) => line.includes('wrapper wrote this'))?.replace(/^\s*-\s*/, '') || '';
    assert.ok(writtenBullet, 'write should create a durable bullet');
    const update = await execute({ action: 'update', file: 'memory', category: 'Tests', previous_content: writtenBullet, content: 'wrapper corrected this' });
    assert.equal(update.error, false, update.result);
    const afterUpdate = fs.readFileSync(path.join(workspacePath, 'MEMORY.md'), 'utf8');
    assert.ok(afterUpdate.includes('wrapper corrected this'));
    assert.ok(!afterUpdate.includes('wrapper wrote this'));

    const beforeMissing = afterUpdate;
    const missingUpdate = await execute({ action: 'update', file: 'memory', category: 'tests', previous_content: 'does not exist', content: 'must not be written' });
    assert.equal(missingUpdate.error, true);
    assert.equal(fs.readFileSync(path.join(workspacePath, 'MEMORY.md'), 'utf8'), beforeMissing, 'failed exact update must not mutate memory');

    fs.writeFileSync(path.join(workspacePath, 'SOUL.md'), '# Soul\n\n## Personality\n- existing persona\n', 'utf8');
    const soulWrite = await execute({ action: 'write', file: 'soul', category: 'personality', content: 'case-insensitive section match' });
    assert.equal(soulWrite.error, false, soulWrite.result);
    const soulText = fs.readFileSync(path.join(workspacePath, 'SOUL.md'), 'utf8');
    assert.ok(soulText.includes('## Personality'));
    assert.ok(soulText.includes('case-insensitive section match'));
    assert.ok(!soulText.includes('## personality'), 'writer must not create a duplicate normalized section beside an existing display heading');

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
