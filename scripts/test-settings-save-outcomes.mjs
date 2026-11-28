// Settings page save bar: outcomes and the Models review fixes (review round 1).
// Real web-ui markup and controllers in Chromium; every request is intercepted
// (no real gateway). Covers:
//  - a failed save keeps the edits and the bar and never says "Saved"
//    (webhooks, remote access, heartbeat)
//  - a cancelled General auto-settle confirmation keeps the edits, sends nothing
//  - Channels: switching app with unsaved edits is refused; Save posts that app
//  - Models: clearing the Main chat choice sends empty values
//  - Models: saved models stay visible (unavailable) with no provider connected
//  - Models: the per-job account choice is offered in the picker and sent
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(repoRoot, 'web-ui');
const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

const catalog = { items: [['anthropic', 'Anthropic Claude'], ['openai_codex', 'OpenAI Codex'], ['openai', 'OpenAI'], ['ollama', 'Ollama']].map(([id, name]) => ({ id, name, setup: {}, runtime: { options: {} }, config: {} })) };
const acct = (id, label) => ({ id, label, authType: 'api_key', status: 'connected' });
function modelsFx({ llm, connected, defaults = {}, accounts = {} }) {
  return {
    '/api/settings/provider': { llm },
    '/api/settings/credentialed-model-providers': { success: true, providers: connected },
    '/api/extensions/catalog': catalog,
    '/api/settings/agent-model-defaults': { success: true, defaults, reasoning: {}, speed: {}, accounts, voiceAgent: { provider: '', voice: '' }, templates: [], activeTemplateId: '', defaultTemplateId: '' },
    '/api/settings/agent-model-default-templates': { success: true, templates: [] },
    '/api/brain/status': { thought: { enabled: false }, dream: { enabled: false }, cleanup: { enabled: false } },
    '/api/settings/session': { session: { mainChatGoals: {}, autoSettle: { afterDays: 0 }, busyComposerMode: 'queue', contextProfile: { providerId: llm.provider, model: 'm', standardContextWindowTokens: 200000, maxContextWindowTokens: 200000, contextWindowTokens: 200000, contextSelectionMode: 'standard' }, contextBudget: {} } },
    '/api/usage/limits': { success: true, providers: [] },
    '/api/auth/openai/status': { connected: false },
    '/api/auth/anthropic/status': { connected: connected.includes('anthropic') },
  };
}
const baseFx = {
  ...modelsFx({ llm: { provider: 'anthropic', providers: { anthropic: { model: 'claude-sonnet-4-6', defaultAccountId: 'default', accounts: { default: acct('default', 'Personal') } } } }, connected: ['anthropic'] }),
  '/api/settings/hooks': { enabled: false, tokenSet: true, path: '/hooks' },
  '/api/mcp/servers': { servers: [] },
  '/api/pairing/remote-access': { remoteAccess: { enabled: false, mode: 'tailscale-funnel', publicUrl: 'https://example-host.example.ts.net', lanEnabled: true } },
  'POST /api/pairing/qr': { success: true, pairCode: 'PAIR-AAAA-BBBB', pairUrl: 'http://192.0.2.10:18789/pair?c=AAAABBBB', pairingOrigin: 'http://192.0.2.10:18789', expiresAt: Date.now() + 300000, qrSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>' },
  '/api/pairing/pending': { requests: [] },
  '/api/pairing/devices': { devices: [] },
  '/api/pairing/tailscale/funnel/status': { success: true, funnelActive: false },
  '/api/settings/heartbeat': { success: true, heartbeat: { enabled: true, intervalMinutes: 30, model: '', reviewTeamsAfterRun: false, instructions: '# Heartbeat\n', path: 'HEARTBEAT.md' } },
  '/api/channels/status': { telegram: { connected: true, polling: true, username: 'example_bot', hasToken: true, enabled: true, allowedUserIds: [111] }, discord: { hasToken: false }, whatsapp: {} },
  '/api/settings/security': { security: { terminalPermissionMode: 'default', workspaceToolsEnabled: true, commandPermissions: [] } },
};

const browser = await chromium.launch();
/**
 * Open Settings on `tab` with fixtures `fx`. `fail` maps "METHOD /path" to a
 * response: { status, json }. Returns { page, posts, errors, toasts }.
 */
async function openSettings(tab, fx = baseFx, fail = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const posts = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== 'http://fixture.test') return route.abort();
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
    if (url.pathname.startsWith('/api/')) {
      const key = `${req.method()} ${url.pathname}`;
      if (req.method() !== 'GET') { let body = null; try { body = req.postDataJSON(); } catch {} posts.push({ path: url.pathname, method: req.method(), body }); }
      if (fail[key]) return route.fulfill({ status: fail[key].status || 200, json: fail[key].json || {} });
      if (fx[key]) return route.fulfill({ json: fx[key] });
      return route.fulfill({ json: (req.method() === 'GET' && fx[url.pathname]) || { success: true, models: [] } });
    }
    const file = path.join(webRoot, url.pathname);
    if (!file.startsWith(webRoot + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ path: file, contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : undefined });
  });
  await page.goto('http://fixture.test/');
  await page.evaluate(async (t) => {
    document.body.classList.remove('auth-pending');
    document.querySelector('#prometheus-auth-gate')?.remove();
    window.__toasts = [];
    await import('/src/pages/SettingsPage.js');
    window.addProcessEntry = () => {};
    window.alert = (m) => window.__toasts.push(`alert:${m}`);
    window.__promSettingsExplicitTab = true;
    await window.openSettings(t);
  }, tab);
  await page.waitForTimeout(1500);
  return { page, posts, errors };
}
const bar = (page) => page.evaluate(() => {
  const el = document.getElementById('settings-savebar');
  return { hidden: !el || el.hidden, text: el?.textContent.replace(/\s+/g, ' ').trim() || '', state: el?.dataset.state || '' };
});
const toastTitles = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.toast, [class*="toast"]')).map((n) => n.textContent).join(' | '));
const switchState = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return el.type === 'checkbox' ? el.checked : el.getAttribute('aria-checked'); }, sel);

async function expectFailedSaveKeepsEdits(tab, toggleSel, failKey, failure) {
  const { page, posts, errors } = await openSettings(tab, baseFx, { [failKey]: failure });
  try {
    const before = await switchState(page, toggleSel);
    await page.click(toggleSel);
    const edited = await switchState(page, toggleSel);
    assert.notEqual(edited, before, `${tab}: the switch flipped`);
    assert.equal((await bar(page)).hidden, false, `${tab}: bar shows after a change`);
    await page.click('[data-savebar="save"]');
    await page.waitForTimeout(900);
    const [m, p] = failKey.split(' ');
    assert.ok(posts.some((x) => x.method === m && x.path === p), `${tab}: the save request was sent`);
    const after = await bar(page);
    assert.equal(after.hidden, false, `${tab}: bar stays after a failed save`);
    assert.equal(after.state, 'error', `${tab}: bar shows the error`);
    assert.match(after.text, /Not saved/, `${tab}: bar says it was not saved`);
    assert.match(after.text, /1 unsaved change/, `${tab}: the change is still listed`);
    assert.equal(await switchState(page, toggleSel), edited, `${tab}: the user's edit is kept, not reloaded over`);
    assert.doesNotMatch(await toastTitles(page), /settings saved/i, `${tab}: no "Saved" toast`);
    assert.deepEqual(errors, [], `${tab}: no page errors`);
  } finally { await page.close(); }
}

try {
  // ── failed saves ───────────────────────────────────────────────────────
  await expectFailedSaveKeepsEdits('integrations', '#wh-enabled', 'POST /api/settings/hooks', { status: 500, json: { error: 'disk is read-only' } });
  await expectFailedSaveKeepsEdits('integrations', '#wh-enabled', 'POST /api/settings/hooks', { status: 200, json: { success: false, error: 'bad path' } });
  await expectFailedSaveKeepsEdits('pairing', '#pairing-remote-enabled', 'PUT /api/pairing/remote-access', { status: 500, json: { error: 'not allowed' } });
  await expectFailedSaveKeepsEdits('heartbeat', '#settings-hb-review-teams', 'POST /api/settings/heartbeat', { status: 200, json: { success: false, error: 'could not write HEARTBEAT.md' } });

  // ── cancelled General confirmation ─────────────────────────────────────
  {
    const { page, posts, errors } = await openSettings('system');
    try {
      await page.focus('#settings-auto-settle-after');
      await page.keyboard.press('End');
      await page.waitForTimeout(200);
      assert.equal(await page.inputValue('#settings-auto-settle-after'), 'custom');
      await page.fill('#settings-auto-settle-custom-date', '2026-01-01');
      assert.equal((await bar(page)).hidden, false, 'General: bar shows');
      const sentBefore = posts.length;
      await page.click('[data-savebar="save"]');
      await page.waitForSelector('[data-auto-settle-choice="cancel"]');
      await page.click('[data-auto-settle-choice="cancel"]');
      await page.waitForTimeout(600);
      const after = await bar(page);
      assert.equal(after.hidden, false, 'General: bar stays after Cancel');
      assert.equal(after.state, 'dirty', 'General: bar is back to the unsaved state, not error/saving');
      assert.doesNotMatch(after.text, /Saved|Not saved/, 'General: nothing claims a save');
      assert.equal(await page.inputValue('#settings-auto-settle-after'), 'custom', 'General: edit kept');
      assert.equal(await page.inputValue('#settings-auto-settle-custom-date'), '2026-01-01', 'General: date kept');
      assert.equal(posts.slice(sentBefore).filter((x) => x.path === '/api/settings/bulk').length, 0, 'General: no request sent');
      assert.doesNotMatch(await toastTitles(page), /settings saved/i);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }

  // ── Channels: no silent loss when switching app ────────────────────────
  {
    const { page, posts, errors } = await openSettings('channels');
    try {
      await page.click('#settings-tg-userid');
      await page.keyboard.press('End');
      await page.keyboard.type(', 222');
      assert.equal((await bar(page)).hidden, false, 'Channels: bar shows');
      await page.selectOption('#settings-channel-select', 'discord');
      await page.waitForTimeout(200);
      assert.equal(await page.inputValue('#settings-channel-select'), 'telegram', 'Channels: stays on Telegram with unsaved edits');
      assert.equal(await page.isVisible('#channel-form-telegram'), true);
      const b = await bar(page);
      assert.match(b.text, /Save or discard your Telegram changes/);
      await page.click('[data-savebar="save"]');
      await page.waitForTimeout(900);
      const sent = posts.filter((x) => x.path === '/api/channels/config');
      assert.equal(sent.length, 1);
      assert.deepEqual(Object.keys(sent[0].body.channels), ['telegram'], 'Channels: Save posts the app that was edited');
      assert.match(JSON.stringify(sent[0].body.channels.telegram), /222/, 'Channels: the edit is in the request');
      assert.equal((await bar(page)).hidden, true, 'Channels: bar gone after a confirmed save');
      await page.selectOption('#settings-channel-select', 'discord');
      await page.waitForTimeout(200);
      assert.equal(await page.inputValue('#settings-channel-select'), 'discord', 'Channels: switching works with nothing unsaved');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }

  // ── Models: clear the Main chat choice ─────────────────────────────────
  {
    const fx = modelsFx({
      llm: { provider: 'anthropic', providers: { anthropic: { model: 'claude-sonnet-4-6', defaultAccountId: 'default', accounts: { default: acct('default', 'Personal') } }, openai_codex: { model: 'gpt-5.5', defaultAccountId: 'default', accounts: { default: acct('default', 'Personal') } } } },
      connected: ['anthropic', 'openai_codex'],
      defaults: { main_chat: 'openai_codex/gpt-5.5' },
    });
    const { page, posts, errors } = await openSettings('models', fx);
    try {
      await page.waitForSelector('[data-pick="main"]', { state: 'attached' });
      await page.click('[data-pick="main"]');
      await page.waitForSelector('.sk-pop .sk-opt[data-provider=""]');
      assert.match(await page.textContent('.sk-pop .sk-opt[data-provider=""]'), /Provider default/);
      await page.click('.sk-pop .sk-opt[data-provider=""]');
      await page.waitForTimeout(500);
      assert.match((await bar(page)).text, /Main chat/);
      assert.match(await page.textContent('[data-pick="main"]'), /Provider default/, 'Main chat row says it follows the provider');
      await page.click('[data-savebar="save"]');
      await page.waitForTimeout(1200);
      const amd = posts.filter((x) => x.path === '/api/settings/agent-model-defaults').pop()?.body;
      assert.ok(amd, 'model choices were saved');
      assert.equal(amd.main_chat, '', 'cleared Main chat sends an empty value');
      assert.equal(amd.reasoning.main_chat, '', 'and empty reasoning');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }

  // ── Models: saved choices with nothing connected ───────────────────────
  {
    const fx = modelsFx({
      llm: { provider: 'anthropic', providers: { anthropic: { model: 'claude-sonnet-4-6' } } },
      connected: [],
      defaults: { coordinator: 'anthropic/claude-opus-5-5' },
    });
    const { page, errors } = await openSettings('models', fx);
    try {
      await page.waitForSelector('#settings-models-v2 .sk-card-empty', { state: 'attached' });
      const view = await page.evaluate(() => ({
        coord: document.querySelector('[data-pick="amd:coordinator"]')?.textContent || '',
        main: document.querySelector('[data-pick="main"]')?.className || '',
        store: [document.getElementById('amd-coordinator-prov')?.value, document.getElementById('amd-coordinator-model')?.value],
      }));
      if (process.env.DEBUG_SETTINGS) console.log(view);
      assert.match(view.coord, /claude-opus-5-5/, 'saved job model still shown');
      assert.match(view.coord, /unavailable/, 'shown as unavailable');
      assert.match(view.main, /unavail/, 'Main chat shown as unavailable, not hidden');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
    const fresh = modelsFx({ llm: { provider: 'ollama', providers: {} }, connected: [] });
    const second = await openSettings('models', fresh);
    try {
      await second.page.waitForSelector('#settings-models-v2 .sk-card-empty', { state: 'attached' });
      assert.equal(await second.page.locator('#settings-models-v2 [data-pick]').count(), 0, 'fresh install: empty state only');
    } finally { await second.page.close(); }
  }

  // ── Models: account choice per job ─────────────────────────────────────
  {
    const fx = modelsFx({
      llm: { provider: 'anthropic', providers: { anthropic: { model: 'claude-sonnet-4-6', defaultAccountId: 'default', accounts: { default: acct('default', 'Personal'), work: acct('work', 'Work') } } } },
      connected: ['anthropic'],
      defaults: { coordinator: 'anthropic/claude-opus-5-5' },
    });
    const { page, posts, errors } = await openSettings('models', fx);
    try {
      await page.waitForSelector('[data-pick="amd:coordinator"]', { state: 'attached' });
      assert.match(await page.textContent('[data-pick="amd:coordinator"]'), /Personal/, 'row shows which account');
      await page.click('[data-pick="amd:coordinator"]');
      await page.waitForSelector('.sk-pop [data-seg="pop-account"]');
      await page.click('.sk-pop [data-seg="pop-account"] [data-value="work"]');
      await page.waitForTimeout(300);
      assert.match((await bar(page)).text, /Team coordinator/);
      await page.keyboard.press('Escape');
      await page.click('[data-savebar="save"]');
      await page.waitForTimeout(1200);
      const amd = posts.filter((x) => x.path === '/api/settings/agent-model-defaults').pop()?.body;
      assert.equal(amd?.accounts?.coordinator, 'work', 'the chosen account is sent');
      assert.equal(amd?.coordinator, 'anthropic/claude-opus-5-5');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
} finally {
  await browser.close();
}
console.log('settings save outcomes + models review fixes passed');
