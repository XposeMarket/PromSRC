import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getModel, durationsFor, snapDuration, estimateCostUsd } from './catalog.js';
import { buildStoryboardRequest, estimate, generateStoryboards } from './engine.js';
import { applyOps, createProject, loadProject, mutateProject, undoRedo } from './project.js';

function shot(over: Record<string, any> = {}) {
  return { id: 'shot_a', title: 'A', prompt: 'p', durationSec: 5, characterIds: [], status: 'draft', takes: [], ...over };
}

function take(id: string) {
  return { id, kind: 'video', path: `media/${id}.mp4`, modelId: 'fal/veo3-fast-i2v', costUsd: 1, createdAt: Date.now() } as any;
}

async function testPureModel() {
  // Variable specifier: the web-ui module is plain JS with no declaration file, and tsc must not follow it.
  const modelPath: string = '../../web-ui/src/components/video-project-card/studio-model.js';
  const { shotStep, currentShotIndex, nextAction, durationOptions, resolveMode } = await import(modelPath);
  // shotStep
  assert.equal(shotStep(shot(), 0, []), 'frame', 'fresh shot starts at Frame');
  assert.equal(shotStep(shot({ storyboard: 'sb.png' }), 0, []), 'setup', 'shot with storyboard skips Frame');
  assert.equal(shotStep(shot({ takes: [take('t1')], selectedTakeId: 't1' }), 0, []), 'take', 'shot with take is on Take');
  assert.equal(shotStep(shot({ approvedAt: 1, takes: [take('t1')], selectedTakeId: 't1' }), 0, []), 'done', 'approved shot is done');
  assert.equal(shotStep(shot({ chainFromPrevious: true }), 1, []), 'setup', 'chainFromPrevious on index>0 skips Frame');
  assert.equal(shotStep(shot({ chainFromPrevious: true }), 0, []), 'frame', 'chainFromPrevious on index 0 does not skip Frame');
  assert.equal(shotStep(shot({ status: 'generating' }), 0, []), 'take', 'running job counts as Take');

  // nextAction labels
  assert.deepEqual(nextAction({ shots: [] }), { label: 'Add shots to get started', shotIndex: -1 }, 'no shots');
  assert.deepEqual(nextAction({ shots: [shot()] }), { label: 'Pick a start frame for shot 1', shotIndex: 0 }, 'fresh shot');
  assert.deepEqual(nextAction({ shots: [shot({ storyboard: 'sb.png' })] }), { label: 'Set up shot 1', shotIndex: 0 }, 'shot with storyboard');
  assert.deepEqual(nextAction({ shots: [shot({ takes: [take('t1')], selectedTakeId: 't1' })] }), { label: 'Review shot 1', shotIndex: 0 }, 'shot with take');
  const approved = shot({ approvedAt: 1, takes: [take('t1')], selectedTakeId: 't1' });
  assert.deepEqual(nextAction({ shots: [approved] }), { label: 'Render the final cut', shotIndex: -1 }, 'all approved, no export');
  assert.deepEqual(nextAction({ shots: [approved], exports: [{ path: 'x.mp4' }] }), { label: 'Watch the final cut', shotIndex: -1 }, 'all approved with export');
  assert.equal(currentShotIndex({ shots: [approved, shot()] }), 1, 'current index skips approved shots');
  assert.equal(currentShotIndex({ shots: [approved] }), -1, 'all done -> -1');

  // durationOptions mirrors backend durationsFor
  assert.deepEqual(durationOptions({ limits: { durations: [8] } }), [8]);
  assert.deepEqual(durationOptions({ limits: { minDurationSec: 1, maxDurationSec: 15 } }).length, 15, 'capped at 15');
  assert.deepEqual(durationOptions({ limits: { minDurationSec: 3, maxDurationSec: 5 } }), [3, 4, 5]);

  // resolveMode
  assert.equal(resolveMode({}), 'step', 'no run -> step');
  assert.equal(resolveMode({ lastRun: {} }), 'auto', 'run present -> auto');
  assert.equal(resolveMode({ mode: 'step', lastRun: {} }), 'step', 'explicit mode wins');
  assert.equal(resolveMode({ mode: 'bogus' }), 'step', 'invalid mode ignored');
}

function testSnapping() {
  assert.equal(snapDuration(getModel('fal/veo3-fast-i2v'), 5), 8, 'Veo 3 Fast 5s snaps to 8');
  const kling = getModel('fal/kling-v2.1-master-i2v');
  assert.deepEqual(durationsFor(kling!), [5, 10]);
  assert.equal(snapDuration(kling, 6), 5, 'kling 6s snaps to 5');
  assert.equal(snapDuration(kling, 8), 10, 'kling 8s snaps to 10');
  assert.equal(snapDuration(kling, 7.5), 10, 'tie goes up');
  const grok = getModel('xai/grok-imagine-video-1.5');
  assert.equal(snapDuration(grok, 6), 6, 'grok keeps 6s (range 1-15)');
  // A model with no limits keeps its input unchanged (no invented 1..10 snap).
  const noLimits = { id: 'test/no-limits', kind: 'video', limits: {} } as any;
  assert.equal(snapDuration(noLimits, 12), 12, 'no limits keeps 12');
  assert.deepEqual(durationsFor(noLimits), [], 'no limits -> empty list');
  assert.equal(snapDuration(undefined, 6), 6, 'unknown model unchanged');
}

async function testWorkspace(ws: string) {
  const created = await createProject(ws, { title: 'Studio flow regression' } as any);
  const id = created.id;
  await applyOps(ws, id, [{ op: 'plan.setShots', shots: [
    { id: 'shot_a', title: 'Shot A', prompt: 'a', durationSec: 5, modelId: 'fal/veo3-fast-i2v' },
    { id: 'shot_b', title: 'Shot B', prompt: 'b', durationSec: 5, modelId: 'xai/grok-imagine-video-1.5', chainFromPrevious: true },
  ] }]);

  // Veo 5s: estimate prices 8s; grok (no snap needed) prices as-is
  const veo = await estimate(ws, id, { shotIds: ['shot_a'], skipBalance: true } as any);
  const veoModel = getModel('fal/veo3-fast-i2v')!;
  const at8 = estimateCostUsd(veoModel, { durationSec: 8, count: 1 });
  const at5 = estimateCostUsd(veoModel, { durationSec: 5, count: 1 });
  assert.notEqual(at8, at5, 'the 8s and 5s prices differ, so the check below is meaningful');
  assert.equal(veo.shots[0].usd, at8, 'veo estimate prices the snapped 8s');

  // shot.approve needs a selected take; approve/unapprove/undo
  await assert.rejects(applyOps(ws, id, [{ op: 'shot.approve', id: 'shot_a' }]), /Shot has no take to keep\./, 'approve without take throws');
  await mutateProject(ws, id, 'test', (p) => {
    const s = p.shots.find((x) => x.id === 'shot_a')!;
    s.takes = [take('t1')] as any; s.selectedTakeId = 't1';
  });
  await applyOps(ws, id, [{ op: 'shot.approve', id: 'shot_a' }]);
  assert.ok(loadProject(ws, id).shots.find((x) => x.id === 'shot_a')!.approvedAt, 'approve sets approvedAt');
  await undoRedo(ws, id, 'undo');
  assert.equal(loadProject(ws, id).shots.find((x) => x.id === 'shot_a')!.approvedAt, undefined, 'undo clears approvedAt');
  await applyOps(ws, id, [{ op: 'shot.approve', id: 'shot_a' }, { op: 'shot.unapprove', id: 'shot_a' }]);
  assert.equal(loadProject(ws, id).shots.find((x) => x.id === 'shot_a')!.approvedAt, undefined, 'unapprove clears approvedAt');

  // project.update mode
  await applyOps(ws, id, [{ op: 'project.update', mode: 'auto' }]);
  assert.equal(loadProject(ws, id).mode, 'auto', 'mode auto persists');
  await applyOps(ws, id, [{ op: 'project.update', mode: 'bogus' }]);
  assert.equal(loadProject(ws, id).mode, 'auto', 'bogus mode ignored');

  // buildStoryboardRequest: editFrom leads refs, instruction in prompt
  const p = loadProject(ws, id);
  const img = getModel('xai/grok-imagine-image-2.0')!;
  const s = p.shots[0];
  const edited = buildStoryboardRequest(p, s, img, { refs: ['ref.png'], editFrom: 'sb/frame_a.png', instruction: 'cash in hand' });
  assert.equal(edited.refs[0], 'sb/frame_a.png', 'editFrom first in refs');
  assert.match(edited.prompt, /Edit this exact frame: cash in hand\./, 'instruction in prompt');
  const plain = buildStoryboardRequest(p, s, img, { refs: ['ref.png'] });
  assert.doesNotMatch(plain.prompt, /Edit this exact frame/, 'no editFrom -> storyboard prompt');
  assert.match(plain.prompt, /Storyboard frame: the exact opening frame/, 'no editFrom keeps storyboard prompt');
  assert.deepEqual(plain.refs, ['ref.png'], 'no editFrom leaves refs alone');

  // generateStoryboards count clamp through the needsApproval path (no approved flag -> no jobs)
  const four = await generateStoryboards(ws, id, { shotIds: ['shot_a'], count: 9 });
  assert.equal(four.needsApproval, true, 'unapproved storyboard is gated');
  assert.equal(four.estimate?.shots[0].count, 4, 'count 9 clamps to 4');
  assert.equal(four.jobs.length, 0, 'no job started');
  const two = await generateStoryboards(ws, id, { shotIds: ['shot_a'], count: 2 });
  // editFrom guard: empty instruction and multi-shot both throw a clear error; a valid single-shot edit does not.
  const guardErr = (e: unknown) => (e instanceof Error ? e.message : '');
  const emptyInstr = await generateStoryboards(ws, id, { shotIds: ['shot_a'], editFrom: 'frame.png', instruction: '   ' }).then(() => '', guardErr);
  assert.match(emptyInstr, /non-empty instruction/, 'editFrom with blank instruction throws');
  const multiShot = await generateStoryboards(ws, id, { shotIds: ['shot_a', 'shot_b'], editFrom: 'frame.png', instruction: 'add rain' }).then(() => '', guardErr);
  assert.match(multiShot, /exactly one shotId/, 'editFrom with two shots throws');
  const validEdit = await generateStoryboards(ws, id, { shotIds: ['shot_a'], editFrom: 'frame.png', instruction: 'add rain' }).then(() => '', guardErr);
  assert.doesNotMatch(validEdit, /editFrom needs/, 'valid single-shot editFrom passes the guard');
  assert.equal(two.estimate?.shots[0].count, 2, 'count 2 stays 2');
  assert.equal(loadProject(ws, id).jobs.length, 0, 'no jobs persisted');
}

async function main() {
  await testPureModel();
  testSnapping();
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-flow-'));
  try { await testWorkspace(ws); } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  console.log('Studio flow regression passed (snapping, shot approve/undo, mode, storyboard request/clamp, studio-model)');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
