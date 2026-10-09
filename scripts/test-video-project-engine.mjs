// Regression: generative video engine (catalog, ops/undo, queue provider, job
// runner, layered render) against a local fake fal/Higgsfield queue server.
// No real provider calls, no money spent.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const load = (rel) => import(pathToFileURL(path.join(root, 'dist', rel)).href);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-vp-'));
const ws = path.join(tmp, 'workspace');
fs.mkdirSync(ws, { recursive: true });

const catalog = await load('media-engine/catalog.js');
const providers = await load('media-engine/providers.js');
const project = await load('media-engine/project.js');
const engine = await load('media-engine/engine.js');
const tool = await load('media-engine/tool.js');
const deps = await load('runtime/dependencies.js');
const ffmpegBin = deps.resolveRuntimeBinary('ffmpeg', { allowPathFallback: true });

let passed = 0;
const ok = (name) => { passed += 1; console.log(`ok ${passed} - ${name}`); };

// ── catalog ──
{
  const all = catalog.listModels();
  for (const p of ['xai', 'openai', 'fal', 'higgsfield']) assert.ok(all.some((m) => m.provider === p), `catalog has ${p}`);
  assert.equal(catalog.getModel('xai/grok-imagine-video-1.5').kind, 'video');
  const kling = catalog.getModel('fal/kling-v2.1-master-i2v');
  assert.equal(catalog.clampDuration(kling, 7), 5);
  assert.equal(catalog.clampDuration(kling, 9), 10);
  assert.equal(catalog.estimateCostUsd(kling, { durationSec: 10, count: 2 }), 5.6);
  const body = await providers.buildRequestBody(kling, { prompt: 'p', startImage: 'https://x/a.png', durationSec: 8 });
  assert.deepEqual(body, { prompt: 'p', image_url: 'https://x/a.png', duration: '10' });
  assert.deepEqual(providers.missingRequiredFields(kling, { prompt: 'p' }), ['startImage']);
  assert.equal(catalog.toRatio('portrait'), '9:16');
  ok('catalog manifests, duration snapping, pricing, field mapping');
}

// ── fake media + fake queue server ──
const clipA = path.join(tmp, 'a.mp4');
const clipB = path.join(tmp, 'b.mp4');
const still = path.join(tmp, 'still.png');
const mk = (args) => { const r = spawnSync(ffmpegBin, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
mk(['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=24:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clipA]);
mk(['-f', 'lavfi', '-i', 'color=c=red:size=320x180:rate=24:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clipB]);
mk(['-f', 'lavfi', '-i', 'color=c=blue:size=64x64', '-frames:v', '1', still]);

const requests = [];
let polls = 0;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    requests.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: String(req.headers['content-type'] || '').includes('application/json') && body ? JSON.parse(body) : null });
    const base = `http://127.0.0.1:${server.address().port}`;
    // fal CDN storage upload (providers.uploadToFalStorage, added in 039fafada #545) and the
    // balance preflight (balance.ts, c64214fbc #601) are served locally too: no real fal host, no key check.
    if (req.url.startsWith('/storage/upload/initiate')) {
      res.end(JSON.stringify({ upload_url: `${base}/storage/put/up1`, file_url: `${base}/storage/files/up1.png` }));
    } else if (req.method === 'PUT' && req.url.startsWith('/storage/put/')) {
      res.end('');
    } else if (req.url.startsWith('/v1/account/billing')) {
      res.end(JSON.stringify({ credits: { current_balance: 50 } }));
    } else if (req.method === 'POST' && req.url.startsWith('/fal-ai/')) {
      const id = `req${requests.length}`;
      res.end(JSON.stringify({ request_id: id, status_url: `${base}/status/${id}`, response_url: `${base}/result/${id}` }));
    } else if (req.url.startsWith('/status/')) {
      polls += 1;
      res.end(JSON.stringify({ status: polls % 2 ? 'IN_PROGRESS' : 'COMPLETED' }));
    } else if (req.url.startsWith('/result/')) {
      res.end(JSON.stringify({ video: { url: `${base}/media/b.mp4` } }));
    } else if (req.url === '/media/b.mp4') {
      res.setHeader('content-type', 'video/mp4');
      res.end(fs.readFileSync(clipB));
    } else { res.statusCode = 404; res.end('{}'); }
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// Point the fal transport at the fake queue by registering a user manifest whose
// endpoint is served by the fake: we monkeypatch QUEUE via env-free approach —
// the transport builds `${QUEUE_BASE}/${endpoint}`, so use fetch interception.
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => realFetch(String(url).replace(/^https:\/\/(queue\.fal\.run|rest\.alpha\.fal\.ai|api\.fal\.ai)/, base), init);
process.env.FAL_KEY = 'test-key-123';

// ── project ops + undo ──
const p0 = await project.createProject(ws, { title: 'Coffee ad', brief: '3 shots', target: { aspect: '16:9', resolution: '480p', fps: 24 }, budget: { autoApproveUsd: 0.5 } });
const pid = p0.id;
fs.mkdirSync(path.join(ws, 'refs'), { recursive: true });
fs.copyFileSync(still, path.join(ws, 'refs', 'mia.png'));
let r = await project.applyOps(ws, pid, [
  { op: 'character.upsert', id: 'char_mia', name: 'Mia', anchors: ['refs/mia.png'], notes: 'barista with green apron' },
  { op: 'plan.setShots', shots: [
    { id: 'shot_one', title: 'Pour', prompt: 'latte art pour', durationSec: 5, characterIds: ['char_mia'], modelId: 'fal/kling-v2.1-master-i2v' },
    { id: 'shot_two', title: 'Smile', prompt: 'she smiles', durationSec: 5, chainFromPrevious: true, modelId: 'fal/kling-v2.1-master-i2v' },
  ] },
]);
assert.equal(r.project.shots.length, 2);
await project.applyOps(ws, pid, [{ op: 'shot.update', id: 'shot_two', prompt: 'she smiles, moodier' }]);
let u = await project.undoRedo(ws, pid, 'undo');
assert.equal(u.project.shots[1].prompt, 'she smiles');
u = await project.undoRedo(ws, pid, 'redo');
assert.equal(u.project.shots[1].prompt, 'she smiles, moodier');
await assert.rejects(project.applyOps(ws, pid, [{ op: 'shot.update', id: 'shot_two', prompt: 'x' }, { op: 'nope' }]), /No changes were applied/);
assert.equal(project.loadProject(ws, pid).shots[1].prompt, 'she smiles, moodier');
ok('ops apply atomically, undo/redo round-trips, failed batch leaves project untouched');

// ── estimate + cost gate ──
const est = await engine.estimate(ws, pid, { shotIds: ['shot_one'] });
assert.equal(est.total, 1.4);
assert.deepEqual(est.shots[0].problems, []);
const gated = await engine.generateShots(ws, pid, { shotIds: ['shot_one'] });
assert.equal(gated.needsApproval, true);
assert.equal(gated.jobs.length, 0);
ok('estimate uses manifest pricing; generate above auto-approve returns needsApproval');

// ── generate via fake fal queue ──
const gen = await engine.generateShots(ws, pid, { shotIds: ['shot_one'], approved: true });
assert.equal(gen.jobs.length, 1);
const settled = await engine.waitForJobs(ws, pid, [gen.jobs[0].id], 60_000);
assert.equal(settled[0].state, 'done', settled[0].error);
const submitReq = requests.find((x) => x.method === 'POST' && x.url.startsWith('/fal-ai/'));
assert.equal(submitReq.auth, 'Key test-key-123');
assert.equal(submitReq.url, '/fal-ai/kling-video/v2.1/master/image-to-video');
assert.match(submitReq.body.image_url, /^http:\/\/127\.0\.0\.1:\d+\/storage\/files\//, 'character anchor is uploaded to fal storage and sent as the identity start frame');
assert.equal(submitReq.body.duration, '5');
assert.match(submitReq.body.prompt, /barista with green apron/);
let p = project.loadProject(ws, pid);
assert.equal(p.shots[0].takes.length, 1);
assert.equal(p.shots[0].status, 'ready');
assert.ok(fs.existsSync(path.join(ws, p.shots[0].takes[0].path)));
assert.equal(p.budget.spentUsd, 1.4);
ok('fal queue submit -> poll -> result -> take saved, anchor used as start frame, spend tracked');

// ── chaining: shot two starts from shot one's last frame ──
const gen2 = await engine.generateShots(ws, pid, { shotIds: ['shot_two'], approved: true });
const s2 = await engine.waitForJobs(ws, pid, [gen2.jobs[0].id], 60_000);
assert.equal(s2[0].state, 'done', s2[0].error);
const chainReq = requests.filter((x) => x.method === 'POST')[1];
// The last frame is now uploaded to fal storage (providers.toFalMedia, #545) and sent as an https URL, not a data URI.
assert.match(chainReq.body.image_url, /^http:\/\/127\.0\.0\.1:\d+\/storage\/files\//, 'previous shot last frame used');
ok('chainFromPrevious extracts the previous take last frame as the start image');

// ── undo does not delete paid takes ──
await project.applyOps(ws, pid, [{ op: 'shot.update', id: 'shot_one', title: 'Pour v2' }]);
await project.undoRedo(ws, pid, 'undo');
p = project.loadProject(ws, pid);
assert.equal(p.shots[0].takes.length, 1);
assert.equal(p.shots[1].takes.length, 1);
ok('undo keeps generated takes and spend');

// ── timeline + layered render ──
fs.copyFileSync(clipA, path.join(ws, 'refs', 'a.mp4'));
r = await project.applyOps(ws, pid, [
  { op: 'timeline.assemble' },
  { op: 'track.add', kind: 'overlay' },
]);
const overlayTrack = r.project.tracks.find((t) => t.kind === 'overlay');
r = await project.applyOps(ws, pid, [
  { op: 'clip.add', trackId: overlayTrack.id, assetPath: 'refs/a.mp4', startMs: 1000, durationMs: 1500 },
]);
const mainClip = r.project.clips.find((c) => 'shotId' in c.source && c.source.shotId === 'shot_one');
assert.equal(mainClip.outMs, 3000, 'clip length comes from the real take duration (3s)');
r = await project.applyOps(ws, pid, [{ op: 'clip.split', id: mainClip.id, atMs: 1500 }]);
assert.equal(r.project.clips.length, 4);
const out = await engine.renderProject(ws, pid, {});
const probe = spawnSync(ffmpegBin, ['-hide_banner', '-i', path.join(ws, out.path)], { encoding: 'utf8' });
assert.match(probe.stderr, /Video: h264/);
assert.match(probe.stderr, /Audio: aac/, 'overlay clip audio is mixed in');
assert.match(probe.stderr, /854x480/);
const dur = probe.stderr.match(/Duration: 00:00:(\d+\.\d+)/);
assert.ok(dur && Math.abs(Number(dur[1]) - 6) < 0.3, `duration ~6s, got ${dur && dur[1]}`);
const frame = await engine.renderFrame(ws, pid, 0.5);
assert.ok(fs.existsSync(path.join(ws, frame)));
ok('assemble + overlay track + split -> layered 854x480 MP4 with mixed audio');

// ── restart resume: a running queue job with a requestId is picked back up ──
await project.mutateProject(ws, pid, 'test', (proj) => {
  proj.jobs.push({ id: 'job_resume', target: { shotId: 'shot_one' }, modelId: 'fal/kling-v2.1-master-i2v', input: { prompt: 'x' }, count: 1, state: 'running', requestId: 'reqX', statusUrl: `${base}/status/reqX`, responseUrl: `${base}/result/reqX`, estimateUsd: 1.4, takeIds: [], createdAt: Date.now(), updatedAt: Date.now() });
  proj.jobs.push({ id: 'job_lost', target: { shotId: 'shot_two' }, modelId: 'xai/grok-imagine-video-1.5', input: { prompt: 'x' }, count: 1, state: 'running', estimateUsd: 0.4, takeIds: [], createdAt: Date.now(), updatedAt: Date.now() });
});
assert.equal(engine.resumeJobs(ws), 1);
const resumed = await engine.waitForJobs(ws, pid, ['job_resume', 'job_lost'], 60_000);
assert.equal(resumed.find((j) => j.id === 'job_resume').state, 'done');
assert.equal(resumed.find((j) => j.id === 'job_lost').state, 'failed');
assert.equal(project.loadProject(ws, pid).shots[0].takes.length, 2);
ok('restart resume polls queue jobs to completion and fails unresumable ones cleanly');

// ── tool surface ──
const summary = await tool.executeVideoProject({ action: 'get', projectId: pid }, { workspacePath: ws });
assert.equal(summary.shots.length, 2);
assert.ok(summary.shots[0].selectedTake);
const models = await tool.executeVideoProject({ action: 'models', provider: 'higgsfield' }, { workspacePath: ws });
assert.ok(models.count >= 5);
await assert.rejects(tool.executeVideoProject({ action: 'set_key', provider: 'higgsfield', apiKey: 'nocolon' }, { workspacePath: ws }), /key_id/);
const help = await tool.executeVideoProject({ action: 'help' }, { workspacePath: ws });
assert.ok(help.ops.includes('timeline.assemble'));
ok('video_project tool: get/models/help/set_key validation');

// ── capability gating ──
const caps = await load('gateway/tool-capabilities.js');
assert.equal(caps.resolveToolCapabilityMetadata('video_project', undefined, { action: 'get' }).readOnly, true);
assert.equal(caps.resolveToolCapabilityMetadata('video_project', undefined, { action: 'generate' }).externalWrite, true);
assert.equal(caps.resolveToolCapabilityMetadata('video_project', undefined, { action: 'set_key' }).externalWrite, true);
assert.equal(caps.resolveToolCapabilityMetadata('video_project', undefined, { action: 'apply_ops' }).localWrite, true);
ok('capabilities: reads read-only, paid generation + key storage gated as external writes');

// ── Higgsfield status vocabulary ──
{
  const hf = catalog.getModel('higgsfield/kling-v2.5-turbo-pro-i2v');
  const outputs = providers.extractOutputs(hf, { status: 'completed', video: { url: 'https://cdn/x.mp4' } });
  assert.deepEqual(outputs, [{ url: 'https://cdn/x.mp4' }]);
  const soul = catalog.getModel('higgsfield/soul-standard');
  assert.deepEqual(providers.extractOutputs(soul, { images: [{ url: 'https://cdn/a.png' }, { url: 'https://cdn/b.png' }] }).length, 2);
  ok('Higgsfield output extraction for video + multi-image payloads');
}

globalThis.fetch = realFetch;
server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed`);
process.exit(0);
