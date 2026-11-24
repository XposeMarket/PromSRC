import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

// Run the shipped card bridge, busy-send branch and durable queue in a phone-sized
// browser. Replace the gateway and chat shell only; no real chat receives a send.
const read = path => readFileSync(new URL('../web-ui/src/' + path, import.meta.url), 'utf8');
const src = read('mobile/mobile-chat-page-runtime.js');
const start = src.indexOf('    const enqueueDurably = async (sid,');
const end = src.indexOf('    const retryingQueueReceipt', start);
assert.ok(start > 0 && end > start);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await page.route('http://localhost/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path !== '/') return route.fulfill({contentType: 'text/javascript', body: read(path.slice(1))});
    return route.fulfill({contentType: 'text/html', body: `<meta name="viewport" content="width=device-width,initial-scale=1"><main></main><textarea>My unrelated draft</textarea><output></output>`});
  });
  await page.goto('http://localhost/');
  await page.evaluate(async branch => {
    const { installPromCards } = await import('/cards/card-runtime.js');
    const { createMobileDurableQueue } = await import('/mobile/mobile-durable-queue.js');
    const { renderInteractiveCard } = await import('/cards/cards-interactive.js');
    const input = document.querySelector('textarea');
    const posts = window.posts = []; window.steers = [];
    const sid = 'chat'; const sendGatewayId = 'test'; let active = true;
    const filesOnDraft = [{ name: 'draft-only.txt' }];
    const durableQueue = createMobileDurableQueue({runtimeId: () => 'test-run', report: msg => { throw new Error(msg); }, target: () => ({sessionId:sid, gatewayId:sendGatewayId}), pinFetch: () => async (_path, opts) => {
      if (window.leave) active = false;
      if (!opts) return {items: []};
      const item = JSON.parse(opts.body); if (item.action) { window.steers.push(item.id); return {items: []}; }
      posts.push(item); return {items: [], id: item.id};
    }});
    const __pmChat = {}; const selectedSkillIds = [], excludedSkillIds = [];
    const stillInChat = () => active; const _pmGetComposerValue = () => input.value;
    const getPendingAttachments = () => filesOnDraft; const composerAttachments = [...filesOnDraft];
    const { shouldAutoSteerBusyTurn } = await import('/features/chat/runtime/busy-composer-mode.js');
    const locallyBusy = true, pinMobileGatewayFetch = () => async () => ({ session: { busyComposerMode: window.testMode } });
    const pmToast = msg => {document.querySelector('output').textContent = msg};
    window.__pmMobileSendMessage = async (msg, options = {}) => {
      const files = options.attachments || filesOnDraft;
      return eval(`(async () => { ${branch}; return enqueueDurably(sid); })()`);
    };
    document.querySelector('main').innerHTML = renderInteractiveCard('followups','test',JSON.stringify(['First prompt','Second prompt','Leave chat']));
    installPromCards();
  }, src.slice(start,end));
  await page.getByText('First prompt',{exact:true}).tap();
  await page.waitForSelector('button.sent');
  await page.evaluate(() => { window.testMode = 'steer' });
  await page.getByText('Second prompt',{exact:true}).tap();
  await page.waitForFunction(() => document.querySelectorAll('button.sent').length === 2);
  await page.waitForFunction(() => window.steers.length === 1);
  assert.deepEqual(await page.evaluate(() => steers), [await page.evaluate(() => posts[1].id)]);
  assert.deepEqual(await page.evaluate(() => posts.map(p => [p.message,p.attachments])), [['First prompt',[]],['Second prompt',[]]]);
  assert.equal(await page.locator('textarea').inputValue(),'My unrelated draft');
  if (process.env.CARD_QUEUE_SCREENSHOT) await page.screenshot({path:process.env.CARD_QUEUE_SCREENSHOT});
  await page.evaluate(() => {window.leave=true});
  await page.getByText('Leave chat',{exact:true}).tap();
  await page.waitForFunction(() => document.querySelector('output').textContent.includes('Nothing new was queued'));
  assert.equal(await page.locator('button.sent').count(),2);
  assert.equal(await page.evaluate(() => posts.length),2);
  console.log('PASS: two acknowledged busy-chat card sends, draft and files preserved, stale navigation rejected without sent state.');
} finally { await browser.close(); }
