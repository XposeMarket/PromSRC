import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-tool-behavior-'));
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_APP_DATA_DIR = root;
  process.env.PROMETHEUS_RUNTIME_DIR = path.join(root, 'runtime');
  process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');
  const workspace = process.env.PROMETHEUS_WORKSPACE_DIR;
  fs.mkdirSync(workspace, { recursive: true });
  const deadline = setTimeout(() => { console.error('tool behavior fixture timed out'); process.exit(1); }, 30_000);
  try {
    const { executeTool } = require('./agents-runtime/subagent-executor') as typeof import('./agents-runtime/subagent-executor');
    // Fixture-only execution authorization. The final-action gate below must still reject an invalid approval.
    const deps = { executionPolicy: { mode: 'goal_autonomous', approvalMode: 'never' } } as any;
    const run = (name: string, args: any) => executeTool(name, args, workspace, deps, 'tool-behavior-fixture');
    const content = JSON.stringify({ text: 'Prom — café 🚀', value: 42 });
    const created = await run('create_file', { filename: 'roundtrip.json', content });
    assert.equal(created.error, false, created.result);
    const actual = fs.readFileSync(path.join(workspace, 'roundtrip.json'), 'utf8');
    assert.deepEqual(JSON.parse(actual), JSON.parse(content));
    const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
    assert.equal(hash(actual), hash(content), 'tool success must match bytes independently read from disk');
    assert.equal(created.extra?.codeEvidence?.files?.[0]?.exists_after, true);
    const read = await run('read_file', { filename: 'roundtrip.json' });
    assert.equal(read.error, false, read.result);
    assert.ok(read.result.includes('café'));
    const failed = await run('find_replace', { filename: 'roundtrip.json', find: 'missing text', replace: 'unwanted mutation' });
    assert.equal(failed.error, true);
    assert.equal(hash(fs.readFileSync(path.join(workspace, 'roundtrip.json'), 'utf8')), hash(actual));
    const recovered = await run('find_replace', { filename: 'roundtrip.json', find: '42', replace: '43' });
    assert.equal(recovered.error, false, recovered.result);
    assert.equal(JSON.parse(fs.readFileSync(path.join(workspace, 'roundtrip.json'), 'utf8')).value, 43);
    const code = 'const assert = require("node:assert/strict"); const sum = (a, b) => a + b; assert.equal(sum(-2, 5), 3); assert.equal(sum(0, 0), 0); console.log("coding fixture passed");';
    const coding = await run('create_file', { filename: 'check.cjs', content: code });
    assert.equal(coding.error, false, coding.result);
    const executed = spawnSync(process.execPath, ['check.cjs'], { cwd: workspace, encoding: 'utf8', timeout: 5_000 });
    assert.equal(executed.status, 0, executed.stderr);
    assert.match(executed.stdout, /coding fixture passed/);
    const denied = await run('browser_act', { action: 'click', selector: '#commit', final_action_approval_id: 'nonexistent-fixture-approval' });
    assert.equal(denied.error, true, 'invalid final-action approval must not reach browser execution');
    assert.match(denied.result, /approval/i);
    console.log('tool behavior: independent file evidence, Unicode, failure/recovery, executable coding, final-action boundary passed');
  } finally {
    clearTimeout(deadline);
  }
}
main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
