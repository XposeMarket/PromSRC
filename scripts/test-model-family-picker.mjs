import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// No bundle, application bootstrap, network service, or copied renderer implementation.
const source = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const helperSource = await source('web-ui/src/model-family-grouping.js');
const { groupModelsByFamily } = await import(`data:text/javascript;base64,${Buffer.from(helperSource).toString('base64')}`);
const desktopSource = await source('web-ui/src/legacy-desktop-bootstrap.js');
const mobileSource = await source('web-ui/src/mobile/mobile-model-badge.js');
function declaration(text, name, next) {
  const start = text.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.notEqual(start, -1, `Missing actual declaration: ${name}`);
  const end = text.indexOf(`\nfunction ${next}(`, start);
  assert.ok(end > start, `Missing next function boundary: ${next}`);
  return text.slice(start, end);
}
const desktop = [
  declaration(desktopSource, '_desktopSwitcherShowDetail', '_desktopSwitcherClearDetail'),
  declaration(desktopSource, '_desktopSwitcherOption', 'mainModelLabel'),
  declaration(desktopSource, '_renderDesktopSwitcherModels', '_renderDesktopSwitcherEffort'),
].join('\n');
const mobile = declaration(mobileSource, '_renderModelList', '_renderEffortList');
assert.match(desktopSource, /import\s*\{\s*groupModelsByFamily\s*\}\s*from\s*['"]\.\/model-family-grouping\.js['"]/);
assert.match(mobileSource, /import\s*\{\s*groupModelsByFamily\s*\}\s*from\s*['"]\.\.\/model-family-grouping\.js['"]/);
const openai = ['gpt-5.9', 'gpt-6', 'gpt-5.10', 'gpt-6.1', 'gpt-6.1-sol', 'gpt-6.1-astra', 'chatgpt-6.1', 'custom<&"model'];
const anthropic = ['claude-haiku-4-5', 'claude-haiku-4-6', 'claude-sonnet-4-5', 'claude-sonnet-4-6', 'claude-opus-4-6', 'claude-opus-4-8', 'claude-fable-1', 'custom<&"model'];
for (const provider of ['openai', 'openai_codex']) {
  const groups = groupModelsByFamily(provider, openai);
  assert.deepEqual(groups.filter(g => g.key.startsWith('gpt-')).map(g => g.key), ['gpt-6.1', 'gpt-6', 'gpt-5.10', 'gpt-5.9']);
  assert.deepEqual(groups.find(g => g.key === 'astra').models, ['gpt-6.1-astra']);
  assert.deepEqual(groups.find(g => g.key === 'chatgpt').models, ['chatgpt-6.1']);
}
for (const [provider, catalog] of [['openai', openai], ['anthropic', anthropic]]) {
  const flat = groupModelsByFamily(provider, [...catalog, catalog[0], ''], 'stale-current').flatMap(g => g.models);
  assert.deepEqual([...flat].sort(), [...catalog, 'stale-current'].sort());
}
for (const family of ['haiku', 'sonnet', 'opus']) {
  const ids = groupModelsByFamily('anthropic', anthropic).find(g => g.key === family).models;
  assert.deepEqual(ids, [...ids].reverse().sort((a, b) => b.localeCompare(a)));
}
assert.deepEqual(groupModelsByFamily('openai', []), []);

const browser = await chromium.launch({ headless: true });
let checks = 0;
try {
  for (const surface of ['desktop', 'mobile']) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // Fulfilled locally: grants localStorage a real origin without starting a server.
    await page.route('http://model-picker.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><main id="host"></main><header id="title"></header><section id="body"></section>' }));
    await page.goto('http://model-picker.test/');
    await page.addScriptTag({ type: 'module', content: `${helperSource}\nwindow.groupModelsByFamily = groupModelsByFamily;` });
    await page.waitForFunction(() => typeof window.groupModelsByFamily === 'function');
    await page.addScriptTag({ content: `
      const escHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const _esc = escHtml;
      let catalog = [], _llmCache = {};
      const controller = { detail: document.getElementById('body'), popover: document.getElementById('host'), sessionId: 'regression-session' };
      const _desktopSwitcherController = () => controller;
      // Match the application document outside-click lifecycle: a synchronously
      // replaced clicked node no longer belongs to the live popover subtree.
      if ('${surface}' === 'desktop') {
        controller.popover.append(controller.detail);
        document.addEventListener('click', event => {
          if (!controller.popover.contains(event.target)) {
            controller.popover.style.display = 'none';
            throw new Error('Picker closed during nested navigation');
          }
        });
      }
      const readRoute = () => JSON.parse(localStorage.getItem('route'));
      const _activeModel = () => readRoute();
      const _desktopSwitcherModelsFor = async () => catalog;
      const _modelsForProvider = () => catalog;
      const _setSheetTitle = html => { document.getElementById('title').innerHTML = html; };
      const _setSheetBody = html => { controller.detail.innerHTML = html; return controller.detail; };
      const prettifyModelName = model => model;
      const _renderAdvancedSheet = () => { window.advanced = (window.advanced || 0) + 1; };
      const _renderDesktopSwitcherMain = state => { window.reloaded = state; };
      const _renderDesktopSwitcherEffort = state => { window.effortState = state; };
      const _loadDesktopSwitcherState = async session => { window.loadedSession = session; return readRoute(); };
      const showToast = (...args) => { throw new Error(args.join(':')); };
      const setActiveChatModelRoute = async (route, session) => {
        window.saved = { route, session };
        localStorage.setItem('route', JSON.stringify({ provider: route.providerId, model: route.model, reasoningEffort: route.reasoningEffort, speed: route.speed }));
      };
      const _switchModel = (provider, model, options) => {
        window.saved = { provider, model, options };
        localStorage.setItem('route', JSON.stringify({ ...readRoute(), provider, model }));
        _renderAdvancedSheet();
      };
      ${surface === 'desktop' ? desktop : mobile}
      window.setup = (models, route) => { catalog = models; localStorage.setItem('route', JSON.stringify(route)); window.saved = null; };
      window.reopen = provider => ${surface === 'desktop' ? '_renderDesktopSwitcherModels(readRoute(), provider, controller)' : '_renderModelList(provider)'};
    ` });
    const familyAttr = surface === 'desktop' ? 'data-switcher-family' : 'data-model-family';
    const modelAttr = surface === 'desktop' ? 'data-switcher-model' : 'data-model';
    const back = surface === 'desktop' ? '[data-switcher-family-back]' : '#pm-msheet-back';
    const marked = surface === 'desktop' ? '.selected' : ':has(.pm-msheet-check)';
    const families = () => page.locator(`[${familyAttr}]`);
    const models = () => page.locator(`[${modelAttr}]`);
    const values = locator => locator.evaluateAll((nodes, attr) => nodes.map(n => n.getAttribute(attr)), locator === undefined ? '' : modelAttr);
    for (const [provider, catalog] of [['openai', openai], ['openai_codex', openai], ['anthropic', anthropic]]) {
      const current = provider === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-6';
      await page.evaluate(({ catalog, provider, current }) => window.setup(catalog, { provider, model: current, reasoningEffort: 'high', speed: 'fast' }), { catalog, provider, current });
      await page.evaluate(provider => window.reopen(provider), provider);
      const expected = groupModelsByFamily(provider, catalog, current);
      assert.deepEqual(await families().evaluateAll((nodes, attr) => nodes.map(n => n.getAttribute(attr)), familyAttr), expected.map(g => g.key));
      assert.equal(await page.locator(`[${familyAttr}]${marked}`).count(), 1);
      // Visit every family with real click listeners; assert exact IDs and ordering, not prettified labels.
      for (const group of expected) {
        await page.locator(`[${familyAttr}="${group.key}"]`).click();
        await models().first().waitFor();
        assert.deepEqual(await values(models()), group.models);
        assert.equal(await page.locator(`[${modelAttr}]${marked}`).count(), group.models.includes(current) ? 1 : 0);
        await page.locator(back).click();
        await families().first().waitFor();
      }
      const targetGroup = expected.find(g => g.models.some(m => m !== current));
      const target = targetGroup.models.find(m => m !== current);
      await page.locator(`[${familyAttr}="${targetGroup.key}"]`).click();
      await models().first().waitFor();
      const index = targetGroup.models.indexOf(target);
      await models().nth(index).click();
      await page.waitForFunction(() => window.saved !== null);
      const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('route')));
      assert.deepEqual(persisted, { provider, model: target, reasoningEffort: 'high', speed: 'fast' });
      const saved = await page.evaluate(() => window.saved);
      if (surface === 'desktop') {
        assert.deepEqual(saved, { route: { providerId: provider, model: target, reasoningEffort: 'high', speed: 'fast' }, session: 'regression-session' });
        await page.waitForFunction(() => window.reloaded?.model === JSON.parse(localStorage.getItem('route')).model);
        assert.deepEqual(await page.evaluate(() => window.effortState), persisted);
        assert.equal(await page.evaluate(() => window.loadedSession), 'regression-session');
      } else assert.deepEqual(saved, { provider, model: target, options: { keepOpen: true, returnToAdvanced: true } });
      await page.evaluate(provider => window.reopen(provider), provider);
      assert.equal(await page.locator(`[${familyAttr}]${marked}`).getAttribute(familyAttr), targetGroup.key);
      await page.locator(`[${familyAttr}="${targetGroup.key}"]`).click();
      await models().first().waitFor();
      assert.equal(await page.locator(`[${modelAttr}]${marked}`).getAttribute(modelAttr), target);
      checks++;
    }
    // Unrelated providers retain the existing flat list (and mobile advanced back).
    await page.evaluate(() => window.setup(['grok-4', 'grok-3'], { provider: 'xai', model: 'grok-4', reasoningEffort: 'high', speed: 'fast' }));
    await page.evaluate(() => window.reopen('xai'));
    assert.equal(await families().count(), 0);
    assert.deepEqual(await values(models()), ['grok-4', 'grok-3']);
    assert.equal(await page.locator(`[${modelAttr}]${marked}`).getAttribute(modelAttr), 'grok-4');
    if (surface === 'desktop') assert.equal(await page.locator(back).count(), 0);
    else {
      const before = await page.evaluate(() => window.advanced || 0);
      await page.locator(back).click();
      assert.equal(await page.evaluate(() => window.advanced), before + 1);
    }
    // A missing catalog entry remains reachable/current, including with an empty catalog.
    await page.evaluate(() => window.setup([], { provider: 'openai', model: 'stale-current', reasoningEffort: 'high', speed: 'fast' }));
    await page.evaluate(() => window.reopen('openai'));
    assert.equal(await page.locator(`[${familyAttr}]${marked}`).count(), 1);
    await families().first().click();
    await models().first().waitFor();
    assert.deepEqual(await values(models()), ['stale-current']);
    assert.equal(await page.locator(`[${modelAttr}]${marked}`).count(), 1);
    await page.locator(back).click();
    await families().first().waitFor();
    // Provider identity, not just model identity, controls current markers.
    await page.evaluate(() => window.setup(['gpt-6'], { provider: 'openai_codex', model: 'gpt-6', reasoningEffort: 'high', speed: 'fast' }));
    await page.evaluate(() => window.reopen('openai'));
    assert.equal(await page.locator(`[${familyAttr}]${marked}`).count(), 0);
    await families().first().click();
    await models().first().waitFor();
    assert.equal(await page.locator(`[${modelAttr}]${marked}`).count(), 0);
    await page.evaluate(() => window.setup([], { provider: 'openai', model: '', reasoningEffort: 'high', speed: 'fast' }));
    await page.evaluate(() => window.reopen('openai'));
    assert.equal(await families().count(), 0);
    assert.equal(await models().count(), 0);
    assert.match(await page.locator('#body').innerText(), /No (models are available|known models)/);
    if (surface === 'mobile') {
      const before = await page.evaluate(() => window.advanced || 0);
      await page.locator(back).click();
      assert.equal(await page.evaluate(() => window.advanced), before + 1);
    }
    assert.deepEqual(errors, [], `${surface} browser errors`);
    await page.close();
  }
  console.log(`PASS model family picker: shared taxonomy + ${checks} desktop/mobile provider DOM flows, persistence/reopen, stale current, empty and provider identity`);
} finally {
  await browser.close();
}
