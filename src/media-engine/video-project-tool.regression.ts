import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { executeVideoProject } from './tool.js';

async function main() {
  const workspacePath = mkdtempSync(path.join(tmpdir(), 'video-project-ops-'));
  const ctx = { workspacePath };
  try {
    const created = await executeVideoProject({ action: 'create', title: 'Ops parser regression' }, ctx);
    const projectId = created.created;
    const shotId = 'shot_regression';
    await executeVideoProject({ action: 'apply_ops', projectId,
      ops: [{ op: 'plan.setShots', shots: [{ id: shotId, title: 'First take' }] }] }, ctx);
    const projectPath = path.join(workspacePath, 'video-projects', projectId, 'project.json');
    const stored = JSON.parse(readFileSync(projectPath, 'utf8'));
    stored.project.shots[0].takes = [{ id: 'take_1', path: 'first.mp4', durationSec: 5 },
      { id: 'take_2', path: 'second.mp4', durationSec: 5 }];
    writeFileSync(projectPath, JSON.stringify(stored));
    const result = await executeVideoProject({ action: 'apply_ops', projectId,
      ops: JSON.stringify([{ op: 'take.select', shotId, takeId: 'take_2' }]) }, ctx);
    assert.equal(result.project.shots[0].selectedTake?.id, 'take_2');
    assert.match(result.applied[0], /Selected take take_2/);
    await assert.rejects(executeVideoProject({ action: 'apply_ops', projectId, ops: '[invalid' }, ctx),
      /ops must be a non-empty array/);
    console.log('video-project apply_ops JSON-string and take.select regression passed');
  } finally { rmSync(workspacePath, { recursive: true, force: true }); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
