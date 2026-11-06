// Isolated connected-memory deletion UI test (PR823 R1 L3/L4). Requires Playwright Chromium or Edge; no gateway/provider/paid calls.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const refsSource = read('web-ui/src/pages/MemoryReferences.js');
const chatSource = read('web-ui/src/pages/ChatPage.js');
const mobileSource = read('web-ui/src/mobile/mobile-shell.js');
const sessionsSource = read('src/gateway/routes/chat/sessions.ts');

// --- Dialog: three explicit choices, accessible, default keep, Escape/backdrop cancel.
assert.match(refsSource, /role="alertdialog"/, 'dialog must expose alertdialog role');
assert.match(refsSource, /aria-modal="true"/);
assert.match(refsSource, /aria-labelledby="mref-delete-title"/);
assert.match(refsSource, /data-choice="cancel"/);
assert.match(refsSource, /data-choice="keep"[^>]*>Delete chat, keep references \(default\)/);
assert.match(refsSource, /data-choice="delete"[^>]*>Delete chat and references/);
assert.match(refsSource, /host\.querySelector\('\[data-choice="keep"\]'\)\.focus\(\)/, 'default choice must be keep');
assert.match(refsSource, /e\.key === 'Escape'\) \{ e\.preventDefault\(\); finish\('cancel'\)/, 'Escape must cancel');
assert.match(refsSource, /e\.target === host\) finish\('cancel'\)/, 'backdrop click must cancel');
const dialogStart = refsSource.indexOf('const DIALOG_BUTTON');
const dialogSection = refsSource.slice(dialogStart, refsSource.indexOf('export async function deleteReferenceSession'));
assert.ok(dialogStart > 0, 'deletion dialog present');
assert.doesNotMatch(dialogSection, /window\.confirm/, 'deletion choice must not use window.confirm (Cancel there meant keep+delete chat)');

// --- Caller semantics: cancel returns before any request; no local removal on cancel.
const fnStart = refsSource.indexOf('export async function deleteReferenceSession');
assert.ok(fnStart > 0, 'deleteReferenceSession exported');
const fnBody = refsSource.slice(fnStart, refsSource.indexOf('\n}\n', fnStart));
const cancelIdx = fnBody.indexOf("choice === 'cancel'");
const fetchIdx = fnBody.indexOf('fetch(');
assert.ok(cancelIdx >= 0 && fetchIdx > cancelIdx, 'cancel must short-circuit before fetch');
assert.match(fnBody, /return \{ cancelled: true \}/);
assert.match(fnBody, /deleteReferences = choice === 'delete'/, 'only the explicit delete choice removes references');
assert.doesNotMatch(dialogSection, /confirm\(/);

// Local removal in ChatPage must be skipped on cancel.
const chatFnStart = chatSource.indexOf('async function deleteChatSession(id, ev)');
assert.ok(chatFnStart > 0, 'deleteChatSession present');
const chatFn = chatSource.slice(chatFnStart, chatSource.indexOf('\n}\n', chatFnStart));
const guardIdx = chatFn.indexOf('.cancelled) return;');
const splice = chatFn.indexOf('splice(idx, 1)');
assert.ok(guardIdx > 0 && splice > guardIdx, 'cancel must return before local session removal');
assert.doesNotMatch(chatSource, /async function deleteSessionFromServer/, 'extraction stays in MemoryReferences.js');

// --- Size ratchet: ChatPage must not grow past the guardrail budget.
const chatBytes = fs.statSync(path.join(root, 'web-ui/src/pages/ChatPage.js')).size;
assert.ok(chatBytes <= 2352734, `ChatPage.js ${chatBytes} bytes exceeds ratchet 2352734`);

// --- Mobile: keep-refs default (checkbox off); cancel path closes without request; partial warning surfaced.
assert.match(mobileSource, /pm-delete-references-too/);
assert.match(mobileSource, /references === 'partial'/);
assert.match(mobileSource, /pmToast\(deleteResult\.warning/);

// --- Backend L4: chat deleted first, reference cleanup failure reports partial with count, not generic 500.
const route = sessionsSource.slice(sessionsSource.indexOf("router.delete('/api/sessions/:id'"));
const cleanup = route.slice(0, route.indexOf("res.json({ success: true, projectId: project?.id, references: 'retained' })"));
assert.match(cleanup, /try \{[\s\S]*library\.metadata\.remove\(ref\.id\)[\s\S]*\} catch \(refError: unknown\)/, 'reference loop must be inside try');
assert.match(cleanup, /references: 'partial', referencesRemoved: removed/);
assert.match(cleanup, /return;\s*\}/);
assert.match(cleanup, /references: 'deleted', referencesRemoved: removed/);
assert.ok(route.indexOf('deleteSession(sessionId)') < route.indexOf('library.metadata.remove'), 'chat deletion precedes reference cleanup');

// --- Browser harness (PR823 R1 deletion-UI probe). Drives the REAL MemoryReferences.js dialog and
// deleteReferenceSession in headless Chromium (channel msedge, fallback bundled chromium).
// Only ../api.js and ../utils.js are replaced by stubs served here; the module under test is served from disk.
// Not executed here: sessions.ts DELETE handler and ChatPage.deleteChatSession (see .pr/DELETION-R1-TEST.md).
import http from 'node:http';
import { chromium } from 'playwright';

const SHOT_DIR = process.env.R1_SCREENSHOT_DIR || path.join(root, '.pr', 'deletion-screenshots');
const DESKTOP = { width: 1440, height: 1000 };
const MOBILE = { width: 390, height: 844 };
const STUBS = {
  '/src/api.js': `export async function api(url, options) { return window.__api(url, options); }`,
  '/src/utils.js': `export function escHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export function showToast(...args) { (window.__toasts ||= []).push(args); }`,
};

function startServer() {
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://127.0.0.1');
    if (pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><body><main id="page-memory"><button id="opener" type="button">Chat menu</button></main></body></html>');
      return;
    }
    if (STUBS[pathname]) { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); res.end(STUBS[pathname]); return; }
    const srcDir = path.resolve(root, 'web-ui', 'src') + path.sep;
    const file = path.resolve(root, 'web-ui', '.' + pathname);
    if (!pathname.startsWith('/src/') || !file.startsWith(srcDir) || !fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': file.endsWith('.css') ? 'text/css' : 'text/javascript; charset=utf-8' });
    res.end(fs.readFileSync(file));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// --- Harness helpers: real module import, controlled api/fetch, deterministic results.
async function launchBrowser() {
  try {
    return { browser: await chromium.launch({ channel: 'msedge', headless: true }), engine: 'msedge' };
  } catch (err) {
    return { browser: await chromium.launch({ headless: true }), engine: `chromium (msedge unavailable: ${String(err.message).split('\n')[0]})` };
  }
}

async function openHarness(browser, base, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message || e)));
  await page.goto(`${base}/`);
  await page.evaluate(() => {
    window.__calls = []; window.__fetch = []; window.__toasts = []; window.__items = []; window.__next = undefined; window.__result = undefined;
    window.__api = async (url) => {
      window.__calls.push(String(url));
      if (String(url).includes('sourceSession=')) return { items: window.__items };
      throw new Error('unexpected api call ' + url);
    };
    window.fetch = async (url, opts = {}) => {
      window.__fetch.push({ url: String(url), method: opts.method || 'GET' });
      if (window.__next) return window.__next;
      return new Response(JSON.stringify({ success: true, references: 'retained' }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
  });
  await page.addScriptTag({ type: 'module', content: "import * as m from '/src/pages/MemoryReferences.js'; window.__mod = m;" });
  await page.waitForFunction(() => !!window.__mod, null, { timeout: 15000 });
  return { context, page, pageErrors };
}

// Starts the real exported deleteReferenceSession from the page with the opener focused (as the chat menu would).
async function startDelete(page, id = 'sess-1') {
  await page.evaluate((sid) => {
    window.__result = undefined;
    document.getElementById('opener').focus();
    window.__mod.deleteReferenceSession(sid).then(r => { window.__result = r; }, e => { window.__result = { error: e.message }; });
  }, id);
}

async function waitResult(page) {
  await page.waitForFunction(() => window.__result !== undefined, null, { timeout: 10000 });
  return page.evaluate(() => window.__result);
}

async function state(page) {
  return page.evaluate(() => ({
    fetch: window.__fetch.slice(),
    toasts: window.__toasts.slice(),
    dialogCount: document.querySelectorAll('[role="alertdialog"]').length,
    active: document.activeElement?.dataset?.choice || document.activeElement?.id || document.activeElement?.tagName,
  }));
}

// --- Scenarios against the real dialog + deleteReferenceSession.
const REF_ITEMS = [{ id: 'r1', title: 'Receipt' }, { id: 'r2', title: 'Plan' }];

async function scenarioCancelPaths(browser, base) {
  const out = {};
  for (const mode of ['cancel-button', 'escape', 'backdrop']) {
    const { context, page } = await openHarness(browser, base, DESKTOP);
    await page.evaluate((items) => { window.__items = items; }, REF_ITEMS);
    await startDelete(page);
    await page.waitForSelector('[role="alertdialog"]');
    if (mode === 'cancel-button') await page.click('[data-choice="cancel"]');
    else if (mode === 'escape') await page.keyboard.press('Escape');
    else await page.mouse.click(4, 4); // outside the centred alertdialog => host backdrop
    const result = await waitResult(page);
    const s = await state(page);
    const focusBack = await page.evaluate(() => document.activeElement?.id === 'opener');
    assert.deepEqual(result, { cancelled: true }, `${mode}: must resolve cancelled`);
    assert.equal(s.fetch.length, 0, `${mode}: no DELETE request may be sent`);
    assert.equal(s.dialogCount, 0, `${mode}: dialog removed`);
    assert.ok(focusBack, `${mode}: focus returns to opener`);
    out[mode] = { cancelled: true, deleteRequests: s.fetch.length, focusReturned: focusBack };
    await context.close();
  }
  return out;
}

async function scenarioDefaultFocusAndKeep(browser, base) {
  const { context, page } = await openHarness(browser, base, DESKTOP);
  await page.evaluate((items) => { window.__items = items; }, REF_ITEMS);
  await startDelete(page);
  await page.waitForSelector('[role="alertdialog"]');
  const focused = await page.evaluate(() => document.activeElement?.dataset?.choice);
  assert.equal(focused, 'keep', 'default focus must be the keep choice');
  const labels = await page.$$eval('[role="alertdialog"] button', bs => bs.map(b => b.textContent.trim()));
  assert.deepEqual(labels, ['Cancel, delete nothing', 'Delete chat, keep references (default)', 'Delete chat and references'], 'button order: Cancel, keep (default), delete');
  await page.keyboard.press('Enter'); // default choice via keyboard
  const result = await waitResult(page);
  const s = await state(page);
  assert.equal(result.cancelled, false);
  assert.equal(s.fetch.length, 1);
  assert.equal(s.fetch[0].method, 'DELETE');
  assert.equal(s.fetch[0].url, '/api/sessions/sess-1', 'keep must delete without deleteReferences query');
  assert.equal(s.dialogCount, 0);
  await context.close();
  return { defaultFocus: focused, labels, keepDeleteUrl: s.fetch[0].url };
}

async function scenarioDeleteBoth(browser, base) {
  const { context, page } = await openHarness(browser, base, DESKTOP);
  await page.evaluate((items) => { window.__items = items; }, REF_ITEMS);
  await startDelete(page, 'sess-2');
  await page.waitForSelector('[role="alertdialog"]');
  await page.click('[data-choice="delete"]');
  const result = await waitResult(page);
  const s = await state(page);
  assert.equal(s.fetch.length, 1);
  assert.equal(s.fetch[0].url, '/api/sessions/sess-2?deleteReferences=true', 'delete choice must send deleteReferences=true');
  assert.equal(s.fetch[0].method, 'DELETE');
  assert.equal(result.cancelled, false);
  await context.close();
  return { url: s.fetch[0].url };
}

async function scenarioNoReferencesNoDialog(browser, base) {
  const { context, page } = await openHarness(browser, base, DESKTOP);
  await page.evaluate(() => { window.__items = []; });
  await startDelete(page, 'sess-3');
  const result = await waitResult(page);
  const s = await state(page);
  assert.equal(s.dialogCount, 0, 'no dialog when the chat has no references');
  assert.equal(s.fetch.length, 1);
  assert.equal(s.fetch[0].url, '/api/sessions/sess-3', 'no-reference delete must not carry deleteReferences');
  assert.equal(result.cancelled, false);
  await context.close();
  return { url: s.fetch[0].url };
}

async function scenarioFocusTrapAndPartial(browser, base) {
  const { context, page } = await openHarness(browser, base, DESKTOP);
  await page.evaluate((items) => { window.__items = items; }, REF_ITEMS);
  await startDelete(page, 'sess-4');
  await page.waitForSelector('[role="alertdialog"]');
  const order = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Tab');
    order.push(await page.evaluate(() => document.activeElement?.dataset?.choice));
  }
  assert.deepEqual(order, ['delete', 'cancel', 'keep'], 'Tab must cycle within the dialog (wrap to keep)');
  await page.keyboard.press('Shift+Tab');
  const back = await page.evaluate(() => document.activeElement?.dataset?.choice);
  assert.equal(back, 'cancel', 'Shift+Tab from keep must wrap to the last button');
  // Partial cleanup: server reports chat deleted but references incomplete.
  await page.evaluate(() => {
    window.__next = new Response(JSON.stringify({ success: true, references: 'partial', referencesRemoved: 1, warning: 'Chat deleted, reference cleanup incomplete' }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  await page.click('[data-choice="keep"]');
  const result = await waitResult(page);
  const s = await state(page);
  assert.equal(result.cancelled, false, 'partial result must not be treated as cancelled (chat is deleted)');
  assert.equal(result.success, true);
  assert.equal(result.references, 'partial');
  assert.equal(result.referencesRemoved, 1);
  assert.equal(s.toasts.length, 1, 'partial must raise exactly one warning toast');
  assert.equal(s.toasts[0][2], 'warning');
  assert.match(s.toasts[0][0], /Chat deleted, reference cleanup incomplete/);
  await context.close();
  return { focusOrder: order, shiftTabFrom: 'keep->cancel', partial: { references: result.references, referencesRemoved: result.referencesRemoved, toast: s.toasts[0][0], tone: s.toasts[0][2] } };
}

// --- Mobile warning path (static: mobile-shell has its own delete sheet, not the MemoryReferences dialog).
assert.match(mobileSource, /id="pm-delete-references-too">/, 'mobile sheet exposes the references checkbox');
assert.match(mobileSource, /Saved references are kept unless checked/, 'mobile default keeps references');
assert.match(mobileSource, /\?\.checked \? '\?deleteReferences=true' : ''/, 'mobile sends deleteReferences only when checked');
assert.match(mobileSource, /deleteResult && deleteResult\.references === 'partial'/, 'mobile reads partial result');
assert.match(mobileSource, /pmToast\(deleteResult\.warning \|\| 'Chat deleted, but some references could not be removed/, 'mobile partial warning toast');

// --- Runner
async function screenshotDialog(browser, base, name, viewport) {
  const { context, page } = await openHarness(browser, base, viewport);
  await page.evaluate((items) => { window.__items = items; }, REF_ITEMS);
  await startDelete(page, 'sess-shot');
  await page.waitForSelector('[role="alertdialog"]');
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const file = path.join(SHOT_DIR, `r1-delete-${name}.png`);
  await page.screenshot({ path: file });
  await page.keyboard.press('Escape');
  await waitResult(page);
  await context.close();
  return file;
}

async function main() {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const { browser, engine } = await launchBrowser();
  const report = { engine };
  try {
    report.cancelPaths = await scenarioCancelPaths(browser, base);
    report.defaultKeep = await scenarioDefaultFocusAndKeep(browser, base);
    report.deleteBoth = await scenarioDeleteBoth(browser, base);
    report.noReferences = await scenarioNoReferencesNoDialog(browser, base);
    report.focusAndPartial = await scenarioFocusTrapAndPartial(browser, base);
    report.screenshots = [
      await screenshotDialog(browser, base, 'desktop', DESKTOP),
      await screenshotDialog(browser, base, 'mobile', MOBILE),
    ];
    if (process.env.R1_REPORT_JSON) fs.writeFileSync(process.env.R1_REPORT_JSON, JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
  return report;
}

const report = await main();
console.log(JSON.stringify(report, null, 2));
console.log('test-connected-memory-deletion: ok');
