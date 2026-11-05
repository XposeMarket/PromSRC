// Isolated vision/reference fixture test. No paid provider calls, no real user data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const results = [];
async function check(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, ok: false, error: String(error?.message || error) }); console.log(`FAIL ${name}: ${error?.message || error}`); }
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-vision-'));
  const home = path.join(root, 'home'); fs.mkdirSync(home, { recursive: true });
  // Isolate config/data/app dirs before any src module reads config.
  Object.assign(process.env, {
    HOME: home, USERPROFILE: home, APPDATA: path.join(root, 'appdata'), LOCALAPPDATA: path.join(root, 'localappdata'),
    PROMETHEUS_CONFIG_DIR: path.join(root, 'config'), PROMETHEUS_DATA_DIR: path.join(root, 'data'), PROMETHEUS_HOME: path.join(root, 'prom-home'),
  });
  const require = createRequire(import.meta.url);
  require('tsx/cjs');
  const sharp = (await import('sharp')).default;
  const workspace = path.join(root, 'workspace'); fs.mkdirSync(workspace, { recursive: true });

  const { getReferenceService } = require('../src/gateway/resources/reference-service.ts');
  const { buildReferenceObservationMessage } = require('../src/gateway/media-analysis-preview.ts');
  const { openReference } = require('../src/gateway/resources/reference-library.ts');
  const { setRuntimeActorContext } = require('../src/gateway/runtime-actor.ts');
  const { normalizeAnthropicContent } = require('../src/providers/anthropic-image.ts');
  const compat = require('../src/providers/openai-compat-adapter.ts');
  const OpenAICompatAdapter = compat.OpenAICompatAdapter ?? compat.default;

  const service = getReferenceService(workspace);
  service.metadata.setSettings?.({ capture: true });
  const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer();
  const pngPath = path.join(workspace, 'office.png'); fs.writeFileSync(pngPath, png);

  // ---- Fixtures (all created via the same service that buildReferenceObservationMessage uses) ----
  const photo = service.saveAttachment({ operationId: 'vt-photo', filePath: pngPath, mimeType: 'image/png', title: 'Office photo', userQuote: 'my lighting' });
  fs.unlinkSync(pngPath); // source deleted after save
  const note = service.saveText({ operationId: 'vt-note', title: 'Office note', content: 'Warm lamps', userQuote: 'note' });
  const toDelete = service.saveText({ operationId: 'vt-delete', title: 'To delete', content: 'x' });
  service.metadata.remove(toDelete.id);
  const excludedPath = path.join(workspace, 'excl.png'); fs.writeFileSync(excludedPath, png);
  const excluded = service.saveAttachment({ operationId: 'vt-excl', filePath: excludedPath, mimeType: 'image/png', title: 'Excluded' });
  fs.unlinkSync(excludedPath);
  service.metadata.update(excluded.id, { excluded: true });
  const corruptPath = path.join(workspace, 'corrupt.png'); fs.writeFileSync(corruptPath, png);
  const corrupt = service.saveAttachment({ operationId: 'vt-corrupt', filePath: corruptPath, mimeType: 'image/png', title: 'Corrupt' });
  fs.unlinkSync(corruptPath);
  const corruptVersion = service.resources.referenceVersion(corrupt.resourceId, corrupt.versionId);
  fs.appendFileSync(path.join(service.resources.rootDir, corruptVersion.snapshotPath), 'tamper');

  // 8 analysis frames, timestamps 0,2.5,...,17.5
  const frameDir = path.join(service.resources.rootDir, 'content', 'analysis'); fs.mkdirSync(frameDir, { recursive: true });
  const files = [];
  for (let i = 0; i < 8; i++) {
    const bytes = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 20 * i, g: 80, b: 255 - 20 * i } } }).png().toBuffer();
    const rel = `content/analysis/frame-${i}.png`;
    fs.writeFileSync(path.join(service.resources.rootDir, rel), bytes);
    files.push({ path: rel, pathRoot: 'resources', sha256: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length, role: 'frame', timestampSeconds: i * 2.5 });
  }
  const manifest = { schemaVersion: 1, analysisPrompt: 'lighting check', analysis: 'warm light', files };
  const attached = service.resources.attach({ kind: 'file', title: 'Analysis fixture', mimeType: 'application/json', origin: 'tool_observation',
    locator: { type: 'artifact', canonical: 'analysis:vision-fixture' }, snapshotKind: 'text', content: JSON.stringify(manifest) });
  const analysis = service.saveExisting({ operationId: 'vt-analysis', title: 'Analysis fixture', userQuote: 'frames',
    binding: { resourceId: attached.resource.id, versionId: attached.version.id } });

  const sid = 'chat-vision-test';
  setRuntimeActorContext(sid,{kind:'main',surface:'interactive'});
  const allowedMessage = (await buildReferenceObservationMessage(workspace, sid, { id: photo.id }));

  await check('image attachment resolves via getReferenceService(workspace) with no path in result', async () => {
    assert.ok(allowedMessage, 'message built');
    const images = allowedMessage.content.filter(p => p.type === 'image_url');
    assert.equal(images.length, 1);
    const json = JSON.stringify(allowedMessage);
    assert.ok(!json.includes(workspace) && !json.includes(root) && !json.includes('office.png'), 'no path leaked');
  });

  await check('source file deleted, archived bytes still open', async () => {
    assert.equal(fs.existsSync(path.join(workspace, 'office.png')), false);
    const opened = openReference(service, photo.id);
    assert.deepEqual(opened.assets[0].bytes, png);
  });

  await check('Anthropic family normalizeAnthropicContent yields real jpeg bytes', async () => {
    const out = await normalizeAnthropicContent(allowedMessage.content);
    const imgs = out.filter(p => p.type === 'image');
    assert.equal(imgs.length, 1);
    assert.equal(imgs[0].source.media_type, 'image/jpeg');
    const bytes = Buffer.from(imgs[0].source.data, 'base64');
    assert.equal(bytes[0], 0xff); assert.equal(bytes[1], 0xd8);
    const meta = await sharp(bytes).metadata();
    assert.equal(meta.width, 64); assert.equal(meta.height, 48);
  });

  await check('OpenAI family buildResponsesInput carries real image bytes', async () => {
    assert.equal(typeof OpenAICompatAdapter, 'function', 'adapter exported');
    const adapter = Object.create(OpenAICompatAdapter.prototype);
    const { input } = adapter.buildResponsesInput([allowedMessage]);
    const urls = [...JSON.stringify(input).matchAll(/data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)/g)];
    assert.equal(urls.length, 1, 'one image data URL in responses input');
    const bytes = Buffer.from(urls[0][2], 'base64');
    const meta = await sharp(bytes).metadata();
    assert.equal(meta.width, 64); assert.equal(meta.height, 48);
    assert.ok(!JSON.stringify(input).includes(workspace));
  });

  await check('text-only note returns undefined (no image parts)', async () => {
    assert.equal(await buildReferenceObservationMessage(workspace, sid, { id: note.id }), undefined);
  });

  await check('deleted reference is rejected', async () => {
    await assert.rejects(buildReferenceObservationMessage(workspace, sid, { id: toDelete.id }), /unavailable/);
  });

  await check('excluded reference is rejected', async () => {
    await assert.rejects(buildReferenceObservationMessage(workspace, sid, { id: excluded.id }), /excluded/);
  });

  await check('corrupt archived bytes are rejected', async () => {
    await assert.rejects(buildReferenceObservationMessage(workspace, sid, { id: corrupt.id }), /integrity|mismatch|corrupt|hash/i);
  });

  await check('agent/manager/ephemeral actors and background sessions rejected', async () => {
    await assert.rejects(buildReferenceObservationMessage(workspace, 'background_vt', { id: photo.id }), /not granted/);
    for (const [i, kind] of ['agent', 'manager', 'ephemeral_worker'].entries()) {
      const s = `team-vt-${i}`;
      setRuntimeActorContext(s, { kind, agentId: `a${i}`, displayName: `A${i}`, teamId: 't', teamName: 't' });
      await assert.rejects(buildReferenceObservationMessage(workspace, s, { id: photo.id }), /not granted/, kind);
    }
  });

  await check('analysis frames: first6 then next6 pagination with timestamps', async () => {
    const first = openReference(service, analysis.id, { offset: 0, limit: 6 });
    assert.equal(first.assets.length, 6); assert.equal(first.nextOffset, 6); assert.equal(first.totalAssets, 8);
    const next = openReference(service, analysis.id, { offset: 6, limit: 6 });
    assert.equal(next.assets.length, 2); assert.equal(next.nextOffset, null);
    assert.deepEqual([...first.assets, ...next.assets].map(a => a.timestampSeconds), [0, 2.5, 5, 7.5, 10, 12.5, 15, 17.5]);
    const msg = await buildReferenceObservationMessage(workspace, sid, { id: analysis.id, offset: 6, limit: 6 });
    const texts = msg.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
    assert.ok(texts.includes('at 17.5s'), 'timestamp rendered');
    assert.equal(msg.content.filter(p => p.type === 'image_url').length, 2);
  });

  service.resources.flushSync(); service.metadata.close();
  fs.rmSync(root, { recursive: true, force: true });
  const failed = results.filter(r => !r.ok);
  console.log(`CONNECTED_MEMORY_VISION_RESULT: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch(error => { console.error('SETUP_FAILED', error); process.exitCode = 1; });
