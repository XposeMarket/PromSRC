/** Regression for dense take QA + reel breakdown (2026-10-07 shirt-split miss). Offline: fake vision judge, real ffmpeg. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { breakdownReel, denseTakeCheck, expectedFromNotes, lengthDefects, planParts, setVisionJudgeForTests, trendWindow } from './inspect.js';
import { trendSpeed } from './trend.js';
import { resolveRuntimeBinary } from '../runtime/dependencies.js';

async function main() {
  // planParts: model minimum is enforced before any quote (Kling rejected 2.2s / 1.5s parts).
  const plan = planParts(11.7, [2.2, 3.7], 3, 3);
  assert.equal(plan.length, 3);
  assert.ok(plan[0].speed < 1 && plan[1].speed < 1 && plan[2].speed === 1, JSON.stringify(plan));
  for (const pt of plan) assert.ok((pt.endSec - pt.startSec) / pt.speed >= 3, `part reaches 3s: ${JSON.stringify(pt)}`);
  assert.equal(planParts(10, [1, 2, 3, 6], 0, 3).length, 3, 'maxParts drops the boundary making the shortest part');
  assert.equal(trendSpeed('trend tr_x 0-2.2s speed=0.72 of a.mp4'), 0.72);
  assert.equal(trendSpeed('no speed'), 1);
  assert.deepEqual(trendWindow({ notes: 'trend tr_x 3.7-11.7s speed=1 of a.mp4' }), { startSec: 3.7, endSec: 11.7 });
  // Part 3 came back 5.97s for an 8s window: flagged without vision.
  const short = lengthDefects({ durationSec: 8 } as any, 5.97, 8);
  assert.equal(short[0]?.severity, 'major');
  assert.equal(lengthDefects({ durationSec: 5 } as any, 5.04, 5).length, 0);
  console.log('ok plan + length');

  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'take-qa-'));
  try {
    const ff = resolveRuntimeBinary('ffmpeg', { allowPathFallback: true });
    const clip = path.join(ws, 'clip.mp4');
    const r = spawnSync(ff, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x568:rate=30:duration=6', '-pix_fmt', 'yuv420p', clip]);
    assert.equal(r.status, 0, String(r.stderr));

    // Dense QA: a defect reported at cell 3 maps to 0.75s; any major defect forces reroll.
    const calls: Array<{ prompt: string; images: number }> = [];
    setVisionJudgeForTests(async (prompt, images) => {
      calls.push({ prompt, images: images.length });
      return { success: true, model: 'fake', text: '{"score": 8, "verdict": "pass", "defects": [{"cell": 3, "issue": "white shirt splits open down the middle", "severity": "major"}]}' };
    });
    const p: any = { id: 'vp_t', characters: [{ id: 'c1', name: 'Edna', anchors: [] }] };
    const shot: any = { id: 's1', title: 'Trend part 2', prompt: 'drape the cardigan', durationSec: 6, characterIds: ['c1'], notes: 'trend tr_x 0-6s speed=1 of a.mp4' };
    const take: any = { id: 'take_1', kind: 'video', path: path.relative(ws, clip).split(path.sep).join('/'), durationSec: 6 };
    const d = await denseTakeCheck(ws, p, shot, take, { workDir: path.join(ws, 'qa') });
    assert.equal(d.intervalSec, 0.25);
    assert.ok(d.framesChecked >= 20, `dense sampling, got ${d.framesChecked}`);
    assert.equal(calls[0].images, 2, '24 frames -> two 4x3 sheets');
    assert.match(calls[0].prompt, /tears, splits, opens/);
    assert.equal(d.verdict, 'reroll');
    assert.ok(d.score <= 5);
    assert.equal(d.defects[0].atSec, 0.75);
    assert.match(d.issues[0], /^@0\.75s white shirt splits/);
    console.log('ok dense-qa', d.framesChecked, 'frames');

    // Garment-vs-reel (2026-10-07 part 2 miss): the judge must SEE the reference performance and
    // know the expected outfit, so an open button-up that morphs into a split shrug is a major defect.
    assert.deepEqual(expectedFromNotes('trend tr_x 2.18-3.68s speed=0.49 of a.mp4 | puts on a white button-up | look: white tee, open white button-up shirt'),
      { action: 'puts on a white button-up', look: 'white tee, open white button-up shirt' });
    assert.deepEqual(expectedFromNotes('trend tr_x 0-2s of a.mp4'), { action: undefined, look: undefined });
    calls.length = 0;
    setVisionJudgeForTests(async (prompt, images) => {
      calls.push({ prompt, images: images.length });
      const garmentAware = /ORIGINAL REFERENCE/.test(prompt) && /open white button-up/.test(prompt) && /GARMENT CHECK/.test(prompt);
      return { success: true, model: 'fake', text: garmentAware
        ? '{"garments":["open white button-up shirt","blue tee"],"score":8,"verdict":"pass","defects":[{"cell":4,"issue":"open button-up turns into a split shrug wrapped around the neck","severity":"major"}]}'
        : '{"score":8,"verdict":"pass","defects":[]}' };
    });
    const garmentShot: any = { ...shot, sourceVideo: path.relative(ws, clip).split(path.sep).join('/'), notes: 'trend tr_x 2.18-3.68s speed=0.49 of a.mp4 | puts on a white button-up | look: white tee, open white button-up shirt' };
    const g = await denseTakeCheck(ws, p, garmentShot, { ...take, id: 'take_2' }, { workDir: path.join(ws, 'qa2') });
    assert.equal(calls[0].images, 4, 'two reference sheets + two take sheets');
    assert.match(calls[0].prompt, /Images 1-2 are contact sheets of the ORIGINAL REFERENCE/);
    assert.match(calls[0].prompt, /Images 3-4 are contact sheets of the GENERATED clip/);
    assert.match(calls[0].prompt, /Outfit the generated person must wear: white tee, open white button-up shirt/);
    assert.equal(g.verdict, 'reroll', 'garment morph forces a reroll');
    assert.equal(g.defects[0].atSec, 1);
    assert.match(g.issues[0], /^@1\.00s open button-up turns into a split shrug/);
    // No reference video: no reference sheets, no garment block unless a look is known.
    calls.length = 0;
    await denseTakeCheck(ws, p, shot, { ...take, id: 'take_3' }, { workDir: path.join(ws, 'qa3') });
    assert.doesNotMatch(calls[0].prompt, /ORIGINAL REFERENCE|GARMENT CHECK/);
    console.log('ok garment-vs-reel');

    // Breakdown: garment change + look flow back per part; vision failure degrades, never throws.
    setVisionJudgeForTests(async () => ({ success: true, model: 'fake', text: '{"subject":"tall slim dancer","parts":[{"action":"spins","garmentChange":false,"risks":["fast spin"]},{"action":"puts on a button-up","garmentChange":true,"look":"white tee, open blue button-up on the shoulders","risks":["garment change","hands on clothing"]}]}' }));
    const bd = await breakdownReel(clip, { workDir: path.join(ws, 'bd'), cuts: [2], maxParts: 2, minPartSec: 3 });
    assert.equal(bd.vision, 'ok');
    assert.equal(bd.parts.length, 2);
    assert.ok(bd.parts[0].speed < 1, 'the 2s part is slowed to reach 3s');
    assert.equal(bd.parts[1].garmentChange, true);
    assert.match(bd.parts[1].look || '', /open blue button-up/);
    assert.equal(bd.subject, 'tall slim dancer');
    setVisionJudgeForTests(async () => ({ success: false, error: 'no provider' }));
    const bd2 = await breakdownReel(clip, { workDir: path.join(ws, 'bd2'), cuts: [2], maxParts: 2, minPartSec: 3 });
    assert.equal(bd2.vision, 'unavailable');
    assert.equal(bd2.parts.length, 2);
    console.log('ok breakdown');
  } finally {
    setVisionJudgeForTests(null);
    fs.rmSync(ws, { recursive: true, force: true });
  }
  console.log('take-qa regression: ok');
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
