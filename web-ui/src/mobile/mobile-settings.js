import { ICONS, escapeHtml, renderMobileHeader, wireHeaderActions } from './mobile-shell.js?v=liquid-glass-v20';
import { mobileGatewayFetch, loadGatewayStatus, loadVoiceStatus } from './mobile-api.js';

const SECTIONS = [
  { id: 'heartbeat', title: 'Heartbeat', icon: 'clock', desc: 'Background heartbeat cadence and instructions.' },
  { id: 'search', title: 'Search', icon: 'target', desc: 'Preferred web search provider.' },
  { id: 'credentials', title: 'Credentials', icon: 'gear', desc: 'Search keys, vault status, and audit log.' },
  { id: 'security', title: 'Security', icon: 'check', desc: 'Workspace and file access allow/block lists.' },
  { id: 'models', title: 'Models', icon: 'brain', desc: 'LLM providers, defaults, brain, and compaction.' },
  { id: 'agents', title: 'Agents', icon: 'robot', desc: 'Agent list and model defaults.' },
  { id: 'channels', title: 'Channels', icon: 'send', desc: 'Telegram, Discord, and WhatsApp connections.' },
  { id: 'integrations', title: 'Integrations', icon: 'paperclip', desc: 'Webhooks and MCP servers.' },
];

const SECTION_IDS = new Set(SECTIONS.map(s => s.id));

function status(text, tone = 'muted') {
  return `<div class="pm-settings-status ${tone}">${escapeHtml(text || '')}</div>`;
}

function card(title, body, iconName = 'gear', extra = '') {
  return `<article class="pm-card pm-settings-card ${extra}">
    <div class="pm-card-head">${ICONS[iconName] || ''} ${escapeHtml(title)}</div>
    ${body}
  </article>`;
}

function field(label, inputHtml, help = '') {
  return `<label class="pm-settings-field"><span>${escapeHtml(label)}</span>${inputHtml}${help ? `<em>${escapeHtml(help)}</em>` : ''}</label>`;
}

function select(id, options, value) {
  return `<select class="pm-input pm-select" id="${escapeHtml(id)}">${options.map(opt => {
    const v = typeof opt === 'string' ? opt : opt.value;
    const label = typeof opt === 'string' ? opt : opt.label;
    return `<option value="${escapeHtml(v)}" ${String(v) === String(value) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('')}</select>`;
}

function input(id, value = '', attrs = '') {
  return `<input class="pm-input" id="${escapeHtml(id)}" value="${escapeHtml(value || '')}" ${attrs} />`;
}

function textarea(id, value = '', attrs = '') {
  return `<textarea class="pm-textarea" id="${escapeHtml(id)}" ${attrs}>${escapeHtml(value || '')}</textarea>`;
}

function toggleRow(id, label, checked, help = '') {
  return `<div class="pm-settings-toggle-row">
    <div><strong>${escapeHtml(label)}</strong>${help ? `<span>${escapeHtml(help)}</span>` : ''}</div>
    <button class="pm-toggle ${checked ? 'on' : ''}" id="${escapeHtml(id)}" data-toggle-bool="${escapeHtml(id)}" aria-label="${escapeHtml(label)}" aria-pressed="${checked ? 'true' : 'false'}"></button>
  </div>`;
}

function boolValue(page, id) {
  return page.querySelector(`#${CSS.escape(id)}`)?.classList.contains('on') === true;
}

function val(page, id) {
  return String(page.querySelector(`#${CSS.escape(id)}`)?.value || '').trim();
}

function arrFromCsv(value) {
  return String(value || '').split(',').map(s => s.trim()).filter(Boolean);
}

function linesFromValue(value) {
  return String(value || '').split('\n').map(s => s.trim()).filter(Boolean);
}

function setSectionStatus(page, text, tone = 'muted') {
  const el = page.querySelector('#pm-settings-live-status');
  if (!el) return;
  el.className = `pm-settings-status ${tone}`;
  el.textContent = text || '';
}

function wireToggles(page) {
  page.querySelectorAll('[data-toggle-bool]').forEach(btn => {
    btn.addEventListener('click', () => {
      const on = !btn.classList.contains('on');
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  });
}

function providerLabel(id) {
  const labels = {
    openai: 'OpenAI API',
    openai_codex: 'OpenAI OAuth',
    anthropic: 'Anthropic',
    xai: 'xAI / Grok',
    ollama: 'Ollama',
    gemini: 'Gemini',
    perplexity: 'Perplexity',
    elevenlabs: 'ElevenLabs',
  };
  return labels[id] || id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function normalizeProviders(llm) {
  const providers = llm?.providers && typeof llm.providers === 'object' ? llm.providers : {};
  const ids = Object.keys(providers);
  if (!ids.includes('ollama')) ids.push('ollama');
  if (!ids.includes('openai')) ids.push('openai');
  if (!ids.includes('openai_codex')) ids.push('openai_codex');
  if (!ids.includes('anthropic')) ids.push('anthropic');
  if (!ids.includes('xai')) ids.push('xai');
  return ids;
}

function renderSectionNav(active = '') {
  return `<div class="pm-settings-section-grid">
    ${SECTIONS.map(s => `<button class="pm-settings-section ${s.id === active ? 'active' : ''}" data-settings-section="${s.id}">
      <span>${ICONS[s.icon] || ICONS.gear}</span>
      <strong>${escapeHtml(s.title)}</strong>
      <em>${escapeHtml(s.desc)}</em>
    </button>`).join('')}
  </div>`;
}

export function renderMobileSettingsPage(slot, { section = '', navigate } = {}) {
  const current = SECTION_IDS.has(section) ? section : '';
  const title = current ? SECTIONS.find(s => s.id === current)?.title || 'Settings' : 'Settings';
  const leftIcon = current ? 'back' : 'menu';
  slot.innerHTML = `
    ${renderMobileHeader({ title, online: true, leftIcon })}
    <main class="pm-body pm-settings-body">
      ${current ? `<div class="pm-settings-topnav"><button class="pm-btn ghost" data-settings-home>${ICONS.back} All settings</button></div>` : ''}
      <div id="pm-settings-content">${current ? `<div class="pm-card">${status('Loading settings...')}</div>` : renderSettingsOverview()}</div>
    </main>
  `;
  wireHeaderActions(slot, {
    onBack: () => navigate?.('#mobile/settings'),
    onSettings: () => navigate?.('#mobile/settings'),
  });
  slot.querySelector('[data-settings-home]')?.addEventListener('click', () => navigate?.('#mobile/settings'));
  slot.querySelectorAll('[data-settings-section]').forEach(btn => {
    btn.addEventListener('click', () => navigate?.(`#mobile/settings/${btn.getAttribute('data-settings-section')}`));
  });
  if (current) loadSection(slot, current, navigate).catch(err => {
    const content = slot.querySelector('#pm-settings-content');
    if (content) content.innerHTML = card('Error', status(err.message || 'Failed to load settings', 'error'), 'gear');
  });
}

function renderSettingsOverview() {
  return `
    ${card('Mobile Settings', `<div class="pm-card-body">Configure the same Settings tabs from desktop, adapted for this paired phone. System, Shortcuts, and Pairing stay desktop-only.</div>`, 'gear', 'pm-card-strong')}
    ${renderSectionNav('')}
  `;
}

async function loadSection(page, section, navigate) {
  const content = page.querySelector('#pm-settings-content');
  if (!content) return;
  if (section === 'models') return renderModels(content, page);
  if (section === 'credentials') return renderCredentials(content, page);
  if (section === 'search') return renderSearch(content, page);
  if (section === 'heartbeat') return renderHeartbeat(content, page);
  if (section === 'security') return renderSecurity(content, page);
  if (section === 'agents') return renderAgents(content, page);
  if (section === 'channels') return renderChannels(content, page);
  if (section === 'integrations') return renderIntegrations(content, page);
}

async function renderModels(content, page) {
  const [providerData, sessionData, gateway] = await Promise.all([
    mobileGatewayFetch('/api/settings/provider'),
    mobileGatewayFetch('/api/settings/session').catch(() => null),
    loadGatewayStatus().catch(() => null),
  ]);
  const llm = providerData?.llm || {};
  const active = llm.provider || 'ollama';
  const providers = normalizeProviders(llm);
  const activeCfg = llm.providers?.[active] || {};
  const session = sessionData?.session || {};
  content.innerHTML = `
    ${card('Runtime', `<div class="pm-settings-kv">
      <span>Current model</span><strong>${escapeHtml(gateway?.currentModel || activeCfg.model || 'Unknown')}</strong>
      <span>Provider</span><strong>${escapeHtml(providerLabel(active))}</strong>
      <span>Status</span><strong>${gateway?.providerOnline ? 'Online' : 'Unknown'}</strong>
    </div>`, 'brain')}
    ${card('Provider', `
      ${field('Active provider', select('pm-set-provider', providers.map(id => ({ value: id, label: providerLabel(id) })), active))}
      <div id="pm-provider-fields">${renderProviderFields(active, activeCfg)}</div>
      <div class="pm-row-buttons">
        <button class="pm-btn" id="pm-refresh-models">${ICONS.refresh} Refresh Models</button>
        <button class="pm-btn" id="pm-test-model">${ICONS.refresh} Test</button>
        <button class="pm-btn primary" id="pm-save-model">${ICONS.check} Save</button>
      </div>
      <div id="pm-settings-live-status"></div>
    `, 'gear', 'pm-card-strong')}
    ${card('Session Compaction', `
      ${toggleRow('pm-session-roll', 'Rolling compaction', session.rollingCompactionEnabled !== false, 'Keep long mobile conversations usable.')}
      ${field('Max messages', input('pm-session-max', session.maxMessages || 160, 'type="number" min="20" max="500"'))}
      ${field('Compaction threshold', input('pm-session-compact', session.compactionThreshold || 0.82, 'type="number" min="0.4" max="0.95" step="0.01"'))}
      ${field('Memory flush threshold', input('pm-session-memory', session.memoryFlushThreshold || 0.9, 'type="number" min="0.5" max="0.98" step="0.01"'))}
      ${field('Rolling message count', input('pm-session-roll-count', session.rollingCompactionMessageCount || 40, 'type="number" min="10" max="120"'))}
      ${field('Rolling tool turns', input('pm-session-tool-turns', session.rollingCompactionToolTurns || 4, 'type="number" min="1" max="12"'))}
      ${field('Summary max words', input('pm-session-words', session.rollingCompactionSummaryMaxWords || 900, 'type="number" min="80" max="1500"'))}
      ${field('Compaction model override', input('pm-session-model', session.rollingCompactionModel || '', 'placeholder="Optional"'))}
      <button class="pm-btn primary" id="pm-save-session">${ICONS.check} Save compaction</button>
    `, 'clipboard')}
  `;
  wireToggles(page);
  page.querySelector('#pm-set-provider')?.addEventListener('change', () => {
    const selected = val(page, 'pm-set-provider');
    const cfg = llm.providers?.[selected] || {};
    const fieldsEl = page.querySelector('#pm-provider-fields');
    if (fieldsEl) fieldsEl.innerHTML = renderProviderFields(selected, cfg);
    wireToggles(page);
  });
  page.querySelector('#pm-refresh-models')?.addEventListener('click', async () => {
    setSectionStatus(page, 'Loading models...');
    try {
      const nextLlm = buildProviderPayload(page, llm);
      const provider = nextLlm.provider;
      const r = await mobileGatewayFetch('/api/models/test', { method: 'POST', body: JSON.stringify({ llm: nextLlm }) });
      const models = (r.models || []).map(m => typeof m === 'string' ? m : (m.name || String(m))).filter(Boolean);
      const modelEl = page.querySelector(`#${CSS.escape(modelInputId(provider))}`);
      if (modelEl && models.length && modelEl.tagName === 'SELECT') {
        const current = modelEl.value;
        modelEl.innerHTML = models.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
        if (current && models.includes(current)) modelEl.value = current;
      }
      setSectionStatus(page, models.length ? `${models.length} model(s) found.` : (r.error || 'No models found.'), models.length ? 'ok' : 'warn');
    } catch (err) { setSectionStatus(page, err.message, 'error'); }
  });
  page.querySelector('#pm-test-model')?.addEventListener('click', async () => {
    setSectionStatus(page, 'Testing provider...');
    try {
      const nextLlm = buildProviderPayload(page, llm);
      const r = await mobileGatewayFetch('/api/models/test', { method: 'POST', body: JSON.stringify({ llm: nextLlm }) });
      setSectionStatus(page, r.success ? `Connected. ${Array.isArray(r.models) ? r.models.length : 0} models returned.` : (r.error || 'Could not connect'), r.success ? 'ok' : 'warn');
    } catch (err) { setSectionStatus(page, err.message, 'error'); }
  });
  page.querySelector('#pm-save-model')?.addEventListener('click', async () => {
    setSectionStatus(page, 'Saving model settings...');
    try {
      const nextLlm = buildProviderPayload(page, llm);
      await mobileGatewayFetch('/api/settings/provider', { method: 'POST', body: JSON.stringify({ llm: nextLlm }) });
      setSectionStatus(page, 'Model settings saved.', 'ok');
    } catch (err) { setSectionStatus(page, err.message, 'error'); }
  });
  page.querySelector('#pm-save-session')?.addEventListener('click', async () => {
    try {
      await mobileGatewayFetch('/api/settings/session', { method: 'POST', body: JSON.stringify({
        rollingCompactionEnabled: boolValue(page, 'pm-session-roll'),
        maxMessages: Number(val(page, 'pm-session-max')),
        compactionThreshold: Number(val(page, 'pm-session-compact')),
        memoryFlushThreshold: Number(val(page, 'pm-session-memory')),
        rollingCompactionMessageCount: Number(val(page, 'pm-session-roll-count')),
        rollingCompactionToolTurns: Number(val(page, 'pm-session-tool-turns')),
        rollingCompactionSummaryMaxWords: Number(val(page, 'pm-session-words')),
        rollingCompactionModel: val(page, 'pm-session-model'),
      }) });
      setSectionStatus(page, 'Compaction settings saved.', 'ok');
    } catch (err) { setSectionStatus(page, err.message, 'error'); }
  });
}

function buildProviderPayload(page, currentLlm) {
  const provider = val(page, 'pm-set-provider') || currentLlm.provider || 'ollama';
  const providers = { ...(currentLlm.providers || {}) };
  providers[provider] = { ...(providers[provider] || {}) };
  const cfg = providers[provider];
  const model = val(page, modelInputId(provider));
  if (model) cfg.model = model;
  const endpoint = val(page, endpointInputId(provider));
  if (endpoint) cfg.endpoint = endpoint;
  else delete cfg.endpoint;
  const apiKey = val(page, apiKeyInputId(provider));
  if (apiKey) cfg.api_key = apiKey;
  const effort = val(page, effortInputId(provider));
  if (effort) cfg.reasoning_effort = effort;
  else delete cfg.reasoning_effort;
  if (provider === 'anthropic') {
    cfg.extended_thinking = boolValue(page, 'pm-anthropic-thinking');
    cfg.fast_mode = boolValue(page, 'pm-anthropic-fast');
    const budget = Number(val(page, 'pm-anthropic-budget'));
    if (budget) cfg.thinking_budget = budget;
  }
  return { ...currentLlm, provider, providers };
}

function modelInputId(provider) { return `pm-model-${provider}`; }
function endpointInputId(provider) { return `pm-endpoint-${provider}`; }
function apiKeyInputId(provider) { return `pm-key-${provider}`; }
function effortInputId(provider) { return `pm-effort-${provider}`; }

function renderProviderFields(provider, cfg = {}) {
  const modelId = modelInputId(provider);
  const endpointId = endpointInputId(provider);
  const keyId = apiKeyInputId(provider);
  const effortId = effortInputId(provider);
  const efforts = ['', 'minimal', 'low', 'medium', 'high', 'xhigh'].map(v => ({ value: v, label: v || 'none' }));
  const anthropicEfforts = ['', 'low', 'medium', 'high', 'xhigh', 'max'].map(v => ({ value: v, label: v === 'xhigh' ? 'extra high' : (v || 'provider default') }));
  if (provider === 'ollama') {
    return `
      ${field('Endpoint', input(endpointId, cfg.endpoint || 'http://localhost:11434'))}
      ${field('Active Model', input(modelId, cfg.model || '', 'placeholder="qwen3:4b"'))}
    `;
  }
  if (provider === 'llama_cpp') {
    return `${field('Endpoint', input(endpointId, cfg.endpoint || 'http://localhost:8080'))}${field('Model name', input(modelId, cfg.model || '', 'placeholder="qwen2.5-7b"'))}`;
  }
  if (provider === 'lm_studio') {
    return `${field('Endpoint', input(endpointId, cfg.endpoint || 'http://localhost:1234'))}${field('Model name', input(modelId, cfg.model || '', 'placeholder="qwen2.5-7b-instruct"'))}`;
  }
  if (provider === 'openai') {
    return `
      ${field('API Key', input(keyId, cfg.api_key || '', 'type="password" placeholder="sk-..."'))}
      ${field('Model', select(modelId, ['gpt-4.1','gpt-4.1-mini','gpt-4o','gpt-4o-mini','o4-mini','o3','o1'], cfg.model || 'gpt-4.1'))}
      ${field('Reasoning Effort', select(effortId, efforts.slice(0, 5), cfg.reasoning_effort || ''))}
    `;
  }
  if (provider === 'openai_codex') {
    return `
      ${field('Model', select(modelId, ['gpt-5.5','gpt-5.4-codex','gpt-5.4-codex-mini','gpt-5.4','gpt-5.4-mini','gpt-5.3-codex','gpt-5.3-codex-spark','gpt-5.3','gpt-5.2-codex','gpt-5.2','gpt-5.1-codex-max','gpt-5.1-codex-mini','gpt-5.1-codex','gpt-5.1'], cfg.model || 'gpt-5.5'))}
      ${field('Reasoning Effort', select(effortId, efforts, cfg.reasoning_effort || ''))}
      <div class="pm-settings-callout">Connect or disconnect the ChatGPT account from Credentials/Auth controls on desktop if OAuth needs renewal.</div>
    `;
  }
  if (provider === 'anthropic') {
    return `
      ${field('Model', select(modelId, ['claude-opus-4-8','claude-opus-4-7','claude-opus-4-6','claude-sonnet-4-6','claude-sonnet-4-5-20250514','claude-haiku-4-5-20251001'], cfg.model || 'claude-sonnet-4-6'))}
      ${field('Thinking Effort', select(effortId, anthropicEfforts, cfg.reasoning_effort || ''))}
      ${toggleRow('pm-anthropic-thinking', 'Extended thinking', cfg.extended_thinking === true)}
      ${toggleRow('pm-anthropic-fast', 'Fast mode (Opus 4.6/4.7/4.8)', cfg.fast_mode === true)}
      ${field('Legacy Thinking Budget', select('pm-anthropic-budget', ['2048','5000','10000','16000','24000','32000'], String(cfg.thinking_budget || '10000')))}
    `;
  }
  if (provider === 'perplexity') {
    return `${field('API Key', input(keyId, cfg.api_key || '', 'type="password" placeholder="pplx-..."'))}${field('Model', select(modelId, ['sonar-pro','sonar','sonar-reasoning-pro','sonar-reasoning','sonar-deep-research'], cfg.model || 'sonar-pro'))}${field('Reasoning Effort', select(effortId, ['', 'low', 'medium', 'high'].map(v => ({ value: v, label: v || 'none' })), cfg.reasoning_effort || ''))}`;
  }
  if (provider === 'gemini') {
    return `${field('API Key', input(keyId, cfg.api_key || '', 'type="password" placeholder="AIza..."'))}${field('Model', select(modelId, ['gemini-2.5-pro','gemini-2.5-flash','gemini-2.5-flash-lite','gemini-2.0-flash','gemini-1.5-pro','gemini-1.5-flash'], cfg.model || 'gemini-2.5-pro'))}`;
  }
  return `${field('Model', input(modelId, cfg.model || '', 'placeholder="Provider model"'))}${field('Endpoint', input(endpointId, cfg.endpoint || '', 'placeholder="Optional endpoint"'))}`;
}

async function renderCredentials(content, page) {
  const [search, cred, audit] = await Promise.all([
    mobileGatewayFetch('/api/settings/search').catch(() => ({})),
    mobileGatewayFetch('/api/credentials/status').catch(() => ({ keys: [] })),
    mobileGatewayFetch('/api/credentials/audit').catch(() => ({ lines: [] })),
  ]);
  content.innerHTML = `
    ${card('Search Provider Keys', `
      <div class="pm-card-body" style="margin-bottom:10px;">Stored encrypted in the vault. Masked values keep the existing key.</div>
      ${field('TinyFish API Key', input('pm-cred-tinyfish', search.tinyfish_api_key || '', 'type="password" placeholder="tf-..." autocomplete="new-password"'))}
      ${field('Tavily API Key', input('pm-cred-tavily', search.tavily_api_key || '', 'type="password" placeholder="tvly-..." autocomplete="new-password"'))}
      ${field('Google API Key', input('pm-cred-google', search.google_api_key || '', 'type="password" placeholder="AIza..." autocomplete="new-password"'))}
      ${field('Google CSE ID', input('pm-cred-google-cx', search.google_cx || '', 'placeholder="Custom search engine ID"'), 'Stored for persistence; leave as-is to keep current value.')}
      ${field('Brave API Key', input('pm-cred-brave', search.brave_api_key || '', 'type="password" placeholder="BSA..." autocomplete="new-password"'))}
      <button class="pm-btn primary" id="pm-save-creds">${ICONS.check} Save credentials</button>
      <div id="pm-settings-live-status"></div>
    `, 'gear', 'pm-card-strong')}
    ${card('Vault Status', `<div class="pm-settings-list">
      ${(cred.keys || []).map(k => `<div class="pm-settings-row"><span><strong>${escapeHtml(_credentialLabel(k))}</strong><em>${escapeHtml(k)}</em></span><span class="pm-pill active">stored</span></div>`).join('') || '<div class="pm-card-body">No credentials stored yet.</div>'}
    </div>`, 'check')}
    ${card('How Credentials Work', `<div class="pm-card-body">When saved, keys are encrypted with AES-256-GCM and referenced from config as vault entries. If a field shows bullets, a key is already stored.</div>`, 'clipboard')}
    ${card('Recent Vault Access', `<div class="pm-settings-log">${(audit.lines || []).slice(-18).reverse().map(line => `<div>${escapeHtml(line)}</div>`).join('') || '<div>No audit entries yet.</div>'}</div>
      <button class="pm-btn" id="pm-refresh-creds">${ICONS.refresh} Refresh</button>`, 'clipboard')}
  `;
  page.querySelector('#pm-refresh-creds')?.addEventListener('click', () => renderCredentials(content, page));
  page.querySelector('#pm-save-creds')?.addEventListener('click', async () => {
    try {
      await mobileGatewayFetch('/api/settings/search', { method: 'POST', body: JSON.stringify({
        preferred_provider: search.preferred_provider || 'tavily',
        search_rigor: search.search_rigor || 'verified',
        tinyfish_api_key: val(page, 'pm-cred-tinyfish'),
        tavily_api_key: val(page, 'pm-cred-tavily'),
        google_api_key: val(page, 'pm-cred-google'),
        google_cx: val(page, 'pm-cred-google-cx'),
        brave_api_key: val(page, 'pm-cred-brave'),
      }) });
      setSectionStatus(page, 'Credentials saved.', 'ok');
      await renderCredentials(content, page);
    } catch (err) { setSectionStatus(page, err.message, 'error'); }
  });
}

function _credentialLabel(key) {
  return ({
    'search.tavily_api_key': 'Tavily API Key',
    'search.tinyfish_api_key': 'TinyFish API Key',
    'search.google_api_key': 'Google API Key',
    'search.google_cx': 'Google CSE ID',
    'search.brave_api_key': 'Brave API Key',
    'llm.openai.api_key': 'OpenAI API Key',
    'hooks.token': 'Webhook Token',
    'channels.telegram.botToken': 'Telegram Token',
    'channels.discord.botToken': 'Discord Token',
  })[key] || key;
}

async function renderSearch(content, page) {
  const s = await mobileGatewayFetch('/api/settings/search');
  content.innerHTML = `
    ${card('Web Search', `
      ${field('Preferred provider', select('pm-search-provider', ['tavily', 'tinyfish', 'google', 'brave', 'none'], s.preferred_provider || 'tavily'))}
      <div class="pm-settings-callout">API keys are managed in the Credentials tab and stored encrypted.</div>
      <button class="pm-btn primary" id="pm-save-search">${ICONS.check} Save search provider</button>
      <div id="pm-settings-live-status"></div>
    `, 'target', 'pm-card-strong')}
  `;
  page.querySelector('#pm-save-search')?.addEventListener('click', async () => {
    try {
      await mobileGatewayFetch('/api/settings/search', { method: 'POST', body: JSON.stringify({
        preferred_provider: val(page, 'pm-search-provider'),
        search_rigor: s.search_rigor || 'verified',
        tavily_api_key: s.tavily_api_key || '',
        tinyfish_api_key: s.tinyfish_api_key || '',
        google_api_key: s.google_api_key || '',
        google_cx: s.google_cx || '',
        brave_api_key: s.brave_api_key || '',
      }) });
      setSectionStatus(page, 'Search settings saved.', 'ok');
    } catch (err) { setSectionStatus(page, err.message, 'error'); }
  });
}

async function renderVoice(content, navigate) {
  const voice = await loadVoiceStatus();
  const stt = voice.voice?.sttProviders || [];
  const tts = voice.voice?.ttsProviders || [];
  content.innerHTML = `
    ${card('Realtime Voice', `<div class="pm-settings-kv">
      <span>Status</span><strong>${voice.realtime?.configured ? 'Configured' : 'Not configured'}</strong>
      <span>Preferred</span><strong>${voice.providers?.includes('openai_codex') || voice.providers?.includes('openai') ? 'OpenAI Realtime' : 'Best connected provider'}</strong>
    </div>`, 'mic', 'pm-card-strong')}
    ${card('Speech Providers', `<div class="pm-settings-chip-row">
      ${[...new Set([...stt, ...tts, ...(voice.providers || [])])].map(p => `<span class="pm-pill ${p ? 'active' : 'gray'}">${escapeHtml(providerLabel(p))}</span>`).join('') || '<span class="pm-card-body">No speech providers detected.</span>'}
    </div>`, 'send')}
    ${card('Configure Voice', `<div class="pm-card-body">Voice uses the same model and credential connections as the rest of Prometheus.</div>
      <div class="pm-row-buttons" style="margin-top:10px;">
        <button class="pm-btn primary" data-go-models>${ICONS.brain} Models</button>
        <button class="pm-btn" data-go-creds>${ICONS.gear} Credentials</button>
      </div>`, 'gear')}
  `;
  content.querySelector('[data-go-models]')?.addEventListener('click', () => navigate?.('#mobile/settings/models'));
  content.querySelector('[data-go-creds]')?.addEventListener('click', () => navigate?.('#mobile/settings/credentials'));
}

async function renderHeartbeat(content, page) {
  const data = await mobileGatewayFetch('/api/settings/heartbeat');
  const hb = data.heartbeat || {};
  content.innerHTML = card('Heartbeat', `
    ${toggleRow('pm-hb-enabled', 'Enabled', hb.enabled !== false, 'Allow Prometheus to wake itself for background work.')}
    ${field('Interval minutes', input('pm-hb-interval', hb.interval_minutes || 30, 'type="number" min="1" max="1440"'))}
    ${field('Model override', input('pm-hb-model', hb.model || '', 'placeholder="Optional"'))}
    ${toggleRow('pm-hb-review', 'Review teams after run', hb.review_teams_after_run === true)}
    ${field('Instructions', textarea('pm-hb-instructions', hb.instructions || '', 'rows="10"'))}
    <button class="pm-btn primary" id="pm-save-heartbeat">${ICONS.check} Save heartbeat</button>
    <div id="pm-settings-live-status"></div>
  `, 'clock', 'pm-card-strong');
  wireToggles(page);
  page.querySelector('#pm-save-heartbeat')?.addEventListener('click', async () => {
    try {
      await mobileGatewayFetch('/api/settings/heartbeat', { method: 'POST', body: JSON.stringify({
        enabled: boolValue(page, 'pm-hb-enabled'),
        interval_minutes: Number(val(page, 'pm-hb-interval')),
        model: val(page, 'pm-hb-model'),
        review_teams_after_run: boolValue(page, 'pm-hb-review'),
        instructions: page.querySelector('#pm-hb-instructions')?.value || '',
      }) });
      setSectionStatus(page, 'Heartbeat settings saved.', 'ok');
    } catch (err) { setSectionStatus(page, err.message, 'error'); }
  });
}

async function renderSecurity(content, page) {
  const paths = await mobileGatewayFetch('/api/settings/paths').catch(() => ({}));
  content.innerHTML = `
    ${card('File Access', `
      ${field('Workspace Path', input('pm-sec-workspace', paths.workspace_path || '', 'placeholder="%APPDATA%\\\\Prometheus\\\\workspace"'))}
      ${field('Allowed Paths (one per line)', textarea('pm-sec-allowed', (paths.allowed_paths || []).join('\n'), 'rows="6"'))}
      ${field('Blocked Paths (one per line)', textarea('pm-sec-blocked', (paths.blocked_paths || []).join('\n'), 'rows="5"'))}
      <button class="pm-btn primary" id="pm-save-security">${ICONS.check} Save file access</button>
      <div id="pm-settings-live-status"></div>
    `, 'check', 'pm-card-strong')}
  `;
  page.querySelector('#pm-save-security')?.addEventListener('click', async () => {
    try {
      await mobileGatewayFetch('/api/settings/paths', { method: 'POST', body: JSON.stringify({
        workspace_path: val(page, 'pm-sec-workspace'),
        allowed_paths: linesFromValue(page.querySelector('#pm-sec-allowed')?.value || ''),
        blocked_paths: linesFromValue(page.querySelector('#pm-sec-blocked')?.value || ''),
      }) });
      setSectionStatus(page, 'File access settings saved.', 'ok');
    } catch (err) { setSectionStatus(page, err.message, 'error'); }
  });
}

async function renderMigration(content, page) {
  const data = await mobileGatewayFetch('/api/migration/sources');
  const sources = data.sources || [];
  content.innerHTML = `
    ${card('Sources', `<div class="pm-settings-list">
      ${sources.map((s, i) => `<label class="pm-settings-choice">
        <input type="radio" name="pm-migration-source" value="${escapeHtml(s.id)}" ${i === 0 ? 'checked' : ''}>
        <span><strong>${escapeHtml(s.label || s.kind || 'Source')}</strong><em>${escapeHtml(s.path || '')}</em></span>
      </label>`).join('') || '<div class="pm-card-body">No automatic sources found.</div>'}
    </div>
    ${field('Custom source path', input('pm-migration-custom', '', 'placeholder="Optional folder path"'))}
    <div class="pm-row-buttons">
      <button class="pm-btn" id="pm-preview-migration">${ICONS.refresh} Preview</button>
      <button class="pm-btn primary" id="pm-run-migration">${ICONS.upload} Import</button>
    </div>
    <div id="pm-settings-live-status"></div>`, 'upload', 'pm-card-strong')}
    <div id="pm-migration-preview">${card('Reports', `<div class="pm-settings-log">${(data.reports || []).slice(0, 6).map(r => `<div>${escapeHtml(r.completedAt ? new Date(r.completedAt).toLocaleString() : 'Report')} · ${escapeHtml(r.source || r.sourceKind || '')}</div>`).join('') || '<div>No migration reports yet.</div>'}</div>`, 'clipboard')}</div>
  `;
  let lastPreview = null;
  const options = () => {
    const custom = val(page, 'pm-migration-custom');
    const selected = page.querySelector('[name="pm-migration-source"]:checked')?.value || '';
    return custom ? { sourcePath: custom, sourceKind: 'custom', mode: 'user-data' } : { sourceId: selected, mode: 'user-data' };
  };
  page.querySelector('#pm-preview-migration')?.addEventListener('click', async () => {
    try {
      setSectionStatus(page, 'Building preview...');
      const r = await mobileGatewayFetch('/api/migration/preview', { method: 'POST', body: JSON.stringify(options()) });
      lastPreview = r.report;
      renderMigrationPreview(page, lastPreview);
      setSectionStatus(page, 'Preview ready.', 'ok');
    } catch (err) { setSectionStatus(page, err.message, 'error'); }
  });
  page.querySelector('#pm-run-migration')?.addEventListener('click', async () => {
    try {
      if (!lastPreview) {
        const r = await mobileGatewayFetch('/api/migration/preview', { method: 'POST', body: JSON.stringify(options()) });
        lastPreview = r.report;
      }
      const ok = window.confirm('Import selected migration data?');
      if (!ok) return;
      const r = await mobileGatewayFetch('/api/migration/execute', { method: 'POST', body: JSON.stringify(options()) });
      renderMigrationPreview(page, r.report);
      setSectionStatus(page, 'Migration import complete.', 'ok');
    } catch (err) { setSectionStatus(page, err.message, 'error'); }
  });
}

function renderMigrationPreview(page, report) {
  const target = page.querySelector('#pm-migration-preview');
  if (!target) return;
  const items = report?.items || [];
  target.innerHTML = card('Preview', `<div class="pm-settings-log">
    ${items.slice(0, 30).map(i => `<div><strong>${escapeHtml(i.status || '')}</strong> ${escapeHtml(i.label || i.category || '')}<br><em>${escapeHtml(i.reason || i.destination || '')}</em></div>`).join('') || '<div>No importable items in preview.</div>'}
  </div>`, 'clipboard');
}

async function renderAgents(content, page) {
  const [agents, defaults] = await Promise.all([
    mobileGatewayFetch('/api/agents').catch(() => ({ agents: [] })),
    mobileGatewayFetch('/api/settings/agent-model-defaults').catch(() => ({ defaults: {} })),
  ]);
  const list = agents.agents || agents.items || [];
  const defs = defaults.defaults || {};
  const visibleDefaultKeys = [
    'main_chat',
    'proposal_executor_high_risk',
    'proposal_executor_low_risk',
    'coordinator',
    'manager',
    'subagent_planner',
    'subagent_orchestrator',
    'subagent_researcher',
    'subagent_analyst',
    'subagent_builder',
    'subagent_operator',
  ];
  const selected = list.find(a => String(a.id) === String(page._pmSelectedAgentId)) || list.find(a => a.id === 'main') || list[0] || {};
  content.innerHTML = `
    ${card('Model Defaults', `
      ${visibleDefaultKeys.map((k) => field(k.replace(/_/g, ' '), input(`pm-agent-def-${k}`, defs[k] || '', 'placeholder="Provider/model"'))).join('')}
      <button class="pm-btn primary" id="pm-save-agent-defaults">${ICONS.check} Save defaults</button>
      <div id="pm-settings-live-status"></div>
    `, 'brain', 'pm-card-strong')}
    ${card('Configured Agents', `<div class="pm-settings-list">${list.map(a => `<button class="pm-settings-row pm-settings-row-button ${String(a.id) === String(selected.id) ? 'active' : ''}" data-agent-id="${escapeHtml(a.id)}">
      <span><strong>${escapeHtml(a.name || a.id)}</strong><em>${escapeHtml(a.description || a.model || a.status || '')}</em></span>
      <span class="pm-pill ${a.enabled === false ? 'gray' : 'active'}">${a.enabled === false ? 'off' : 'on'}</span>
    </button>`).join('') || '<div class="pm-card-body">No agents found.</div>'}</div>
      <button class="pm-btn" id="pm-new-agent" style="margin-top:10px;">${ICONS.plus} New Agent</button>`, 'robot')}
    ${renderAgentEditor(selected)}
  `;
  page.querySelectorAll('[data-agent-id]').forEach(btn => btn.addEventListener('click', async () => {
    page._pmSelectedAgentId = btn.getAttribute('data-agent-id');
    await renderAgents(content, page);
  }));
  page.querySelector('#pm-new-agent')?.addEventListener('click', () => {
    page._pmSelectedAgentId = '';
    const editor = page.querySelector('#pm-agent-editor');
    if (editor) editor.innerHTML = renderAgentEditor({ id: '', name: '', description: '', workspace: '', maxSteps: 8, default: false }, true);
    wireAgentEditor(page, content);
  });
  wireAgentEditor(page, content, selected);
  page.querySelector('#pm-save-agent-defaults')?.addEventListener('click', async () => {
    try {
      const next = {};
      visibleDefaultKeys.forEach(k => { next[k] = val(page, `pm-agent-def-${k}`); });
      await mobileGatewayFetch('/api/settings/agent-model-defaults', { method: 'POST', body: JSON.stringify(next) });
      setSectionStatus(page, 'Agent defaults saved.', 'ok');
    } catch (err) { setSectionStatus(page, err.message, 'error'); }
  });
}

function renderAgentEditor(agent = {}, isNew = false) {
  return `<div id="pm-agent-editor">${card('Agent Details', `
    ${field('ID', input('pm-agent-id', agent.id || '', `${isNew ? '' : 'readonly'} placeholder="researcher"`))}
    ${field('Name', input('pm-agent-name', agent.name || '', 'placeholder="Scout"'))}
    ${field('Description', textarea('pm-agent-description', agent.description || '', 'rows="3"'))}
    ${field('Workspace', input('pm-agent-workspace', agent.workspace || '', 'placeholder="%APPDATA%\\\\Prometheus\\\\workspace\\\\agents\\\\researcher"'))}
    ${field('Model', input('pm-agent-model', agent.model || '', 'placeholder="provider/model or blank for default"'))}
    ${field('Max Steps', input('pm-agent-max-steps', agent.maxSteps || agent.max_steps || 8, 'type="number" min="1" step="1"'))}
    ${toggleRow('pm-agent-default', 'Default agent', agent.default === true)}
    <div class="pm-row-buttons">
      <button class="pm-btn primary" id="pm-save-agent">${ICONS.check} Save Agent</button>
      ${agent.id && agent.id !== 'main' ? `<button class="pm-btn ghost" id="pm-delete-agent">${ICONS.trash} Delete</button>` : ''}
    </div>
  `, 'robot', 'pm-card-strong')}
  ${agent.id && agent.id !== 'main' ? card('Manual Spawn + Run History', `
    ${field('Task', textarea('pm-agent-task', '', 'rows="3" placeholder="Run a one-off task for this agent..."'))}
    <div class="pm-row-buttons">
      <button class="pm-btn primary" id="pm-run-agent">${ICONS.play} Run Once</button>
      <button class="pm-btn" id="pm-agent-history">${ICONS.refresh} Refresh History</button>
    </div>
    <div id="pm-agent-run-output" class="pm-settings-log" style="margin-top:10px;"></div>
  `, 'play') : ''}</div>`;
}

function wireAgentEditor(page, content) {
  wireToggles(page);
  page.querySelector('#pm-save-agent')?.addEventListener('click', async () => {
    const id = val(page, 'pm-agent-id');
    if (!id) return setSectionStatus(page, 'Agent ID is required.', 'error');
    const agent = {
      id,
      name: val(page, 'pm-agent-name'),
      description: page.querySelector('#pm-agent-description')?.value || '',
      workspace: val(page, 'pm-agent-workspace'),
      model: val(page, 'pm-agent-model'),
      maxSteps: Number(val(page, 'pm-agent-max-steps')) || 8,
      default: boolValue(page, 'pm-agent-default'),
    };
    try {
      const exists = !!page._pmSelectedAgentId;
      await mobileGatewayFetch(exists ? `/api/agents/${encodeURIComponent(id)}` : '/api/agents', {
        method: exists ? 'PUT' : 'POST',
        body: JSON.stringify({ agent }),
      });
      page._pmSelectedAgentId = id;
      setSectionStatus(page, 'Agent saved.', 'ok');
      await renderAgents(content, page);
    } catch (err) { setSectionStatus(page, err.message, 'error'); }
  });
  page.querySelector('#pm-delete-agent')?.addEventListener('click', async () => {
    const id = val(page, 'pm-agent-id');
    if (!id || !window.confirm(`Delete agent "${id}"?`)) return;
    try {
      await mobileGatewayFetch(`/api/agents/${encodeURIComponent(id)}`, { method: 'DELETE' });
      page._pmSelectedAgentId = '';
      await renderAgents(content, page);
    } catch (err) { setSectionStatus(page, err.message, 'error'); }
  });
  page.querySelector('#pm-run-agent')?.addEventListener('click', async () => {
    const id = val(page, 'pm-agent-id');
    const task = String(page.querySelector('#pm-agent-task')?.value || '').trim();
    const out = page.querySelector('#pm-agent-run-output');
    if (!task) return setSectionStatus(page, 'Provide a task first.', 'error');
    if (out) out.innerHTML = '<div>Running...</div>';
    try {
      const r = await mobileGatewayFetch(`/api/agents/${encodeURIComponent(id)}/spawn`, { method: 'POST', body: JSON.stringify({ task }) });
      if (out) out.innerHTML = `<div>${escapeHtml(JSON.stringify(r.result || r, null, 2)).replace(/\n/g, '<br>')}</div>`;
    } catch (err) { if (out) out.innerHTML = `<div>${escapeHtml(err.message)}</div>`; }
  });
  page.querySelector('#pm-agent-history')?.addEventListener('click', async () => {
    const id = val(page, 'pm-agent-id');
    const out = page.querySelector('#pm-agent-run-output');
    try {
      const r = await mobileGatewayFetch(`/api/agents/history?agentId=${encodeURIComponent(id)}&limit=12`);
      if (out) out.innerHTML = (r.history || []).map(row => `<div><strong>${escapeHtml(row.success ? 'success' : 'failed')}</strong> ${escapeHtml(row.trigger || 'manual')}<br><em>${escapeHtml(row.resultPreview || row.error || '')}</em></div>`).join('') || '<div>No runs yet.</div>';
    } catch (err) { if (out) out.innerHTML = `<div>${escapeHtml(err.message)}</div>`; }
  });
}

async function renderChannels(content, page) {
  const s = await mobileGatewayFetch('/api/channels/status');
  const tg = s.telegram || {};
  const dc = s.discord || {};
  const wa = s.whatsapp || {};
  content.innerHTML = `
    ${card('Channel Connection', `
      ${field('Channel', select('pm-channel-select', [
        { value: 'telegram', label: 'Telegram' },
        { value: 'discord', label: 'Discord' },
        { value: 'whatsapp', label: 'WhatsApp' },
      ], 'telegram'))}
      <div id="pm-channel-status-card"></div>
      <div id="pm-channel-form"></div>
      <div class="pm-row-buttons">
        <button class="pm-btn" id="pm-channel-test">${ICONS.refresh} Test</button>
        <button class="pm-btn primary" id="pm-channel-save">${ICONS.check} Save</button>
        <button class="pm-btn" id="pm-channel-send">${ICONS.send} Send Test</button>
      </div>
      <div id="pm-settings-live-status"></div>
    `, 'send', 'pm-card-strong')}
    ${card('Instructions', `<div id="pm-channel-guide" class="pm-card-body"></div>`, 'clipboard')}
  `;
  const renderCurrent = () => renderChannelForm(page, { telegram: tg, discord: dc, whatsapp: wa });
  page.querySelector('#pm-channel-select')?.addEventListener('change', renderCurrent);
  renderCurrent();
  page.querySelector('#pm-channel-save')?.addEventListener('click', async () => {
    const channel = val(page, 'pm-channel-select') || 'telegram';
    try {
      await mobileGatewayFetch('/api/channels/config', { method: 'POST', body: JSON.stringify({ channels: { [channel]: readMobileChannelPayload(page, channel) } }) });
      setSectionStatus(page, `${channel} settings saved.`, 'ok');
    } catch (err) { setSectionStatus(page, err.message, 'error'); }
  });
  page.querySelector('#pm-channel-test')?.addEventListener('click', async () => {
    const channel = val(page, 'pm-channel-select') || 'telegram';
    try {
      const r = await mobileGatewayFetch(`/api/channels/test/${channel}`, { method: 'POST', body: JSON.stringify(readMobileChannelPayload(page, channel)) });
      setSectionStatus(page, r.success ? `${channel} connection test passed.` : (r.error || `${channel} test failed.`), r.success ? 'ok' : 'error');
    } catch (err) { setSectionStatus(page, err.message, 'error'); }
  });
  page.querySelector('#pm-channel-send')?.addEventListener('click', async () => {
    const channel = val(page, 'pm-channel-select') || 'telegram';
    try {
      const r = await mobileGatewayFetch(`/api/channels/send-test/${channel}`, { method: 'POST', body: JSON.stringify(readMobileChannelPayload(page, channel)) });
      setSectionStatus(page, r.success ? `Test message sent via ${channel}.` : (r.error || 'Send test failed.'), r.success ? 'ok' : 'error');
    } catch (err) { setSectionStatus(page, err.message, 'error'); }
  });
}

function renderChannelForm(page, status) {
  const channel = val(page, 'pm-channel-select') || 'telegram';
  const cfg = status[channel] || {};
  const statusEl = page.querySelector('#pm-channel-status-card');
  const form = page.querySelector('#pm-channel-form');
  const guide = page.querySelector('#pm-channel-guide');
  if (statusEl) statusEl.innerHTML = `<div class="pm-settings-channel">
    <div><strong>${escapeHtml(channel[0].toUpperCase() + channel.slice(1))}</strong><span>${cfg.enabled ? 'Enabled' : 'Disabled'}${cfg.connected ? ' · connected' : ''}</span></div>
    <span class="pm-pill ${cfg.enabled ? 'active' : 'gray'}">${cfg.enabled ? 'on' : 'off'}</span>
  </div>`;
  if (channel === 'telegram' && form) {
    form.innerHTML = `
      ${field('Bot Token', input('pm-ch-token', '', `type="password" placeholder="${cfg.hasToken ? '•••••••• (saved)' : '123456:ABC-DEF1234...'}"`))}
      ${field('Your Telegram User ID(s)', input('pm-ch-userids', (cfg.allowedUserIds || []).join(', '), 'placeholder="123456789, 987654321"'))}
      ${toggleRow('pm-ch-enabled', 'Enable Telegram channel', cfg.enabled === true)}
    `;
    if (guide) guide.innerHTML = 'Create a bot with BotFather, paste the token, add allowed user IDs, then Test, Save, and Send Test.';
  } else if (channel === 'discord' && form) {
    form.innerHTML = `
      ${field('Bot Token', input('pm-ch-token', '', `type="password" placeholder="${cfg.hasToken ? '•••••••• (saved)' : 'Discord bot token'}"`))}
      ${field('Application ID (optional)', input('pm-ch-appid', cfg.applicationId || ''))}
      ${field('Guild ID (optional)', input('pm-ch-guildid', cfg.guildId || ''))}
      ${field('Channel ID (for send-test)', input('pm-ch-channelid', cfg.channelId || ''))}
      ${field('Webhook URL (optional)', input('pm-ch-webhook', '', `type="password" placeholder="${cfg.hasWebhook ? '•••••••• (saved)' : 'https://discord.com/api/webhooks/...'}"`))}
      ${toggleRow('pm-ch-enabled', 'Enable Discord channel', cfg.enabled === true)}
    `;
    if (guide) guide.innerHTML = 'Create an app and bot in Discord Developer Portal, invite it to your server, then Test, Save, and Send Test.';
  } else if (form) {
    form.innerHTML = `
      ${field('Access Token', input('pm-ch-token', '', `type="password" placeholder="${cfg.hasAccessToken ? '•••••••• (saved)' : 'Meta access token'}"`))}
      ${field('Phone Number ID', input('pm-ch-phoneid', cfg.phoneNumberId || ''))}
      ${field('Business Account ID (optional)', input('pm-ch-baid', cfg.businessAccountId || ''))}
      ${field('Webhook Verify Token (optional)', input('pm-ch-verify', '', `type="password" placeholder="${cfg.verifyTokenSet ? '•••••••• (saved)' : 'Verify token'}"`))}
      ${field('Webhook Secret (optional)', input('pm-ch-secret', '', `type="password" placeholder="${cfg.webhookSecretSet ? '•••••••• (saved)' : 'Webhook secret'}"`))}
      ${field('Test Recipient (E.164)', input('pm-ch-recipient', cfg.testRecipient || '', 'placeholder="15551234567"'))}
      ${toggleRow('pm-ch-enabled', 'Enable WhatsApp channel', cfg.enabled === true)}
    `;
    if (guide) guide.innerHTML = 'Copy WhatsApp Cloud API credentials from Meta Developer dashboard, configure optional webhook fields, then Test, Save, and Send Test.';
  }
  wireToggles(page);
}

function readMobileChannelPayload(page, channel) {
  const enabled = boolValue(page, 'pm-ch-enabled');
  if (channel === 'telegram') {
    return { enabled, botToken: val(page, 'pm-ch-token'), allowedUserIds: arrFromCsv(val(page, 'pm-ch-userids')) };
  }
  if (channel === 'discord') {
    return {
      enabled,
      botToken: val(page, 'pm-ch-token'),
      applicationId: val(page, 'pm-ch-appid'),
      guildId: val(page, 'pm-ch-guildid'),
      channelId: val(page, 'pm-ch-channelid'),
      webhookUrl: val(page, 'pm-ch-webhook'),
    };
  }
  return {
    enabled,
    accessToken: val(page, 'pm-ch-token'),
    phoneNumberId: val(page, 'pm-ch-phoneid'),
    businessAccountId: val(page, 'pm-ch-baid'),
    verifyToken: val(page, 'pm-ch-verify'),
    webhookSecret: val(page, 'pm-ch-secret'),
    testRecipient: val(page, 'pm-ch-recipient'),
  };
}

async function renderIntegrations(content, page) {
  const [hooks, mcp, ext] = await Promise.all([
    mobileGatewayFetch('/api/settings/hooks').catch(() => null),
    mobileGatewayFetch('/api/mcp/servers').catch(() => ({ servers: [] })),
    mobileGatewayFetch('/api/extensions/catalog').catch(() => ({ items: [], extensions: [] })),
  ]);
  const servers = mcp.servers || [];
  const extensions = ext.items || ext.extensions || ext.catalog || [];
  content.innerHTML = `
    ${card('Webhooks', `
      ${toggleRow('pm-hooks-enabled', 'Enabled', hooks?.hooks?.enabled || hooks?.enabled || false)}
      ${field('Secret Token', input('pm-hooks-token', hooks?.hooks?.token || hooks?.token || '', 'type="password" placeholder="Paste or generate a secret token"'))}
      ${field('Path', input('pm-hooks-path', hooks?.hooks?.path || hooks?.path || '/hooks/prometheus'))}
      <div class="pm-row-buttons">
        <button class="pm-btn" id="pm-generate-hooks">${ICONS.refresh} Generate</button>
        <button class="pm-btn" id="pm-test-hooks">${ICONS.refresh} Test</button>
        <button class="pm-btn primary" id="pm-save-hooks">${ICONS.check} Save</button>
      </div>
      <div id="pm-settings-live-status"></div>
    `, 'paperclip', 'pm-card-strong')}
    ${card('MCP Servers', `<div class="pm-settings-list">${servers.map(s => `<div class="pm-settings-row">
      <span><strong>${escapeHtml(s.name || s.id)}</strong><em>${escapeHtml(s.status || 'disconnected')} · ${escapeHtml(String(s.toolCount || 0))} tools</em></span>
    </div>`).join('') || '<div class="pm-card-body">No MCP servers configured.</div>'}</div>`, 'monitor')}
    ${card('Extensions', `<div class="pm-settings-chip-row">${extensions.slice(0, 20).map(e => `<span class="pm-pill gray">${escapeHtml(e.name || e.id || e.title || 'Extension')}</span>`).join('') || '<span class="pm-card-body">No extensions found.</span>'}</div>`, 'spark')}
  `;
  wireToggles(page);
  page.querySelector('#pm-generate-hooks')?.addEventListener('click', () => {
    const arr = new Uint8Array(24);
    crypto.getRandomValues(arr);
    const token = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
    const inp = page.querySelector('#pm-hooks-token');
    if (inp) { inp.value = token; inp.type = 'text'; }
  });
  page.querySelector('#pm-save-hooks')?.addEventListener('click', async () => {
    try {
      await mobileGatewayFetch('/api/settings/hooks', { method: 'POST', body: JSON.stringify({ enabled: boolValue(page, 'pm-hooks-enabled'), token: val(page, 'pm-hooks-token'), path: val(page, 'pm-hooks-path') }) });
      setSectionStatus(page, 'Webhook settings saved. Restart gateway to apply endpoint changes.', 'ok');
    } catch (err) { setSectionStatus(page, err.message, 'error'); }
  });
  page.querySelector('#pm-test-hooks')?.addEventListener('click', async () => {
    try {
      const r = await mobileGatewayFetch('/api/settings/hooks/test', { method: 'POST', body: '{}' });
      setSectionStatus(page, r.success ? 'Webhook test sent.' : (r.error || 'Webhook test failed.'), r.success ? 'ok' : 'error');
    } catch (err) { setSectionStatus(page, err.message, 'error'); }
  });
}
