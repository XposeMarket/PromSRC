import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const transport = await import(pathToFileURL(path.join(root, 'dist/gateway/user-chrome-transport.js')).href);
const calls = [];
const relay = { request: async (method, params) => {
  calls.push({ method, params });
  if (method === 'tabs.list') return [{ id: 7, active: true, windowId: 3, title: 'Active', url: 'https://before.test', width: 800, height: 600 }];
  if (method === 'tabs.get') return { id: 7, active: true, windowId: 3, title: 'After', url: 'https://after.test', width: 800, height: 600 };
  if (method === 'cdp') {
    if (params.method === 'Runtime.evaluate') return { result: { value: 42 } };
    if (params.method === 'Page.captureScreenshot') return { data: Buffer.from('png-bytes').toString('base64') };
    if (params.method === 'Page.getNavigationHistory') return { currentIndex: 1, entries: [{ id: 1 }, { id: 2 }, { id: 3 }] };
    return {};
  }
  return true;
} };
transport.setUserChromeRelayFactoryForTesting(() => relay);
const page = await transport.createUserChromePage();
await page.goto('https://after.test'); assert.equal(page.url(), 'https://after.test');
assert.equal(await page.evaluate((n) => n * 2, 21), 42);
await page.locator('#go').click(); await page.locator('#field').fill('hello');
await page.keyboard.type('typed'); await page.keyboard.press('Control+A'); await page.mouse.wheel(0, 120); await page.mouse.click(10, 20);
assert.deepEqual(await page.screenshot(), Buffer.from('png-bytes'));
await page.goBack(); await page.goForward(); await page.bringToFront(); await page.close();
await assert.rejects(page.evaluateHandle(() => null), /uploads are intentionally unsupported/);
await assert.rejects(page.waitForEvent('download'), /Download event streaming is unavailable/);
assert.ok(calls.some(c => c.method === 'tabs.navigate' && c.params.url === 'https://after.test'));
assert.ok(calls.some(c => c.method === 'cdp' && c.params.method === 'Runtime.evaluate'));
assert.ok(calls.some(c => c.method === 'cdp' && c.params.method === 'Input.dispatchMouseEvent'));
assert.ok(calls.some(c => c.method === 'cdp' && c.params.method === 'Input.insertText'));
assert.ok(calls.some(c => c.method === 'cdp' && c.params.method === 'Page.captureScreenshot'));
assert.equal(calls.filter(c => c.method === 'cdp' && c.params.method === 'Page.navigateToHistoryEntry').length, 2);
transport.setUserChromeRelayFactoryForTesting();
console.log('PASS: Personal Chrome transport navigation, evaluate, DOM actions, input, screenshot, history, tabs, and explicit gaps');
