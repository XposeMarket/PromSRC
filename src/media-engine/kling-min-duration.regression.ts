import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getModel } from './catalog.js';
import { coerceVideoProjectArgs, executeVideoProject, getVideoProjectToolDef } from './tool.js';
import { estimate, generateShots } from './engine.js';
import { planParts } from './inspect.js';
import { resolveRuntimeBinary } from '../runtime/dependencies.js';

async function main() {
  for (const id of ['fal/kling-v3-pro-motion-control', 'fal/kling-v3-standard-motion-control']) {
    assert.equal(getModel(id)?.limits?.minDurationSec, 3);
    assert.equal(getModel(id)?.limits?.maxDurationSec, 30);
  }
  const properties = getVideoProjectToolDef().function.parameters.properties;
  const encoded: Record<string, unknown> = {};
  const expected: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(properties) as Array<[string, { type: string }]>) {
    if (schema.type === 'array') { encoded[key] = '["item"]'; expected[key] = ['item']; }
    if (schema.type === 'boolean') { encoded[key] = 'true'; expected[key] = true; }
    if (schema.type === 'number' || schema.type === 'integer') { encoded[key] = '2'; expected[key] = 2; }
  }
  assert.deepEqual(coerceVideoProjectArgs(encoded), expected);
  assert.equal(encoded.approved, 'true', 'caller input stays unchanged');
  assert.deepEqual(coerceVideoProjectArgs({ shotIds: '["shot_x"]', looks: '["look"]', cuts: '[1.2,3.4]', approved: 'true', notify: 'false', phoneLook: 'false', maxParts: '3' }),
    { shotIds: ['shot_x'], looks: ['look'], cuts: [1.2, 3.4], approved: true, notify: false, phoneLook: false, maxParts: 3 });
  const invalid = { shotIds: '[invalid', approved: 'yes', count: '1.5', maxParts: 'Infinity', prompt: '[not an array]' };
  assert.deepEqual(coerceVideoProjectArgs(invalid), invalid);
  assert.deepEqual(coerceVideoProjectArgs({ approved: false, shotIds: ['shot_x'], maxParts: 2 }), { approved: false, shotIds: ['shot_x'], maxParts: 2 });
  for (const duration of [0.4, 0.8, 1.2, 2.9]) {
    const part = planParts(duration, [], 3, 1)[0];
    assert.ok((part.endSec - part.startSec) / part.speed >= 3, 'even very short parts reach the model minimum');
  }

  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'kling-min-duration-'));
  try {
    const clip = path.join(ws, 'short.mp4');
    const made = spawnSync(resolveRuntimeBinary('ffmpeg', { allowPathFallback: true }),
      ['-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=25', '-t', '1', '-c:v', 'libx264', clip], { windowsHide: true, encoding: 'utf8' });
    assert.equal(made.status, 0, made.stderr);
    const created = await executeVideoProject({ action: 'create', title: 'Minimum duration regression' }, { workspacePath: ws });
    const projectId = created.created;
    await executeVideoProject({ action: 'apply_ops', projectId, ops: [{ op: 'plan.setShots', shots: [{ id: 'shot_short', title: 'Short reference', sourceVideo: 'short.mp4', startImage: 'frame.png', durationSec: 10, modelId: 'fal/kling-v3-pro-motion-control' }] }] }, { workspacePath: ws });
    fs.writeFileSync(path.join(ws, 'frame.png'), 'fixture');
    const quote = await executeVideoProject({ action: 'estimate', projectId, shotIds: '["shot_short"]' }, { workspacePath: ws });
    assert.match(JSON.stringify(quote), /sourceVideo duration 1s is below the 3s minimum/);
    const result = await estimate(ws, projectId, { shotIds: ['shot_short'] });
    assert.ok(result.shots[0].problems.some((problem) => problem.includes('below the 3s minimum')));
    await assert.rejects(generateShots(ws, projectId, { shotIds: ['shot_short'], approved: true }), /Cannot generate:.*below the 3s minimum/);
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  console.log('Kling minimum duration, pre-submit guard, slowdown, and video_project coercion regression passed');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
