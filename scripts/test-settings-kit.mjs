// Settings kit + rebuilt Models page.
// 1) Pure kit helpers (slot state, picker groups, change tracker, context body).
// 2) Real web-ui in Chromium with mocked API: the Models page renders, an
//    unavailable saved model is shown as "unavailable" and is sent back unchanged
//    on save, an untouched page sends no `subagent` key, and the single save bar
//    appears on a change and goes away on Discard.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(repoRoot, 'web-ui');
const kit = await import(pathToFileURL(path.join(webRoot, 'src/settings/settings-kit.js')).href);
const ctxSel = await import(pathToFileURL(path.join(webRoot, 'src/context-selection.js')).href);

// ── 1. pure helpers ──────────────────────────────────────────────────────
assert.equal(kit.modelSlotState({}).state, 'same');
assert.equal(kit.modelSlotState({ provider: 'anthropic', model: 'm1', connected: ['anthropic'], available: ['m1'] }).state, 'set');
assert.deepEqual(kit.modelSlotState({ provider: 'anthropic', model: 'gone', connected: ['anthropic'], available: ['m1'] }), { state: 'unavailable', reason: 'not-listed' });
assert.deepEqual(kit.modelSlotState({ provider: 'xai', model: 'g', connected: ['anthropic'], available: null }), { state: 'unavailable', reason: 'not-connected' });
assert.equal(kit.modelSlotState({ provider: 'anthropic', model: 'm1', connected: ['anthropic'], available: null }).state, 'set', 'list not loaded yet: not flagged');
const groups = kit.buildPickerGroups([{ provider: 'anthropic', name: 'Claude', models: [{ id: 'm1', label: 'M1' }] }], { provider: 'anthropic', model: 'gone' });
assert.deepEqual(groups[0].models.map((m) => [m.id, !!m.unavailable]), [['gone', true], ['m1', false]]);
const orphan = kit.buildPickerGroups([], { provider: 'xai', model: 'grok-x', providerName: 'xAI' });
assert.equal(orphan[0].disconnected, true);
assert.equal(kit.filterPickerGroups(groups, 'm1')[0].models.length, 1);
assert.equal(kit.filterPickerGroups(groups, 'claude')[0].models.length, 2, 'provider name match keeps the group');
assert.equal(kit.filterPickerGroups(groups, 'zzz').length, 0);
assert.deepEqual(kit.splitModelRef('openrouter/meta/llama'), { provider: 'openrouter', model: 'meta/llama' });
const tracker = kit.createChangeTracker();
tracker.track('a', 'Voice', 'x', 'y');
tracker.track('a', 'Voice', 'y', 'z');
assert.equal(tracker.count(), 1);
assert.equal(tracker.original('a'), 'x');
tracker.track('a', 'Voice', 'z', 'x');
assert.equal(tracker.count(), 0, 'returning to the original clears the change');
assert.deepEqual(kit.summarizeChanges(['A', 'B', 'C', 'D']), { title: '4 unsaved changes', detail: 'A, B, C and 1 more' });
assert.match(kit.skSwitch({ checked: true, label: 'Fast' }), /role="switch" aria-checked="true"/);
assert.match(kit.skSegmented({ options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], value: 'b' }), /data-value="b" ?>?[^]*?|aria-checked="true" data-value="b"/);
assert.match(kit.skRow({ label: '<x>' }), /&lt;x&gt;/, 'row labels are escaped');
const profile = { providerId: 'p', model: 'm', contextAccountId: 'acc', standardContextWindowTokens: 272000, maxContextWindowTokens: 1000000, contextWindowTokens: 500000, contextSelectionMode: 'custom' };
const choices = ctxSel.contextChoices(profile);
assert.equal(choices.mode, '500k');
assert.equal(choices.has500k, true);
assert.deepEqual(ctxSel.contextSaveBody(profile, '500k', 500000, true), { providerId: 'p', model: 'm', accountId: 'acc', mode: 'custom', tokens: 500000, extendedAcknowledged: true });

// ── 2. browser round trip ────────────────────────────────────────────────
const fx = {
  '/api/settings/provider': { llm: { provider: 'anthropic', accountId: 'default', providers: {
    anthropic: { model: 'claude-retired-main', defaultAccountId: 'default', accounts: { default: { id: 'default', label: 'Default account', authType: 'api_key', status: 'connected' } } },
    openai_codex: { model: 'gpt-5.5', defaultAccountId: 'default', accounts: { default: { id: 'default', label: 'Personal', authType: 'oauth', status: 'connected' } } },
  } } },
  '/api/settings/credentialed-model-providers': { success: true, providers: ['anthropic', 'openai_codex'] },
  '/api/extensions/catalog': { items: [['anthropic', 'Anthropic Claude'], ['openai_codex', 'OpenAI Codex'], ['openai', 'OpenAI'], ['ollama', 'Ollama']].map(([id, name]) => ({ id, name, setup: {}, runtime: { options: {} }, config: {} })) },
  '/api/settings/agent-model-defaults': { success: true, defaults: { proposal_executor_high_risk: 'anthropic/claude-retired-3', coordinator: 'openai_codex/gpt-5.5' }, reasoning: {}, speed: {}, accounts: {}, voiceAgent: { provider: '', voice: '' }, templates: [], activeTemplateId: '', defaultTemplateId: '' },
  '/api/settings/agent-model-default-templates': { success: true, templates: [] },
  '/api/brain/status': { thought: { enabled: false }, dream: { enabled: false }, cleanup: { enabled: false } },
  '/api/settings/session': { session: { mainChatGoals: {}, contextProfile: { providerId: 'anthropic', model: 'claude-retired-main', standardContextWindowTokens: 200000, maxContextWindowTokens: 1000000, contextWindowTokens: 200000, contextSelectionMode: 'standard' }, contextBudget: {} } },
  '/api/usage/limits': { success: true, providers: [] },
  '/api/auth/openai/status': { connected: true },
  '/api/auth/anthropic/status': { connected: true },
};
const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const browser = await chromium.launch();
const posts = [];
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== 'http://fixture.test') return route.abort();
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
    if (url.pathname.startsWith('/api/')) {
      if (req.method() !== 'GET') { let body = null; try { body = req.postDataJSON(); } catch {} posts.push({ path: url.pathname, body }); }
      return route.fulfill({ json: (req.method() === 'GET' && fx[url.pathname]) || { success: true, models: [] } });
    }
    const file = path.join(webRoot, url.pathname);
    if (!file.startsWith(webRoot + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ path: file, contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : undefined });
  });
  await page.goto('http://fixture.test/');
  await page.evaluate(async () => {
    document.body.classList.remove('auth-pending');
    document.querySelector('#prometheus-auth-gate')?.remove();
    await import('/src/pages/SettingsPage.js');
    window.__promSettingsExplicitTab = true;
    await window.openSettings('models');
  });
  await page.waitForSelector('#settings-models-v2 .sk-jobs', { timeout: 15000, state: 'attached' });
  await page.waitForTimeout(900);
  const view = await page.evaluate(() => ({
    accounts: document.querySelectorAll('#settings-models-v2 .sk-acct[data-provider]').length,
    unavailable: document.querySelector('[data-pick="amd:proposal-high"]')?.textContent || '',
    mainUnavailable: document.querySelector('[data-pick="main"]')?.className || '',
    footerHidden: getComputedStyle(document.querySelector('#settings-modal .settings-page-footer')).display === 'none',
    barHidden: document.getElementById('settings-savebar')?.hidden !== false,
    storeHidden: document.getElementById('settings-models-store')?.hidden === true,
  }));
  assert.equal(view.accounts, 2, 'one row per connected provider');
  assert.match(view.unavailable, /claude-retired-3/);
  assert.match(view.unavailable, /unavailable/);
  assert.match(view.mainUnavailable, /unavail/, 'main chat model the provider no longer lists shows as unavailable');
  assert.ok(view.footerHidden, 'old footer Save is gone on the rebuilt page');
  assert.ok(view.barHidden, 'no save bar before a change');
  assert.ok(view.storeHidden, 'legacy controls stay mounted but hidden');

  await page.evaluate(() => window.saveSettings({ stayOpen: true }));
  await page.waitForTimeout(400);
  const amd = posts.find((p) => p.path === '/api/settings/agent-model-defaults')?.body;
  const bulk = posts.find((p) => p.path === '/api/settings/bulk')?.body;
  assert.ok(amd && bulk, 'save posts the same endpoints as before');
  assert.equal(amd.proposal_executor_high_risk, 'anthropic/claude-retired-3', 'unavailable model is preserved on save');
  assert.equal(amd.coordinator, 'openai_codex/gpt-5.5');
  assert.ok(!('subagent' in amd), 'untouched New agents slot is not sent');
  assert.equal(bulk.llm.providers.anthropic.model, 'claude-retired-main', 'unlisted main model is not swapped for the first listed one');

  await page.click('[data-pick="amd:coordinator"]');
  await page.waitForSelector('.sk-pop .sk-opt');
  await page.click('.sk-pop .sk-opt[data-provider=""]');
  await page.waitForTimeout(300);
  const dirty = await page.evaluate(() => ({ hidden: document.getElementById('settings-savebar').hidden, text: document.getElementById('settings-savebar').textContent }));
  assert.equal(dirty.hidden, false, 'save bar appears after a change');
  assert.match(dirty.text, /1 unsaved change/);
  assert.match(dirty.text, /Team coordinator/);
  await page.click('[data-savebar="discard"]');
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => ({ hidden: document.getElementById('settings-savebar').hidden, coord: document.getElementById('amd-coordinator-prov').value }));
  assert.equal(after.hidden, true, 'Discard hides the save bar');
  assert.equal(after.coord, 'openai_codex', 'Discard restores the saved value');
  assert.deepEqual(errors, [], 'no page errors');
} finally {
  await browser.close();
}
console.log('settings kit + models page checks passed');
