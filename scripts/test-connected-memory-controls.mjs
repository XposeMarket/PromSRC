// Isolated connected-memory B+C controls test. No gateway, browser, provider or paid calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const results = [];
async function check(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, ok: false, error: String(error?.message || error) }); console.log(`FAIL ${name}: ${error?.message || error}`); }
}

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1N8AAAAASUVORK5CYII=';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-controls-'));
  const home = path.join(root, 'home'); fs.mkdirSync(home, { recursive: true });
  // Isolate config/data/app dirs before any src module reads config.
  Object.assign(process.env, {
    HOME: home, USERPROFILE: home, APPDATA: path.join(root, 'appdata'), LOCALAPPDATA: path.join(root, 'localappdata'),
    PROMETHEUS_CONFIG_DIR: path.join(root, 'config'), PROMETHEUS_DATA_DIR: path.join(root, 'data'), PROMETHEUS_HOME: path.join(root, 'prom-home'),
  });
  const require = createRequire(import.meta.url);
  require('tsx/cjs');
  const workspace = path.join(root, 'workspace'); fs.mkdirSync(workspace, { recursive: true });

  const { getReferenceService } = require('../src/gateway/resources/reference-service.ts');
  const { ReferenceStore } = require('../src/gateway/resources/reference-store.ts');
  const lib = require('../src/gateway/resources/reference-library.ts');
  const { setRuntimeActorContext } = require('../src/gateway/runtime-actor.ts');
  for (const sid of ['chat-recall','chat-auth']) setRuntimeActorContext(sid,{kind:'main',surface:'interactive'});

  const service = getReferenceService(workspace);
  const metadata = service.metadata;
  const rootDir = service.resources.rootDir;
  const png = Buffer.from(PNG_B64, 'base64');

  try {
    await check('search subprocess never takes metadata writer ownership after gateway closes', async () => {
      const root2 = path.join(root, 'reader-case'); const ws2 = path.join(root2, 'workspace'); fs.mkdirSync(ws2, { recursive: true });
      const code = `require('tsx/cjs');const {getReferenceService}=require('./src/gateway/resources/reference-service.ts');const {forgottenReferenceSessions}=require('./src/gateway/resources/reference-library.ts');const fs=require('fs');const s=getReferenceService(${JSON.stringify(ws2)});s.saveText({operationId:'reader',title:'Reader',content:'test'});s.resources.flushSync();s.metadata.close();forgottenReferenceSessions(${JSON.stringify(ws2)});if(fs.existsSync(s.metadata.lockPath))throw Error('Search acquired writer lock');`;
      const env = { ...process.env, PROMETHEUS_DATA_DIR: root2, PROMETHEUS_APP_DATA_DIR: root2 };
      const run = spawnSync(process.execPath, ['-e', code], { cwd: process.cwd(), env, encoding: 'utf8' });
      assert.equal(run.status, 0, run.stdout + run.stderr);
      const fresh = spawnSync(process.execPath, ['-e', `require('tsx/cjs');const fs=require('fs');const lib=require('./src/gateway/resources/reference-library.ts');lib.forgottenReferenceSessions(${JSON.stringify(ws2)});const r=require('./src/gateway/resources/resource-store.ts').getResourceStore(${JSON.stringify(ws2)});if(fs.existsSync(require('path').join(r.rootDir,'references.lock')))throw Error('Fresh search worker took writer lock');`], { cwd: process.cwd(), env, encoding:'utf8' });
      assert.equal(fresh.status,0,fresh.stdout+fresh.stderr);
    });
    // ---- Read-only default ----
    await check('fresh workspace settings default to read-only v1 (capture=false, recall=false)', async () => {
      assert.deepEqual(metadata.settings(), { capture: false, recall: false });
    });

    await check('read-only store observes defaults and cannot change settings', async () => {
      const reader = new ReferenceStore(rootDir, workspace, { readOnly: true });
      try {
        assert.equal(reader.writable, false);
        assert.deepEqual(reader.settings(), { capture: false, recall: false });
        assert.throws(() => reader.setSettings({ capture: true }), /read-only|another writer/);
        assert.deepEqual(metadata.settings(), { capture: false, recall: false }, 'writer state untouched by read-only attempt');
      } finally { reader.close(); }
    });

    // ---- Source suppression fixtures ----
    metadata.setSettings({ capture: true, recall: true });
    const noteA = service.saveText({ operationId: 'ctl-note-a', title: 'Lamp note A', content: 'Warm lamps lighting for A', userQuote: 'lighting A', sourceSession: 'chat-A' });
    const noteB = service.saveText({ operationId: 'ctl-note-b', title: 'Lamp note B', content: 'Warm lamps lighting for B', userQuote: 'lighting B', sourceSession: 'chat-B' });
    const workspaceFile = path.join(workspace, 'session-A-like.jsonl');
    const RECALL_MSG = 'what warm lamps lighting preference do I have';

    await check('forgetSource withholds source session from session-hit gate and path gate', async () => {
      assert.ok(lib.referenceSourceAllowed(workspace, { sessionId: 'chat-A' }), 'allowed before forget');
      metadata.forgetSource(noteA.id);
      assert.ok(metadata.forgottenSessions().has('chat-A'));
      assert.equal(lib.referenceSourceAllowed(workspace, { sessionId: 'chat-A' }), false, 'session hit withheld');
      assert.equal(lib.referenceSourceAllowed(workspace, { path: '/store/chat-A.jsonl' }), false, 'path hit withheld');
      assert.equal(lib.referenceSourceAllowed(workspace, { sourcePath: '/store/chat-A' }), false, 'extensionless path withheld');
      assert.ok(lib.referenceSourceAllowed(workspace, { sessionId: 'chat-B' }), 'unrelated session still allowed');
      assert.ok(lib.referenceSourceAllowed(workspace, { path: '/store/chat-B.jsonl' }), 'unrelated path still allowed');
    });

    await check('forgetSource withholds lexical reference list and recall pointers', async () => {
      assert.equal(metadata.list({ query: 'lamps' }).some(r => r.id === noteA.id), false, 'default list hides forgotten');
      assert.ok(metadata.list({ query: 'lamps', includeExcluded: true }).some(r => r.id === noteA.id), 'owner view still shows');
      const block = lib.referenceRecallBlock(workspace, 'chat-recall', RECALL_MSG);
      assert.ok(block.includes(noteB.id), 'unrelated note recalled');
      assert.equal(block.includes(noteA.id), false, 'forgotten note not recalled');
    });

    await check('forgotten suppression survives fresh store instance (rebuild/restart durability)', async () => {
      const again = new ReferenceStore(rootDir, workspace, { owner: metadata });
      assert.ok(again.forgottenSessions().has('chat-A'));
      const reader = new ReferenceStore(rootDir, workspace, { readOnly: true });
      try { assert.ok(reader.forgottenSessions().has('chat-A'), 'read-only reader sees suppression'); }
      finally { reader.close(); }
      assert.equal(lib.referenceSourceAllowed(workspace, { sessionId: 'chat-A' }), false);
    });

    await check('forgetSource undo restores session and recall eligibility', async () => {
      metadata.update(noteA.id, { excluded: false });
      assert.equal(metadata.forgottenSessions().has('chat-A'), false);
      assert.ok(lib.referenceSourceAllowed(workspace, { sessionId: 'chat-A' }), 'session hit restored');
      assert.ok(lib.referenceSourceAllowed(workspace, { path: '/store/chat-A.jsonl' }), 'path hit restored');
      assert.ok(metadata.list({ query: 'lamps' }).some(r => r.id === noteA.id), 'lexical list restored');
      assert.ok(lib.referenceRecallBlock(workspace, 'chat-recall', RECALL_MSG).includes(noteA.id), 'recall restored');
    });

    // ---- Recapture denial ----
    await check('excluded source denies recapture under a new operation id', async () => {
      const excl = service.saveText({ operationId: 'ctl-excl', title: 'Excluded', content: 'excluded body text', sourceSession: 'chat-excl' });
      metadata.update(excl.id, { excluded: true });
      assert.throws(() => service.saveExisting({ operationId: 'ctl-excl-retry', title: 'retry',
        binding: { resourceId: excl.resourceId, versionId: excl.versionId } }), /excluded/);
      assert.equal(metadata.findByOperation('ctl-excl-retry'), undefined, 'no record created');
    });

    await check('deleted source tombstone denies recapture and same-operation resurrection', async () => {
      const del = service.saveText({ operationId: 'ctl-del', title: 'Deleted', content: 'deleted body text', sourceSession: 'chat-del' });
      metadata.remove(del.id);
      assert.throws(() => service.saveExisting({ operationId: 'ctl-del-retry', title: 'again',
        binding: { resourceId: del.resourceId, versionId: del.versionId } }), /excluded/);
      const same = service.saveText({ operationId: 'ctl-del', title: 'Deleted again', content: 'deleted body text' });
      assert.equal(same.deleted, true, 'same operation returns tombstone, not a new reference');
      assert.equal(metadata.get(del.id).title, 'Deleted reference');
    });

    // ---- Archived video ZIP export ----
    await check('archived video analysis ZIP includes original video bytes and frames', async () => {
      const videoBytes = Buffer.concat([Buffer.from('000000186674797069736f6d', 'hex'), crypto.randomBytes(256)]);
      const videoPath = path.join(workspace, 'clip.mp4'); fs.writeFileSync(videoPath, videoBytes);
      const video = service.saveAttachment({ operationId: 'ctl-video-src', filePath: videoPath, mimeType: 'video/mp4', title: 'Clip', sourceSession: 'chat-video' });
      fs.unlinkSync(videoPath);
      const frameDir = path.join(rootDir, 'content', 'analysis'); fs.mkdirSync(frameDir, { recursive: true });
      const files = [];
      for (let i = 0; i < 3; i++) {
        const bytes = Buffer.concat([png, Buffer.from([i])]);
        const rel = `content/analysis/ctl-frame-${i}.png`;
        fs.writeFileSync(path.join(rootDir, rel), bytes);
        files.push({ path: rel, pathRoot: 'resources', sha256: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length, role: 'frame', timestampSeconds: i * 2.5 });
      }
      const manifest = { schemaVersion: 1, analysisPrompt: 'clip check', analysis: 'steady light', files,
        source: { title: 'Clip' }, sourceBinding: { resourceId: video.resourceId, versionId: video.versionId } };
      const attached = service.resources.attach({ kind: 'file', title: 'Clip analysis', mimeType: 'application/json', origin: 'tool_observation',
        locator: { type: 'artifact', canonical: 'analysis:ctl-video' }, snapshotKind: 'text', content: JSON.stringify(manifest) });
      const analysis = service.saveExisting({ operationId: 'ctl-analysis', title: 'Clip analysis', userQuote: 'clip check',
        binding: { resourceId: attached.resource.id, versionId: attached.version.id },
        dependencies: [{ resourceId: video.resourceId, versionId: video.versionId }] });
      const zip = await lib.exportReference(service, analysis.id);
      const archive = await require('jszip').loadAsync(zip);
      assert.ok(archive.file('original-video.mp4'), 'original video entry present');
      assert.deepEqual(await archive.file('original-video.mp4').async('nodebuffer'), videoBytes, 'original video bytes exact');
      const json = JSON.parse(await archive.file('analysis.json').async('string'));
      assert.equal(json.source.path, 'original-video.mp4');
      assert.equal(json.sourceBinding, undefined, 'internal binding stripped');
      // JSZip also lists the implicit 'evidence/' folder entry; count only file entries.
      const frames = Object.keys(archive.files).filter(name => name.startsWith('evidence/') && !archive.files[name].dir);
      assert.equal(frames.length, 3, 'all three frames exported');
    });

    // ---- Router / tool caller auth (no HTTP boot) ----
    const photoPath = path.join(workspace, 'auth.png'); fs.writeFileSync(photoPath, png);
    const photo = service.saveAttachment({ operationId: 'ctl-auth-photo', filePath: photoPath, mimeType: 'image/png', title: 'Auth photo', sourceSession: 'chat-auth' });
    await check('untrusted runs cannot spoof an owner session key or inherit owner actor', async () => {
      const { runInTrace } = require('../src/gateway/observability/turn-trace.ts');
      assert.throws(() => lib.assertPersonalReferenceCaller('unregistered'), /trusted/);
      for (const mode of ['background_task','cron','heartbeat','background_agent','team_manager']) {
        runInTrace({sessionId:'chat-auth',executionMode:mode},()=> {
          assert.throws(()=>lib.referenceOpenPayload(workspace,'chat-auth',photo.id),/interactive owner/);
          assert.equal(lib.referenceRecallBlock(workspace,'chat-auth',RECALL_MSG),'');
        });
      }
      runInTrace({sessionId:'chat-auth',executionMode:'interactive',personalReferenceAccess:true},()=> {
        runInTrace({sessionId:'chat-auth',executionMode:'background_task'},()=>assert.throws(()=>lib.referenceOpenPayload(workspace,'chat-auth',photo.id),/interactive owner/));
        runInTrace({sessionId:'chat-auth',executionMode:'interactive',personalReferenceAccess:false},()=>assert.throws(()=>lib.referenceOpenPayload(workspace,'chat-auth',photo.id),/interactive owner/));
        runInTrace({sessionId:'chat-auth',executionMode:'interactive'},()=>assert.throws(()=>lib.referenceOpenPayload(workspace,'chat-auth',photo.id),/interactive owner/));
        assert.doesNotThrow(()=>lib.referenceOpenPayload(workspace,'chat-auth',photo.id));
      });
      for(const sid of ['webhook_key','telegram_1','discord_1','cron_1','auto_job']) runInTrace({sessionId:sid,executionMode:'interactive',personalReferenceAccess:true},()=>assert.throws(()=>lib.assertPersonalReferenceCaller(sid),/not granted/));
      runInTrace({sessionId:'fresh-owner',executionMode:'interactive',personalReferenceAccess:true},()=>assert.doesNotThrow(()=>lib.referenceOpenPayload(workspace,'fresh-owner',photo.id)));
    });

    fs.unlinkSync(photoPath);

    await check('background, team and subagent session ids are denied personal references', async () => {
      for (const sid of ['background_x', 'team_x', 'subagent_x']) {
        assert.throws(() => lib.assertPersonalReferenceCaller(sid), /not granted/, sid);
        assert.throws(() => lib.referenceOpenPayload(workspace, sid, photo.id), /not granted/, sid);
        assert.equal(lib.referenceRecallBlock(workspace, sid, RECALL_MSG), '', `${sid} recall silently empty`);
      }
    });

    await check('agent, manager and ephemeral actor contexts are denied; normal chat allowed', async () => {
      for (const [i, kind] of ['agent', 'manager', 'ephemeral_worker'].entries()) {
        const sid = `team-ctl-${i}`;
        setRuntimeActorContext(sid, { kind, agentId: `a${i}`, displayName: `A${i}`, teamId: 't', teamName: 't' });
        assert.throws(() => lib.assertPersonalReferenceCaller(sid), /not granted/, kind);
        assert.throws(() => lib.referenceOpenPayload(workspace, sid, photo.id), /not granted/, kind);
      }
      assert.doesNotThrow(() => lib.assertPersonalReferenceCaller('chat-auth'));
      const payload = lib.referenceOpenPayload(workspace, 'chat-auth', photo.id);
      assert.equal(payload.reference.id, photo.id);
      assert.equal(payload.visual_count, 1);
    });

    await check('denied session cannot open excluded or deleted references even by owner-less path', async () => {
      metadata.update(photo.id, { excluded: true });
      assert.throws(() => lib.openReference(service, photo.id), /excluded/);
      assert.throws(() => lib.referenceOpenPayload(workspace, 'chat-auth', photo.id), /excluded/);
      metadata.update(photo.id, { excluded: false });
    });
  } finally {
    service.resources.flushSync();
    metadata.close();
    fs.rmSync(root, { recursive: true, force: true });
  }

  const failed = results.filter(r => !r.ok);
  console.log(`CONNECTED_MEMORY_CONTROLS_RESULT: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch(error => { console.error('SETUP_FAILED', error); process.exitCode = 1; });
