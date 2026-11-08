// Regression: mobile drawer search pill morph (mobile-drawer-search-morph.js).
// Part 1: fake-DOM state/listener contract (always runs, no browser).
// Part 2: real Chromium geometry with the real mobile.css + a simulated
//   visualViewport keyboard (skipped with a notice if Playwright Chromium is
//   unavailable). `--shoot <dir>` also writes before/focused/keyboard/after PNGs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modUrl = pathToFileURL(path.join(root, 'web-ui/src/mobile/mobile-drawer-search-morph.js')).href;
const { attachDrawerSearchMorph, measureDrawerKeyboardInset, DRAWER_SEARCH_MORPH_CLASS, DRAWER_SEARCH_LIFT_CLASS, DRAWER_SEARCH_INSET_VAR } = await import(modUrl);

// ---------- Part 1: fake DOM ----------
class Target {
  constructor() { this.l = new Map(); }
  addEventListener(t, f) { if (!this.l.has(t)) this.l.set(t, new Set()); this.l.get(t).add(f); }
  removeEventListener(t, f) { this.l.get(t)?.delete(f); }
  count() { let n = 0; for (const s of this.l.values()) n += s.size; return n; }
  fire(t, ev = {}) { for (const f of [...(this.l.get(t) || [])]) f({ type: t, ...ev }); }
}
function makeEl() {
  const el = new Target();
  const cls = new Set();
  const style = new Map();
  el.classList = { add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)), toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), contains: (c) => cls.has(c) };
  el.style = { setProperty: (k, v) => style.set(k, v), removeProperty: (k) => style.delete(k), getPropertyValue: (k) => style.get(k) || '' };
  return el;
}
function makeWorld({ vv = true } = {}) {
  const bar = makeEl();
  const input = makeEl();
  input.value = 'abc';
  const win = new Target();
  win.innerHeight = 800;
  win.document = { activeElement: null, documentElement: { clientHeight: 800 } };
  win.requestAnimationFrame = (f) => { f(); return 0; };
  win.cancelAnimationFrame = () => {};
  if (vv) { win.visualViewport = new Target(); win.visualViewport.height = 800; win.visualViewport.offsetTop = 0; }
  input.blur = () => { win.document.activeElement = null; input.fire('blur'); };
  input.focus = () => { win.document.activeElement = input; input.fire('focus'); };
  const drawer = { querySelector: (s) => (s === '.pm-drawer-bottom-bar' ? bar : s === '#pm-drawer-search-input' ? input : null) };
  return { bar, input, win, drawer };
}

{
  const w = makeWorld();
  const m = attachDrawerSearchMorph(w.drawer, { win: w.win });
  assert.equal(w.input.count(), 3, 'focus/blur/keydown wired');
  assert.equal(m.isActive(), false);
  w.input.focus();
  assert.ok(w.bar.classList.contains(DRAWER_SEARCH_MORPH_CLASS), 'focus morphs');
  assert.equal(w.bar.style.getPropertyValue(DRAWER_SEARCH_INSET_VAR), '0px');
  assert.equal(m.listenerCount(), 4);
  assert.equal(w.win.count() + w.win.visualViewport.count(), 4, 'viewport listeners only while focused');
  // keyboard opens
  w.win.visualViewport.height = 480; w.win.visualViewport.fire('resize');
  assert.equal(w.bar.style.getPropertyValue(DRAWER_SEARCH_INSET_VAR), '320px');
  assert.ok(w.bar.classList.contains(DRAWER_SEARCH_LIFT_CLASS));
  // small URL-bar delta is ignored, keyboard hide keeps morph but drops lift
  w.win.visualViewport.height = 760; w.win.visualViewport.fire('resize');
  assert.equal(w.bar.style.getPropertyValue(DRAWER_SEARCH_INSET_VAR), '0px');
  assert.ok(!w.bar.classList.contains(DRAWER_SEARCH_LIFT_CLASS));
  assert.ok(w.bar.classList.contains(DRAWER_SEARCH_MORPH_CLASS), 'keyboard hide keeps wide field while focused');
  // orientation re-measures
  w.win.innerHeight = 390; w.win.document.documentElement.clientHeight = 390; w.win.visualViewport.height = 200; w.win.fire('orientationchange');
  assert.equal(w.bar.style.getPropertyValue(DRAWER_SEARCH_INSET_VAR), '190px');
  // Escape collapses without bubbling to drawer close
  let stopped = false;
  w.input.fire('keydown', { key: 'Escape', stopPropagation: () => { stopped = true; } });
  assert.ok(stopped, 'Escape does not reach the drawer-close handler');
  assert.equal(m.isActive(), false);
  assert.ok(!w.bar.classList.contains(DRAWER_SEARCH_MORPH_CLASS));
  assert.equal(w.bar.style.getPropertyValue(DRAWER_SEARCH_INSET_VAR), '');
  assert.equal(w.win.count() + w.win.visualViewport.count(), 0, 'no leaked viewport listeners');
  assert.equal(w.input.value, 'abc', 'value preserved');
  // re-focus / blur cycles do not accumulate listeners
  for (let i = 0; i < 5; i++) { w.input.focus(); w.input.blur(); }
  assert.equal(w.win.count() + w.win.visualViewport.count(), 0);
  // drawer close path: deactivate while focused
  w.input.focus(); m.deactivate();
  assert.equal(m.isActive(), false); assert.equal(w.win.count() + w.win.visualViewport.count(), 0);
  m.dispose();
  assert.equal(w.input.count(), 0, 'dispose removes input listeners');
  // composer keyboard state never touched
  assert.ok(!w.bar.classList.contains('pm-keyboard-open'));
}
{
  const w = makeWorld({ vv: false });
  const m = attachDrawerSearchMorph(w.drawer, { win: w.win });
  w.input.focus();
  assert.ok(w.bar.classList.contains(DRAWER_SEARCH_MORPH_CLASS), 'no visualViewport still widens');
  assert.equal(w.bar.style.getPropertyValue(DRAWER_SEARCH_INSET_VAR), '0px');
  assert.equal(measureDrawerKeyboardInset(w.win), 0);
  w.input.blur(); assert.equal(w.win.count(), 0); m.dispose();
}
assert.doesNotThrow(() => attachDrawerSearchMorph(null).dispose());
// Source wiring: shell imports helper, closeDrawer deactivates.
const shell = fs.readFileSync(path.join(root, 'web-ui/src/mobile/mobile-shell.js'), 'utf8');
assert.match(shell, /import\('\.\/mobile-drawer-search-morph\.js'\)/);
assert.match(shell, /morphInput\?\.addEventListener\('focus', prepareMorph/);
assert.match(shell, /_drawerEl !== morphDrawer \|\| !morphInput\?\.isConnected/);
assert.match(shell, /_drawerSearchMorph\?\.deactivate\?\.\(\)/);
const runtime = fs.readFileSync(path.join(root, 'web-ui/src/mobile/mobile-chat-page-runtime.js'), 'utf8');
assert.ok(!runtime.includes('drawer-search-morph'), 'composer keyboard controller untouched');
console.log('PASS fake-DOM contract');

// ---------- Part 2: real browser geometry ----------
const shootIdx = process.argv.indexOf('--shoot');
const shootDir = shootIdx > 0 ? path.resolve(process.argv[shootIdx + 1] || 'artifacts/mobile-search-morph') : '';
let chromium;
try { ({ chromium } = await import('playwright')); } catch { console.log('SKIP browser geometry: playwright not installed'); process.exit(0); }
let browser;
try { browser = await chromium.launch(); } catch (e) { console.log('SKIP browser geometry: ' + String(e.message).split('\n')[0]); process.exit(0); }
// Module scripts are blocked on file://, so serve the harness from a routed origin.
const ORIGIN = 'http://drawer-morph.test';
const cssUrl = ORIGIN + '/web-ui/src/styles/mobile.css';
const modHttp = ORIGIN + '/web-ui/src/mobile/mobile-drawer-search-morph.js';
const html = `<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="${cssUrl}"><link rel="stylesheet" href="${ORIGIN}/web-ui/src/styles/mobile-drawer-search-morph.css"><style>html,body{margin:0;height:100%;background:radial-gradient(circle at 30% 20%,#3a2a6a,#0d0f18 70%)}
.list{padding:70px 22px;color:#ddd;font:15px system-ui}.list div{padding:13px 0;border-bottom:1px solid #ffffff14}
.kb{position:fixed;left:0;right:0;bottom:0;background:#2b2d33;color:#999;font:13px system-ui;display:flex;align-items:center;justify-content:center;z-index:99}</style></head>
<body class="pm-mobile-active"><aside class="pm-drawer open" style="position:fixed;inset:0;transform:none;width:100%;max-width:none">
<div class="list">${Array.from({ length: 12 }, (_, i) => `<div>Chat ${i + 1}</div>`).join('')}</div>
<div class="pm-drawer-bottom-bar"><label class="pm-drawer-search"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
<input id="pm-drawer-search-input" type="search" placeholder="Search chats..."></label>
<div class="pm-drawer-bottom-actions"><button class="pm-theme-toggle pm-drawer-bottom-action">☾</button><button class="pm-drawer-new-chat-icon pm-drawer-bottom-action">✎</button></div></div></aside>
<div class="kb" id="kb" style="height:0"></div>
<script type="module">
const vv = new EventTarget(); vv.height = innerHeight; vv.offsetTop = 0; vv.width = innerWidth;
Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => vv });
window.__kb = (h) => { vv.height = innerHeight - h; document.getElementById('kb').style.height = h + 'px'; document.getElementById('kb').textContent = h ? 'keyboard' : ''; vv.dispatchEvent(new Event('resize')); };
const m = await import('${modHttp}');
window.__morph = m.attachDrawerSearchMorph(document.querySelector('.pm-drawer'));
window.__ready = true;
</script></body></html>`;
const types = { '.css': 'text/css', '.js': 'text/javascript', '.html': 'text/html' };
const serve = async (route) => {
  const u = new URL(route.request().url());
  if (u.pathname === '/harness.html') return route.fulfill({ status: 200, contentType: 'text/html', body: html });
  const file = path.join(root, decodeURIComponent(u.pathname));
  if (!file.startsWith(root) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
  return route.fulfill({ status: 200, contentType: types[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
};
const geo = () => page.evaluate(() => {
  const r = (s) => document.querySelector(s).getBoundingClientRect();
  const a = document.querySelector('.pm-drawer-bottom-actions');
  return { bar: r('.pm-drawer-bottom-bar').toJSON(), search: r('.pm-drawer-search').toJSON(), actionsOpacity: Number(getComputedStyle(a).opacity), actionsWidth: a.getBoundingClientRect().width, focused: document.activeElement?.id || '', value: document.querySelector('#pm-drawer-search-input').value };
});
let page;
try {
  for (const reduced of [false, true]) {
    page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await page.route(ORIGIN + '/**', serve);
    await page.goto(ORIGIN + '/harness.html');
    await page.waitForFunction(() => window.__ready);
    const shot = async (n) => { if (shootDir && !reduced) { fs.mkdirSync(shootDir, { recursive: true }); await page.screenshot({ path: path.join(shootDir, n) }); } };
    const settle = () => page.waitForTimeout(reduced ? 30 : 450);
    const g0 = await geo();
    assert.ok(g0.search.width < 300 && g0.actionsOpacity === 1, 'compact pill with visible actions');
    await shot('01-compact.png');
    await page.click('#pm-drawer-search-input');
    await page.keyboard.type('memory');
    if (!reduced) {
      await page.waitForTimeout(120);
      const mid = await geo();
      assert.ok(mid.search.width > g0.search.width && mid.search.width < 390 - 24, 'continuous widen (mid-transition width between endpoints): ' + mid.search.width);
    }
    await settle();
    const g1 = await geo();
    assert.ok(Math.abs(g1.bar.left - 12) <= 1 && Math.abs(390 - g1.bar.right - 12) <= 1, 'composer-like 12px margins');
    assert.ok(g1.search.width >= 390 - 24 - 1, 'search fills bar: ' + g1.search.width);
    assert.ok(g1.actionsOpacity === 0 && g1.actionsWidth < 1, 'actions faded');
    assert.equal(g1.focused, 'pm-drawer-search-input'); assert.equal(g1.value, 'memory');
    await shot('02-focused-wide.png');
    await page.evaluate(() => window.__kb(336));
    await settle();
    const g2 = await geo();
    assert.ok(g2.bar.bottom <= 844 - 336 + 1 && g2.bar.bottom > 844 - 336 - 40, 'lifted above keyboard: bottom ' + g2.bar.bottom);
    assert.equal(g2.focused, 'pm-drawer-search-input');
    await shot('03-keyboard-lifted.png');
    await page.evaluate(() => window.__kb(0));
    await settle();
    const g3 = await geo();
    assert.ok(Math.abs(g3.bar.bottom - g1.bar.bottom) <= 1 && g3.search.width >= 390 - 25, 'keyboard hide drops lift, stays wide while focused');
    await page.evaluate(() => window.__kb(336));
    await page.keyboard.press('Escape');
    await settle();
    const g4 = await geo();
    assert.ok(Math.abs(g4.search.width - g0.search.width) <= 1 && Math.abs(g4.bar.bottom - g0.bar.bottom) <= 1 && g4.actionsOpacity === 1, 'Escape reverses to compact');
    assert.equal(g4.value, 'memory', 'value preserved after collapse');
    assert.equal(await page.evaluate(() => window.__morph.listenerCount()), 0, 'no viewport listeners after dismiss');
    await shot('04-dismissed-compact.png');
    await page.close();
  }
  console.log('PASS browser geometry (motion + reduced motion)' + (shootDir ? ' -> ' + shootDir : ''));
} finally {
  await browser.close();
}
