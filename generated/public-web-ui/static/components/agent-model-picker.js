/**
 * agent-model-picker.js — shared inline Model picker for the Subagents page
 * and the Team Subagents tab.
 *
 * Mirrors the Settings page: provider list comes from the live extensions
 * catalog (`/api/extensions/catalog?kind=provider`), so every provider the
 * user has installed shows up here too. Models per provider are sourced
 * from the catalog's `runtime.options.staticModels`, with hardcoded
 * fallbacks for the eight built-ins.
 *
 * Behaviour:
 *   - The agent's `model` field is stored as "provider/model" (matches
 *     the Settings agent edit form). Saved via PATCH /api/agents/:id/model.
 *   - Reasoning controls (OpenAI / OpenAI Codex / Perplexity reasoning
 *     effort, Anthropic extended thinking + budget) live in the global
 *     `llm.providers.{provider}.*` config. They're shared across every
 *     agent using that provider; we label them as such. Saved via
 *     POST /api/settings/provider.
 */

import { api } from '../api.js';
import { escHtml, bgtToast } from '../utils.js';
import { fetchCredentialedModelProviderIds, filterCredentialedProviderCatalogItems, hasLoadedCredentialedModelProviderIds, isCredentialedModelProviderId } from './model-provider-credentials.js';

// ── Built-in fallbacks (mirror SettingsPage) ────────────────────────────────
const BUILTIN_PROVIDER_IDS = ['ollama', 'llama_cpp', 'lm_studio', 'openai', 'openai_codex', 'anthropic', 'perplexity', 'gemini', 'xai'];

const BUILTIN_LABELS = {
  ollama:       'Ollama (local)',
  llama_cpp:    'llama.cpp (local)',
  lm_studio:    'LM Studio (local)',
  openai:       'OpenAI',
  openai_codex: 'OpenAI Codex (GPT Plus / Pro)',
  anthropic:    'Anthropic Claude',
  perplexity:   'Perplexity AI',
  gemini:       'Google Gemini',
  xai:          'xAI Grok',
};

const BUILTIN_STATIC_MODELS = {
  openai:       ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o4-mini', 'o3', 'o1'],
  openai_codex: ['gpt-5.5', 'gpt-5.4-codex', 'gpt-5.4-codex-mini', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.3', 'gpt-5.2-codex', 'gpt-5.2', 'gpt-5.1-codex-max', 'gpt-5.1-codex-mini', 'gpt-5.1-codex', 'gpt-5.1'],
  anthropic:    ['claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-sonnet-4-5-20250514', 'claude-haiku-4-5-20251001'],
  perplexity:   ['sonar-pro', 'sonar', 'sonar-reasoning-pro', 'sonar-reasoning', 'sonar-deep-research'],
  gemini:       ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  xai:          ['grok-4.20-reasoning', 'grok-4-1-fast-reasoning'],
};

const REASONING_EFFORT_PROVIDERS = new Set(['openai', 'openai_codex', 'perplexity']);
const EFFORT_OPTIONS = ['', 'minimal', 'low', 'medium', 'high'];
const CODEX_EFFORT_OPTIONS = ['', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const ANTHROPIC_BUDGETS = [2048, 5000, 10000, 16000, 24000, 32000];

function _providerSortRank(id) {
  const idx = BUILTIN_PROVIDER_IDS.indexOf(id);
  return idx >= 0 ? idx : BUILTIN_PROVIDER_IDS.length + 100;
}

// ── Caches ──────────────────────────────────────────────────────────────────
let _llmCache = null;
let _catalogCache = null;       // [{ id, name, runtime, ui, ... }]
let _catalogPromise = null;
let _liveModelCache = {};       // providerId -> [model, ...] (from /api/models/test)

async function _fetchCatalog(force) {
  if (_catalogCache && !force) return _catalogCache;
  if (!_catalogPromise || force) {
    _catalogPromise = api('/api/extensions/catalog?kind=provider')
      .then((d) => {
        let items = Array.isArray(d?.items) ? d.items.slice() : [];
        items.sort((a, b) => {
          const r = _providerSortRank(a.id) - _providerSortRank(b.id);
          if (r !== 0) return r;
          return String(a.name || a.id).localeCompare(String(b.name || b.id));
        });
        _catalogCache = items;
        return items;
      })
      .catch(() => {
        // Fallback: synthesize the eight builtins so the picker still works.
        _catalogCache = BUILTIN_PROVIDER_IDS.map((id) => ({
          id, name: BUILTIN_LABELS[id] || id, runtime: {}, ui: {},
        }));
        return _catalogCache;
      });
  }
  return _catalogPromise;
}

async function _fetchLlm(force) {
  if (_llmCache && !force) return _llmCache;
  try {
    const d = await api('/api/settings/provider');
    _llmCache = d?.llm || { providers: {} };
  } catch {
    _llmCache = { providers: {} };
  }
  return _llmCache;
}

function _getCatalogItem(providerId) {
  return (_catalogCache || []).find((p) => p.id === providerId) || null;
}

function _getModelsForProvider(providerId) {
  const item = _getCatalogItem(providerId);
  const fromCatalog = item?.runtime?.options?.staticModels;
  const fromBuiltin = BUILTIN_STATIC_MODELS[providerId];
  const fromLive = _liveModelCache[providerId];
  const merged = [];
  const push = (arr) => { if (Array.isArray(arr)) for (const m of arr) if (m && !merged.includes(String(m))) merged.push(String(m)); };
  push(fromLive);
  push(fromCatalog);
  push(fromBuiltin);
  // Catalog default model
  const def = item?.config?.defaults?.model;
  if (def && !merged.includes(String(def))) merged.unshift(String(def));
  return merged;
}

function _parseAgentModel(raw) {
  const s = String(raw || '').trim();
  if (!s) return { provider: '', model: '' };
  const slash = s.indexOf('/');
  if (slash <= 0) return { provider: '', model: s };
  return { provider: s.slice(0, slash), model: s.slice(slash + 1) };
}

function _providerOptionsHtml(currentProvider) {
  const items = filterCredentialedProviderCatalogItems(_catalogCache || []);
  const opts = [`<option value="">— Use global default —</option>`];
  for (const p of items) {
    const label = p.name || BUILTIN_LABELS[p.id] || p.id;
    const cat = p.category ? ` · ${p.category}` : '';
    opts.push(`<option value="${escHtml(p.id)}" ${p.id===currentProvider?'selected':''}>${escHtml(label)}${escHtml(cat)}</option>`);
  }
  return opts.join('');
}

function _modelOptionsHtml(provider, currentModel) {
  const list = _getModelsForProvider(provider);
  const merged = Array.from(new Set([currentModel, ...list])).filter(Boolean);
  if (merged.length === 0) {
    return `<option value="">— enter a model id below —</option>`;
  }
  return merged.map((m) => `<option value="${escHtml(m)}" ${m===currentModel?'selected':''}>${escHtml(m)}</option>`).join('');
}

function _reasoningRowHtml(prefix, agentId, provider, providerConfig) {
  if (!provider) return '';
  if (REASONING_EFFORT_PROVIDERS.has(provider)) {
    const opts = provider === 'openai_codex' ? CODEX_EFFORT_OPTIONS : EFFORT_OPTIONS;
    const cur = String(providerConfig?.reasoning_effort || '').trim();
    return `
      <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
        <label style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:0.04em;min-width:120px">Reasoning effort</label>
        <select id="${prefix}-effort-${escHtml(agentId)}" style="flex:1;border:1px solid var(--line);border-radius:7px;padding:5px 8px;font-size:12px;background:var(--panel);color:var(--text)">
          ${opts.map((o) => `<option value="${o}" ${o===cur?'selected':''}>${o ? escHtml(o) : '— none —'}</option>`).join('')}
        </select>
        <button onclick="agentModelPickerSaveReasoning('${prefix}','${escHtml(agentId)}','${provider}')" style="border:1px solid var(--line);background:var(--panel-2);color:var(--muted);border-radius:6px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer">Save</button>
      </div>
      <div style="font-size:10px;color:var(--muted);margin-top:3px;margin-left:128px">Shared with all <strong>${escHtml(provider)}</strong> agents.</div>`;
  }
  if (provider === 'anthropic') {
    const ext = providerConfig?.extended_thinking === true;
    const budget = parseInt(providerConfig?.thinking_budget || '10000', 10);
    return `
      <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">
        <label style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:0.04em;min-width:120px">Extended thinking</label>
        <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer">
          <input type="checkbox" id="${prefix}-extthink-${escHtml(agentId)}" ${ext?'checked':''} style="width:14px;height:14px" />
          Enabled
        </label>
        <select id="${prefix}-budget-${escHtml(agentId)}" style="flex:1;min-width:140px;border:1px solid var(--line);border-radius:7px;padding:5px 8px;font-size:12px;background:var(--panel);color:var(--text)">
          ${ANTHROPIC_BUDGETS.map((b) => `<option value="${b}" ${b===budget?'selected':''}>${b.toLocaleString()} tokens</option>`).join('')}
        </select>
        <button onclick="agentModelPickerSaveReasoning('${prefix}','${escHtml(agentId)}','anthropic')" style="border:1px solid var(--line);background:var(--panel-2);color:var(--muted);border-radius:6px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer">Save</button>
      </div>
      <div style="font-size:10px;color:var(--muted);margin-top:3px;margin-left:128px">Shared with all <strong>anthropic</strong> agents.</div>`;
  }
  return '';
}

// ── Public render ───────────────────────────────────────────────────────────

export function renderAgentModelPicker(agent, prefix) {
  const id = agent.id;
  const parsed = _parseAgentModel(agent.model);
  const credentialIdsLoaded = hasLoadedCredentialedModelProviderIds();
  const canUseProvider = !parsed.provider || !credentialIdsLoaded || isCredentialedModelProviderId(parsed.provider);
  const provider = canUseProvider ? parsed.provider : '';
  const model = canUseProvider ? parsed.model : '';
  const eff = String(agent.effectiveModel || '').trim();
  const effSrc = String(agent.effectiveModelSource || '').trim();
  const llm = _llmCache || { providers: {} };
  const providerConfig = (llm.providers || {})[provider] || {};
  const item = _getCatalogItem(provider);
  const accent = item?.ui?.color || 'var(--brand)';
  return `
    <div id="${prefix}-wrap-${escHtml(id)}" style="background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:10px 14px;border-left:3px solid ${escHtml(accent)}">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted)">Model</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">Effective: <code style="background:var(--panel);padding:1px 5px;border-radius:4px">${escHtml(eff || 'inherited')}</code>${effSrc ? ` <span style="opacity:0.7">(${escHtml(effSrc)})</span>` : ''}</div>
        </div>
        <div id="${prefix}-status-${escHtml(id)}" style="font-size:11px;color:var(--muted)"></div>
      </div>

      <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
        <label style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:0.04em;min-width:120px">Provider</label>
        <select id="${prefix}-provider-${escHtml(id)}" onchange="agentModelPickerOnProviderChange('${prefix}','${escHtml(id)}')" style="flex:1;border:1px solid var(--line);border-radius:7px;padding:5px 8px;font-size:12px;background:var(--panel);color:var(--text)">
          ${_providerOptionsHtml(provider)}
        </select>
        <button onclick="agentModelPickerRefreshLiveModels('${prefix}','${escHtml(id)}')" title="Fetch live models from this provider" style="border:1px solid var(--line);background:var(--panel-2);color:var(--muted);border-radius:6px;padding:5px 10px;font-size:11px;font-weight:600;cursor:pointer">Fetch models</button>
      </div>

      <div style="display:flex;gap:8px;align-items:center">
        <label style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:0.04em;min-width:120px">Model</label>
        <select id="${prefix}-modelselect-${escHtml(id)}" onchange="document.getElementById('${prefix}-modelcustom-${escHtml(id)}').value=this.value" style="flex:1;min-width:160px;border:1px solid var(--line);border-radius:7px;padding:5px 8px;font-size:12px;background:var(--panel);color:var(--text);font-family:'IBM Plex Mono',monospace">
          ${_modelOptionsHtml(provider, model)}
        </select>
        <input id="${prefix}-modelcustom-${escHtml(id)}" type="text" placeholder="custom model id" value="${escHtml(model)}" style="flex:1;min-width:140px;border:1px solid var(--line);border-radius:7px;padding:5px 8px;font-size:12px;background:var(--panel);color:var(--text);font-family:'IBM Plex Mono',monospace" />
        <button onclick="agentModelPickerSaveModel('${prefix}','${escHtml(id)}')" style="border:1px solid var(--brand);background:var(--brand);color:#fff;border-radius:7px;padding:5px 14px;font-size:11px;font-weight:700;cursor:pointer">Save</button>
        <button onclick="agentModelPickerClearModel('${prefix}','${escHtml(id)}')" style="border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:7px;padding:5px 10px;font-size:11px;font-weight:600;cursor:pointer">Clear</button>
      </div>

      <div id="${prefix}-reasoning-${escHtml(id)}">${_reasoningRowHtml(prefix, id, provider, providerConfig)}</div>
    </div>`;
}

/**
 * Call after injecting the rendered HTML. Loads the catalog and live provider
 * config, then re-renders the picker so the dropdowns include all installed
 * providers and the reasoning row reflects actual server state.
 */
export async function agentModelPickerHydrate(prefix, agent) {
  await Promise.all([_fetchCatalog(false), _fetchLlm(true), fetchCredentialedModelProviderIds()]);
  const wrap = document.getElementById(`${prefix}-wrap-${agent.id}`);
  if (!wrap) return;
  // Replace the whole inner HTML so provider+model dropdowns get the
  // catalog-sourced options.
  const newHtml = renderAgentModelPicker(agent, prefix);
  // Extract inner so we don't double-wrap; replace the wrap node.
  const tmp = document.createElement('div');
  tmp.innerHTML = newHtml.trim();
  const fresh = tmp.firstElementChild;
  if (fresh) wrap.replaceWith(fresh);
}

// ── Window-exposed handlers (called from inline onchange/onclick) ───────────

window.agentModelPickerOnProviderChange = function (prefix, agentId) {
  const provSel = document.getElementById(`${prefix}-provider-${agentId}`);
  const provider = provSel?.value || '';
  const customEl = document.getElementById(`${prefix}-modelcustom-${agentId}`);
  const currentCustom = customEl?.value || '';
  const mdlSel = document.getElementById(`${prefix}-modelselect-${agentId}`);
  if (mdlSel) mdlSel.innerHTML = _modelOptionsHtml(provider, currentCustom);
  const reasoningEl = document.getElementById(`${prefix}-reasoning-${agentId}`);
  if (reasoningEl) {
    const llm = _llmCache || { providers: {} };
    reasoningEl.innerHTML = _reasoningRowHtml(prefix, agentId, provider, (llm.providers || {})[provider] || {});
  }
};

window.agentModelPickerRefreshLiveModels = async function (prefix, agentId) {
  const provSel = document.getElementById(`${prefix}-provider-${agentId}`);
  const provider = provSel?.value || '';
  const status = document.getElementById(`${prefix}-status-${agentId}`);
  if (!provider) {
    if (status) status.textContent = 'Pick a provider first.';
    return;
  }
  if (status) status.textContent = 'Fetching live models…';
  try {
    const llm = await _fetchLlm(true);
    const cfg = (llm.providers || {})[provider] || {};
    // Build the same payload Settings sends.
    const payload = { llm: { provider, providers: { [provider]: cfg } } };
    const data = await api('/api/models/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const list = Array.isArray(data?.models) ? data.models.map((m) => (typeof m === 'string' ? m : (m?.name || String(m)))) : [];
    if (list.length) {
      _liveModelCache[provider] = list;
      const customEl = document.getElementById(`${prefix}-modelcustom-${agentId}`);
      const mdlSel = document.getElementById(`${prefix}-modelselect-${agentId}`);
      if (mdlSel) mdlSel.innerHTML = _modelOptionsHtml(provider, customEl?.value || '');
      if (status) status.textContent = `Loaded ${list.length} live model(s).`;
    } else {
      if (status) status.textContent = data?.error ? `Error: ${data.error}` : 'No models returned. Provider may need credentials.';
    }
  } catch (err) {
    if (status) status.textContent = `Error: ${err?.message || err}`;
  }
};

function _findCachedAgentRefresher(prefix, agentId) {
  const fn = window.__agentModelPickerOnSaved && window.__agentModelPickerOnSaved[prefix];
  if (typeof fn === 'function') {
    try { fn(agentId); } catch {}
  }
}

window.agentModelPickerSaveModel = async function (prefix, agentId) {
  const provSel = document.getElementById(`${prefix}-provider-${agentId}`);
  const customEl = document.getElementById(`${prefix}-modelcustom-${agentId}`);
  const selectEl = document.getElementById(`${prefix}-modelselect-${agentId}`);
  const status = document.getElementById(`${prefix}-status-${agentId}`);
  const provider = (provSel?.value || '').trim();
  const mdl = (customEl?.value || selectEl?.value || '').trim();
  if (provider && !mdl) { if (status) status.textContent = 'Pick or type a model.'; return; }
  const fullModel = provider ? (mdl ? `${provider}/${mdl}` : '') : mdl;
  if (status) status.textContent = 'Saving…';
  try {
    await api(`/api/agents/${encodeURIComponent(agentId)}/model`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: fullModel }),
    });
    if (status) status.textContent = `Saved: ${fullModel || '(default)'}`;
    bgtToast('Model updated', `${agentId} → ${fullModel || 'default'}`);
    _findCachedAgentRefresher(prefix, agentId);
  } catch (err) {
    if (status) status.textContent = `Error: ${err?.message || err}`;
  }
};

window.agentModelPickerClearModel = async function (prefix, agentId) {
  const status = document.getElementById(`${prefix}-status-${agentId}`);
  if (status) status.textContent = 'Clearing…';
  try {
    await api(`/api/agents/${encodeURIComponent(agentId)}/model`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: '' }),
    });
    if (status) status.textContent = 'Cleared (using default).';
    bgtToast('Model cleared', `${agentId} now uses the effective default`);
    _findCachedAgentRefresher(prefix, agentId);
  } catch (err) {
    if (status) status.textContent = `Error: ${err?.message || err}`;
  }
};

window.agentModelPickerSaveReasoning = async function (prefix, agentId, provider) {
  const status = document.getElementById(`${prefix}-status-${agentId}`);
  if (status) status.textContent = 'Saving provider config…';
  const providerPatch = {};
  if (REASONING_EFFORT_PROVIDERS.has(provider)) {
    const sel = document.getElementById(`${prefix}-effort-${agentId}`);
    providerPatch.reasoning_effort = (sel?.value || '').trim();
  } else if (provider === 'anthropic') {
    const extEl = document.getElementById(`${prefix}-extthink-${agentId}`);
    const budgetEl = document.getElementById(`${prefix}-budget-${agentId}`);
    providerPatch.extended_thinking = !!(extEl && extEl.checked);
    providerPatch.thinking_budget = parseInt(budgetEl?.value || '10000', 10);
  }
  try {
    await _fetchLlm(true);
    const existing = (_llmCache?.providers || {})[provider] || {};
    const merged = { ...existing, ...providerPatch };
    await api('/api/settings/provider', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ llm: { provider, providers: { [provider]: merged } } }),
    });
    await _fetchLlm(true);
    if (status) status.textContent = 'Provider config saved.';
    bgtToast('Provider updated', `${provider} reasoning settings saved`);
  } catch (err) {
    if (status) status.textContent = `Error: ${err?.message || err}`;
  }
};

export function registerAgentModelPickerOnSaved(prefix, callback) {
  window.__agentModelPickerOnSaved = window.__agentModelPickerOnSaved || {};
  window.__agentModelPickerOnSaved[prefix] = callback;
}

// Pre-warm caches so the first hydrated picker uses the credentialed provider list.
_fetchCatalog(false);
_fetchLlm(false);
fetchCredentialedModelProviderIds();
