import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  initSessionWake, wakeSession, resetSessionWakeForTests, registerThreadCallback, fireThreadCallbacks, hasThreadCallback,
} from './session-wake';
import {
  watchVideoJobs, initVideoProjectWake, resetVideoProjectWakeForTests, listVideoWatches, checkAllVideoWatches, VIDEO_WAKE_TIMEOUT_MS,
} from './video-project-wake';
import { createProject, mutateProject } from '../media-engine/project.js';

const calls: Array<{ sessionId: string; message: string }> = [];
const flush = () => new Promise((r) => setTimeout(r, 30));
function init(busy?: () => boolean) {
  initSessionWake({
    runInteractiveTurn: async (message: string, sessionId: string) => { calls.push({ sessionId, message }); return { type: 'done', text: 'ok' }; },
    notify: () => undefined,
    isSessionBusy: busy,
    busyPollMs: 10,
  });
}

async function main() {
  // 1. dedupe
  init();
  assert.equal(wakeSession('s1', 'hello', { source: 't', key: 'k1' }).queued, true);
  assert.equal(wakeSession('s1', 'hello again', { source: 't', key: 'k1' }).deduped, true);
  await flush();
  assert.equal(calls.length, 1);
  console.log('ok dedupe');

  // 1b. busy session defers
  calls.length = 0; resetSessionWakeForTests();
  let busy = true; init(() => busy);
  wakeSession('s2', 'later', { source: 't' });
  await flush();
  assert.equal(calls.length, 0);
  busy = false; await flush(); await flush();
  assert.equal(calls.length, 1);
  console.log('ok busy-deferral');

  // 2. video wake only when all terminal
  calls.length = 0; resetSessionWakeForTests(); init();
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'vpwake-'));
  const p = await createProject(ws, { title: 'Promo' });
  await mutateProject(ws, p.id, 'test.jobs', (proj: any) => {
    proj.shots = [{ id: 'sh1', title: 'Hook' }];
    proj.jobs = [
      { id: 'j1', state: 'running', target: { shotId: 'sh1' }, takeIds: [], estimateUsd: 1.25 },
      { id: 'j2', state: 'queued', target: { asset: true }, takeIds: [], estimateUsd: 0.5 },
    ];
  });
  watchVideoJobs({ workspacePath: ws, sessionId: 'sv', projectId: p.id, jobIds: ['j1', 'j2'], note: 'Batch A' });
  assert.ok(fs.existsSync(path.join(ws, 'video-projects', '_wake.json')));
  await mutateProject(ws, p.id, 'test.j1', (proj: any) => { proj.jobs[0].state = 'failed'; proj.jobs[0].error = 'nsfw filter'; });
  await flush();
  assert.equal(calls.length, 0, 'must not fire with a pending job');
  await mutateProject(ws, p.id, 'test.j2', (proj: any) => { proj.jobs[1].state = 'done'; });
  await flush();
  assert.equal(calls.length, 1);
  assert.match(calls[0].message, /Jobs finished for Promo .*1 done, 1 failed \(shot 'Hook': nsfw filter\)\. Spent \$0\.50\. Batch A\./);
  assert.equal(listVideoWatches().length, 0);
  console.log('ok video-all-terminal:', calls[0].message);

  // 3. persistence reload re-arms
  calls.length = 0;
  await mutateProject(ws, p.id, 'test.j3', (proj: any) => { proj.jobs.push({ id: 'j3', state: 'running', target: { asset: true }, takeIds: [] }); });
  watchVideoJobs({ workspacePath: ws, sessionId: 'sv', projectId: p.id, jobIds: ['j3'] });
  resetVideoProjectWakeForTests(); // simulate restart
  assert.equal(listVideoWatches().length, 0);
  assert.equal(initVideoProjectWake(ws), 1);
  await mutateProject(ws, p.id, 'test.j3done', (proj: any) => { proj.jobs[2].state = 'done'; });
  await flush();
  assert.equal(calls.length, 1);
  console.log('ok persistence-rearm');

  // 4. timeout
  calls.length = 0;
  await mutateProject(ws, p.id, 'test.j4', (proj: any) => { proj.jobs.push({ id: 'j4', state: 'running', target: { asset: true }, takeIds: [] }); });
  const realNow = Date.now;
  watchVideoJobs({ workspacePath: ws, sessionId: 'sv', projectId: p.id, jobIds: ['j4'] });
  Date.now = () => realNow() + VIDEO_WAKE_TIMEOUT_MS + 1000;
  checkAllVideoWatches();
  Date.now = realNow;
  await flush();
  assert.equal(calls.length, 1);
  assert.match(calls[0].message, /Timed out after 45 min/);
  console.log('ok timeout');
  resetVideoProjectWakeForTests();
  fs.rmSync(ws, { recursive: true, force: true });

  // 5. thread callback
  calls.length = 0;
  registerThreadCallback('origin', 'target');
  assert.ok(hasThreadCallback('target'));
  assert.equal(fireThreadCallbacks('target', 'Research', 'x'.repeat(900)), 1);
  assert.equal(fireThreadCallbacks('target', 'Research', 'again'), 0, 'fires once');
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sessionId, 'origin');
  assert.ok(calls[0].message.startsWith('[thread reply] Research finished: '));
  assert.ok(calls[0].message.length < 660);
  console.log('ok thread-callback');
  console.log('ALL PASS');
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
