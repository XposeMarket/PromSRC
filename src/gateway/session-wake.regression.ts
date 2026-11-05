import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  initSessionWake, wakeSession, resetSessionWakeForTests, registerThreadCallback, fireThreadCallbacks, hasThreadCallback,
} from './session-wake';
import {
  watchVideoJobs, initVideoProjectWake, resetVideoProjectWakeForTests, listVideoWatches, checkAllVideoWatches, VIDEO_WAKE_TIMEOUT_MS, setVideoAutoQaForTests,
} from './video-project-wake';
import { createProject, mutateProject } from '../media-engine/project.js';
import ts from 'typescript';

const SERVER_WAKE_ARGS = ['message', 'sessionId', 'sendSSE', 'pinnedMessages', 'abortSignal', 'callerContext', 'reasoningOptions', 'attachments', 'attachmentPreviews', 'modelOverride', 'flags', 'turnOriginInput'];

// Source-level check of the real server-v2 adapter: parses the initSessionWake({ runInteractiveTurn }) arrow and verifies it
// accepts and forwards every wake arg in order, so turnOriginInput (the 12th) cannot be dropped again.
function assertServerWakeAdapterForwardsOrigin(): void {
  const file = path.resolve(__dirname, 'server-v2.ts');
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const adapters: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'initSessionWake') {
      const cfg = node.arguments[0];
      if (cfg && ts.isObjectLiteralExpression(cfg)) {
        for (const prop of cfg.properties) {
          if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'runInteractiveTurn') adapters.push(prop.initializer);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  assert.equal(adapters.length, 1, 'server-v2 must wire exactly one initSessionWake runInteractiveTurn adapter');
  const adapter = adapters[0];
  if (!ts.isArrowFunction(adapter)) throw new Error('initSessionWake adapter must be an arrow function');
  assert.deepEqual(adapter.parameters.map((p) => p.name.getText(sf)), SERVER_WAKE_ARGS, 'adapter must accept all 12 wake args');
  const body = adapter.body;
  if (!ts.isCallExpression(body)) throw new Error('initSessionWake adapter body must be a direct call');
  assert.equal(body.expression.getText(sf), 'runInteractiveTurn');
  assert.deepEqual(body.arguments.map((a) => a.getText(sf)), SERVER_WAKE_ARGS, 'adapter must forward every wake arg in order (turnOriginInput included)');
}

const calls: Array<{ sessionId: string; message: string; origin?: any }> = [];
const flush = () => new Promise((r) => setTimeout(r, 30));
function init(busy?: () => boolean) {
  initSessionWake({
    runInteractiveTurn: async (message: string, sessionId: string, _sendSSE: unknown, _pinned: unknown, _abort: unknown, _ctx: unknown, _reasoning: unknown, _attachments: unknown, _previews: unknown, _model: unknown, _flags: unknown, turnOriginInput: unknown): Promise<any> => { calls.push({ sessionId, message, origin: turnOriginInput }); return { type: 'done', text: 'ok' }; },
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
  assert.match(calls[0].message, /Jobs finished for Promo .*1 done, 1 failed \(shot 'Hook': nsfw filter\)\. Spent \$0\.50\. Only 1 of 2 succeeded; fix the failed shot\(s\) before assembling\./);
  assert.doesNotMatch(calls[0].message, /Batch A/, 'success note dropped on partial batches');
  assert.doesNotMatch(calls[0].message, /Shots generated/);
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

  // 4b. dense auto-QA gate runs before the wake and reports FAIL takes
  calls.length = 0;
  const seen: string[][] = [];
  setVideoAutoQaForTests({ runner: async (_ws, _pid, ids) => { seen.push(ids); return { results: [{ title: 'Hook', score: 4, verdict: 'reroll', issues: ['@0.75s shirt splits open down the middle'] }], failed: [] }; } });
  await mutateProject(ws, p.id, 'test.j5', (proj: any) => { proj.jobs.push({ id: 'j5', state: 'running', target: { shotId: 'sh1' }, takeIds: [], estimateUsd: 0.5 }); });
  watchVideoJobs({ workspacePath: ws, sessionId: 'sv', projectId: p.id, jobIds: ['j5'], note: 'Shots generated.' });
  await mutateProject(ws, p.id, 'test.j5done', (proj: any) => { const j = proj.jobs.find((x: any) => x.id === 'j5'); j.state = 'done'; j.actualUsd = 0.5; });
  await flush(); await flush();
  assert.deepEqual(seen, [['sh1']]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].message, /Dense QA FAILED 1 take/);
  assert.match(calls[0].message, /FAIL 'Hook' 4\/10: @0\.75s shirt splits/);
  console.log('ok auto-qa-gate');
  setVideoAutoQaForTests({ runner: null });
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
  assert.deepEqual(calls[0].origin, { channel: 'system', surface: 'automation', device: 'server' }, 'async wake must carry trusted system origin (no owner personal-reference access)');
  assert.ok(calls[0].message.startsWith('[thread reply] Research finished: '));
  assert.ok(calls[0].message.length < 660);
  console.log('ok thread-callback');

  // 6. real server adapter forwards the wake origin
  assertServerWakeAdapterForwardsOrigin();
  console.log('ok server-adapter-forwarding');
  console.log('ALL PASS');
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
