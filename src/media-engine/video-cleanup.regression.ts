/** Regression for the 2026-10-07 video cleanup: resolution-aware estimate, $0 budget migration, cast dedupe, relay port release. Offline. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { executeVideoProject } from './tool.js';
import { loadProject } from './project.js';

async function main() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'vclean-'));
  const ctx = { workspacePath: ws };
  try {
    // 1. Legacy project with a silent $1 auto-approve is reset to $0 on load.
    const created: any = await executeVideoProject({ action: 'create', title: 'Legacy' }, ctx);
    const id = created.project?.id || created.id;
    assert.ok(id, 'project id');
    const file = path.join(ws, 'video-projects', id, 'project.json');
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    stored.project.budget = { capUsd: 10, autoApproveUsd: 1, spentUsd: 2 };
    fs.writeFileSync(file, JSON.stringify(stored));
    const migrated = loadProject(ws, id);
    assert.equal(migrated.budget.autoApproveUsd, 0, 'legacy auto-approve migrated to $0');
    assert.equal(migrated.budget.spentUsd, 2, 'spend preserved');
    assert.equal(migrated.budget.capUsd, 10, 'cap preserved');

    // 2. An explicit choice under the current policy is kept.
    const explicit: any = await executeVideoProject({ action: 'create', title: 'Explicit', budget: { autoApproveUsd: 0.5 } }, ctx);
    assert.equal(loadProject(ws, explicit.project?.id || explicit.id).budget.autoApproveUsd, 0.5, 'explicit auto-approve kept');
    await executeVideoProject({ action: 'apply_ops', projectId: id, ops: [{ op: 'project.update', budget: { autoApproveUsd: 0.25 } }] }, ctx);
    assert.equal(loadProject(ws, id).budget.autoApproveUsd, 0.25, 'project.update auto-approve survives reload');

    // 3. estimate honours the resolution argument for resolution-tiered models.
    const toolSrc = fs.readFileSync(path.resolve('src/media-engine/tool.ts'), 'utf8');
    assert.match(toolSrc, /estimate\(ws, need\(args\.projectId, 'projectId'\), \{[^}]*resolution: args\.resolution/, 'estimate passes resolution');
    assert.match(toolSrc, /generateShots\(ws, pid, \{[^}]*resolution: args\.resolution/, 'generate passes resolution');
    const { estimateCostUsd, getModel } = await import('./catalog.js');
    const wan = getModel('fal/wan-animate-replace')!;
    assert.equal(estimateCostUsd(wan, { durationSec: 5, resolution: '480p' }) * 2, estimateCostUsd(wan, { durationSec: 5, resolution: '720p' }), '480p is half of 720p');

    // 4. Standalone cast_save with an existing name updates instead of duplicating.
    const img = path.join(ws, 'face.png');
    fs.writeFileSync(img, Buffer.from('89504e470d0a1a0a', 'hex'));
    const a: any = await executeVideoProject({ action: 'cast_save', name: 'Edna', anchors: ['face.png'] }, ctx);
    const b: any = await executeVideoProject({ action: 'cast_save', name: 'edna', notes: 'GRWM creator' }, ctx);
    assert.equal(b.reusedExisting, a.saved.id, 'same-name cast reused');
    assert.equal(b.saved.anchors.length, 1, 'anchors kept on update');
    const list: any = await executeVideoProject({ action: 'cast_list' }, ctx);
    assert.equal((list.cast || list.members || list).filter((c: any) => c.name.toLowerCase() === 'edna').length, 1, 'no duplicate Edna');
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }

  // 5. Relay releases its port on stop and retries EADDRINUSE.
  const relaySrc = fs.readFileSync(path.resolve('src/gateway/user-chrome-relay.ts'), 'utf8');
  assert.match(relaySrc, /EADDRINUSE/, 'relay retries EADDRINUSE');
  const serverSrc = fs.readFileSync(path.resolve('src/gateway/server-v2.ts'), 'utf8');
  assert.match(serverSrc, /stopUserChromeRelayForHandoff/, 'handoff frees the relay port');
  const { UserChromeRelay } = await import('../gateway/user-chrome-relay.js') as any;
  if (UserChromeRelay) {
    const port = 39000 + Math.floor(Math.random() * 500);
    const relay = new UserChromeRelay({ port, pairingSecret: 'x'.repeat(32) });
    relay.ensureStarted();
    await new Promise((r) => setTimeout(r, 200));
    await relay.stop();
    await new Promise<void>((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(port, '127.0.0.1', () => s.close(() => resolve())); });
  }
  console.log('video-cleanup regression: ok');
}

main().catch((e) => { console.error(e); process.exit(1); });
