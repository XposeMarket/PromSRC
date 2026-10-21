import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
const source = fs.readFileSync(new URL('../web-ui/src/mobile/mobile-model-badge.js', import.meta.url), 'utf8');
const helper = fs.readFileSync(new URL('../web-ui/src/mobile/mobile-native-picker.js', import.meta.url), 'utf8'); // still used by the chat target/project chips
const advanced = source.slice(source.indexOf('function _advancedRow('), source.indexOf('\nasync function _switchModel'));
const reasoning = source.slice(source.indexOf('function _renderReasoningBody('), source.indexOf('\nasync function _openSubagentReasoningSheet'));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<div id="pm-msheet"><div id="body"></div></div>');
  await page.evaluate(async ({ advanced, reasoning }) => {
    const calls = window.calls = [];
    const cfg = { model: 'm1', reasoning_effort: 'low', speed: 'standard' };
    const _llmCache = { providers: { p1: cfg, p2: { model: 'm3' } } };
    const deps = {
      _llmCache, _credentialedIds: ['p1', 'p2'], BUILTIN_LABELS: { p1: 'P1', p2: 'P2' },
      _currentAdvancedState: () => ({ provider: 'p1', model: 'm1', cfg, options: ['low', 'high'], effortValue: 'low' }),
      _activeModel: () => ({ provider: 'p1', model: 'm1' }),
      _modelsForProvider: p => p === 'p1' ? ['m1', 'm2'] : ['m3'],
      _effortOptions: () => ['low', 'high'], _normalizedReasoningEffort: (_p, _m, v) => v,
      _effortLabel: value => value, prettifyModelName: value => value, _providerLabel: value => value,
      _primaryUsageLeft: id => id === 'p1' ? 42 : (id === 'p2' ? 9 : null), _usageIsFresh: () => true, _loadUsage: async () => [],
      supportsFastSpeed: () => true, _esc: value => value,
      _setSheetTitle: () => {}, _setSheetBody: html => { const el = document.querySelector('#body'); el.innerHTML = html; return el; },
      _switchModel: (...args) => calls.push(['model', ...args]),
      _queueReasoningSave: (...args) => calls.push(['save', ...args]),
      _setBadgeFast: value => calls.push(['fast', value]), pmHaptic: () => {}, _toast: () => {}, _openSwitchSheet: () => {},
    };
    const factory = new Function(...Object.keys(deps), `${advanced}\n${reasoning}\nreturn {_renderAdvancedSheet,_renderReasoningBody};`);
    window.renderers = factory(...Object.values(deps));
    window.renderers._renderAdvancedSheet();
  }, { advanced, reasoning });
  // Advanced sheet = custom drill-down rows (restored from pre-#710), not native <select>s.
  assert.equal(await page.locator('#body select').count(), 0, 'Advanced sheet must not render native selects');
  const row = action => page.locator(`#body .pm-advanced-row[data-action="${action}"]`);
  const back = () => page.evaluate(() => window.renderers._renderAdvancedSheet());
  assert.deepEqual(await page.locator('#body .pm-advanced-row-label').allTextContents(), ['Provider', 'Model', 'Intelligence', 'Speed']);
  // Provider list shows per-provider plan usage.
  await row('provider').click();
  const usage = await page.locator('#body [data-pm-view="providers"] .pm-msheet-row-usage').allTextContents();
  assert.deepEqual(usage.map(t => t.trim()), ['Primary Account: 42% Left', 'Primary Account: 9% Left']);
  assert.equal(await page.locator('#body [data-provider="p2"] .pm-msheet-row-usage.is-low').count(), 1, 'low usage is flagged');
  assert.equal(await page.locator('#body [data-provider="p1"] .pm-msheet-row-usage.is-low').count(), 0, 'healthy usage is not flagged');
  await page.locator('#body [data-provider="p2"]').click();
  await back(); await row('model').click();
  await page.locator('#body [data-model="m2"]').click();
  await back(); await row('intelligence').click();
  await page.locator('#body [data-effort="high"]').click();
  await back(); await row('speed').click();
  await page.locator('#body [data-speed="fast"]').click();
  const calls = await page.evaluate(() => window.calls);
  assert.deepEqual(calls[0], ['model', 'p2', 'm3', { keepOpen: true, returnToAdvanced: true }]);
  assert.deepEqual(calls[1], ['model', 'p1', 'm2', { keepOpen: true, returnToAdvanced: true }]);
  assert.deepEqual(calls[2], ['save', 'p1', { reasoning_effort: 'high' }, true]);
  assert.deepEqual(calls[3], ['save', 'p1', { speed: 'fast' }, true]);
  assert.deepEqual(calls[4], ['fast', true]);
  assert.doesNotMatch(advanced, /attachNativePicker/, 'Advanced sheet must keep the custom provider/model/intelligence/speed lists');
  // The quick reasoning sheet (composer badge tap, subagent reasoning) is the
  // custom swipe slider, NOT a native picker. Only the Advanced rows use native
  // iOS pickers. PR #710 replaced the slider by mistake; keep it guarded.
  assert.match(reasoning, /renderReasoningSelector\(/, 'quick reasoning sheet must render the reasoning slider');
  assert.match(reasoning, /attachMobileHapticGestureSurface\(control/, 'reasoning slider must keep its native haptic gesture surface');
  assert.doesNotMatch(reasoning, /attachNativePicker|data-pm-reasoning-picker/, 'quick reasoning sheet must not be a native picker drill-down');
  const chatSource = fs.readFileSync(new URL('../web-ui/src/mobile/mobile-chat-page-runtime.js', import.meta.url), 'utf8');
  const chatBindings = chatSource.slice(chatSource.indexOf('  nativeTargetPicker = attachNativePicker('), chatSource.indexOf('\n  renderChatTargetChip();\n  renderChatProjectChip();\n  const loadNativeProjectPickerOptions'));
  await page.evaluate(async ({ helper, chatBindings }) => {
    const { attachNativePicker } = await import(URL.createObjectURL(new Blob([helper], { type: 'text/javascript' })));
    document.body.innerHTML = '<button id="target">Target</button><button id="project">Project</button>';
    const calls = window.chatCalls = [];
    const deps = {
      attachNativePicker, targetChip: document.querySelector('#target'), projectChip: document.querySelector('#project'),
      requestedSession: 'draft', MOBILE_CHAT_SESSION_ID: 'draft',
      currentChatGateway: () => ({ gatewayId: 'g1' }), loadGatewayCatalog: () => [{ gatewayId: 'g1', name: 'One' }, { gatewayId: 'g2', name: 'Two' }],
      setActiveGatewayId: id => calls.push(['active', id]), setMobileActiveGatewayTarget: id => calls.push(['target', id]),
      rememberChatContext: () => calls.push(['remember']), renderChatTargetChip: () => {}, renderChatProjectChip: () => {},
      openNewProjectPopover: () => calls.push(['new-project']),
    };
    new Function(...Object.keys(deps), `let nativeTargetPicker, nativeProjectPicker, pendingGatewayId, targetProjectId='', targetProjectLabel=''; const nativeProjectPickerOptions=[{value:'',label:'Chat'},{value:'p2',label:'Project two'},{value:'__pm_new_project__',label:'New project'}]; ${chatBindings}`)(...Object.values(deps));
  }, { helper, chatBindings });
  await page.getByLabel('Connected computer', { exact: true }).selectOption('g2');
  await page.getByLabel('Directed chat', { exact: true }).selectOption('p2');
  await page.getByLabel('Directed chat', { exact: true }).selectOption('__pm_new_project__');
  assert.deepEqual(await page.evaluate(() => chatCalls), [['active', 'g2'], ['target', 'g2'], ['remember'], ['remember'], ['new-project']]);
  console.log('PASS Advanced sheet custom lists (provider usage, model, intelligence, speed) + native target/project chip callbacks preserve exact save arguments');
} finally { await browser.close(); }
