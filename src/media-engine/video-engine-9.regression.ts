/** Regression for the 2026-10-07 video engine audit (items 1-9). Offline: no paid calls. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { estimateCostUsd, getModel, isVerifiedModel } from './catalog.js';
import { DEFAULT_MODELS } from './parity.js';
import { createProject, loadProject } from './project.js';
import { executeVideoProject } from './tool.js';
import { getTemplate } from './templates.js';
import { phoneFinish } from './trend.js';
import { resolveRuntimeBinary } from '../runtime/dependencies.js';

async function main() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'video-engine-9-'));
  const ctx = { workspacePath: ws };
  try {
    // 1. verified vs synced
    const kling = getModel('fal/kling-v3-pro-motion-control')!;
    assert.ok(kling && isVerifiedModel(kling), 'curated Kling MC is verified');
    assert.equal(kling.map.startImage, 'image_url');
    assert.equal((kling.defaults as any).character_orientation, 'video');
    assert.equal(isVerifiedModel({ ...kling, source: 'fal-sync' }), false);

    // 2. defaults
    assert.equal(DEFAULT_MODELS.recastMotion, 'fal/kling-v3-pro-motion-control');
    assert.equal(getTemplate('ugc-testimonial')?.audioMode, 'native');

    // 3. auto-approve defaults to $0
    const p = await createProject(ws, { title: 'audit' } as any);
    assert.equal(loadProject(ws, p.id).budget.autoApproveUsd, 0);

    // 4. real costs
    const wan = getModel('fal/wan-animate-replace')!;
    assert.equal(estimateCostUsd(wan, { durationSec: 10, resolution: '480p' }), 0.4);
    assert.equal(estimateCostUsd(wan, { durationSec: 10, resolution: '720p' }), 0.8);
    assert.equal(estimateCostUsd(getModel('openai/gpt-image')!, { count: 1 }), 0, 'subscription images are $0');
    assert.equal(estimateCostUsd(kling, { durationSec: 5 }), 0.84);

    // 7. standalone cast save (no project)
    const face = path.join(ws, 'face.png'); fs.writeFileSync(face, 'png');
    const saved: any = await executeVideoProject({ action: 'cast_save', name: 'Edna', anchors: ['face.png'], notes: 'tiny, blunt' }, ctx);
    assert.match(saved.saved.id, /^cast_/);
    const listed: any = await executeVideoProject({ action: 'cast_list' }, ctx);
    assert.equal(listed.cast[0].name, 'Edna');

    // 9. apply_ops double-encoded + `operations` alias + single object
    await executeVideoProject({ action: 'apply_ops', projectId: p.id, ops: [{ op: 'plan.setShots', shots: [{ id: 'shot_a', title: 'A' }] }] }, ctx);
    const dbl = JSON.stringify(JSON.stringify([{ op: 'shot.update', id: 'shot_a', prompt: 'double' }]));
    let r: any = await executeVideoProject({ action: 'apply_ops', projectId: p.id, ops: dbl }, ctx);
    assert.match(r.applied[0], /Updated/);
    r = await executeVideoProject({ action: 'apply_ops', projectId: p.id, operations: JSON.stringify([{ op: 'shot.update', id: 'shot_a', prompt: 'alias' }]) }, ctx);
    assert.match(r.applied[0], /Updated/);
    r = await executeVideoProject({ action: 'apply_ops', projectId: p.id, ops: { op: 'shot.update', id: 'shot_a', prompt: 'single' } }, ctx);
    assert.equal(loadProject(ws, p.id).shots[0].prompt, 'single');

    // 8. phone finish (local ffmpeg)
    const ff = resolveRuntimeBinary('ffmpeg', { allowPathFallback: true });
    const clip = path.join(ws, 'clip.mp4');
    const mk = spawnSync(ff, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=360x640:rate=24:duration=2', '-f', 'lavfi', '-i', 'sine=d=2', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip]);
    assert.equal(mk.status, 0, String(mk.stderr));
    const fin = await phoneFinish(ws, { path: 'clip.mp4' });
    assert.ok(fs.existsSync(path.join(ws, fin.path)), 'phone-look file written');
    const probe = spawnSync(ff, ['-hide_banner', '-i', path.join(ws, fin.path)]).stderr.toString();
    assert.match(probe, /30 fps/);

    console.log('video-engine-9 regression passed (items 1,2,3,4,7,8,9; 5/6 covered by wake + trend tests)');
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
}
main().catch((e) => { console.error(e); process.exit(1); });
