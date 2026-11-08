// Regression: mobile Settings first paint + async open lifecycle (inline shim in web-ui/index.html).
// - phone handoff modal stays hidden until the lightweight phone nav has classed it
// - an open still awaiting the lazy controller must not reopen after close
// - a section picked during the load must win over the tab captured at open time
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../web-ui/index.html', import.meta.url), 'utf8');

assert.match(html, /html\.mobile-settings-handoff:not\(\.settings-nav-ready\) #settings-modal \{ visibility: hidden !important; \}/,
  'phone handoff must hide the modal until the mobile nav is ready');
assert.match(html, /navPreload\.href = '\/src\/settings\/settings-mobile-nav\.js'/, 'handoff must preload the lightweight nav module');
assert.match(html, /setTimeout\(\(\) => document\.documentElement\.classList\.add\('settings-nav-ready'\), \d+\)/, 'handoff must have a reveal safety net');

const tabsSrc = html.match(/const SETTINGS_TABS = \[[^\]]+\];/)[0];
const fallbackSrc = html.match(/const SETTINGS_TAB_ALIASES[\s\S]*?const applySettingsTabFallback = function applySettingsTabFallback[\s\S]*?\n    \};/)[0];
const lifecycleSrc = html.match(/    let settingsOpenToken = 0;[\s\S]*?window\.setSettingsTab = setSettingsTabShim;/)[0];

function makeHarness() {
  const classes = new Set();
  const modal = { style: { display: 'none' } };
  const win = { matchMedia: () => ({ matches: false }) };
  const doc = {
    documentElement: { classList: { add: (c) => classes.add(c), contains: (c) => classes.has(c) } },
    body: { classList: { add() {}, remove() {} } },
    getElementById: (id) => (id === 'settings-modal' ? modal : null),
  };
  let release;
  const calls = { open: [], tab: [] };
  // Memoised like index.html's makeModuleLoader: every caller shares one load.
  let loadPromise = null;
  win.__PROM_LOAD_SETTINGS = () => loadPromise || (loadPromise = new Promise((resolve) => {
    release = () => {
      win.openSettings = (tab) => { calls.open.push({ tab, explicit: win.__promSettingsExplicitTab }); };
      win.setSettingsTab = (tab) => { calls.tab.push(tab); };
      resolve();
    };
  }));
  new Function('window', 'document', 'location', `${tabsSrc}\n${fallbackSrc}\n${lifecycleSrc}`)(win, doc, {});
  return { win, modal, classes, calls, release: () => release() };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

{ // close while loading: no reopen
  const h = makeHarness();
  const p = h.win.openSettings();
  h.win.closeSettings();
  h.release(); await p; await tick();
  assert.equal(h.calls.open.length, 0, 'closed open must not forward to the real controller');
  assert.equal(h.modal.style.display, 'none');
  assert.ok(h.classes.has('settings-nav-ready'), 'desktop widths mark nav ready immediately');
}
{ // section picked during load wins, and opens as an explicit page
  const h = makeHarness();
  const p = h.win.openSettings();
  const t = h.win.setSettingsTab('models');
  h.release(); await Promise.all([p, t]); await tick();
  assert.deepEqual(h.calls.open, [{ tab: 'models', explicit: true }]);
}
{ // untouched open keeps home semantics; explicit deep link stays explicit
  const h = makeHarness();
  const p = h.win.openSettings();
  h.release(); await p;
  assert.deepEqual(h.calls.open, [{ tab: 'system', explicit: false }]);
  const h2 = makeHarness();
  const p2 = h2.win.openSettings('heartbeat');
  h2.release(); await p2;
  assert.deepEqual(h2.calls.open, [{ tab: 'heartbeat', explicit: true }]);
}
{ // only the latest of two quick tab picks forwards
  const h = makeHarness();
  const a = h.win.setSettingsTab('models');
  const b = h.win.setSettingsTab('agents');
  h.release(); await Promise.all([a, b]);
  assert.deepEqual(h.calls.tab, ['agents']);
}
{ // reopen supersedes the first pending open
  const h = makeHarness();
  const p1 = h.win.openSettings();
  const p2 = h.win.openSettings('channels');
  h.release(); await Promise.all([p1, p2]);
  assert.deepEqual(h.calls.open, [{ tab: 'channels', explicit: true }]);
}
{ // SW: desktop and mobile register the same versioned URL; first-install claim never reloads
  const mobilePwa = readFileSync(new URL('../web-ui/src/mobile/mobile-pwa.js', import.meta.url), 'utf8');
  const v = (src) => src.match(/const PM_PWA_VERSION = '([^']+)'/)[1];
  assert.equal(v(html), v(mobilePwa), 'index.html and mobile-pwa.js must register the same service-worker version (handoff reload)');
  assert.match(html, /const _swHadController = !!navigator\.serviceWorker\.controller;/);
  assert.match(html, /if \(_swReloadGuard \|\| \(_swSettingsHandoff && !_swHadController\)\) return;/,
    'only the uncontrolled Settings handoff may skip the controllerchange reload');
  assert.doesNotMatch(html, /if \(_swReloadGuard \|\| !_swHadController\) return;/, 'update-recovery reload must stay on for non-handoff pages');
  assert.match(html, /try \{ window\.location\.reload\(\); \} catch \{\}/, 'controllerchange update reload must remain');
}
console.log('mobile settings first-paint lifecycle: ok');
