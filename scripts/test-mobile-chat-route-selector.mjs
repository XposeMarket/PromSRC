// Executes the real selector/logo helpers (not source regex): the reasoning
// sheet + Advanced rows must follow the ACTIVE CHAT's model route, and sidebar
// logos must come from the chat's route or last answering model, never the
// global Settings default. (Raul IMG_1215-1217, 2026-10-28.)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const badge = fs.readFileSync(new URL('../web-ui/src/mobile/mobile-model-badge.js', import.meta.url), 'utf8');
const start = badge.indexOf('let _chatRouteCache = null;');
const end = badge.indexOf('\nfunction _activeChatSessionId(');
assert.ok(start > 0 && end > start, 'route overlay helpers must exist ahead of _activeChatSessionId');
const helpers = badge.slice(start, end);

function sandbox(activeSessionId) {
  const ctx = { window: { __pmChat: { activeSessionId } }, _llmCache: null, _mainChatDefaultEffort: 'low' };
  ctx._activeChatSessionId = () => String(ctx.window.__pmChat.activeSessionId || '');
  vm.runInNewContext(`${helpers}; this.api = { _rememberChatRoute, _cachedRouteFor, _activeModel, _providerCfg };`, ctx);
  return ctx;
}
const globalLlm = {
  provider: 'anthropic',
  providers: {
    anthropic: { model: 'claude-opus-5-5', reasoning_effort: 'low' },
    openai_codex: { model: 'gpt-6-luna', reasoning_effort: 'xhigh' },
  },
};
const astraRoute = { mode: 'explicit', override: { providerId: 'openai_codex', model: 'gpt-6-astra', reasoningEffort: 'medium' },
  effective: { providerId: 'openai_codex', model: 'gpt-6-astra', reasoningEffort: 'medium', speed: 'standard' } };

// Polarity 1: chat routed to Astra -> sheet + advanced show Astra / medium, not global Opus.
{
  const ctx = sandbox('chat-a');
  ctx.api._rememberChatRoute('chat-a', astraRoute);
  assert.deepEqual({ ...ctx.api._activeModel(globalLlm) }, { provider: 'openai_codex', model: 'gpt-6-astra' });
  const cfg = ctx.api._providerCfg('openai_codex', globalLlm);
  assert.equal(cfg.model, 'gpt-6-astra');
  assert.equal(cfg.reasoning_effort, 'medium');
  assert.equal(ctx.window.__pmChatModelRoute, astraRoute);
}
// Polarity 2: no route for this chat -> global Settings model (unchanged behavior).
{
  const ctx = sandbox('chat-b');
  assert.deepEqual({ ...ctx.api._activeModel(globalLlm) }, { provider: 'anthropic', model: 'claude-opus-5-5' });
  assert.equal(ctx.api._providerCfg('anthropic', globalLlm).model, 'claude-opus-5-5');
}
// A route cached for another chat never leaks into the active chat.
{
  const ctx = sandbox('chat-a');
  ctx.api._rememberChatRoute('chat-a', astraRoute);
  ctx.window.__pmChat.activeSessionId = 'chat-b';
  assert.equal(ctx.api._activeModel(globalLlm).provider, 'anthropic');
  assert.equal(ctx.api._cachedRouteFor('chat-b'), null);
}
console.log('PASS chat-route selector overlay: routed chat, unrouted chat, cross-chat isolation');

const shell = fs.readFileSync(new URL('../web-ui/src/mobile/mobile-shell.js', import.meta.url), 'utf8');
const logoStart = shell.indexOf('function _mobileSessionModelLogo(');
const logoEnd = shell.indexOf('\nfunction _projectButtonHtml(');
assert.ok(logoStart > 0 && logoEnd > logoStart);
const brands = {
  claude: { key: 'claude', label: 'Claude', asset: 'claude.svg' },
  openai: { key: 'openai', label: 'OpenAI', asset: 'openai.svg' },
  chatgpt: { key: 'chatgpt', label: 'ChatGPT', asset: 'chatgpt.svg' },
};
const logoCtx = { MOBILE_IMPORTED_SOURCE_BRANDS: brands, _drawerDefaultModel: { provider: 'anthropic', model: 'claude-opus-5-5' } };
vm.runInNewContext(`${shell.slice(logoStart, logoEnd)}; this.logo = _mobileSessionModelLogo;`, logoCtx);
const logo = logoCtx.logo;
assert.match(logo({ lastModel: { providerId: 'openai_codex', model: 'gpt-6-astra' } }), /openai\.svg/, 'OpenAI-answered chat shows OpenAI');
assert.match(logo({ lastModel: { providerId: 'anthropic', model: 'claude-opus-5-5' } }), /claude\.svg/, 'Anthropic-answered chat shows Claude');
assert.equal(logo({}), '', 'chat with no route and no answer shows no logo, not the global default');
assert.match(logo({ chatModelRoute: { providerId: 'openai_codex', model: 'gpt-6-astra' }, lastModel: { providerId: 'anthropic', model: 'claude-opus-5-5' } }), /openai\.svg/, 'explicit chat route wins');
console.log('PASS sidebar logo source: last model, explicit route, no global fallback');
