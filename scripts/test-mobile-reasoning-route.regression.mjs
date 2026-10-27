import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync, spawnSync } from 'node:child_process';
if (!process.execArgv.includes('--experimental-vm-modules')) {
  const run = spawnSync(process.execPath, ['--experimental-vm-modules', ...process.argv.slice(1)], { stdio: 'inherit' });
  process.exit(run.status ?? 1);
}
const root = new URL('../', import.meta.url);
const source = process.argv.includes('--baseline')
  ? execFileSync('git', ['show', 'origin/main:web-ui/src/mobile/mobile-model-badge.js'], { encoding: 'utf8' })
  : fs.readFileSync(new URL('web-ui/src/mobile/mobile-model-badge.js', root), 'utf8');
async function fixture(session, effective) {
  const writes = [], timers = new Map(), storage = new Map();
  let routeRead = null, releasePut = null;
  const context = vm.createContext({ console, URL, navigator: {},
    window: { __pmChat: { activeSessionId: session }, addEventListener() {} },
    document: { querySelector() { return null; }, getElementById() { return null; }, querySelectorAll() { return []; }, addEventListener() {} },
    localStorage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v) },
    setTimeout(fn) { timers.set(1, fn); return 1; }, clearTimeout(id) { timers.delete(id); },
    setInterval() {}, clearInterval() {},
  });
  const fetch = async (url, options) => {
    if (options?.method === 'PUT') {
      const body = JSON.parse(options.body); writes.push({ url, body });
      if (releasePut) await releasePut;
      return { chatModelRoute: { effective: body, override: body } };
    }
    if (url.includes('/model-route')) { if (routeRead) await routeRead; return { chatModelRoute: { effective } }; }
    if (url.endsWith('/provider')) return { llm: { provider: 'openai_codex', providers: { openai_codex: { model: 'gpt-5.4', speed: 'standard' } } } };
    if (url.endsWith('/agent-model-defaults')) return { reasoning: { main_chat: 'low' } };
    return {};
  };
  const modules = new Map();
  async function load(url) {
    if (modules.has(url.href)) return modules.get(url.href);
    if (url.pathname.endsWith('/mobile-api.js')) {
      const mod = new vm.SyntheticModule(['mobileGatewayFetch'], function () { this.setExport('mobileGatewayFetch', fetch); }, { context });
      modules.set(url.href, mod); return mod;
    }
    const isBadge = url.pathname.endsWith('/mobile-model-badge.js');
    const text = isBadge ? source + '\nexport const test = { queue: _queueReasoningSave, load: _loadLlm, flush: () => _reasoningSaveChain, seed: r => { _mobileDraftModelRoute = r; }, route: () => _mobileDraftModelRoute };' : fs.readFileSync(url, 'utf8');
    const mod = new vm.SourceTextModule(text, { context, identifier: url.href });
    modules.set(url.href, mod);
    await mod.link((specifier) => load(new URL(specifier, url)));
    return mod;
  }
  const mod = await load(new URL('web-ui/src/mobile/mobile-model-badge.js', root));
  await mod.evaluate();
  const api = mod.namespace.test;
  await api.load(true); // Opening controls refreshes stale provider settings.
  api.seed({ effective, override: effective });
  return { api, context, writes, timers, storage,
    switch() { context.window.__pmChat.activeSessionId = 'later-chat'; },
    deferRead() { let release; routeRead = new Promise(r => { release = r; }); return release; },
    deferPut() { let release; releasePut = new Promise(r => { release = r; }); return release; },
    async flush() { for (const fn of timers.values()) fn(); timers.clear(); await api.flush(); },
  };
}
const cases = [
  ['openai_codex', 'gpt-6.1-sol', 'fast', 'codex-account', 'xhigh'],
  ['openai_codex', 'gpt-6-luna', 'standard', undefined, 'high'],
  ['anthropic', 'claude-opus-5-5', 'standard', 'claude-account', 'high'],
];
for (const session of ['mobile_default', 'existing-chat']) {
  for (const [providerId, model, speed, accountId, effort] of cases) {
    for (const reset of [false, true]) {
      const identity = { providerId, model, speed, accountId, reasoningEffort: 'low' };
      const f = await fixture(session, identity);
      f.api.queue(providerId, { reasoning_effort: reset ? '' : effort }, true);
      await f.flush();
      const saved = session === 'mobile_default' ? f.api.route().effective : f.writes[0]?.body;
      assert.ok(saved, 'must save route');
      for (const key of ['providerId', 'model', 'speed', 'accountId']) assert.equal(saved[key], identity[key], `${session} preserves ${key}`);
      assert.equal(saved.reasoningEffort, reset ? undefined : effort, 'only effort changes; default clears override');
      assert.ok(f.writes.every(w => w.url.includes('/sessions/existing-chat/model-route')), 'never write global settings');
    }
  }
}
for (const phase of ['debounce', 'route-read', 'put']) {
  const f = await fixture('existing-chat', { providerId: 'openai_codex', model: 'gpt-6.1-sol', speed: 'fast', accountId: 'account' });
  const release = phase === 'route-read' ? f.deferRead() : phase === 'put' ? f.deferPut() : null;
  f.api.queue('openai_codex', { reasoning_effort: 'high' }, phase !== 'debounce');
  if (phase !== 'debounce') { for (let i = 0; i < 20; i++) await Promise.resolve(); }
  f.switch(); release?.(); await f.flush();
  assert.equal(f.writes.length, phase === 'put' ? 1 : 0, `navigation during ${phase} must not start a late write`);
  assert.ok(f.writes.every(w => w.url.includes('/existing-chat/')), 'never save to later chat');
  assert.equal(f.context.window.__pmChatModelRoute, undefined, 'late completion must not change later UI');
  assert.equal(f.storage.size, 0, 'late completion must not overwrite saved selection');
}
console.log('PASS mobile reasoning route: actual module, 12 identity/default cases + 3 navigation races');
