// Cron event-loop stall (2026-11-07): every cron tick ran saveTask() ->
// syncTaskJournalResource -> ResourceStore.attach -> findExisting, which
// scanned resources x versions (2.19 s per pass on the real 19 MB registry).
// Pins: (1) indexed findExisting returns exactly what the original linear scan
// returns, (2) attach p95 < 50 ms on ~6k resources / ~8k versions, (3) task
// journal retention keeps the newest N versions and leaves other kinds alone,
// never deletes a snapshot file a kept version references, and writes exactly
// one registry.backup-*.json, (4) syncTaskJournalResource coalesces per task.
// Uses a temp config/data dir only; never touches live user data.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-resource-hot-path-'));
process.env.PROMETHEUS_CONFIG_DIR = tmp;
process.env.PROMETHEUS_DATA_DIR = tmp;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(tmp, 'ws');
delete process.env.PROMETHEUS_TASK_JOURNAL_VERSION_RETENTION; // default 3

const sha = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const rid = (n: number) => `res_synthetic${String(n).padStart(6, '0')}`;
const vid = (n: number) => `ver_synthetic${String(n).padStart(6, '0')}`;
const p95 = (values: number[]) => { const s = [...values].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]; };

function buildRegistry(workspace: string) {
  const resources: any[] = [];
  const versions: any[] = [];
  let v = 0;
  const at = new Date(Date.now() - 86_400_000).toISOString();
  for (let i = 0; i < 6000; i += 1) {
    const kind = i % 5 === 0 ? 'link' : i % 5 === 1 ? 'web_page' : i % 5 === 2 ? 'artifact' : 'task';
    const locator = kind === 'task' ? { type: 'task', taskId: `t${i}`, canonical: `task:t${i}` }
      : kind === 'artifact' ? { type: 'artifact', artifactId: `a${i}`, canonical: `artifact:a${i}` }
      : { type: kind === 'link' ? 'url' : 'browser', url: `https://example.com/p/${i}`, canonical: `https://example.com/p/${i}` };
    const resource: any = { id: rid(i), kind, title: `r${i}`, origin: kind === 'task' ? 'task_journal' : 'web_fetch', locator, workspaceScope: workspace, status: i % 97 === 0 ? 'deleted' : 'available', createdAt: at, updatedAt: at };
    if (i % 7 === 0) resource.metadata = { dedupeKey: `dk-${i % 350}` };
    const count = i % 3 === 0 ? 2 : 1; // 6000 resources, 8000 versions
    for (let k = 0; k < count; k += 1) {
      v += 1;
      versions.push({ id: vid(v), resourceId: resource.id, sequence: k + 1, contentHash: sha(`body-${i % 1500}-${k}`), size: 10, snapshotKind: 'metadata', createdAt: at });
      resource.currentVersionId = vid(v);
    }
    resources.push(resource);
  }
  return { schemaVersion: 1, resources, versions, links: [], provenance: [] };
}

async function main() {
  const mod = await import('./resource-store');
  const workspace = path.resolve(path.join(tmp, 'ws'));
  fs.mkdirSync(workspace, { recursive: true });
  const rootDir = path.join(tmp, 'resources');
  fs.mkdirSync(path.join(rootDir, 'content'), { recursive: true });
  const registryPath = path.join(rootDir, 'registry.json');
  fs.writeFileSync(registryPath, JSON.stringify(buildRegistry(workspace)));
  const store = mod.createResourceStore({ rootDir, workspacePath: workspace }) as any;
  const state = store.debugState();
  assert.equal(state.resources.length, 6000);
  assert.equal(state.versions.length, 8000);

  // (1) Equivalence with the original linear scan, incl. deleted, dedupe-key,
  // locator, content-hash and miss cases.
  const inputs: Array<[any, string | undefined]> = [];
  // Each hashed miss costs the O(R x V) reference ~1-2 s, so keep the sample small.
  for (let i = 0; i < 6000; i += 857) {
    const r = state.resources[i];
    inputs.push([{ kind: r.kind, origin: r.origin, locator: { ...r.locator } }, undefined]);
    inputs.push([{ kind: r.kind, origin: r.origin, locator: { type: 'task', canonical: `task:none${i}` } }, sha(`body-${i % 1500}-0`)]);
    inputs.push([{ kind: 'file', origin: 'user_upload', locator: { type: 'file', canonical: `f${i}` }, metadata: { dedupeKey: ` dk-${i % 350} ` } }, undefined]);
    inputs.push([{ kind: 'link', origin: 'web_fetch', locator: { type: 'url', url: `HTTPS://EXAMPLE.com:443/p/${i}#frag` }, metadata: { dedupeKey: `dk-${i % 350}` } }, sha('nope')]);
  }
  inputs.push([{ kind: 'note', origin: 'web_fetch', locator: { type: 'url' } }, undefined]);
  let matches = 0;
  const naiveTimes: number[] = [];
  const indexedTimes: number[] = [];
  for (const [input, hash] of inputs) {
    let t = performance.now();
    const expected = store.findExistingLinear(state, input, hash);
    naiveTimes.push(performance.now() - t);
    t = performance.now();
    const actual = store.findExisting(state, input, hash);
    indexedTimes.push(performance.now() - t);
    assert.equal(actual?.id, expected?.id, `dedupe mismatch for ${JSON.stringify(input)}`);
    if (expected) matches += 1;
  }
  assert.ok(matches > inputs.length / 3, `equivalence sample should hit real matches (${matches})`);

  // (2) Hot path: task-journal attaches against the big registry.
  const attachTimes: number[] = [];
  for (let n = 0; n < 80; n += 1) {
    const taskIndex = 3 + 5 * n;
    const t = performance.now();
    const result = store.syncTaskJournal({ id: `t${taskIndex}`, title: `job ${n}`, status: 'running', journal: [{ timestamp: `s${n}`, role: 'tool', content: `step ${n}` }], workspacePath: workspace });
    attachTimes.push(performance.now() - t);
    // Deleted resources (index % 97 == 0) are never reused, exactly as before.
    if (taskIndex % 97 === 0) assert.notEqual(result.resource.id, rid(taskIndex), 'deleted task resource must not be reused');
    else assert.equal(result.resource.id, rid(taskIndex), 'task journal must reuse its existing resource');
  }
  // Same locator again after mutations still resolves identically.
  const after = store.debugState();
  for (const [input, hash] of inputs.filter(([, h]) => !h)) assert.equal(store.findExisting(after, input, hash)?.id, store.findExistingLinear(after, input, hash)?.id);
  const naiveP95 = p95(naiveTimes);
  const indexedP95 = p95(indexedTimes);
  const attachP95 = p95(attachTimes);
  console.log(`[hot-path] findExisting p95 naive=${naiveP95.toFixed(2)}ms indexed=${indexedP95.toFixed(3)}ms; attach p95=${attachP95.toFixed(2)}ms (n=${attachTimes.length})`);
  assert.ok(attachP95 < 50, `attach p95 ${attachP95.toFixed(2)}ms must be < 50ms`);
  store.flushSync();

  // (3) Retention + backup on a fresh registry with real snapshot files.
  const root2 = path.join(tmp, 'resources-retention');
  const ws2 = path.join(tmp, 'ws2');
  fs.mkdirSync(ws2, { recursive: true });
  const store2 = mod.createResourceStore({ rootDir: root2, workspacePath: ws2 }) as any;
  let taskId = '';
  let linkId = '';
  for (let n = 1; n <= 6; n += 1) {
    taskId = store2.syncTaskJournal({ id: 'retained-task', title: 'retained', journal: [{ timestamp: `${n}`, content: `entry ${n}` }], workspacePath: ws2 }).resource.id;
    linkId = store2.attach({ kind: 'web_page', origin: 'web_fetch', locator: { type: 'url', url: 'https://example.com/keep' }, content: `page ${n}`, snapshotKind: 'text' }).resource.id;
  }
  store2.flushSync(); // first write: no registry on disk yet -> nothing to back up
  // Make one kept task version share a snapshot file with a soon-pruned one.
  const s2 = store2.debugState();
  const taskVersions = s2.versions.filter((v: any) => v.resourceId === taskId);
  assert.equal(taskVersions.length, 3, 'task journal keeps the newest 3 versions');
  assert.deepEqual(taskVersions.map((v: any) => v.sequence), [4, 5, 6]);
  assert.equal(s2.versions.filter((v: any) => v.resourceId === linkId).length, 6, 'non-task resources are not pruned by task retention');
  const sharedPath = taskVersions[0].snapshotPath; // sequence 4, pruned next
  for (let n = 7; n <= 8; n += 1) store2.syncTaskJournal({ id: 'retained-task', title: 'retained', journal: [{ timestamp: `${n}`, content: `entry ${n}` }], workspacePath: ws2 });
  const newest = store2.debugState().versions.filter((v: any) => v.resourceId === taskId).at(-1);
  newest.snapshotPath = sharedPath; // simulate shared content ownership
  const prunedFile = path.resolve(root2, store2.debugState().versions.find((v: any) => v.resourceId === taskId && v.sequence === 5).snapshotPath);
  store2.flushSync();
  await new Promise((resolve) => setTimeout(resolve, 100)); // async file removal
  const kept = store2.debugState().versions.filter((v: any) => v.resourceId === taskId);
  assert.deepEqual(kept.map((v: any) => v.sequence), [6, 7, 8]);
  assert.ok(fs.existsSync(path.resolve(root2, sharedPath)), 'snapshot still referenced by a kept version must survive');
  assert.ok(!fs.existsSync(prunedFile), 'exclusively-owned pruned snapshot is deleted');
  const backups = () => fs.readdirSync(root2).filter((name) => /^registry\.backup-\d+\.json$/.test(name));
  assert.equal(backups().length, 1, 'exactly one registry backup before the first prune');
  for (let n = 9; n <= 12; n += 1) store2.syncTaskJournal({ id: 'retained-task', journal: [{ timestamp: `${n}`, content: `entry ${n}` }], workspacePath: ws2 });
  store2.flushSync();
  assert.equal(backups().length, 1, 'later prunes do not write more backups');
  const backup = JSON.parse(fs.readFileSync(path.join(root2, backups()[0]), 'utf8'));
  assert.ok(backup.versions.some((v: any) => v.resourceId === taskId && v.sequence === 4), 'backup holds the pre-prune registry');

  // Env 0 keeps everything.
  process.env.PROMETHEUS_TASK_JOURNAL_VERSION_RETENTION = '0';
  for (let n = 13; n <= 17; n += 1) store2.syncTaskJournal({ id: 'retained-task', journal: [{ timestamp: `${n}`, content: `entry ${n}` }], workspacePath: ws2 });
  store2.flushSync();
  assert.equal(store2.debugState().versions.filter((v: any) => v.resourceId === taskId).length, 8);
  delete process.env.PROMETHEUS_TASK_JOURNAL_VERSION_RETENTION;

  // External edit invalidates the cached registry (mtime/size key).
  const external = JSON.parse(fs.readFileSync(path.join(root2, 'registry.json'), 'utf8'));
  external.resources = external.resources.filter((r: any) => r.id !== linkId);
  fs.writeFileSync(path.join(root2, 'registry.json'), JSON.stringify(external));
  assert.ok(!store2.debugState().resources.some((r: any) => r.id === linkId), 'external registry edits must invalidate the cache');

  // (4) Coalescing through the exported syncTaskJournalResource.
  const shared = mod.getResourceStore(ws2) as any;
  assert.ok(path.resolve(shared.rootDir).startsWith(path.resolve(tmp)), 'test must run on a temp data dir');
  const countVersions = () => {
    const s = shared.debugState();
    const resource = s.resources.find((r: any) => r.locator?.taskId === 'coalesced' && r.workspaceScope === path.resolve(ws2));
    return resource ? s.versions.filter((v: any) => v.resourceId === resource.id).length : 0;
  };
  for (let n = 0; n < 50; n += 1) mod.syncTaskJournalResource({ id: 'coalesced', title: 'c', journal: [{ timestamp: 'x', content: `step ${n}` }], workspacePath: ws2, updatedAt: `u${n}` });
  assert.equal(countVersions(), 0, 'sync is deferred to setImmediate');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(countVersions(), 1, '50 saves in one tick create one version');
  const attachesBefore = shared.getTelemetry().filter((e: any) => e.event === 'attach').length;
  mod.syncTaskJournalResource({ id: 'coalesced', title: 'c', journal: [{ timestamp: 'x', content: 'step 49' }], workspacePath: ws2, updatedAt: 'later' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(shared.getTelemetry().filter((e: any) => e.event === 'attach').length, attachesBefore, 'unchanged journal skips the attach');
  mod.syncTaskJournalResource({ id: 'coalesced', title: 'c', journal: [{ timestamp: 'y', content: 'step 50' }], workspacePath: ws2 });
  mod.drainTaskJournalSyncs();
  assert.equal(countVersions(), 2, 'changed journal syncs again');
  shared.flushSync();

  // (5) M1: a failed backup keeps every task version and snapshot file for that
  // flush (nothing deleted, no backup written). A later flush with a working
  // backup prunes, leaves exactly one backup and no temp file.
  const root3 = path.join(tmp, 'resources-backup-gate');
  const ws3 = path.join(tmp, 'ws3');
  fs.mkdirSync(ws3, { recursive: true });
  const store3 = mod.createResourceStore({ rootDir: root3, workspacePath: ws3 }) as any;
  const task3 = (n: number) => ({ id: 'gated-task', title: 'gated', journal: [{ timestamp: `${n}`, content: `gate ${n}` }], workspacePath: ws3 });
  const backups3 = () => fs.readdirSync(root3).filter((name) => /^registry\.backup-\d+\.json$/.test(name));
  for (let n = 1; n <= 4; n += 1) store3.syncTaskJournal(task3(n));
  store3.flushSync(); // registry on disk, nothing to back up yet
  for (let n = 5; n <= 7; n += 1) store3.syncTaskJournal(task3(n));
  const snapshotsBefore = store3.debugState().versions.filter((v: any) => v.snapshotPath).map((v: any) => path.resolve(root3, v.snapshotPath));
  const versionsBefore = store3.debugState().versions.length;
  mod.setRegistryBackupWriterForTests(() => { throw new Error('forced backup failure'); });
  store3.flushSync();
  mod.setRegistryBackupWriterForTests(null);
  assert.equal(store3.debugState().versions.length, versionsBefore, 'failed backup prunes no versions');
  assert.ok(snapshotsBefore.length > 0, 'test has snapshot files to protect');
  assert.ok(snapshotsBefore.every((file: string) => fs.existsSync(file)), 'failed backup deletes no snapshot files');
  assert.equal(backups3().length, 0, 'failed backup leaves no backup behind');
  store3.syncTaskJournal(task3(8));
  store3.flushSync();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(backups3().length, 1, 'later flush with a working backup writes one backup');
  assert.ok(store3.debugState().versions.filter((v: any) => v.resourceId === store3.debugState().resources.find((r: any) => r.locator?.taskId === 'gated-task')?.id).length <= 3, 'later flush prunes to the retention cap');
  assert.deepEqual(fs.readdirSync(root3).filter((name) => name.endsWith('.tmp')), [], 'no temp backup file is left behind');

  // (6) M2: rotation keeps exactly the newest 2 backups. A pre-PR backup
  // (registry.backup-1791087601776.json) counts toward the window like any other.
  const root4 = path.join(tmp, 'resources-rotation');
  const ws4 = path.join(tmp, 'ws4');
  fs.mkdirSync(ws4, { recursive: true });
  const store4 = mod.createResourceStore({ rootDir: root4, workspacePath: ws4 }) as any;
  const task4 = (n: number) => ({ id: 'rotated-task', title: 'rotated', journal: [{ timestamp: `${n}`, content: `rot ${n}` }], workspacePath: ws4 });
  for (let n = 1; n <= 4; n += 1) store4.syncTaskJournal(task4(n));
  store4.flushSync();
  for (const name of ['registry.backup-1791087601776.json', 'registry.backup-1700000000000.json', 'registry.backup-1600000000000.json']) {
    fs.copyFileSync(path.join(root4, 'registry.json'), path.join(root4, name));
  }
  store4.syncTaskJournal(task4(5));
  store4.flushSync();
  const rotated = fs.readdirSync(root4).filter((name) => /^registry\.backup-\d+\.json$/.test(name)).sort();
  assert.equal(rotated.length, 2, 'rotation keeps exactly the newest 2 backups');
  assert.ok(rotated.includes('registry.backup-1791087601776.json'), 'pre-PR backup counts toward the newest-2 window');
  assert.ok(!rotated.includes('registry.backup-1700000000000.json'), 'older backup is deleted');
  assert.ok(!rotated.includes('registry.backup-1600000000000.json'), 'oldest backup is deleted');

  // (7) Deleting a task resource then syncing identical journal content re-attaches it.
  const ws5 = path.join(tmp, 'ws5');
  fs.mkdirSync(ws5, { recursive: true });
  const shared5 = mod.getResourceStore(ws5) as any;
  const input5 = { id: 'deleted-task', title: 'd', journal: [{ timestamp: 'd', content: 'same' }], workspacePath: ws5 };
  const liveTaskResources = () => shared5.debugState().resources.filter((r: any) => r.locator?.taskId === 'deleted-task' && r.status !== 'deleted');
  mod.syncTaskJournalResource(input5);
  mod.drainTaskJournalSyncs();
  assert.equal(liveTaskResources().length, 1, 'first sync attaches the task resource');
  shared5.deleteResource(liveTaskResources()[0].id);
  assert.equal(liveTaskResources().length, 0, 'task resource is deleted');
  mod.syncTaskJournalResource(input5);
  mod.drainTaskJournalSyncs();
  assert.equal(liveTaskResources().length, 1, 'identical journal after delete re-attaches');
  shared5.flushSync();


  console.log('resource-store-hot-path.regression: PASS');
}

main().then(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
