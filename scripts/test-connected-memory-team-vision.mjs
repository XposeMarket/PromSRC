// Synthetic-only StageD integration test: trusted team path (teamReferenceChat + runInTrace) -> buildReferenceObservationMessage.
// Isolated HOME/APPDATA/PROMETHEUS_* dirs and config.workspace under os.tmpdir(). No gateway, provider, team or user data.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto'; import { createRequire } from 'node:module';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-team-vision-'));
const home = path.join(root, 'home'); fs.mkdirSync(home, { recursive: true });
Object.assign(process.env, { HOME: home, USERPROFILE: home, APPDATA: path.join(root, 'appdata'), LOCALAPPDATA: path.join(root, 'local'), PROMETHEUS_CONFIG_DIR: path.join(root, 'config'), PROMETHEUS_DATA_DIR: path.join(root, 'data'), PROMETHEUS_HOME: path.join(root, 'prom-home') });
const require = createRequire(import.meta.url); require('tsx/cjs');
const { getConfig } = require('../src/config/config.ts');
const workspace = path.join(root, 'workspace'); fs.mkdirSync(workspace, { recursive: true }); getConfig().updateConfig({ workspace: { path: workspace } });
const sharp = require('sharp');
const { getReferenceService } = require('../src/gateway/resources/reference-service.ts');
const teams = require('../src/gateway/teams/managed-teams.ts');
const rt = require('../src/gateway/resources/reference-team-runtime.ts');
const { accessibleReferenceOpen } = require('../src/gateway/resources/reference-access.ts');
const { runInTrace } = require('../src/gateway/observability/turn-trace.ts');
const { setRuntimeActorContext } = require('../src/gateway/runtime-actor.ts');
const { buildReferenceObservationMessage } = require('../src/gateway/media-analysis-preview.ts');
const { normalizeAnthropicContent } = require('../src/providers/anthropic-image.ts');
const compat = require('../src/providers/openai-compat-adapter.ts');
const OpenAICompatAdapter = compat.OpenAICompatAdapter ?? compat.default;

const results = [];
async function check(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, ok: false, error }); console.log(`FAIL ${name}: ${error && error.message}`); }
}

const service = getReferenceService(workspace);
service.metadata.setSettings?.({ capture: true });
const sharing = () => service.metadata.sharing();
// Trusted server entrypoint: real teamReferenceChat wrapper + real runInTrace(team_manager|team_subagent).
const trusted = (teamId, sid, mode, fn) => rt.teamReferenceChat(teamId, undefined, (_, session) => runInTrace({ sessionId: session, executionMode: mode }, fn))('fixture', sid);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

try {
  const team = teams.createManagedTeam({ name: 'Vision Fixture', description: 'Synthetic', subagentIds: [], teamContext: 'test', managerSystemPrompt: 'test' });
  const other = teams.createManagedTeam({ name: 'Other Vision', description: 'Synthetic', subagentIds: [], teamContext: 'test', managerSystemPrompt: 'test' });

  const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer();
  const pngPath = path.join(workspace, 'office.png'); fs.writeFileSync(pngPath, png);
  const photo = service.saveAttachment({ operationId: 'tv-photo', filePath: pngPath, mimeType: 'image/png', title: 'Office photo', userQuote: 'my lighting' });
  fs.unlinkSync(pngPath);
  const secret = service.saveText({ operationId: 'tv-private', title: 'PRIVATE CANARY TITLE', content: 'PRIVATE CANARY BYTES' });
  const livePath = path.join(workspace, 'live.png'); fs.writeFileSync(livePath, png);
  const live = service.saveAttachment({ operationId: 'tv-live', filePath: livePath, mimeType: 'image/png', title: 'Live photo' });
  fs.unlinkSync(livePath);

  const frameDir = path.join(service.resources.rootDir, 'content', 'analysis'); fs.mkdirSync(frameDir, { recursive: true });
  const files = [];
  for (let i = 0; i < 8; i++) {
    const bytes = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 20 * i, g: 80, b: 255 - 20 * i } } }).png().toBuffer();
    const rel = `content/analysis/frame-${i}.png`;
    fs.writeFileSync(path.join(service.resources.rootDir, rel), bytes);
    files.push({ path: rel, pathRoot: 'resources', sha256: sha(bytes), size: bytes.length, role: 'frame', timestampSeconds: i * 2.5 });
  }
  const manifest = { schemaVersion: 1, analysisPrompt: 'lighting check', analysis: 'warm light', files };
  const attached = service.resources.attach({ kind: 'file', title: 'Analysis fixture', mimeType: 'application/json', origin: 'tool_observation', locator: { type: 'artifact', canonical: 'analysis:team-vision-fixture' }, snapshotKind: 'text', content: JSON.stringify(manifest) });
  const analysis = service.saveExisting({ operationId: 'tv-analysis', title: 'Analysis fixture', userQuote: 'frames', binding: { resourceId: attached.resource.id, versionId: attached.version.id } });

  const gPhoto = sharing().grant(team.id, 'reference', photo.id);
  sharing().grant(team.id, 'reference', analysis.id);
  const gLive = sharing().grant(team.id, 'reference', live.id);

  await check('trusted team_manager: first6 then next6 frames with timestamps (pagination)', async () => {
    const first = await trusted(team.id, 'mgr-1', 'team_manager', () => accessibleReferenceOpen(workspace, 'mgr-1', analysis.id, { offset: 0, limit: 6 }));
    assert.equal(first.assets.length, 6); assert.equal(first.nextOffset, 6); assert.equal(first.totalAssets, 8);
    const next = await trusted(team.id, 'mgr-1', 'team_manager', () => accessibleReferenceOpen(workspace, 'mgr-1', analysis.id, { offset: 6, limit: 6 }));
    assert.equal(next.assets.length, 2); assert.equal(next.nextOffset, null);
    assert.deepEqual([...first.assets, ...next.assets].map(a => a.timestampSeconds), [0, 2.5, 5, 7.5, 10, 12.5, 15, 17.5]);
  });

  let msgFirst6;
  await check('trusted team_manager: buildReferenceObservationMessage emits 6 images with timestamp labels', async () => {
    msgFirst6 = await trusted(team.id, 'mgr-1', 'team_manager', () => buildReferenceObservationMessage(workspace, 'mgr-1', { id: analysis.id, offset: 0, limit: 6 }));
    assert.ok(msgFirst6, 'message delivered');
    const texts = msgFirst6.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
    assert.equal(msgFirst6.content.filter(p => p.type === 'image_url').length, 6);
    for (const t of ['at 0s', 'at 2.5s', 'at 12.5s']) assert.ok(texts.includes(t), t);
    assert.ok(!texts.includes('at 15s'), 'frame 6 must not leak into first page');
    assert.ok(!JSON.stringify(msgFirst6).includes(workspace) && !JSON.stringify(msgFirst6).includes('office.png'), 'no workspace path leaked');
  });

  await check('Anthropic serialization carries 6 real jpeg byte streams in frame order', async () => {
    const imgs = (await normalizeAnthropicContent(msgFirst6.content)).filter(b => b.type === 'image');
    assert.equal(imgs.length, 6);
    for (let i = 0; i < 6; i++) {
      const bytes = Buffer.from(imgs[i].source.data, 'base64');
      assert.equal(bytes[0], 0xff); assert.equal(bytes[1], 0xd8);
      const { data } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
      const expect = [20 * i, 80, 255 - 20 * i];
      for (let c = 0; c < 3; c++) assert.ok(Math.abs(data[c] - expect[c]) <= 16, `frame ${i} channel ${c}`);
    }
  });

  await check('OpenAI-family buildResponsesInput carries the same 6 delivered image bytes', async () => {
    const adapter = Object.create(OpenAICompatAdapter.prototype);
    const { input } = adapter.buildResponsesInput([msgFirst6]);
    const json = JSON.stringify(input);
    const urls = [...json.matchAll(/data:image\/[a-z]+;base64,([A-Za-z0-9+/=]+)/g)].map(m => Buffer.from(m[1], 'base64'));
    const delivered = msgFirst6.content.filter(p => p.type === 'image_url').map(p => Buffer.from(p.image_url.url.split(',')[1], 'base64'));
    assert.equal(urls.length, 6);
    assert.equal(delivered.length, 6);
    assert.deepEqual(urls.map(sha), delivered.map(sha));
    assert.ok(!json.includes(workspace) && !json.includes('office.png'), 'no path leaked');
  });

  await check('trusted team_manager: next6 page (offset 6) delivers frames 6-7 with 15s/17.5s labels', async () => {
    const msg = await trusted(team.id, 'mgr-1', 'team_manager', () => buildReferenceObservationMessage(workspace, 'mgr-1', { id: analysis.id, offset: 6, limit: 6 }));
    const texts = msg.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
    assert.equal(msg.content.filter(p => p.type === 'image_url').length, 2);
    assert.ok(texts.includes('at 15s') && texts.includes('at 17.5s'));
  });

  await check('denied private: unshared reference rejected for trusted team manager (no bytes)', async () => {
    let msg; await assert.rejects(async () => { msg = await trusted(team.id, 'mgr-2', 'team_manager', () => buildReferenceObservationMessage(workspace, 'mgr-2', { id: secret.id })); }, /unavailable/i);
    assert.equal(msg, undefined);
  });

  await check('guessed id: random UUID rejected inside trusted team turn (no bytes)', async () => {
    let msg; await assert.rejects(async () => { msg = await trusted(team.id, 'mgr-2', 'team_manager', () => buildReferenceObservationMessage(workspace, 'mgr-2', { id: crypto.randomUUID() })); });
    assert.equal(msg, undefined);
  });

  await check('cross-team: other managed team cannot open this team grant (no bytes)', async () => {
    let msg; await assert.rejects(async () => { msg = await trusted(other.id, 'other-1', 'team_manager', () => buildReferenceObservationMessage(workspace, 'other-1', { id: photo.id })); });
    assert.equal(msg, undefined);
  });

  await check('spoofed actor context: runtime actor claiming team is not a trusted scope', async () => {
    setRuntimeActorContext('spoof-1', { kind: 'agent', agentId: 'x', displayName: 'X', teamId: team.id, teamName: 'Vision Fixture' });
    await assert.rejects(buildReferenceObservationMessage(workspace, 'spoof-1', { id: photo.id }));
    await assert.rejects(runInTrace({ sessionId: 'spoof-1', executionMode: 'team_subagent' }, () => buildReferenceObservationMessage(workspace, 'spoof-1', { id: photo.id })));
    await assert.rejects(trusted(team.id, 'spoof-1', 'team_subagent', () => buildReferenceObservationMessage(workspace, 'mgr-1', { id: photo.id })));
  });

  await check('revoke BEFORE injection: rejected, no image bytes produced', async () => {
    sharing().revoke(gPhoto.id);
    let msg; await assert.rejects(async () => { msg = await trusted(team.id, 'mgr-3', 'team_manager', () => buildReferenceObservationMessage(workspace, 'mgr-3', { id: photo.id })); });
    assert.equal(msg, undefined);
  });

  await check('control: live grant delivers normally before the async-revoke probe', async () => {
    const msg = await trusted(team.id, 'mgr-4', 'team_manager', () => buildReferenceObservationMessage(workspace, 'mgr-4', { id: live.id }));
    assert.equal(msg.content.filter(p => p.type === 'image_url').length, 1);
  });

  await check('revoke DURING async normalize: final live recheck blocks delivery (no bytes)', async () => {
    // Timing-based: setImmediate fires while sharp normalize is pending. The control above proves the same call succeeds without revoke.
    let msg; let err;
    const pending = trusted(team.id, 'mgr-4', 'team_manager', () => buildReferenceObservationMessage(workspace, 'mgr-4', { id: live.id }));
    setImmediate(() => sharing().revoke(gLive.id));
    try { msg = await pending; } catch (e) { err = e; }
    assert.ok(err, 'final recheck must throw after mid-normalize revoke');
    assert.equal(msg, undefined);
    console.log(`  final recheck error: ${err.message}`);
  });

  const failed = results.filter(r => !r.ok);
  console.log(`CONNECTED_MEMORY_TEAM_VISION_RESULT: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
} finally {
  service.resources.flushSync(); service.metadata.close();
  fs.rmSync(root, { recursive: true, force: true });
}
