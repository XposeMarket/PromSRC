/**
 * models-page.js — Settings > Models in the grouped-card style (desktop and the
 * phone layout of the same modal).
 *
 * The page is a view over the existing Models controls, which stay mounted in
 * #settings-models-store (hidden). Every save still goes through the existing
 * saveSettings() path, so an untouched page sends exactly what it sent before.
 * The view only reads those controls and writes user choices back into them.
 */
import {
  esc, skIcon, skSection, skCard, skRow, skSwitch, skSegmented, skFold, skFoldBody, skButton, skEmpty, skNote,
  wireKit, openSheet, closeSheets, openModelPicker, closeModelPicker, modelSlotState, buildPickerGroups, createChangeTracker,
} from './settings-kit.js';
import { renderProviderLogo } from '../components/provider-logo.js';
import { hubProviderLogo } from '../components/hub-provider-logo.js';
import { formatModelDisplayName } from '../model-display.js';
import { formatReasoningSelectorLabel, supportsFastSpeed, effortOptions } from '../reasoning-capabilities.js';
import { getCachedCredentialedModelProviderIds } from '../components/model-provider-credentials.js';
import { contextChoices, contextSaveBody } from '../context-selection.js';

const LOCAL_PROVIDERS = new Set(['ollama', 'lm_studio', 'llama_cpp']);
const PROVIDER_ORDER = ['anthropic', 'openai_codex', 'openai', 'xai', 'gemini', 'perplexity', 'ollama', 'lm_studio', 'llama_cpp'];
const PROVIDER_INFO = {
  anthropic: { name: 'Claude', add: 'Sign in with Claude Pro or Max, or paste an API key' },
  openai_codex: { name: 'ChatGPT', add: 'Sign in with ChatGPT Plus or Pro' },
  openai: { name: 'OpenAI API', add: 'Pay as you go with an OpenAI API key' },
  xai: { name: 'xAI', add: 'Grok with an API key or your Grok account' },
  gemini: { name: 'Google Gemini', add: 'Use a Gemini API key from Google AI Studio' },
  perplexity: { name: 'Perplexity', add: 'Web-grounded Sonar models with an API key' },
  ollama: { name: 'Ollama', add: 'Run open models on this computer' },
  lm_studio: { name: 'LM Studio', add: 'Use the model loaded in LM Studio on this computer' },
  llama_cpp: { name: 'llama.cpp', add: 'Connect a llama.cpp server on this computer' },
};

const JOBS = [
  { kind: 'voice', key: 'voice', label: 'Voice', desc: 'When you talk out loud', icon: 'mic' },
  { kind: 'amd', key: 'switch-model-low', label: 'Quick steps', desc: 'A lighter model for easy steps', icon: 'zap' },
  { kind: 'amd', key: 'switch-model-medium', label: 'Careful steps', desc: 'A mid model for multi-step work', icon: 'eye' },
  { kind: 'amd', key: 'background-spawn', label: 'Background agents', desc: 'Helpers Prom starts while it keeps working', icon: 'bot' },
  { kind: 'amd', key: 'coordinator', label: 'Team coordinator', desc: "Routes work between a team's members", icon: 'users' },
  { kind: 'amd', key: 'manager', label: 'Team manager', desc: 'Runs each team and checks its results', icon: 'brief' },
  { kind: 'amd', key: 'subagent', label: 'New agents', desc: "Any agent that doesn't have its own model", icon: 'layers' },
];
const ROLES = [
  ['planner', 'Planner', 'Breaks a goal into steps'],
  ['orchestrator', 'Orchestrator', 'Hands steps to other agents'],
  ['researcher', 'Researcher', 'Finds and reads sources'],
  ['analyst', 'Analyst', 'Works through data and numbers'],
  ['builder', 'Builder', 'Writes code and files'],
  ['operator', 'Operator', 'Runs apps, browser and tools'],
  ['verifier', 'Verifier', 'Checks finished work'],
].map(([role, label, desc]) => ({ kind: 'amd', key: `subagent-${role}`, label, desc, inherit: 'Same as New agents' }));
const SYSTEM = [
  { kind: 'goal', key: 'compactor', label: 'Summaries', desc: 'Shortens long goal runs so they fit' },
  { kind: 'amd', key: 'proposal-high', label: 'Approved proposals · higher risk', desc: 'Carries out a proposal after you approve it' },
  { kind: 'amd', key: 'proposal-low', label: 'Approved proposals · lower risk', desc: 'For small, easily undone changes' },
  { kind: 'brain', key: 'thought', label: 'Brain Thought', desc: 'Thinks on its own between chats', toggle: true },
  { kind: 'brain', key: 'dream', label: 'Brain Dream', desc: 'Overnight review of the day', toggle: true },
  { kind: 'brain-only', key: 'cleanup', label: 'Brain Cleanup', desc: 'Tidies old Brain output', toggle: true },
];
const VOICE_PROVIDERS = { '': 'Same as your voice setting', openai_codex: 'Codex Voice', openai_realtime: 'OpenAI Realtime', xai: 'xAI Realtime' };

let deps = null;
let root = null;
let mounted = false;
const tracker = createChangeTracker();
const fieldOriginals = new Map();
const modelCache = new Map();
const foldState = { roles: false, system: false };
let ctx = null; // { profile, budget, mode, tokens, ack, loaded:{mode,tokens} }
let renderQueued = false;

const $ = (id) => document.getElementById(id);

export function providerName(id) {
  const catalog = deps?.getCatalog?.() || [];
  return PROVIDER_INFO[id]?.name || catalog.find((item) => item.id === id)?.name || String(id || '');
}

export function providerLogo(id, size = 16) {
  const html = id === 'gemini' || id === 'ollama' ? hubProviderLogo(id) : renderProviderLogo(id, '', 'sk-logo');
  return html.replace('<svg ', `<svg width="${size}" height="${size}" `).replace('class="hu-logo"', 'class="sk-logo"');
}

function modelLabel(provider, model) {
  try { return formatModelDisplayName(model, provider) || model; } catch { return model; }
}

function connectedProviders() {
  return getCachedCredentialedModelProviderIds();
}

/** The store controls behind one slot. */
function slotIO(kind, key) {
  if (kind === 'amd') {
    return { prov: $(`amd-${key}-prov`), model: $(`amd-${key}-model`), reasoning: $(`amd-${key}-reasoning`), speed: $(`amd-${key}-speed`), account: $(`amd-${key}-account`) };
  }
  if (kind === 'goal') return { prov: $(`goal-${key}-prov`), model: $(`goal-${key}-model`), reasoning: $(`goal-${key}-reasoning`), speed: null };
  if (kind === 'brain') return { prov: $(`brain-${key}-prov`), model: $(`brain-${key}-model`), reasoning: $(`brain-${key}-reasoning`), speed: null };
  return {};
}

function readSlot(kind, key) {
  const io = slotIO(kind, key);
  return {
    provider: String(io.prov?.value || '').trim(),
    model: String(io.model?.value || '').trim(),
    reasoning: String(io.reasoning?.value || '').trim(),
    speed: io.speed ? (io.speed.value === 'fast' ? 'fast' : 'standard') : '',
    account: String(io.account?.value || '').trim(),
  };
}

/** The slot's existing account choice (store select amd-*-account), offered only when its provider has more than one account. */
function accountChoices(kind, key) {
  const select = slotIO(kind, key).account;
  if (!select || select.options.length < 2) return null;
  return {
    options: Array.from(select.options).map((option) => ({ value: option.value, label: option.textContent.trim() || option.value })),
    value: select.value,
  };
}

function accountLabel(kind, key) {
  const choices = accountChoices(kind, key);
  return choices ? (choices.options.find((option) => option.value === choices.value)?.label || '') : '';
}

function ensureOption(select, value, label = value) {
  if (!select || !value) return;
  if (!Array.from(select.options).some((option) => option.value === value)) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }
}

/** Main chat: the saved main_chat default when set, otherwise the live provider route. */
function mainChat() {
  const amd = readSlot('amd', 'main-chat');
  if (amd.provider && amd.model) return { source: 'amd', ...amd };
  return liveRoute();
}

/** The provider's own model (what Main chat uses with no main_chat default saved). */
function liveRoute() {
  const llm = deps?.getLlm?.() || {};
  const provider = String(llm.provider || '').trim();
  const control = provider ? deps.providerModelControl(provider) : null;
  const model = String(control?.value || llm.providers?.[provider]?.model || '').trim();
  const effortEl = $(deps.liveEffortId(provider));
  const speedEl = $(deps.liveSpeedId(provider));
  return {
    source: 'live',
    provider,
    model,
    reasoning: String(effortEl?.value || '').trim(),
    speed: speedEl?.value === 'fast' ? 'fast' : 'standard',
    effortEl,
    speedEl,
  };
}

function mainChatLabel() {
  const main = mainChat();
  return main.provider && main.model ? modelLabel(main.provider, main.model) : 'Your main chat model';
}

function reasoningChoices(provider, model, select) {
  // Options come from the store select (it already mirrors the model's real levels).
  const values = select ? Array.from(select.options).map((option) => option.value) : effortOptions(provider, model, true);
  return values.map((value) => ({ value, label: value ? formatReasoningSelectorLabel(value, provider, model) : 'Default' }));
}

/**
 * Every limit window the provider reports for the account its row stands for (for example
 * Claude's 5-hour, Weekly and Weekly · Opus), in the provider's own order. The row shows the
 * default account, else the first account with limit data. Per-model entries (Codex Spark)
 * are a different meter and are left to the Hub's usage cards.
 */
function usageWindows(provider) {
  const entries = ((deps?.getUsage?.() || {})[provider] || []).filter((entry) => entry && entry.usage_scope !== 'model');
  const windowsOf = (entry) => (Array.isArray(entry.windows) ? entry.windows : [])
    .map((w) => ({ label: String(w?.label || 'Limit'), used: Number(w?.used_percent), reset: w?.reset_at || null }))
    .filter((w) => Number.isFinite(w.used));
  const hasData = (entry) => windowsOf(entry).length > 0 || entry.budget?.limit_tokens > 0;
  const defaultId = String(deps?.getLlm?.()?.providers?.[provider]?.defaultAccountId || '');
  const entry = entries.find((item) => defaultId && String(item.account_id || '') === defaultId && hasData(item)) || entries.find(hasData);
  if (!entry) return [];
  const windows = windowsOf(entry);
  if (windows.length) return windows;
  return [{ label: 'Monthly budget', used: Number(entry.budget.used_percent) || 0, reset: null }];
}

/** The tightest window: the one number shown where there is only room for one (the model picker). */
function usageFor(provider) {
  const windows = usageWindows(provider);
  return windows.length ? windows.reduce((a, b) => (b.used > a.used ? b : a)) : null;
}

function resetText(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const mins = Math.round((t - Date.now()) / 60000);
  if (mins <= 0) return 'resets now';
  if (mins < 60) return `resets in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `resets in ${hrs}h${mins % 60 ? ` ${mins % 60}m` : ''}`;
  return `resets in ${Math.round(hrs / 24)}d`;
}

/* ─── Render ──────────────────────────────────────────────────────────────── */

function setUpProviders() {
  const llm = deps.getLlm() || {};
  const ids = new Set(connectedProviders());
  const live = String(llm.provider || '');
  if (LOCAL_PROVIDERS.has(live) && String(llm.providers?.[live]?.model || '').trim()) ids.add(live);
  const order = [...PROVIDER_ORDER, ...Array.from(ids).filter((id) => !PROVIDER_ORDER.includes(id)).sort()];
  return order.filter((id) => ids.has(id));
}

function addableProviders() {
  const shown = new Set(setUpProviders());
  const catalog = (deps.getCatalog() || []).map((item) => item.id);
  const ids = [...PROVIDER_ORDER, ...catalog.filter((id) => !PROVIDER_ORDER.includes(id) && id !== 'x')];
  return Array.from(new Set(ids)).filter((id) => !shown.has(id) && (catalog.length ? catalog.includes(id) : true));
}

function accountDesc(provider) {
  if (LOCAL_PROVIDERS.has(provider)) return 'Runs on this computer';
  const cfg = deps.getLlm()?.providers?.[provider] || {};
  const accounts = (deps.normalizeAccounts(provider, cfg) || []).filter((account) => account.status !== 'disconnected');
  const def = accounts.find((account) => account.id === cfg.defaultAccountId) || accounts[0];
  const subscription = def && (def.authType === 'oauth' || def.authType === 'setup_token');
  const base = subscription
    ? (provider === 'anthropic' ? 'Signed in with your Claude subscription' : provider === 'openai_codex' ? 'Signed in with your ChatGPT account' : `Signed in with your ${providerName(provider)} account`)
    : 'Connected with an API key';
  return accounts.length > 1 ? `${base} · ${accounts.length} accounts` : base;
}

function accountUsage(provider) {
  const windows = usageWindows(provider);
  if (windows.length) {
    // One labelled line per window, so a short window (5-hour) is never hidden behind a long one (weekly).
    return `<div class="sk-use sk-wins">${windows.map((w) => {
      const left = Math.max(0, Math.min(100, Math.round(100 - w.used)));
      const reset = resetText(w.reset);
      const tone = left <= 10 ? ' crit' : left <= 25 ? ' warn' : '';
      return `<div class="sk-win${tone}" data-window="${esc(w.label)}"><div class="sk-win-head"><span>${esc(w.label)}${reset ? ` · ${esc(reset)}` : ''}</span><b>${left}% left</b></div><div class="sk-bar"><i style="width:${left}%"></i></div></div>`;
    }).join('')}</div>`;
  }
  if (LOCAL_PROVIDERS.has(provider)) return '<div class="sk-use">No usage limits</div>';
  const subscription = /Signed in/.test(accountDesc(provider));
  return `<div class="sk-use">${subscription ? 'Usage shows here once loaded' : `Billed by ${esc(providerName(provider))} as you use it`}</div>`;
}

function renderAccounts() {
  const providers = setUpProviders();
  if (!providers.length) {
    const choices = ['anthropic', 'openai_codex', 'gemini', 'openai', 'ollama'].filter((id) => addableProviders().includes(id));
    const actions = choices.map((id) => `<button type="button" class="sk-choice" data-add="${esc(id)}">${providerLogo(id, 18)}<span><b>${esc(providerName(id))}</b><small>${esc(PROVIDER_INFO[id]?.add || '')}</small></span></button>`).join('')
      + `<button type="button" class="sk-choice sk-choice-more" data-add="">${skIcon('plus')}<span><b>Something else</b><small>Perplexity, xAI, LM Studio, llama.cpp</small></span></button>`;
    return skSection({ title: 'Accounts' }) + skCard(skEmpty({
      title: 'Connect a model to get started',
      body: 'Prometheus needs at least one AI provider. Sign in with a subscription you already have, use an API key, or run a model on this computer.',
      actions,
    }), { cls: 'sk-card-empty' });
  }
  const rows = providers.map((id) => `<div class="sk-row sk-acct" data-provider="${esc(id)}">
      <span class="sk-logo-tile" aria-hidden="true">${providerLogo(id, 18)}</span>
      <div class="sk-copy"><div class="sk-name">${esc(providerName(id))}</div><div class="sk-desc"><i class="sk-dot" aria-hidden="true"></i>${esc(accountDesc(id))}</div></div>
      ${accountUsage(id)}
      ${skButton('Manage', { attrs: `data-manage="${esc(id)}" aria-label="Manage ${esc(providerName(id))}"` })}
    </div>`).join('');
  const addable = addableProviders();
  const names = addable.filter((id) => !LOCAL_PROVIDERS.has(id)).slice(0, 3).map(providerName);
  const addRow = addable.length ? `<div class="sk-row sk-acct sk-acct-add">
      <span class="sk-logo-tile add" aria-hidden="true">${skIcon('plus')}</span>
      <div class="sk-copy"><div class="sk-name">Add a provider</div><div class="sk-desc">${esc(names.length ? `${names.join(', ')} or a local model` : 'A model on this computer')}</div></div>
      <div class="sk-strip" aria-hidden="true">${addable.slice(0, 3).map((id) => providerLogo(id, 15)).join('')}${addable.length > 3 ? '<span>and more</span>' : ''}</div>
      ${skButton('Add', { kind: 'primary', attrs: 'data-add=""' })}
    </div>` : '';
  return skSection({ title: 'Accounts' }) + skCard(rows + addRow, { cls: 'sk-accounts' });
}

function pickTrigger({ id, provider, model, inherit = 'Same as main chat', label = '', sub = '' }) {
  const list = provider ? modelCache.get(provider)?.list || null : null;
  const { state, reason } = modelSlotState({ provider, model, connected: connectedProviders(), available: list });
  const chev = skIcon('down', 'sk-ico sk-chev');
  const aria = `aria-haspopup="dialog" aria-expanded="false" aria-label="${esc(label ? `${label} model` : 'Model')}"`;
  if (state === 'same') return `<button type="button" class="sk-pick same" data-pick="${esc(id)}" ${aria}><span class="m">${esc(inherit)}</span>${chev}</button>`;
  if (state === 'unavailable') {
    const why = reason === 'not-connected' ? `${providerName(provider)} is not connected` : `${providerName(provider)} no longer lists this model`;
    return `<button type="button" class="sk-pick unavail" data-pick="${esc(id)}" ${aria} title="${esc(`${why}. Saved as ${provider}/${model}; it is kept until you choose another model.`)}">${providerLogo(provider, 14)}<span class="sk-stack"><span class="m">${esc(model)}</span><small>${reason === 'not-connected' ? 'unavailable · not connected' : 'unavailable'}</small></span>${chev}</button>`;
  }
  const name = sub
    ? `<span class="sk-stack"><span class="m">${esc(modelLabel(provider, model))}</span><small>${esc(sub)}</small></span>`
    : `<span class="m">${esc(modelLabel(provider, model))}</span>`;
  return `<button type="button" class="sk-pick" data-pick="${esc(id)}" ${aria} title="${esc(`${provider}/${model}`)}">${providerLogo(provider, 14)}${name}${chev}</button>`;
}

function reasonSelect(id, slot, select, label) {
  if (!slot.provider || !slot.model || !select) return '<span class="sk-na" aria-hidden="true">—</span>';
  const choices = reasoningChoices(slot.provider, slot.model, select);
  if (choices.length <= 1) return '<span class="sk-na" title="This model has no reasoning setting">—</span>';
  return `<select class="sk-select" data-reason="${esc(id)}" aria-label="${esc(`Reasoning for ${label}`)}">${choices.map((c) => `<option value="${esc(c.value)}"${c.value === slot.reasoning ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</select>`;
}

function slotRow(def, { inset = false } = {}) {
  const id = `${def.kind}:${def.key}`;
  if (def.kind === 'voice') {
    const provEl = $('amd-voice-agent-provider');
    const voiceEl = $('amd-voice-agent-voice');
    const prov = String(provEl?.value || '');
    const voices = voiceEl ? Array.from(voiceEl.options).map((o) => o.value) : [];
    const control = `<div class="sk-voice"><select class="sk-select" data-voice="provider" aria-label="Voice provider">${Object.entries(VOICE_PROVIDERS).map(([v, l]) => `<option value="${esc(v)}"${v === prov ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`
      + (prov ? `<select class="sk-select" data-voice="voice" aria-label="Voice">${voices.map((v) => `<option value="${esc(v)}"${v === voiceEl.value ? ' selected' : ''}>${esc(v ? v.charAt(0).toUpperCase() + v.slice(1) : 'Default voice')}</option>`).join('')}</select>` : '')
      + '</div>';
    return `<div class="sk-row sk-job"><div class="sk-who"><span class="sk-tile" aria-hidden="true">${skIcon(def.icon)}</span><div class="sk-copy"><div class="sk-name">${esc(def.label)}</div><div class="sk-desc">${esc(def.desc)}</div></div></div>${control}<span class="sk-na" aria-hidden="true">—</span></div>`;
  }
  const toggle = def.toggle ? (() => {
    const box = $(`brain-${def.key}-enabled`);
    return `<span class="sk-slot">${skSwitch({ checked: !!box?.checked, label: `Turn ${def.label} on or off`, attrs: `data-brain-toggle="${esc(def.key)}"` })}</span>`;
  })() : (SYSTEM.includes(def) ? '<span class="sk-slot"></span>' : '');
  const lead = def.icon ? `<span class="sk-tile" aria-hidden="true">${skIcon(def.icon)}</span>` : toggle;
  const who = `<div class="sk-who">${lead}<div class="sk-copy"><div class="sk-name">${esc(def.label)}</div><div class="sk-desc">${esc(def.desc)}</div></div></div>`;
  if (def.kind === 'brain-only') return `<div class="sk-row sk-job">${who}<span></span><span></span></div>`;
  const slot = readSlot(def.kind, def.key);
  const io = slotIO(def.kind, def.key);
  return `<div class="sk-row sk-job${inset ? ' inset' : ''}">${who}${pickTrigger({ id, provider: slot.provider, model: slot.model, inherit: def.inherit || 'Same as main chat', label: def.label, sub: def.kind === 'amd' ? accountLabel(def.kind, def.key) : '' })}${reasonSelect(id, slot, io.reasoning, def.label)}</div>`;
}

function fmtTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1000000) return `${(v / 1000000).toFixed(v % 1000000 ? 1 : 0)}M`;
  if (v >= 1000) return `${Math.round(v / 1000)}k`;
  return String(v);
}

function ctxTokens(mode) {
  const c = contextChoices(ctx.profile);
  if (mode === 'standard') return c.standard;
  if (mode === 'maximum') return c.maximum;
  if (mode === '500k') return 500000;
  return Number(ctx.tokens) || c.selected;
}

function renderMemoryRows() {
  if (!ctx?.profile) {
    return skRow({ label: 'Memory per chat', desc: 'How much of a long chat the model keeps in view', control: '<span class="sk-muted">Loading…</span>' });
  }
  const c = contextChoices(ctx.profile);
  const seg = ctx.mode === 'standard' ? 'standard' : ctx.mode === 'custom' ? 'custom' : 'extended';
  const options = [{ value: 'standard', label: `Standard · ${fmtTokens(c.standard)}` }];
  if (c.maximum > c.standard) options.push({ value: 'extended', label: 'Extended' });
  if (c.choices.length > 1) options.push({ value: 'custom', label: 'Custom' });
  let html = skRow({ label: 'Memory per chat', desc: 'How much of a long chat the model keeps in view', control: options.length > 1 ? skSegmented({ name: 'ctx-mode', options, value: seg, label: 'Memory per chat' }) : `<span class="sk-muted">${esc(options[0].label)}</span>` });
  if (seg === 'extended') {
    const sizes = [];
    if (c.has500k) sizes.push({ value: '500k', label: '500k' });
    sizes.push({ value: 'maximum', label: `Maximum · ${fmtTokens(c.maximum)}` });
    html += skRow({ cls: 'sk-subrow', label: 'Size', desc: 'Larger sizes keep more of the chat', control: skSegmented({ name: 'ctx-size', options: sizes, value: ctx.mode === '500k' ? '500k' : 'maximum', label: 'Extended size' }) });
  }
  if (seg === 'custom') {
    html += skRow({ cls: 'sk-subrow', label: 'Size', desc: 'Tokens the model keeps in view', forId: 'sk-ctx-tokens', control: `<select class="sk-select" id="sk-ctx-tokens" data-ctx-tokens>${c.choices.map((n) => `<option value="${n}"${n === Number(ctx.tokens) ? ' selected' : ''}>${esc(Number(n).toLocaleString())} tokens</option>`).join('')}</select>` });
  }
  if (ctxTokens(ctx.mode) > c.standard) {
    const warning = ctx.profile.contextUsageWarning || 'Larger requests use more tokens. Provider pricing and subscription rules vary.';
    html += `<div class="sk-row sk-subrow sk-ack${ctx.ack ? '' : ' needs'}"><div class="sk-who"><span class="sk-tile warn" aria-hidden="true">${skIcon('warn')}</span><div class="sk-copy"><div class="sk-name">Uses more allowance</div><div class="sk-desc">${esc(warning)}</div></div></div>`
      + `<label class="sk-check"><input type="checkbox" data-ctx-ack${ctx.ack ? ' checked' : ''}> I understand extended context may use more allowance or cost more.</label></div>`;
  }
  return html;
}

function renderMain() {
  const main = mainChat();
  const p = main.provider;
  const m = main.model;
  const choices = main.source === 'amd'
    ? reasoningChoices(p, m, $('amd-main-chat-reasoning'))
    : (p && m ? effortOptions(p, m, true) : ['']).map((value) => ({ value, label: value ? formatReasoningSelectorLabel(value, p, m) : 'Default' }));
  const reasoning = choices.some((c) => c.value === main.reasoning) ? main.reasoning : '';
  const speedEl = main.source === 'amd' ? $('amd-main-chat-speed') : main.speedEl;
  const fast = !!speedEl && !!p && !!m && supportsFastSpeed(p, m);
  const modelControl = p && m
    ? pickTrigger({ id: 'main', provider: p, model: m, label: 'Main chat', sub: main.source === 'amd' ? accountLabel('amd', 'main-chat') : 'Provider default' })
    : `<button type="button" class="sk-pick same" data-pick="main" aria-haspopup="dialog" aria-label="Main chat model"><span class="m">Choose a model</span>${skIcon('down', 'sk-ico sk-chev')}</button>`;
  const rows = [
    skRow({ label: 'Model', control: `<div class="sk-main-pick">${modelControl}</div>` }),
    skRow({ label: 'Reasoning', desc: 'Higher thinks longer before answering', control: choices.length > 1 ? skSegmented({ name: 'main-reasoning', options: choices, value: reasoning, label: 'Reasoning' }) : '<span class="sk-muted">Set by the model</span>' }),
    skRow({ label: 'Fast mode', desc: fast ? 'Quicker replies. Uses your allowance faster.' : 'Not offered for this model', control: skSwitch({ checked: fast && main.speed === 'fast', disabled: !fast, label: 'Fast mode', attrs: 'data-main-fast' }) }),
    renderMemoryRows(),
  ];
  return skSection({ title: 'Main chat', hint: 'What you talk to. New chats start here.' }) + skCard(rows.join(''), { cls: 'sk-main' });
}

function presetButton() {
  const t = deps.templates();
  const active = t.list.find((item) => item.id === t.activeId);
  return `<button type="button" class="sk-preset" data-preset aria-haspopup="dialog">Preset <span>${esc(active?.name || 'None')}${skIcon('down', 'sk-ico sk-chev')}</span></button>`;
}

function renderJobs() {
  const roleSet = ROLES.filter((def) => readSlot('amd', def.key).provider).length;
  const brainOn = ['thought', 'dream', 'cleanup'].some((type) => $(`brain-${type}-enabled`)?.checked);
  const head = '<div class="sk-row sk-job sk-head" aria-hidden="true"><div>Job</div><div>Model</div><div>Reasoning</div></div>';
  const jobs = JOBS.map((def) => slotRow(def)).join('');
  const roles = skFold({ id: 'roles', label: 'By role', desc: `Planner, Researcher, Builder and 4 more · ${roleSet ? `${roleSet} ${roleSet === 1 ? 'has its' : 'have their'} own model` : 'all follow New agents'}`, open: foldState.roles, cls: 'inset' })
    + skFoldBody('roles', ROLES.map((def) => slotRow(def, { inset: true })).join(''), { open: foldState.roles });
  const system = skFold({ id: 'system', label: 'System', desc: `Summaries, approved proposals and Brain · Brain is ${brainOn ? 'on' : 'off'}`, icon: skIcon('cog'), open: foldState.system })
    + skFoldBody('system', SYSTEM.map((def) => slotRow(def)).join('') + skNote('Brain runs use your model allowance and are off by default. The Brain switches take effect right away.'), { open: foldState.system, cls: 'sys' });
  return skSection({ title: 'Other jobs', hint: 'Leave on "Same as main chat" unless you want something different.', right: presetButton() })
    + skCard(head + jobs + roles + system, { cls: 'sk-jobs' });
}

export function render() {
  if (!root || !deps) return;
  renderQueued = false;
  const scroller = root.closest('.settings-page-main');
  const top = scroller ? scroller.scrollTop : 0;
  const focusKey = document.activeElement?.closest?.('#settings-models-v2') ? (document.activeElement.getAttribute('data-pick') || '') : '';
  // Nothing connected: a fresh install shows only the connect-a-model state;
  // an install with saved model choices keeps showing them (as unavailable).
  const showRows = setUpProviders().length > 0 || hasSavedModels();
  root.innerHTML = '<p class="sk-lede">Choose what Prometheus runs on. Anything you don\'t set here uses your main chat model.</p>'
    + renderAccounts() + (showRows ? renderMain() + renderJobs() : '');
  if (scroller) scroller.scrollTop = top;
  if (focusKey) root.querySelector(`[data-pick="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
}

/** Any saved model choice on this page (not counting the built-in local default). */
export function hasSavedModels() {
  const defs = [{ kind: 'amd', key: 'main-chat' }, ...JOBS.filter((def) => def.kind === 'amd'), ...ROLES, ...SYSTEM.filter((def) => def.kind !== 'brain-only')];
  if (defs.some((def) => { const slot = readSlot(def.kind, def.key); return !!(slot.provider && slot.model); })) return true;
  if (String($('amd-voice-agent-provider')?.value || '').trim()) return true;
  const llm = deps?.getLlm?.() || {};
  const provider = String(llm.provider || '').trim();
  return !!provider && !LOCAL_PROVIDERS.has(provider) && !!String(llm.providers?.[provider]?.model || '').trim();
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => render());
}

/* ─── Model lists and the picker ──────────────────────────────────────────── */

function loadModels(provider) {
  if (!provider || modelCache.has(provider)) return modelCache.get(provider)?.promise;
  const entry = { list: null, promise: null };
  modelCache.set(provider, entry);
  entry.promise = Promise.resolve(deps.listModels(provider))
    .then((list) => { entry.list = Array.isArray(list) ? list : []; queueRender(); return entry.list; })
    .catch(() => { entry.list = null; return []; });
  return entry.promise;
}

function preloadModels() {
  for (const provider of connectedProviders()) loadModels(provider);
}

function pickerGroups() {
  return connectedProviders().map((provider) => {
    const u = usageFor(provider);
    const list = modelCache.get(provider)?.list || deps.fallbackModels(provider) || [];
    return {
      provider,
      name: providerName(provider),
      note: u ? `${Math.max(0, Math.round(100 - u.used))}% left` : (LOCAL_PROVIDERS.has(provider) ? 'On this computer' : ''),
      logo: providerLogo(provider, 13),
      models: list.map((id) => ({ id, label: modelLabel(provider, id) })),
    };
  });
}

function defFor(id) {
  if (id === 'main') return { kind: 'amd', key: 'main-chat', label: 'Main chat' };
  const [kind, key] = id.split(':');
  return [...JOBS, ...ROLES, ...SYSTEM].find((def) => def.kind === kind && def.key === key) || { kind, key, label: key };
}

function trackSlot(def, before) {
  tracker.track(`slot:${def.kind}:${def.key}`, def.label, before, readSlot(def.kind, def.key));
  deps.onChange?.();
}

async function writeSlot(def, value) {
  const io = slotIO(def.kind, def.key);
  if (!io.prov || !io.model) return;
  const before = readSlot(def.kind, def.key);
  const carry = def.key === 'main-chat' && !before.provider ? mainChat() : before;
  if (value.provider) ensureOption(io.prov, value.provider, providerName(value.provider));
  io.prov.value = value.provider || '';
  if (def.kind === 'amd') await deps.amdProviderChange(def.key);
  else if (def.kind === 'goal') await deps.goalRoutingProviderChange(def.key);
  else if (def.kind === 'brain') await deps.brainProviderChange(def.key);
  if (value.provider && value.model) {
    ensureOption(io.model, value.model, value.model);
    io.model.value = value.model;
  }
  if (def.kind === 'amd') {
    deps.syncAmdReasoning(def.key, carry.reasoning || '');
    deps.syncAmdSpeed(def.key, carry.speed || 'standard');
  } else if (def.kind === 'goal') deps.syncGoalRoutingReasoning(def.key, carry.reasoning || '');
  else deps.syncBrainReasoning(def.key, carry.reasoning || '');
  trackSlot(def, before);
}

function writeReasoning(def, value) {
  if (def.key === 'main-chat' && mainChat().source === 'live') return writeLive({ reasoning: value });
  const io = slotIO(def.kind, def.key);
  if (!io.reasoning) return;
  const before = readSlot(def.kind, def.key);
  ensureOption(io.reasoning, value, value);
  io.reasoning.value = value;
  trackSlot(def, before);
}

function writeAccount(def, value) {
  const io = slotIO(def.kind, def.key);
  if (!io.account) return;
  const before = readSlot(def.kind, def.key);
  io.account.value = value;
  trackSlot(def, before);
}

function writeFast(def, on) {
  if (def.key === 'main-chat' && mainChat().source === 'live') return writeLive({ speed: on ? 'fast' : 'standard' });
  const io = slotIO(def.kind, def.key);
  if (!io.speed) return;
  const before = readSlot(def.kind, def.key);
  io.speed.value = on ? 'fast' : 'standard';
  trackSlot(def, before);
}

/** Main chat without a saved main_chat default edits the live provider's own controls. */
function writeLive({ reasoning, speed }) {
  const main = mainChat();
  const before = { reasoning: main.reasoning, speed: main.speed };
  if (reasoning !== undefined && main.effortEl) { ensureOption(main.effortEl, reasoning, reasoning); main.effortEl.value = reasoning; }
  if (speed !== undefined && main.speedEl) main.speedEl.value = speed;
  const after = mainChat();
  tracker.track(`live:${main.provider}`, 'Main chat', before, { reasoning: after.reasoning, speed: after.speed });
  deps.onChange?.();
}

function pickerFooter(def) {
  return () => {
    const slot = def.key === 'main-chat' ? mainChat() : readSlot(def.kind, def.key);
    if (!slot.provider || !slot.model) return null;
    const io = slotIO(def.kind, def.key);
    const select = def.key === 'main-chat' && slot.source === 'live' ? null : io.reasoning;
    const choices = reasoningChoices(slot.provider, slot.model, select);
    const speedEl = def.key === 'main-chat' && slot.source === 'live' ? slot.speedEl : io.speed;
    const live = def.key === 'main-chat' && slot.source === 'live';
    return {
      account: !live && def.kind === 'amd' ? accountChoices(def.kind, def.key) : null,
      reasoning: choices.length > 1 ? { options: choices, value: choices.some((c) => c.value === slot.reasoning) ? slot.reasoning : '' } : null,
      fast: speedEl ? { supported: supportsFastSpeed(slot.provider, slot.model), checked: slot.speed === 'fast' } : null,
    };
  };
}

function openPicker(id, anchor) {
  const def = defFor(id);
  const value = def.key === 'main-chat' ? mainChat() : readSlot(def.kind, def.key);
  let same = null;
  let current = { provider: value.provider, model: value.model };
  if (def.key === 'main-chat') {
    // Clearing the Main chat choice (old "same as main agent") falls back to the
    // model chosen under the provider itself.
    const live = liveRoute();
    same = { label: 'Provider default', note: live.provider && live.model ? `${modelLabel(live.provider, live.model)} · ${providerName(live.provider)}` : 'The model set for your provider' };
    if (value.source === 'live') current = { provider: '', model: '' };
  } else {
    if (def.inherit === 'Same as New agents') {
      const na = readSlot('amd', 'subagent');
      same = { label: 'Same as New agents', note: na.provider && na.model ? modelLabel(na.provider, na.model) : mainChatLabel() };
    } else same = { label: 'Same as main chat', note: mainChatLabel() };
  }
  const saved = value.provider && value.model ? { provider: value.provider, model: value.model, providerName: providerName(value.provider), label: modelLabel(value.provider, value.model) } : null;
  const groups = buildPickerGroups(pickerGroups(), saved);
  openModelPicker({
    anchor,
    title: `${def.label} model`,
    groups,
    value: current,
    same,
    footer: pickerFooter(def),
    onPick: (next) => { writeSlot(def, next).then(() => render()); },
    onReasoning: (v) => { writeReasoning(def, v); queueRender(); },
    onFast: (on) => { writeFast(def, on); queueRender(); },
    onAccount: (v) => { writeAccount(def, v); queueRender(); },
  });
  for (const group of groups) if (!modelCache.get(group.provider)?.list) loadModels(group.provider);
}

/* ─── Context window (Memory per chat) ────────────────────────────────────── */

function loadContextState() {
  const data = deps.getContext?.();
  if (!data?.profile) { ctx = null; return; }
  const c = contextChoices(data.profile);
  ctx = { profile: data.profile, mode: c.mode, tokens: c.selected, ack: c.selected > c.standard };
  ctx.loaded = { mode: ctx.mode, tokens: ctx.tokens };
}

function trackContext() {
  tracker.track('ctx', 'Memory per chat', ctx.loaded, { mode: ctx.mode, tokens: ctxTokens(ctx.mode) });
  deps.onChange?.();
}

/* ─── Events ──────────────────────────────────────────────────────────────── */

function onClick(event) {
  const pick = event.target.closest('[data-pick]');
  if (pick) { openPicker(pick.getAttribute('data-pick'), pick); return; }
  const manage = event.target.closest('[data-manage]');
  if (manage) { openProviderSheet(manage.getAttribute('data-manage'), 'manage'); return; }
  const add = event.target.closest('[data-add]');
  if (add) { const id = add.getAttribute('data-add'); if (id) openProviderSheet(id, 'add'); else openAddChooser(); return; }
  const preset = event.target.closest('[data-preset]');
  if (preset) openPresetMenu(preset);
}

function onChangeEvent(event) {
  const t = event.target;
  if (t.matches('[data-reason]')) { writeReasoning(defFor(t.getAttribute('data-reason')), t.value); return; }
  if (t.matches('[data-ctx-tokens]')) { ctx.tokens = Number(t.value); trackContext(); render(); return; }
  if (t.matches('[data-ctx-ack]')) { ctx.ack = t.checked; deps.onChange?.(); render(); return; }
  if (t.matches('[data-voice]')) {
    const provEl = $('amd-voice-agent-provider');
    const voiceEl = $('amd-voice-agent-voice');
    const before = { provider: provEl?.value || '', voice: voiceEl?.value || '' };
    if (t.getAttribute('data-voice') === 'provider' && provEl) {
      provEl.value = t.value;
      Promise.resolve(deps.loadVoiceAgentDefaultOptions(false)).then(() => {
        tracker.track('voice', 'Voice', before, { provider: provEl.value, voice: voiceEl?.value || '' });
        deps.onChange?.();
        render();
      });
    } else if (voiceEl) {
      voiceEl.value = t.value;
      tracker.track('voice', 'Voice', before, { provider: provEl?.value || '', voice: voiceEl.value });
      deps.onChange?.();
    }
  }
}

function onSeg(event) {
  const group = event.target.closest('[data-seg]')?.getAttribute('data-seg');
  const value = event.detail.value;
  if (group === 'main-reasoning') { writeReasoning(defFor('main'), value); return; }
  if (group === 'ctx-mode' && ctx) {
    const c = contextChoices(ctx.profile);
    if (value === 'standard') ctx.mode = 'standard';
    else if (value === 'custom') { ctx.tokens = ctxTokens(ctx.mode); ctx.mode = 'custom'; }
    else ctx.mode = ctx.mode === '500k' || ctx.mode === 'maximum' ? ctx.mode : (c.has500k ? '500k' : 'maximum');
    trackContext();
    render();
    return;
  }
  if (group === 'ctx-size' && ctx) { ctx.mode = value; trackContext(); render(); }
}

function onSwitch(event) {
  const el = event.target;
  if (el.matches('[data-main-fast]')) { writeFast(defFor('main'), event.detail.checked); return; }
  const brain = el.getAttribute('data-brain-toggle');
  if (brain) {
    const box = $(`brain-${brain}-enabled`);
    if (box) box.checked = event.detail.checked;
    // Same as today: Brain switches apply right away through their own endpoint.
    Promise.resolve(deps.setBrainScheduleEnabled(brain, event.detail.checked)).catch(() => {}).finally(() => render());
  }
}

/* ─── Provider sheets (Manage, Add) ───────────────────────────────────────── */

function trackStoreFields(container, provider) {
  const remember = (event) => {
    const el = event.target;
    if (!el?.id || !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
    if (!fieldOriginals.has(el.id)) fieldOriginals.set(el.id, el.type === 'checkbox' ? el.checked : el.value);
  };
  const changed = (event) => {
    const el = event.target;
    if (!event.isTrusted || !el?.id || !fieldOriginals.has(el.id)) return;
    tracker.track(`field:${el.id}`, `${providerName(provider)} connection`, fieldOriginals.get(el.id), el.type === 'checkbox' ? el.checked : el.value);
    deps.onChange?.();
  };
  container.addEventListener('focusin', remember, true);
  container.addEventListener('pointerdown', remember, true);
  container.addEventListener('input', changed, true);
  container.addEventListener('change', changed, true);
  return () => {
    container.removeEventListener('focusin', remember, true);
    container.removeEventListener('pointerdown', remember, true);
    container.removeEventListener('input', changed, true);
    container.removeEventListener('change', changed, true);
  };
}

export function openProviderSheet(provider, mode = 'manage') {
  closeModelPicker();
  const conn = document.querySelector('.settings-models-connection-panel');
  const accounts = deps.accountsHost?.();
  if (!conn) return;
  deps.showProviderPanel(provider);
  const body = document.createElement('div');
  body.className = 'sk-manage';
  body.dataset.provider = provider;
  const homes = [];
  const borrow = (node) => { if (node) { homes.push([node, node.parentNode, node.nextSibling]); body.appendChild(node); } };
  if (accounts && deps.accountAware(provider) && mode === 'manage') { accounts.dataset.onlyProvider = provider; borrow(accounts); }
  borrow(conn);
  const untrack = trackStoreFields(body, provider);
  const info = PROVIDER_INFO[provider]?.add || '';
  openSheet({
    title: mode === 'add' ? `Add ${providerName(provider)}` : providerName(provider),
    sub: mode === 'add' ? info : accountDesc(provider),
    body,
    cls: 'sk-sheet-provider',
    footer: '<div class="sk-sheet-hint">Connect, Test and Disconnect work right away. Keys and model choices are saved with Save at the bottom of the page.</div>',
    onClose: () => {
      untrack();
      for (const [node, parent, next] of homes.reverse()) { if (parent) parent.insertBefore(node, next && next.parentNode === parent ? next : null); }
      if (accounts) delete accounts.dataset.onlyProvider;
      deps.refreshProviders?.().finally?.(() => { preloadModels(); render(); });
      render();
    },
  });
}

function openAddChooser() {
  const list = addableProviders();
  const body = `<div class="sk-choices">${list.map((id) => `<button type="button" class="sk-choice" data-choose="${esc(id)}">${providerLogo(id, 18)}<span><b>${esc(providerName(id))}</b><small>${esc(PROVIDER_INFO[id]?.add || deps.getCatalog().find((item) => item.id === id)?.description || '')}</small></span>${skIcon('right', 'sk-ico sk-chev')}</button>`).join('') || '<div class="sk-muted">Every provider is already connected.</div>'}</div>`;
  const sheet = openSheet({ title: 'Add a provider', sub: 'Pick how you want to run models', body, cls: 'sk-sheet-add' });
  sheet.body.addEventListener('click', (event) => {
    const id = event.target.closest('[data-choose]')?.getAttribute('data-choose');
    if (!id) return;
    sheet.close();
    setTimeout(() => openProviderSheet(id, 'add'), 0);
  });
}

/* ─── Preset menu (replaces the template controls) ────────────────────────── */

function openPresetMenu(anchor) {
  const t = deps.templates();
  const active = t.list.find((item) => item.id === t.activeId) || null;
  const items = t.list.map((item) => `<button type="button" class="sk-menu-item${item.id === t.activeId ? ' on' : ''}" data-act="apply" data-id="${esc(item.id)}"><span>${esc(item.name)}</span>${item.id === t.defaultId ? '<small>Startup default</small>' : ''}${item.id === t.activeId ? skIcon('check') : ''}</button>`).join('');
  const body = `<div class="sk-menu">
      <div class="sk-menu-label">Presets save every model choice on this page under a name. Picking one applies it right away. A new preset also becomes the one Prometheus starts with.</div>
      ${items || '<div class="sk-menu-empty">No presets yet.</div>'}
      <div class="sk-menu-sep"></div>
      <form class="sk-menu-form" data-act="save-new"><input class="sk-input" name="name" maxlength="64" placeholder="Name for a new preset" aria-label="New preset name"><button type="submit" class="sk-btn">Save as new</button></form>
      ${active ? `<form class="sk-menu-form" data-act="update"><input class="sk-input" name="name" maxlength="64" value="${esc(active.name)}" aria-label="Preset name"><button type="submit" class="sk-btn">Update "${esc(active.name)}"</button></form>
      <div class="sk-menu-row">${active.id === t.defaultId ? '<span class="sk-muted">Starts with Prometheus</span>' : `<button type="button" class="sk-btn ghost" data-act="default" data-id="${esc(active.id)}">Use at startup</button>`}
      <button type="button" class="sk-btn danger ghost" data-act="delete" data-id="${esc(active.id)}">Delete</button></div>` : ''}
      <div class="sk-menu-status" role="status" aria-live="polite"></div>
    </div>`;
  const sheet = openSheet({ title: 'Preset', sub: active ? `Using "${active.name}"` : 'No preset in use', body, cls: 'sk-sheet-menu' });
  const status = sheet.body.querySelector('.sk-menu-status');
  const run = async (act, id, name) => {
    status.textContent = 'Working…';
    try {
      await deps.templateOps[act](id, name);
      const text = $('amd-template-status')?.textContent || '';
      if (act === 'apply' || act === 'default') { for (const key of tracker.keys()) if (key.startsWith('slot:amd:')) tracker.forget(key); }
      deps.onChange?.();
      render();
      if (act === 'delete') { status.textContent = text; return; }
      sheet.close();
    } catch (e) { status.textContent = e?.message || 'That did not work. Try again.'; }
  };
  sheet.body.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-act]');
    if (btn) run(btn.getAttribute('data-act'), btn.getAttribute('data-id') || '', '');
  });
  sheet.body.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.target;
    const name = String(new FormData(form).get('name') || '').trim();
    if (!name) { status.textContent = 'Give the preset a name first.'; return; }
    run(form.getAttribute('data-act') === 'update' ? 'update' : 'saveNew', active?.id || '', name);
  });
}

/* ─── Save bar contract ───────────────────────────────────────────────────── */

export function modelsChanges() {
  return tracker.labels();
}

export function modelsSaveNote() {
  if (!ctx || !tracker.has('ctx')) return '';
  return ctxTokens(ctx.mode) > contextChoices(ctx.profile).standard && !ctx.ack ? 'Confirm the usage note under Memory per chat' : '';
}

async function reloadAll() {
  await deps.reload();
  loadContextState();
  modelCache.clear();
  preloadModels();
  render();
}

/** Which Models request carries a tracked change (see MODELS_SAVE_STAGES in SettingsPage.js). */
function saveStageOf(key) {
  if (key === 'ctx') return '';
  if (key.startsWith('slot:brain:')) return 'brain';
  if (key.startsWith('slot:amd:') || key === 'voice') return 'defaults';
  return 'bulk'; // live:* Main chat reasoning/speed, field:* provider settings, slot:goal:* Summaries
}

function forgetSavedStages(stages = []) {
  for (const key of tracker.keys()) {
    if (!stages.includes(saveStageOf(key))) continue;
    tracker.forget(key);
    if (key.startsWith('field:')) fieldOriginals.delete(key.slice(6));
  }
  render();
}

export async function saveModelsPage() {
  const ctxChanged = tracker.has('ctx');
  const other = tracker.keys().some((key) => key !== 'ctx');
  if (ctxChanged && modelsSaveNote()) {
    root.querySelector('[data-ctx-ack]')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    throw new Error('Tick the usage note under Memory per chat, then save.');
  }
  if (ctxChanged) {
    const result = await deps.api('/api/settings/context-window', { method: 'POST', body: JSON.stringify(contextSaveBody(ctx.profile, ctx.mode, ctxTokens(ctx.mode), ctx.ack)) });
    if (result?.success === false) throw new Error(result.error || 'Memory per chat was not saved.');
    // Saved: a later failure below must not resend it or report it as unsaved.
    tracker.forget('ctx');
    ctx.loaded = { mode: ctx.mode, tokens: ctxTokens(ctx.mode) };
  }
  if (other) {
    let outcome;
    try {
      outcome = await deps.saveSettings({ stayOpen: true });
    } catch (err) {
      // Part of the save went through: those changes are no longer unsaved, the
      // rest stays on the bar and the next Save sends only that.
      if (err?.partial) forgetSavedStages(err.savedStages);
      if (!ctxChanged) throw err;
      const partial = new Error(err?.partial
        ? String(err.message).replace(/^Part saved: /, 'Part saved: Memory per chat, ')
        : `Part saved: Memory per chat. Not saved: the other changes${err?.message ? ` (${err.message})` : ''}. Save again to retry them.`);
      partial.partial = true;
      throw partial;
    }
    if (outcome?.cancelled) return outcome;
  }
  tracker.clear();
  fieldOriginals.clear();
  await reloadAll();
}

export async function discardModelsPage() {
  closeModelPicker();
  closeSheets();
  for (const [id, value] of fieldOriginals) {
    const el = $(id);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!value; else el.value = value;
  }
  tracker.clear();
  fieldOriginals.clear();
  await reloadAll();
}

/** Called by SettingsPage whenever the store finished (re)loading. */
export function refreshModelsPage() {
  if (!mounted) return;
  if (!tracker.has('ctx')) loadContextState();
  preloadModels();
  render();
}

export function mountModelsPage(panel, nextDeps) {
  deps = nextDeps;
  if (!panel) return;
  root = $('settings-models-v2');
  if (!root) {
    root = document.createElement('div');
    root.id = 'settings-models-v2';
    root.className = 'sk-page';
    panel.insertBefore(root, panel.firstChild);
  }
  if (!mounted) {
    mounted = true;
    wireKit(root);
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChangeEvent);
    root.addEventListener('sk-seg', onSeg);
    root.addEventListener('sk-switch', onSwitch);
    root.addEventListener('sk-fold', (event) => { foldState[event.detail.id] = event.detail.open; });
  }
  render();
}
