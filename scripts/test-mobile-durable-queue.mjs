import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { setTimeout as wait } from 'node:timers/promises';
import { chromium, devices } from 'playwright';
import express from 'express';

// Real paired-auth queue routes + a deterministic chat runner; never starts
// the production gateway or calls a model provider.
const fixture = mkdtempSync(join(tmpdir(), 'prom-mobile-queue-'));
process.env.PROMETHEUS_APP_DATA_DIR = fixture;
process.env.PROMETHEUS_DATA_DIR = fixture;
process.env.PROMETHEUS_WORKSPACE_DIR = join(fixture, 'workspace');
process.env.PROMETHEUS_RUNTIME_DIR = join(fixture, 'runtime');
const { createPairingChallenge, createPendingRequest, approvePendingRequest, setDeviceEnabled } = await import('../src/gateway/pairing/pairing-store.ts');
const { touchSession, addMessage, flushSession } = await import('../src/gateway/session.ts');
const { registerMobileMainChatQueue, mobileQueueBlocksNewTurn, stopMobileMainChatQueue } = await import('../src/gateway/routes/chat/mobile-queue.ts');
const { registerMobileRoutes } = await import('../src/gateway/routes/chat/mobile.ts');
// Match the extensionless gateway route's module instance (tsx can load .ts as ESM too).
const { registerLiveRuntime, finishLiveRuntime } = createRequire(import.meta.url)('../src/gateway/live-runtime-registry');
const { mainChatTurnCoordinator } = await import('../src/gateway/chat/turn-coordinator.ts');
const challenge = createPairingChallenge();
const request = createPendingRequest({ challengeId: challenge.id, deviceName: 'Test phone', deviceFingerprint: 'fixture', userAgent: '', ipHint: '' });
const { deviceToken, device } = approvePendingRequest(request.id);
const sid = 'queue_fixture_chat';
const other = 'queue_other_chat';
for (const id of [sid, other]) {
  touchSession(id, { channel: 'mobile' });
  addMessage(id, { role: 'user', content: 'Existing chat', timestamp: Date.now() }, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
  assert.equal(flushSession(id), true);
}
const initialTurn = mainChatTurnCoordinator.tryAcquire(sid);
assert.ok(initialTurn);
const messages = [];
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jORQAAAAASUVORK5CYII=';
const uploads = join(fixture, 'workspace', 'uploads');
mkdirSync(uploads, { recursive: true });
writeFileSync(join(uploads, 'fixture.png'), Buffer.from(png, 'base64'));
writeFileSync(join(uploads, 'fixture.txt'), 'exact text from disk');
const app = express();
app.use(express.json());
registerMobileRoutes(app, { requireSafeSessionParam: (_req, _res, next) => next(),
  pruneMainChatStreams: () => {}, reconcileMainChatTurn: () => ({ active: false }), storageAwareStatus: () => 500 });
app.get('/fixture', (_req, res) => res.type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body class="pm-mobile-active"><p>Mobile chat queue fixture</p><textarea id="draft" aria-label="Draft"></textarea><div id="queue" class="pm-mobile-queued-prompts" hidden></div><script type="module">
import { createMobileDurableQueue } from '/client.js';
window.sessionId = '${sid}';
const pinFetch = () => async (path, init) => {
  const response = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', 'X-Pairing-Token': ${JSON.stringify(deviceToken)} } });
  if (!response.ok) throw Object.assign(new Error('HTTP ' + response.status), { status: response.status });
  const payload = await response.json();
  if (path === '/api/chat/mobile-queue' && init?.method === 'POST' && window.dropNextReceipt) {
    window.dropNextReceipt = false;
    throw new Error('lost the acknowledged response');
  }
  return payload;
};
window.queue = createMobileDurableQueue({ panel: document.querySelector('#queue'), target: () => ({gatewayId:'local-test',sessionId:window.sessionId}), pinFetch,
  report: console.warn, escape:(text)=>{const s=document.createElement('span');s.textContent=text;return s.innerHTML;}, runtimeId: () => '', upload: async () => [] });
const draft = document.querySelector('#draft');
draft.value = localStorage.getItem('fixture-draft') || '';
draft.addEventListener('input', () => {
  window.queue.invalidateDraft({ gatewayId: 'local-test', sessionId: window.sessionId });
  localStorage.setItem('fixture-draft', draft.value);
});
await window.queue.refresh();
window.fixtureReady=true;
</script></body></html>`));
app.get('/client.js', (_req, res) => res.type('js').send(readFileSync(new URL('../web-ui/src/mobile/mobile-durable-queue.js', import.meta.url), 'utf8')));
app.get('/fixture.css', (_req, res) => res.type('css').send(readFileSync(new URL('../web-ui/src/styles/mobile.css', import.meta.url), 'utf8')));
const start = registerMobileMainChatQueue(app, {
  isBusy: id => mainChatTurnCoordinator.isActive(id),
  steer: () => ({ status: 409, body: { error: 'No active steerable turn.' } }),
  run: async (item) => {
    if (item.body.message === 'Unavailable model') return 'not_started';
    if (item.body.message.startsWith('Review attached files')) {
      assert.equal(item.body.attachments[0].base64, png);
      assert.match(item.body.message, /exact text from disk/);
      assert.doesNotMatch(item.body.message, /untrusted inline copy/);
      assert.deepEqual(item.body.selectedSkillIds, ['local-test-skill']);
    }
    messages.push({ id: item.id, sessionId: item.sessionId, text: item.body.message });
    addMessage(item.sessionId, { role: 'user', content: item.body.message, timestamp: Date.now(), clientRequestId: item.id }, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
    return 'finished';
  },
});
start(() => true);
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const auth = { 'X-Pairing-Token': deviceToken, 'Content-Type': 'application/json' };
const requestQueue = (path, opts = {}, headers = auth) => fetch(`${origin}/api/chat/mobile-queue${path}`, { ...opts, headers });
try {
  assert.equal((await requestQueue(`?sessionId=${sid}`, {}, {})).status, 401);
  assert.equal((await requestQueue('?sessionId=deleted_session')).status, 404);
  assert.equal((await requestQueue(`?sessionId=${sid}`)).status, 200);
  browser = await chromium.launch({ headless: true });
  let context = await browser.newContext(devices['iPhone 13']);
  let page = await context.newPage();
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  await page.goto(`${origin}/fixture`);
  await page.waitForFunction(() => window.fixtureReady);
  const receipts = await page.evaluate(async () => [
    await window.queue.enqueue({ gatewayId:'local-test', sessionId:window.sessionId }, 'First follow-up', [], {}),
    await window.queue.enqueue({ gatewayId:'local-test', sessionId:window.sessionId }, 'Second follow-up', [], {}),
  ]);
  assert.equal(new Set(receipts.map(item => item.id)).size, 2);
  assert.deepEqual(await page.locator('.pm-mobile-queued-text').allTextContents(), ['First follow-up', 'Second follow-up']);
  assert.deepEqual(messages, []);
  await page.evaluate(async id => { window.sessionId = id; await window.queue.refresh(); }, other);
  assert.equal(await page.locator('#queue').isHidden(), true);
  await page.evaluate(async id => { window.sessionId = id; await window.queue.refresh(); }, sid);
  assert.equal(await page.locator('.pm-mobile-queued-item').count(), 2);
  assert.deepEqual(browserErrors, []);
  if (process.env.PROM_MOBILE_QUEUE_SCREENSHOT) await page.screenshot({ path: process.env.PROM_MOBILE_QUEUE_SCREENSHOT });
  await context.close(); // discard all client JS state before releasing the active turn
  mainChatTurnCoordinator.release(initialTurn);
  for (let tries = 0; tries < 50 && messages.length < 2; tries++) await wait(100);
  assert.deepEqual(messages.map(item => [item.sessionId, item.text]), [[sid, 'First follow-up'], [sid, 'Second follow-up']]);
  assert.deepEqual(messages.map(item => item.id), receipts.map(item => item.id));
  context = await browser.newContext(devices['iPhone 13']);
  page = await context.newPage();
  await page.goto(`${origin}/fixture`);
  await page.waitForFunction(() => window.fixtureReady);
  assert.equal(await page.locator('#queue').isHidden(), true);

  const lease = mainChatTurnCoordinator.tryAcquire(sid);
  assert.ok(lease);
  await page.evaluate(() => { window.dropNextReceipt = true; });
  const retrySend = () => page.evaluate(() => window.queue.enqueue({ gatewayId: 'local-test', sessionId: window.sessionId }, 'Held on Stop', [], {}));
  await assert.rejects(retrySend, /lost the acknowledged response/);
  const lostSnapshot = await (await requestQueue(`?sessionId=${sid}`)).json();
  assert.equal(lostSnapshot.items.length, 1);
  await page.reload();
  await page.waitForFunction(() => window.fixtureReady);
  assert.equal((await retrySend()).id, lostSnapshot.items[0].id, 'cold receipt lookup must not enqueue a duplicate');
  assert.equal((await (await requestQueue(`?sessionId=${sid}`)).json()).items.length, 1);
  let aborted = false;
  const runtimeId = registerLiveRuntime({ kind: 'main_chat', sessionId: sid, deferTerminalCleanup: true, onAbort: () => { aborted = true; } });
  const stop = await fetch(`${origin}/api/mobile/commands/stop-now`, { method: 'POST', headers: auth,
    body: JSON.stringify({ sessionId: sid, source: 'desktop_stop_button' }) });
  const stopResult = await stop.json();
  assert.equal(stopResult.success, true, JSON.stringify(stopResult));
  assert.equal(aborted, true);
  finishLiveRuntime(runtimeId);
  mainChatTurnCoordinator.release(lease);
  assert.equal(mobileQueueBlocksNewTurn(sid), true, 'new sends cannot overtake a held follow-up');
  await wait(1200);
  assert.equal(messages.length, 2);
  await page.evaluate(() => window.queue.refresh());
  assert.equal(await page.getByRole('button', { name: 'Resume' }).count(), 1);
  assert.equal(await page.locator('[role="status"]').textContent(), 'Stopped. Resume when you’re ready.');
  await page.getByRole('button', { name: 'Resume' }).click();
  for (let i = 0; i < 30 && messages.length === 2; i++) await wait(100);
  assert.equal(messages.at(-1).id, lostSnapshot.items[0].id);
  assert.equal(messages.length, 3);
  const submit = (id, message, extra = {}) => requestQueue('', { method: 'POST', body: JSON.stringify({ id, sessionId: other, message, ...extra }) });
  const otherState = async () => (await requestQueue(`?sessionId=${other}`)).json();
  const awaitState = async (predicate) => {
    for (let i = 0; i < 40; i++) {
      const state = await otherState();
      if (predicate(state)) return state;
      await wait(100);
    }
    assert.fail(`Expected queue state, got ${JSON.stringify(await otherState())}`);
  };
  assert.equal((await submit('mq_unavailable_model', 'Unavailable model')).status, 202);
  const unavailable = await awaitState(state => state.paused === 'model_unavailable');
  assert.equal(unavailable.items[0].state, 'pending');
  assert.equal(unavailable.items[0].message, 'Unavailable model');
  const action = (type, extra = {}) => requestQueue('/action', { method: 'POST', body: JSON.stringify({ action: type, sessionId: other, ...extra }) });
  assert.equal((await action('edit', { id: unavailable.items[0].id, message: 'Model fixed' })).status, 200);
  assert.equal((await action('resume')).status, 200);
  await awaitState(state => state.items.length === 0);
  assert.equal(messages.at(-1).text, 'Model fixed');

  const image = { path: 'uploads/fixture.png', mimeType: 'image/png', name: 'fixture.png', kind: 'image' };
  assert.equal((await submit('mq_outside_uploads', 'Reject outside file', { attachments: [{ ...image, path: 'uploads/../fixture.png' }] })).status, 400);
  assert.equal((await submit('mq_attach_fixture', 'Review attached files', { fileContext: 'untrusted inline copy', selectedSkillIds: ['local-test-skill'], attachments: [image,
    { path: 'uploads/fixture.txt', mimeType: 'text/plain', name: 'fixture.txt', kind: 'text' }] })).status, 202);
  await awaitState(state => state.items.length === 0);
  assert.equal(messages.at(-1).id, 'mq_attach_fixture');
  const uploadLease = mainChatTurnCoordinator.tryAcquire(other);
  assert.ok(uploadLease);
  assert.equal((await submit('mq_changed_upload', 'Detect changed file', { attachments: [image] })).status, 202);
  writeFileSync(join(uploads, 'fixture.png'), 'changed after receipt');
  mainChatTurnCoordinator.release(uploadLease);
  const changed = await awaitState(state => state.paused === 'attachment_unavailable');
  assert.equal(changed.items[0].message, 'Detect changed file');
  assert.equal((await action('cancel', { id: changed.items[0].id })).status, 200);
  assert.deepEqual(await otherState(), { paused: null, items: [] });
  await page.evaluate(id => { window.sessionId = id; }, other);
  await page.getByRole('textbox', { name: 'Draft' }).fill('Same text, separate sends');
  const sendDraft = () => page.evaluate(() => window.queue.enqueue({ gatewayId: 'local-test', sessionId: window.sessionId }, document.querySelector('#draft').value, [], {}));
  await page.evaluate(() => { window.dropNextReceipt = true; });
  await assert.rejects(sendDraft, /lost the acknowledged response/);
  await awaitState(state => state.items.length === 0);
  const earlierId = messages.at(-1).id;
  await page.getByRole('textbox', { name: 'Draft' }).fill('');
  await page.getByRole('textbox', { name: 'Draft' }).fill('Same text, separate sends');
  const laterId = (await sendDraft()).id;
  assert.notEqual(laterId, earlierId, 'a discarded draft must not reuse an old receipt');
  await awaitState(state => state.items.length === 0);
  assert.deepEqual(messages.filter(row => row.text === 'Same text, separate sends').map(row => row.id), [earlierId, laterId]);
  setDeviceEnabled(device.id, false);
  assert.equal((await requestQueue(`?sessionId=${sid}`)).status, 401);
  console.log('Mobile Chromium fixture passed: leave/return, close all client state, FIFO while closed, fresh reopen, lost response/reload, identical new draft, desktop Stop route, held-queue FIFO, unavailable model/edit/resume, immutable image and text refs, and revoked device.');
} finally {
  stopMobileMainChatQueue();
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  try { rmSync(fixture, { recursive: true, force: true }); } catch { /* Windows may hold an audit handle until process exit. */ }
}
