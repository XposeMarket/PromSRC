// Regression: Games mode (game_project) end-to-end against local fakes. No money spent:
// the image provider is replaced via setGameImageGenerator with an ffmpeg-made magenta PNG.
// Covers: create/questions/design, per-genre plans, cost gate + cap, generate -> chroma key
// (rgba), approve/reject, audio gate + procedural sfx/music, scaffold build, play route
// (MIME + traversal), SSE room relay A -> B, tool capabilities + registration.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const load = (rel) => import(pathToFileURL(path.join(root, 'dist', rel)).href);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-games-'));
const ws = path.join(tmp, 'workspace');
fs.mkdirSync(ws, { recursive: true });
let passed = 0;
const ok = (msg) => { passed++; console.log(`ok - ${msg}`); };

const deps = await load('runtime/dependencies.js');
const ffmpegBin = deps.resolveRuntimeBinary('ffmpeg', { allowPathFallback: true });
const probe = (abs) => spawnSync(ffmpegBin, ['-hide_banner', '-i', abs], { encoding: 'utf8' }).stderr;

const tool = await load('games-engine/tool.js');
const assets = await load('games-engine/assets.js');
const project = await load('games-engine/project.js');
const run = (args) => tool.executeGameProject(args, { workspacePath: ws });

// Fake provider: magenta background with a yellow square "sprite" in the middle.
let fakeCalls = 0;
assets.setGameImageGenerator(async ({ outDir, baseName, size }) => {
  fakeCalls++;
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${baseName}.png`);
  const r = spawnSync(ffmpegBin, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0xFF00FF:size=256x256',
    '-vf', 'drawbox=x=80:y=80:w=96:h=96:color=yellow:t=fill', '-frames:v', '1', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return out;
});

// 1. create + questions + design
const created = await run({ action: 'create', title: 'Neon Hopper', pitch: 'Hop across neon rooftops', genre: 'platformer', style: 'pixel', setting: 'cyberpunk city', multiplayer: true });
const id = created.id;
assert.match(id, /^gp_/);
assert.equal(created.design.engine, 'canvas2d');
assert.ok(created.questions.length >= 4 && created.questions.every((q) => q.options.length >= 2));
assert.ok(created.questions.some((q) => q.id === 'mp_mode'));
assert.ok(created.chatCard.includes('game-project'));
const qs = await run({ action: 'questions', projectId: id });
assert.equal(qs.questions.length, created.questions.length);
const designed = await run({ action: 'design', projectId: id, controls: 'arrows + space', coreLoop: 'jump, collect, avoid', winLose: 'reach flag / fall', answers: { movement: 'Tight precise jumps', goal: 'Reach the flag' } });
assert.equal(designed.design.controls, 'arrows + space');
assert.equal(designed.questions.find((q) => q.id === 'movement').answer, 'Tight precise jumps');
const three = await run({ action: 'create', title: 'Cube', genre: 'racing', style: 'voxel' });
assert.equal(three.design.engine, 'three');
ok('create + questions + design (engine defaults, multiplayer question)');

// 2. plan per genre
const expect = { platformer: ['player', 'enemy', 'tileset', 'background', 'coin', 'heart'], shooter: ['player', 'enemy1', 'enemy2', 'bullet', 'explosion', 'background'], racing: ['car', 'track', 'background'], novella: 6, horror: ['player', 'monster', 'tileset', 'background'], hypercasual: ['player', 'obstacle', 'background'] };
for (const [genre, want] of Object.entries(expect)) {
  const plan = assets.planAssets(project.normalizeDesign({ genre, style: 'minimal', setting: 'moon base' }));
  if (typeof want === 'number') assert.equal(plan.length, want); else assert.deepEqual(plan.map((a) => a.name), want);
  assert.ok(plan.every((a) => a.prompt.includes('clean minimal flat vector') && a.prompt.includes('moon base')));
  assert.ok(plan.filter((a) => a.kind === 'sprite').every((a) => a.transparent && /#FF00FF/.test(a.prompt)));
}
const planned = await run({ action: 'plan_assets', projectId: id });
assert.equal(planned.prompts.length, 6);
assert.ok(planned.prompts.every((p) => p.prompt.includes('16-bit pixel art')));
ok('plan_assets per genre with consistent style words + magenta sprites');

// 3. cost gate + cap
const est = await run({ action: 'estimate', projectId: id });
assert.ok(est.total > 0 && est.breakdown.length === 6);
await run({ action: 'design', projectId: id, autoApproveUsd: 0.01 });
const gated = await run({ action: 'generate_assets', projectId: id });
assert.equal(gated.needsApproval, true);
assert.ok(gated.usd > 0.01 && gated.started.length === 0);
await run({ action: 'design', projectId: id, capUsd: 0.05 });
const capped = await run({ action: 'generate_assets', projectId: id, approved: true });
assert.equal(capped.blocked, true);
assert.equal(fakeCalls, 0);
await run({ action: 'design', projectId: id, capUsd: 0 });
ok('cost gate needsApproval + cap hard stop (no provider calls)');

// 4. generate with fake provider -> chroma key
const gen = await tool.executeGameProject({ action: 'generate_assets', projectId: id, approved: true, wait: true }, { workspacePath: ws });
assert.equal(gen.started.length, 6);
let p = project.loadGame(ws, id);
assert.ok(p.assets.filter((a) => a.kind !== 'sfx').every((a) => a.status === 'candidate' && a.path), JSON.stringify(p.assets.map((a) => [a.name, a.status, a.error])));
assert.equal(p.stage, 'art');
assert.ok(p.budget.spentUsd > 0);
const player = p.assets.find((a) => a.name === 'player');
const playerAbs = path.join(ws, player.path);
assert.equal(await assets.imagePixFmt(playerAbs), 'rgba');
assert.match(probe(playerAbs), /128x128/);
// Corner pixel must be fully transparent, centre opaque.
const px = (x, y) => spawnSync(ffmpegBin, ['-hide_banner', '-loglevel', 'error', '-i', playerAbs, '-vf', `crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { encoding: 'buffer' }).stdout;
assert.equal(px(0, 0)[3], 0, 'corner alpha');
assert.equal(px(64, 64)[3], 255, 'centre alpha');
const bg = p.assets.find((a) => a.name === 'background');
assert.match(probe(path.join(ws, bg.path)), /1280x720/);
ok('generate_assets (fake provider) -> magenta chroma key -> PNG rgba with transparent corners');

// 5. approve / reject + audio gate
await assert.rejects(run({ action: 'sfx', projectId: id }), /art stage approved/);
for (const a of p.assets) if (a.name !== 'heart') await run({ action: 'approve_asset', projectId: id, assetId: a.id });
await run({ action: 'reject_asset', projectId: id, assetId: 'heart' });
p = project.loadGame(ws, id);
assert.equal(p.assets.find((a) => a.name === 'heart').status, 'rejected');
assert.equal(p.assets.filter((a) => a.status === 'approved').length, 5);
ok('approve/reject + audio stage gated on art approval');

// 6. sfx + music
const sfx = await run({ action: 'sfx', projectId: id });
assert.equal(sfx.sfx.length, 7);
for (const s of sfx.sfx) {
  const abs = path.join(ws, s.path);
  assert.ok(fs.statSync(abs).size > 500, `${s.name} size`);
  assert.ok(s.durationSec > 0, `${s.name} duration`);
}
const music = await run({ action: 'music', projectId: id, seconds: 8 });
assert.ok(music.music.durationSec > 0 && fs.statSync(path.join(ws, music.music.path)).size > 1000);
assert.equal(project.loadGame(ws, id).stage, 'audio');
ok(`sfx (${sfx.sfx.map((s) => `${s.name}:${s.durationSec.toFixed(2)}s`).join(', ')}) + music bed`);

// 7. scaffold
const sc = await run({ action: 'scaffold', projectId: id });
const buildDir = path.join(ws, sc.buildDir);
for (const f of ['index.html', 'game.js', 'assets.js', 'mp.js', 'assets/player.png', 'assets/background.png', 'audio/jump.wav', 'audio/music.mp3']) assert.ok(fs.existsSync(path.join(buildDir, f)), f);
assert.ok(!fs.existsSync(path.join(buildDir, 'assets/heart.png')), 'rejected asset not copied');
for (const f of ['game.js', 'assets.js', 'mp.js']) {
  const tmpMjs = path.join(tmp, `check_${f}.mjs`);
  fs.copyFileSync(path.join(buildDir, f), tmpMjs);
  const r = spawnSync(process.execPath, ['--check', tmpMjs], { encoding: 'utf8' });
  assert.equal(r.status, 0, `${f}: ${r.stderr}`);
}
const manifestMod = await import(pathToFileURL(path.join(buildDir, 'assets.js')).href);
assert.equal(manifestMod.MANIFEST.images.player, 'assets/player.png');
assert.equal(manifestMod.MANIFEST.audio.jump, 'audio/jump.wav');
fs.appendFileSync(path.join(buildDir, 'game.js'), '\n// agent edit\n');
const sc2 = await run({ action: 'scaffold', projectId: id });
assert.ok(sc2.kept.includes('game.js') && fs.readFileSync(path.join(buildDir, 'game.js'), 'utf8').includes('// agent edit'));
assert.equal(project.loadGame(ws, id).stage, 'playable');
const tsc = await run({ action: 'plan_assets', projectId: three.id });
await run({ action: 'scaffold', projectId: three.id });
const threeJs = path.join(ws, 'game-projects', three.id, 'build', 'game.js');
const threeTmp = path.join(tmp, 'three_game.mjs'); fs.copyFileSync(threeJs, threeTmp);
assert.equal(spawnSync(process.execPath, ['--check', threeTmp]).status, 0);
assert.ok(fs.readFileSync(path.join(ws, 'game-projects', three.id, 'build', 'index.html'), 'utf8').includes('unpkg.com/three@0.160.0'));
assert.ok(tsc.prompts.length === 3);
ok('scaffold writes loadable canvas2d + three builds, copies approved assets, keeps agent game.js');

// 8. routes: play static + traversal + action + room relay
const express = (await import(pathToFileURL(path.join(root, 'node_modules/express/index.js')).href)).default;
const { registerGameProjectRoutes } = await load('gateway/routes/game-project.routes.js');
const app = express();
app.use(express.json());
registerGameProjectRoutes(app, { workspaceFor: () => ws, auth: false });
const server = http.createServer(app);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
fs.writeFileSync(path.join(ws, 'game-projects', 'secret.txt'), 'nope');
const idx = await fetch(`${base}/api/game-projects/${id}/play/`);
assert.equal(idx.status, 200);
assert.match(idx.headers.get('content-type'), /text\/html/);
assert.match(await idx.text(), /game\.js/);
const js = await fetch(`${base}/api/game-projects/${id}/play/game.js`);
assert.match(js.headers.get('content-type'), /javascript/);
const png = await fetch(`${base}/api/game-projects/${id}/play/assets/player.png`);
assert.equal(png.headers.get('content-type'), 'image/png');
const rawGet = (p) => new Promise((resolve) => http.get({ host: '127.0.0.1', port: server.address().port, path: p }, (res) => { res.resume(); resolve(res.statusCode); }));
for (const bad of [`/api/game-projects/${id}/play/../game.json`, `/api/game-projects/${id}/play/..%2f..%2fsecret.txt`, `/api/game-projects/${id}/play/%2e%2e/%2e%2e/secret.txt`, `/api/game-projects/${id}/play/assets/..%5c..%5cgame.json`]) {
  const code = await rawGet(bad);
  assert.ok(code === 400 || code === 404, `${bad} -> ${code}`);
}
const act = await (await fetch(`${base}/api/game-projects/${id}/action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'publish', deploy: false }) })).json();
assert.equal(act.success, true);
assert.ok(act.localUrl.endsWith(`/api/game-projects/${id}/play/`) && act.room === id);
const got = await (await fetch(`${base}/api/game-projects/${id}`)).json();
assert.equal(got.project.publish.localUrl, act.localUrl);
ok('play route serves text/html + MIME, blocks ../ traversal; action route publishes local URL');

function sse(room) {
  const events = [];
  const waiters = [];
  const req = http.get(`${base}/api/game-rooms/${room}/events`, (res) => {
    let buf = '';
    res.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        const m = JSON.parse(line.slice(6));
        events.push(m);
        waiters.splice(0).forEach((w) => w());
      }
    });
  });
  const waitFor = async (pred, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const m = events.find(pred); if (m) return m; await new Promise((r) => { waiters.push(r); setTimeout(r, 100); }); }
    throw new Error('timeout waiting for room event');
  };
  return { events, waitFor, close: () => req.destroy() };
}
const A = sse('lobby1');
const aw = await A.waitFor((m) => m.type === 'welcome');
const B = sse('lobby1');
const bw = await B.waitFor((m) => m.type === 'welcome');
assert.deepEqual(bw.players, [aw.playerId]);
await A.waitFor((m) => m.type === 'join' && m.playerId === bw.playerId);
const sent = await (await fetch(`${base}/api/game-rooms/lobby1/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ playerId: aw.playerId, data: { x: 42, y: 7 } }) })).json();
assert.equal(sent.delivered, 1);
const st = await B.waitFor((m) => m.type === 'state');
assert.equal(st.from, aw.playerId);
assert.deepEqual(st.data, { x: 42, y: 7 });
assert.ok(!A.events.some((m) => m.type === 'state'), 'sender does not get echo');
// Public relay limits: oversized payloads and floods are refused.
const big = await fetch(`${base}/api/game-rooms/lobby1/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ playerId: aw.playerId, data: 'x'.repeat(20000) }) });
assert.ok(!(await big.json()).success, 'oversized message rejected');
let limited = false;
for (let i = 0; i < 200 && !limited; i++) {
  const r = await (await fetch(`${base}/api/game-rooms/lobby1/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ playerId: aw.playerId, data: i }) })).json();
  if (!r.success && /rate limit/i.test(String(r.error))) limited = true;
}
assert.ok(limited, 'per-player rate limit kicks in');
B.close();
await A.waitFor((m) => m.type === 'leave' && m.playerId === bw.playerId);
A.close();
ok('room relay: A -> B state delivery, join/leave presence, no echo, size cap + rate limit');
server.close();

// 9. registration + capabilities
const caps = await load('gateway/tool-capabilities.js');
const cap = (action) => caps.resolveToolCapabilityMetadata('game_project', undefined, { action });
const capGet = cap('get'); const capGen = cap('generate_assets'); const capDel = cap('delete'); const capSfx = cap('sfx');
assert.notDeepEqual(capGet, capGen);
assert.notDeepEqual(capDel, capSfx);
assert.deepEqual(cap('reroll_asset'), capGen);
assert.deepEqual(cap('estimate'), capGet);
const defs = await load('gateway/tools/defs/file-web-memory.js');
const def = defs.getFileWebMemoryTools().find((t) => t.function?.name === 'game_project');
assert.ok(def && /questions -> design/.test(def.function.description) && /build\/game\.js/.test(def.function.description));
const src = (f) => fs.readFileSync(path.join(root, f), 'utf8');
for (const f of ['src/gateway/tool-builder.ts', 'src/runtime/tool-category-manifest.ts', 'src/gateway/tool-category-provisioning.ts', 'src/gateway/prompt-context.ts', 'src/gateway/agents-runtime/capabilities/web-media-executor.ts']) assert.ok(src(f).includes('game_project'), f);
assert.ok(src('web-ui/src/utils.js').includes('installGameProjectCards'));
ok('tool registered in all surfaces; capabilities read/paid/destructive/local');

assets.setGameImageGenerator(null);
await run({ action: 'delete', projectId: three.id });
assert.equal(project.listGames(ws).length, 1);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} game project checks passed (fake provider calls: ${fakeCalls}, $0 spent)`);
process.exit(0);
