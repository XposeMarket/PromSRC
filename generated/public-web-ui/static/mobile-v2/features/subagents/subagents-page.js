import { ICONS } from '../../ui/icons.js';
import { escapeHtml, loading, errorState, safeJson, relativeTime } from '../../ui/page-kit.js';
import { mountStreamChatPanel } from '../shared/stream-chat-panel.js';
import { effortOptions, formatReasoningSelectorLabel } from '../../../reasoning-capabilities.js';

const AGENT_TABS = [
  ['overview', 'Overview'],
  ['chat', 'Chat'],
  ['memory', 'Memory'],
  ['runs', 'Runs'],
  ['heartbeat', 'Heartbeat'],
].map(([id, label]) => ({ id, label }));

const refreshIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9a7 7 0 0 1 11.6-2L20 12M4 12l2.8 5a7 7 0 0 0 11.6-2"/></svg>';
const legacyIcons = {
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
};

function agentId(agent) {
  return String(agent?.id || agent?.agentId || agent?.name || '');
}

function nameOf(agent) {
  return String(agent?.name || agent?.label || agent?.id || 'Subagent');
}

function statusOf(agent) {
  return String(agent?.status || agent?.state || (agent?.active ? 'running' : 'idle'));
}

function modelOf(agent) {
  return String(agent?.effectiveModel || agent?.model || agent?.provider || 'Default model');
}

function shortModel(agent) {
  return modelOf(agent).split('/').pop() || 'Default model';
}

function lastRunAt(agent) {
  return agent?.lastRunAt || agent?.lastRun?.finishedAt || agent?.lastRun?.startedAt || agent?.last_run_at || '';
}

function toolsOf(agent) {
  const tools = agent?.allowed_tools || agent?.allowedTools || agent?.tools;
  return Array.isArray(tools) ? tools : [];
}

function mcpOf(agent) {
  const servers = agent?.mcpServers || agent?.mcp_servers;
  return Array.isArray(servers) ? servers : [];
}

function statusClass(status) {
  const value = String(status || '').toLowerCase();
  if (/running|working/.test(value)) return 'running';
  if (/active|online|ready/.test(value)) return 'active';
  if (/scheduled|paused|queued|pending/.test(value)) return 'orange';
  if (/failed|error/.test(value)) return 'orange';
  return 'gray';
}

function statusPill(status) {
  const value = String(status || 'idle');
  return `<span class="pm-pill ${statusClass(value)}">${escapeHtml(value)}</span>`;
}

function robotIcon(size = '44px', variant = '') {
  const svg = ICONS.robot.replace('<svg ', `<svg style="width:${size};height:${size};" `);
  return `<span class="pm-subagent-robot${variant ? ` ${variant}` : ''}" aria-hidden="true">${svg}</span>`;
}

function agentTile(agent, featuredId) {
  const id = agentId(agent);
  const status = statusOf(agent);
  return `<button class="pm-team-tile pm-subagent-tile${id === featuredId ? ' featured' : ''}" data-agent-id="${escapeHtml(id)}" type="button">
    ${robotIcon()}
    <span class="pm-team-tile-meta"><strong>${escapeHtml(nameOf(agent))}</strong><small>${escapeHtml(shortModel(agent))}</small></span>
    ${statusPill(status)}
  </button>`;
}

function agentPreview(agent) {
  const id = agentId(agent);
  const tools = toolsOf(agent);
  const description = String(agent?.description || agent?.purpose || agent?.role || '').trim();
  const lastRun = lastRunAt(agent);
  return `<section class="pm-team-preview pm-subagent-preview">
    <div class="pm-team-preview-head">
      ${robotIcon('36px', 'pm-subagent-robot-sm')}
      <h3>${escapeHtml(nameOf(agent))}</h3>
      <button class="pm-pill-btn" type="button" data-open-agent="${escapeHtml(id)}">Open ${ICONS.chevron}</button>
    </div>
    <div class="pm-subagent-preview-model">${escapeHtml(modelOf(agent))}${agent?.isTeamMember ? ' · team member' : agent?.teamId ? ' · team member' : ''}</div>
    ${description ? `<div class="pm-card-body pm-subagent-preview-description">${escapeHtml(description.length > 240 ? `${description.slice(0, 237)}…` : description)}</div>` : ''}
    <div class="pm-divider"></div>
    <div class="pm-row"><span>${ICONS.spark} Tools</span><span class="pm-subagent-preview-value">${tools.length ? `${tools.length} allowed` : 'all'}</span></div>
    <div class="pm-divider"></div>
    <div class="pm-row"><span>${legacyIcons.clock} Last run</span><span class="pm-subagent-preview-value">${escapeHtml(relativeTime(lastRun) || '—')}</span></div>
  </section>`;
}

function detailTabs(active) {
  return `<div class="pm-tabs" role="tablist">${AGENT_TABS.map((tab) => `<button type="button" role="tab" aria-selected="${tab.id === active}" class="${tab.id === active ? 'active' : ''}" data-agent-tab="${tab.id}">${escapeHtml(tab.label)}</button>`).join('')}</div>`;
}

function agentDetailHeader(agent) {
  return `<div class="pm-detail-head pm-subagent-detail-head">
    ${robotIcon('56px', 'pm-subagent-robot-lg')}
    <h1>${escapeHtml(nameOf(agent))}</h1>
    ${statusPill(statusOf(agent))}
  </div>
  <div class="pm-detail-sub">${escapeHtml(shortModel(agent))}${agent?.isTeamMember || agent?.teamId ? ' · team member' : ''}${agent?.cronSchedule || agent?.schedule ? ' · scheduled' : ''}</div>`;
}

function agentActions() {
  return `<div class="pm-action-row pm-subagent-actions">
    <button class="pm-action-btn primary" type="button" data-dispatch>${ICONS.send} Dispatch Task</button>
    <button class="pm-action-btn" type="button" data-heartbeat>${refreshIcon} Tick</button>
    <button class="pm-action-btn" type="button" data-open-chat>${ICONS.chat} Chat</button>
  </div>`;
}

function fileAccordion(file, isOpen) {
  const open = isOpen ? ' open' : '';
  return `<article class="pm-subagent-memory-item${open}">
    <button type="button" class="pm-subagent-memory-toggle" data-memory-file="${escapeHtml(file.key)}" aria-expanded="${isOpen}">
      <span>${ICONS.doc}<strong>${escapeHtml(file.title)}</strong></span><span class="pm-subagent-memory-chevron">⌄</span>
    </button>
    ${isOpen ? `<div class="pm-subagent-memory-panel"><div class="pm-subagent-memory-actions"><span>${file.exists ? 'Read-only' : 'Not found'}</span>${file.content ? `<button class="pm-btn ghost" type="button" data-memory-copy="${escapeHtml(file.key)}">Copy</button>` : ''}</div>${file.content ? `<pre class="pm-subagent-md">${escapeHtml(file.content)}</pre>` : `<div class="pm-subagent-memory-empty">${escapeHtml(file.empty)}</div>`}</div>` : ''}
  </article>`;
}

const FALLBACK_AGENT_MODELS = {
  openai: ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-4.1', 'gpt-4o'],
  openai_codex: ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4-codex', 'gpt-5.3-codex'],
  anthropic: ['claude-fable-5-1', 'claude-fable-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  perplexity: ['sonar-pro', 'sonar', 'sonar-reasoning-pro', 'sonar-deep-research'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
  xai: ['grok-4.7', 'grok-4.6', 'grok-4.5', 'grok-composer-2.5-fast', 'grok-4.3', 'grok-4.20-0309-reasoning'],
};

const AGENT_VOICES = {
  openai_realtime: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'],
  openai: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'],
  xai: ['eve', 'ara', 'rex', 'sal', 'leo'],
  browser: ['default'],
};
const CODEX_AGENT_VOICES = ['juniper', 'maple', 'spruce', 'ember', 'vale', 'breeze', 'arbor', 'sol', 'cove'];

function parseAgentModel(value) {
  const raw = String(value || '').trim();
  const slash = raw.indexOf('/');
  return slash > 0 ? { provider: raw.slice(0, slash), model: raw.slice(slash + 1) } : { provider: '', model: raw };
}

function providerModelList(provider, catalog) {
  const item = catalog.find((entry) => entry.id === provider);
  const configured = item?.runtime?.options?.staticModels;
  const values = Array.isArray(configured) ? configured.map((model) => String(model?.name || model || '')).filter(Boolean) : [];
  const defaultModel = String(item?.config?.defaults?.model || '').trim();
  if (defaultModel && !values.includes(defaultModel)) values.unshift(defaultModel);
  for (const model of FALLBACK_AGENT_MODELS[provider] || []) if (!values.includes(model)) values.push(model);
  return values;
}

function modelPickerOptions(provider, model, catalog) {
  const models = providerModelList(provider, catalog);
  if (model && !models.includes(model)) models.unshift(model);
  if (!models.length) return '<option value="">— no models listed —</option>';
  return models.map((name) => `<option value="${escapeHtml(name)}"${name === model ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('');
}

function renderAgentModelFields(agent, catalog, settings, state = {}) {
  const current = parseAgentModel(agent?.model || '');
  const effective = parseAgentModel(agent?.effectiveModel || '');
  const provider = state.provider ?? current.provider;
  const model = state.model ?? current.model;
  const providerForReasoning = provider || effective.provider;
  const modelForReasoning = model || effective.model;
  const providers = catalog.slice();
  if (provider && !providers.some((item) => item.id === provider)) providers.unshift({ id: provider, name: `${provider} (not connected)` });
  const providerOptions = [`<option value="">— Use global default —</option>`, ...providers.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === provider ? ' selected' : ''}>${escapeHtml(item.name || item.id)}</option>`)].join('');
  const inherited = String(agent?.effectiveReasoningEffort || '').trim();
  const currentEffort = String(agent?.reasoning_effort || agent?.reasoningEffort || '').trim();
  const efforts = providerForReasoning && modelForReasoning ? effortOptions(providerForReasoning, modelForReasoning, true) : [];
  const reasoning = efforts.some(Boolean)
    ? `<label class="pm-v2-field"><span>Reasoning</span><select data-agent-model-reasoning>${efforts.map((value) => `<option value="${escapeHtml(value)}"${value === (state.effort ?? (currentEffort || inherited)) ? ' selected' : ''}>${escapeHtml(value ? formatReasoningSelectorLabel(value, providerForReasoning) : `Use ${currentEffort ? 'provider' : 'Settings'} default${!currentEffort && inherited ? ` (${formatReasoningSelectorLabel(inherited, providerForReasoning)})` : ''}`)}</option>`).join('')}</select></label><button type="button" class="pm-btn ghost" data-agent-model-save-reasoning>Save reasoning</button><small class="pm-subagent-muted">${currentEffort ? 'Explicit per-agent override.' : 'Inherited from Settings; choose provider default to clear the override.'}</small>`
    : '<small class="pm-subagent-muted">This provider/model has no adjustable reasoning levels.</small>';
  const inheritedModel = String(agent?.effectiveModel || settings?.llm?.model || 'global default').trim();
  return `<div class="pm-v2-agent-model-fields">
    <div class="pm-v2-row-between"><span>Effective model</span><strong>${escapeHtml(inheritedModel || 'global default')}</strong></div>
    <label class="pm-v2-field"><span>Provider</span><select data-agent-model-provider>${providerOptions}</select></label>
    <label class="pm-v2-field"><span>Model</span><select data-agent-model-select ${provider ? '' : 'disabled'}>${modelPickerOptions(provider, model, catalog)}</select></label>
    <div data-agent-reasoning-slot>${reasoning}</div>
    <div class="pm-v2-actions"><button type="button" class="pm-btn primary" data-agent-model-save>Save model</button><button type="button" class="pm-btn ghost" data-agent-model-clear>Use global default</button><button type="button" class="pm-btn ghost" data-agent-model-fetch ${provider ? '' : 'disabled'}>Fetch live models</button></div>
    <small class="pm-subagent-muted" data-agent-model-status></small>
  </div>`;
}

function voiceOptions(provider, agent, status) {
  const values = provider === 'openai_codex' && status?.codexBridgeAvailable === true
    ? (Array.isArray(status.codexBridgeActiveVoices) && status.codexBridgeActiveVoices.length ? status.codexBridgeActiveVoices : CODEX_AGENT_VOICES)
    : (AGENT_VOICES[provider] || []);
  const current = String(agent?.voice?.voice || '').trim();
  const unique = [...new Set([...values, ...(provider === 'openai_codex' ? [] : [current])].filter(Boolean))];
  return `<option value="">Provider default</option>${unique.map((voice) => `<option value="${escapeHtml(voice)}"${voice === current ? ' selected' : ''}>${escapeHtml(voice)}</option>`).join('')}`;
}

async function hydrateAgentPickers({ host, features, agent, onSaved }) {
  const id = agentId(agent);
  const modelHost = host.querySelector('[data-agent-model-picker]');
  const voiceHost = host.querySelector('[data-agent-voice-picker]');
  if (!modelHost || !voiceHost) return;
  let catalog = [];
  let settings = null;
  let modelState = {};
  let voiceStatus = null;
  const api = () => features.api;
  const [providerBody, settingsResult, voiceResult, credentialBody] = await Promise.all([
    api().request('/api/extensions/catalog?kind=provider').catch(() => ({ items: [] })),
    api().request('/api/settings/provider').catch(() => null),
    api().request('/api/realtime/status').catch(() => null),
    api().request('/api/settings/credentialed-model-providers').catch(() => null),
  ]);
  if (!host.isConnected) return;
  const allProviders = Array.isArray(providerBody?.items) ? providerBody.items : [];
  const credentialedIds = Array.isArray(credentialBody?.providers) ? credentialBody.providers.map(String) : [];
  catalog = Array.isArray(credentialBody?.providers)
    ? allProviders.filter((item) => credentialedIds.includes(String(item.id)))
    : allProviders;
  settings = settingsResult;
  voiceStatus = voiceResult;
  const model = parseAgentModel(agent?.model || '');
  modelState = { provider: model.provider, model: model.model, effort: String(agent?.reasoning_effort || agent?.reasoningEffort || agent?.effectiveReasoningEffort || '') };
  modelHost.innerHTML = renderAgentModelFields(agent, catalog, settings, modelState);
  const voice = agent?.voice && typeof agent.voice === 'object' ? agent.voice : {};
  const codexReady = voiceStatus?.codexBridgeAvailable === true && voiceStatus?.transport === 'codex_app_server' && voiceStatus?.auth === 'chatgpt_oauth_app_server';
  const voiceProviders = codexReady
    ? [['', 'Use global voice default'], ['openai_codex', 'Codex Voice / Live · ChatGPT OAuth']]
    : [['', 'Use global voice default'], ['openai_realtime', 'OpenAI Realtime'], ['xai', 'xAI Realtime'], ['openai', 'OpenAI TTS'], ['browser', 'Browser']];
  const savedVoiceProvider = String(voice.provider || voice.voiceProvider || '');
  const voiceProvider = codexReady && savedVoiceProvider === 'openai_realtime' ? 'openai_codex' : savedVoiceProvider;
  const voiceProviderOptions = voiceProviders.map(([value, label]) => `<option value="${escapeHtml(value)}"${value === voiceProvider ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
  voiceHost.innerHTML = `<div class="pm-v2-agent-voice-fields"><p class="pm-subagent-muted">Default provider and voice used when voice mode opens for this agent.</p>
    <label class="pm-v2-field"><span>Provider</span><select data-agent-voice-provider>${voiceProviderOptions}</select></label>
    <label class="pm-v2-field"><span>Voice</span><select data-agent-voice-select ${voiceProvider ? '' : 'disabled'}>${voiceOptions(voiceProvider, agent, voiceStatus)}</select></label>
    <button type="button" class="pm-btn primary" data-agent-voice-save>Save voice</button><small class="pm-subagent-muted" data-agent-voice-status></small></div>`;
  const modelProvider = modelHost.querySelector('[data-agent-model-provider]');
  const modelSelect = modelHost.querySelector('[data-agent-model-select]');
  const reasoningHost = modelHost.querySelector('[data-agent-reasoning-slot]');
  const modelStatus = modelHost.querySelector('[data-agent-model-status]');
  const renderReasoning = () => {
    modelState.provider = modelProvider?.value || '';
    modelState.model = modelSelect?.value || '';
    const html = renderAgentModelFields(agent, catalog, settings, modelState);
    const tmp = document.createElement('div'); tmp.innerHTML = html;
    if (reasoningHost) reasoningHost.innerHTML = tmp.querySelector('[data-agent-reasoning-slot]')?.innerHTML || '<small class="pm-subagent-muted">No reasoning controls for this model.</small>';
  };
  modelProvider?.addEventListener('change', () => {
    const provider = modelProvider.value;
    modelState.provider = provider;
    modelState.model = '';
    modelState.effort = '';
    if (modelSelect) { modelSelect.innerHTML = modelPickerOptions(provider, '', catalog); modelSelect.disabled = !provider; }
    renderReasoning();
    const fetch = modelHost.querySelector('[data-agent-model-fetch]'); if (fetch) fetch.disabled = !provider;
  });
  modelSelect?.addEventListener('change', () => { modelState.effort = ''; renderReasoning(); });
  modelHost.querySelector('[data-agent-model-save]')?.addEventListener('click', async () => {
    const provider = modelProvider?.value || '';
    const selectedModel = modelSelect?.value || '';
    if (provider && !selectedModel) { if (modelStatus) modelStatus.textContent = 'Pick a model from the list.'; return; }
    const modelValue = provider ? `${provider}/${selectedModel}` : selectedModel;
    const button = modelHost.querySelector('[data-agent-model-save]');
    if (button) button.disabled = true;
    if (modelStatus) modelStatus.textContent = 'Saving model…';
    try {
      await api().request(`/api/agents/${encodeURIComponent(id)}/model`, { method: 'PATCH', body: JSON.stringify({ model: modelValue }) });
      if (modelStatus) modelStatus.textContent = `Saved: ${modelValue || '(global default)'}`;
      await onSaved?.();
    } catch (error) { if (modelStatus) modelStatus.textContent = error?.message || 'Could not save the model.'; }
    finally { if (button) button.disabled = false; }
  });
  modelHost.querySelector('[data-agent-model-clear]')?.addEventListener('click', async () => {
    if (modelStatus) modelStatus.textContent = 'Restoring global default…';
    try {
      await api().request(`/api/agents/${encodeURIComponent(id)}/model`, { method: 'PATCH', body: JSON.stringify({ model: '' }) });
      if (modelStatus) modelStatus.textContent = 'This agent now uses the global default.';
      await onSaved?.();
    } catch (error) { if (modelStatus) modelStatus.textContent = error?.message || 'Could not clear the model override.'; }
  });
  modelHost.querySelector('[data-agent-model-fetch]')?.addEventListener('click', async () => {
    const provider = modelProvider?.value || '';
    if (!provider) return;
    if (modelStatus) modelStatus.textContent = 'Fetching live models…';
    try {
      const llm = settings?.llm || {};
      const cfg = llm.providers?.[provider] || {};
      const response = await api().request('/api/models/test', { method: 'POST', body: JSON.stringify({ llm: { provider, providers: { [provider]: cfg } } }) });
      const live = Array.isArray(response?.models) ? response.models.map((item) => String(item?.name || item || '')).filter(Boolean) : [];
      if (!live.length) { if (modelStatus) modelStatus.textContent = response?.error || 'No models returned; check provider credentials.'; return; }
      catalog = catalog.map((item) => item.id === provider ? { ...item, runtime: { ...(item.runtime || {}), options: { ...(item.runtime?.options || {}), staticModels: [...new Set([...providerModelList(provider, catalog), ...live])] } } } : item);
      const selected = modelSelect?.value || '';
      if (modelSelect) modelSelect.innerHTML = modelPickerOptions(provider, selected, catalog);
      if (modelStatus) modelStatus.textContent = `Loaded ${live.length} live model${live.length === 1 ? '' : 's'}.`;
      renderReasoning();
    } catch (error) { if (modelStatus) modelStatus.textContent = error?.message || 'Could not fetch models.'; }
  });
  reasoningHost?.addEventListener('change', (event) => { if (event.target.matches('[data-agent-model-reasoning]')) modelState.effort = event.target.value; });
  modelHost.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-agent-model-save-reasoning]');
    if (!button) return;
    if (modelStatus) modelStatus.textContent = 'Saving reasoning override…';
    try {
      await api().request(`/api/agents/${encodeURIComponent(id)}/model`, { method: 'PATCH', body: JSON.stringify({ reasoning_effort: modelState.effort || '' }) });
      if (modelStatus) modelStatus.textContent = modelState.effort ? 'Reasoning override saved.' : 'Reasoning now follows Settings.';
      await onSaved?.();
    } catch (error) { if (modelStatus) modelStatus.textContent = error?.message || 'Could not save reasoning.'; }
  });
  const voiceProviderEl = voiceHost.querySelector('[data-agent-voice-provider]');
  const voiceSelect = voiceHost.querySelector('[data-agent-voice-select]');
  const voiceStatusEl = voiceHost.querySelector('[data-agent-voice-status]');
  voiceProviderEl?.addEventListener('change', () => {
    if (!voiceSelect) return;
    voiceSelect.disabled = !voiceProviderEl.value;
    voiceSelect.innerHTML = voiceOptions(voiceProviderEl.value, { voice: { voice: '' } }, voiceStatus);
    if (voiceStatusEl) voiceStatusEl.textContent = voiceProviderEl.value ? '' : 'Using the global voice settings for this agent.';
  });
  if (voiceStatusEl && !voiceProvider) voiceStatusEl.textContent = 'Using the global voice settings for this agent.';
  voiceHost.querySelector('[data-agent-voice-save]')?.addEventListener('click', async () => {
    const selectedProvider = voiceProviderEl?.value || '';
    const profile = selectedProvider ? {
      provider: selectedProvider,
      mode: selectedProvider === 'openai_codex' ? 'codex_voice_live' : '',
      voice: voiceSelect?.value || '',
    } : null;
    const button = voiceHost.querySelector('[data-agent-voice-save]');
    if (button) button.disabled = true;
    if (voiceStatusEl) voiceStatusEl.textContent = 'Saving voice profile…';
    try {
      const response = await api().request(`/api/agents/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ agent: { voice: profile } }) });
      if (response?.success === false) throw new Error(response?.error || 'Could not save the voice profile.');
      if (voiceStatusEl) voiceStatusEl.textContent = 'Voice profile saved.';
      await onSaved?.();
    } catch (error) { if (voiceStatusEl) voiceStatusEl.textContent = error?.message || 'Could not save the voice profile.'; }
    finally { if (button) button.disabled = false; }
  });
}

export async function mountSubagentsPage({ shell, features, route }) {
  shell.setActiveTab('chat');
  shell.setTitle(route?.id ? 'Subagent' : 'Subagents');
  shell.renderHeader?.({ leftIcon: route?.id ? 'back' : 'menu', backRoute: 'subagents', showStatus: Boolean(route?.id) });
  const page = shell.page;
  let disposed = false;
  let chatCleanup = () => {};

  async function list() {
    chatCleanup();
    page.innerHTML = `<div class="pm-title-row" style="margin-inline:-16px"><h1 class="pm-title">Subagents</h1><span class="pm-count-pill" data-agent-count>…</span><span class="pm-spacer"></span><button class="pm-icon-btn" type="button" aria-label="Refresh subagents" data-agent-refresh>${refreshIcon}</button></div><div class="pm-body-inner" data-agent-list>${loading('Loading subagents…')}</div>`;
    const host = page.querySelector('[data-agent-list]');
    try {
      const rows = await features.agents();
      if (disposed) return;
      const agents = Array.isArray(rows) ? rows : [];
      page.querySelector('[data-agent-count]').textContent = `${agents.length} agent${agents.length === 1 ? '' : 's'}`;
      if (!agents.length) {
        host.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.robot}</div><h2>No subagents yet</h2><p>Create agents from the desktop Settings → Agents page.</p></div>`;
      } else {
        const featured = agents[0];
        const featuredId = agentId(featured);
        host.innerHTML = `<div class="pm-team-grid">${agents.map((agent) => agentTile(agent, featuredId)).join('')}</div>${agentPreview(featured)}`;
      }
      const open = (id) => id && shell.navigate?.(`subagents/${encodeURIComponent(id)}`);
      host.querySelectorAll('[data-agent-id]').forEach((button) => button.addEventListener('click', () => open(button.dataset.agentId)));
      host.querySelectorAll('[data-open-agent]').forEach((button) => button.addEventListener('click', () => open(button.dataset.openAgent)));
      page.querySelector('[data-agent-refresh]')?.addEventListener('click', list);
    } catch (error) {
      host.innerHTML = errorState(error);
      host.querySelector('[data-v2-retry]')?.addEventListener('click', list);
      page.querySelector('[data-agent-refresh]')?.addEventListener('click', list);
    }
  }

  async function detail(id, initialTab = 'overview') {
    chatCleanup();
    chatCleanup = () => {};
    page.innerHTML = `<div class="pm-subagent-detail-content" style="padding-top:calc(max(env(safe-area-inset-top), 12px) + 72px)">${loading('Loading agent…')}</div>`;
    const content = page.querySelector('.pm-subagent-detail-content');
    try {
      const agent = await features.agent(id);
      if (!agent) throw new Error('Subagent not found.');
      if (disposed) return;
      const idValue = agentId(agent) || String(id);
      const tabs = AGENT_TABS.map((tab) => tab.id);
      let active = tabs.includes(initialTab) ? initialTab : 'overview';
      content.innerHTML = `${agentDetailHeader(agent)}${agentActions()}${detailTabs(active)}<div data-agent-tab-content></div>`;
      const host = content.querySelector('[data-agent-tab-content]');

      function setTabActive(tab) {
        active = tab;
        content.querySelectorAll('[data-agent-tab]').forEach((button) => {
          const selected = button.dataset.agentTab === active;
          button.classList.toggle('active', selected);
          button.setAttribute('aria-selected', String(selected));
        });
      }

      async function renderTab(tab) {
        setTabActive(tab);
        chatCleanup();
        chatCleanup = () => {};
        if (tab === 'overview') {
          host.innerHTML = loading('Loading overview…');
          const refs = await features.agentContextRefs(idValue);
          if (disposed) return;
          const tools = toolsOf(agent);
          const servers = mcpOf(agent);
          const description = String(agent.description || agent.purpose || agent.role || agent.systemPromptSummary || 'No description set.');
          const toolList = tools.length ? tools.slice(0, 8).map((tool) => `<span class="pm-tool-chip">${escapeHtml(String(tool))}</span>`).join(' ') + (tools.length > 8 ? `<span class="pm-tool-chip more">+${tools.length - 8}</span>` : '') : '<em class="pm-subagent-muted">All tools</em>';
          const serverList = servers.length ? servers.map((server) => `<span class="pm-tool-chip">${escapeHtml(String(server))}</span>`).join(' ') : '<em class="pm-subagent-muted">None</em>';
          const latest = lastRunAt(agent);
          host.innerHTML = `<section class="pm-card"><div class="pm-card-head">${legacyIcons.target} Description</div><div class="pm-card-body">${escapeHtml(description)}</div></section>
            <div class="pm-card-grid">
              <section class="pm-card"><div class="pm-card-head">${ICONS.spark} Model</div><div class="pm-card-body strong">${escapeHtml(shortModel(agent))}</div></section>
              <section class="pm-card"><div class="pm-card-head">${legacyIcons.clock} Last Run</div><div class="pm-card-body strong">${escapeHtml(relativeTime(latest) || '—')}</div></section>
              <section class="pm-card"><div class="pm-card-head">${ICONS.spark} Allowed Tools</div><div class="pm-card-body">${toolList}</div></section>
              <section class="pm-card"><div class="pm-card-head">${legacyIcons.globe} MCP Servers</div><div class="pm-card-body">${serverList}</div></section>
            </div>
            <section class="pm-card"><div class="pm-card-head">${ICONS.spark} Agent Model Picker</div><div class="pm-card-body" data-agent-model-picker>${loading('Loading model controls…')}</div></section>
            <section class="pm-card"><div class="pm-card-head">${ICONS.mic} Agent Voice Picker</div><div class="pm-card-body" data-agent-voice-picker>${loading('Loading voice controls…')}</div></section>
            ${agent.role && agent.role !== description ? `<section class="pm-card"><div class="pm-card-head">${ICONS.doc} Role</div><div class="pm-card-body">${escapeHtml(agent.role)}</div></section>` : ''}
            <section class="pm-card"><div class="pm-card-head">${ICONS.doc} Context References</div><div class="pm-card-body pm-subagent-context-refs">${refs.length ? refs.slice(0, 10).map((ref) => `<div class="pm-ctxref"><strong>${escapeHtml(ref.title || ref.name || 'Reference')}</strong><span>${escapeHtml(String(ref.body || ref.content || ref.preview || '').slice(0, 140))}${String(ref.body || ref.content || ref.preview || '').length > 140 ? '…' : ''}</span></div>`).join('') : '<em class="pm-subagent-muted">No context references attached.</em>'}</div></section>`;
          hydrateAgentPickers({ host, features, agent, onSaved: () => detail(idValue, 'overview') }).catch((error) => {
            const modelPicker = host.querySelector('[data-agent-model-picker]');
            const voicePicker = host.querySelector('[data-agent-voice-picker]');
            if (modelPicker) modelPicker.textContent = `Model controls unavailable: ${error?.message || 'request failed'}`;
            if (voicePicker) voicePicker.textContent = `Voice controls unavailable: ${error?.message || 'request failed'}`;
          });
        } else if (tab === 'chat') {
          host.innerHTML = '<div data-agent-chat></div>';
          chatCleanup = mountStreamChatPanel({ host: host.querySelector('[data-agent-chat]'), loadMessages: () => features.agentChat(idValue), streamMessage: (message, options) => features.streamAgentChat(idValue, message, options), placeholder: `Message ${nameOf(agent)}…`, emptyLabel: `Start a conversation with ${nameOf(agent)}.` });
        } else if (tab === 'memory') {
          host.innerHTML = loading('Loading agent files…');
          const [agentFile, memoryFile] = await Promise.all([features.agentText(idValue, 'agent-md'), features.agentText(idValue, 'memory-md')]);
          if (disposed) return;
          const files = [
            { key: 'agent-md', title: 'AGENT.md', content: String(agentFile?.content || ''), exists: !!agentFile?.exists, empty: 'No AGENT.md is set for this agent yet.' },
            { key: 'memory-md', title: 'MEMORY.md', content: String(memoryFile?.content || ''), exists: !!memoryFile?.exists, empty: 'No personal memory file exists for this agent yet.' },
          ];
          let openKey = '';
          const paint = () => {
            host.innerHTML = `<section class="pm-subagent-memory" aria-label="Subagent memory files"><p class="pm-subagent-memory-intro">Private, read-only context for this agent.</p>${files.map((file) => fileAccordion(file, openKey === file.key)).join('')}</section>`;
            host.querySelectorAll('[data-memory-file]').forEach((button) => button.addEventListener('click', () => {
              const key = button.dataset.memoryFile;
              openKey = openKey === key ? '' : key;
              paint();
            }));
            host.querySelectorAll('[data-memory-copy]').forEach((button) => button.addEventListener('click', async () => {
              const file = files.find((item) => item.key === button.dataset.memoryCopy);
              try {
                await navigator.clipboard.writeText(file?.content || '');
                shell.showNotice('Copied to clipboard.');
              } catch {
                shell.showNotice('Could not copy this file.');
              }
            }));
          };
          paint();
        } else if (tab === 'runs') {
          host.innerHTML = loading('Loading runs…');
          const runs = await features.agentRuns(idValue);
          if (disposed) return;
          host.innerHTML = runs.length ? `<div class="pm-subagent-runs-head"><strong>Runs</strong><button type="button" class="pm-btn ghost" data-runs-refresh>${refreshIcon} Refresh</button></div><div class="pm-subagent-runs">${runs.map((run) => `<section class="pm-card"><div class="pm-card-head">${legacyIcons.clock} ${escapeHtml(run.title || run.task || run.id || 'Run')} ${statusPill(run.status || run.state || 'Unknown')}</div>${run.startedAt ? `<div class="pm-card-body pm-subagent-run-time">${escapeHtml(relativeTime(run.startedAt))}</div>` : ''}${run.summary || run.result ? `<div class="pm-card-body pm-subagent-run-summary">${escapeHtml(run.summary || run.result)}</div>` : ''}</section>`).join('')}</div>` : `<div class="pm-empty"><div class="pm-empty-icon">${legacyIcons.clock}</div><h2>No runs yet</h2><p>Tap Dispatch Task above to give this agent something to do.</p><button type="button" class="pm-btn ghost" data-runs-refresh>${refreshIcon} Refresh</button></div>`;
          host.querySelector('[data-runs-refresh]')?.addEventListener('click', () => renderTab('runs'));
        } else if (tab === 'heartbeat') {
          host.innerHTML = loading('Loading heartbeat…');
          const heartbeat = await features.agentHeartbeat(idValue);
          if (disposed) return;
          const config = heartbeat?.status?.config || heartbeat?.status || {};
          host.innerHTML = `<section class="pm-card"><div class="pm-card-head">${legacyIcons.clock} Configuration</div><pre class="pm-v2-pre">${escapeHtml(safeJson(config))}</pre></section><section class="pm-card"><div class="pm-card-head">${ICONS.doc} HEARTBEAT.md</div><pre class="pm-v2-pre">${escapeHtml(heartbeat?.file?.content || 'No heartbeat instructions.')}</pre></section>`;
        }
      }

      content.querySelectorAll('[data-agent-tab]').forEach((button) => button.addEventListener('click', () => renderTab(button.dataset.agentTab)));
      content.querySelector('[data-open-chat]')?.addEventListener('click', () => renderTab('chat'));
      content.querySelector('[data-heartbeat]')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
          await features.tickAgent(idValue);
          shell.showNotice('Heartbeat tick queued.');
        } catch (error) {
          shell.showNotice(error?.message || 'Heartbeat failed.');
        } finally {
          button.disabled = false;
        }
      });
      content.querySelector('[data-dispatch]')?.addEventListener('click', () => {
        host.innerHTML = `<section class="pm-card pm-subagent-dispatch"><div class="pm-card-head">${ICONS.send} Dispatch task</div><form data-dispatch-form class="pm-subagent-dispatch-form"><textarea class="pm-textarea" rows="5" placeholder="What should ${escapeHtml(nameOf(agent))} do?" required></textarea><div class="pm-row-buttons"><button class="pm-btn primary" type="submit">Dispatch</button><button class="pm-btn ghost" type="button" data-dispatch-cancel>Cancel</button></div></form></section>`;
        host.querySelector('[data-dispatch-cancel]')?.addEventListener('click', () => renderTab(active));
        host.querySelector('[data-dispatch-form]')?.addEventListener('submit', async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const task = String(form.querySelector('textarea')?.value || '').trim();
          if (!task) return;
          const submit = form.querySelector('[type="submit"]');
          submit.disabled = true;
          try {
            await features.spawnAgent(idValue, task);
            shell.showNotice('Task dispatched.');
            await renderTab('runs');
          } catch (error) {
            shell.showNotice(error?.message || 'Dispatch failed.');
            submit.disabled = false;
          }
        });
      });
      await renderTab(active);
    } catch (error) {
      content.innerHTML = errorState(error);
      content.querySelector('[data-v2-retry]')?.addEventListener('click', () => detail(id, initialTab));
    }
  }

  if (route?.id) await detail(route.id, route?.sub || 'overview');
  else await list();
  return () => {
    disposed = true;
    chatCleanup();
  };
}
