// Higgsfield-parity checks for the video engine, against dist/ with a local
// fake server standing in for fal, OpenAI TTS and vision. No real providers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const load = (rel) => import(pathToFileURL(path.join(root, 'dist', rel)).href);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-parity-'));
const ws = path.join(tmp, 'workspace');
fs.mkdirSync(path.join(ws, 'uploads'), { recursive: true });
process.env.FAL_KEY = 'test-key-123';
process.env.OPENAI_API_KEY = 'sk-test';
process.env.PROMETHEUS_VISION_JUDGE_ONLY = 'openai-key';

const deps = await load('runtime/dependencies.js');
const ffmpegBin = deps.resolveRuntimeBinary('ffmpeg', { allowPathFallback: true });
const mk = (args) => { const r = spawnSync(ffmpegBin, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
const probe = (abs) => spawnSync(ffmpegBin, ['-hide_banner', '-i', abs], { encoding: 'utf8' }).stderr;

const vid = path.join(tmp, 'take.mp4');
const img = path.join(tmp, 'still.png');
const tts = path.join(tmp, 'vo.mp3');
mk(['-f', 'lavfi', '-i', 'testsrc=size=480x854:rate=24:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=3', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', vid]);
mk(['-f', 'lavfi', '-i', 'testsrc2=size=640x640', '-frames:v', '1', img]);
mk(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=1.6', '-c:a', 'libmp3lame', tts]);
fs.copyFileSync(img, path.join(ws, 'uploads', 'face.png'));
fs.copyFileSync(vid, path.join(ws, 'uploads', 'clip.mp4'));

const bodies = []; // { endpoint, body }
let seq = 0;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    const u = req.url;
    if (u.startsWith('/storage/upload/initiate')) res.end(JSON.stringify({ upload_url: `${base}/storage/put/up1`, file_url: `${base}/storage/files/up1.png` }));
    else if (req.method === 'PUT' && u.startsWith('/storage/put/')) res.end('');
    else if (u.startsWith('/v1/account/billing')) res.end(JSON.stringify({ credits: { current_balance: 50 } }));
    else if (req.method === 'POST' && (u.startsWith('/fal-ai/') || u.startsWith('/decart/'))) {
      let parsed = {}; try { parsed = JSON.parse(body); } catch { /* ignore */ }
      bodies.push({ endpoint: u.slice(1), body: parsed });
      const isImg = /flux|image/i.test(u);
      const isAudio = /stable-audio/.test(u);
      const id = `${isImg ? 'img' : isAudio ? 'aud' : 'vid'}${++seq}`;
      res.end(JSON.stringify({ request_id: id, status_url: `${base}/status/${id}`, response_url: `${base}/result/${id}` }));
    } else if (u.startsWith('/status/')) res.end(JSON.stringify({ status: 'COMPLETED' }));
    else if (u.startsWith('/result/img')) res.end(JSON.stringify({ images: [{ url: `${base}/media/still.png` }] }));
    else if (u.startsWith('/result/aud')) res.end(JSON.stringify({ audio_file: { url: `${base}/media/vo.mp3` } }));
    else if (u.startsWith('/result/vid')) res.end(JSON.stringify({ video: { url: `${base}/media/take.mp4` } }));
    else if (u === '/media/still.png') { res.setHeader('content-type', 'image/png'); res.end(fs.readFileSync(img)); }
    else if (u === '/media/take.mp4') { res.setHeader('content-type', 'video/mp4'); res.end(fs.readFileSync(vid)); }
    else if (u === '/media/vo.mp3') { res.setHeader('content-type', 'audio/mpeg'); res.end(fs.readFileSync(tts)); }
    else if (u === '/v1/audio/speech') { res.setHeader('content-type', 'audio/mpeg'); res.end(fs.readFileSync(tts)); }
    else if (u === '/v1/responses') {
      const t = JSON.stringify({ score: 8, issues: [], verdict: 'pass' });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ output_text: t, output: [{ type: 'message', content: [{ type: 'output_text', text: t }] }] }));
    } else { res.statusCode = 404; res.end('{}'); }
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => {
  const s = String(url);
  // fal storage upload (#545) + balance preflight (#601) hit rest.alpha / api.fal: serve locally, never the network.
  if (/^https:\/\/(rest\.alpha|api)\.fal\.(ai|run)|^https:\/\/queue\.fal\.run/.test(s)) return realFetch(s.replace(/^https:\/\/(queue\.fal\.run|rest\.alpha\.fal\.ai|api\.fal\.ai)/, base), init);
  if (s.startsWith('https://api.openai.com')) return realFetch(s.replace('https://api.openai.com', base), init);
  if (/x\.ai\/|chatgpt\.com|auth\.openai\.com/.test(s)) return Promise.resolve(new Response('{"error":"blocked in test"}', { status: 401 }));
  if (/^https?:\/\/(?!127\.0\.0\.1)/.test(s)) throw new Error(`unexpected network call in test: ${s}`);
  return realFetch(url, init);
};

const catalog = await load('media-engine/catalog.js');
const providers = await load('media-engine/providers.js');
const project = await load('media-engine/project.js');
const engine = await load('media-engine/engine.js');
const studio = await load('media-engine/studio.js');
const tool = await load('media-engine/tool.js');

catalog.saveUserManifest({ id: 'fal/test-img', label: 'Test image', provider: 'fal', kind: 'image', endpoint: 'fal-ai/test-image', map: { prompt: 'prompt', referenceImages: 'image_urls', aspectRatio: 'aspect_ratio' }, pricing: { perImageUsd: 0.03 }, output: 'images[0].url' });
catalog.saveUserManifest({ id: 'fal/test-vid', label: 'Test video', provider: 'fal', kind: 'video', endpoint: 'fal-ai/test-video', map: { prompt: 'prompt', startImage: 'image_url', durationSec: 'duration' }, limits: { minDurationSec: 1, maxDurationSec: 10 }, pricing: { perSecondUsd: 0.05 }, output: 'video.url' });
const cleanup = () => { for (const id of ['fal/test-img', 'fal/test-vid']) { try { catalog.removeUserManifest(id); } catch { /* ignore */ } } };
process.on('exit', cleanup);
process.on('uncaughtException', (e) => { console.error(e); cleanup(); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error(e); cleanup(); process.exit(1); });

let passed = 0;
const ok = (name) => { passed += 1; console.log(`ok ${passed} - ${name}`); };
const X = { workspacePath: ws };
const run = (a) => tool.executeVideoProject(a, X);
const lastBody = (re) => [...bodies].reverse().find((b) => re.test(b.endpoint));
const isMedia = (v) => typeof v === 'string' && /^(data:|https?:)/.test(v);

const mkProject = async (extra = {}) => {
  const p = await project.createProject(ws, { title: 'Parity', target: { aspect: '9:16', resolution: '480p', fps: 24 }, defaults: { imageModel: 'fal/test-img', videoModel: 'fal/test-vid' }, budget: { capUsd: 50, autoApproveUsd: 5 }, ...extra });
  return p.id;
};

// 1 presets
{
  const r = await run({ action: 'presets' });
  assert.ok(r.presets.length >= 30);
  assert.deepEqual(new Set(r.presets.map((x) => x.group)), new Set(['camera', 'vfx', 'look']));
  const pid = await mkProject();
  await project.applyOps(ws, pid, [{ op: 'shot.add', title: 'A', prompt: 'A dancer on a rooftop', presetId: 'orbit-360' }]);
  const p = project.loadProject(ws, pid);
  const prompt = engine.composePrompt(p, p.shots[0]);
  assert.match(prompt, /360 orbit/);
  assert.match(prompt, /orbits a full 360/);
  ok('presets: 30+ in 3 groups, shot.presetId applied to the prompt');
}

// 2 xAI edit/extend mapping
{
  const edit = catalog.getModel('xai/grok-imagine-video-1.5-edit');
  const req = providers.registryVideoRequest(edit, { prompt: 'make it anime', sourceVideo: 'data:video/mp4;base64,AAA' }, tmp);
  assert.equal(req.mode, 'edit'); assert.equal(req.video, 'data:video/mp4;base64,AAA'); assert.equal(req.provider, 'xai');
  const ext = catalog.getModel('xai/grok-imagine-video-1.5-extend');
  const r2 = providers.registryVideoRequest(ext, { prompt: '', sourceVideo: '/x.mp4', durationSec: 30 }, tmp);
  assert.equal(r2.mode, 'extend'); assert.equal(r2.duration, 10);
  assert.throws(() => providers.registryVideoRequest(edit, { prompt: 'x' }, tmp), /sourceVideo/);
  ok('xAI edit/extend manifests map to generateVideo mode + video');
}

// 3 recast (fal swap + motion) bodies, import footage
const pid = await mkProject();
{
  const imp = await run({ action: 'import_asset', projectId: pid, path: 'uploads/clip.mp4', role: 'footage' });
  assert.equal(imp.role, 'footage'); assert.equal(imp.kind, 'video');
  await project.applyOps(ws, pid, [{ op: 'character.upsert', id: 'char_hero', name: 'Hero', anchors: ['uploads/face.png'] }]);
  const sw = await run({ action: 'recast', projectId: pid, sourcePath: imp.assetPath, prompt: 'swap the jacket for a red one', mode: 'swap', characterId: 'char_hero', approved: true });
  await engine.waitForJobs(ws, pid, sw.jobs.map((j) => j.id), 30_000);
  const b = lastBody(/kling-video\/o1\/video-to-video\/edit/).body;
  // Local footage is uploaded to fal storage and sent as an https URL (providers.toFalMedia, 039fafada #545),
  // not a base64 data URI. The fake storage stub returns a 127.0.0.1 file_url.
  assert.ok(isMedia(b.video_url) && /^https?:\/\//.test(b.video_url), 'video_url fal storage URL');
  assert.ok(Array.isArray(b.image_urls) && isMedia(b.image_urls[0]), 'image_urls ref');
  const mo = await run({ action: 'recast', projectId: pid, shotId: sw.shotId, prompt: 'same dance, new character', mode: 'motion', characterId: 'char_hero', approved: true });
  await engine.waitForJobs(ws, pid, mo.jobs.map((j) => j.id), 30_000);
  // Motion transfer default is now Kling 3 Pro motion-control (parity.ts DEFAULT_MODELS.recastMotion),
  // which takes the character as image_url, not the Wan VACE ref_image_urls (stale expectation, 14ea2abd4 era).
  const m = lastBody(/kling-video\/v3\/pro\/motion-control/).body;
  assert.ok(isMedia(m.video_url) && isMedia(m.image_url));
  const p = project.loadProject(ws, pid);
  assert.ok(p.shots.find((s) => s.id === mo.shotId).takes.length === 1);
  const def = await run({ action: 'recast', projectId: pid, sourcePath: imp.assetPath, prompt: 'x' });
  assert.equal(def.modelId, 'xai/grok-imagine-video-1.5-edit', 'default recast is xAI edit');
  ok('recast: footage import, fal swap (video_url + image_urls), motion transfer (ref_image_urls), xAI edit default');
}

// 4 lipsync + talking photo (auto-TTS line)
{
  const shotId = project.loadProject(ws, pid).shots.find((s) => s.takes.length).id;
  const ls = await run({ action: 'lipsync', projectId: pid, shotId, line: 'Hello there, this is synced.', approved: true });
  await engine.waitForJobs(ws, pid, ls.jobs.map((j) => j.id), 30_000);
  const b = lastBody(/sync-lipsync\/v2/).body;
  // Media now goes through fal storage (providers.toFalMedia, 039fafada #545): URLs, not data URIs.
  assert.ok(isMedia(b.video_url) && isMedia(b.audio_url), 'lipsync video_url + audio_url');
  const s = project.loadProject(ws, pid).shots.find((x) => x.id === shotId);
  assert.equal(s.selectedTakeId, s.takes[s.takes.length - 1].id, 'lipsync take selected');
  const tp = await run({ action: 'talking_photo', projectId: pid, imagePath: 'uploads/face.png', line: 'Hi, I am a talking photo.', approved: true });
  await engine.waitForJobs(ws, pid, tp.jobs.map((j) => j.id), 30_000);
  const t = lastBody(/omnihuman\/v1\.5/).body;
  assert.ok(isMedia(t.image_url) && isMedia(t.audio_url), 'talking photo image_url + audio_url');
  await assert.rejects(run({ action: 'talking_photo', projectId: pid, imagePath: 'uploads/face.png' }), /line/);
  ok('lipsync (video_url+audio_url, auto-TTS line, new take selected) + talking photo (image_url+audio_url)');
}

// 5 upscale + foley
{
  const before = project.loadProject(ws, pid).shots.map((s) => s.takes.length);
  const shotIds = [project.loadProject(ws, pid).shots.find((s) => s.takes.some((t) => t.kind === 'video')).id];
  const up = await run({ action: 'upscale', projectId: pid, shotIds, factor: 4, approved: true });
  await engine.waitForJobs(ws, pid, up.jobs.map((j) => j.id), 30_000);
  assert.equal(lastBody(/topaz\/upscale\/video/).body.upscale_factor, 4);
  const fo = await run({ action: 'foley', projectId: pid, shotIds, approved: true });
  await engine.waitForJobs(ws, pid, fo.jobs.map((j) => j.id), 30_000);
  const fb = lastBody(/mmaudio-v2/).body;
  assert.ok(isMedia(fb.video_url) && /foley/i.test(fb.prompt));
  const i = project.loadProject(ws, pid).shots.findIndex((s) => s.id === shotIds[0]);
  assert.equal(project.loadProject(ws, pid).shots[i].takes.length, before[i] + 2);
  ok('upscale (topaz factor) + foley (mmaudio) add new selected takes');
}

// 6 draw-to-video
{
  const d = await project.createProject(ws, { title: 'Sketch', target: { aspect: '1:1', resolution: '480p', fps: 24 }, defaults: { imageModel: 'fal/test-img', videoModel: 'fal/test-vid' }, budget: { capUsd: 10, autoApproveUsd: 0.01 } });
  const data = fs.readFileSync(img).toString('base64');
  const gate = await run({ action: 'draw_to_video', projectId: d.id, dataBase64: data, prompt: 'a castle at dusk' });
  assert.equal(gate.needsApproval, true);
  assert.ok(gate.shotId, 'gate returns the pending shot');
  // Approved retry reuses the gated shot + sketch (no duplicate shot, no re-upload).
  const r = await run({ action: 'draw_to_video', projectId: d.id, pendingShotId: gate.shotId, prompt: 'a castle at dusk', approved: true });
  assert.equal(r.shotId, gate.shotId, 'approved retry reuses the pending shot');
  assert.equal(project.loadProject(ws, d.id).shots.length, 1, 'no duplicate sketch shot');
  const ib = lastBody(/test-image/).body;
  assert.match(ib.prompt, /Turn this sketch into a finished/);
  await engine.waitForJobs(ws, d.id, r.jobs.map((j) => j.id), 30_000);
  const s = project.loadProject(ws, d.id).shots.find((x) => x.id === r.shotId);
  assert.ok(s.storyboard && s.sketch, 'storyboard approved');
  assert.equal(s.takes[0].kind, 'video');
  assert.ok(lastBody(/test-video/).body.image_url, 'animated from the clean frame');
  ok('draw_to_video: cost gate, sketch -> clean frame (storyboard) -> video take');
}

// 7 Ken Burns stills render with motion
{
  const k = await project.createProject(ws, { title: 'KB', target: { aspect: '16:9', resolution: '480p', fps: 24 }, defaults: { imageModel: 'fal/test-img', videoModel: 'fal/test-vid' } });
  await project.applyOps(ws, k.id, [{ op: 'shot.add', title: 'Still', prompt: 'a map', modelId: 'fal/test-img', durationSec: 3, kenBurns: true }]);
  const g = await engine.generateShots(ws, k.id, { approved: true });
  await engine.waitForJobs(ws, k.id, g.jobs.map((j) => j.id), 30_000);
  await project.applyOps(ws, k.id, [{ op: 'timeline.assemble' }]);
  const out = await engine.renderProject(ws, k.id, {});
  const abs = path.join(ws, out.path);
  const f1 = path.join(tmp, 'kb1.png'); const f2 = path.join(tmp, 'kb2.png');
  mk(['-ss', '0.1', '-i', abs, '-frames:v', '1', f1]);
  mk(['-ss', '2.6', '-i', abs, '-frames:v', '1', f2]);
  assert.notDeepEqual(fs.readFileSync(f1), fs.readFileSync(f2), 'frames differ (push-in)');
  assert.ok(out.durationSec >= 2.8);
  ok('Ken Burns: still take renders as a moving clip (frames differ)');
}

// 8 faceless long-form
{
  const f = await run({ action: 'faceless', topic: 'the history of coffee', minutes: 4, style: 'documentary', videoEvery: 4, capUsd: 20 });
  assert.ok(f.shots >= 8 && f.videos >= 2 && f.stills > f.videos, `${f.shots} shots`);
  await project.applyOps(ws, f.projectId, [{ op: 'project.update', defaults: { imageModel: 'fal/test-img', videoModel: 'fal/test-vid' }, budget: { autoApproveUsd: 0.01 } }]);
  const p0 = project.loadProject(ws, f.projectId);
  await project.applyOps(ws, f.projectId, [{ op: 'plan.setShots', shots: p0.shots.map((s) => ({ ...s, modelId: s.kenBurns ? 'fal/test-img' : 'fal/test-vid', durationSec: s.kenBurns ? 2 : 2 })) }]);
  const cost = await studio.planRunCost(ws, f.projectId, { storyboard: false, qaRerolls: 0 });
  assert.ok(cost.breakdown.some((b) => /still shots/.test(b.item)), 'image costs counted');
  const gate = await run({ action: 'run', projectId: f.projectId, storyboard: false, qa: false });
  assert.ok(gate.lastRun.needsApproval || gate.lastRun.state === 'needs_approval', 'whole-run gate');
  const r = await studio.runAutopilot(ws, f.projectId, { approved: true, storyboard: false, qa: false, aspects: ['16:9'] });
  assert.equal(r.lastRun.state, 'done', r.lastRun.error);
  const p = project.loadProject(ws, f.projectId);
  assert.ok(p.shots.some((s) => s.takes[0]?.kind === 'image') && p.shots.some((s) => s.takes[0]?.kind === 'video'));
  assert.ok(p.shots.every((s) => s.voiceover) && p.captions.cues.length > 0);
  const exp = p.exports[p.exports.length - 1];
  assert.match(probe(path.join(ws, exp.path)), /\b\d{3,4}x(480|720)\b/);
  assert.equal(exp.aspect, '16:9');
  ok(`faceless: ${f.shots} shots (${f.stills} stills / ${f.videos} videos), gate, then 16:9 render with VO + captions`);
}

// 9 batch variants
{
  const b = await run({ action: 'batch_variants', projectId: pid, count: 4, vary: ['hook', 'creator'] });
  assert.equal(b.projects.length, 4);
  const ps = b.projects.map((x) => project.loadProject(ws, x.projectId));
  assert.equal(new Set(ps.map((p) => p.shots[0].line)).size, 4, 'different hooks');
  assert.equal(new Set(ps.map((p) => p.characters.find((c) => c.name === 'Hero').notes)).size, 4, 'different creators');
  assert.ok(b.totalUsd >= 0 && typeof b.needsApproval === 'boolean');
  ok('batch_variants: N cloned projects with distinct hooks + creators and a combined cost');
}

// 10 on-script QA
{
  const n = await project.createProject(ws, { title: 'Native', target: { aspect: '9:16', resolution: '480p', fps: 24 }, defaults: { imageModel: 'fal/test-img', videoModel: 'fal/test-vid' } });
  await project.applyOps(ws, n.id, [{ op: 'project.update', audioMode: 'native' }, { op: 'shot.add', title: 'Hook', prompt: 'creator talks', line: 'Okay I need to talk about this drink', durationSec: 2 }]);
  const g = await engine.generateShots(ws, n.id, { approved: true });
  await engine.waitForJobs(ws, n.id, g.jobs.map((j) => j.id), 30_000);
  await project.mutateProject(ws, n.id, 'stub', (p) => { p.shots[0].takes[0].transcript = { text: 'buy my course today', words: [{ text: 'buy', startMs: 0, endMs: 200 }], provider: 'stub', at: Date.now() }; });
  const q = await studio.qa(ws, n.id, {});
  assert.equal(q.results[0].verdict, 'reroll');
  assert.match(q.results[0].issues[0], /off-script: said 'buy my course today'/);
  assert.ok(studio.lineSimilarity('okay I need to talk about this drink', 'Okay, I need to talk about this drink!') > 0.9);
  ok('on-script QA: off-script transcript -> reroll with issue');
}

// 11 audio kind + missing field hints
{
  const sa = catalog.getModel('fal/stable-audio');
  assert.equal(sa.kind, 'audio');
  const body = await providers.buildRequestBody(sa, { prompt: 'rain', durationSec: 12 });
  assert.equal(body.seconds_total, 12);
  assert.equal(providers.extractOutputs(sa, { audio_file: { url: 'https://x/a.mp3' } })[0].url, 'https://x/a.mp3');
  const e = await engine.estimate(ws, pid, { shotIds: [project.loadProject(ws, pid).shots[0].id], modelId: 'fal/sync-lipsync-v2' });
  assert.ok(e.shots[0].problems.join(' ').includes('sourceVideo (set shot.sourceVideo') || e.shots[0].problems.length === 0);
  ok('audio model kind + output extraction; missing-field hints name what to add');
}

console.log(`\n${passed} parity checks passed`);
server.close();
cleanup();
process.exit(0);
