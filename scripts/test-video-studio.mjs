// Regression: video studio layer (Supercomputer mode) end-to-end against local
// fakes: fal queue (images + video), OpenAI TTS, vision QA. No money spent.
// Covers: product import, templates, storyboard stills + approval, voiceover
// VO track, captions (ASS burn-in), generated music + ducking, vision QA +
// reroll, hook variants, multi-aspect reframe, cast/brand library, autopilot
// one-approval run, HTTP-free tool surface, card action contract, wake watch.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const load = (rel) => import(pathToFileURL(path.join(root, 'dist', rel)).href);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-studio-'));
const ws = path.join(tmp, 'workspace');
fs.mkdirSync(path.join(ws, 'uploads'), { recursive: true });
process.env.FAL_KEY = 'test-key-123';
process.env.OPENAI_API_KEY = 'sk-test-studio';
process.env.PROMETHEUS_VISION_JUDGE_ONLY = 'openai-key';

const deps = await load('runtime/dependencies.js');
const ffmpegBin = deps.resolveRuntimeBinary('ffmpeg', { allowPathFallback: true });
const mk = (args) => { const r = spawnSync(ffmpegBin, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
const probe = (abs) => spawnSync(ffmpegBin, ['-hide_banner', '-i', abs], { encoding: 'utf8' }).stderr;

// fake media
const vid = path.join(tmp, 'take.mp4');
const img = path.join(tmp, 'still.png');
const tts = path.join(tmp, 'vo.mp3');
mk(['-f', 'lavfi', '-i', 'testsrc=size=480x854:rate=24:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=4', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', vid]);
mk(['-f', 'lavfi', '-i', 'color=c=orange:size=480x854', '-frames:v', '1', img]);
mk(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=1.6', '-c:a', 'libmp3lame', tts]);
fs.copyFileSync(img, path.join(ws, 'uploads', 'can.png'));

let visionCalls = 0;
let visionScores = [4, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8]; // first judged take is bad -> reroll
const hits = { tts: 0, falImg: 0, falVid: 0 };
const vidPrompts = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    const u = req.url;
    // fal CDN storage upload (providers.uploadToFalStorage, 039fafada #545) and the balance
    // preflight (c64214fbc #601) are served locally: no real fal host, no key check.
    if (u.startsWith('/storage/upload/initiate')) res.end(JSON.stringify({ upload_url: `${base}/storage/put/up1`, file_url: `${base}/media/still.png` }));
    else if (req.method === 'PUT' && u.startsWith('/storage/put/')) res.end('');
    else if (u.startsWith('/v1/account/billing')) res.end(JSON.stringify({ credits: { current_balance: 50 } }));
    else if (req.method === 'POST' && u.startsWith('/fal-ai/')) {
      const isImg = /flux|image/i.test(u);
      if (isImg) hits.falImg += 1; else { hits.falVid += 1; try { vidPrompts.push(String(JSON.parse(body).prompt || '')); } catch { /* ignore */ } }
      const id = `${isImg ? 'img' : 'vid'}${hits.falImg + hits.falVid}`;
      res.end(JSON.stringify({ request_id: id, status_url: `${base}/status/${id}`, response_url: `${base}/result/${id}` }));
    } else if (u.startsWith('/status/')) res.end(JSON.stringify({ status: 'COMPLETED' }));
    else if (u.startsWith('/result/img')) res.end(JSON.stringify({ images: [{ url: `${base}/media/still.png` }] }));
    else if (u.startsWith('/result/vid')) res.end(JSON.stringify({ video: { url: `${base}/media/take.mp4` } }));
    else if (u === '/media/still.png') { res.setHeader('content-type', 'image/png'); res.end(fs.readFileSync(img)); }
    else if (u === '/media/take.mp4') { res.setHeader('content-type', 'video/mp4'); res.end(fs.readFileSync(vid)); }
    else if (u === '/v1/audio/speech') { hits.tts += 1; res.setHeader('content-type', 'audio/mpeg'); res.end(fs.readFileSync(tts)); }
    else if (u === '/v1/responses') {
      const score = visionScores[visionCalls++] ?? 8;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ output_text: JSON.stringify({ score, issues: score < 6 ? ['deformed hand'] : [], verdict: score < 6 ? 'reroll' : 'pass' }), output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ score, issues: score < 6 ? ['deformed hand'] : [], verdict: score < 6 ? 'reroll' : 'pass' }) }] }] }));
    } else { res.statusCode = 404; res.end('{}'); }
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => {
  const s = String(url);
  if (/^https:\/\/(queue\.fal\.run|rest\.alpha\.fal\.ai|api\.fal\.ai)/.test(s)) return realFetch(s.replace(/^https:\/\/(queue\.fal\.run|rest\.alpha\.fal\.ai|api\.fal\.ai)/, base), init);
  if (s.startsWith('https://api.openai.com')) return realFetch(s.replace('https://api.openai.com', base), init);
  if (/x\.ai\/|chatgpt\.com|auth\.openai\.com/.test(s)) return Promise.resolve(new Response('{"error":"blocked in test"}', { status: 401 }));
  if (/^https?:\/\/(?!127\.0\.0\.1)/.test(s)) throw new Error(`unexpected network call in test: ${s}`);
  return realFetch(url, init);
};

const catalog = await load('media-engine/catalog.js');
const project = await load('media-engine/project.js');
const engine = await load('media-engine/engine.js');
const studio = await load('media-engine/studio.js');
const tool = await load('media-engine/tool.js');
const captionsMod = await load('media-engine/captions.js');
const wake = await load('gateway/video-project-wake.js');

// Cheap fake fal models so every step routes to the fake queue.
catalog.saveUserManifest({ id: 'fal/test-img', label: 'Test image', provider: 'fal', kind: 'image', endpoint: 'fal-ai/test-image', map: { prompt: 'prompt', referenceImages: 'image_urls', aspectRatio: 'aspect_ratio' }, pricing: { perImageUsd: 0.03 }, output: 'images[0].url' });
catalog.saveUserManifest({ id: 'fal/test-vid', label: 'Test video', provider: 'fal', kind: 'video', endpoint: 'fal-ai/test-video', map: { prompt: 'prompt', startImage: 'image_url', durationSec: 'duration' }, limits: { minDurationSec: 1, maxDurationSec: 10 }, pricing: { perSecondUsd: 0.05 }, output: 'video.url' });

const cleanup = () => { for (const id of ['fal/test-img', 'fal/test-vid']) { try { catalog.removeUserManifest(id); } catch { /* ignore */ } } };
process.on('exit', cleanup);
process.on('uncaughtException', (e) => { console.error(e); cleanup(); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error(e); cleanup(); process.exit(1); });

let passed = 0;
const ok = (name) => { passed += 1; console.log(`ok ${passed} - ${name}`); };

// ── captions unit ──
{
  const w = captionsMod.timeWords('ok I need to talk about this', 1000, 2000);
  assert.equal(w.length, 7);
  assert.equal(w[0].startMs, 1000);
  assert.ok(Math.abs(w[6].endMs - 3000) <= 1);
  const ass = captionsMod.buildAss([{ startMs: 0, endMs: 900, text: 'ok I need', words: w.slice(0, 3) }], 'pop', 480, 854);
  assert.match(ass, /PlayResY: 854/);
  assert.equal((ass.match(/^Dialogue:/gm) || []).length, 3, 'pop = one event per active word');
  const k = captionsMod.buildAss([{ startMs: 0, endMs: 900, text: 'ok I need', words: w.slice(0, 3) }], 'karaoke', 480, 854);
  assert.match(k, /\\kf\d+/);
  ok('captions: syllable-weighted word timing + pop/karaoke ASS');
}

// ── templates + product import + quickstart (no run) ──
const qs = await tool.executeVideoProject({ action: 'quickstart', brief: 'UGC ad for Volt energy drink', productPath: 'uploads/can.png', productName: 'Volt energy drink', capUsd: 6 }, { workspacePath: ws });
const pid = qs.projectId;
assert.ok(pid);
let p = project.loadProject(ws, pid);
assert.equal(p.templateId, 'ugc-testimonial');
assert.equal(p.target.aspect, '9:16');
assert.equal(p.shots.length, 5);
const product = p.characters.find((c) => c.kind === 'product');
const creator = p.characters.find((c) => (c.kind || 'person') === 'person');
assert.ok(product && product.anchors[0].includes('imports/'), 'product photo imported as approved anchor');
assert.ok(creator && !creator.anchors.length, 'creator needs an anchor');
assert.ok(p.shots.every((s) => s.prompt && !/[{}]/.test(s.prompt)), 'placeholders filled');
assert.ok(p.shots.filter((s) => s.line).length >= 4, 'template lines');
assert.ok(p.shots.some((s) => s.characterIds.includes(product.id)), 'product wired into shots');
assert.ok(p.music?.path && fs.existsSync(path.join(ws, p.music.path)), 'template music bed generated');
assert.ok((p.hookVariants || []).length >= 2, 'hook variants carried');
assert.ok(qs.needsApproval?.usd > 0 && qs.needsApproval.breakdown.length >= 3, 'one whole-run approval with breakdown');
assert.equal(p.lastRun?.state, 'needs_approval');
assert.equal(hits.falVid + hits.falImg, 0, 'nothing spent before approval');
ok(`quickstart: template (5 shots), product import, music, whole-run estimate $${qs.needsApproval.usd} gated`);

// UGC defaults to native on-camera dialogue; this block covers the narrator path.
assert.equal(p.audioMode, 'native', 'UGC template defaults to on-camera dialogue');
// Route everything to the fake models.
await project.applyOps(ws, pid, [
  { op: 'project.update', audioMode: 'voiceover', defaults: { imageModel: 'fal/test-img', videoModel: 'fal/test-vid' } },
  ...p.shots.map((s) => ({ op: 'shot.update', id: s.id, modelId: 'fal/test-vid', durationSec: 3 })),
]);

// ── storyboard + approval gate ──
{
  // Budget policy 2 defaults autoApproveUsd to $0 (quote-first, b1f1246aa #565). Set an explicit
  // auto-approve threshold so the ~$0.06 two-still storyboard runs without an approval round-trip.
  await project.applyOps(ws, pid, [{ op: 'project.update', budget: { autoApproveUsd: 1 } }]);
  const sb = await tool.executeVideoProject({ action: 'storyboard', projectId: pid, shotIds: [p.shots[0].id, p.shots[1].id] }, { workspacePath: ws });
  assert.ok(!sb.needsApproval, `2 stills under auto-approve: ${sb.reason || ''}`);
  await engine.waitForJobs(ws, pid, sb.jobs.map((j) => j.id), 30_000);
  p = project.loadProject(ws, pid);
  assert.equal(p.shots[0].storyboardCandidates.length, 1);
  const cand = p.shots[0].storyboardCandidates[0];
  await project.applyOps(ws, pid, [{ op: 'shot.approveStoryboard', id: p.shots[0].id }]);
  await project.applyOps(ws, pid, [{ op: 'shot.rejectStoryboard', id: p.shots[1].id }]);
  p = project.loadProject(ws, pid);
  assert.equal(p.shots[0].storyboard, cand);
  assert.equal(p.shots[1].storyboardCandidates.length, 0);
  await project.undoRedo(ws, pid, 'undo');
  await project.undoRedo(ws, pid, 'undo');
  p = project.loadProject(ws, pid);
  assert.ok(!p.shots[0].storyboard && p.shots[0].storyboardCandidates.includes(cand), 'undo returns paid still to candidates');
  ok('storyboard stills land as candidates; approve/reject; undo never loses paid stills');
}

// ── autopilot approved run: anchors, storyboard, VO, video, QA+reroll, assemble, captions, music, render ──
{
  visionCalls = 0;
  const run = await tool.executeVideoProject({ action: 'run', projectId: pid, approved: true, wait: true, aspects: ['9:16', '1:1'] }, { workspacePath: ws });
  const r = run.lastRun;
  const state = Object.fromEntries(r.steps.map((s) => [s.step, s.state]));
  assert.equal(r.state, 'done', `run failed: ${r.error} ${JSON.stringify(r.steps)}`);
  for (const s of ['anchors', 'storyboard', 'voiceover', 'generate', 'qa', 'assemble', 'captions', 'render']) assert.equal(state[s], 'done', `${s} -> ${state[s]}`);
  p = project.loadProject(ws, pid);
  assert.ok(p.characters.find((c) => c.id === creator.id).anchors.length, 'creator anchor generated + approved');
  assert.ok(p.shots.every((s) => s.storyboard), 'every shot boarded');
  assert.ok(p.shots.every((s) => s.takes.length && s.takes[0].poster), 'takes have poster thumbnails');
  assert.ok(p.shots.filter((s) => s.voiceover).length >= 4, 'VO per line');
  const vo = p.tracks.find((t) => t.label === 'VO');
  assert.ok(vo && p.clips.filter((c) => c.trackId === vo.id).length >= 4, 'VO clips on the timeline');
  assert.ok(p.captions.enabled && p.captions.cues.length >= 6, 'caption cues');
  const qaTakes = p.shots.flatMap((s) => s.takes).filter((t) => t.qa);
  assert.ok(qaTakes.length >= 5, 'every take scored');
  assert.ok(p.shots.some((s) => s.takes.length >= 2), 'bad take rerolled');
  const rerolled = p.shots.find((s) => s.takes.length >= 2);
  const sel = rerolled.takes.find((t) => t.id === rerolled.selectedTakeId);
  assert.ok(sel.qa.score >= 6, 'better reroll selected');
  assert.equal(run.render.exports.length, 2);
  const [e916, e11] = run.render.exports;
  const a = probe(path.join(ws, e916.path));
  assert.match(a, /480x854/); assert.match(a, /Audio: aac/);
  assert.match(probe(path.join(ws, e11.path)), /480x480/);
  assert.ok(p.budget.spentUsd > 0 && p.budget.spentUsd <= 6, `spent ${p.budget.spentUsd} within cap`);
  assert.ok(hits.tts >= 4);
  ok(`autopilot: one approval -> anchors, ${p.shots.length} boards, VO, video, QA (+reroll), captions, music, 9:16 + 1:1 renders ($${p.budget.spentUsd})`);

  // Captions really burn in: compare a caption frame against the same frame without captions.
  const plain = await engine.renderProject(ws, pid, { captions: false, music: false, variant: 'nocap' });
  const cue = p.captions.cues[0];
  const at = ((cue.startMs + cue.endMs) / 2000).toFixed(2);
  const f1 = path.join(tmp, 'cap.png'); const f2 = path.join(tmp, 'nocap.png');
  mk(['-ss', at, '-i', path.join(ws, e916.path), '-frames:v', '1', f1]);
  mk(['-ss', at, '-i', path.join(ws, plain.path), '-frames:v', '1', f2]);
  assert.notDeepEqual(fs.readFileSync(f1), fs.readFileSync(f2), 'caption frame differs');
  ok('captions are burned into the export (frame differs from caption-less render)');
  // Resumable: a second run skips everything already done and spends nothing.
  const spent = p.budget.spentUsd;
  const again = await studio.runAutopilot(ws, pid, { approved: true, aspects: ['9:16'] });
  assert.equal(again.lastRun.state, 'done');
  assert.equal(project.loadProject(ws, pid).budget.spentUsd, spent, 'rerun spends nothing');
  ok('autopilot is resumable: rerun skips finished steps, $0 extra');
}

// ── hooks A/B + variants render ──
{
  const h = await tool.executeVideoProject({ action: 'hooks', projectId: pid, approved: true }, { workspacePath: ws });
  assert.ok(h.jobs.length >= 2, 'hook takes started');
  await engine.waitForJobs(ws, pid, h.jobs.map((j) => j.id), 30_000);
  const v = await tool.executeVideoProject({ action: 'render_variants', projectId: pid, shotId: h.shotId }, { workspacePath: ws });
  assert.ok(v.exports.length >= 3);
  assert.deepEqual(v.exports.slice(0, 2).map((e) => e.variant), ['hook-A', 'hook-B']);
  p = project.loadProject(ws, pid);
  assert.ok(p.exports.some((e) => e.variant === 'hook-B'));
  ok(`hook A/B: ${h.jobs.length} alt hooks -> ${v.exports.length} variant exports`);
}

// ── 16:9 reframe (blur fill) ──
{
  const r = await tool.executeVideoProject({ action: 'render', projectId: pid, aspects: ['16:9'] }, { workspacePath: ws });
  assert.match(probe(path.join(ws, r.exports[0].path)), /854x480/);
  ok('reframe 9:16 project to 16:9 with blur fill');
}

// ── cast + brand library ──
{
  const saved = await tool.executeVideoProject({ action: 'cast_save', projectId: pid, characterId: creator.id }, { workspacePath: ws });
  assert.match(saved.saved.id, /^cast_/);
  assert.ok(fs.existsSync(path.join(ws, saved.saved.anchors[0])));
  const logo = path.join(ws, 'uploads', 'logo.png');
  fs.copyFileSync(img, logo);
  const b = await tool.executeVideoProject({ action: 'brand_save', brand: { name: 'Volt', colors: ['#FFD400', '#111111'], tone: 'energetic, gen-z', logo: 'uploads/logo.png', watermark: true, castIds: [saved.saved.id] } }, { workspacePath: ws });
  const p2 = await project.createProject(ws, { title: 'Second ad', target: { aspect: '9:16', resolution: '480p', fps: 24 } });
  await tool.executeVideoProject({ action: 'brand_apply', projectId: p2.id, brandId: b.saved.id }, { workspacePath: ws });
  const q = project.loadProject(ws, p2.id);
  assert.equal(q.brand.name, 'Volt');
  assert.ok(q.characters.some((c) => c.castId === saved.saved.id), 'cast member reused in a new project');
  assert.ok(q.styles.some((s) => s.name === 'Volt brand'));
  // watermark renders
  await project.applyOps(ws, pid, [{ op: 'project.update', brand: { ...q.brand, logo: q.brand.logo, watermark: true } }]);
  const w = await engine.renderProject(ws, pid, { variant: 'wm' });
  assert.equal(w.watermark, true);
  ok('cast saved to library, brand kit applied to a new project, watermark rendered');
}

// ── wake watch + tool gating + card/HTTP contract ──
{
  const out = await tool.executeVideoProject({ action: 'watch', projectId: pid, jobIds: ['job_nope'] }, { workspacePath: ws, sessionId: 'sess_test' });
  assert.match(out.note, /woken/);
  assert.ok(wake.listVideoWatches().some((x) => x.sessionId === 'sess_test'));
  wake.resetVideoProjectWakeForTests();
  const caps = await load('gateway/tool-capabilities.js');
  const cap = (action) => caps.resolveToolCapabilityMetadata('video_project', undefined, { action });
  assert.equal(cap('templates').sideEffect, cap('get').sideEffect);
  assert.equal(cap('run').sideEffect, cap('generate').sideEffect);
  assert.equal(cap('cast_delete').sideEffect, cap('delete').sideEffect);
  const card = fs.readFileSync(path.join(root, 'web-ui/src/components/video-project-card/v2.js'), 'utf8');
  for (const a of ['import_asset', 'storyboard', 'voiceover', 'captions', 'music', 'qa', 'run', 'render_variants']) assert.ok(card.includes(`'${a}'`), `card calls ${a}`);
  const routes = fs.readFileSync(path.join(root, 'src/gateway/routes/video-project.routes.ts'), 'utf8');
  for (const a of ['import_asset', 'storyboard', 'voiceover', 'captions', 'music', 'qa', 'run', 'render_variants']) assert.ok(routes.includes(`'${a}'`), `route allows ${a}`);
  ok('wake watch registers; capability gates; card actions all routed by /action');
}

// ── native dialogue: creator speaks the lines on camera; captions come from the clip audio ──
{
  const transcribe = await load('media-engine/transcribe.js');
  // units: script snapping + trim-aware cue mapping + legacy defaults
  const snapped = transcribe.snapToScript([{ text: 'okay', startMs: 0, endMs: 300 }, { text: 'i', startMs: 300, endMs: 400 }, { text: 'need', startMs: 400, endMs: 700 }], 'Okay, I need.');
  assert.deepEqual(snapped.map((w) => w.text), ['Okay,', 'I', 'need.'], 'heard line adopts script spelling');
  assert.equal(transcribe.snapToScript([{ text: 'hey', startMs: 0, endMs: 200 }], 'Totally different line here')[0].text, 'hey', 'unmatched speech stays as heard');
  assert.deepEqual(transcribe.dropPhantomSpeech([{ text: 'You', startMs: 0, endMs: 300, p: 0.4 }]), [], 'Whisper "You" on ambience is dropped');
  assert.deepEqual(transcribe.dropPhantomSpeech([{ text: 'Thank', startMs: 0, endMs: 200 }, { text: 'you.', startMs: 200, endMs: 400 }]), []);
  assert.equal(transcribe.dropPhantomSpeech([{ text: 'Mmm,', startMs: 0, endMs: 200, p: 0.9 }, { text: 'this', startMs: 200, endMs: 400 }, { text: 'is', startMs: 400, endMs: 500 }, { text: 'good.', startMs: 500, endMs: 800 }]).length, 4, 'real speech kept');
  assert.equal(project.normalizeProject({ id: 'vp_legacy01', shots: [{ id: 's', title: 'x', voiceover: { path: 'a.mp3' } }] }).audioMode, 'voiceover', 'legacy VO projects stay narrator');
  const np = project.normalizeProject({
    id: 'vp_native01',
    audioMode: 'native',
    shots: [{ id: 's1', title: 'A', takes: [{ id: 't1', kind: 'video', path: 'x.mp4', transcript: { text: 'a b c d', provider: 't', at: 0, words: [
      { text: 'a', startMs: 100, endMs: 400 }, { text: 'b', startMs: 1200, endMs: 1500 }, { text: 'c', startMs: 1600, endMs: 1900 }, { text: 'd', startMs: 3500, endMs: 3800 }] } }], selectedTakeId: 't1' }],
    tracks: [{ id: 'tv', kind: 'video', label: 'V1' }],
    clips: [{ id: 'c1', trackId: 'tv', source: { shotId: 's1' }, startMs: 5000, inMs: 1000, outMs: 3000 }],
  });
  const nc = captionsMod.buildNativeCaptionCues(np);
  assert.equal(nc.map((c) => c.text).join(' '), 'b c', 'words trimmed out of the clip are not captioned');
  assert.equal(nc[0].startMs, 5200, 'word time maps through the trim onto the timeline');

  // Full autopilot in native mode against the fakes, with a deterministic transcriber.
  let sttCalls = 0;
  transcribe.setTranscriberForTests(async (wavs) => { sttCalls += wavs.length; return wavs.map(() => ({ text: 'okay this is', provider: 'fake-stt', words: [
    { text: 'okay', startMs: 200, endMs: 600 }, { text: 'this', startMs: 700, endMs: 950 }, { text: 'is', startMs: 1000, endMs: 1200 }] })); });
  const q = await tool.executeVideoProject({ action: 'quickstart', brief: 'UGC ad for Volt', productPath: 'uploads/can.png', productName: 'Volt', capUsd: 6 }, { workspacePath: ws });
  const nid = q.projectId;
  let n = project.loadProject(ws, nid);
  assert.equal(n.audioMode, 'native');
  assert.ok(!q.needsApproval.breakdown.some((b) => /Voiceover/.test(b.item)), 'native run does not budget TTS');
  await project.applyOps(ws, nid, [
    { op: 'project.update', defaults: { imageModel: 'fal/test-img', videoModel: 'fal/test-vid' } },
    ...n.shots.map((s) => ({ op: 'shot.update', id: s.id, modelId: 'fal/test-vid', durationSec: 3 })),
  ]);
  const ttsBefore = hits.tts;
  vidPrompts.length = 0;
  const run = await tool.executeVideoProject({ action: 'run', projectId: nid, approved: true, wait: true, storyboard: false, qa: false }, { workspacePath: ws });
  const st = Object.fromEntries(run.lastRun.steps.map((s) => [s.step, s]));
  assert.equal(run.lastRun.state, 'done', `native run failed: ${run.lastRun.error} ${JSON.stringify(run.lastRun.steps)}`);
  assert.equal(st.voiceover.state, 'skipped');
  assert.match(st.voiceover.note, /native/);
  assert.equal(st.transcribe.state, 'done');
  assert.equal(st.captions.state, 'done');
  assert.match(st.captions.note, /clip audio/);
  assert.equal(hits.tts, ttsBefore, 'no TTS in native mode');
  n = project.loadProject(ws, nid);
  const lined = n.shots.filter((s) => s.line);
  assert.equal(vidPrompts.length, n.shots.length);
  assert.ok(lined.every((s) => vidPrompts.some((pr) => pr.includes(`saying exactly: "${s.line.replace(/"/g, "'")}"`))), 'each shot prompt carries its own line');
  assert.ok(!vidPrompts.some((pr) => /No dialogue/.test(pr)), 'native prompts never mute dialogue');
  assert.ok(n.shots.every((s) => !s.voiceover), 'no VO recorded');
  const voT = n.tracks.find((t) => t.label === 'VO');
  assert.ok(!voT || !n.clips.some((c) => c.trackId === voT.id), 'no narrator clips on the timeline');
  assert.equal(sttCalls, n.shots.length, 'every take transcribed once');
  assert.ok(n.shots.every((s) => project.selectedTake(s).transcript.words.length === 3));
  const main = n.tracks.find((t) => t.kind === 'video');
  const firstClip = n.clips.filter((c) => c.trackId === main.id).sort((a, b) => a.startMs - b.startMs)[0];
  assert.equal(n.captions.cues[0].text, 'okay this is', 'captions are what the clip says, not the script');
  assert.equal(n.captions.cues[0].startMs, firstClip.startMs + 200);
  assert.equal(n.captions.cues.length, n.shots.length);
  const rendered = run.render?.exports?.[0] || project.loadProject(ws, nid).exports.at(-1);
  assert.ok(rendered && fs.existsSync(path.join(ws, rendered.path)), 'native render exported');
  // Re-running transcribe is idempotent (skips), and switching to narrator mutes clip dialogue in prompts.
  const again = await tool.executeVideoProject({ action: 'transcribe', projectId: nid }, { workspacePath: ws });
  assert.equal(again.transcribed.length, 0);
  assert.equal(again.skipped.length, n.shots.length);
  await project.applyOps(ws, nid, [{ op: 'project.update', audioMode: 'voiceover' }]);
  const vo = project.loadProject(ws, nid);
  assert.match(engine.dialogueDirection(vo, vo.shots[0]), /No dialogue/);
  transcribe.setTranscriberForTests(null);
  ok('native dialogue: lines spoken on camera, no TTS, captions transcribed from the clips (trim-aware), narrator switch mutes clips');
}

server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed`);
process.exit(0);
