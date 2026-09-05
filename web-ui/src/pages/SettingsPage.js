import { returnFromMobileSettings } from '../settings-return.js';

/**
 * SettingsPage.js — Settings Modal Extract
 *
 * Settings modal: model/provider config, agents CRUD, heartbeat config,
 * credentials, skills management, shortcuts, channels,
 * integrations (webhooks + MCP servers), quick mode settings.
 *
 * ~2,153 lines extracted from index.html.
 *
 * Dependencies: api() from api.js, escHtml/showToast/showConfirm from utils.js
 */

import { api } from '../api.js';
import { escHtml, showToast, showConfirm, log } from '../utils.js';
import { fetchCredentialedModelProviderIds, filterCredentialedProviderCatalogItems, isCredentialedModelProviderId } from '../components/model-provider-credentials.js';
import { normalizeAgentVoiceProfile } from '../components/agent-voice-picker.js';
import { startRedoOnboardingFlow } from '../onboarding/redo-onboarding.js';
import { showTutorial } from '../onboarding/tutorial-overlay.js';
import { renderProviderUsageCard } from './HubPage.js';
import { effortOptions, validEffort, supportsFastSpeed } from '../reasoning-capabilities.js';
import { formatModelDisplayName, relabelModelSelect } from '../model-display.js';

// SettingsPage is an ES module, so an unqualified `addProcessEntry` lookup
// does not fall through to the legacy global in Safari. Keep the existing
// callers safe when the process pane is not mounted yet (and when this page is
// used on mobile).
function addProcessEntry(...args) {
  const recorder = typeof window !== 'undefined' ? window.addProcessEntry : null;
  if (typeof recorder === 'function') return recorder(...args);
  return undefined;
}

const SETTINGS_ICON_PATHS = {
  keyboard: '<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M7 9h.01"></path><path d="M10 9h.01"></path><path d="M13 9h.01"></path><path d="M16 9h.01"></path><path d="M7 13h.01"></path><path d="M10 13h.01"></path><path d="M13 13h4"></path><path d="M7 17h10"></path>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"></circle><path d="m21 2-9.6 9.6"></path><path d="m15.5 7.5 2 2"></path><path d="m18 5 2 2"></path>',
  messageSquare: '<path d="M7 17H4a1 1 0 0 1-1-1V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v11a1 1 0 0 1-1 1H9l-5 4v-4Z"></path><path d="M8 9h8"></path><path d="M8 13h5"></path>',
  alertTriangle: '<path d="M12 3 2 20h20L12 3Z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path>',
  shieldCheck: '<path d="m12 3 7 3v5c0 5-3.4 8.4-7 10-3.6-1.6-7-5-7-10V6l7-3Z"></path><path d="m9.5 12 1.7 1.7 3.3-3.3"></path>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"></path><circle cx="12" cy="12" r="3"></circle>',
  eyeOff: '<path d="M3 3 21 21"></path><path d="M10.6 10.7A3 3 0 0 0 12 15a3 3 0 0 0 2.3-1.1"></path><path d="M6.7 6.8A17.7 17.7 0 0 1 12 6c6.5 0 10 6 10 6a18.6 18.6 0 0 1-4.2 4.8"></path><path d="M4.1 9.6A18.2 18.2 0 0 0 2 12s3.5 6 10 6c1.6 0 3-.4 4.3-1"></path>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 1 1 8 0v3"></path>',
  home: '<path d="M3 11.5 12 4l9 7.5"></path><path d="M5 10.5V20h14v-9.5"></path>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="10" cy="7" r="4"></circle><path d="M20 21v-2a4 4 0 0 0-3-3.9"></path><path d="M16 3.1a4 4 0 0 1 0 7.8"></path>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"></rect><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><path d="M3 12h18"></path>',
  activity: '<path d="M22 12h-4l-2.5 5-4-10-2.5 5H2"></path>',
  clock: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 3"></path>',
  clipboard: '<rect x="8" y="3" width="8" height="4" rx="1"></rect><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"></path><path d="M9 12h6"></path><path d="M9 16h6"></path>',
  search: '<circle cx="11" cy="11" r="7"></circle><path d="m21 21-4.3-4.3"></path>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect>',
  chart: '<path d="M4 19h16"></path><path d="M7 16V9"></path><path d="M12 16V5"></path><path d="M17 16v-4"></path>',
  hammer: '<path d="m14 7 3-3 3 3-3 3"></path><path d="M13 8 5 16"></path><path d="M6 15 9 18"></path><path d="M4 17 7 20"></path>',
  sliders: '<path d="M4 21v-7"></path><path d="M4 10V3"></path><path d="M12 21v-12"></path><path d="M12 5V3"></path><path d="M20 21v-4"></path><path d="M20 13V3"></path><path d="M2 14h4"></path><path d="M10 9h4"></path><path d="M18 17h4"></path>',
  checkCircle: '<circle cx="12" cy="12" r="9"></circle><path d="m9 12 2 2 4-4"></path>',
  xCircle: '<circle cx="12" cy="12" r="9"></circle><path d="m9 9 6 6"></path><path d="m15 9-6 6"></path>',
  infoCircle: '<circle cx="12" cy="12" r="9"></circle><path d="M12 10v5"></path><path d="M12 7h.01"></path>',
  zap: '<path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"></path>',
  send: '<path d="M22 2 11 13"></path><path d="M22 2 15 22l-4-9-9-4 20-7Z"></path>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"></path>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18h1.2a1.8 1.8 0 0 0 1.3-3.05 1.8 1.8 0 0 1 1.28-3.07H18A3 3 0 0 0 21 12C21 7.03 16.97 3 12 3Z"></path><circle cx="7.5" cy="10" r=".8" fill="currentColor" stroke="none"></circle><circle cx="10" cy="7" r=".8" fill="currentColor" stroke="none"></circle><circle cx="14" cy="7" r=".8" fill="currentColor" stroke="none"></circle><circle cx="16.5" cy="10" r=".8" fill="currentColor" stroke="none"></circle>',
};

function renderSettingsIcon(name, size = 14) {
  const paths = SETTINGS_ICON_PATHS[name];
  if (!paths) return '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

function applySettingsIcon(target, name, size = 14) {
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  if (!el) return;
  el.innerHTML = renderSettingsIcon(name, size);
}

function setSettingsStatus(statusEl, type, text) {
  if (!statusEl) return;
  if (!text) {
    statusEl.innerHTML = '';
    return;
  }
  const iconName = type === 'success' ? 'checkCircle' : type === 'error' ? 'xCircle' : 'infoCircle';
  statusEl.style.display = 'inline-flex';
  statusEl.style.alignItems = 'center';
  statusEl.style.gap = '6px';
  statusEl.innerHTML = `${renderSettingsIcon(iconName, 14)}<span>${escHtml(text)}</span>`;
}

function setCredentialToggleIcon(btn, isVisible) {
  if (!btn) return;
  btn.innerHTML = renderSettingsIcon(isVisible ? 'eyeOff' : 'eye', 16);
  btn.title = isVisible ? 'Hide value' : 'Show value';
  btn.setAttribute('aria-label', isVisible ? 'Hide value' : 'Show value');
}

function initSettingsIconLabels() {
  document.querySelectorAll('[data-settings-icon-label]').forEach((el) => {
    if (el.dataset.settingsIconReady === 'true') return;
    const iconName = el.getAttribute('data-settings-icon-label');
    const size = Number(el.getAttribute('data-settings-icon-size') || 14);
    const text = (el.getAttribute('data-settings-icon-text') || el.textContent || '').trim();
    if (!iconName || !text) return;
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.gap = '6px';
    el.innerHTML = `${renderSettingsIcon(iconName, size)}<span>${escHtml(text)}</span>`;
    el.dataset.settingsIconReady = 'true';
  });
}

function initSettingsStaticIcons() {
  applySettingsIcon('settings-shortcuts-tab-icon', 'keyboard', 14);
  applySettingsIcon('settings-search-callout-icon', 'key', 14);
  applySettingsIcon('settings-cred-info-icon', 'lock', 14);
  applySettingsIcon('agent-md-team-badge-icon', 'home', 12);
  applySettingsIcon('agent-hb-title-icon', 'activity', 14);
  document.querySelectorAll('[data-settings-nav-icon]').forEach((el) => {
    const iconName = el.getAttribute('data-settings-nav-icon');
    if (iconName) el.innerHTML = renderSettingsIcon(iconName, 15);
  });
  initSettingsIconLabels();
  setCredentialToggleIcon(document.getElementById('cred-tavily-visibility-toggle'), false);
  setCredentialToggleIcon(document.getElementById('cred-tinyfish-visibility-toggle'), false);
  setCredentialToggleIcon(document.getElementById('cred-google-visibility-toggle'), false);
  setCredentialToggleIcon(document.getElementById('cred-brave-visibility-toggle'), false);
}

const SETTINGS_DATA_CACHE_TTL_MS = {
  searchSummary: 30_000,
  modelSettings: 60_000,
  credentialsFields: 90_000,
  credentialsVaultStatus: 45_000,
  credentialsVaultLog: 45_000,
  channelsStatus: 45_000,
  integrationsWebhook: 45_000,
  integrationsMcp: 60_000,
  agents: 45_000,
};

const _settingsDataCache = new Map();
const _settingsDataRequests = new Map();
let _settingsAgentsLoadedSelection = '';
let _settingsVisibilityRefreshTimer = null;
let _settingsVisibilityRefreshWired = false;
let _pendingModelStatusProbeTimer = null;

function _isSettingsCacheFresh(entry, now = Date.now()) {
  return !!entry && entry.expiresAt > now;
}

function _withSettingsCache({ key, ttlMs, fetcher }) {
  const now = Date.now();
  const entry = _settingsDataCache.get(key);

  if (_isSettingsCacheFresh(entry, now)) {
    return { value: entry.value, refreshPromise: null };
  }

  const refreshPromise = _settingsDataRequests.get(key);
  if (refreshPromise) {
    return { value: entry?.value || null, refreshPromise };
  }

  const promise = Promise.resolve().then(() => fetcher()).then((value) => {
    if (value === undefined) return value;
    _settingsDataCache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
    return value;
  }).finally(() => {
    _settingsDataRequests.delete(key);
  });
  _settingsDataRequests.set(key, promise);
  return { value: entry?.value || null, refreshPromise: promise };
}

function _touchSettingsCache(key) {
  if (!_settingsDataCache.has(key)) return;
  const value = _settingsDataCache.get(key).value;
  _settingsDataCache.set(key, {
    value,
    expiresAt: Date.now() + SETTINGS_DATA_CACHE_TTL_MS.searchSummary,
  });
}

function _touchSettingsCacheWithTtl(key, ttlMs) {
  if (!_settingsDataCache.has(key)) return;
  const value = _settingsDataCache.get(key).value;
  _settingsDataCache.set(key, {
    value,
    expiresAt: Date.now() + (ttlMs || SETTINGS_DATA_CACHE_TTL_MS.searchSummary),
  });
}

function _markSettingsCacheBusted(key) {
  _settingsDataCache.delete(key);
  _settingsDataRequests.delete(key);
}

function _touchSettingsCacheOnInteraction(key, ttlMs = SETTINGS_DATA_CACHE_TTL_MS.searchSummary) {
  _touchSettingsCacheWithTtl(key, ttlMs);
}

function _isCacheEntryStale(entry) {
  return !entry || !entry.expiresAt || entry.expiresAt <= Date.now();
}

function _withSWRCacheEntry({ key, ttlMs, fetcher }) {
  const cached = _withSettingsCache({ key, ttlMs, fetcher });
  const refreshExpired = _isCacheEntryStale(_settingsDataCache.get(key));
  return { ...cached, refreshExpired };
}

function _scheduleSettingsVisibilityRefresh() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (_settingsVisibilityRefreshWired) return;
  _settingsVisibilityRefreshWired = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (_settingsVisibilityRefreshTimer) clearTimeout(_settingsVisibilityRefreshTimer);
    _settingsVisibilityRefreshTimer = setTimeout(() => {
      _settingsVisibilityRefreshTimer = null;
      const activeTab = String(window.settingsTab || '').trim();
      const maybeRefresh = [];
      if (activeTab === 'models') {
        const cache = _settingsDataCache.get('settings-models');
        if (_isCacheEntryStale(cache)) maybeRefresh.push(loadModelSettings());
      }
      if (activeTab === 'agents') {
        const cache = _settingsDataCache.get('settings-agents');
        if (_isCacheEntryStale(cache)) maybeRefresh.push(loadAgentsTab());
      }
      if (activeTab === 'search') {
        const cache = _settingsDataCache.get('settings-credentials-fields');
        if (_isCacheEntryStale(cache)) maybeRefresh.push(loadCredFields());
      }
      if (activeTab === 'channels') {
        const cache = _settingsDataCache.get('settings-channels');
        if (_isCacheEntryStale(cache)) maybeRefresh.push(loadChannelsStatus());
      }
      if (activeTab === 'integrations') {
        const webhookCache = _settingsDataCache.get('settings-webhooks');
        const mcpCache = _settingsDataCache.get('settings-mcp');
        if (_isCacheEntryStale(webhookCache)) maybeRefresh.push(loadWebhookSettings());
        if (_isCacheEntryStale(mcpCache)) maybeRefresh.push(loadMCPServers());
      }
      if (maybeRefresh.length) {
        Promise.allSettled(maybeRefresh).catch(() => {});
      }
    }, 250);
  });
}

let quickSearchRigor = 'verified';
let quickThinkingEffort = 'standard';

function applySearchSettingsSummary(s) {
  const el = document.getElementById('r-failed');
  if (el) el.textContent = s.preferred_provider || 'tavily';
  const providerEl = document.getElementById('settings-provider');
  if (providerEl) providerEl.value = s.preferred_provider || 'tavily';
  const rigorEl = document.getElementById('settings-search-rigor');
  if (rigorEl) rigorEl.value = s.search_rigor || 'verified';
  quickSearchRigor = s.search_rigor || 'verified';
  updateQuickModeUI();
}

async function loadSearchSettingsSummary() {
  const cached = _withSettingsCache({
    key: 'settings-search-summary',
    ttlMs: SETTINGS_DATA_CACHE_TTL_MS.searchSummary,
    fetcher: () => api('/api/settings/search'),
  });
  if (cached.value) {
    applySearchSettingsSummary(cached.value);
    if (!cached.refreshPromise) return;
  }
  if (cached.refreshPromise) {
    cached.refreshPromise.then((s) => {
      if (s) applySearchSettingsSummary(s);
    }).catch(() => {});
    if (!cached.value) {
      try {
        const latest = await cached.refreshPromise;
        if (latest) applySearchSettingsSummary(latest);
      } catch {}
    }
  }
}

function updateQuickModeUI() {
  const lbl = document.getElementById('quick-mode-label');
  if (lbl) lbl.textContent = (quickSearchRigor || 'verified').replace(/^./, c => c.toUpperCase());
  ['fast', 'verified', 'strict'].forEach(v => {
    const el = document.getElementById(`rigor-${v}`);
    if (el) el.classList.toggle('active', quickSearchRigor === v);
  });
  ['standard', 'extended'].forEach(v => {
    const el = document.getElementById(`think-${v}`);
    if (el) el.classList.toggle('active', quickThinkingEffort === v);
  });
}

function toggleQuickModePopover() {
  const pop = document.getElementById('quick-mode-popover');
  if (!pop) return;
  const nextOpen = !pop.classList.contains('open');
  pop.classList.toggle('open', nextOpen);
  if (nextOpen) {
    pop.classList.remove('clamp-left');
    requestAnimationFrame(() => {
      const rect = pop.getBoundingClientRect();
      if (rect.left < 8) pop.classList.add('clamp-left');
      const after = pop.getBoundingClientRect();
      if (after.top < 8) {
        pop.style.bottom = 'auto';
        pop.style.top = '34px';
      } else {
        pop.style.top = '';
        pop.style.bottom = '34px';
      }
    });
  }
  updateQuickModeUI();
}

async function setQuickSearchRigor(level) {
  quickSearchRigor = level;
  updateQuickModeUI();
  try {
    const s = await api('/api/settings/search');
    const payload = {
      preferred_provider: s.preferred_provider || 'tavily',
      search_rigor: level,
      tinyfish_api_key: s.tinyfish_api_key || '',
      tavily_api_key: s.tavily_api_key || '',
      google_api_key: s.google_api_key || '',
      google_cx: s.google_cx || '',
      brave_api_key: s.brave_api_key || '',
    };
    await api('/api/settings/search', { method: 'POST', body: JSON.stringify(payload) });
    addProcessEntry('info', `Search rigor set to ${level}.`);
    await loadSearchSettingsSummary();
  } catch (err) {
    addProcessEntry('error', `Failed to set search rigor: ${err.message}`);
  }
}

function setQuickThinkingEffort(level) {
  quickThinkingEffort = level === 'extended' ? 'extended' : 'standard';
  localStorage.setItem('prometheus_quick_thinking_effort', quickThinkingEffort);
  updateQuickModeUI();
  addProcessEntry('info', `Thinking effort set to ${quickThinkingEffort} (UI preference).`);
}

let _desktopUpdaterState = { supported: false, autoUpdateEnabled: true, status: 'unsupported' };
let _desktopUpdaterEventsBound = false;

function desktopUpdaterElements() {
  return {
    toggle: document.getElementById('settings-auto-update-toggle'),
    status: document.getElementById('settings-update-status'),
    version: document.getElementById('settings-update-version'),
    check: document.getElementById('settings-update-check'),
    download: document.getElementById('settings-update-download'),
    install: document.getElementById('settings-update-install'),
  };
}

function applyDesktopUpdateState(nextState = {}) {
  _desktopUpdaterState = { ..._desktopUpdaterState, ...nextState };
  window._prometheusUpdaterSettingsState = _desktopUpdaterState;
  const els = desktopUpdaterElements();
  if (!els.toggle && !els.status) return;

  const supported = _desktopUpdaterState.supported === true;
  const enabled = _desktopUpdaterState.autoUpdateEnabled !== false;
  const status = String(_desktopUpdaterState.status || (supported ? 'idle' : 'unsupported'));
  const version = String(_desktopUpdaterState.version || '').trim();
  const currentVersion = String(_desktopUpdaterState.currentVersion || '').trim();
  const busy = ['checking', 'downloading', 'preparing', 'installing', 'relaunching'].includes(status);

  if (els.toggle) {
    els.toggle.disabled = !supported;
    els.toggle.classList.toggle('is-on', enabled);
    els.toggle.setAttribute('aria-checked', enabled ? 'true' : 'false');
  }
  if (els.version) {
    els.version.textContent = currentVersion
      ? `Installed version ${currentVersion}${version ? ` · release ${version}` : ''}`
      : 'Installed version —';
  }
  if (els.status) {
    els.status.textContent = !supported
      ? 'Updates are available in installed public builds.'
      : String(_desktopUpdaterState.message || (
        status === 'ready' ? 'Update downloaded and ready to install.' :
        status === 'available' ? `Prometheus ${version || 'update'} is available.` :
        status === 'checking' ? 'Checking for updates…' :
        status === 'downloading' ? 'Downloading update…' :
        status === 'installing' ? 'Installing update…' :
        enabled ? 'Prometheus is up to date.' : 'Automatic updates are off.'
      ));
  }
  if (els.check) {
    els.check.disabled = !supported || busy;
    els.check.textContent = status === 'checking' ? 'Checking…' : 'Check for updates';
  }
  if (els.download) {
    els.download.hidden = !supported || status !== 'available';
    els.download.disabled = busy;
  }
  if (els.install) {
    els.install.hidden = !supported || status !== 'ready';
    els.install.disabled = busy;
  }
}

function bindDesktopUpdaterEvents() {
  const bridge = window.prometheusUpdater;
  if (!bridge || _desktopUpdaterEventsBound) return;
  _desktopUpdaterEventsBound = true;
  if (typeof bridge.onState === 'function') bridge.onState(applyDesktopUpdateState);
}

async function loadDesktopUpdateSettings() {
  const bridge = window.prometheusUpdater;
  if (!bridge || typeof bridge.getState !== 'function') {
    applyDesktopUpdateState({ supported: false, status: 'unsupported' });
    return;
  }
  bindDesktopUpdaterEvents();
  try {
    applyDesktopUpdateState(await bridge.getState());
  } catch (error) {
    applyDesktopUpdateState({ supported: false, status: 'error', message: error?.message || 'Could not read update settings.' });
  }
}

async function setDesktopAutoUpdate(enabled) {
  const bridge = window.prometheusUpdater;
  if (!bridge || typeof bridge.setAutoUpdateEnabled !== 'function') return;
  const toggle = desktopUpdaterElements().toggle;
  if (toggle) toggle.disabled = true;
  try {
    applyDesktopUpdateState(await bridge.setAutoUpdateEnabled(enabled === true));
  } catch (error) {
    applyDesktopUpdateState({ status: 'error', message: error?.message || 'Could not save automatic update preference.' });
  }
}

function toggleDesktopAutoUpdate() {
  return setDesktopAutoUpdate(_desktopUpdaterState.autoUpdateEnabled === false);
}

async function checkDesktopForUpdates() {
  const bridge = window.prometheusUpdater;
  if (!bridge || typeof bridge.checkForUpdates !== 'function') return;
  try {
    applyDesktopUpdateState({ status: 'checking', message: 'Checking for updates…' });
    applyDesktopUpdateState(await bridge.checkForUpdates());
  } catch (error) {
    applyDesktopUpdateState({ status: 'error', message: error?.message || 'Update check failed.' });
  }
}

async function downloadDesktopUpdate() {
  const bridge = window.prometheusUpdater;
  if (!bridge || typeof bridge.downloadUpdate !== 'function') return;
  try {
    applyDesktopUpdateState({ status: 'downloading', message: 'Downloading update…' });
    applyDesktopUpdateState(await bridge.downloadUpdate());
  } catch (error) {
    applyDesktopUpdateState({ status: 'error', message: error?.message || 'Update download failed.' });
  }
}

async function installDesktopUpdate() {
  const bridge = window.prometheusUpdater;
  if (!bridge || typeof bridge.installUpdate !== 'function') return;
  const confirmed = await new Promise((resolve) => showConfirm(
    'Prometheus will flush durable writes, create a protected backup of user state, close, install the verified release, reopen, and validate it.',
    () => resolve(true),
    () => resolve(false),
    {
      title: 'Install Prometheus update?',
      confirmText: 'Install & reopen',
      cancelText: 'Cancel',
      danger: true,
      details: 'Vault and credentials, settings, workspace files, memory, sessions, projects, and configured external workspaces remain in the user-data directory and are included in the retained backup.',
    },
  ));
  if (!confirmed) return;
  try {
    applyDesktopUpdateState({ status: 'installing', message: 'Closing Prometheus to install the update…' });
    applyDesktopUpdateState(await bridge.installUpdate(true));
  } catch (error) {
    applyDesktopUpdateState({ status: 'error', message: error?.message || 'Update installation failed.' });
  }
}

function setSettingsTab(tab) {
  if (tab === 'credentials') tab = 'search';
  if (tab === 'migration') {
    // Keep the old navigation target working while the durable P11-37 flow
    // lives in General. The legacy migration service remains available to
    // existing callers, but users land on the reviewed import controls.
    window.settingsLegacyMigrationNotice = true;
    tab = 'system';
  }
  window.settingsTab = tab;
  const tabs = ['system', 'appearance', 'heartbeat', 'search', 'security', 'migration', 'models', 'agents', 'channels', 'integrations', 'shortcuts', 'pairing'];
  const titles = {
    system: 'General',
    appearance: 'Appearance',
    heartbeat: 'Heartbeat',
    search: 'Search',
    security: 'Security',
    migration: 'Migration',
    models: 'Models',
    agents: 'Agents',
    channels: 'Channels',
    integrations: 'Integrations',
    shortcuts: 'Keyboard shortcuts',
    pairing: 'Pairing',
  };
  const pageTitle = document.getElementById('settings-page-title');
  if (pageTitle) pageTitle.textContent = titles[tab] || 'General';
  const pendingLoads = [];

  tabs.forEach(t => {
    const btn = document.getElementById(`settings-tab-${t}`);
    const panel = document.getElementById(`settings-panel-${t}`);
    if (btn) {
      btn.classList.toggle('active', t === tab);
    }
    if (panel) {
        if (t === tab) {
        const gridTabs = ['system', 'appearance', 'search', 'models'];
        panel.style.display = gridTabs.includes(t) ? 'block' : 'block';
        if (t === 'appearance' && typeof window.renderAppearanceSettings === 'function') window.renderAppearanceSettings();
        if (t === 'system') {
          pendingLoads.push(loadDesktopUpdateSettings());
          wireAutoSettleControls();
          pendingLoads.push(loadAutoSettleSettings());
          pendingLoads.push(loadExternalImportJobs());
          pendingLoads.push(loadExternalImportDiscovery());
        }
        if (t === 'heartbeat') {
          if (!window.heartbeatSettingsLoaded) pendingLoads.push(loadHeartbeatSettings());
          else if (window.heartbeatEditor) window.heartbeatEditor.refresh();
        }
        if (t === 'channels') pendingLoads.push(loadChannelsStatus());
        if (t === 'models') pendingLoads.push(loadModelSettings());
        if (t === 'agents') pendingLoads.push(loadAgentsTab());
        if (t === 'integrations') pendingLoads.push(loadIntegrationsTab());
        if (t === 'search') {
          pendingLoads.push(Promise.all([loadSearchSettingsSummary(), loadCredFields()]).then(() => {
            window._settingsSearchLoadedToUI = true;
          }).catch(() => {
            window._settingsSearchLoadedToUI = false;
          }));
        }
        if (t === 'security') pendingLoads.push(loadSecuritySettings());
        if (t === 'migration') pendingLoads.push(loadMigrationPanel());
        if (t === 'shortcuts') pendingLoads.push(loadShortcutsPanel());
        if (t === 'pairing')   pendingLoads.push(loadPairingPanel());
      } else {
        panel.style.display = 'none';
      }
    }
  });

  if (pendingLoads.length) {
    Promise.allSettled(pendingLoads).catch(() => {});
  }
  if (tab === 'system' && window.settingsLegacyMigrationNotice) {
    window.settingsLegacyMigrationNotice = false;
    setTimeout(() => {
      const target = document.getElementById('settings-external-import');
      if (target) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
      externalImportStatus('conversation', 'info', 'Migration now lives here. The older migration entry point remains compatible.');
    }, 0);
  }
}

async function replayOnboardingTutorial() {
  const statusEl = document.getElementById('settings-onboarding-status');
  setSettingsStatus(statusEl, 'info', 'Opening tutorial...');
  try {
    closeSettings();
    await showTutorial();
  } catch (err) {
    setSettingsStatus(statusEl, 'error', `Could not replay tutorial: ${err.message}`);
  }
}

async function runOnboardingDevTest() {
  const statusEl = document.getElementById('settings-onboarding-status');
  setSettingsStatus(statusEl, 'info', 'Opening onboarding dev test...');
  try {
    closeSettings();
    await window.OnboardingController?.runIfNeeded?.({ devTest: true, skipMigration: true });
  } catch (err) {
    setSettingsStatus(statusEl, 'error', `Could not run dev test: ${err.message}`);
  }
}

function redoOnboardingFromSettings() {
  closeSettings();
  startRedoOnboardingFlow();
}

function updateBgtHeartbeatLabel() {
  const hbLabel = document.getElementById('bgt-heartbeat-label');
  if (!hbLabel) return;
  const mins = Math.max(1, Math.min(1440, Number(window.heartbeatSettingsCache.interval_minutes) || 30));
  const on = window.heartbeatSettingsCache.enabled !== false;
  hbLabel.textContent = on ? `• heartbeat: ${mins}min` : '• heartbeat: off';
  hbLabel.style.color = on ? 'var(--brand)' : 'var(--muted)';
}

function ensureHeartbeatEditor() {
  if (window.heartbeatEditor || typeof CodeMirror === 'undefined') return;
  const wrap = document.getElementById('settings-hb-editor-wrap');
  if (!wrap) return;
  window.heartbeatEditor = CodeMirror(wrap, {
    value: '',
    mode: 'markdown',
    lineNumbers: true,
    lineWrapping: true,
    tabSize: 2,
    indentWithTabs: false,
    theme: 'default',
  });
  window.heartbeatEditor.setSize('100%', 340);
  setTimeout(() => { if (window.heartbeatEditor) window.heartbeatEditor.refresh(); }, 200);
}

function setHeartbeatToggleState(el, enabled) {
  if (!el) return;
  const on = !!enabled;
  el.classList.toggle('is-on', on);
  el.setAttribute('aria-checked', String(on));
  el.dataset.enabled = String(on);
}

function readHeartbeatToggleState(el) {
  if (!el) return false;
  if (el.getAttribute('role') === 'switch') return el.getAttribute('aria-checked') === 'true';
  return !!el.checked;
}

function toggleHeartbeatSetting(id) {
  const el = document.getElementById(String(id || ''));
  if (!el) return;
  setHeartbeatToggleState(el, !readHeartbeatToggleState(el));
}

function applyHeartbeatSettingsToForm(heartbeat) {
  const hb = heartbeat || {};
  const enabledEl = document.getElementById('settings-hb-enabled');
  const intervalEl = document.getElementById('settings-hb-interval');
  const modelEl = document.getElementById('settings-hb-model');
  const reviewEl = document.getElementById('settings-hb-review-teams');
  const pathEl = document.getElementById('settings-hb-path');

  setHeartbeatToggleState(enabledEl, hb.enabled !== false);
  if (intervalEl) intervalEl.value = String(Math.max(1, Math.min(1440, Number(hb.interval_minutes) || 30)));
  if (modelEl) modelEl.value = String(hb.model || '');
  setHeartbeatToggleState(reviewEl, hb.review_teams_after_run === true);
  if (pathEl) pathEl.textContent = `HEARTBEAT.md path: ${String(hb.path || '-')}`;
  ensureHeartbeatEditor();
  if (window.heartbeatEditor) window.heartbeatEditor.setValue(String(hb.instructions || ''));
}

async function loadHeartbeatSettings(showStatus = false) {
  const statusEl = document.getElementById('settings-hb-status');
  if (showStatus && statusEl) statusEl.textContent = 'Loading...';
  ensureHeartbeatEditor();
  try {
    const data = await api('/api/settings/heartbeat');
    if (!data?.success || !data?.heartbeat) throw new Error(data?.error || 'Failed to load heartbeat settings');
    window.heartbeatSettingsCache = {
      ...window.heartbeatSettingsCache,
      ...data.heartbeat,
    };
    window.heartbeatSettingsLoaded = true;
    applyHeartbeatSettingsToForm(window.heartbeatSettingsCache);
    updateBgtHeartbeatLabel();
    loadSubagentHeartbeatList().catch(() => {});
    if (showStatus && statusEl) statusEl.textContent = 'Reloaded from server.';
  } catch (err) {
    if (statusEl) statusEl.textContent = `Failed to load: ${err.message}`;
  }
}

async function refreshHeartbeatSummary() {
  try {
    const data = await api('/api/settings/heartbeat');
    if (!data?.success || !data?.heartbeat) return;
    window.heartbeatSettingsCache = {
      ...window.heartbeatSettingsCache,
      ...data.heartbeat,
    };
    updateBgtHeartbeatLabel();
  } catch {
    // Keep last known summary
  }
}

async function saveHeartbeatSettings() {
  const statusEl = document.getElementById('settings-hb-status');
  const enabledEl = document.getElementById('settings-hb-enabled');
  const intervalEl = document.getElementById('settings-hb-interval');
  const modelEl = document.getElementById('settings-hb-model');
  const reviewEl = document.getElementById('settings-hb-review-teams');
  ensureHeartbeatEditor();

  const payload = {
    enabled: readHeartbeatToggleState(enabledEl),
    interval_minutes: Math.max(1, Math.min(1440, Number(intervalEl?.value) || 30)),
    model: String(modelEl?.value || '').trim(),
    review_teams_after_run: readHeartbeatToggleState(reviewEl),
    instructions: window.heartbeatEditor ? window.heartbeatEditor.getValue() : '',
  };

  if (statusEl) statusEl.textContent = 'Saving...';
  try {
    const data = await api('/api/settings/heartbeat', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!data?.success || !data?.heartbeat) throw new Error(data?.error || 'Failed to save heartbeat settings');
    window.heartbeatSettingsCache = {
      ...window.heartbeatSettingsCache,
      ...data.heartbeat,
    };
    window.heartbeatSettingsLoaded = true;
    applyHeartbeatSettingsToForm(window.heartbeatSettingsCache);
    updateBgtHeartbeatLabel();
    loadSubagentHeartbeatList().catch(() => {});
    if (statusEl) statusEl.textContent = 'Saved.';
    addProcessEntry('final', 'Heartbeat settings saved.');
  } catch (err) {
    if (statusEl) statusEl.textContent = `Save failed: ${err.message}`;
    addProcessEntry('error', `Heartbeat settings save failed: ${err.message}`);
  }
}

// --- Subagent heartbeat list (Settings > Heartbeat) --------------------------

let agentHbEditor = null;

async function loadSubagentHeartbeatList() {
  const el = document.getElementById('hb-agent-list');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--muted);font-size:12px">Loading...</div>';
  try {
    const data = await api('/api/heartbeat/agents');
    const agents = Array.isArray(data?.agents) ? data.agents : [];
    if (!agents.length) {
      el.innerHTML = '<div style="color:var(--muted);font-size:12px">No subagents with HEARTBEAT.md registered yet.</div>';
      return;
    }
    el.innerHTML = agents.map(a => {
      const cfg = a.config || {};
      const lastRun = a.lastRunAt ? new Date(a.lastRunAt).toLocaleString() : 'never';
      const resultDot = a.lastResult === 'active' ? '#22c55e' : a.lastResult === 'error' ? '#ef4444' : '#94a3b8';
      return `
        <div style="border:1px solid var(--line);border-radius:10px;padding:10px;background:var(--panel-2)">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
            <span style="width:8px;height:8px;border-radius:50%;background:${resultDot};flex-shrink:0"></span>
            <span style="font-weight:600;font-size:13px;color:var(--text);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(a.agentId)}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
            <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer">
              <input type="checkbox" ${cfg.enabled ? 'checked' : ''} onchange="updateSubagentHb('${escHtml(a.agentId)}',{enabled:this.checked})" /> On
            </label>
            <div style="display:flex;align-items:center;gap:3px">
              <input type="number" min="1" max="1440" value="${cfg.intervalMinutes || 30}"
                style="width:52px;border:1px solid var(--line);border-radius:6px;padding:2px 5px;font-size:12px;text-align:center"
                onchange="updateSubagentHb('${escHtml(a.agentId)}',{interval_minutes:Number(this.value)})" />
              <span style="font-size:11px;color:var(--muted)">min</span>
            </div>
            <button onclick="tickSubagentHb('${escHtml(a.agentId)}')" style="padding:2px 8px;border:1px solid var(--line);border-radius:6px;background:#fff;font-size:11px;cursor:pointer">▶</button>
          </div>
          <div style="font-size:10px;color:var(--muted)">last: ${escHtml(lastRun)}</div>
        </div>`;
    }).join('');
  } catch (err) {
    el.innerHTML = `<div style="color:var(--err);font-size:12px">Failed to load: ${escHtml(err.message)}</div>`;
  }
}

async function updateSubagentHb(agentId, partial) {
  try {
    await api(`/api/heartbeat/agents/${encodeURIComponent(agentId)}`, {
      method: 'PUT',
      body: JSON.stringify(partial),
    });
    addProcessEntry('info', `Heartbeat updated for "${agentId}".`);
    loadSubagentHeartbeatList().catch(() => {});
  } catch (err) {
    addProcessEntry('error', `Heartbeat update failed: ${err.message}`);
  }
}

async function tickSubagentHb(agentId) {
  try {
    await api(`/api/heartbeat/agents/${encodeURIComponent(agentId)}/tick`, { method: 'POST' });
    addProcessEntry('info', `Heartbeat tick triggered for "${agentId}".`);
    loadSubagentHeartbeatList().catch(() => {});
  } catch (err) {
    addProcessEntry('error', `Tick failed: ${err.message}`);
  }
}

// --- Per-agent heartbeat editor (Agents tab) ---------------------------------

function ensureAgentHbEditor() {
  if (agentHbEditor || typeof CodeMirror === 'undefined') return;
  const wrap = document.getElementById('agent-hb-editor-wrap');
  if (!wrap) return;
  agentHbEditor = CodeMirror(wrap, {
    value: '',
    mode: 'markdown',
    lineNumbers: true,
    lineWrapping: true,
    tabSize: 2,
    indentWithTabs: false,
    theme: 'default',
  });
  agentHbEditor.setSize('100%', 200);
  setTimeout(() => { if (agentHbEditor) agentHbEditor.refresh(); }, 200);
}

async function loadAgentHeartbeat() {
  if (!window.selectedAgentId) return;
  ensureAgentHbEditor();
  const statusEl = document.getElementById('agent-hb-status');
  try {
    // Load heartbeat config (enabled, interval)
    const cfgData = await api(`/api/heartbeat/agents/${encodeURIComponent(window.selectedAgentId)}`);
    const cfg = cfgData?.config || {};
    const enabledEl = document.getElementById('agent-hb-enabled');
    const intervalEl = document.getElementById('agent-hb-interval');
    if (enabledEl) enabledEl.checked = cfg.enabled === true;
    if (intervalEl) intervalEl.value = String(cfg.intervalMinutes || 30);
    // Load HEARTBEAT.md content
    const mdData = await api(`/api/agents/${encodeURIComponent(window.selectedAgentId)}/heartbeat-md`);
    if (agentHbEditor) {
      agentHbEditor.setValue(mdData?.content || '');
      agentHbEditor.refresh();
    }
    if (statusEl) statusEl.textContent = '';
  } catch (err) {
    if (statusEl) statusEl.textContent = `Load failed: ${err.message}`;
  }
}

async function saveAgentHeartbeatConfig() {
  if (!window.selectedAgentId) return;
  const enabledEl = document.getElementById('agent-hb-enabled');
  const intervalEl = document.getElementById('agent-hb-interval');
  const enabled = enabledEl ? enabledEl.checked : false;
  const interval_minutes = Math.max(1, Math.min(1440, Number(intervalEl?.value) || 30));
  try {
    await api(`/api/heartbeat/agents/${encodeURIComponent(window.selectedAgentId)}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled, interval_minutes }),
    });
    const statusEl = document.getElementById('agent-hb-status');
    if (statusEl) statusEl.textContent = 'Config saved.';
    setTimeout(() => { const s = document.getElementById('agent-hb-status'); if (s) s.textContent = ''; }, 2000);
  } catch (err) {
    const statusEl = document.getElementById('agent-hb-status');
    if (statusEl) statusEl.textContent = `Save failed: ${err.message}`;
  }
}

async function saveAgentHeartbeatMd() {
  if (!window.selectedAgentId || !agentHbEditor) return;
  const statusEl = document.getElementById('agent-hb-status');
  try {
    const content = agentHbEditor.getValue();
    await api(`/api/agents/${encodeURIComponent(window.selectedAgentId)}/heartbeat-md`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
    if (statusEl) statusEl.textContent = 'HEARTBEAT.md saved.';
    addProcessEntry('final', `Saved HEARTBEAT.md for "${window.selectedAgentId}".`);
    setTimeout(() => { const s = document.getElementById('agent-hb-status'); if (s) s.textContent = ''; }, 2000);
  } catch (err) {
    if (statusEl) statusEl.textContent = `Save failed: ${err.message}`;
  }
}

async function tickAgentHeartbeat() {
  if (!window.selectedAgentId) return;
  const statusEl = document.getElementById('agent-hb-status');
  try {
    await api(`/api/heartbeat/agents/${encodeURIComponent(window.selectedAgentId)}/tick`, { method: 'POST' });
    if (statusEl) statusEl.textContent = 'Heartbeat tick triggered.';
    addProcessEntry('info', `Heartbeat tick triggered for "${window.selectedAgentId}".`);
    setTimeout(() => { const s = document.getElementById('agent-hb-status'); if (s) s.textContent = ''; }, 3000);
  } catch (err) {
    if (statusEl) statusEl.textContent = `Tick failed: ${err.message}`;
  }
}

// --- Credentials Tab ---------------------------------------------------------

function applyCredentialFields(s = {}) {
  // Server returns '••••••••' if key is set, '' if not
  const setField = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = val || '';
    el.placeholder = val ? '••••••••  (key stored — enter new value to replace)' : el.getAttribute('data-placeholder') || '';
  };
  setField('cred-tinyfish-key', s.tinyfish_api_key);
  setField('cred-tavily-key',  s.tavily_api_key);
  setField('cred-google-key',  s.google_api_key);
  setField('cred-brave-key',   s.brave_api_key);
  const cxEl = document.getElementById('cred-google-cx');
  if (cxEl) {
    cxEl.value = s.google_cx || '';
    const labelEl = document.querySelector('label[for="cred-google-cx"]') || cxEl.previousElementSibling;
    if (labelEl?.tagName === 'LABEL') {
      const labelText = labelEl.querySelector('span:first-child');
      if (labelText) labelText.textContent = 'Google CSE ID';
    }
  }
}

function applyCredentialVaultStatus(data = {}) {
  const el = document.getElementById('cred-vault-status');
  if (!el) return;
  const keys = data.keys || [];
  if (!keys.length) {
    el.innerHTML = '<span style="color:var(--warn)">? No credentials stored yet.</span>';
    return;
  }
  el.innerHTML = keys.map(k => {
    const label = {
      'search.tavily_api_key':  'Tavily API Key',
      'search.tinyfish_api_key': 'TinyFish API Key',
      'search.google_api_key':  'Google API Key',
      'search.google_cx':       'Google CSE ID',
      'search.brave_api_key':   'Brave API Key',
      'llm.openai.api_key':     'OpenAI API Key',
      'hooks.token':            'Webhook Token',
      'channels.telegram.botToken': 'Telegram Token',
      'channels.discord.botToken':  'Discord Token',
    }[k] || k;
    return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
      <span style="color:var(--ok);font-size:13px">&#10003;</span>
      <span style="font-size:12px;color:var(--text)">${label}</span>
      <span style="font-size:10px;color:var(--muted);font-family:monospace">${k}</span>
    </div>`;
  }).join('');
}

function applyCredentialVaultLog(data = {}) {
  const el = document.getElementById('cred-vault-log');
  if (!el) return;
  const lines = (data.lines || []).slice(-18).reverse();
  if (!lines.length) {
    el.textContent = 'No audit entries yet.';
    return;
  }
  el.innerHTML = lines.map(l => {
    const safe = l.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const color = l.includes('SET') ? 'var(--ok)' : l.includes('GET') ? 'var(--brand)' : l.includes('DEL') ? 'var(--err)' : 'var(--muted)';
    return `<div style="color:${color};white-space:nowrap">${safe}</div>`;
  }).join('');
}

function loadCredentialsTab() {
  loadCredFields().catch(() => {});
}

async function loadCredFields() {
  window._settingsCredentialsLoadedToUI = false;
  const cached = _withSettingsCache({
    key: 'settings-credentials-fields',
    ttlMs: SETTINGS_DATA_CACHE_TTL_MS.credentialsFields,
    fetcher: () => api('/api/settings/search'),
  });
  if (cached.value) {
    applyCredentialFields(cached.value);
    window._settingsCredentialsLoadedToUI = true;
    if (!cached.refreshPromise) return;
    cached.refreshPromise.then((fresh) => {
      if (!fresh) return;
      applyCredentialFields(fresh);
    }).catch((e) => {
      console.warn('loadCredFields:', e);
    });
    return;
  }
  try {
    const s = await cached.refreshPromise;
    if (s) {
      applyCredentialFields(s);
      window._settingsCredentialsLoadedToUI = true;
    } else {
      window._settingsCredentialsLoadedToUI = false;
    }
  } catch(e) {
    window._settingsCredentialsLoadedToUI = false;
    console.warn('loadCredFields:', e);
  }
}

async function loadCredVaultStatus() {
  const cached = _withSettingsCache({
    key: 'settings-credentials-vault-status',
    ttlMs: SETTINGS_DATA_CACHE_TTL_MS.credentialsVaultStatus,
    fetcher: () => api('/api/credentials/status'),
  });
  if (cached.value) {
    applyCredentialVaultStatus(cached.value);
    if (!cached.refreshPromise) return;
    cached.refreshPromise.then((fresh) => applyCredentialVaultStatus(fresh || {})).catch(() => {});
    return;
  }
  try {
    const data = await cached.refreshPromise;
    applyCredentialVaultStatus(data || {});
  } catch(e) {
    const el = document.getElementById('cred-vault-status');
    if (el) el.innerHTML = `<span style="color:var(--err);font-size:12px">Could not load vault status: ${e.message}</span>`;
  }
}

async function loadCredVaultLog() {
  const cached = _withSettingsCache({
    key: 'settings-credentials-vault-log',
    ttlMs: SETTINGS_DATA_CACHE_TTL_MS.credentialsVaultLog,
    fetcher: () => api('/api/credentials/audit'),
  });
  if (cached.value) {
    applyCredentialVaultLog(cached.value);
    if (!cached.refreshPromise) return;
    cached.refreshPromise.then((fresh) => applyCredentialVaultLog(fresh || {})).catch(() => {});
    return;
  }
  try {
    const data = await cached.refreshPromise;
    applyCredentialVaultLog(data || {});
  } catch(e) {
    const el = document.getElementById('cred-vault-log');
    if (el) el.textContent = 'Could not load audit log.';
  }
}

function toggleCredVis(inputId, btn) {
  const el = document.getElementById(inputId);
  if (!el) return;
  const rehideTimerId = Number(btn?.dataset?.rehideTimerId || 0);
  if (rehideTimerId) {
    clearTimeout(rehideTimerId);
    delete btn.dataset.rehideTimerId;
  }
  if (el.type === 'password') {
    el.type = 'text';
    setCredentialToggleIcon(btn, true);
    // Auto-rehide after 8s
    const timerId = window.setTimeout(() => {
      el.type = 'password';
      setCredentialToggleIcon(btn, false);
      delete btn.dataset.rehideTimerId;
    }, 8000);
    if (btn) btn.dataset.rehideTimerId = String(timerId);
  } else {
    el.type = 'password';
    setCredentialToggleIcon(btn, false);
  }
}

// --- Provider-aware Model Settings ------------------------------------------

const BUILTIN_PROVIDER_IDS = ['ollama', 'llama_cpp', 'lm_studio', 'openai', 'openai_codex', 'anthropic', 'perplexity', 'gemini'];
const ACCOUNT_AWARE_PROVIDER_IDS = new Set(['openai', 'xai', 'openai_codex', 'anthropic']);
const BUILTIN_STATIC_MODEL_FALLBACKS = {
  openai: ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4-pro', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5-pro', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5-chat-latest', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o4-mini', 'o3', 'o1'],
  openai_codex: ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4-codex', 'gpt-5.4-codex-mini', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.3', 'gpt-5.2-codex', 'gpt-5.2', 'gpt-5.1-codex-max', 'gpt-5.1-codex-mini', 'gpt-5.1-codex', 'gpt-5.1'],
  anthropic: ['claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  perplexity: ['sonar-pro', 'sonar', 'sonar-reasoning-pro', 'sonar-reasoning', 'sonar-deep-research'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
};
let providerCatalogCache = null;
let providerCatalogPromise = null;

function providerSortRank(providerId) {
  const idx = BUILTIN_PROVIDER_IDS.indexOf(providerId);
  return idx >= 0 ? idx : BUILTIN_PROVIDER_IDS.length + 100;
}

function sanitizeProviderDomId(providerId) {
  return String(providerId || '').replace(/[^a-zA-Z0-9_-]/g, '-');
}

function getProviderPanelId(providerId) {
  if (BUILTIN_PROVIDER_IDS.includes(providerId)) return 'prov-fields-' + providerId;
  return 'prov-fields-dynamic-' + sanitizeProviderDomId(providerId);
}

function getProviderStatusElementId(providerId) {
  const builtins = {
    ollama: 'provider-status-msg',
    llama_cpp: 'provider-status-msg-llamacpp',
    lm_studio: 'provider-status-msg-lmstudio',
    openai: 'provider-status-msg-openai',
    openai_codex: 'codex-oauth-status',
    anthropic: 'anthropic-oauth-status',
    perplexity: 'provider-status-msg-perplexity',
    gemini: 'provider-status-msg-gemini',
  };
  return builtins[providerId] || `provider-status-msg-${sanitizeProviderDomId(providerId)}`;
}

function getProviderSettingsFieldId(providerId, fieldKey) {
  return `settings-provider-${sanitizeProviderDomId(providerId)}-${sanitizeProviderDomId(fieldKey)}`;
}

function getProviderAccountSelectId(providerId) {
  return `settings-provider-${sanitizeProviderDomId(providerId)}-account`;
}

function getProviderAccountLabelId(providerId) {
  return `settings-provider-${sanitizeProviderDomId(providerId)}-account-label`;
}

function getProviderCatalogItems() {
  return Array.isArray(providerCatalogCache) ? providerCatalogCache : [];
}

function getKnownProviderIds() {
  const items = getProviderCatalogItems();
  return items.length ? items.map(item => item.id) : [...BUILTIN_PROVIDER_IDS];
}

function getProviderCatalogItem(providerId) {
  return getProviderCatalogItems().find(item => item.id === providerId) || null;
}

function getProviderStaticModels(providerId) {
  return Array.isArray(getProviderCatalogItem(providerId)?.runtime?.options?.staticModels)
    ? [...getProviderCatalogItem(providerId).runtime.options.staticModels]
    : [];
}

function getProviderDefaultConfig(providerId) {
  const defaults = getProviderCatalogItem(providerId)?.config?.defaults;
  return defaults && typeof defaults === 'object' ? { ...defaults } : {};
}

function readProviderFieldElementValue(providerId, fieldKey) {
  const el = document.getElementById(getProviderSettingsFieldId(providerId, fieldKey));
  if (!el) return undefined;
  if (el.type === 'checkbox') return !!el.checked;
  return el.value;
}

function writeProviderFieldElementValue(providerId, fieldKey, value) {
  const el = document.getElementById(getProviderSettingsFieldId(providerId, fieldKey));
  if (!el) return;
  if (el.type === 'checkbox') {
    el.checked = !!value;
    return;
  }
  if (value !== undefined && value !== null) {
    el.value = String(value);
  }
}

function getProviderModelControl(providerId) {
  const builtinIds = {
    ollama: 'settings-primary-model',
    openai: 'settings-openai-model',
    openai_codex: 'settings-codex-model',
    anthropic: 'settings-anthropic-model',
    perplexity: 'settings-perplexity-model',
    gemini: 'settings-gemini-model',
    llama_cpp: 'settings-llamacpp-model',
    lm_studio: 'settings-lmstudio-model',
  };
  const builtinId = builtinIds[providerId];
  if (builtinId) return document.getElementById(builtinId);
  return document.getElementById(getProviderSettingsFieldId(providerId, 'model'));
}

function uniqueStrings(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [values])
    .map(value => String(value || '').trim())
    .filter(Boolean)));
}

function getSelectOptionValues(selectOrId) {
  const select = typeof selectOrId === 'string' ? document.getElementById(selectOrId) : selectOrId;
  if (!select || select.tagName !== 'SELECT') return [];
  return Array.from(select.options || []).map(option => String(option.value || '').trim()).filter(Boolean);
}

function ensureSelectOption(selectOrId, value) {
  const select = typeof selectOrId === 'string' ? document.getElementById(selectOrId) : selectOrId;
  const normalized = String(value || '').trim();
  if (!select || select.tagName !== 'SELECT' || !normalized) return;
  if (getSelectOptionValues(select).includes(normalized)) return;
  const option = document.createElement('option');
  option.value = normalized;
  const provider = select.id === 'settings-openai-model' ? 'openai'
    : select.id === 'settings-codex-model' ? 'openai_codex' : '';
  option.textContent = provider ? formatModelDisplayName(normalized, provider) : normalized;
  select.appendChild(option);
}

function getProviderSelectPlaceholder(selectId) {
  if (selectId === 'agent-edit-provider') return 'use effective default';
  if (selectId === 'amd-switch-model-low-prov' || selectId === 'amd-switch-model-medium-prov') return 'disabled';
  if (/^amd-subagent-.*-prov$/.test(selectId)) return 'inherit';
  if (/^amd-.*-prov$/.test(selectId)) return 'same as main agent';
  if (/^brain-.*-prov$/.test(selectId)) return 'use primary';
  return 'inherit / same as main agent';
}

function getProviderConfigFromCache(providerId) {
  const providers = window._llmSettingsCache?.providers && typeof window._llmSettingsCache.providers === 'object'
    ? window._llmSettingsCache.providers
    : {};
  return providers[providerId] && typeof providers[providerId] === 'object' ? providers[providerId] : {};
}

function normalizeProviderAccountsForUI(providerId, providerConfig) {
  const cfg = providerConfig && typeof providerConfig === 'object' ? providerConfig : {};
  const rawAccounts = cfg.accounts && typeof cfg.accounts === 'object' && !Array.isArray(cfg.accounts) ? cfg.accounts : null;
  const accounts = rawAccounts && Object.keys(rawAccounts).length ? rawAccounts : {
    default: {
      id: 'default',
      label: providerId === 'openai' ? 'OpenAI API account' : providerId === 'xai' ? 'xAI account' : providerId === 'anthropic' ? 'Claude account' : 'Codex account',
      authType: providerId === 'openai' || providerId === 'xai' ? (cfg.auth_mode || 'api_key') : providerId === 'anthropic' ? 'setup_token' : 'oauth',
      status: 'connected',
      ...(cfg.api_key ? { api_key: cfg.api_key } : {}),
    },
  };
  return Object.entries(accounts).map(([id, value]) => {
    const account = value && typeof value === 'object' ? value : {};
    return {
      ...account,
      id: String(account.id || id),
      label: String(account.label || id),
      authType: String(account.authType || account.auth_mode || cfg.auth_mode || (providerId === 'anthropic' ? 'setup_token' : providerId === 'openai_codex' ? 'oauth' : 'api_key')),
      status: String(account.status || 'connected'),
    };
  });
}

function getSelectedProviderAccountId(providerId) {
  const select = document.getElementById(getProviderAccountSelectId(providerId));
  return String(select?.value || getProviderConfigFromCache(providerId)?.defaultAccountId || 'default').trim() || 'default';
}

function getSelectedProviderAccount(providerId) {
  const selected = getSelectedProviderAccountId(providerId);
  return normalizeProviderAccountsForUI(providerId, getProviderConfigFromCache(providerId)).find(account => account.id === selected) || null;
}

function syncProviderAccountLabel(providerId) {
  const account = getSelectedProviderAccount(providerId);
  const label = document.getElementById(getProviderAccountLabelId(providerId));
  if (label && account) label.value = account.label || account.id;
}

function syncXaiAuthModeVisibility() {
  const mode = String(document.getElementById(getProviderSettingsFieldId('xai', 'auth_mode'))?.value || 'api_key').trim() || 'api_key';
  const apiWrap = document.getElementById('xai-api-key-auth-panel');
  const oauthWrap = document.getElementById('xai-oauth-auth-panel');
  if (apiWrap) apiWrap.style.display = mode === 'api_key' ? 'block' : 'none';
  if (oauthWrap) oauthWrap.style.display = mode === 'oauth' ? 'block' : 'none';
}

function onProviderAccountChange(providerId) {
  syncProviderAccountLabel(providerId);
  const account = getSelectedProviderAccount(providerId);
  if (providerId === 'xai' && account) {
    writeProviderFieldElementValue('xai', 'auth_mode', account.authType === 'oauth' ? 'oauth' : 'api_key');
    writeProviderFieldElementValue('xai', 'api_key', account.api_key || '');
    syncXaiAuthModeVisibility();
    refreshXaiStatus().catch(() => {});
  } else if (providerId === 'openai' && account) {
    const apiKey = document.getElementById('settings-openai-key');
    if (apiKey) apiKey.value = account.api_key || '';
  } else if (providerId === 'openai_codex') {
    refreshCodexStatus().catch(() => {});
  } else if (providerId === 'anthropic') {
    refreshAnthropicStatus().catch(() => {});
  }
}

function addProviderAccount(providerId) {
  const cache = window._llmSettingsCache || { provider: providerId, providers: {} };
  cache.providers = cache.providers || {};
  const cfg = cache.providers[providerId] && typeof cache.providers[providerId] === 'object' ? cache.providers[providerId] : {};
  const accounts = {};
  for (const account of normalizeProviderAccountsForUI(providerId, cfg)) accounts[account.id] = account;
  const id = `${providerId}_${Date.now().toString(36)}`;
  accounts[id] = {
    id,
    label: providerId === 'openai' ? 'New OpenAI API account' : providerId === 'xai' ? 'New xAI account' : providerId === 'anthropic' ? 'New Claude account' : 'New Codex account',
    authType: providerId === 'openai' || providerId === 'xai' ? 'api_key' : providerId === 'anthropic' ? 'setup_token' : 'oauth',
    status: 'disconnected',
  };
  cache.providers[providerId] = { ...cfg, accounts, defaultAccountId: id };
  if (cache.provider === providerId) cache.accountId = id;
  window._llmSettingsCache = cache;
  renderDynamicProviderPanels();
  hydrateBuiltInProviderAccountControls();
  applyDynamicProviderConfig(providerId, cache.providers[providerId]);
  setVisibleProviderPanel(providerId);
  const select = document.getElementById(getProviderAccountSelectId(providerId));
  if (select) select.value = id;
  onProviderAccountChange(providerId);
}

function renderProviderAccountControls(provider) {
  if (!ACCOUNT_AWARE_PROVIDER_IDS.has(provider.id)) return '';
  const cfg = getProviderConfigFromCache(provider.id);
  const accounts = normalizeProviderAccountsForUI(provider.id, cfg);
  const selected = String(cfg.defaultAccountId || accounts[0]?.id || 'default');
  const options = accounts.map(account => `<option value="${escHtml(account.id)}"${account.id === selected ? ' selected' : ''}>${escHtml(account.label || account.id)}</option>`).join('');
  return `<div class="settings-provider-account-panel" style="margin:10px 0 12px;padding:10px;border:1px solid var(--line);border-radius:10px;background:var(--panel-2)">
    <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;align-items:end">
      <label style="display:block;font-size:12px;color:var(--muted)">Account<select id="${getProviderAccountSelectId(provider.id)}" class="settings-input" onchange="onProviderAccountChange('${provider.id}')" style="margin-top:6px;font-size:13px">${options}</select></label>
      <label style="display:block;font-size:12px;color:var(--muted)">Name<input id="${getProviderAccountLabelId(provider.id)}" class="settings-input" value="${escHtml(accounts.find(a => a.id === selected)?.label || selected)}" placeholder="Account name" style="margin-top:6px;font-size:13px" /></label>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
      <button class="btn btn-sm" onclick="addProviderAccount('${provider.id}')" style="background:#fff;border:1px solid var(--line);color:var(--text)">Add Account</button>
    </div>
    <div style="margin-top:7px;font-size:11px;color:var(--muted)">The selected account becomes active for this provider when you save Settings.</div>
  </div>`;
}

function setProviderStatusMessage(providerId, type, text) {
  setSettingsStatus(document.getElementById(getProviderStatusElementId(providerId)), type, text);
}

function normalizeModelList(models) {
  return uniqueStrings((Array.isArray(models) ? models : []).map(model => (
    typeof model === 'string' ? model : (model?.name || String(model || ''))
  )));
}

function getProviderModelFallbacks(providerId) {
  return uniqueStrings([...(BUILTIN_STATIC_MODEL_FALLBACKS[providerId] || []), ...getProviderStaticModels(providerId)]);
}

function applyDynamicProviderConfig(providerId, providerConfig) {
  const provider = getProviderCatalogItem(providerId);
  const fields = Array.isArray(provider?.setup?.fields) ? provider.setup.fields : [];
  if (!fields.length) return;
  const merged = {
    ...getProviderDefaultConfig(providerId),
    ...((providerConfig && typeof providerConfig === 'object') ? providerConfig : {}),
  };
  if (ACCOUNT_AWARE_PROVIDER_IDS.has(providerId)) {
    const accounts = normalizeProviderAccountsForUI(providerId, providerConfig || {});
    const selected = String(providerConfig?.defaultAccountId || accounts[0]?.id || '').trim();
    const select = document.getElementById(getProviderAccountSelectId(providerId));
    if (select && selected) select.value = selected;
    const account = accounts.find(item => item.id === selected) || accounts[0];
    if (account) {
      if (providerId === 'xai') {
        merged.auth_mode = account.authType === 'oauth' ? 'oauth' : 'api_key';
        if (account.api_key) merged.api_key = account.api_key;
      } else if (providerId === 'openai' && account.api_key) {
        merged.api_key = account.api_key;
      }
      syncProviderAccountLabel(providerId);
    }
  }
  for (const field of fields) {
    const control = document.getElementById(getProviderSettingsFieldId(providerId, field.key));
    if (!control) continue;
    if (field.key === 'model' && control.tagName === 'SELECT') ensureSelectOption(control, merged[field.key]);
    writeProviderFieldElementValue(providerId, field.key, merged[field.key]);
  }
  if (providerId === 'xai') syncXaiAuthModeVisibility();
}

function collectDynamicProviderConfig(providerId, activeProviderId) {
  const provider = getProviderCatalogItem(providerId);
  const fields = Array.isArray(provider?.setup?.fields) ? provider.setup.fields : [];
  if (!fields.length) return null;

  const defaults = getProviderDefaultConfig(providerId);
  const savedProviders = window._llmSettingsCache?.providers && typeof window._llmSettingsCache.providers === 'object'
    ? window._llmSettingsCache.providers
    : {};
  const savedConfig = savedProviders[providerId] && typeof savedProviders[providerId] === 'object'
    ? savedProviders[providerId]
    : null;
  const hasSavedConfig = !!(savedConfig && Object.keys(savedConfig).length);

  let hasNonDefaultValue = false;
  for (const field of fields) {
    const rawValue = readProviderFieldElementValue(providerId, field.key);
    if (field.input === 'checkbox') {
      const normalized = !!rawValue;
      const baseline = savedConfig?.[field.key] ?? defaults[field.key] ?? false;
      if (normalized !== !!baseline) hasNonDefaultValue = true;
      continue;
    }
    const normalized = String(rawValue || '').trim();
    const baseline = String(savedConfig?.[field.key] ?? defaults[field.key] ?? '').trim();
    if (normalized !== baseline && (normalized || baseline)) hasNonDefaultValue = true;
  }

  const shouldInclude = providerId === activeProviderId || hasSavedConfig || hasNonDefaultValue;
  if (!shouldInclude) return null;

  const config = {};
  for (const field of fields) {
    const rawValue = readProviderFieldElementValue(providerId, field.key);
    if (field.input === 'checkbox') {
      config[field.key] = !!rawValue;
      continue;
    }
    const normalized = String(rawValue || '').trim();
    if (normalized) {
      config[field.key] = normalized;
    } else if (field.secret) {
      config[field.key] = '';
    } else if (Object.prototype.hasOwnProperty.call(defaults, field.key)) {
      config[field.key] = defaults[field.key];
    } else {
      config[field.key] = '';
    }
  }
  return config;
}

async function fetchProviderModelsForPicker(providerId, options = {}) {
  const {
    refreshOpenAI = true,
    includeLive = true,
  } = options;

  let models = uniqueStrings([...getProviderModelFallbacks(providerId), ...getProviderModelsFromUI(providerId)]);

  if (providerId === 'openai' && refreshOpenAI) {
    try {
      await refreshOpenAIModels(true);
      models = uniqueStrings([...models, ...getProviderModelsFromUI(providerId)]);
    } catch {}
  }

  // Codex OAuth and OpenAI API-key catalogs are separate products. The generic
  // model-test endpoint can reflect the active OpenAI API config, so never merge
  // that response into an openai_codex picker.
  if (includeLive && providerId !== 'openai_codex') {
    try {
      const llm = buildProviderPayload();
      llm.provider = providerId;
      const data = await api('/api/models/test', { method: 'POST', body: JSON.stringify({ llm }) });
      models = uniqueStrings([...models, ...normalizeModelList(data?.models)]);
    } catch {}
  }

  return models;
}

function setProviderModelOptions(providerId, models) {
  const control = getProviderModelControl(providerId);
  if (!control || !Array.isArray(models) || !models.length) return;
  const unique = Array.from(new Set(models.map(v => String(v || '').trim()).filter(Boolean)));
  if (!unique.length) return;
  const current = String(control.value || '').trim();
  if (control.tagName === 'SELECT') {
    control.innerHTML = unique.map(m => `<option value="${escHtml(m)}">${escHtml(formatModelDisplayName(m, providerId))}</option>`).join('');
    if (current && unique.includes(current)) control.value = current;
    else control.value = unique[0];
  } else if (!current) {
    control.value = unique[0];
  }
}

function getProviderModelsFromUI(providerId) {
  const control = getProviderModelControl(providerId);
  const controlModels = control?.tagName === 'SELECT'
    ? Array.from(control.options || []).map(o => o.value).filter(Boolean)
    : (control?.value ? [String(control.value).trim()] : []);
  return uniqueStrings([...getProviderStaticModels(providerId), ...controlModels]);
}

function renderProviderField(provider, field) {
  const fieldId = getProviderSettingsFieldId(provider.id, field.key);
  const staticModels = field.key === 'model' ? getProviderStaticModels(provider.id) : [];
  const help = field.help || provider.config?.uiHints?.[field.key]?.help || '';
  const label = escHtml(field.label || field.key);
  const helpHtml = help
    ? `<div style="font-size:11px;color:var(--muted);margin-top:6px;line-height:1.5">${escHtml(help)}</div>`
    : '';
  if (field.key === 'model' && staticModels.length) {
    return `<label style="display:block;font-size:12px;color:var(--muted);margin:10px 0 6px">${label}</label><select id="${fieldId}" class="settings-input" style="font-size:13px">${staticModels.map(model => `<option value="${escHtml(model)}">${escHtml(formatModelDisplayName(model, provider.id))}</option>`).join('')}</select>${helpHtml}`;
  }
  if (field.input === 'textarea') {
    return `<label style="display:block;font-size:12px;color:var(--muted);margin:10px 0 6px">${label}</label><textarea id="${fieldId}" style="width:100%;min-height:90px;border:1px solid var(--line);border-radius:10px;padding:8px;font-size:12px;font-family:'IBM Plex Mono',monospace"></textarea>${helpHtml}`;
  }
  if (field.input === 'checkbox') {
    return `<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text);margin-top:10px;cursor:pointer"><input id="${fieldId}" type="checkbox" /><span>${label}</span></label>${helpHtml}`;
  }
  if (field.input === 'select' && Array.isArray(field.options) && field.options.length) {
    return `<label style="display:block;font-size:12px;color:var(--muted);margin:10px 0 6px">${label}</label><select id="${fieldId}" class="settings-input" style="font-size:13px">${field.options.map(option => `<option value="${escHtml(option)}">${escHtml(option || 'Provider Default')}</option>`).join('')}</select>${helpHtml}`;
  }
  const inputType = field.input === 'password' ? 'password' : 'text';
  const placeholder = field.placeholder ? ` placeholder="${escHtml(field.placeholder)}"` : '';
  return `<label style="display:block;font-size:12px;color:var(--muted);margin:10px 0 6px">${label}</label><input id="${fieldId}" type="${inputType}"${placeholder} style="width:100%;border:1px solid var(--line);border-radius:10px;padding:8px;font-size:12px;font-family:'IBM Plex Mono',monospace" />${helpHtml}`;
}

function renderDynamicProviderPanel(provider) {
  const panelId = getProviderPanelId(provider.id);
  const statusId = getProviderStatusElementId(provider.id);
  const fields = Array.isArray(provider.setup?.fields) ? provider.setup.fields : [];
  const description = provider.description
    ? `<div style="font-size:12px;color:var(--muted);margin-bottom:10px;line-height:1.6">${escHtml(provider.description)}</div>`
    : '';
  const refreshButton = provider.runtime?.options?.supportsLiveModelDiscovery
    ? `<button class="btn btn-sm" onclick="refreshProviderModels('${provider.id}')" style="background:#fff;border:1px solid var(--line);color:var(--text)">Refresh Models</button>`
    : '';
  const xaiAuthModeField = provider.id === 'xai'
    ? renderProviderField(provider, fields.find(field => field.key === 'auth_mode') || {
        key: 'auth_mode',
        label: 'Auth Mode',
        input: 'select',
        options: ['api_key', 'oauth'],
        help: 'Choose API key billing or Grok account OAuth for the selected account.',
      }).replace('<select ', '<select onchange="syncXaiAuthModeVisibility()" ')
    : '';
  const xaiApiKeyPanel = provider.id === 'xai'
    ? `<div id="xai-api-key-auth-panel">${renderProviderField(provider, fields.find(field => field.key === 'api_key') || {
        key: 'api_key',
        label: 'API Key',
        input: 'password',
        placeholder: 'xai-...',
        help: 'Stored only for the selected xAI account.',
      })}</div>`
    : '';
  const xaiOAuthPanel = provider.id === 'xai'
    ? `<div id="xai-oauth-auth-panel" style="margin:12px 0;padding:10px;border:1px solid var(--line);border-radius:10px;background:var(--panel-2)">
        <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:4px">Grok account OAuth</div>
        <div style="font-size:11px;color:var(--muted);line-height:1.5;margin-bottom:8px">Connect your Grok/X account for the selected account. xAI still decides whether X Premium, Premium+, or SuperGrok can use each endpoint.</div>
        <div id="xai-oauth-disconnected-state" style="display:block">
          <button class="btn btn-sm" onclick="startXaiOAuth()" style="background:#111827;color:#fff;border:1px solid #111827">Connect xAI OAuth</button>
        </div>
        <div style="display:flex;gap:6px;margin-top:8px">
          <input id="xai-oauth-manual-code" class="settings-input" placeholder="Paste xAI code if the browser cannot reach Prometheus" style="font-size:12px;min-width:0" />
          <button class="btn btn-sm" onclick="submitXaiOAuthCode()" style="background:#fff;border:1px solid var(--line);color:var(--text);white-space:nowrap">Submit Code</button>
        </div>
        <div id="xai-oauth-connected-state" style="display:none">
          <div id="xai-oauth-account-id" style="font-size:12px;color:var(--success);margin-bottom:8px">xAI OAuth connected</div>
          <button class="btn btn-sm" onclick="disconnectXaiOAuth()" style="background:#fff;border:1px solid var(--line);color:var(--text)">Disconnect xAI OAuth</button>
        </div>
        <div id="xai-oauth-status" style="font-size:11px;color:var(--muted);margin-top:6px"></div>
      </div>`
    : '';
  const xApiOAuthPanel = provider.id === 'x'
    ? `<div style="margin:12px 0;padding:10px;border:1px solid var(--line);border-radius:10px;background:var(--panel-2)">
        <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:4px">Official X API OAuth</div>
        <div style="font-size:11px;color:var(--muted);line-height:1.5;margin-bottom:8px">X API/xurl tools require an X Developer app and OAuth 2.0 user context. xAI/Grok OAuth stays separate for models, x_search, TTS, and STT.</div>
        <div style="display:grid;gap:6px;margin-bottom:8px">
          <input id="x-api-client-id" class="settings-input" placeholder="OAuth 2.0 Client ID, not API Key / Consumer Key" style="font-size:12px" />
          <input id="x-api-client-secret" class="settings-input" placeholder="OAuth 2.0 Client Secret, not API Secret Key" type="password" style="font-size:12px" />
          <input id="x-api-redirect-uri" class="settings-input" placeholder="http://localhost:8080/callback" style="font-size:12px" />
          <input id="x-api-scopes" class="settings-input" placeholder="tweet.read users.read follows.read like.read bookmark.read offline.access" style="font-size:12px" />
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-sm" onclick="saveXApiCredentials()" style="background:#fff;border:1px solid var(--line);color:var(--text)">Save App</button>
          <button class="btn btn-sm" onclick="startXApiOAuth()" style="background:#111827;color:#fff;border:1px solid #111827">Connect X API OAuth</button>
          <button class="btn btn-sm" onclick="disconnectXApiOAuth()" style="background:#fff;border:1px solid var(--line);color:var(--text)">Disconnect</button>
        </div>
        <div style="display:flex;gap:6px;margin-top:8px">
          <input id="x-api-manual-code" class="settings-input" placeholder="Paste X OAuth code if callback cannot reach Prometheus" style="font-size:12px;min-width:0" />
          <button class="btn btn-sm" onclick="submitXApiOAuthCode()" style="background:#fff;border:1px solid var(--line);color:var(--text);white-space:nowrap">Submit Code</button>
        </div>
        <div id="x-api-oauth-account-id" style="font-size:12px;color:var(--success);margin-top:8px"></div>
        <div id="x-api-oauth-status" style="font-size:11px;color:var(--muted);margin-top:6px"></div>
      </div>`
    : '';
  const visibleFields = provider.id === 'xai'
    ? fields.filter(field => field.key !== 'auth_mode' && field.key !== 'api_key')
    : fields;
  return `<div id="${panelId}" style="display:none"><div class="right-section-title" style="margin-bottom:8px">${escHtml(provider.name)}</div>${description}${renderProviderAccountControls(provider)}${xaiAuthModeField}${xaiApiKeyPanel}${xaiOAuthPanel}${xApiOAuthPanel}${visibleFields.map(field => renderProviderField(provider, field)).join('')}<div style="display:flex;gap:8px;margin-top:10px">${refreshButton}<button class="btn btn-sm" onclick="testProviderConnection('${provider.id}')" style="background:#fff;border:1px solid var(--line);color:var(--text)">Test Connection</button></div><div id="${statusId}" style="font-size:11px;color:var(--muted);margin-top:6px"></div></div>`;
}

function renderProviderSelectors() {
  const providers = getProviderCatalogItems();
  if (!providers.length) return;
  const providerOptionsHtml = providers.map(provider => `<option value="${escHtml(provider.id)}">${escHtml(provider.name)}</option>`).join('');
  const primarySelect = document.getElementById('settings-llm-provider');
  if (primarySelect) {
    const current = primarySelect.value;
    primarySelect.innerHTML = providerOptionsHtml;
    if (current && providers.some(provider => provider.id === current)) primarySelect.value = current;
  }
  const sharedSelects = [
    document.getElementById('agent-edit-provider'),
    ...document.querySelectorAll('select[id^="amd-"][id$="-prov"]'),
    ...document.querySelectorAll('select[id^="brain-"][id$="-prov"]'),
    ...document.querySelectorAll('select[id^="goal-"][id$="-prov"]'),
  ].filter(Boolean);
  const credentialedProviders = filterCredentialedProviderCatalogItems(providers);
  sharedSelects.forEach((select) => {
    const current = select.value;
    const placeholder = getProviderSelectPlaceholder(select.id);
    const providerOptions = credentialedProviders.map(provider => (
      `<option value="${escHtml(provider.id)}">${escHtml(provider.name)}</option>`
    )).join('');
    const emptyState = credentialedProviders.length
      ? ''
      : '<option value="" disabled>No connected model providers</option>';
    select.innerHTML = `<option value="">- ${escHtml(placeholder)} -</option>${providerOptions}${emptyState}`;
    if (current && credentialedProviders.some(provider => provider.id === current)) select.value = current;
  });
}

function renderDynamicProviderPanels() {
  const host = document.getElementById('prov-fields-dynamic');
  if (!host) return;
  const dynamicProviders = getProviderCatalogItems().filter(provider => !BUILTIN_PROVIDER_IDS.includes(provider.id));
  host.innerHTML = dynamicProviders.map(provider => renderDynamicProviderPanel(provider)).join('');
}

function setVisibleProviderPanel(providerId) {
  const provider = String(providerId || '').trim();
  const select = document.getElementById('settings-llm-provider');
  if (select && provider) select.value = provider;
  getKnownProviderIds().forEach(id => {
    const el = document.getElementById(getProviderPanelId(id));
    if (el) el.style.display = id === provider ? 'block' : 'none';
  });
}

function syncProviderStateSummary(providerOverride) {
  const provider = String(providerOverride || document.getElementById('settings-llm-provider')?.value || '').trim();
  const modelIds = {
    ollama: 'settings-primary-model',
    llama_cpp: 'settings-llamacpp-model',
    lm_studio: 'settings-lmstudio-model',
    openai: 'settings-openai-model',
    openai_codex: 'settings-codex-model',
    anthropic: 'settings-anthropic-model',
    perplexity: 'settings-perplexity-model',
    gemini: 'settings-gemini-model',
  };
  const effortIds = {
    openai: 'settings-openai-effort',
    openai_codex: 'settings-codex-effort',
    anthropic: 'settings-anthropic-effort',
    perplexity: 'settings-perplexity-effort',
  };
  const model = String(document.getElementById(modelIds[provider])?.value || '').trim();
  const rawEffort = String(document.getElementById(effortIds[provider])?.value || '').trim();
  const speed = String(document.getElementById(
    provider === 'openai_codex' ? 'settings-codex-speed' : 'settings-' + provider + '-speed'
  )?.value || 'standard').trim();
  const effort = rawEffort && validEffort(provider, model, rawEffort) ? rawEffort : '';
  const modelEl = document.getElementById('settings-provider-state-model');
  const reasoningEl = document.getElementById('settings-provider-state-reasoning');
  const speedEl = document.getElementById('settings-provider-state-speed');
  if (modelEl) modelEl.textContent = model ? formatModelDisplayName(model, provider) : 'Provider default';
  if (reasoningEl) reasoningEl.textContent = effort || 'Provider default';
  if (speedEl) speedEl.textContent = speed === 'fast' && supportsFastSpeed(provider, model) ? 'Fast' : 'Standard';
}

function hydrateBuiltInProviderAccountControls() {
  for (const providerId of ['openai', 'openai_codex', 'anthropic']) {
    const panel = document.getElementById(getProviderPanelId(providerId));
    if (!panel) continue;
    panel.querySelector('.settings-provider-account-panel')?.remove();
    const provider = getProviderCatalogItem(providerId) || { id: providerId, name: providerId };
    const wrapper = document.createElement('div');
    wrapper.innerHTML = renderProviderAccountControls(provider);
    const control = wrapper.firstElementChild;
    if (!control) continue;
    const anchor = panel.querySelector('.right-section-title');
    if (anchor?.nextSibling) panel.insertBefore(control, anchor.nextSibling);
    else panel.insertBefore(control, panel.firstChild);
  }
}

async function ensureProviderCatalogUIReady() {
  if (providerCatalogCache) return providerCatalogCache;
  if (!providerCatalogPromise) {
    providerCatalogPromise = Promise.all([
      api('/api/extensions/catalog?kind=provider'),
      fetchCredentialedModelProviderIds(),
    ])
      .then(([data]) => {
        const items = Array.isArray(data?.items) ? [...data.items] : [];
        items.sort((a, b) => {
          const rankDiff = providerSortRank(a.id) - providerSortRank(b.id);
          if (rankDiff !== 0) return rankDiff;
          return String(a.name || a.id).localeCompare(String(b.name || b.id));
        });
        providerCatalogCache = items;
        renderProviderSelectors();
        renderDynamicProviderPanels();
        hydrateBuiltInProviderAccountControls();
        return items;
      })
      .catch((err) => {
        console.warn('Failed to load provider catalog:', err);
        providerCatalogCache = BUILTIN_PROVIDER_IDS.map(id => ({ id, name: id, setup: {}, runtime: {}, config: {} }));
        renderProviderSelectors();
        renderDynamicProviderPanels();
        hydrateBuiltInProviderAccountControls();
        return providerCatalogCache;
      });
  }
  return providerCatalogPromise;
}

function onProviderChange() {
  const provider = document.getElementById('settings-llm-provider').value;
  setVisibleProviderPanel(provider);
  syncProviderStateSummary(provider);
  if (provider === 'openai') {
    refreshOpenAIModels(true).catch(() => {});
  } else if (provider === 'anthropic') {
    refreshAnthropicStatus().catch(() => {});
  } else if (provider !== 'openai_codex') {
    refreshProviderModels(provider).catch(() => {});
  }
  if (typeof renderModelsUsage === 'function') renderModelsUsage();
}

async function refreshCredentialedRoutingProviderChoices() {
  await fetchCredentialedModelProviderIds(true);
  renderProviderSelectors();
}

function scheduleModelStatusRefresh(prov) {
  if (_pendingModelStatusProbeTimer) return;
  _pendingModelStatusProbeTimer = setTimeout(() => {
    _pendingModelStatusProbeTimer = null;
    if (document?.visibilityState === 'hidden') return;
    if (window.settingsTab !== 'models') return;
    Promise.allSettled([
      refreshCodexStatus(),
      refreshAnthropicStatus(),
      refreshXaiStatus(),
      prov === 'openai' ? refreshOpenAIModels(true) : Promise.resolve(),
    ]).catch(() => {});
  }, 120);
}

async function loadModelSettings() {
  ensureModelsSections();
  window._llmSettingsLoadedToUI = false;
  const providerBoot = ensureProviderCatalogUIReady()
    .then(() => fetchCredentialedModelProviderIds(true))
    .then(() => ({ ok: true }))
    .catch(() => ({ ok: false }));

  const loadFromApi = () => api('/api/settings/provider', { timeoutMs: 8000 });
  const cached = _withSettingsCache({
    key: 'settings-models',
    ttlMs: SETTINGS_DATA_CACHE_TTL_MS.modelSettings,
    fetcher: loadFromApi,
  });

  const applyModelPayload = async (payload) => {
    try {
      const llm = payload?.llm || { provider: 'ollama', providers: {} };
      const prov = llm.provider || 'ollama';
      window._llmSettingsCache = llm;
      renderProviderSelectors();
      renderDynamicProviderPanels();
      hydrateBuiltInProviderAccountControls();
      const provSel = document.getElementById('settings-llm-provider');
      if (provSel) provSel.value = prov;

      const pc = llm.providers || {};
      const v = (id, val) => {
        const el = document.getElementById(id);
        if (el && val) el.value = val;
      };

      v('settings-ollama-endpoint',  pc.ollama?.endpoint);
      const primaryModelSel = document.getElementById('settings-primary-model');
      const savedOllamaModel = String(pc.ollama?.model || '').trim();
      if (primaryModelSel) {
        primaryModelSel.dataset.savedValue = savedOllamaModel;
        if (savedOllamaModel && !Array.from(primaryModelSel.options || []).find(o => o.value === savedOllamaModel)) {
          primaryModelSel.innerHTML = `<option value="${escHtml(savedOllamaModel)}">${escHtml(savedOllamaModel)}</option>${primaryModelSel.innerHTML}`;
        }
        if (savedOllamaModel) primaryModelSel.value = savedOllamaModel;
      }
      v('settings-llamacpp-endpoint', pc.llama_cpp?.endpoint);
      v('settings-llamacpp-model',    pc.llama_cpp?.model);
      v('settings-lmstudio-endpoint', pc.lm_studio?.endpoint);
      v('settings-lmstudio-model',    pc.lm_studio?.model);
      v('settings-openai-key',        pc.openai?.api_key);
      relabelModelSelect(document.getElementById('settings-openai-model'), 'openai');
      relabelModelSelect(document.getElementById('settings-codex-model'), 'openai_codex');
      if (pc.openai?.model) { const s = document.getElementById('settings-openai-model'); if (s) s.value = pc.openai.model; }
      { const s = document.getElementById('settings-openai-effort'); if (s) s.value = pc.openai?.reasoning_effort || ''; }
      { const s = document.getElementById('settings-openai-speed'); if (s) s.value = pc.openai?.speed || (pc.openai?.fast_mode ? 'fast' : 'standard'); }
      { const s = document.getElementById('settings-openai-tool-choice'); if (s) s.value = 'auto'; }
      if (pc.openai_codex?.model) { const s = document.getElementById('settings-codex-model'); if (s) s.value = pc.openai_codex.model; }
      { const s = document.getElementById('settings-codex-effort'); if (s) s.value = pc.openai_codex?.reasoning_effort || ''; }
      { const s = document.getElementById('settings-codex-speed'); if (s) s.value = pc.openai_codex?.speed || (pc.openai_codex?.fast_mode ? 'fast' : 'standard'); }
      { const s = document.getElementById('settings-codex-tool-choice'); if (s) s.value = pc.openai_codex?.tool_choice || 'auto'; }
      if (pc.anthropic?.model) { const s = document.getElementById('settings-anthropic-model'); if (s) s.value = pc.anthropic.model; }
      { const s = document.getElementById('settings-anthropic-effort'); if (s) s.value = pc.anthropic?.reasoning_effort || ''; }
      v('settings-perplexity-key',    pc.perplexity?.api_key);
      if (pc.perplexity?.model) { const s = document.getElementById('settings-perplexity-model'); if (s) s.value = pc.perplexity.model; }
      { const s = document.getElementById('settings-perplexity-effort'); if (s) s.value = pc.perplexity?.reasoning_effort || ''; }
      v('settings-gemini-key',        pc.gemini?.api_key);
      if (pc.gemini?.model) { const s = document.getElementById('settings-gemini-model'); if (s) s.value = pc.gemini.model; }

      if (pc.anthropic) {
        const chk = document.getElementById('settings-anthropic-extended-thinking');
        if (chk) {
          chk.checked = !!pc.anthropic.extended_thinking;
          const row = document.getElementById('anthropic-thinking-budget-row');
          if (row) row.style.display = chk.checked ? 'block' : 'none';
        }
        if (pc.anthropic.thinking_budget) {
          const sel = document.getElementById('settings-anthropic-thinking-budget');
          if (sel) sel.value = String(pc.anthropic.thinking_budget);
        }
        const speedSel = document.getElementById('settings-anthropic-speed');
        if (speedSel) speedSel.value = pc.anthropic.speed || (pc.anthropic.fast_mode ? 'fast' : 'standard');
        syncAnthropicReasoningControls();
      }

      getProviderCatalogItems()
        .filter(item => !BUILTIN_PROVIDER_IDS.includes(item.id))
        .forEach(item => applyDynamicProviderConfig(item.id, pc[item.id]));

      window._llmSettingsLoadedToUI = true;
      setTimeout(() => onProviderChange(), 0);
      if (typeof window.applyReasoningPrefsFromProviderConfig === 'function') {
        window.applyReasoningPrefsFromProviderConfig(llm, prov);
      }
      window.syncProviderReasoningControls?.('openai');
      window.syncProviderReasoningControls?.('openai_codex');
      window.syncProviderReasoningControls?.('anthropic');
      syncProviderStateSummary(prov);

      Promise.allSettled([
        loadAgentModelDefaults(),
        loadBrainModelConfig(),
        loadSessionCompactionSettings(),
      ]).then(() => { renderModelsUsage(); }).catch(() => {});
      scheduleModelStatusRefresh(prov);
    } catch (e) {
      console.warn('loadModelSettings apply failed:', e);
      window._llmSettingsLoadedToUI = false;
    }
  };

  await providerBoot;

  if (cached.value) {
    await applyModelPayload(cached.value);
    scheduleModelStatusRefresh(cached.value?.llm?.provider || 'ollama');
    if (cached.refreshPromise) {
      cached.refreshPromise.then((fresh) => {
        if (fresh) {
          applyModelPayload(fresh);
          scheduleModelStatusRefresh(fresh?.llm?.provider || 'ollama');
        }
      }).catch((e) => {
        console.warn('loadModelSettings refresh failed:', e);
      });
    }
    return;
  }

  const fresh = await cached.refreshPromise;
  if (fresh) {
    await applyModelPayload(fresh);
    scheduleModelStatusRefresh(fresh?.llm?.provider || 'ollama');
  }
}

// ─── Models tab: per-provider usage & limits ──────────────────────────────────
const MODELS_USAGE_LABELS = {
  ollama: 'Ollama (local)', llama_cpp: 'llama.cpp (local)', lm_studio: 'LM Studio (local)',
  openai: 'OpenAI', openai_codex: 'OpenAI · ChatGPT / Codex', anthropic: 'Anthropic · Claude',
  perplexity: 'Perplexity', gemini: 'Google · Gemini', xai: 'xAI · Grok',
};
const MODELS_USAGE_LOCAL = new Set(['ollama', 'llama_cpp', 'lm_studio']);

// Collect the distinct providers in active use: the main chat provider plus any
// provider explicitly assigned to an agent-model-default or brain-system slot.
function collectInUseProviders() {
  const ids = [];
  const seen = new Set();
  const push = (raw) => {
    const id = String(raw || '').trim();
    if (id && !seen.has(id)) { seen.add(id); ids.push(id); }
  };
  // The left connection editor is intentionally excluded: browsing a provider
  // there must not make usage/routing UI treat it as the active main model.
  const main = document.getElementById('amd-main-chat-prov');
  if (main && main.value) push(main.value);
  else push(window._llmSettingsCache?.provider);
  document.querySelectorAll('select[id^="amd-"][id$="-prov"]').forEach(s => { if (s.value) push(s.value); });
  document.querySelectorAll('select[id^="brain-"][id$="-prov"]').forEach(s => { if (s.value) push(s.value); });
  document.querySelectorAll('select[id^="goal-"][id$="-prov"]').forEach(s => { if (s.value) push(s.value); });
  return ids;
}

async function renderModelsUsage() {
  const wrap = document.getElementById('settings-models-usage');
  const grid = document.getElementById('settings-models-usage-grid');
  if (!wrap || !grid) return;

  const inUse = collectInUseProviders().filter(id => !MODELS_USAGE_LOCAL.has(id));
  if (!inUse.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  grid.innerHTML = `<div class="hub-empty">Loading…</div>`;

  const byId = {};
  try {
    const r = await api('/api/usage/limits', { timeoutMs: 30000 });
    (r && Array.isArray(r.providers) ? r.providers : []).forEach(p => {
      if (!byId[p.provider]) byId[p.provider] = [];
      byId[p.provider].push(p);
    });
  } catch { /* fall through to no-data cards */ }

  const mainId = (document.getElementById('amd-main-chat-prov') || {}).value || window._llmSettingsCache?.provider || '';
  const mainAccountId = String(window._llmSettingsCache?.accountId || getProviderConfigFromCache(mainId)?.defaultAccountId || '').trim();
  const cards = inUse.flatMap(id => {
    const isPrimary = id === mainId;
    const entries = byId[id] || [];
    if (entries.length) {
      return entries.map(data => {
        const html = renderProviderUsageCard(data);
        const isPrimaryAccount = isPrimary && (!data.account_id || data.account_id === mainAccountId);
        return isPrimaryAccount ? html.replace('usage-provider-card"', 'usage-provider-card is-primary"') : html;
      });
    }
    // Assigned but no saved credentials → minimal informational card.
    return `<div class="usage-provider-card${isPrimary ? ' is-primary' : ''}">
      <div class="usage-provider-head">
        <span class="usage-provider-name">${escHtml(MODELS_USAGE_LABELS[id] || id)}</span>
        <span class="usage-provider-badge">no creds</span>
      </div>
      <div class="usage-provider-note">Assigned to an agent but no saved API key / token — connect it above to track usage.</div>
    </div>`;
  });
  grid.innerHTML = cards.join('');
}
window.renderModelsUsage = renderModelsUsage;

async function loadSessionCompactionSettings() {
  window._settingsSessionLoadedToUI = false;
  try {
    const data = await api('/api/settings/session');
    const s = data?.session || {};
    const enabledEl = document.getElementById('settings-rolling-compaction-enabled');
    const countEl = document.getElementById('settings-rolling-compaction-count');
    const toolsEl = document.getElementById('settings-rolling-compaction-tools');
    const wordsEl = document.getElementById('settings-rolling-compaction-words');
    const modelEl = document.getElementById('settings-rolling-compaction-model');

    if (enabledEl) enabledEl.checked = s.rollingCompactionEnabled !== false;
    if (countEl) countEl.value = String(Number(s.rollingCompactionMessageCount) || 20);
    if (toolsEl) toolsEl.value = String(Number(s.rollingCompactionToolTurns) || 5);
    if (wordsEl) wordsEl.value = String(Number(s.rollingCompactionSummaryMaxWords) || 900);
    if (modelEl) modelEl.value = String(s.rollingCompactionModel || '');
    await applyGoalRoutingToForm('compactor', s?.mainChatGoals?.compactionModel || '', s?.mainChatGoals?.compactionReasoning || '');
    renderContextBudgetSummary(s.contextProfile, s.contextBudget);
    window._settingsSessionLoadedToUI = true;
  } catch (e) {
    window._settingsSessionLoadedToUI = false;
    console.warn('loadSessionCompactionSettings error:', e);
  }
}

function formatTokenCount(n) {
  const value = Number(n);
  if (!Number.isFinite(value) || value <= 0) return 'unknown';
  if (value >= 1000000) return `${(value / 1000000).toFixed(value >= 10000000 ? 0 : 1)}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(Math.round(value));
}

function renderContextBudgetSummary(profile, budget) {
  const wrap = document.getElementById('settings-context-budget-summary');
  if (!wrap) return;
  const p = profile || {};
  const b = budget || {};
  wrap.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">
      <div style="border:1px solid var(--line);border-radius:8px;padding:8px;background:var(--panel-2,#fff)">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:800">Primary model</div>
        <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--text);overflow-wrap:anywhere;margin-top:3px">${escHtml(p.providerId || 'provider')}/${escHtml(p.model || 'model')}</div>
      </div>
      <div style="border:1px solid var(--line);border-radius:8px;padding:8px;background:var(--panel-2,#fff)">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:800">Context window</div>
        <div style="font-size:13px;font-weight:800;color:var(--text);margin-top:3px">${escHtml(formatTokenCount(p.contextWindowTokens))} tokens</div>
      </div>
      <div style="border:1px solid var(--line);border-radius:8px;padding:8px;background:var(--panel-2,#fff)">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:800">Compaction trigger</div>
        <div style="font-size:13px;font-weight:800;color:var(--text);margin-top:3px">${escHtml(formatTokenCount(b.compactionTriggerTokens))} input tokens</div>
      </div>
      <div style="border:1px solid var(--line);border-radius:8px;padding:8px;background:var(--panel-2,#fff)">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:800">Tool budget</div>
        <div style="font-size:13px;font-weight:800;color:var(--text);margin-top:3px">${escHtml(formatTokenCount(b.toolContextBudgetTokens))} tokens</div>
      </div>
    </div>
  `;
}

function renderCommandPermissionGrants(grants) {
  const el = document.getElementById('settings-command-permissions-list');
  if (!el) return;
  const always = (Array.isArray(grants) ? grants : []).filter(g => String(g.scope || '') === 'always' && String(g.toolName || '') === 'run_command');
  if (!always.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:10px;border:1px dashed var(--line);border-radius:8px">No always-allowed commands yet.</div>';
    return;
  }
  el.innerHTML = always.map((grant) => {
    const created = grant.createdAt ? new Date(grant.createdAt).toLocaleString() : 'unknown';
    const used = grant.lastUsedAt ? new Date(grant.lastUsedAt).toLocaleString() : 'never';
    const command = grant.commandDisplay || grant.actionDisplay || grant.toolName || 'command';
    const cwd = grant.cwdDisplay || grant.targetDisplay || '';
    const boundary = grant.boundaryScope && grant.boundaryScope !== 'workspace' ? String(grant.boundaryScope).replace(/_/g, ' ') : '';
    const externalPaths = Array.isArray(grant.externalPaths) ? grant.externalPaths.filter(Boolean) : [];
    return `<div style="border:1px solid var(--line);border-radius:8px;padding:10px;background:var(--panel-2)">
      <div style="display:flex;align-items:flex-start;gap:10px;justify-content:space-between">
        <div style="min-width:0;flex:1">
          <div style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--text);overflow-wrap:anywhere">${escHtml(command)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:5px;overflow-wrap:anywhere">cwd: ${escHtml(cwd || '-')}</div>
          ${boundary ? `<div style="font-size:11px;color:#9a5b00;margin-top:5px;overflow-wrap:anywhere">boundary: ${escHtml(boundary)}${externalPaths.length ? ` · ${escHtml(externalPaths.slice(0, 2).join(', '))}` : ''}</div>` : ''}
          <div style="font-size:10.5px;color:var(--muted);margin-top:4px">created: ${escHtml(created)} · used: ${escHtml(used)} · ${Number(grant.useCount || 0)} use(s)</div>
        </div>
        <button class="btn btn-sm" onclick="revokeCommandPermission('${escHtml(grant.id)}')" style="background:#fff;color:#b91c1c;border:1px solid #fecaca;flex-shrink:0">Remove</button>
      </div>
    </div>`;
  }).join('');
}

function toggleCommandPermissionList() {
  const details = document.getElementById('settings-command-permissions-details');
  const toggle = document.getElementById('settings-command-permissions-toggle');
  if (!details || !toggle) return;
  const isOpen = !details.hidden;
  details.hidden = isOpen;
  toggle.setAttribute('aria-expanded', String(!isOpen));
  toggle.textContent = isOpen ? 'View commands' : 'Hide commands';
}

function resetCommandPermissionListVisibility() {
  const details = document.getElementById('settings-command-permissions-details');
  const toggle = document.getElementById('settings-command-permissions-toggle');
  if (!details || !toggle) return;
  details.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
  toggle.textContent = 'View commands';
}

async function loadSecuritySettings() {
  const statusEl = document.getElementById('settings-security-status');
  window._settingsSecurityLoadedToUI = false;
  try {
    if (statusEl) statusEl.textContent = 'Loading...';
    const data = await api('/api/settings/security', { timeoutMs: 5000 });
    const mode = (data?.toolPermissionMode ?? data?.terminalPermissionMode) === 'lite' ? 'lite' : 'default';
    const workspaceMode = String(data?.workspaceToolMode ?? data?.workspaceMode ?? 'prometheus').toLowerCase() === 'terminal-first'
      ? 'terminal-first'
      : 'prometheus';
    const defaultEl = document.getElementById('settings-terminal-permission-default');
    const liteEl = document.getElementById('settings-terminal-permission-lite');
    if (defaultEl) defaultEl.checked = mode === 'default';
    if (liteEl) liteEl.checked = mode === 'lite';
    const workspaceToolsEl = document.getElementById('settings-workspace-tools-enabled');
    if (workspaceToolsEl) workspaceToolsEl.checked = workspaceMode !== 'terminal-first';
    const hardEl = document.getElementById('settings-hard-blocked-patterns');
    if (hardEl) hardEl.textContent = (data?.hardBlockedPatterns || []).join(', ') || 'none configured';
    renderCommandPermissionGrants(data?.commandPermissions || []);
    window._settingsSecurityLoadedToUI = true;
    if (statusEl) statusEl.textContent = '';
  } catch (err) {
    window._settingsSecurityLoadedToUI = false;
    console.warn('[settings] Security settings request failed:', err);
    if (statusEl) statusEl.textContent = '';
  }
}

function getTerminalPermissionModeFromUI() {
  return document.getElementById('settings-terminal-permission-lite')?.checked ? 'lite' : 'default';
}

function getWorkspaceToolModeFromUI() {
  return document.getElementById('settings-workspace-tools-enabled')?.checked === false
    ? 'terminal-first'
    : 'prometheus';
}

async function saveSecuritySettings({ showStatus = false } = {}) {
  const statusEl = document.getElementById('settings-security-status');
  try {
    if (showStatus && statusEl) statusEl.textContent = 'Saving...';
    const data = await api('/api/settings/security', {
      method: 'POST',
      body: JSON.stringify({
        toolPermissionMode: getTerminalPermissionModeFromUI(),
        workspaceToolMode: getWorkspaceToolModeFromUI(),
      }),
    });
    if (!data?.success) throw new Error(data?.error || 'Failed to save security settings');
    if (showStatus && statusEl) statusEl.textContent = 'Saved.';
    return data;
  } catch (err) {
    if (showStatus && statusEl) statusEl.textContent = `Save failed: ${err.message}`;
    throw err;
  }
}

async function revokeCommandPermission(id) {
  showConfirm(
    'Prometheus will ask again the next time this exact command and cwd are used.',
    async () => {
      try {
        await api(`/api/command-permissions/${encodeURIComponent(id)}`, { method: 'DELETE' });
        addProcessEntry('info', 'Always-allowed command removed.');
        await loadSecuritySettings();
      } catch (err) {
        addProcessEntry('error', `Could not remove command permission: ${err.message}`);
      }
    },
    null,
    { title: 'Remove this always-allowed command?', confirmText: 'Remove', danger: true },
  );
}

async function refreshProviderModels(providerOverride) {
  const provider = providerOverride || document.getElementById('settings-llm-provider')?.value || 'ollama';
  setProviderStatusMessage(provider, 'info', 'Loading models...');
  try {
    if (!BUILTIN_PROVIDER_IDS.includes(provider)) {
      const models = await fetchProviderModelsForPicker(provider, { refreshOpenAI: provider === 'openai', includeLive: true });
      setProviderModelOptions(provider, models);
      setProviderStatusMessage(
        provider,
        models.length ? 'success' : 'info',
        models.length ? `${models.length} model(s) found.` : 'No models found. Check the provider connection and endpoint.'
      );
      return;
    }
    const llm = buildProviderPayload();
    if (llm.provider !== provider) llm.provider = provider;
    const data = await api('/api/models/test', { method: 'POST', body: JSON.stringify({ llm }) });
    let models = uniqueStrings([
      ...getProviderModelFallbacks(provider),
      ...normalizeModelList(data?.models),
      ...getProviderModelsFromUI(provider),
    ]);
    const primarySel = document.getElementById('settings-primary-model');
    if (provider === 'ollama' && primarySel) {
      const preferredValue = String(primarySel.dataset.savedValue || primarySel.value || '').trim();
      if (preferredValue && !models.includes(preferredValue)) models = [preferredValue, ...models];
      primarySel.innerHTML = models.map(m => `<option value="${escHtml(m)}">${escHtml(m)}</option>`).join('');
      if (preferredValue && models.includes(preferredValue)) primarySel.value = preferredValue;
      else if (models.length) primarySel.value = models[0];
      delete primarySel.dataset.savedValue;
    }
    setProviderStatusMessage(
      provider,
      models.length ? 'success' : 'info',
      models.length ? `${models.length} model(s) found.` : 'No models found. Check the provider connection and endpoint.'
    );
  } catch (e) {
    setProviderStatusMessage(provider, 'error', e?.message || 'Failed to fetch models.');
  }
}

async function testProviderConnection(providerOverride) {
  const provider = providerOverride || document.getElementById('settings-llm-provider').value;
  setProviderStatusMessage(provider, 'info', 'Testing...');

  if (provider === 'openai') {
    const ok = await refreshOpenAIModels(false);
    setProviderStatusMessage(provider, ok ? 'success' : 'error', ok ? 'Connected' : 'Connection failed');
    return;
  }

  try {
    if (!BUILTIN_PROVIDER_IDS.includes(provider)) {
      const llm = buildProviderPayload();
      llm.provider = provider;
      const data = await api('/api/models/test', { method: 'POST', body: JSON.stringify({ llm }) });
      if (!data?.success) throw new Error(data?.error || 'Connection failed');
      const models = normalizeModelList(data?.models);
      if (models.length) setProviderModelOptions(provider, uniqueStrings([...getProviderModelFallbacks(provider), ...models]));
      setProviderStatusMessage(provider, 'success', models.length ? `Connected (${models.length} models available)` : 'Connected');
      return;
    }
    const llm = buildProviderPayload();
    if (llm.provider !== provider) llm.provider = provider;
    const data = await api('/api/models/test', { method: 'POST', body: JSON.stringify({ llm }) });
    setProviderStatusMessage(provider, data?.success ? 'success' : 'error', data?.success ? 'Connected' : (data?.error || 'Connection failed'));
  } catch (e) {
    setProviderStatusMessage(provider, 'error', e?.message || 'Connection failed');
  }
}

function updateOpenAIModelDropdown(models) {
  const sel = document.getElementById('settings-openai-model');
  if (!sel) return;
  const current = String(sel.value || '').trim();
  const unique = Array.from(new Set((models || []).filter(Boolean).map(m => String(m).trim()).filter(Boolean)));
  if (!unique.length) return;
  if (current && !unique.includes(current)) unique.unshift(current);
  sel.innerHTML = unique.slice(0, 500).map(m => `<option value="${escHtml(m)}">${escHtml(formatModelDisplayName(m, 'openai'))}</option>`).join('');
  if (current) sel.value = current;
}

async function refreshOpenAIModels(silent = false) {
  const statusEl = document.getElementById('provider-status-msg-openai');
  const apiKey = document.getElementById('settings-openai-key')?.value?.trim() || '';
  if (!apiKey) {
    if (!silent) setSettingsStatus(statusEl, 'info', 'Enter API key first.');
    return false;
  }
  if (!silent) setSettingsStatus(statusEl, 'info', 'Fetching model list…');
  try {
    const data = await api('/api/openai/models', { method: 'POST', body: JSON.stringify({ api_key: apiKey }) });
    if (!data?.success) {
      setSettingsStatus(statusEl, 'error', data?.error || 'Failed to fetch models');
      return false;
    }
    const models = (data?.models || []).map(m => typeof m === 'string' ? m : (m.name || String(m)));
    updateOpenAIModelDropdown(models);
    setSettingsStatus(statusEl, models.length ? 'success' : 'info', models.length ? `${models.length} model(s) available` : 'Connected');
    return true;
  } catch (e) {
    setSettingsStatus(statusEl, 'error', e.message);
    return false;
  }
}

// Build the llm config object from current UI state
function buildProviderPayload(providerOverride) {
  // The left selector only chooses which connection form is visible. Provider
  // saves must not activate it; use the currently-live main-chat route unless
  // a test/refresh explicitly asks for another provider.
  const provider = providerOverride || window._llmSettingsCache?.provider || document.getElementById('settings-llm-provider')?.value || 'ollama';
  const providers = {};
  providers.ollama    = { endpoint: document.getElementById('settings-ollama-endpoint')?.value  || 'http://localhost:11434', model: document.getElementById('settings-primary-model')?.value || 'qwen3:4b' };
  providers.llama_cpp = { endpoint: document.getElementById('settings-llamacpp-endpoint')?.value || 'http://localhost:8080',  model: document.getElementById('settings-llamacpp-model')?.value  || '' };
  providers.lm_studio = { endpoint: document.getElementById('settings-lmstudio-endpoint')?.value || 'http://localhost:1234',  model: document.getElementById('settings-lmstudio-model')?.value   || '' };
  const openaiModel = document.getElementById('settings-openai-model')?.value || 'gpt-4o';
  const openaiEffort = document.getElementById('settings-openai-effort')?.value || '';
  const openaiToolChoice = 'auto';
  providers.openai    = { api_key:  document.getElementById('settings-openai-key')?.value         || '', model: openaiModel };
  if (openaiEffort && validEffort('openai', openaiModel, openaiEffort)) providers.openai.reasoning_effort = openaiEffort;
  providers.openai.speed = document.getElementById('settings-openai-speed')?.value === 'fast' ? 'fast' : 'standard';
  providers.openai.tool_choice = openaiToolChoice;
  const codexModel = document.getElementById('settings-codex-model')?.value || 'gpt-5.4-codex';
  const codexEffort = document.getElementById('settings-codex-effort')?.value || '';
  const codexToolChoice = document.getElementById('settings-codex-tool-choice')?.value || 'auto';
  providers.openai_codex = { model: codexModel };
  if (codexEffort && validEffort('openai_codex', codexModel, codexEffort)) providers.openai_codex.reasoning_effort = codexEffort;
  providers.openai_codex.speed = document.getElementById('settings-codex-speed')?.value === 'fast' ? 'fast' : 'standard';
  providers.openai_codex.tool_choice = codexToolChoice;
  const anthropicExtThinking = document.getElementById('settings-anthropic-extended-thinking')?.checked || false;
  const anthropicBudget = parseInt(document.getElementById('settings-anthropic-thinking-budget')?.value || '10000', 10);
  const anthropicModel = document.getElementById('settings-anthropic-model')?.value || 'claude-sonnet-4-6';
  const anthropicEffortEl = document.getElementById('settings-anthropic-effort');
  const anthropicEffort = anthropicEffortEl?.disabled ? '' : (anthropicEffortEl?.value || '');
  providers.anthropic = {
    model: anthropicModel,
    extended_thinking: anthropicExtThinking,
    thinking_budget: anthropicBudget,
    speed: document.getElementById('settings-anthropic-speed')?.value === 'fast' ? 'fast' : 'standard',
  };
  if (anthropicEffort && validEffort('anthropic', anthropicModel, anthropicEffort)) providers.anthropic.reasoning_effort = anthropicEffort;
  const perplexityEffort = document.getElementById('settings-perplexity-effort')?.value || '';
  const perplexityModel = document.getElementById('settings-perplexity-model')?.value || 'sonar-pro';
  providers.perplexity = {
    api_key: document.getElementById('settings-perplexity-key')?.value || '',
    model: perplexityModel,
  };
  if (perplexityEffort && validEffort('perplexity', perplexityModel, perplexityEffort)) providers.perplexity.reasoning_effort = perplexityEffort;
  providers.gemini = {
    api_key: document.getElementById('settings-gemini-key')?.value || '',
    model: document.getElementById('settings-gemini-model')?.value || 'gemini-2.5-pro',
  };
  for (const item of getProviderCatalogItems()) {
    if (BUILTIN_PROVIDER_IDS.includes(item.id)) continue;
    const config = collectDynamicProviderConfig(item.id, provider);
    if (config) providers[item.id] = config;
  }
  const applyAccountState = (providerId) => {
    const existing = getProviderConfigFromCache(providerId);
    const selected = getSelectedProviderAccountId(providerId);
    const accounts = {};
    for (const account of normalizeProviderAccountsForUI(providerId, existing)) {
      accounts[account.id] = { ...account };
    }
    if (!accounts[selected]) {
      accounts[selected] = { id: selected, label: selected, authType: providerId === 'anthropic' ? 'setup_token' : providerId === 'openai_codex' ? 'oauth' : 'api_key', status: 'disconnected' };
    }
    const label = document.getElementById(getProviderAccountLabelId(providerId))?.value?.trim();
    if (label) accounts[selected].label = label;
    if (providerId === 'xai') {
      const mode = String(document.getElementById(getProviderSettingsFieldId('xai', 'auth_mode'))?.value || 'api_key').trim() || 'api_key';
      accounts[selected].authType = mode === 'oauth' ? 'oauth' : 'api_key';
      const key = String(document.getElementById(getProviderSettingsFieldId('xai', 'api_key'))?.value || '').trim();
      if (key || accounts[selected].api_key) accounts[selected].api_key = key || accounts[selected].api_key;
      providers.xai = {
        ...(providers.xai || {}),
        auth_mode: mode,
        defaultAccountId: selected,
        accounts,
      };
    } else if (providerId === 'openai') {
      const key = String(document.getElementById('settings-openai-key')?.value || '').trim();
      accounts[selected].authType = 'api_key';
      if (key || accounts[selected].api_key) accounts[selected].api_key = key || accounts[selected].api_key;
      providers.openai = {
        ...(providers.openai || {}),
        api_key: key || providers.openai?.api_key || '',
        defaultAccountId: selected,
        accounts,
      };
    } else if (providerId === 'openai_codex') {
      providers.openai_codex = { ...(providers.openai_codex || {}), defaultAccountId: selected, accounts };
    } else if (providerId === 'anthropic') {
      providers.anthropic = { ...(providers.anthropic || {}), defaultAccountId: selected, accounts };
    }
  };
  ['openai', 'xai', 'openai_codex', 'anthropic'].forEach(applyAccountState);
  const activeAccount = providers[provider]?.defaultAccountId || '';
  return { provider, accountId: activeAccount, providers };
}

// --- Codex OAuth UI ------------------------------------------------

async function refreshCodexStatus() {
  try {
    const accountId = getSelectedProviderAccountId('openai_codex');
    const data = await api(`/api/auth/openai/status?accountId=${encodeURIComponent(accountId)}`);
    const disc = document.getElementById('codex-disconnected-state');
    const conn = document.getElementById('codex-connected-state');
    const acct = document.getElementById('codex-account-id');
    if (data?.connected) {
      if (disc) disc.style.display = 'none';
      if (conn) conn.style.display = 'block';
      if (acct) acct.textContent = data.account_id ? `Account: ${data.account_id}` : 'Account connected';
    } else {
      if (disc) disc.style.display = 'block';
      if (conn) conn.style.display = 'none';
    }
  } catch {}
}

let _codexPollTimer = null;

async function startCodexOAuth() {
  const statusEl = document.getElementById('codex-oauth-status');
  setSettingsStatus(statusEl, 'info', 'Starting…');
  if (_codexPollTimer) { clearTimeout(_codexPollTimer); _codexPollTimer = null; }
  try {
        const data = await api('/api/auth/openai/start', { method: 'POST', body: JSON.stringify({ accountId: getSelectedProviderAccountId('openai_codex') }) });
    if (data?.error) {
      setSettingsStatus(statusEl, 'error', data.error);
      return;
    }
    if (data?.authUrl) {
      // OAuth must stay in the system browser; this is an intentional external flow.
      if (typeof window.openPrometheusExternalLink === 'function') window.openPrometheusExternalLink(data.authUrl, { target: '_blank' });
      else window.open(data.authUrl, '_blank');
      setSettingsStatus(statusEl, 'info', 'Waiting for browser authorization…');
      _codexPollTimer = setTimeout(_pollCodexOAuth, 2000);
    } else {
      setSettingsStatus(statusEl, 'error', 'No auth URL returned');
    }
  } catch (e) {
    setSettingsStatus(statusEl, 'error', e.message);
  }
}

async function _pollCodexOAuth() {
  _codexPollTimer = null;
  const statusEl = document.getElementById('codex-oauth-status');
  try {
    const data = await api('/api/auth/openai/poll');
    if (data?.done) {
      if (data.success) {
        setSettingsStatus(statusEl, 'info', '');
        await refreshCodexStatus();
        await refreshCredentialedRoutingProviderChoices();
      } else {
        setSettingsStatus(statusEl, 'error', data.error || 'OAuth failed');
      }
    } else {
      // Still waiting — poll again
      _codexPollTimer = setTimeout(_pollCodexOAuth, 2000);
    }
  } catch (e) {
    // Network error — retry
    _codexPollTimer = setTimeout(_pollCodexOAuth, 3000);
  }
}

async function submitManualCodexUrl() {
  const url = document.getElementById('codex-manual-url')?.value?.trim();
  if (!url) return;
  const statusEl = document.getElementById('codex-oauth-status');
  setSettingsStatus(statusEl, 'info', 'Exchanging token…');
  try {
    const data = await api('/api/auth/openai/manual', { method: 'POST', body: JSON.stringify({ url, accountId: getSelectedProviderAccountId('openai_codex') }) });
    if (data?.success) {
      setSettingsStatus(statusEl, 'info', '');
      await refreshCodexStatus();
      await refreshCredentialedRoutingProviderChoices();
    } else {
      setSettingsStatus(statusEl, 'error', data?.error || 'Failed');
    }
  } catch (e) {
    setSettingsStatus(statusEl, 'error', e.message);
  }
}

async function disconnectCodex() {
  await api('/api/auth/openai/disconnect', { method: 'POST', body: JSON.stringify({ accountId: getSelectedProviderAccountId('openai_codex') }) });
  await refreshCodexStatus();
  await refreshCredentialedRoutingProviderChoices();
}

// --- xAI Grok OAuth UI ---------------------------------------------

async function refreshXaiStatus() {
  try {
    const accountId = getSelectedProviderAccountId('xai');
    const data = await api(`/api/auth/xai/status?accountId=${encodeURIComponent(accountId)}`);
    const disc = document.getElementById('xai-oauth-disconnected-state');
    const conn = document.getElementById('xai-oauth-connected-state');
    const acct = document.getElementById('xai-oauth-account-id');
    const oauthConnected = data?.oauthConnected ?? data?.auth === 'oauth';
    if (oauthConnected) {
      if (disc) disc.style.display = 'none';
      if (conn) conn.style.display = 'block';
      if (acct) {
        const renews = data.expires_at ? ` Access token renews around ${new Date(data.expires_at).toLocaleString()}.` : '';
        const rtExp = data.refresh_token_expires_at
          ? ` Session valid until ${new Date(data.refresh_token_expires_at).toLocaleString()} (auto-refreshed every 30 min).`
          : data.refresh_available ? ' Refresh token stored; session kept alive automatically.' : '';
        acct.textContent = `xAI OAuth connected for Grok models/media tools.${rtExp}${renews}`;
      }
    } else {
      if (disc) disc.style.display = 'block';
      if (conn) conn.style.display = 'none';
    }
  } catch {}
}

let _xaiPollTimer = null;

async function startXaiOAuth() {
  const statusEl = document.getElementById('xai-oauth-status');
  setSettingsStatus(statusEl, 'info', 'Starting xAI login...');
  if (_xaiPollTimer) { clearTimeout(_xaiPollTimer); _xaiPollTimer = null; }
  try {
    const data = await api('/api/auth/xai/start', { method: 'POST', body: JSON.stringify({ accountId: getSelectedProviderAccountId('xai') }) });
    if (data?.error) {
      setSettingsStatus(statusEl, 'error', data.error);
      return;
    }
    if (data?.authUrl) {
      if (typeof window.openPrometheusExternalLink === 'function') window.openPrometheusExternalLink(data.authUrl, { target: '_blank' });
      else window.open(data.authUrl, '_blank');
      setSettingsStatus(statusEl, 'info', 'Waiting for xAI browser authorization. If xAI shows a code, paste it below.');
      _xaiPollTimer = setTimeout(_pollXaiOAuth, 2000);
    } else {
      setSettingsStatus(statusEl, 'error', 'No xAI auth URL returned');
    }
  } catch (e) {
    setSettingsStatus(statusEl, 'error', e.message);
  }
}

async function _pollXaiOAuth() {
  _xaiPollTimer = null;
  const statusEl = document.getElementById('xai-oauth-status');
  try {
    const data = await api('/api/auth/xai/poll');
    if (data?.done) {
      if (data.success) {
        setSettingsStatus(statusEl, 'success', 'Connected. Auth Mode was switched to oauth.');
        await refreshXaiStatus();
        await refreshCredentialedRoutingProviderChoices();
      } else {
        setSettingsStatus(statusEl, 'error', data.error || 'xAI OAuth failed');
      }
    } else {
      _xaiPollTimer = setTimeout(_pollXaiOAuth, 2000);
    }
  } catch {
    _xaiPollTimer = setTimeout(_pollXaiOAuth, 3000);
  }
}

async function submitXaiOAuthCode() {
  const statusEl = document.getElementById('xai-oauth-status');
  const input = document.getElementById('xai-oauth-manual-code');
  const code = String(input?.value || '').trim();
  if (!code) {
    setSettingsStatus(statusEl, 'info', 'Paste the code from the xAI browser page first.');
    return;
  }
  setSettingsStatus(statusEl, 'info', 'Completing xAI OAuth...');
  try {
    const data = await api('/api/auth/xai/manual', { method: 'POST', body: JSON.stringify({ code, accountId: getSelectedProviderAccountId('xai') }) });
    if (data?.success) {
      if (input) input.value = '';
      setSettingsStatus(statusEl, 'success', 'Connected. Auth Mode was switched to oauth.');
      await refreshXaiStatus();
      await refreshCredentialedRoutingProviderChoices();
    } else {
      setSettingsStatus(statusEl, 'error', data?.error || 'xAI OAuth code exchange failed.');
    }
  } catch (e) {
    setSettingsStatus(statusEl, 'error', e.message);
  }
}

async function disconnectXaiOAuth() {
  await api('/api/auth/xai/disconnect', { method: 'POST', body: JSON.stringify({ accountId: getSelectedProviderAccountId('xai') }) });
  await refreshXaiStatus();
  await refreshCredentialedRoutingProviderChoices();
  setSettingsStatus(document.getElementById('xai-oauth-status'), 'info', 'xAI OAuth disconnected. You can reconnect whenever you need OAuth.');
}

// --- Official X API OAuth UI -----------------------------------------

let _xApiPollTimer = null;

async function refreshXApiStatus() {
  const statusEl = document.getElementById('x-api-oauth-status');
  try {
    const data = await api('/api/auth/x-api/status');
    const redirect = document.getElementById('x-api-redirect-uri');
    const scopes = document.getElementById('x-api-scopes');
    const acct = document.getElementById('x-api-oauth-account-id');
    if (redirect && !redirect.value) redirect.value = data?.redirect_uri || 'http://localhost:8080/callback';
    if (scopes && !scopes.value) scopes.value = (data?.scopes || []).join(' ');
    if (acct) {
      if (data?.connected) {
        const who = data.username ? `@${data.username}` : (data.user_id ? `user ${data.user_id}` : 'account connected');
        const expires = data.expires_at ? ` - refreshes after ${new Date(data.expires_at).toLocaleString()}` : '';
        acct.textContent = `X API OAuth connected: ${who}${expires}`;
      } else if (data?.credentialsConfigured) {
        acct.textContent = 'X API app saved. Connect OAuth when ready.';
      } else {
        acct.textContent = '';
      }
    }
    if (statusEl && data?.redirect_uri) {
      setSettingsStatus(statusEl, 'info', `Redirect URI: ${data.redirect_uri}`);
    }
  } catch {}
}

async function saveXApiCredentials() {
  const statusEl = document.getElementById('x-api-oauth-status');
  const clientId = document.getElementById('x-api-client-id')?.value?.trim() || '';
  const clientSecret = document.getElementById('x-api-client-secret')?.value?.trim() || '';
  const redirectUri = document.getElementById('x-api-redirect-uri')?.value?.trim() || '';
  const scopes = document.getElementById('x-api-scopes')?.value?.trim() || '';
  if (!clientId) {
    setSettingsStatus(statusEl, 'error', 'X API Client ID is required.');
    return;
  }
  setSettingsStatus(statusEl, 'info', 'Saving X API app credentials...');
  try {
    const data = await api('/api/auth/x-api/credentials', { method: 'POST', body: JSON.stringify({ clientId, clientSecret, redirectUri, scopes }) });
    if (data?.success) {
      setSettingsStatus(statusEl, 'success', `Saved. Use redirect URI in X Developer Portal: ${data.redirect_uri}`);
      await refreshXApiStatus();
    } else {
      setSettingsStatus(statusEl, 'error', data?.error || 'Failed to save X API credentials.');
    }
  } catch (e) {
    setSettingsStatus(statusEl, 'error', e.message);
  }
}

async function startXApiOAuth() {
  const statusEl = document.getElementById('x-api-oauth-status');
  setSettingsStatus(statusEl, 'info', 'Starting X API OAuth...');
  if (_xApiPollTimer) { clearTimeout(_xApiPollTimer); _xApiPollTimer = null; }
  try {
    const data = await api('/api/auth/x-api/start', { method: 'POST', body: '{}' });
    if (data?.error) {
      setSettingsStatus(statusEl, 'error', data.error);
      return;
    }
    if (data?.authUrl) {
      if (typeof window.openPrometheusExternalLink === 'function') window.openPrometheusExternalLink(data.authUrl, { target: '_blank' });
      else window.open(data.authUrl, '_blank');
      setSettingsStatus(statusEl, 'info', 'Waiting for X browser authorization...');
      _xApiPollTimer = setTimeout(_pollXApiOAuth, 2000);
    } else {
      setSettingsStatus(statusEl, 'error', 'No X API auth URL returned.');
    }
  } catch (e) {
    setSettingsStatus(statusEl, 'error', e.message);
  }
}

async function _pollXApiOAuth() {
  _xApiPollTimer = null;
  const statusEl = document.getElementById('x-api-oauth-status');
  try {
    const data = await api('/api/auth/x-api/poll');
    if (data?.done) {
      if (data.success) {
        setSettingsStatus(statusEl, 'success', 'X API OAuth connected.');
        await refreshXApiStatus();
      } else {
        setSettingsStatus(statusEl, 'error', data.error || 'X API OAuth failed.');
      }
    } else {
      _xApiPollTimer = setTimeout(_pollXApiOAuth, 2000);
    }
  } catch {
    _xApiPollTimer = setTimeout(_pollXApiOAuth, 3000);
  }
}

async function submitXApiOAuthCode() {
  const statusEl = document.getElementById('x-api-oauth-status');
  const input = document.getElementById('x-api-manual-code');
  const code = String(input?.value || '').trim();
  if (!code) {
    setSettingsStatus(statusEl, 'info', 'Paste the X OAuth code first.');
    return;
  }
  setSettingsStatus(statusEl, 'info', 'Completing X API OAuth...');
  try {
    const data = await api('/api/auth/x-api/manual', { method: 'POST', body: JSON.stringify({ code }) });
    if (data?.success) {
      if (input) input.value = '';
      setSettingsStatus(statusEl, 'success', 'X API OAuth connected.');
      await refreshXApiStatus();
    } else {
      setSettingsStatus(statusEl, 'error', data?.error || 'X API OAuth code exchange failed.');
    }
  } catch (e) {
    setSettingsStatus(statusEl, 'error', e.message);
  }
}

async function disconnectXApiOAuth() {
  await api('/api/auth/x-api/disconnect', { method: 'POST', body: '{}' });
  await refreshXApiStatus();
  setSettingsStatus(document.getElementById('x-api-oauth-status'), 'info', 'X API OAuth disconnected.');
}

// --- Anthropic Auth UI ------------------------------------------------

async function refreshAnthropicStatus() {
  try {
    const accountId = getSelectedProviderAccountId('anthropic');
    const data = await api(`/api/auth/anthropic/status?accountId=${encodeURIComponent(accountId)}`);
    const disc = document.getElementById('anthropic-disconnected-state');
    const conn = document.getElementById('anthropic-connected-state');
    const authType = document.getElementById('anthropic-auth-type');
    if (data?.connected) {
      if (disc) disc.style.display = 'none';
      if (conn) conn.style.display = 'block';
      if (authType) {
        const typeLabel = data.auth_type === 'setup_token' ? 'Setup Token (subscription)' : 'API Key';
        const when = data.stored_at ? new Date(data.stored_at).toLocaleDateString() : '';
        authType.textContent = `${typeLabel}${when ? ' — connected ' + when : ''}`;
      }
    } else {
      if (disc) disc.style.display = 'block';
      if (conn) conn.style.display = 'none';
    }
    if (data?.connected) refreshAnthropicUsageTracking().catch(() => {});
  } catch {}
}

// ─── Anthropic usage tracking (separate read-only OAuth token) ───────────────
async function refreshAnthropicUsageTracking() {
  try {
    const data = await api('/api/settings/anthropic/usage-tracking');
    const chk = document.getElementById('settings-anthropic-usage-tracking');
    const statusEl = document.getElementById('anthropic-usage-oauth-status');
    if (chk) chk.checked = !!data?.connected;
    if (statusEl) statusEl.textContent = data?.connected ? 'Live usage tracking is on.' : '';
  } catch {}
}

async function onAnthropicUsageTrackingToggle(checked) {
  const flow = document.getElementById('anthropic-usage-oauth-flow');
  const statusEl = document.getElementById('anthropic-usage-oauth-status');
  if (!checked) {
    // Turning off → disconnect immediately.
    if (flow) flow.style.display = 'none';
    try {
      await api('/api/settings/anthropic/usage-tracking', { method: 'DELETE' });
      if (statusEl) statusEl.textContent = '';
    } catch (e) { if (statusEl) statusEl.textContent = e.message; }
    return;
  }
  // Turning on → start the OAuth flow and open the browser.
  if (statusEl) statusEl.textContent = 'Opening browser…';
  try {
    const data = await api('/api/settings/anthropic/usage-tracking/start', { method: 'POST', body: '{}' });
    if (data?.authorizeUrl) {
      if (typeof window.openPrometheusExternalLink === 'function') window.openPrometheusExternalLink(data.authorizeUrl, { target: '_blank', features: 'noopener' });
      else window.open(data.authorizeUrl, '_blank', 'noopener');
      if (flow) flow.style.display = 'block';
      if (statusEl) statusEl.textContent = 'Approve in the browser, then paste the code below.';
    } else {
      if (statusEl) statusEl.textContent = data?.error || 'Failed to start login';
    }
  } catch (e) { if (statusEl) statusEl.textContent = e.message; }
}

async function completeAnthropicUsageTracking() {
  const codeEl = document.getElementById('settings-anthropic-usage-code');
  const flow = document.getElementById('anthropic-usage-oauth-flow');
  const statusEl = document.getElementById('anthropic-usage-oauth-status');
  const code = (codeEl?.value || '').trim();
  if (!code) { if (statusEl) statusEl.textContent = 'Paste the code first.'; return; }
  if (statusEl) statusEl.textContent = 'Connecting…';
  try {
    const data = await api('/api/settings/anthropic/usage-tracking/complete', {
      method: 'POST', body: JSON.stringify({ code }),
    });
    if (data?.success) {
      if (codeEl) codeEl.value = '';
      if (flow) flow.style.display = 'none';
      if (statusEl) statusEl.textContent = 'Live usage tracking is on.';
      if (typeof renderModelsUsage === 'function') renderModelsUsage();
    } else {
      if (statusEl) statusEl.textContent = data?.error || 'Failed to connect';
    }
  } catch (e) { if (statusEl) statusEl.textContent = e.message; }
}

function cancelAnthropicUsageTracking() {
  const flow = document.getElementById('anthropic-usage-oauth-flow');
  const chk = document.getElementById('settings-anthropic-usage-tracking');
  const statusEl = document.getElementById('anthropic-usage-oauth-status');
  if (flow) flow.style.display = 'none';
  if (chk) chk.checked = false;
  if (statusEl) statusEl.textContent = '';
}

async function connectAnthropic() {
  const statusEl = document.getElementById('anthropic-oauth-status');
  const tokenInput = document.getElementById('settings-anthropic-token');
  const token = (tokenInput?.value || '').trim();
  if (!token) {
    setSettingsStatus(statusEl, 'info', 'Paste your setup-token first. Run `claude setup-token` in your terminal.');
    return;
  }
  setSettingsStatus(statusEl, 'info', 'Connecting…');
  try {
    const data = await api('/api/auth/anthropic/setup-token', {
      method: 'POST',
      body: JSON.stringify({ token, accountId: getSelectedProviderAccountId('anthropic') }),
    });
    if (data?.success) {
      setSettingsStatus(statusEl, 'info', '');
      if (tokenInput) tokenInput.value = '';
      await refreshAnthropicStatus();
      await refreshCredentialedRoutingProviderChoices();
      addProcessEntry('final', 'Anthropic connected.');
    } else {
      setSettingsStatus(statusEl, 'error', data?.error || 'Invalid token');
    }
  } catch (e) {
    setSettingsStatus(statusEl, 'error', e.message);
  }
}

async function testAnthropicConnection() {
  const statusEl = document.getElementById('anthropic-oauth-status');
  setSettingsStatus(statusEl, 'info', 'Testing…');
  try {
    const data = await api('/api/auth/anthropic/test', { method: 'POST', body: JSON.stringify({ accountId: getSelectedProviderAccountId('anthropic') }) });
    if (data?.success) {
      if (statusEl) statusEl.style.color = '#166534';
      setSettingsStatus(statusEl, 'success', 'Connected — API responded successfully');
      setTimeout(() => {
        if (statusEl) {
          setSettingsStatus(statusEl, 'info', '');
          statusEl.style.color = '';
        }
      }, 4000);
    } else {
      if (statusEl) statusEl.style.color = '#991b1b';
      setSettingsStatus(statusEl, 'error', data?.error || 'Connection failed');
    }
  } catch (e) {
    if (statusEl) statusEl.style.color = '#991b1b';
    setSettingsStatus(statusEl, 'error', e.message);
  }
}

async function disconnectAnthropic() {
  await api('/api/auth/anthropic/disconnect', { method: 'POST', body: JSON.stringify({ accountId: getSelectedProviderAccountId('anthropic') }) });
  await refreshAnthropicStatus();
  await refreshCredentialedRoutingProviderChoices();
  addProcessEntry('info', 'Anthropic disconnected.');
}

function isAnthropicAdaptiveThinkingModel(model) {
  return /^claude-opus-4-(6|7|8)(?:\b|[-_])/.test(String(model || ''))
    || /^claude-sonnet-4-6(?:\b|[-_])/.test(String(model || ''));
}

function supportsAnthropicEffort(model) {
  return /^claude-opus-4-(5|6|7|8)(?:\b|[-_])/.test(String(model || ''))
    || /^claude-sonnet-4-6(?:\b|[-_])/.test(String(model || ''))
    || /^claude-mythos-preview(?:\b|[-_])/.test(String(model || ''));
}

function syncAnthropicReasoningControls() {
  const model = document.getElementById('settings-anthropic-model')?.value || '';
  const effort = document.getElementById('settings-anthropic-effort');
  if (effort) {
    effort.disabled = !!model && !supportsAnthropicEffort(model);
    const xhighOption = Array.from(effort.options || []).find((opt) => opt.value === 'xhigh');
    if (xhighOption) {
      const supportsXHigh = /^claude-opus-4-(7|8)(?:\b|[-_])/.test(model);
      xhighOption.disabled = !!model && !supportsXHigh;
      if (xhighOption.disabled && effort.value === 'xhigh') effort.value = 'high';
    }
  }
  const row = document.getElementById('anthropic-thinking-budget-row');
  const thinkingEnabled = !!document.getElementById('settings-anthropic-extended-thinking')?.checked;
  if (row) {
    row.style.display = thinkingEnabled && !isAnthropicAdaptiveThinkingModel(model) ? 'block' : 'none';
  }
}

function onAnthropicThinkingToggle(_checked) {
  syncAnthropicReasoningControls();
}

function onAnthropicModelChange() {
  syncAnthropicReasoningControls();
}

// Legacy alias so any old references still work
async function refreshOllamaModels() { await refreshProviderModels(); }

let chromeProfileCatalog = { profiles: [], imported: [] };

function getChromeProfilesBridge() {
  return window.prometheusChromeProfiles && typeof window.prometheusChromeProfiles.detect === 'function'
    ? window.prometheusChromeProfiles
    : null;
}

function setChromeProfileImportStatus(message, tone = '') {
  const status = document.getElementById('settings-chrome-profile-status');
  if (!status) return;
  status.textContent = String(message || '');
  status.dataset.tone = String(tone || '').trim();
}

function getStoredInHouseProfileId() {
  try { return localStorage.getItem('prometheus.inhouse.profile') || 'main'; } catch { return 'main'; }
}

function setStoredInHouseProfileId(profileId) {
  const value = String(profileId || '').trim() || 'main';
  try { localStorage.setItem('prometheus.inhouse.profile', value); } catch {}
  return value;
}

function renderChromeProfileCatalog(catalog = chromeProfileCatalog) {
  chromeProfileCatalog = {
    profiles: Array.isArray(catalog?.profiles) ? catalog.profiles : [],
    imported: Array.isArray(catalog?.imported) ? catalog.imported : [],
  };
  const defaultSelect = document.getElementById('settings-browser-profile-default');
  const detectedSelect = document.getElementById('settings-chrome-profile-select');
  if (defaultSelect) {
    defaultSelect.replaceChildren(new Option('Prometheus profile', 'main'));
    chromeProfileCatalog.imported.forEach((profile) => {
      const option = new Option(`Imported Chrome · ${profile.name || profile.directory || profile.id}`, profile.id);
      defaultSelect.appendChild(option);
    });
    const stored = getStoredInHouseProfileId();
    defaultSelect.value = [...defaultSelect.options].some((option) => option.value === stored) ? stored : 'main';
    if (defaultSelect.value !== stored) setStoredInHouseProfileId('main');
  }
  if (detectedSelect) {
    detectedSelect.replaceChildren();
    if (!chromeProfileCatalog.profiles.length) {
      detectedSelect.appendChild(new Option('No Chrome profiles detected', ''));
      detectedSelect.disabled = true;
    } else {
      chromeProfileCatalog.profiles.forEach((profile) => {
        const suffix = profile.imported ? ' · already imported' : '';
        const option = new Option(`${profile.name || profile.directory} · ${profile.sourceLabel || 'Chrome'}${suffix}`, profile.id);
        detectedSelect.appendChild(option);
      });
      detectedSelect.disabled = false;
    }
  }
  const toggle = document.getElementById('settings-browser-profile-import-toggle');
  const panel = document.getElementById('settings-chrome-profile-import-panel');
  const bridge = getChromeProfilesBridge();
  if (!bridge) {
    if (toggle) toggle.disabled = true;
    if (defaultSelect) defaultSelect.disabled = true;
    if (panel) { panel.hidden = false; panel.style.display = 'block'; }
    setChromeProfileImportStatus('Chrome profile import is available in the Prometheus desktop app.', 'muted');
    return;
  }
  if (toggle) toggle.disabled = false;
  if (defaultSelect) defaultSelect.disabled = false;
}

async function loadChromeProfileSettings() {
  const bridge = getChromeProfilesBridge();
  if (!bridge) {
    renderChromeProfileCatalog({ profiles: [], imported: [] });
    return;
  }
  try {
    setChromeProfileImportStatus('Detecting Chrome profiles…');
    const catalog = await bridge.detect();
    renderChromeProfileCatalog(catalog);
    const count = Array.isArray(catalog?.profiles) ? catalog.profiles.length : 0;
    const importedCount = Array.isArray(catalog?.imported) ? catalog.imported.length : 0;
    setChromeProfileImportStatus(
      count
        ? `${count} Chrome profile${count === 1 ? '' : 's'} detected${importedCount ? ` · ${importedCount} imported` : ''}. Close Chrome before importing for the cleanest copy.`
        : 'No Chrome profiles were detected on this computer.',
      count ? '' : 'muted',
    );
  } catch (error) {
    renderChromeProfileCatalog({ profiles: [], imported: [] });
    setChromeProfileImportStatus(`Could not detect Chrome profiles: ${error?.message || error}`, 'error');
  }
}

function toggleChromeProfileImportPanel(enabled) {
  const panel = document.getElementById('settings-chrome-profile-import-panel');
  const next = enabled === true;
  try { localStorage.setItem('prometheus.chrome-profile-import.open', next ? '1' : '0'); } catch {}
  if (panel) {
    panel.hidden = !next;
    panel.style.display = next ? 'block' : 'none';
  }
  if (next) void loadChromeProfileSettings();
}

function selectInHouseBrowserProfile(profileId) {
  const value = setStoredInHouseProfileId(profileId);
  window.dispatchEvent(new CustomEvent('prometheus-inhouse-profile-changed', { detail: { profileId: value } }));
  const sessionId = String(window.activeChatSessionId || window.agentSessionId || '').trim();
  if (sessionId && window.ws && window.ws.readyState === WebSocket.OPEN) {
    try {
      window.ws.send(JSON.stringify({
        type: 'browser:profile_preference',
        sessionId,
        profile: value,
        timestamp: Date.now(),
      }));
    } catch {}
  }
  setChromeProfileImportStatus(value === 'main' ? 'New in-app browser sessions use the Prometheus profile.' : 'New in-app browser sessions use the imported profile.', '');
}

async function importSelectedChromeProfile() {
  const bridge = getChromeProfilesBridge();
  const select = document.getElementById('settings-chrome-profile-select');
  const profileId = String(select?.value || '').trim();
  const profile = chromeProfileCatalog.profiles.find((entry) => entry.id === profileId);
  if (!bridge || !profileId || !profile) {
    setChromeProfileImportStatus('Choose a detected Chrome profile first.', 'error');
    return;
  }
  const confirmed = await new Promise((resolve) => showConfirm(
    `Prometheus will copy “${profile.name || profile.directory}” into its own persistent browser storage. Your Chrome profile will not be modified.`,
    () => resolve(true),
    () => resolve(false),
    {
      title: 'Import Chrome profile?',
      confirmText: 'Import profile',
      cancelText: 'Cancel',
      details: `Source: ${profile.sourceLabel || 'Chrome'} · ${profile.directory}\nClose Chrome before importing. Passwords and cookies may require signing in again when the operating system encrypts them for the original browser app.`,
    },
  ));
  if (!confirmed) return;
  try {
    setChromeProfileImportStatus('Copying profile data…');
    const imported = await bridge.import(profileId);
    await loadChromeProfileSettings();
    if (imported?.id) {
      setStoredInHouseProfileId(imported.id);
      const defaultSelect = document.getElementById('settings-browser-profile-default');
      if (defaultSelect) defaultSelect.value = imported.id;
    }
    setChromeProfileImportStatus(`Imported ${imported?.name || profile.name || profile.directory}. New in-app browser sessions can use it from the profile selector.`, 'success');
  } catch (error) {
    setChromeProfileImportStatus(`Chrome profile import failed: ${error?.message || error}`, 'error');
  }
}

async function openSettings(tab) {
  _scheduleSettingsVisibilityRefresh();
  document.getElementById('settings-modal').style.display = 'flex';
  document.body.classList.add('settings-page-open');
  window.queueNativeBrowserSurfaceSync?.({ force: true });
  const settingsSearch = document.getElementById('settings-search-input');
  if (settingsSearch) {
    settingsSearch.value = '';
    if (typeof window.filterSettingsTabs === 'function') window.filterSettingsTabs('');
  }
  window._settingsPathsLoadedToUI = false;
  window._settingsSearchLoadedToUI = false;
  window._settingsCredentialsLoadedToUI = false;
  resetCommandPermissionListVisibility();
  setSettingsSaveFeedback();
  const importToggle = document.getElementById('settings-browser-profile-import-toggle');
  let importPanelOpen = false;
  try { importPanelOpen = localStorage.getItem('prometheus.chrome-profile-import.open') === '1'; } catch {}
  if (importToggle) importToggle.checked = importPanelOpen;
  toggleChromeProfileImportPanel(importPanelOpen);
  const targetTab = tab || window.settingsTab || 'system';
  setSettingsTab(targetTab);
  const bootJobs = [
    api('/api/status', { timeoutMs: 5000 }).then((status) => {
      const runtimeModelEl = document.getElementById('settings-runtime-model');
      const runtimeGatewayEl = document.getElementById('settings-runtime-gateway');
      const runtimeOllamaEl = document.getElementById('settings-runtime-ollama');
      if (runtimeModelEl) runtimeModelEl.textContent = status.currentModel || '-';
      if (runtimeGatewayEl) runtimeGatewayEl.textContent = status.gateway || '-';
      if (runtimeOllamaEl) runtimeOllamaEl.textContent = status.ollama ? 'Online' : 'Offline';
    }).catch(() => {}),
    api('/api/settings/paths', { timeoutMs: 5000 }).then((paths) => {
      const workspaceEl = document.getElementById('settings-workspace-path');
      const allowedEl = document.getElementById('settings-allowed-paths');
      const blockedEl = document.getElementById('settings-blocked-paths');
      if (workspaceEl) workspaceEl.value = paths.workspace_path || '';
      if (allowedEl) allowedEl.value = (paths.allowed_paths || []).join('\n');
      if (blockedEl) blockedEl.value = (paths.blocked_paths || []).join('\n');
      window._settingsPathsLoadedToUI = true;
    }).catch(() => {
      window._settingsPathsLoadedToUI = false;
    }),
    loadSearchSettingsSummary().then(() => {
      const providerEl = document.getElementById('settings-provider');
      const rigorEl = document.getElementById('settings-search-rigor');
      const s = {
        preferred_provider: document.getElementById('r-failed')?.textContent || 'tavily',
        search_rigor: quickSearchRigor,
      };
      if (providerEl) providerEl.value = s.preferred_provider;
      if (rigorEl) rigorEl.value = s.search_rigor;
      window._settingsSearchLoadedToUI = true;
    }).catch(() => {
      window._settingsSearchLoadedToUI = false;
    }),
    loadChromeProfileSettings().catch(() => {}),
    loadSessionCompactionSettings().catch(() => {}),
    loadAutoSettleSettings().catch(() => {}),
  ];
  Promise.allSettled(bootJobs).catch(() => {});
}

function closeSettings() {
  setSettingsSaveFeedback();
  const modal = document.getElementById('settings-modal');
  if (modal) modal.style.display = 'none';
  document.body.classList.remove('settings-page-open');
  document.body.classList.remove('pm-mobile-overlay-open');
  window.queueNativeBrowserSurfaceSync?.({ force: true });
  channelsStatusLoaded = false;
  _settingsAgentsLoadedSelection = '';
  returnFromMobileSettings(window.location);
}

// -- P11-37 external import panel -----------------------------------------------------------------------------------------------
let externalImportJobs = [];
const selectedExternalImportJobs = { conversation: null, setup: null };
let externalImportDiscoverySources = [];
let externalImportDiscoveryLoading = false;
let externalImportDiscoveryError = '';
let externalImportBatchState = null;
const externalImportConversationSelections = new Map();
const externalImportConversationViews = new Map();

function formatExternalImportBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 100 * 1024 * 1024 ? 1 : 0)} MB`;
}

function externalImportDiscoverySourceTitle(source) {
  const label = String(source?.label || source?.provider || 'Source').trim();
  return label.replace(/\s+setup$/i, '');
}

function externalImportDiscoverySourceDetail(source) {
  const kind = source?.kind === 'setup' ? 'setup' : 'conversation';
  const count = kind === 'setup' ? Number(source?.setupFileCount || 0) : Number(source?.transcriptCount || 0);
  const mcpSource = /mcp|integration/i.test(String(source?.label || ''));
  const unit = kind === 'setup'
    ? (mcpSource ? (count === 1 ? 'MCP config file' : 'MCP config files') : (count === 1 ? 'setup file' : 'setup files'))
    : (count === 1 ? 'transcript' : 'transcripts');
  const size = formatExternalImportBytes(source?.bytes);
  const batches = Number(source?.batches?.length || 0);
  return `${count} ${unit} found${size ? ` · ${size}` : ''}${batches > 1 ? ` · ${batches} safe batches` : ''}`;
}

function renderExternalImportDiscovery() {
  const el = document.getElementById('settings-import-discovery');
  if (!el) return;
  if (externalImportDiscoveryLoading) {
    el.innerHTML = '<div class="settings-import-discovery-empty">Scanning known local agent folders…</div>';
    return;
  }
  if (externalImportDiscoveryError) {
    el.innerHTML = `<div class="settings-import-discovery-empty settings-import-discovery-empty--error">${escHtml(externalImportDiscoveryError)} <button class="settings-inline-link" type="button" onclick="loadExternalImportDiscovery()">Try again</button></div>`;
    return;
  }
  if (!externalImportDiscoverySources.length) {
    el.innerHTML = '<div class="settings-import-discovery-empty">No supported local transcripts or setup files were found. You can still choose an export or folder below.</div>';
    return;
  }
  el.innerHTML = externalImportDiscoverySources.map((source) => {
    const sourceId = String(source?.id || '');
    const kind = source?.kind === 'setup' ? 'setup' : 'conversation';
    const previewable = source?.previewable !== false;
    const batchable = kind === 'conversation' && source?.batchable === true && Array.isArray(source?.batches) && source.batches.length > 0;
    const action = previewable
      ? (kind === 'setup' ? 'Preview MCP integrations' : source?.supportsProjects ? 'Preview projects + chats' : 'Preview chats')
      : batchable ? 'Preview projects + chats' : 'Choose smaller folder';
    const notes = Array.isArray(source?.notes) ? source.notes.slice(0, 2) : [];
    const noteHtml = notes.length ? `<div class="settings-import-discovery-notes">${notes.map((note) => `<span>${escHtml(note)}</span>`).join('')}</div>` : '';
    const capped = source?.capped ? '<span class="settings-import-discovery-warning">bounded scan</span>' : '';
    const buttonAttrs = previewable
      ? `onclick="previewDiscoveredExternalImport('${escHtml(sourceId)}')"`
      : batchable
        ? `onclick="previewDiscoveredExternalImportBatches('${escHtml(sourceId)}','projects')"`
        : `disabled title="${escHtml(String(source?.previewBlockReason || 'Choose a smaller source folder for preview.'))}"`;
    const batchButton = batchable
      ? `<button class="settings-inline-link" type="button" onclick="previewDiscoveredExternalImportBatches('${escHtml(sourceId)}','projects')">Preview all chats in safe batches</button>`
      : '';
    return `
      <article class="settings-import-discovery-source">
        <div class="settings-import-discovery-source-copy">
          <div class="settings-import-discovery-source-title"><strong>${escHtml(externalImportDiscoverySourceTitle(source))}</strong>${capped}</div>
          <div class="settings-import-discovery-source-detail">${escHtml(externalImportDiscoverySourceDetail(source))}</div>
          ${noteHtml}
        </div>
        <div class="settings-import-discovery-actions">
          <button class="btn btn-sm" type="button" ${buttonAttrs}>${action}</button>
          ${batchButton}
        </div>
      </article>
    `;
  }).join('');
}

async function loadExternalImportDiscovery() {
  externalImportDiscoveryLoading = true;
  externalImportDiscoveryError = '';
  renderExternalImportDiscovery();
  try {
    const data = await api('/api/imports/discover', { timeoutMs: 30000 });
    externalImportDiscoverySources = Array.isArray(data?.sources) ? data.sources : [];
  } catch (error) {
    externalImportDiscoverySources = [];
    externalImportDiscoveryError = `Could not scan local agent folders: ${error.message}`;
  } finally {
    externalImportDiscoveryLoading = false;
    renderExternalImportDiscovery();
  }
}

function externalImportStatus(kind, type, message) {
  const el = document.getElementById(`settings-import-${kind}-status`);
  if (!el) return;
  setSettingsStatus(el, type, message);
}

function externalImportJobLabel(job) {
  const status = String(job?.status || '').replace(/_/g, ' ');
  const phase = String(job?.progress?.phase || '').replace(/_/g, ' ');
  const completed = Number(job?.progress?.completed || 0);
  const total = Number(job?.progress?.total || 0);
  if (status === 'preview ready') return 'Preview ready — nothing committed yet.';
  if (status === 'completed') return job?.conversationMode === 'projects'
    ? 'Imported as Prometheus projects with linked threads.'
    : 'Imported and available as Prometheus threads.';
  if (status === 'partial') return `Partially imported — ${completed}/${total || completed} items processed.`;
  if (status === 'failed') return `Import failed${job?.error ? `: ${job.error}` : '.'}`;
  if (status === 'rolled back') return 'Rolled back; imported active state was removed.';
  if (status === 'deleted') return 'Import record deleted.';
  return `${phase || status || 'working'}${total ? ` — ${completed}/${total}` : ''}`;
}

function renderExternalImportJob(kind, job) {
  const el = document.getElementById(`settings-import-${kind}-job`);
  if (!el) return;
  if (!job) {
    el.innerHTML = kind === 'setup'
      ? '<div class="settings-import-empty">No staged MCP integration preview. Choose a detected config or local MCP file and preview it.</div>'
      : '<div class="settings-import-empty">No staged import. Choose a local export or conversation folder and build a preview.</div>';
    return;
  }
  const preview = job.preview || {};
  const result = job.result || {};
  const warnings = Array.isArray(preview.warnings) ? preview.warnings : [];
  const status = String(job.status || '');
  const jobId = String(job.id || '');
  const canConfirm = status === 'preview_ready';
  const selectedCount = kind === 'conversation' ? externalImportSelectedConversationIds(job).size : 0;
  const canRetry = status === 'failed' || status === 'partial';
  const counts = kind === 'conversation'
    ? `${Number(preview.conversations || 0)} chats · ${Number(preview.projects || 0)} projects · ${Number(preview.messages || 0)} messages · ${Number(preview.resources || 0)} attachments`
    : `${Number(preview.mcpServers || 0)} MCP integrations · ${Number(preview.secretsRedacted || 0)} reauthorizations required · ${Number(preview.conflicts || 0)} conflicts`;
  const summaryHtml = kind === 'conversation' ? renderExternalImportConversationSelection(job) : '';
  const warningHtml = warnings.length
    ? `<div class="settings-import-warning"><strong>Review warnings</strong><ul>${warnings.slice(0, 6).map((warning) => `<li>${escHtml(warning)}</li>`).join('')}</ul></div>`
    : '';
  const resultHtml = (result.sessionIds?.length || result.projectIds?.length || result.mcpServerIds?.length || result.failures?.length)
    ? `<div class="settings-import-result">${kind === 'conversation' ? `${Number(result.sessionIds?.length || 0)} Prometheus threads${result.projectIds?.length ? ` · ${Number(result.projectIds.length)} projects` : ''}` : `${Number(result.mcpServerIds?.length || 0)} MCP integrations`} · ${Number(result.skipped || 0)} skipped${result.failures?.length ? ` · ${Number(result.failures.length)} failures` : ''}</div>`
    : '';
  const setupResultAction = kind === 'setup' && result.mcpServerIds?.length
    ? '<button class="settings-inline-link" type="button" onclick="setMode(\'plugins\')">Open Plugins to authorize</button>'
    : '';
  el.innerHTML = `
    <div class="settings-import-job-head"><span class="settings-import-job-status settings-import-job-status--${escHtml(status)}">${escHtml(status.replace(/_/g, ' ') || 'staged')}</span><span>${escHtml(externalImportJobLabel(job))}</span></div>
    <div class="settings-import-counts">${escHtml(counts)}</div>
    ${summaryHtml}
    ${warningHtml}
    ${resultHtml}
    ${setupResultAction}
    <div class="settings-import-actions">
      ${canConfirm && kind === 'conversation' ? `<button class="btn btn-sm" onclick="confirmExternalImportJob('${escHtml(jobId)}','${kind}')" ${selectedCount ? '' : 'disabled'}>Import selected chats${selectedCount ? ` (${selectedCount})` : ''}</button>` : ''}
      ${canConfirm && kind !== 'conversation' ? `<button class="btn btn-sm" onclick="confirmExternalImportJob('${escHtml(jobId)}','${kind}')">Confirm import</button>` : ''}
      ${canRetry ? `<button class="btn btn-sm" onclick="retryExternalImportJob('${escHtml(jobId)}','${kind}')">Retry</button>` : ''}
    </div>
  `;
}

function externalImportHistoryLabel(job) {
  const provider = String(job?.provider || job?.sourceLabel || 'Source').trim();
  const status = String(job?.status || 'staged').replace(/_/g, ' ');
  const preview = job?.preview || {};
  const count = job?.kind === 'conversation'
    ? `${Number(preview.conversations || job?.result?.sessionIds?.length || 0)} chats`
    : `${Number(preview.mcpServers || job?.result?.mcpServerIds?.length || 0)} MCP integrations`;
  return `${provider} · ${count} · ${status}`;
}

function renderExternalImportHistory() {
  const el = document.getElementById('settings-import-history-list');
  if (!el) return;
  const jobs = externalImportJobs
    .filter((job) => job && job.status !== 'deleted')
    .filter((job) => ['completed', 'partial', 'failed', 'rolled_back'].includes(String(job.status || '')))
    .slice(0, 24);
  if (!jobs.length) {
    el.innerHTML = '<div class="settings-import-empty">No completed imports or rollback records yet.</div>';
    return;
  }
  el.innerHTML = jobs.map((job) => {
    const id = escHtml(String(job.id || ''));
    const kind = job.kind === 'setup' ? 'setup' : 'conversation';
    const canRollback = ['completed', 'partial'].includes(String(job.status || ''));
    const canDelete = ['rolled_back', 'failed'].includes(String(job.status || ''));
    const action = canRollback
      ? `<button class="settings-inline-link" type="button" onclick="rollbackExternalImportJob('${id}','${kind}')">Roll back</button>`
      : canDelete
        ? `<button class="settings-danger-button" type="button" onclick="deleteExternalImportJob('${id}','${kind}')">Delete record</button>`
        : '';
    return `<div class="settings-import-history-row"><div class="settings-import-history-copy"><strong>${escHtml(externalImportHistoryLabel(job))}</strong><small>${escHtml(String(job.sourceLabel || job.provider || 'Imported source'))}</small></div><span class="settings-import-history-actions"><time datetime="${escHtml(String(job.updatedAt || ''))}">${escHtml(externalImportPreviewTimestamp(Date.parse(String(job.updatedAt || ''))))}</time>${action}</span></div>`;
  }).join('');
}

function upsertExternalImportJobRecord(job) {
  if (!job?.id) return;
  externalImportJobs = [job, ...externalImportJobs.filter((item) => String(item?.id || '') !== String(job.id))];
  renderExternalImportHistory();
}

async function loadExternalImportJobs() {
  try {
    const data = await api('/api/imports/jobs');
    externalImportJobs = Array.isArray(data?.jobs) ? data.jobs : [];
    for (const kind of ['conversation', 'setup']) {
      const latest = externalImportJobs.find((job) => job.kind === kind && job.status !== 'deleted') || null;
      selectedExternalImportJobs[kind] = latest;
      renderExternalImportJob(kind, latest);
    }
    renderExternalImportHistory();
  } catch (error) {
    externalImportStatus('conversation', 'error', `Could not load import history: ${error.message}`);
    externalImportStatus('setup', 'error', `Could not load import history: ${error.message}`);
  }
}

function externalImportForm(kind, discoveredSource = null, requestedConversationMode = '') {
  const path = String(discoveredSource?.sourcePath || document.getElementById(`settings-import-${kind}-path`)?.value || '').trim();
  const sourceLabel = String(document.getElementById(`settings-import-${kind}-label`)?.value || '').trim();
  const adapter = kind === 'setup'
    ? 'setup-config'
    : String(discoveredSource?.adapter || '').trim();
  const sourceFiles = Array.isArray(discoveredSource?.sourceFiles)
    ? discoveredSource.sourceFiles.filter((value) => typeof value === 'string' && value.trim()).slice(0, 8000)
    : [];
  return {
    kind,
    sourcePath: path,
    sourceLabel: sourceLabel || String(discoveredSource?.label || '').trim() || undefined,
    adapter: adapter || undefined,
    conversationMode: kind === 'conversation'
      ? 'projects'
      : undefined,
    setupScope: kind === 'setup' ? 'mcp' : undefined,
    overwrite: false,
    ...(sourceFiles.length ? { sourceFiles } : {}),
  };
}

async function previewExternalImportJob(kind, discoveredSource = null, requestedConversationMode = '') {
  const body = externalImportForm(kind, discoveredSource, requestedConversationMode);
  if (!body.sourcePath) {
    externalImportStatus(kind, 'error', 'Choose a detected source or enter a local export, session folder, or setup folder path first.');
    return;
  }
  externalImportStatus(kind, 'info', 'Staging and parsing. No Prometheus state changes until you confirm.');
  try {
    const data = await api('/api/imports/jobs', {
      method: 'POST',
      body: JSON.stringify(body),
      timeoutMs: 120000,
    });
    selectedExternalImportJobs[kind] = data.job;
    upsertExternalImportJobRecord(data.job);
    renderExternalImportJob(kind, data.job);
    externalImportStatus(kind, 'success', data.idempotent ? 'Existing matching preview reused.' : 'Preview ready. Review it, then confirm explicitly.');
  } catch (error) {
    externalImportStatus(kind, 'error', `Preview failed: ${error.message}`);
  }
}

async function previewDiscoveredExternalImport(sourceId, mode = 'projects') {
  const source = externalImportDiscoverySources.find((item) => String(item?.id || '') === String(sourceId || ''));
  if (!source) {
    externalImportDiscoveryError = 'That detected source is no longer available. Scan again to refresh the list.';
    renderExternalImportDiscovery();
    return;
  }
  await previewExternalImportJob(source.kind === 'setup' ? 'setup' : 'conversation', source, 'projects');
}

function externalImportConversationSummaries(job) {
  const summaries = Array.isArray(job?.preview?.conversationSummaries) ? [...job.preview.conversationSummaries] : [];
  return summaries.sort((a, b) => {
    const updatedDelta = (Number(b?.updatedAt) || 0) - (Number(a?.updatedAt) || 0);
    return updatedDelta || String(a?.id || '').localeCompare(String(b?.id || ''));
  });
}

function externalImportSelectedConversationIds(job) {
  const jobId = String(job?.id || '');
  const available = new Set(externalImportConversationSummaries(job).map((item) => String(item?.id || '')).filter(Boolean));
  const existing = externalImportConversationSelections.get(jobId);
  if (existing) return new Set([...existing].filter((id) => available.has(id)));
  const persisted = Array.isArray(job?.selectedConversationIds) ? job.selectedConversationIds : [];
  const selected = new Set(persisted.map((value) => String(value || '')).filter((id) => available.has(id)));
  externalImportConversationSelections.set(jobId, selected);
  return new Set(selected);
}

function externalImportPreviewTimestamp(value) {
  const timestamp = Number(value || 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'date unavailable';
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function externalImportPreviewDatetime(value) {
  const timestamp = Number(value || 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  return new Date(timestamp).toISOString();
}

function renderExternalImportConversationSelection(job, compact = false) {
  if (!job || job.kind !== 'conversation') return '';
  const summaries = externalImportConversationSummaries(job);
  if (!summaries.length) return '';
  const selected = externalImportSelectedConversationIds(job);
  const preview = job.preview || {};
  const total = Number(preview.conversationSummariesTotal || preview.conversations || summaries.length);
  const canSelect = job.status === 'preview_ready';
  const truncated = preview.conversationSummariesTruncated === true || total > summaries.length;
  const projectSummaries = Array.isArray(preview.projectSummaries) ? preview.projectSummaries : [];
  const projectMap = new Map(projectSummaries.map((project) => [String(project?.id || ''), project]));
  const projectGroups = [];
  const groupMap = new Map();
  const regularChats = [];
  for (const item of summaries) {
    const projectId = String(item?.projectId || '').trim();
    const projectName = String(item?.projectName || '').trim();
    if (!projectId && !projectName) {
      regularChats.push(item);
      continue;
    }
    const key = projectId || `name:${projectName}`;
    let group = groupMap.get(key);
    if (!group) {
      const source = projectMap.get(projectId) || {};
      group = {
        id: projectId || key,
        name: projectName || String(source.name || projectId || 'Imported project'),
        sourcePath: String(source.sourcePath || '').trim(),
        items: [],
      };
      groupMap.set(key, group);
      projectGroups.push(group);
    }
    group.items.push(item);
  }
  const viewKey = String(job.id || '');
  const view = externalImportConversationViews.get(viewKey) || (projectGroups.length ? 'projects' : 'chats');

  const renderRow = (item, compactRow = false) => {
    const id = String(item?.id || '');
    const title = String(item?.title || id || 'Untitled chat');
    const detail = `${Number(item?.messages || 0)} messages${Number(item?.resources || 0) ? ` · ${Number(item.resources)} attachments` : ''}`;
    return `
      <label class="settings-import-selection-row${compactRow ? ' settings-import-selection-row--project-chat' : ''}">
        <input type="checkbox" data-import-job-id="${escHtml(job.id)}" data-conversation-id="${escHtml(id)}" ${selected.has(id) ? 'checked' : ''} ${canSelect ? '' : 'disabled'} onchange="toggleExternalImportConversation(this)" />
        <span class="settings-import-selection-copy"><strong>${escHtml(title)}</strong><small>${escHtml(detail)}</small></span>
        <time datetime="${escHtml(externalImportPreviewDatetime(item?.updatedAt || item?.createdAt))}">${escHtml(externalImportPreviewTimestamp(item?.updatedAt || item?.createdAt))}</time>
      </label>`;
  };
  const renderProject = (group) => {
    const ids = group.items.map((item) => String(item?.id || '')).filter(Boolean);
    const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
    const rows = group.items.map((item) => renderRow(item, true)).join('');
    return `<details class="settings-import-project-group" open>
      <summary>
        <input type="checkbox" data-import-job-id="${escHtml(job.id)}" data-import-project-id="${escHtml(group.id)}" ${allSelected ? 'checked' : ''} ${canSelect ? '' : 'disabled'} onchange="toggleExternalImportProject(this); event.stopPropagation();" />
        <span class="settings-import-project-group-copy"><strong>${escHtml(group.name)}</strong><small>${group.items.length} chat${group.items.length === 1 ? '' : 's'}${group.sourcePath ? ` · ${escHtml(group.sourcePath)}` : ''}</small></span>
      </summary>
      <div class="settings-import-project-group-chats">${rows}</div>
    </details>`;
  };
  const visibleRows = view === 'projects'
    ? projectGroups.map(renderProject).join('')
    : regularChats.map((item) => renderRow(item)).join('');
  const emptyView = view === 'projects' && !projectGroups.length
    ? '<div class="settings-import-empty">No source projects were detected in this preview.</div>'
    : view === 'chats' && !regularChats.length
      ? '<div class="settings-import-empty">No top-level chats were detected. Chats inside projects are shown in Projects.</div>'
      : '';
  return `
    <section class="settings-import-selection${compact ? ' settings-import-selection--compact' : ''}">
      <div class="settings-import-selection-head">
        <div><strong>${projectGroups.length ? 'Review projects and chats' : 'Select chats to import'}</strong><small>${selected.size}/${total} selected · newest first</small></div>
        <div class="settings-import-selection-actions">
          <button class="settings-inline-link" type="button" data-import-job-id="${escHtml(job.id)}" onclick="setExternalImportConversationSelection(this,true)" ${canSelect ? '' : 'disabled'}>Select all</button>
          <button class="settings-inline-link" type="button" data-import-job-id="${escHtml(job.id)}" onclick="setExternalImportConversationSelection(this,false)" ${canSelect ? '' : 'disabled'}>Clear</button>
        </div>
      </div>
      ${projectGroups.length ? `<div class="settings-import-view-tabs" role="tablist" aria-label="Import preview view"><button type="button" class="settings-import-view-tab${view === 'projects' ? ' is-active' : ''}" role="tab" aria-selected="${view === 'projects'}" data-import-job-id="${escHtml(job.id)}" onclick="setExternalImportConversationView(this,'projects')">Projects (${projectGroups.length})</button><button type="button" class="settings-import-view-tab${view === 'chats' ? ' is-active' : ''}" role="tab" aria-selected="${view === 'chats'}" data-import-job-id="${escHtml(job.id)}" onclick="setExternalImportConversationView(this,'chats')">Chats (${regularChats.length})</button></div>` : ''}
      ${canSelect ? '<div class="settings-import-inline-note">Select individual chats or a whole project, then confirm. Selecting chats inside a project creates that Prometheus project with only those chats.</div>' : ''}
      ${truncated ? `<div class="settings-import-inline-note">Showing ${summaries.length} of ${total} chats in this preview. Narrow the source if you need a smaller review set.</div>` : ''}
      <div class="settings-import-selection-list">${emptyView || visibleRows}</div>
    </section>`;
}

function setExternalImportConversationView(button, view) {
  const job = externalImportJobForSelection(button?.dataset?.importJobId);
  if (!job) return;
  externalImportConversationViews.set(String(job.id), view === 'chats' ? 'chats' : 'projects');
  refreshExternalImportSelection(job);
}

function toggleExternalImportProject(input) {
  const job = externalImportJobForSelection(input?.dataset?.importJobId);
  if (!job || job.status !== 'preview_ready') return;
  const projectId = String(input?.dataset?.importProjectId || '');
  const summaries = externalImportConversationSummaries(job);
  const previewProjects = Array.isArray(job.preview?.projectSummaries) ? job.preview.projectSummaries : [];
  const project = previewProjects.find((item) => String(item?.id || '') === projectId);
  const projectName = String(project?.name || '').trim();
  const ids = summaries
    .filter((item) => String(item?.projectId || '') === projectId || (!projectId.startsWith('name:') && String(item?.projectName || '').trim() === projectName) || (projectId.startsWith('name:') && `name:${String(item?.projectName || '').trim()}` === projectId))
    .map((item) => String(item?.id || ''))
    .filter(Boolean);
  const selected = externalImportSelectedConversationIds(job);
  ids.forEach((id) => input.checked ? selected.add(id) : selected.delete(id));
  externalImportConversationSelections.set(String(job.id), selected);
  refreshExternalImportSelection(job);
}

function externalImportJobForSelection(jobId) {
  const id = String(jobId || '');
  const batchJob = externalImportBatchState?.jobs.find((job) => String(job.id || '') === id);
  if (batchJob) return batchJob;
  if (String(selectedExternalImportJobs.conversation?.id || '') === id) return selectedExternalImportJobs.conversation;
  return null;
}

function refreshExternalImportSelection(job) {
  if (!job) return;
  const isBatchJob = externalImportBatchState?.jobs.some((item) => String(item.id || '') === String(job.id || ''));
  if (isBatchJob) {
    renderExternalImportBatchJobs();
  } else {
    renderExternalImportJob('conversation', job);
  }
}

function toggleExternalImportConversation(input) {
  const job = externalImportJobForSelection(input?.dataset?.importJobId);
  if (!job || job.status !== 'preview_ready') return;
  const id = String(input?.dataset?.conversationId || '');
  const selected = externalImportSelectedConversationIds(job);
  if (input.checked) selected.add(id); else selected.delete(id);
  externalImportConversationSelections.set(String(job.id), selected);
  refreshExternalImportSelection(job);
}

function setExternalImportConversationSelection(button, shouldSelect) {
  const job = externalImportJobForSelection(button?.dataset?.importJobId);
  if (!job || job.status !== 'preview_ready') return;
  const ids = externalImportConversationSummaries(job).map((item) => String(item?.id || '')).filter(Boolean);
  externalImportConversationSelections.set(String(job.id), shouldSelect ? new Set(ids) : new Set());
  refreshExternalImportSelection(job);
}

function renderExternalImportBatchJobs() {
  const el = document.getElementById('settings-import-conversation-batches');
  if (!el) return;
  const state = externalImportBatchState;
  if (!state || (!state.jobs.length && !state.running && !state.errors.length)) {
    el.innerHTML = '';
    return;
  }
  const jobs = state.jobs;
  const ready = jobs.filter((job) => job.status === 'preview_ready');
  const completed = jobs.filter((job) => job.status === 'completed');
  const failed = jobs.filter((job) => ['failed', 'partial'].includes(job.status));
  const totalConversations = jobs.reduce((sum, job) => sum + Number(job.preview?.conversations || 0), 0);
  const totalMessages = jobs.reduce((sum, job) => sum + Number(job.preview?.messages || 0), 0);
  const selectedReady = ready.filter((job) => externalImportSelectedConversationIds(job).size > 0);
  const canConfirmAll = !state.running && selectedReady.length > 0 && failed.length === 0;
  const rows = jobs.map((job) => {
    const label = String(job.sourceLabel || job.id || 'Codex batch').replace(/^Codex\s*·\s*/i, '');
    const preview = job.preview || {};
    const selectedCount = externalImportSelectedConversationIds(job).size;
    const action = job.status === 'preview_ready'
      ? `<button class="settings-inline-link" type="button" onclick="confirmExternalImportBatchJob('${escHtml(job.id)}')" ${selectedCount ? '' : 'disabled'}>Import selected${selectedCount ? ` (${selectedCount})` : ''}</button>`
      : ['failed', 'partial'].includes(job.status)
          ? `<button class="settings-inline-link" type="button" onclick="retryExternalImportBatchJob('${escHtml(job.id)}')">Retry</button>`
        : '';
    return `<div class="settings-import-batch-row"><div class="settings-import-batch-row-head"><strong>${escHtml(label)}</strong><small>${Number(preview.conversations || 0)} chats · ${Number(preview.messages || 0)} messages</small></div><span class="settings-import-batch-row-actions"><em>${escHtml(String(job.status || 'staged').replace(/_/g, ' '))}</em>${action}</span>${renderExternalImportConversationSelection(job, true)}</div>`;
  }).join('');
  const errors = state.errors.length
    ? `<div class="settings-import-warning"><strong>Some batches could not be staged</strong><ul>${state.errors.slice(0, 8).map((error) => `<li>${escHtml(error)}</li>`).join('')}</ul></div>`
    : '';
  el.innerHTML = `
    <div class="settings-import-batch-head"><strong>Codex batch plan</strong><span>${completed.length}/${jobs.length} imported</span></div>
    <div class="settings-import-counts">${totalConversations} chats · ${totalMessages} messages · each batch has its own durable preview, retry, and rollback record.</div>
    ${state.running ? `<div class="settings-import-inline-note">Building preview ${jobs.length + 1}… no Prometheus state has been committed.</div>` : ''}
    ${errors}
    <div class="settings-import-batch-list">${rows}</div>
    ${canConfirmAll ? `<button class="btn btn-sm" type="button" onclick="confirmExternalImportBatches()">Confirm selected chats (${selectedReady.reduce((sum, job) => sum + externalImportSelectedConversationIds(job).size, 0)})</button>` : ''}
  `;
}

async function previewDiscoveredExternalImportBatches(sourceId, mode = 'projects') {
  const source = externalImportDiscoverySources.find((item) => String(item?.id || '') === String(sourceId || ''));
  const batches = Array.isArray(source?.batches) ? source.batches : [];
  if (!source || !batches.length) {
    externalImportStatus('conversation', 'error', 'No safe Codex batches are available. Scan again or choose a smaller source folder.');
    return;
  }
  externalImportBatchState = { source, mode, jobs: [], errors: [], running: true };
  renderExternalImportBatchJobs();
  externalImportStatus('conversation', 'info', `Building ${batches.length} bounded Codex previews. Nothing is committed yet.`);
  for (const batch of batches) {
    try {
      const batchSource = {
        ...source,
        label: `${source.label} · ${batch.label}`,
        sourceFiles: batch.sourceFiles,
      };
      const body = externalImportForm('conversation', batchSource, mode);
      const data = await api('/api/imports/jobs', { method: 'POST', body: JSON.stringify(body), timeoutMs: 120000 });
      externalImportBatchState.jobs.push(data.job);
      upsertExternalImportJobRecord(data.job);
      selectedExternalImportJobs.conversation = data.job;
    } catch (error) {
      externalImportBatchState.errors.push(`${batch.label}: ${error.message}`);
    }
    renderExternalImportBatchJobs();
  }
  externalImportBatchState.running = false;
  renderExternalImportBatchJobs();
  const state = externalImportBatchState;
  externalImportStatus('conversation', state.errors.length ? 'error' : 'success', state.errors.length ? 'Some Codex batches need attention.' : 'All Codex batches are previewed. Confirm when ready.');
}

function replaceExternalImportBatchJob(nextJob) {
  if (!externalImportBatchState) return;
  externalImportBatchState.jobs = externalImportBatchState.jobs.map((job) => String(job.id) === String(nextJob.id) ? nextJob : job);
  selectedExternalImportJobs.conversation = nextJob;
  renderExternalImportBatchJobs();
}

async function confirmExternalImportBatchJob(jobId, skipPrompt = false) {
  const job = externalImportBatchState?.jobs.find((item) => String(item.id) === String(jobId));
  if (!job || job.status !== 'preview_ready') return;
  const conversationIds = [...externalImportSelectedConversationIds(job)];
  if (!conversationIds.length) {
    externalImportStatus('conversation', 'error', 'Select at least one chat in this batch before importing.');
    return;
  }
  if (!skipPrompt) {
    const ok = await new Promise((resolve) => showConfirm(`Import ${conversationIds.length} selected chat${conversationIds.length === 1 ? '' : 's'}?`, () => resolve(true), () => resolve(false), {
      title: 'Confirm Codex batch import',
      confirmText: 'Import selected',
      details: 'Only the chats you selected will be committed. Historical tool activity remains historical-only and the batch can be rolled back independently.',
    }));
    if (!ok) return;
  }
  try {
    const data = await api(`/api/imports/jobs/${encodeURIComponent(jobId)}/confirm`, { method: 'POST', body: JSON.stringify({ confirm: true, conversationIds }), timeoutMs: 120000 });
    replaceExternalImportBatchJob(data.job);
    upsertExternalImportJobRecord(data.job);
  } catch (error) {
    externalImportStatus('conversation', 'error', `Codex batch import failed: ${error.message}`);
  }
}

async function retryExternalImportBatchJob(jobId) {
  const job = externalImportBatchState?.jobs.find((item) => String(item.id) === String(jobId));
  if (!job || !['failed', 'partial'].includes(job.status)) return;
  try {
    const data = await api(`/api/imports/jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST', timeoutMs: 120000 });
    replaceExternalImportBatchJob(data.job);
    upsertExternalImportJobRecord(data.job);
    externalImportStatus('conversation', data.job?.status === 'failed' ? 'error' : 'success', data.job?.status === 'preview_ready' ? 'Codex batch preview rebuilt.' : externalImportJobLabel(data.job));
  } catch (error) {
    externalImportStatus('conversation', 'error', `Codex batch retry failed: ${error.message}`);
  }
}

async function confirmExternalImportBatches() {
  const state = externalImportBatchState;
  if (!state || state.running) return;
  const ready = state.jobs.filter((job) => job.status === 'preview_ready' && externalImportSelectedConversationIds(job).size > 0);
  if (!ready.length) return;
  const totalMessages = ready.reduce((sum, job) => sum + Number(job.preview?.messages || 0), 0);
  const totalSelected = ready.reduce((sum, job) => sum + externalImportSelectedConversationIds(job).size, 0);
  const ok = await new Promise((resolve) => showConfirm(
    `Import ${totalSelected} selected Codex chats?`,
    () => resolve(true),
    () => resolve(false),
    { title: 'Confirm selected Codex chats', confirmText: 'Import selected chats', details: `${totalMessages} historical messages across ${ready.length} independently staged batches. Unselected chats remain in their previews.` },
  ));
  if (!ok) return;
  state.running = true;
  renderExternalImportBatchJobs();
  for (const job of ready) await confirmExternalImportBatchJob(job.id, true);
  state.running = false;
  renderExternalImportBatchJobs();
  externalImportStatus('conversation', 'success', 'Codex batch import finished. Review any remaining batch previews above.');
  if (typeof window.loadChatSessions === 'function') await window.loadChatSessions();
}

async function rollbackExternalImportBatchJob(jobId) {
  const job = externalImportBatchState?.jobs.find((item) => String(item.id) === String(jobId));
  if (!job) return;
  const ok = await new Promise((resolve) => showConfirm('Roll back this Codex batch?', () => resolve(true), () => resolve(false), { title: 'Roll back Codex batch', confirmText: 'Roll back' }));
  if (!ok) return;
  try {
    const data = await api(`/api/imports/jobs/${encodeURIComponent(jobId)}/rollback`, { method: 'POST', body: JSON.stringify({ confirm: true }) });
    replaceExternalImportBatchJob(data.job);
    upsertExternalImportJobRecord(data.job);
    if (typeof window.loadChatSessions === 'function') await window.loadChatSessions();
  } catch (error) {
    externalImportStatus('conversation', 'error', `Codex batch rollback failed: ${error.message}`);
  }
}

async function confirmExternalImportJob(jobId, kind) {
  const job = selectedExternalImportJobs[kind];
  if (!job || String(job.id) !== String(jobId)) return;
  const conversationIds = kind === 'conversation' ? [...externalImportSelectedConversationIds(job)] : undefined;
  if (kind === 'conversation' && !conversationIds.length) {
    externalImportStatus(kind, 'error', 'Select at least one chat before importing.');
    return;
  }
  const ok = await new Promise((resolve) => showConfirm(
    kind === 'conversation' ? 'Import these conversations into Prometheus?' : 'Import these MCP integrations into Prometheus?',
    () => resolve(true),
    () => resolve(false),
    {
      title: 'Confirm external import',
      confirmText: 'Import',
      details: kind === 'conversation'
        ? (job.conversationMode === 'projects'
          ? 'Detected source projects become normal Prometheus projects, with imported chats linked inside each project. Historical tool calls and reasoning are records only and will never execute. Source-session resume is not claimed.'
          : 'Imported messages become normal Prometheus threads. Historical tool calls and reasoning are preserved as records only and will never execute. Source-session resume is not claimed.')
        : 'MCP metadata is staged with a backup and remains disabled until authorized. Credentials, OAuth tokens, and API keys are not copied; finish authorization in Plugins.',
    },
  ));
  if (!ok) return;
  externalImportStatus(kind, 'info', 'Committing with checkpoints.');
  try {
    const data = await api(`/api/imports/jobs/${encodeURIComponent(jobId)}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ confirm: true, ...(conversationIds ? { conversationIds } : {}) }),
      timeoutMs: 120000,
    });
    selectedExternalImportJobs[kind] = data.job;
    upsertExternalImportJobRecord(data.job);
    renderExternalImportJob(kind, data.job);
    externalImportStatus(kind, data.job?.status === 'partial' ? 'error' : 'success', externalImportJobLabel(data.job));
    if (kind === 'conversation' && typeof window.loadChatSessions === 'function') await window.loadChatSessions();
  } catch (error) {
    externalImportStatus(kind, 'error', `Import failed: ${error.message}`);
  }
}

async function retryExternalImportJob(jobId, kind) {
  externalImportStatus(kind, 'info', 'Retrying from the last durable checkpoint.');
  try {
    const data = await api(`/api/imports/jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST', timeoutMs: 120000 });
    selectedExternalImportJobs[kind] = data.job;
    upsertExternalImportJobRecord(data.job);
    renderExternalImportJob(kind, data.job);
    externalImportStatus(kind, data.job?.status === 'failed' ? 'error' : 'success', externalImportJobLabel(data.job));
  } catch (error) {
    externalImportStatus(kind, 'error', `Retry failed: ${error.message}`);
  }
}

async function rollbackExternalImportJob(jobId, kind) {
  const ok = await new Promise((resolve) => showConfirm(
    'Roll back this import?',
    () => resolve(true),
    () => resolve(false),
    { title: 'Roll back external import', confirmText: 'Roll back', details: 'Prometheus will remove only state associated with this import and restore the setup backup when available.' },
  ));
  if (!ok) return;
  try {
    const data = await api(`/api/imports/jobs/${encodeURIComponent(jobId)}/rollback`, { method: 'POST', body: JSON.stringify({ confirm: true }) });
    selectedExternalImportJobs[kind] = data.job;
    upsertExternalImportJobRecord(data.job);
    renderExternalImportJob(kind, data.job);
    externalImportStatus(kind, 'success', 'Import rolled back.');
    if (kind === 'conversation' && typeof window.loadChatSessions === 'function') await window.loadChatSessions();
  } catch (error) {
    externalImportStatus(kind, 'error', `Rollback failed: ${error.message}`);
  }
}

async function deleteExternalImportJob(jobId, kind) {
  try {
    await api(`/api/imports/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
    selectedExternalImportJobs[kind] = null;
    renderExternalImportJob(kind, null);
    externalImportJobs = externalImportJobs.filter((job) => String(job?.id || '') !== String(jobId));
    renderExternalImportHistory();
    externalImportStatus(kind, 'success', 'Import record deleted.');
  } catch (error) {
    externalImportStatus(kind, 'error', `Delete failed: ${error.message}`);
  }
}

// -- Existing setup migration panel ------------------------------------------------------------------------------------------------
let migrationSources = [];
let selectedMigrationSourceId = '';
let selectedMigrationSourcePath = '';
let selectedMigrationSourceKind = '';
let lastMigrationPreview = null;

function migrationOptions(extra = {}) {
  const mode = document.getElementById('migration-mode')?.value || 'user-data';
  return {
    sourceId: selectedMigrationSourceId || undefined,
    sourcePath: selectedMigrationSourcePath || undefined,
    sourceKind: selectedMigrationSourceKind || undefined,
    mode,
    includeSecrets: mode === 'full',
    overwrite: !!document.getElementById('migration-overwrite')?.checked,
    skillConflict: document.getElementById('migration-skill-conflict')?.value || 'skip',
    ...extra,
  };
}

function setMigrationStatus(message, tone = 'muted') {
  const el = document.getElementById('migration-status');
  if (!el) return;
  const colors = { muted: 'var(--muted)', ok: 'var(--ok)', warn: '#9a6700', err: 'var(--err)' };
  el.style.color = colors[tone] || colors.muted;
  el.textContent = message || '';
}

function migrationSummary(report) {
  const s = report?.summary || {};
  return `${s.migrated || 0} importable · ${s.conflict || 0} conflicts · ${s.archived || 0} archived · ${s.skipped || 0} skipped`;
}

function renderMigrationSources() {
  const el = document.getElementById('migration-sources-list');
  if (!el) return;
  if (!migrationSources.length) {
    el.innerHTML = '<div style="border:1px dashed var(--line);border-radius:10px;padding:10px;color:var(--muted);font-size:12px">No Hermes or OpenClaw folders found automatically. Use a custom source folder below.</div>';
    return;
  }
  if (!selectedMigrationSourceId) selectedMigrationSourceId = migrationSources[0].id;
  el.innerHTML = migrationSources.map((source) => {
    const selected = source.id === selectedMigrationSourceId;
    const kind = source.kind === 'hermes' ? 'Hermes' : source.kind === 'openclaw' ? 'OpenClaw' : 'Custom';
    return `
      <label style="display:flex;gap:9px;align-items:flex-start;border:1px solid ${selected ? '#bdd3f6' : 'var(--line)'};border-radius:10px;padding:10px;background:${selected ? '#f0f6ff' : '#fff'};cursor:pointer">
        <input type="radio" name="migration-source" value="${escHtml(source.id)}" ${selected ? 'checked' : ''} style="margin-top:3px" />
        <div style="min-width:0;flex:1">
          <div style="font-size:12px;font-weight:700;color:var(--text)">${kind}</div>
          <div style="font-size:10.5px;color:var(--muted);word-break:break-all;margin-top:2px">${escHtml(source.path || '')}</div>
          <div style="font-size:10.5px;color:var(--muted);margin-top:4px">${escHtml((source.details || []).join(' · ') || 'Candidate source')}</div>
        </div>
      </label>
    `;
  }).join('');
  el.querySelectorAll('[name="migration-source"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      selectedMigrationSourceId = radio.value;
      selectedMigrationSourcePath = '';
      selectedMigrationSourceKind = '';
      lastMigrationPreview = null;
      renderMigrationSources();
      renderMigrationPreview(null);
      setMigrationStatus('Source selected. Preview before importing.');
    });
  });
}

function renderMigrationReports(reports = []) {
  const el = document.getElementById('migration-reports-list');
  if (!el) return;
  if (!reports.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--muted)">No migration reports yet.</div>';
    return;
  }
  el.innerHTML = reports.slice(0, 6).map((report) => `
    <div style="border:1px solid var(--line);border-radius:9px;padding:8px 10px;margin-bottom:8px;background:var(--panel-2)">
      <div style="display:flex;justify-content:space-between;gap:8px">
        <div style="font-size:12px;font-weight:700;color:var(--text)">${escHtml(report.source || report.sourceKind || 'Migration')}</div>
        <div style="font-size:10px;color:var(--muted)">${escHtml(report.completedAt ? new Date(report.completedAt).toLocaleString() : '')}</div>
      </div>
      <div style="font-size:10.5px;color:var(--muted);margin-top:3px">${escHtml(migrationSummary(report))}</div>
      <div style="font-size:10px;color:var(--muted);word-break:break-all;margin-top:3px">${escHtml(report.outputDir || '')}</div>
    </div>
  `).join('');
}

function renderMigrationPreview(report) {
  const el = document.getElementById('migration-preview');
  if (!el) return;
  if (!report) {
    el.innerHTML = 'No preview yet.';
    return;
  }
  const items = Array.isArray(report.items) ? report.items : [];
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:10px">
      <div style="font-size:13px;font-weight:800;color:var(--text)">${escHtml(report.source?.label || 'Migration')}</div>
      <div style="font-size:11px;color:var(--muted)">${escHtml(migrationSummary(report))}</div>
    </div>
    ${items.map((item) => {
      const color = item.status === 'migrated' ? '#166534' : item.status === 'conflict' ? '#9a6700' : item.status === 'error' ? 'var(--err)' : 'var(--muted)';
      return `
        <div style="display:grid;grid-template-columns:86px 1fr;gap:8px;border-top:1px solid var(--line);padding:8px 0">
          <div style="font-size:10.5px;font-weight:800;color:${color};text-transform:uppercase">${escHtml(item.status)}</div>
          <div>
            <div style="font-size:12px;font-weight:700;color:var(--text)">${escHtml(item.label || item.category)}</div>
            <div style="font-size:10.5px;color:var(--muted);line-height:1.55;word-break:break-word">${escHtml(item.reason || item.destination || item.source || '')}</div>
          </div>
        </div>
      `;
    }).join('')}
  `;
}

async function loadMigrationPanel(force = false) {
  if (!force && migrationSources.length) {
    renderMigrationSources();
    return;
  }
  setMigrationStatus('Scanning for migration sources...');
  try {
    const data = await api('/api/migration/sources');
    migrationSources = Array.isArray(data?.sources) ? data.sources : [];
    if (!selectedMigrationSourceId && migrationSources[0]) selectedMigrationSourceId = migrationSources[0].id;
    renderMigrationSources();
    renderMigrationReports(data?.reports || []);
    setMigrationStatus(migrationSources.length ? `${migrationSources.length} source${migrationSources.length === 1 ? '' : 's'} found.` : 'No automatic sources found.', migrationSources.length ? 'ok' : 'warn');
  } catch (err) {
    setMigrationStatus(`Scan failed: ${err.message}`, 'err');
  }
}

async function previewSelectedMigration() {
  if (!selectedMigrationSourceId && !selectedMigrationSourcePath) {
    setMigrationStatus('Choose a source first.', 'warn');
    return;
  }
  setMigrationStatus('Building migration preview...');
  try {
    const data = await api('/api/migration/preview', {
      method: 'POST',
      body: JSON.stringify(migrationOptions()),
    });
    lastMigrationPreview = data.report;
    renderMigrationPreview(lastMigrationPreview);
    setMigrationStatus('Preview ready. Nothing has been imported yet.', 'ok');
  } catch (err) {
    setMigrationStatus(`Preview failed: ${err.message}`, 'err');
  }
}

async function previewCustomMigration() {
  const customPath = String(document.getElementById('migration-custom-path')?.value || '').trim();
  if (!customPath) {
    setMigrationStatus('Enter a custom source folder first.', 'warn');
    return;
  }
  selectedMigrationSourceId = '';
  selectedMigrationSourcePath = customPath;
  selectedMigrationSourceKind = 'custom';
  await previewSelectedMigration();
}

async function executeSelectedMigration() {
  if (!lastMigrationPreview) {
    await previewSelectedMigration();
    if (!lastMigrationPreview) return;
  }
  const ok = await new Promise((resolve) => showConfirm(
    'Import selected migration data?',
    () => resolve(true),
    () => resolve(false),
    {
      title: 'Import selected migration data?',
      confirmText: 'Import',
      details: 'Prometheus will import compatible files and settings. Existing data is kept unless your conflict options allow updates.',
    }
  ));
  if (!ok) return;
  setMigrationStatus('Importing...');
  try {
    const data = await api('/api/migration/execute', {
      method: 'POST',
      body: JSON.stringify(migrationOptions()),
      timeoutMs: 120000,
    });
    lastMigrationPreview = data.report;
    renderMigrationPreview(lastMigrationPreview);
    setMigrationStatus(`Import complete. Report: ${data.report?.outputDir || ''}`, 'ok');
    addProcessEntry('final', 'Migration import completed.');
    await loadMigrationReportsOnly();
  } catch (err) {
    setMigrationStatus(`Import failed: ${err.message}`, 'err');
    addProcessEntry('error', `Migration failed: ${err.message}`);
  }
}

async function loadMigrationReportsOnly() {
  try {
    const data = await api('/api/migration/reports');
    renderMigrationReports(data?.reports || []);
  } catch {}
}

// -- Keyboard Shortcuts panel ---------------------------------------------------------------------------------------------------
let _scData = {}; // cache: { hostname: { shortcuts: [...], notes, description } }

async function loadShortcutsPanel() {
  try {
    const data = await fetch('/api/shortcuts').then(r => r.json());
    _scData = data.shortcuts || {};
    // Populate host filter dropdown
    const sel = document.getElementById('sc-filter-host');
    const prev = sel.value;
    sel.innerHTML = '<option value="">All sites</option>';
    Object.keys(_scData).sort().forEach(host => {
      const opt = document.createElement('option');
      opt.value = host;
      opt.textContent = host;
      sel.appendChild(opt);
    });
    sel.value = prev;
    renderShortcutsList();
  } catch (e) {
    document.getElementById('sc-list').innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px 0">No shortcuts saved yet.</div>';
  }
}

function renderShortcutsList() {
  const filter = document.getElementById('sc-filter-host').value;
  const container = document.getElementById('sc-list');
  const hosts = filter ? [filter] : Object.keys(_scData).sort();

  if (!hosts.length) {
    container.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px 0">No shortcuts saved yet.</div>';
    return;
  }

  let html = '';
  for (const host of hosts) {
    const entry = _scData[host];
    if (!entry) continue;
    html += `<div style="margin-bottom:14px">`;
    html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">`;
    html += `<span style="font-weight:700;font-size:13px;color:var(--text)">${host}</span>`;
    if (entry.description && entry.description !== host) {
      html += `<span style="font-size:11px;color:var(--muted)">${entry.description}</span>`;
    }
    html += `</div>`;
    if (entry.notes) {
      html += `<div style="font-size:11px;color:var(--muted);margin-bottom:5px;font-style:italic">${entry.notes}</div>`;
    }
    for (const sc of (entry.shortcuts || [])) {
      const ctx = sc.context ? `<span style="color:var(--muted)"> (${sc.context})</span>` : '';
      const star = sc.preferred_for_compose ? ' ?' : '';
      html += `<div style="display:flex;align-items:flex-start;gap:6px;padding:3px 4px;border-radius:5px;margin-bottom:2px" onmouseover="this.style.background='var(--bg-soft)'" onmouseout="this.style.background=''">`;
      html += `<code style="font-size:11px;background:var(--bg-soft);border:1px solid var(--line);border-radius:4px;padding:1px 6px;white-space:nowrap;flex-shrink:0">${sc.key}</code>`;
      html += `<span style="flex:1;font-size:12px;color:var(--text)">${sc.action}${ctx}${star ? '<span style="color:#d18b19">' + star + '</span>' : ''}</span>`;
      html += `<button onclick="deleteSiteShortcutUI('${host}','${sc.key.replace(/'/g,"\\'")}')"
        title="Delete shortcut" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:14px;padding:0 2px;line-height:1">&#x2715;</button>`;
      html += `</div>`;
    }
    html += `</div>`;
  }
  container.innerHTML = html;
}

async function addSiteShortcut() {
  const hostname = document.getElementById('sc-hostname').value.trim();
  const key = document.getElementById('sc-key').value.trim();
  const action = document.getElementById('sc-action').value.trim();
  const context = document.getElementById('sc-context').value.trim();
  const compose = document.getElementById('sc-compose').checked;
  const statusEl = document.getElementById('sc-add-status');

  if (!hostname || !key || !action) {
    statusEl.style.color = 'var(--err)';
    statusEl.textContent = 'Hostname, key, and action are required.';
    return;
  }

  try {
    const res = await fetch('/api/shortcuts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostname, key, action, context: context || undefined, preferred_for_compose: compose }),
    }).then(r => r.json());

    if (res.success) {
      statusEl.style.color = 'var(--ok)';
      statusEl.textContent = 'Saved!';
      setTimeout(() => { statusEl.textContent = ''; }, 2000);
      // Clear form
      document.getElementById('sc-hostname').value = '';
      document.getElementById('sc-key').value = '';
      document.getElementById('sc-action').value = '';
      document.getElementById('sc-context').value = '';
      document.getElementById('sc-compose').checked = false;
      loadShortcutsPanel();
    } else {
      statusEl.style.color = 'var(--err)';
      statusEl.textContent = res.error || 'Failed to save';
    }
  } catch (e) {
    statusEl.style.color = 'var(--err)';
    statusEl.textContent = 'Network error';
  }
}

async function deleteSiteShortcutUI(hostname, key) {
  if (!confirm(`Delete shortcut "${key}" from ${hostname}?`)) return;
  try {
    await fetch('/api/shortcuts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostname, key }),
    });
    loadShortcutsPanel();
  } catch (e) {
    console.error('Delete shortcut failed', e);
  }
}

function ensureAgentMdEditor() {
  if (window.agentMdEditor || typeof CodeMirror === 'undefined') return;
  const wrap = document.getElementById('agent-md-editor-wrap');
  if (!wrap) return;
  window.agentMdEditor = CodeMirror(wrap, {
    value: '',
    mode: 'markdown',
    lineNumbers: true,
    lineWrapping: true,
    tabSize: 2,
    indentWithTabs: false,
    theme: 'default',
  });
  window.agentMdEditor.setSize('100%', 240);
  // Refresh after paint so layout is correct when panel was hidden at init time
  setTimeout(() => { if (window.agentMdEditor) window.agentMdEditor.refresh(); }, 200);
}

function getAgentVoiceFromForm() {
  return normalizeAgentVoiceProfile({
    provider: document.getElementById('agent-edit-voice-provider')?.value,
    voice: document.getElementById('agent-edit-voice-voice')?.value,
    speed: document.getElementById('agent-edit-voice-speed')?.value,
  });
}

async function loadAgentVoiceOptions(preserveSelected = false) {
  const providerEl = document.getElementById('agent-edit-voice-provider');
  const voiceEl = document.getElementById('agent-edit-voice-voice');
  const statusEl = document.getElementById('agent-voice-status');
  if (!providerEl || !voiceEl) return;
  const provider = String(providerEl.value || '').trim();
  const previous = preserveSelected ? String(voiceEl.value || voiceEl.dataset.current || '').trim() : '';
  if (!provider) {
    voiceEl.disabled = true;
    voiceEl.innerHTML = '<option value="">use provider default</option>';
    if (statusEl) statusEl.textContent = 'Using the global voice settings for this agent.';
    return;
  }
  voiceEl.disabled = false;
  voiceEl.innerHTML = '<option value="">Loading...</option>';
  const fallbacks = {
    openai_realtime: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'],
    openai: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'],
    xai: ['eve', 'ara', 'rex', 'sal', 'leo'],
    browser: ['default'],
  };
  let voices = fallbacks[provider] || [];
  const options = Array.from(new Set([...voices, previous].filter(Boolean)));
  voiceEl.innerHTML = `<option value="">provider default</option>${options.map(v => `<option value="${escHtml(v)}">${escHtml(v)}</option>`).join('')}`;
  if (previous && options.includes(previous)) voiceEl.value = previous;
  if (statusEl) statusEl.textContent = provider === 'xai'
    ? 'xAI voice uses realtime audio. Image/video summaries can still use the configured vision fallback.'
    : '';
}

function setAgentVoiceForm(voice) {
  const profile = normalizeAgentVoiceProfile(voice || {});
  const providerEl = document.getElementById('agent-edit-voice-provider');
  const voiceEl = document.getElementById('agent-edit-voice-voice');
  const speedEl = document.getElementById('agent-edit-voice-speed');
  if (providerEl) providerEl.value = profile.provider || '';
  if (voiceEl) {
    voiceEl.dataset.current = profile.voice || '';
    voiceEl.innerHTML = profile.voice
      ? `<option value="${escHtml(profile.voice)}">${escHtml(profile.voice)}</option>`
      : '<option value="">use provider default</option>';
    voiceEl.value = profile.voice || '';
  }
  if (speedEl) speedEl.value = Number.isFinite(Number(profile.speed)) ? String(profile.speed) : '1';
  loadAgentVoiceOptions(true).catch(() => {});
}

function getAgentFromForm() {
  const maxStepsRaw = document.getElementById('agent-edit-max-steps').value;
  const maxSteps = Number(maxStepsRaw);
  const selected = findSelectedAgent();
  const workspaceValue = document.getElementById('agent-edit-workspace').value.trim();
  const isTeamScoped = !!selected?.teamId;
  const agent = {
    id: document.getElementById('agent-edit-id').value.trim(),
    name: document.getElementById('agent-edit-name').value.trim(),
    description: document.getElementById('agent-edit-description').value.trim(),
    model: (function() {
      const prov = (document.getElementById('agent-edit-provider')?.value || '').trim();
      const mdl  = (document.getElementById('agent-edit-model-select')?.value || '').trim();
      if (!prov && !mdl) return '';
      if (!prov) return mdl; // bare model, use global provider
      return mdl ? `${prov}/${mdl}` : ''; // must include model when provider is selected
    })(),
    reasoning_effort: (document.getElementById('agent-edit-reasoning')?.value || '').trim(),
    default: document.getElementById('agent-edit-id').value.trim() === 'main',
  };
  const voice = getAgentVoiceFromForm();
  if (!agent.reasoning_effort) delete agent.reasoning_effort;
  agent.voice = Object.keys(voice).length ? voice : null;
  if (workspaceValue && !isTeamScoped) agent.workspace = workspaceValue;
  if (Number.isFinite(maxSteps) && maxSteps > 0) agent.maxSteps = Math.floor(maxSteps);
  return agent;
}

function setAgentForm(agent) {
  const a = agent || {};
  document.getElementById('agent-edit-id').value = a.id || '';
  document.getElementById('agent-edit-name').value = a.name || '';
  document.getElementById('agent-edit-description').value = a.description || '';
  document.getElementById('agent-edit-workspace').value = a.workspaceDefault || a.teamWorkspacePath || a.workspace || '';
  // Parse "provider/model" back into the two-picker UI
  (function() {
    const raw = String(a.model || '').trim();
    const slashIdx = raw.indexOf('/');
    const hasProv = slashIdx > 0;
    const prov  = hasProv ? raw.slice(0, slashIdx) : '';
    const mdl   = hasProv ? raw.slice(slashIdx + 1) : raw;
    const canUseProvider = !prov || isCredentialedModelProviderId(prov);
    // A legacy/newly-created agent can store a bare model while the gateway
    // has already resolved its provider. Show that resolved provider in the
    // form so reasoning options are available and the next save persists the
    // full provider/model route.
    const effectiveProvider = String(a.effectiveModelProvider || '').trim();
    const selectedProv = canUseProvider ? (prov || (raw && effectiveProvider ? effectiveProvider : '')) : '';
    const selectedModel = canUseProvider ? mdl : '';
    const provSel = document.getElementById('agent-edit-provider');
    const mdlSel  = document.getElementById('agent-edit-model-select');
    if (provSel) provSel.value = selectedProv;
    if (mdlSel) {
      // Ensure the current model is in the list, then select it
      const existing = Array.from(mdlSel.options).map(o => o.value);
      if (selectedModel && !existing.includes(selectedModel)) {
        const opt = document.createElement('option');
        opt.value = selectedModel; opt.textContent = selectedModel;
        mdlSel.appendChild(opt);
      }
      mdlSel.value = selectedModel || '';
    }
    syncAgentReasoningControl(a.reasoning_effort || '');
  })();
  setAgentVoiceForm(a.voice || null);
  document.getElementById('agent-edit-max-steps').value = (a.maxSteps || '') + '';
  const defaultInput = document.getElementById('agent-edit-default');
  if (defaultInput) {
    defaultInput.checked = String(a.id || '') === 'main';
    defaultInput.disabled = true;
    defaultInput.title = String(a.id || '') === 'main'
      ? 'Main agent is always the default.'
      : 'Only the main agent can be the default.';
  }
  const modelStatus = document.getElementById('agent-model-status');
  if (modelStatus) {
    const source = String(a.effectiveModelSource || '').replace(/^agent_model_defaults\./, 'default: ');
    modelStatus.textContent = a.effectiveModel
      ? `Effective model: ${a.effectiveModel}${source ? ` (${source})` : ''}`
      : '';
  }
  // Reset team permission flags before async load
  document.getElementById('agent-edit-src-read-access').checked = false;
  document.getElementById('agent-edit-can-propose').checked = false;
  if (a.id) {
    fetch(`/api/agents/${encodeURIComponent(a.id)}/subagent-config`)
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          document.getElementById('agent-edit-src-read-access').checked = d.src_read_access === true;
          document.getElementById('agent-edit-can-propose').checked = d.can_propose === true;
        }
      })
      .catch(() => {});
  }
}

function renderAgentsList() {
  const el = document.getElementById('settings-agents-list');
  if (!el) return;
  const visibleAgents = window.agentsConfigList.filter(a => a.id !== 'main');
  if (!visibleAgents.length) {
    el.innerHTML = '<div style="color:var(--muted)">No subagents found.</div>';
    return;
  }

  // -- Categorise agents ------------------------------------------------------
  const mainAgent = window.agentsConfigList.find(a => a.id === 'main') || null;

  // Build agent lookup by id
  const agentById = {};
  for (const a of window.agentsConfigList) agentById[a.id] = a;

  // Build team groups directly from teamsData (source of truth for team membership).
  // This handles: managers, shared agents across multiple teams, and all edge cases.
  // teamsData is populated by refreshTeams() — load it now if empty.
  const teamsForGrouping = Array.isArray(teamsData) && teamsData.length > 0
    ? teamsData
    : [];

  // Track which agent IDs appear in at least one team (to identify solos)
  const agentIdsInTeams = new Set();

  // Build group entries: { teamId, teamName, teamEmoji, managerId, manager, members[] }
  const teamGroups = new Map();
  for (const t of teamsForGrouping) {
    const memberIds = Array.isArray(t.subagentIds) ? t.subagentIds : [];

    // Find manager — the manager orchestrates the team but is NOT in subagentIds[].
    // Detection order:
    //   1. t.managerId if explicitly set on team object
    //   2. Agent with isTeamManager=true whose teamId matches this team (set by API)
    //   3. Agent with isTeamManager=true whose id ends in '_manager' and name/id loosely matches team
    //   4. Fallback: any agent whose id is exactly '<keyword>_manager' for a keyword in team name/id
    const teamKeyword = t.id.replace(/^team_/, '').replace(/_[a-z0-9]{4,}$/, '').split('_')[0];
    const detectedManagerId = t.managerAgentId || t.managerId ||
      window.agentsConfigList.find(a => a.isTeamManager && a.teamId === t.id)?.id ||
      window.agentsConfigList.find(a => a.isTeamManager && a.id.endsWith('_manager') && a.id.includes(teamKeyword))?.id ||
      window.agentsConfigList.find(a => a.id === `${teamKeyword}_manager`)?.id ||
      null;
    const managerId = detectedManagerId === 'main' ? null : detectedManagerId;

    const allIds = memberIds.filter(id => id !== 'main');
    if (managerId && !allIds.includes(managerId)) allIds.unshift(managerId);
    allIds.forEach(id => agentIdsInTeams.add(id));

    const members = allIds
      .map(id => agentById[id])
      .filter(Boolean);

    // Sort: manager first, then rest
    members.sort((a, b) => {
      const aIsManager = a.isTeamManager || a.id === managerId;
      const bIsManager = b.isTeamManager || b.id === managerId;
      if (aIsManager && !bIsManager) return -1;
      if (!aIsManager && bIsManager) return 1;
      return 0;
    });

    teamGroups.set(t.id, {
      teamId: t.id,
      teamName: t.name || t.id,
      teamEmoji: t.emoji || '\uD83C\uDFE0',
      managerId,
      members,
    });
  }

  // Also sweep agentsConfigList for agents the API tagged with teamId but whose team
  // wasn't in the teams array (edge case — keeps things consistent)
  for (const a of window.agentsConfigList) {
    if (!a.teamId || a.id === mainAgent?.id || agentIdsInTeams.has(a.id)) continue;
    agentIdsInTeams.add(a.id);
    if (!teamGroups.has(a.teamId)) {
      teamGroups.set(a.teamId, {
        teamId: a.teamId,
        teamName: a.teamName || a.teamId,
        teamEmoji: a.teamEmoji || '\uD83C\uDFE0',
        managerId: null,
        members: [],
      });
    }
    teamGroups.get(a.teamId).members.push(a);
  }

  // Solo agents — in agentsConfigList but not in any team and not main
  const soloAgents = window.agentsConfigList.filter(a =>
    a.id !== mainAgent?.id &&
    !agentIdsInTeams.has(a.id) &&
    !a.teamId
  );

  // -- Card renderer ---------------------------------------------------------
  function renderCard(a, indent = false) {
    const selected = a.id === window.selectedAgentId;
    const lastRun = a.lastRun?.finishedAt ? new Date(a.lastRun.finishedAt).toLocaleString() : 'never';
    const heartbeat = a.lastHeartbeatAt ? new Date(a.lastHeartbeatAt).toLocaleString() : 'never';
    const defaultBadge = isMainAgentEntry(a) ? '<span style="font-size:10px;padding:2px 5px;border-radius:999px;background:#eaf2ff;color:#0d4faf;border:1px solid #bdd3f6">default</span>' : '';
    const dynamicBadge = a.subagentType === 'dynamic' ? '<span style="font-size:10px;padding:2px 5px;border-radius:999px;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0">dynamic</span>' : '';
    const managerBadge = a.isTeamManager ? '<span style="font-size:10px;padding:2px 5px;border-radius:999px;background:#fffbeb;color:#92400e;border:1px solid #fde68a">manager</span>' : '';
    const modelSource = String(a.effectiveModelSource || '').replace(/^agent_model_defaults\./, 'default: ');
    const modelLine = a.effectiveModel
      ? `<div style="margin-top:2px;font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted)">model: ${escHtml(a.effectiveModel)}${modelSource ? ` <span style="font-family:inherit;color:var(--muted)">(${escHtml(modelSource)})</span>` : ''}</div>`
      : '';
    const indentStyle = indent ? 'margin-left:14px;width:calc(100% - 14px)' : 'width:100%';
    const borderColor = selected ? '#bdd3f6' : 'var(--line)';
    const bg = selected ? '#f5f9ff' : 'var(--panel-2,#fff)';
    return `
      <button onclick="selectAgent('${escHtml(a.id)}')" style="text-align:left;border:1px solid ${borderColor};border-radius:9px;padding:8px 10px;background:${bg};cursor:pointer;${indentStyle};box-sizing:border-box">
        <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
          <span style="font-weight:700;font-size:13px;color:var(--text)">${escHtml(a.name || a.id)}</span>
          ${defaultBadge}${dynamicBadge}${managerBadge}
        </div>
        <div style="margin-top:3px;font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--muted)">${escHtml(a.id)}</div>
        ${modelLine}
        <div style="margin-top:2px;font-size:11px;color:var(--muted)">last run: ${escHtml(lastRun)} &nbsp;·&nbsp; heartbeat: ${escHtml(heartbeat)}</div>
      </button>
    `;
  }

  // -- Section label ----------------------------------------------------------
  function sectionLabel(text) {
    return `<div style="margin-top:14px;margin-bottom:5px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);padding:0 2px">${text}</div>`;
  }

  let html = '';

  // 1. Team sections — one block per team
  for (const [, g] of teamGroups) {
    const count = g.members.length;
    if (count === 0) continue;
    html += sectionLabel(`${g.teamEmoji} ${escHtml(g.teamName)} &nbsp;<span style="font-weight:400;font-size:9px">${count} member${count !== 1 ? 's' : ''}</span>`);
    html += g.members.map(a => renderCard(a)).join('');
  }

  // 2. Solo agents — any agent not main and not in a team
  if (soloAgents.length > 0) {
    html += sectionLabel(`Other Agents (${soloAgents.length})`);
    html += soloAgents.map(a => renderCard(a)).join('');
  }

  el.innerHTML = html;
}

function findSelectedAgent() {
  return window.agentsConfigList.find(a => a.id === window.selectedAgentId) || null;
}

function isMainAgentEntry(agent) {
  return String(agent?.id || '') === 'main';
}

function agentFormNew() {
  window.selectedAgentId = '';
  setAgentForm({
    id: '',
    name: '',
    description: '',
    workspace: '',
    model: '',
    maxSteps: '',
    default: false,
  });
  if (window.agentMdEditor) window.agentMdEditor.setValue('');
  const mdPath = document.getElementById('agent-md-path');
  if (mdPath) mdPath.textContent = 'Select or save an agent to load AGENT.md';
  const resultEl = document.getElementById('agent-spawn-result');
  if (resultEl) resultEl.textContent = '';
  renderAgentsList();
}

async function selectAgent(id) {
  if (String(id || '') === 'main') {
    id = window.agentsConfigList.find(a => a.id !== 'main')?.id || '';
    if (!id) {
      window.selectedAgentId = '';
      agentFormNew();
      return;
    }
  }
  const previous = window.selectedAgentId;
  window.selectedAgentId = id;
  const selected = findSelectedAgent();
  setAgentForm(selected);
  const deleteBtn = document.getElementById('agent-delete-btn');
  if (deleteBtn) {
    const isProtected = isMainAgentEntry(selected);
    deleteBtn.disabled = isProtected;
    deleteBtn.title = isProtected ? 'Cannot delete the main agent' : '';
    deleteBtn.style.opacity = isProtected ? '0.4' : '1';
    deleteBtn.style.cursor = isProtected ? 'not-allowed' : 'pointer';
  }
  renderAgentsList();
  if (selected) {
    const shouldReloadSelection = id !== previous || id !== _settingsAgentsLoadedSelection;
    if (shouldReloadSelection) {
      _settingsAgentsLoadedSelection = '';
    }
    await loadAgentDetailsForCurrentSelection(shouldReloadSelection);
  }
}

function updateAgentDeleteProtection(selected) {
  const deleteBtn = document.getElementById('agent-delete-btn');
  if (!deleteBtn) return;
  const isProtected = isMainAgentEntry(selected);
  deleteBtn.disabled = isProtected;
  deleteBtn.title = isProtected ? 'Cannot delete the main agent' : '';
  deleteBtn.style.opacity = isProtected ? '0.4' : '1';
  deleteBtn.style.cursor = isProtected ? 'not-allowed' : 'pointer';
}

async function loadAgentDetailsForCurrentSelection(force = false) {
  if (!window.selectedAgentId) return;
  if (!force && _settingsAgentsLoadedSelection === window.selectedAgentId) return;
  _settingsAgentsLoadedSelection = window.selectedAgentId;

  ensureAgentMdEditor();
  if (window.agentMdEditor) {
    window.agentMdEditor.setValue('');
    window.agentMdEditor.refresh();
  }
  const provEl = document.getElementById('agent-edit-provider');
  if (provEl && provEl.value) loadAgentModelOptions(true).catch(() => {});
  await Promise.all([
    loadSelectedAgentMd().catch(() => {}),
    loadAgentRunHistory().catch(() => {}),
    isSelectedMainAgent() ? Promise.resolve() : loadAgentHeartbeat().catch(() => {}),
  ]);
}

// --- Agent model picker ------------------------------------------------------

function syncAgentReasoningControl(selectedValue) {
  const provider = document.getElementById('agent-edit-provider')?.value?.trim() || '';
  const model = document.getElementById('agent-edit-model-select')?.value?.trim() || '';
  const select = document.getElementById('agent-edit-reasoning');
  if (!select) return;
  const current = selectedValue !== undefined ? String(selectedValue || '') : String(select.value || '');
  const options = provider && model ? effortOptions(provider, model, true) : [''];
  select.innerHTML = options.map((effort) => `<option value="${escHtml(effort)}">${escHtml(effort || 'provider default')}</option>`).join('');
  select.disabled = !provider || !model || options.length <= 1;
  select.value = current && validEffort(provider, model, current) ? current : '';
}

/**
 * Called when the provider dropdown changes — clears model list and kicks off a fetch.
 */
async function onAgentProviderChange() {
  const provSel = document.getElementById('agent-edit-provider');
  const mdlSel  = document.getElementById('agent-edit-model-select');
  const status  = document.getElementById('agent-model-status');
  if (!provSel || !mdlSel) return;
  const prov = provSel.value;
  if (!prov) {
    mdlSel.innerHTML = '<option value="">— use effective default —</option>';
    if (status) status.textContent = '';
    syncAgentReasoningControl();
    return;
  }
  mdlSel.innerHTML = '<option value="">Loading…</option>';
  if (status) status.textContent = 'Fetching models…';
  await loadAgentModelOptions();
}

/**
 * Fetches models for the currently selected provider and populates the model dropdown.
 * Re-uses the same provider payload + /api/models/test logic as the primary model picker.
 */
async function loadAgentModelOptions(preserveSelected = false) {
  const provSel = document.getElementById('agent-edit-provider');
  const mdlSel  = document.getElementById('agent-edit-model-select');
  const status  = document.getElementById('agent-model-status');
  if (!provSel || !mdlSel) return;

  const provider = provSel.value;
  if (!provider) {
    mdlSel.innerHTML = '<option value="">— use effective default —</option>';
    if (status) status.textContent = '';
    return;
  }

  const prevValue = preserveSelected ? mdlSel.value : '';
  if (status) status.textContent = 'Fetching models…';

  // Static fallback model lists per provider (used when live fetch returns nothing)
  const STATIC_MODEL_FALLBACKS = {
    openai:       ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4-pro', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5-pro', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5-chat-latest', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o4-mini', 'o3', 'o1'],
    openai_codex: ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4-codex', 'gpt-5.4-codex-mini', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.3', 'gpt-5.2-codex', 'gpt-5.2', 'gpt-5.1-codex-max', 'gpt-5.1-codex-mini', 'gpt-5.1-codex', 'gpt-5.1'],
    anthropic:    ['claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
    perplexity: ['sonar-pro', 'sonar', 'sonar-reasoning-pro', 'sonar-reasoning', 'sonar-deep-research'],
    gemini: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  };

  try {
    let models = [];

    if (provider === 'openai') {
      // Reuse already-fetched openai model list from settings if available
      models = getSelectOptionValues('settings-openai-model');
      if (!models.length) {
        try { await refreshOpenAIModels(true); } catch {}
        models = getSelectOptionValues('settings-openai-model');
      }
      if (!models.length) models = [...(STATIC_MODEL_FALLBACKS.openai)];
    } else if (provider === 'openai_codex') {
      models = getSelectOptionValues('settings-codex-model');
      if (!models.length) models = [...(STATIC_MODEL_FALLBACKS.openai_codex)];
    } else if (provider === 'anthropic') {
      models = getSelectOptionValues('settings-anthropic-model');
      if (!models.length) models = [...(STATIC_MODEL_FALLBACKS.anthropic)];
    } else if (provider === 'perplexity') {
      models = getSelectOptionValues('settings-perplexity-model');
      if (!models.length) models = [...(STATIC_MODEL_FALLBACKS.perplexity)];
    } else if (provider === 'gemini') {
      models = getSelectOptionValues('settings-gemini-model');
      if (!models.length) models = [...(STATIC_MODEL_FALLBACKS.gemini)];
    } else {
      // ollama / llama_cpp / lm_studio — query the live endpoint
      const llm = buildProviderPayload();
      llm.provider = provider;
      const data = await api('/api/models/test', { method: 'POST', body: JSON.stringify({ llm }) });
      models = (data?.models || []).map(m => typeof m === 'string' ? m : (m.name || String(m)));
    }

    // Merge static defaults so there's always something to pick from
    models = uniqueStrings([...(STATIC_MODEL_FALLBACKS[provider] || []), ...models]);

    if (!models.length) {
      mdlSel.innerHTML = '<option value="">— no models found —</option>';
      if (status) status.textContent = 'No models detected. Is the provider running / configured?';
      return;
    }

    mdlSel.innerHTML = models.map(m => `<option value="${escHtml(m)}">${escHtml(m)}</option>`).join('');
    // Restore previously selected value if it's still in the list
    if (prevValue && models.includes(prevValue)) mdlSel.value = prevValue;
    else mdlSel.value = models[0];

    if (status) status.textContent = `${models.length} model(s) available`;
    syncAgentReasoningControl();
  } catch (err) {
    mdlSel.innerHTML = '<option value="">— fetch failed —</option>';
    if (status) status.textContent = `Error: ${err.message}`;
    syncAgentReasoningControl();
  }
}

// ---- openAgentSettings: jump to Settings > Agents and select a specific agent ----
function openAgentSettings(agentId) {
  if (!agentId) return;
  // Open settings modal
  const settingsModal = document.getElementById('settings-modal');
  if (settingsModal) settingsModal.style.display = 'flex';
  // Switch to Agents tab
  const agentsTab = document.querySelector('[onclick*="setSettingsTab"]');
  // Try to click the agents tab directly
  const allTabs = document.querySelectorAll('[data-tab], [onclick]');
  for (const t of allTabs) {
    const oc = t.getAttribute('onclick') || '';
    if (oc.includes('setSettingsTab') && oc.includes('agents')) {
      t.click();
      break;
    }
  }
  // Load agents tab and select the agent
  loadAgentsTab().then(() => {
    const agent = window.agentsConfigList.find(a => a.id === agentId);
    if (agent) {
      _settingsAgentsLoadedSelection = '';
      selectAgent(agent.id).catch(() => {});
    }
    // Scroll the agent into view in the list
    setTimeout(() => {
      const btn = document.querySelector(`[onclick*="selectAgent('${agentId}')"]`);
      if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
  });
}

// ---- _updateHeartbeatMdPreview: fetch and show HEARTBEAT.md for a subagent ----
async function _updateHeartbeatMdPreview(agentId) {
  const preview = document.getElementById('schedule-heartbeat-preview');
  const content = document.getElementById('schedule-heartbeat-content');
  if (!preview || !content) return;
  if (!agentId || agentId === '__main__') {
    preview.style.display = 'none';
    content.textContent = '';
    return;
  }
  preview.style.display = 'block';
  content.textContent = 'Loading...';
  try {
    const r = await fetch(`/api/agents/${encodeURIComponent(agentId)}/heartbeat-md`);
    const data = await r.json();
    if (data.success && data.content) {
      content.textContent = data.content;
    } else {
      content.textContent = '(No HEARTBEAT.md found for this agent)';
    }
  } catch (e) {
    content.textContent = '(Failed to load HEARTBEAT.md: ' + e.message + ')';
  }
}

async function loadAgentsTab() {
  ensureAgentMdEditor();
  // Ensure teams are loaded so renderAgentsList can group agents by team correctly.
  // NOTE: We fetch teams data directly here instead of calling refreshTeams() to
  // avoid triggering renderTeamsCanvas() as a side-effect, which would make the
  // teams-view canvas appear while the Settings modal is open.
  if (!Array.isArray(window.teamsData) || window.teamsData.length === 0) {
    try {
      const _td = await api('/api/teams', { timeoutMs: 5000 });
      window.teamsData = (_td.teams || []);
    } catch {}
  }

  const applyAgentsPayload = (data = {}) => {
    window.agentsConfigList = Array.isArray(data?.agents) ? data.agents : [];
    const visibleDefaultAgent = window.agentsConfigList.find(a => a.id !== 'main' && a.default === true)?.id;
    const requestedDefaultAgent = data?.defaultAgentId && data.defaultAgentId !== 'main'
      ? data.defaultAgentId
      : '';
    const defaultAgentId = requestedDefaultAgent
      || visibleDefaultAgent
      || window.agentsConfigList.find(a => a.id !== 'main')?.id || '';
    if (!window.selectedAgentId || window.selectedAgentId === 'main' || !window.agentsConfigList.some(a => a.id === window.selectedAgentId)) {
      window.selectedAgentId = defaultAgentId;
    }
    renderAgentsList();
    const selected = findSelectedAgent();
    setAgentForm(selected);
    updateAgentDeleteProtection(selected);
    if (selected) {
      loadAgentDetailsForCurrentSelection(selected.id !== _settingsAgentsLoadedSelection);
    } else {
      agentFormNew();
      _settingsAgentsLoadedSelection = '';
    }
  };

  const cached = _withSettingsCache({
    key: 'settings-agents',
    ttlMs: SETTINGS_DATA_CACHE_TTL_MS.agents,
    fetcher: () => api('/api/agents', { timeoutMs: 8000 }),
  });
  if (cached.value) {
    applyAgentsPayload(cached.value);
    if (cached.refreshPromise) {
      cached.refreshPromise.then((fresh) => { if (fresh) applyAgentsPayload(fresh); }).catch(() => {});
    }
    return;
  }
  try {
    const data = await cached.refreshPromise;
    applyAgentsPayload(data || {});
  } catch (err) {
    addProcessEntry('error', `Failed to load agents: ${err.message}`);
  }
}

async function saveAgentFromForm() {
  const agent = getAgentFromForm();
  if (!agent.id) {
    alert('Agent ID is required');
    return;
  }
  if (!agent.name) {
    alert('Agent name is required');
    return;
  }
  try {
    const exists = window.agentsConfigList.some(a => a.id === agent.id);
    const endpoint = exists ? `/api/agents/${encodeURIComponent(agent.id)}` : '/api/agents';
    const method = exists ? 'PUT' : 'POST';
    const data = await api(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent }),
    });
    if (!data?.success) throw new Error(data?.error || 'save failed');
    window.selectedAgentId = data?.agent?.id || agent.id;
    // Persist team permission flags to workspace config.json
    const srcReadAccess = document.getElementById('agent-edit-src-read-access')?.checked === true;
    const canPropose = document.getElementById('agent-edit-can-propose')?.checked === true;
    await fetch(`/api/agents/${encodeURIComponent(window.selectedAgentId)}/subagent-config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ src_read_access: srcReadAccess, can_propose: canPropose }),
    }).catch(() => {});
    addProcessEntry('info', `Agent "${window.selectedAgentId}" saved.`);
    await loadAgentsTab();
  } catch (err) {
    alert(`Failed to save agent: ${err.message}`);
  }
}

async function deleteSelectedAgent() {
  if (!window.selectedAgentId) return;
  // Guard: main agent is protected
  const current = window.agentsConfigList.find(a => a.id === window.selectedAgentId);
  if (isMainAgentEntry(current)) {
    alert('The main agent cannot be deleted.');
    return;
  }
  if (!confirm(`Delete agent "${window.selectedAgentId}"?`)) return;
  try {
    await api(`/api/agents/${encodeURIComponent(window.selectedAgentId)}`, { method: 'DELETE' });
    addProcessEntry('info', `Agent "${window.selectedAgentId}" deleted.`);
    window.selectedAgentId = '';
    await loadAgentsTab();
  } catch (err) {
    alert(`Failed to delete agent: ${err.message}`);
  }
}

function isSelectedAgentTeamMember() {
  const a = findSelectedAgent();
  return !!(a?.isTeamMember);
}

function isSelectedMainAgent() {
  const a = findSelectedAgent();
  return String(a?.id || '') === 'main';
}

function applyAgentEditorLayout() {
  const isMain = isSelectedMainAgent();
  const promptCard = document.getElementById('agent-prompt-card');
  const heartbeatCard = document.getElementById('agent-heartbeat-card');
  const titleEl = document.getElementById('agent-md-editor-title');
  const saveBtn = document.getElementById('agent-md-save-btn');
  const noteEl = document.getElementById('agent-md-team-note');
  const badgeEl = document.getElementById('agent-md-team-badge');

  // Show heartbeat card for non-main subagents; hide for main agent
  if (heartbeatCard) heartbeatCard.style.display = isMain ? 'none' : '';
  if (promptCard) promptCard.style.order = '1';

  if (isMain) {
    if (promptCard) promptCard.style.display = 'none';
    if (titleEl) titleEl.textContent = 'AGENT.md (CodeMirror)';
    if (saveBtn) saveBtn.textContent = 'Save AGENT.md';
    if (noteEl) noteEl.style.display = 'none';
    if (badgeEl) badgeEl.style.display = 'none';
  } else {
    if (promptCard) promptCard.style.display = '';
    if (titleEl) titleEl.textContent = 'AGENT.md (CodeMirror)';
    if (saveBtn) saveBtn.textContent = 'Save AGENT.md';
    if (noteEl) {
      noteEl.style.display = 'block';
      noteEl.innerHTML = 'This subagent identity and operating prompt comes from <strong>AGENT.md</strong>. Recurring work is configured from Scheduled Tasks by assigning this subagent.';
    }
    if (badgeEl) badgeEl.style.display = 'inline-flex';
  }
}

async function loadSelectedAgentMd() {
  ensureAgentMdEditor();
  if (!window.selectedAgentId || !window.agentMdEditor) return;

  applyAgentEditorLayout();

  if (isSelectedMainAgent()) {
    window.agentMdEditor.setValue('');
    const pathEl = document.getElementById('agent-md-path');
    if (pathEl) pathEl.textContent = '';
    return;
  }

  const endpoint = 'agent-md';
  const label = 'AGENT.md (CodeMirror)';
  const saveLabel = 'Save AGENT.md';

  // Update UI labels
  const titleEl = document.getElementById('agent-md-editor-title');
  const badgeEl = document.getElementById('agent-md-team-badge');
  const noteEl = document.getElementById('agent-md-team-note');
  const saveBtn = document.getElementById('agent-md-save-btn');
  if (titleEl) titleEl.textContent = label;
  if (badgeEl) badgeEl.style.display = 'inline-flex';
  if (noteEl) noteEl.style.display = 'block';
  if (saveBtn) saveBtn.textContent = saveLabel;

  try {
    const data = await api(`/api/agents/${encodeURIComponent(window.selectedAgentId)}/${endpoint}`);
    window.agentMdEditor.setValue(data?.content || '');
    const pathEl = document.getElementById('agent-md-path');
    if (pathEl) pathEl.textContent = data?.path || '';
  } catch (err) {
    addProcessEntry('error', `Failed to load ${endpoint}: ${err.message}`);
  }
}

async function saveSelectedAgentMd() {
  if (!window.selectedAgentId || !window.agentMdEditor) return;
  if (isSelectedMainAgent()) return;
  const endpoint = 'agent-md';
  const label = 'AGENT.md';
  try {
    const content = window.agentMdEditor.getValue();
    await api(`/api/agents/${encodeURIComponent(window.selectedAgentId)}/${endpoint}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    addProcessEntry('final', `Saved ${label} for "${window.selectedAgentId}".`);
  } catch (err) {
    alert(`Failed to save ${label}: ${err.message}`);
  }
}

async function runSelectedAgentOnce() {
  if (!window.selectedAgentId) return;
  const task = (document.getElementById('agent-spawn-task').value || '').trim();
  if (!task) {
    alert('Provide a task first.');
    return;
  }
  const out = document.getElementById('agent-spawn-result');
  if (out) out.textContent = 'Running...';
  try {
    const data = await api(`/api/agents/${encodeURIComponent(window.selectedAgentId)}/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task }),
    });
    const result = data?.result || {};
    if (out) {
      const head = result.success ? `Success (${result.durationMs || 0}ms)` : `Failed: ${result.error || 'unknown error'}`;
      out.textContent = `${head}\n\n${String(result.result || '').slice(0, 2500)}`;
    }
    await loadAgentsTab();
  } catch (err) {
    if (out) out.textContent = `Run failed: ${err.message}`;
  }
}

async function loadAgentRunHistory() {
  const el = document.getElementById('agent-run-history');
  if (!el) return;
  if (!window.selectedAgentId) { el.innerHTML = ''; return; }
  try {
    const data = await api(`/api/agents/history?agentId=${encodeURIComponent(window.selectedAgentId)}&limit=12`);
    const rows = Array.isArray(data?.history) ? data.history : [];
    if (!rows.length) {
      el.innerHTML = '<div style="color:var(--muted)">No runs yet.</div>';
      return;
    }
    el.innerHTML = rows.map((r) => {
      const color = r.success ? '#1a6e35' : '#9c1a1a';
      const when = new Date(r.finishedAt || r.startedAt || Date.now()).toLocaleString();
      const label = `${r.trigger || 'manual'} • ${r.durationMs || 0}ms`;
      const preview = String(r.resultPreview || r.error || '').slice(0, 140);
      return `<div style="border:1px solid var(--line);border-radius:8px;padding:6px 8px">
        <div style="display:flex;justify-content:space-between;gap:8px">
          <span style="font-weight:700;color:${color}">${r.success ? 'success' : 'failed'}</span>
          <span style="font-size:11px;color:var(--muted)">${escHtml(when)}</span>
        </div>
        <div style="font-size:11px;color:var(--muted)">${escHtml(label)}</div>
        <div style="font-size:11px;color:var(--text);margin-top:2px">${escHtml(preview)}</div>
      </div>`;
    }).join('');
  } catch (err) {
    el.innerHTML = `<div style="color:#9c1a1a">Failed to load history: ${escHtml(err.message)}</div>`;
  }
}

// --- Channels Settings Functions ---------------------------------------
let channelsStatusLoaded = false;
let channelsStatusCache = null;

function setChannelStatus(idPrefix, state, message) {
  const dot = document.getElementById(`${idPrefix}-status-dot`);
  const text = document.getElementById(`${idPrefix}-status-text`);
  if (!dot || !text) return;
  if (state === 'ok') {
    dot.style.background = 'var(--ok)';
    text.style.color = 'var(--text)';
  } else if (state === 'warn') {
    dot.style.background = '#f0ad4e';
    text.style.color = '#b87b00';
  } else {
    dot.style.background = '#ccc';
    text.style.color = 'var(--muted)';
  }
  text.textContent = message || 'Not configured';
}

function readChannelPayload(channel) {
  const completionNotifications = readCompletionNotificationPayload();
  if (channel === 'telegram') {
    const userIdStr = (document.getElementById('settings-tg-userid')?.value || '').trim();
    const allowedUserIds = userIdStr ? userIdStr.split(/[,\s]+/).map(Number).filter(n => !isNaN(n) && n > 0) : [];
    return {
      enabled: !!document.getElementById('settings-tg-enabled')?.checked,
      botToken: (document.getElementById('settings-tg-token')?.value || '').trim(),
      allowedUserIds,
      streamMode: 'full',
      completionNotifications,
    };
  }
  if (channel === 'discord') {
    return {
      enabled: !!document.getElementById('settings-dc-enabled')?.checked,
      botToken: (document.getElementById('settings-dc-token')?.value || '').trim(),
      applicationId: (document.getElementById('settings-dc-appid')?.value || '').trim(),
      guildId: (document.getElementById('settings-dc-guildid')?.value || '').trim(),
      channelId: (document.getElementById('settings-dc-channelid')?.value || '').trim(),
      webhookUrl: (document.getElementById('settings-dc-webhook')?.value || '').trim(),
      completionNotifications,
    };
  }
  return {
    enabled: !!document.getElementById('settings-wa-enabled')?.checked,
    accessToken: (document.getElementById('settings-wa-token')?.value || '').trim(),
    phoneNumberId: (document.getElementById('settings-wa-phoneid')?.value || '').trim(),
    businessAccountId: (document.getElementById('settings-wa-baid')?.value || '').trim(),
    verifyToken: (document.getElementById('settings-wa-verify')?.value || '').trim(),
    webhookSecret: (document.getElementById('settings-wa-secret')?.value || '').trim(),
    testRecipient: (document.getElementById('settings-wa-recipient')?.value || '').trim(),
    completionNotifications,
  };
}

function readCompletionNotificationPayload() {
  const maxChars = Number(document.getElementById('settings-ch-notify-maxchars')?.value || 420);
  return {
    enabled: !!document.getElementById('settings-ch-notify-enabled')?.checked,
    mobile: !!document.getElementById('settings-ch-notify-mobile')?.checked,
    desktop: !!document.getElementById('settings-ch-notify-desktop')?.checked,
    includeSummary: document.getElementById('settings-ch-notify-summary')?.checked !== false,
    includeLink: !!document.getElementById('settings-ch-notify-link')?.checked,
    summaryMaxChars: Number.isFinite(maxChars) ? Math.max(80, Math.min(1200, Math.floor(maxChars))) : 420,
  };
}

function applyCompletionNotificationFields(channelData) {
  const cfg = channelData?.completionNotifications || {};
  const setChecked = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.checked = !!value;
  };
  setChecked('settings-ch-notify-enabled', cfg.enabled === true);
  setChecked('settings-ch-notify-mobile', cfg.mobile === true);
  setChecked('settings-ch-notify-desktop', cfg.desktop === true);
  setChecked('settings-ch-notify-summary', cfg.includeSummary !== false);
  setChecked('settings-ch-notify-link', cfg.includeLink === true);
  const maxEl = document.getElementById('settings-ch-notify-maxchars');
  if (maxEl) maxEl.value = String(Number.isFinite(Number(cfg.summaryMaxChars)) ? Number(cfg.summaryMaxChars) : 420);
}

function setButtonBusy(id, busy, busyLabel, normalLabel) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled = !!busy;
  btn.textContent = busy ? busyLabel : normalLabel;
}

function setSettingsSaveFeedback(state = 'idle', label = 'Save') {
  const btn = document.getElementById('settings-save-btn');
  const status = document.getElementById('settings-save-status');
  if (btn) {
    btn.disabled = state === 'saving' || state === 'saved';
    btn.textContent = label;
    btn.dataset.saveState = state;
    btn.setAttribute('aria-busy', state === 'saving' ? 'true' : 'false');
    btn.classList.toggle('is-saving', state === 'saving');
    btn.classList.toggle('is-saved', state === 'saved');
    btn.classList.toggle('is-save-error', state === 'error');
  }
  if (status) {
    status.textContent = state === 'saving'
      ? 'Saving settings…'
      : state === 'saved'
        ? 'Saved'
        : state === 'error'
          ? 'Save failed'
          : '';
    status.dataset.saveState = state;
  }
}

function waitForSettingsSaveFeedback() {
  return new Promise((resolve) => setTimeout(resolve, 650));
}

function getSelectedChannelType() {
  return String(document.getElementById('settings-channel-select')?.value || 'telegram');
}

function onChannelTypeChange() {
  const ch = getSelectedChannelType();
  const formMap = {
    telegram: 'channel-form-telegram',
    discord: 'channel-form-discord',
    whatsapp: 'channel-form-whatsapp',
  };
  const guideMap = {
    telegram: 'channel-guide-telegram',
    discord: 'channel-guide-discord',
    whatsapp: 'channel-guide-whatsapp',
  };
  const statusMap = {
    telegram: 'tg-status-bar',
    discord: 'dc-status-bar',
    whatsapp: 'wa-status-bar',
  };
  ['telegram', 'discord', 'whatsapp'].forEach((k) => {
    const form = document.getElementById(formMap[k]);
    const guide = document.getElementById(guideMap[k]);
    const status = document.getElementById(statusMap[k]);
    if (form) form.style.display = (k === ch) ? 'block' : 'none';
    if (guide) guide.style.display = (k === ch) ? 'block' : 'none';
    if (status) status.style.display = (k === ch) ? 'flex' : 'none';
  });
  applyCompletionNotificationFields(channelsStatusCache?.[ch] || null);
}

async function saveSelectedChannelSettings() {
  await saveChannelSettings(getSelectedChannelType());
}

async function testSelectedChannel() {
  await testChannel(getSelectedChannelType());
}

async function sendSelectedChannelTest() {
  await sendChannelTest(getSelectedChannelType());
}

async function loadChannelsStatus() {
  const cached = _withSettingsCache({
    key: 'settings-channels',
    ttlMs: SETTINGS_DATA_CACHE_TTL_MS.channelsStatus,
    fetcher: () => api('/api/channels/status'),
  });

  const apply = (data = {}) => {
    const tg = data.telegram || {};
    const dc = data.discord || {};
    const wa = data.whatsapp || {};
    channelsStatusCache = { telegram: tg, discord: dc, whatsapp: wa };

    if (tg.connected && tg.polling) setChannelStatus('tg', 'ok', `Connected as @${tg.username || 'bot'}`);
    else if (tg.hasToken) setChannelStatus('tg', 'warn', 'Token saved, not connected');
    else setChannelStatus('tg', 'off', 'Not configured');

    if (dc.hasToken || dc.hasWebhook) setChannelStatus('dc', 'warn', 'Credentials saved');
    else setChannelStatus('dc', 'off', 'Not configured');

    if (wa.hasAccessToken && wa.phoneNumberId) setChannelStatus('wa', 'warn', 'Credentials saved');
    else setChannelStatus('wa', 'off', 'Not configured');

    if (!channelsStatusLoaded) {
      channelsStatusLoaded = true;
      if (tg.hasToken) document.getElementById('settings-tg-token').placeholder = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (saved)';
      if (dc.hasToken) document.getElementById('settings-dc-token').placeholder = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (saved)';
      if (wa.hasAccessToken) document.getElementById('settings-wa-token').placeholder = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (saved)';

      document.getElementById('settings-tg-enabled').checked = !!tg.enabled;
      document.getElementById('settings-tg-userid').value = (tg.allowedUserIds || []).join(', ');

      document.getElementById('settings-dc-enabled').checked = !!dc.enabled;
      document.getElementById('settings-dc-appid').value = dc.applicationId || '';
      document.getElementById('settings-dc-guildid').value = dc.guildId || '';
      document.getElementById('settings-dc-channelid').value = dc.channelId || '';

      document.getElementById('settings-wa-enabled').checked = !!wa.enabled;
      document.getElementById('settings-wa-phoneid').value = wa.phoneNumberId || '';
      document.getElementById('settings-wa-baid').value = wa.businessAccountId || '';
      document.getElementById('settings-wa-recipient').value = wa.testRecipient || '';
    }
    onChannelTypeChange();
  };

  if (cached.value) {
    apply(cached.value);
    if (!cached.refreshPromise) return;
    cached.refreshPromise.then((fresh) => {
      if (fresh) apply(fresh);
    }).catch((err) => {
      console.error('[Channels] Status refresh failed:', err);
    });
    return;
  }

  cached.refreshPromise.then((fresh) => {
    if (fresh) apply(fresh);
  }).catch((err) => {
    console.error('[Channels] Status load failed:', err);
  });
}

async function saveChannelSettings(channel) {
  const payload = readChannelPayload(channel);
  try {
    const data = await api('/api/channels/config', {
      method: 'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ channels: { [channel]: payload } }),
    });
    if (data?.success) {
      addProcessEntry('final', `${channel} settings saved.`);
      channelsStatusLoaded = false;
      _markSettingsCacheBusted('settings-channels');
      await loadChannelsStatus();
    } else {
      alert('Save failed: ' + (data?.error || 'unknown error'));
    }
  } catch (err) {
    alert('Save failed: ' + err.message);
  }
}

async function testChannel(channel) {
  const btnId = document.getElementById('channel-test-btn')
    ? 'channel-test-btn'
    : channel === 'telegram' ? 'tg-test-btn' : channel === 'discord' ? 'dc-test-btn' : 'wa-test-btn';
  setButtonBusy(btnId, true, 'Testing...', 'Test');
  try {
    const payload = readChannelPayload(channel);
    const data = await api(`/api/channels/test/${channel}`, {
      method: 'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload),
    });
    if (data?.success) {
      if (channel === 'telegram') setChannelStatus('tg', 'ok', `Valid bot @${data?.bot?.username || 'telegram'}`);
      if (channel === 'discord') setChannelStatus('dc', 'ok', `Valid bot @${data?.bot?.username || 'discord'}`);
      if (channel === 'whatsapp') setChannelStatus('wa', 'ok', `Valid phone ${data?.account?.display_phone_number || data?.account?.id || ''}`.trim());
      addProcessEntry('final', `${channel} connection test passed.`);
    } else {
      alert(`${channel} test failed: ${data?.error || 'unknown error'}`);
    }
  } catch (err) {
    alert(`${channel} test failed: ${err.message}`);
  }
  setButtonBusy(btnId, false, 'Testing...', 'Test');
}

async function sendChannelTest(channel) {
  const btnId = document.getElementById('channel-send-test-btn')
    ? 'channel-send-test-btn'
    : channel === 'telegram' ? 'tg-send-test-btn' : channel === 'discord' ? 'dc-send-test-btn' : 'wa-send-test-btn';
  setButtonBusy(btnId, true, 'Sending...', 'Send Test');
  try {
    const payload = readChannelPayload(channel);
    const data = await api(`/api/channels/send-test/${channel}`, {
      method: 'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload),
    });
    if (data?.success) {
      addProcessEntry('final', `Test message sent via ${channel}.`);
    } else {
      alert(`${channel} send-test failed: ${data?.error || 'unknown error'}`);
    }
  } catch (err) {
    alert(`${channel} send-test failed: ${err.message}`);
  }
  setButtonBusy(btnId, false, 'Sending...', 'Send Test');
}

function getActiveSettingsTab() {
  const fromWindow = String(window.settingsTab || '').trim();
  if (fromWindow) return fromWindow === 'credentials' ? 'search' : fromWindow;
  const activePanel = Array.from(document.querySelectorAll('[id^="settings-panel-"]'))
    .find((panel) => panel && panel.style.display !== 'none');
  const activeTab = activePanel?.id?.replace(/^settings-panel-/, '') || 'system';
  return activeTab === 'credentials' ? 'search' : activeTab;
}

function getSettingsValue(id, fallback = '') {
  const el = document.getElementById(id);
  if (!el || !('value' in el)) return fallback;
  return String(el.value ?? fallback);
}

function getSettingsLines(id) {
  return getSettingsValue(id)
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);
}

function buildSettingsPathsPayload() {
  return {
    workspace_path: getSettingsValue('settings-workspace-path').trim(),
    allowed_paths: getSettingsLines('settings-allowed-paths'),
    blocked_paths: getSettingsLines('settings-blocked-paths'),
  };
}

function buildSearchTabPayload() {
  const payload = {};
  const providerEl = document.getElementById('settings-provider');
  const rigorEl = document.getElementById('settings-search-rigor');
  if (providerEl) payload.preferred_provider = providerEl.value || '';
  if (rigorEl) payload.search_rigor = rigorEl.value || 'verified';
  return payload;
}

function buildCredentialTabPayload() {
  return {
    tinyfish_api_key: getSettingsValue('cred-tinyfish-key').trim(),
    tavily_api_key: getSettingsValue('cred-tavily-key').trim(),
    google_api_key: getSettingsValue('cred-google-key').trim(),
    google_cx: getSettingsValue('cred-google-cx').trim(),
    brave_api_key: getSettingsValue('cred-brave-key').trim(),
  };
}

function buildLegacyModelPayload() {
  const primaryModel = getSettingsValue('settings-primary-model').trim();
  const payload = {
    ollama_endpoint: getSettingsValue('settings-ollama-endpoint', 'http://localhost:11434') || 'http://localhost:11434',
  };
  if (primaryModel) {
    payload.primary = primaryModel;
    payload.roles = {
      manager: primaryModel,
      executor: primaryModel,
      verifier: primaryModel,
    };
  }
  return payload;
}

function buildSessionSettingsPayload() {
  const goalRoute = (type) => {
    const provider = getSettingsValue(`goal-${type}-prov`).trim();
    const model = getSettingsValue(`goal-${type}-model`).trim();
    return provider && model ? `${provider}/${model}` : '';
  };
  return {
    rollingCompactionEnabled: document.getElementById('settings-rolling-compaction-enabled')?.checked !== false,
    rollingCompactionMessageCount: Number(getSettingsValue('settings-rolling-compaction-count', '20') || 20),
    rollingCompactionToolTurns: Number(getSettingsValue('settings-rolling-compaction-tools', '5') || 5),
    rollingCompactionSummaryMaxWords: Number(getSettingsValue('settings-rolling-compaction-words', '900') || 900),
    rollingCompactionModel: getSettingsValue('settings-rolling-compaction-model').trim(),
    mainChatGoals: {
      compactionModel: goalRoute('compactor'),
      compactionReasoning: getSettingsValue('goal-compactor-reasoning').trim(),
    },
  };
}

function buildSettingsBulkPayloadForTab(tab) {
  const activeTab = String(tab || '').trim();
  if (activeTab === 'system') {
    return { session: { autoSettle: buildAutoSettlePayloadFromUI() } };
  }
  if (activeTab === 'search') {
    if (!window._settingsSearchLoadedToUI || !window._settingsCredentialsLoadedToUI) throw new Error('Search settings are still loading.');
    const search = { ...buildSearchTabPayload(), ...buildCredentialTabPayload() };
    return Object.keys(search).length ? { search } : {};
  }
  if (activeTab === 'credentials') {
    if (!window._settingsCredentialsLoadedToUI) throw new Error('Credential fields are still loading.');
    return { search: buildCredentialTabPayload() };
  }
  if (activeTab === 'security') {
    if (!window._settingsSecurityLoadedToUI) throw new Error('Security settings are still loading.');
    const payload = {
      security: {
        terminalPermissionMode: getTerminalPermissionModeFromUI(),
        workspaceToolMode: getWorkspaceToolModeFromUI(),
      },
    };
    if (window._settingsPathsLoadedToUI) {
      payload.paths = buildSettingsPathsPayload();
    }
    return payload;
  }
  if (activeTab === 'models') {
    if (!window._llmSettingsLoadedToUI) throw new Error('Model settings are still loading.');
    const payload = {
      model: buildLegacyModelPayload(),
      llm: buildProviderPayload(),
    };
    if (window._settingsSessionLoadedToUI) {
      payload.session = buildSessionSettingsPayload();
    }
    return payload;
  }
  return {};
}

function settingsTabLabel(tab) {
  return String(tab || 'settings').replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());
}

async function saveSettings() {
  const btn = document.getElementById('settings-save-btn');
  if (btn?.disabled) return; // prevent double-submit
  setSettingsSaveFeedback('saving', 'Saving…');

  const resetBtn = () => setSettingsSaveFeedback();
  // Safety valve — re-enable button after 15s no matter what
  const safetyTimer = setTimeout(resetBtn, 15000);
  try {
    const activeTab = getActiveSettingsTab();
    const bulkPayload = buildSettingsBulkPayloadForTab(activeTab);
    if (activeTab === 'system' && bulkPayload.session?.autoSettle?.afterDays === 'custom') {
      const activationMode = await askAutoSettleActivationMode();
      if (!activationMode) {
        resetBtn();
        return;
      }
      bulkPayload.session.autoSettle.activationMode = activationMode;
    }
    let savedAnything = false;
    let saveResponse = null;
    if (Object.keys(bulkPayload).length) {
      saveResponse = await api('/api/settings/bulk', {
        method: 'POST',
        body: JSON.stringify(bulkPayload),
      });
      savedAnything = true;
    }
    if (activeTab === 'models') {
      await saveModelTabLiveSettings({ showStatus: false });
      savedAnything = true;
      // A newly saved credential becomes available to all right-side routing
      // selectors immediately, without changing the live main-chat provider.
      await fetchCredentialedModelProviderIds(true);
      renderProviderSelectors();
      if (typeof window.applyReasoningPrefsFromProviderConfig === 'function' && bulkPayload.llm) {
        window.applyReasoningPrefsFromProviderConfig(bulkPayload.llm, window._llmSettingsCache?.provider || bulkPayload.llm.provider);
      }
    } else if (activeTab === 'heartbeat' && typeof saveHeartbeatSettings === 'function') {
      await saveHeartbeatSettings();
      savedAnything = true;
    } else if (activeTab === 'channels' && typeof saveSelectedChannelSettings === 'function') {
      await saveSelectedChannelSettings();
      savedAnything = true;
    } else if (activeTab === 'pairing' && typeof _saveRemoteAccess === 'function') {
      await _saveRemoteAccess();
      savedAnything = true;
    }
    if (activeTab === 'system') {
      _markSettingsCacheBusted('settings-system');
      await loadAutoSettleSettings().catch(() => {});
      if (saveResponse?.autoSettleRun) {
        const run = saveResponse.autoSettleRun;
        showToast('Auto-settle completed', `${Number(run.settled || 0)} eligible chat(s) moved to Settled Chats. Protected conversations were skipped.`, 'success', 5000);
      }
    }
    if (!savedAnything) {
      addProcessEntry('info', `${settingsTabLabel(activeTab)} has no footer-saved settings.`);
      setSettingsSaveFeedback('saved', 'Saved ✓');
      await waitForSettingsSaveFeedback();
      resetBtn();
      return;
    }
    if (activeTab === 'search') {
      _markSettingsCacheBusted('settings-search-summary');
      _markSettingsCacheBusted('settings-credentials-fields');
      loadSearchSettingsSummary().catch(() => {});
      loadCredFields().catch(() => {});
      if (bulkPayload.search?.search_rigor) quickSearchRigor = bulkPayload.search.search_rigor;
    }
    if (activeTab === 'models') {
      _markSettingsCacheBusted('settings-models');
    }
    if (activeTab === 'channels') {
      _markSettingsCacheBusted('settings-channels');
    }
    if (activeTab === 'integrations') {
      _markSettingsCacheBusted('settings-webhooks');
      _markSettingsCacheBusted('settings-mcp');
    }
    const securityStatus = document.getElementById('settings-security-status');
    if (activeTab === 'security' && securityStatus) setSettingsStatus(securityStatus, 'success', 'Saved');
    updateQuickModeUI();
    addProcessEntry('final', `${settingsTabLabel(activeTab)} settings saved.`);
    setSettingsSaveFeedback('saved', 'Saved ✓');
    await waitForSettingsSaveFeedback();
    closeSettings();
  } catch (err) {
    addProcessEntry('error', `Failed to save settings: ${err.message}`);
    setSettingsSaveFeedback('error', 'Try again');
    setTimeout(resetBtn, 1800);
  } finally {
    clearTimeout(safetyTimer);
  }
}

// Approve a memory suggestion shown in the process log
async function confirmMemory(index) {
  const entry = processLogEntries[index];
  if (!entry || entry.type !== 'memory') return;
  const suggestion = entry.extra || {};
  try {
    addProcessEntry('info', 'Saving memory...');
    const res = await api('/api/memory/confirm', { method: 'POST', body: JSON.stringify(suggestion) });
    if (res && res.ok === false) {
      addProcessEntry('error', `Memory save failed: ${res.error || JSON.stringify(res)}`);
      return;
    }
    processLogEntries[index].type = 'result';
    processLogEntries[index].content = `Saved memory: ${String(entry.content).slice(0,200)}`;
    renderProcessLog();
    addProcessEntry('final', 'Memory persisted.');
  } catch (err) {
    addProcessEntry('error', `Failed to save memory: ${err.message}`);
  }
}

function rejectMemory(index) {
  const entry = processLogEntries[index];
  if (!entry || entry.type !== 'memory') return;
  processLogEntries[index].type = 'warn';
  processLogEntries[index].content = 'Memory suggestion rejected.';
  renderProcessLog();
  addProcessEntry('info', 'Memory suggestion rejected by user.');
}

// ---- Run mission ----
async function runMission() {
  const input = document.getElementById('mission-input');
  const btn = document.getElementById('run-btn');
  const mission = input.value.trim();
  if (!mission) return;

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Starting...';

  try {
    const res = await api('/api/jobs', { method: 'POST', body: JSON.stringify({ mission }) });
    if (res.error) {
      log(`Error: ${res.error}`, 'error');
    } else {
      log(`Mission started ? Job ${res.jobId.slice(0, 8)}...`, 'success');
      input.value = '';
      setTimeout(() => selectJob(res.jobId), 500);
    }
  } catch (err) {
    log(`Failed: ${err.message}`, 'error');
  }

  btn.disabled = false;
  btn.innerHTML = '? Run';
}


// ─── Integrations Tab (Webhooks + MCP) ──────────────────────────

let _integTab = 'webhooks';

function setIntegTab(tab) {
  if (tab !== 'webhooks' && tab !== 'mcp') tab = 'webhooks';
  _integTab = tab;
  ['webhooks', 'mcp'].forEach(t => {
    const btn = document.getElementById('itab-' + t);
    const panel = document.getElementById('itab-panel-' + t);
    if (btn) {
      btn.style.background = t === tab ? '#eaf2ff' : '#fff';
      btn.style.color = t === tab ? '#0d4faf' : 'var(--muted)';
      btn.style.borderColor = t === tab ? '#bdd3f6' : 'var(--line)';
    }
    if (panel) panel.style.display = t === tab ? 'block' : 'none';
  });
}

async function loadIntegrationsTab() {
  setIntegTab(_integTab);
  const jobs = [loadWebhookSettings(), loadMCPServers()];
  Promise.allSettled(jobs).catch(() => {});
}

// --- Webhooks -----------------------------------------------------------------

function applyWebhookPayload(payload = {}) {
  const h = payload?.hooks || {};
  const cb = document.getElementById('wh-enabled');
  const inp = document.getElementById('wh-token');
  const pathInp = document.getElementById('wh-path');
  if (cb) cb.checked = h.enabled === true;
  if (inp) inp.value = h.tokenSet ? '••••••••' : '';
  if (pathInp) pathInp.value = h.path || '/hooks';
  updateWebhookStatus(h.enabled, h.tokenSet);
  updateWebhookUrlDisplay(h.enabled, h.tokenSet, h.path || '/hooks');
}

async function loadWebhookSettings() {
  const cached = _withSettingsCache({
    key: 'settings-webhooks',
    ttlMs: SETTINGS_DATA_CACHE_TTL_MS.integrationsWebhook,
    fetcher: () => api('/api/settings/hooks'),
  });
  if (cached.value) {
    applyWebhookPayload(cached.value);
    if (!cached.refreshPromise) return;
    cached.refreshPromise.then((fresh) => {
      if (fresh) applyWebhookPayload(fresh);
    }).catch(() => {});
    return;
  }
  try {
    const data = await cached.refreshPromise;
    if (data) applyWebhookPayload(data);
  } catch(e) {
    console.warn('loadWebhookSettings:', e);
  }
}

function updateWebhookStatus(enabled, tokenSet) {
  const dot = document.getElementById('wh-status-dot');
  const txt = document.getElementById('wh-status-text');
  if (!dot || !txt) return;
  if (enabled && tokenSet) {
    dot.style.background = '#22c55e';
    txt.textContent = 'Active — endpoint is running';
    txt.style.color = '#166534';
  } else if (!enabled) {
    dot.style.background = '#ccc';
    txt.textContent = 'Disabled';
    txt.style.color = 'var(--muted)';
  } else {
    dot.style.background = '#f59e0b';
    txt.textContent = 'Enabled but no token set';
    txt.style.color = '#92400e';
  }
}

function updateWebhookUrlDisplay(enabled, tokenSet, hookPath) {
  const el = document.getElementById('wh-url-display');
  if (!el) return;
  if (enabled && tokenSet) {
    const origin = window.location.origin || 'http://localhost:18789';
    el.style.display = 'block';
    el.textContent = origin + hookPath + '/agent';
  } else {
    el.style.display = 'none';
  }
}

function generateWebhookToken() {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  const token = Array.from(arr).map(b => b.toString(16).padStart(2,'0')).join('');
  const inp = document.getElementById('wh-token');
  if (inp) { inp.value = token; inp.type = 'text'; setTimeout(() => { inp.type = 'password'; }, 4000); }
}

async function saveWebhookSettings() {
  const enabled = document.getElementById('wh-enabled')?.checked ?? false;
  const rawToken = document.getElementById('wh-token')?.value?.trim() || '';
  const hookPath = document.getElementById('wh-path')?.value?.trim() || '/hooks';
  try {
    const r = await api('/api/settings/hooks', {
      method: 'POST',
      body: JSON.stringify({ enabled, token: rawToken, path: hookPath }),
    });
    if (r.success) {
      _markSettingsCacheBusted('settings-webhooks');
      await loadWebhookSettings();
      showIntegMsg('? Webhook settings saved — restart gateway to apply', '#166534', '#f0fdf4');
    } else {
      showIntegMsg('Error: ' + (r.error || 'Unknown error'), '#991b1b', '#fef2f2');
    }
  } catch(e) {
    showIntegMsg('Save failed: ' + e.message, '#991b1b', '#fef2f2');
  }
}

async function testWebhookEndpoint() {
  try {
    const r = await api('/api/settings/hooks/test', { method: 'POST' });
    if (r.success) {
      showIntegMsg('? ' + (r.message || 'Endpoint is active'), '#166534', '#f0fdf4');
    } else {
      showIntegMsg('? ' + (r.error || 'Test failed'), '#991b1b', '#fef2f2');
    }
  } catch(e) {
    showIntegMsg('Test failed: ' + e.message, '#991b1b', '#fef2f2');
  }
}

function copyWebhookCurl() {
  const origin = window.location.origin || 'http://localhost:18789';
  const hookPath = document.getElementById('wh-path')?.value?.trim() || '/hooks';
  const curl = `curl -X POST ${origin}${hookPath}/agent \\
  -H "x-prometheus-token: YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"message": "Hello from webhook", "name": "MyApp", "deliver": true}'`;
  navigator.clipboard?.writeText(curl).then(() => {
    showIntegMsg('cURL example copied to clipboard', '#1e40af', '#eff6ff');
  }).catch(() => {
    showIntegMsg('Could not copy — check browser permissions', '#92400e', '#fffbeb');
  });
}

// --- MCP ---------------------------------------------------------------------

let _mcpEditingId = null;

let MCP_PRESETS = null;

async function loadMCPPresetCatalog() {
  if (MCP_PRESETS) return MCP_PRESETS;
  const result = await api('/api/extensions/mcp-presets');
  MCP_PRESETS = Object.fromEntries((result?.presets || []).map((preset) => [preset.id, preset]));
  return MCP_PRESETS;
}

async function loadMCPServers() {
  renderMCPPresetCatalog().catch(() => {});
  const el = document.getElementById('mcp-server-list');
  if (!el) return;
  const cached = _withSettingsCache({
    key: 'settings-mcp',
    ttlMs: SETTINGS_DATA_CACHE_TTL_MS.integrationsMcp,
    fetcher: () => api('/api/mcp/servers'),
  });
  const applyServers = (data = {}) => {
    const servers = data.servers || [];
    if (servers.length === 0) {
      el.innerHTML = '<div style="color:var(--muted);font-style:italic;padding:8px 0">No MCP servers configured yet.<br>Add one above or click a preset on the right.</div>';
      return;
    }
    el.innerHTML = servers.map(s => {
      const statusColor = s.status === 'connected' ? '#22c55e' : s.status === 'error' ? '#ef4444' : s.status === 'connecting' ? '#f59e0b' : '#9ca3af';
      const statusLabel = s.status === 'connected' ? `Connected · ${s.toolCount} tool${s.toolCount !== 1 ? 's' : ''}` : s.status === 'error' ? 'Error' : s.status === 'connecting' ? 'Connecting…' : 'Disconnected';
      const toolTip = s.toolNames?.length ? s.toolNames.join(', ') : '';
      return `<div style="display:flex;align-items:flex-start;gap:8px;padding:8px;border:1px solid var(--line);border-radius:8px;margin-bottom:6px;background:${s.enabled ? '#fff' : '#fafafa'}">
        <div style="padding-top:2px">
          <div style="width:8px;height:8px;border-radius:50%;background:${statusColor};flex-shrink:0"></div>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:12px;color:var(--text)">${escHtml(s.name)} <span style="font-weight:400;color:var(--muted);font-size:11px">(${escHtml(s.id)})</span></div>
          <div style="font-size:11px;color:${statusColor};margin-top:1px" title="${escHtml(toolTip)}">${statusLabel}${s.error ? ` — ${escHtml(s.error.slice(0,60))}` : ''}</div>
          ${toolTip ? `<div style="font-size:10px;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(toolTip)}">${escHtml(toolTip.slice(0,80))}${toolTip.length>80?'…':''}</div>` : ''}
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          ${s.status === 'connected'
            ? `<button onclick="disconnectMCPServer('${s.id}')" style="padding:3px 8px;border:1px solid var(--line);border-radius:5px;background:#fff;font-size:10px;cursor:pointer">Disconnect</button>`
            : `<button onclick="connectMCPServer('${s.id}')" style="padding:3px 8px;border:1px solid var(--brand);border-radius:5px;background:#fff;color:var(--brand);font-size:10px;font-weight:600;cursor:pointer">Connect</button>`
          }
          <button onclick="editMCPServer('${s.id}')" style="padding:3px 8px;border:1px solid var(--line);border-radius:5px;background:#fff;font-size:10px;cursor:pointer">Edit</button>
          <button onclick="deleteMCPServer('${s.id}')" style="padding:3px 8px;border:1px solid #fecaca;border-radius:5px;background:#fff;color:#ef4444;font-size:10px;cursor:pointer">Delete</button>
        </div>
      </div>`;
    }).join('');
  };
  if (cached.value) {
    applyServers(cached.value);
    if (!cached.refreshPromise) return;
    cached.refreshPromise.then((fresh) => {
      if (fresh) applyServers(fresh);
    }).catch((e) => {
      console.warn('loadMCPServers refresh failed:', e);
    });
    return;
  }
  try {
    const data = await cached.refreshPromise;
    if (data) applyServers(data);
  } catch(e) {
    el.innerHTML = `<div style="color:#ef4444">Failed to load: ${escHtml(e.message)}</div>`;
  }
}

async function renderMCPPresetCatalog() {
  const grid = document.getElementById('mcp-preset-grid');
  if (!grid) return;
  const presets = Object.values(await loadMCPPresetCatalog());
  grid.innerHTML = presets.map((preset) => `<button onclick="prefillMCPServer(${JSON.stringify(String(preset.id)).replace(/</g, '\\u003c')})" style="text-align:left;padding:7px 9px;border:1px solid var(--line);border-radius:7px;background:#fafafa;cursor:pointer;font-size:11px"><div style="font-weight:600;color:var(--text)">${escHtml(String(preset.name || preset.id))}</div><div style="color:var(--muted)">${escHtml(String(preset.transport || 'MCP'))}${preset.credentialFields?.length ? ` · ${preset.credentialFields.length} credential field(s)` : ''}</div></button>`).join('') || '<div style="color:var(--muted)">No presets registered.</div>';
}

function showMCPAddForm(editData) {
  _mcpEditingId = editData?.id || null;
  document.getElementById('mcp-add-form').style.display = 'block';
  document.getElementById('mcp-form-title').textContent = _mcpEditingId ? 'Edit MCP Server' : 'Add MCP Server';
  document.getElementById('mcp-form-msg').textContent = '';

  if (editData) {
    const v = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.value = val; };
    v('mcp-f-id', editData.id); v('mcp-f-name', editData.name);
    document.getElementById('mcp-f-transport').value = editData.transport || 'stdio';
    onMCPTransportChange();
    v('mcp-f-command', editData.command || '');
    v('mcp-f-args', (editData.args || []).join('\n'));
    v('mcp-f-env', Object.entries(editData.env || {}).map(([k,v]) => `${k}=${v}`).join('\n'));
    v('mcp-f-url', editData.url || '');
    v('mcp-f-headers', Object.entries(editData.headers || {}).map(([k,v]) => `${k}: ${v}`).join('\n'));
    const cb = document.getElementById('mcp-f-enabled');
    if (cb) cb.checked = editData.enabled !== false;
  } else {
    ['mcp-f-id','mcp-f-name','mcp-f-command','mcp-f-args','mcp-f-env','mcp-f-url','mcp-f-headers'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('mcp-f-transport').value = 'stdio';
    onMCPTransportChange();
    const cb = document.getElementById('mcp-f-enabled'); if (cb) cb.checked = true;
  }
  document.getElementById('mcp-f-id').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideMCPAddForm() {
  document.getElementById('mcp-add-form').style.display = 'none';
  _mcpEditingId = null;
}

function onMCPTransportChange() {
  const t = document.getElementById('mcp-f-transport')?.value;
  document.getElementById('mcp-stdio-fields').style.display = t === 'stdio' ? 'block' : 'none';
  document.getElementById('mcp-sse-fields').style.display = t === 'sse' ? 'block' : 'none';
}

async function prefillMCPServer(presetKey) {
  const catalog = await loadMCPPresetCatalog();
  const p = catalog[presetKey];
  if (!p) return;
  const built = await api('/api/extensions/mcp-presets/build', { method: 'POST', body: JSON.stringify({ id: presetKey, credentials: {} }) });
  const config = built?.config || {};
  showMCPAddForm();
  const v = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  v('mcp-f-id', presetKey);
  v('mcp-f-name', p.name);
  document.getElementById('mcp-f-transport').value = config.transport || p.transport;
  onMCPTransportChange();
  v('mcp-f-command', config.command || '');
  v('mcp-f-args', Array.isArray(config.args) ? config.args.join('\n') : '');
  v('mcp-f-env', config.env ? Object.entries(config.env).map(([key, value]) => `${key}=${value}`).join('\n') : '');
  v('mcp-f-url', config.url || '');
  setIntegTab('mcp');
}

async function saveMCPServer() {
  const id = document.getElementById('mcp-f-id')?.value?.trim();
  const name = document.getElementById('mcp-f-name')?.value?.trim();
  const transport = document.getElementById('mcp-f-transport')?.value || 'stdio';
  const enabled = document.getElementById('mcp-f-enabled')?.checked ?? true;
  const msgEl = document.getElementById('mcp-form-msg');

  if (!id || !name) { if (msgEl) msgEl.textContent = 'ID and Name are required.'; return; }

  const cfg = { id, name, transport, enabled };

  if (transport === 'stdio') {
    cfg.command = document.getElementById('mcp-f-command')?.value?.trim() || '';
    const argsRaw = document.getElementById('mcp-f-args')?.value || '';
    cfg.args = argsRaw.split('\n').map(s => s.trim()).filter(Boolean);
    const envRaw = document.getElementById('mcp-f-env')?.value || '';
    cfg.env = {};
    envRaw.split('\n').map(l => l.trim()).filter(Boolean).forEach(line => {
      const eq = line.indexOf('='); if (eq > 0) cfg.env[line.slice(0,eq).trim()] = line.slice(eq+1);
    });
  } else {
    cfg.url = document.getElementById('mcp-f-url')?.value?.trim() || '';
    const headersEl = document.getElementById('mcp-f-headers');
    const headersRaw = headersEl?.value || '';
    console.log('[MCP Debug] Headers textarea element:', { exists: !!headersEl, visible: headersEl?.offsetParent !== null, value: headersRaw });
    cfg.headers = {};
    headersRaw.split('\n').map(l => l.trim()).filter(Boolean).forEach(line => {
      const colon = line.indexOf(':'); if (colon > 0) cfg.headers[line.slice(0,colon).trim()] = line.slice(colon+1).trim();
    });
    console.log('[MCP Debug] Parsed headers:', cfg.headers);
  }

  try {
    // Debug: log what we're about to send
    console.log('[MCP Debug] Saving config:', { id, name, transport, enabled,
      url: cfg.url,
      headersCount: Object.keys(cfg.headers || {}).length,
      headers: cfg.headers ? Object.keys(cfg.headers) : 'none' });

    const r = await api('/api/mcp/servers', { method: 'POST', body: JSON.stringify(cfg) });
    if (r.success) {
      if (msgEl) msgEl.textContent = '? Saved';
      _markSettingsCacheBusted('settings-mcp');
      setTimeout(() => hideMCPAddForm(), 600);
      await loadMCPServers();
      // Auto-connect if enabled
      if (enabled) connectMCPServer(id);
    } else {
      if (msgEl) msgEl.textContent = 'Error: ' + (r.error || 'Unknown');
    }
  } catch(e) {
    if (msgEl) msgEl.textContent = 'Save failed: ' + e.message;
  }
}

async function editMCPServer(id) {
  try {
    const data = await api('/api/mcp/servers');
    const server = (data.servers || []).find(s => s.id === id);
    if (server) showMCPAddForm(server);
  } catch(e) { console.warn('editMCPServer:', e); }
}

async function deleteMCPServer(id) {
  if (!confirm(`Delete MCP server "${id}"?`)) return;
  try {
    await api(`/api/mcp/servers/${id}`, { method: 'DELETE' });
    _markSettingsCacheBusted('settings-mcp');
    await loadMCPServers();
  } catch(e) { showIntegMsg('Delete failed: ' + e.message, '#991b1b', '#fef2f2'); }
}

async function connectMCPServer(id) {
  showIntegMsg('Connecting to ' + id + '…', '#1e40af', '#eff6ff');
  try {
    const r = await api(`/api/mcp/servers/${id}/connect`, { method: 'POST' });
    if (r.success) {
      _markSettingsCacheBusted('settings-mcp');
      showIntegMsg(`? Connected — ${(r.tools||[]).length} tool(s) available`, '#166534', '#f0fdf4');
    } else {
      showIntegMsg('? Connection failed: ' + (r.error || 'Unknown'), '#991b1b', '#fef2f2');
    }
    _markSettingsCacheBusted('settings-mcp');
    await loadMCPServers();
  } catch(e) {
    showIntegMsg('Connect error: ' + e.message, '#991b1b', '#fef2f2');
    _markSettingsCacheBusted('settings-mcp');
    await loadMCPServers();
  }
}

async function disconnectMCPServer(id) {
  try {
    await api(`/api/mcp/servers/${id}/disconnect`, { method: 'POST' });
    _markSettingsCacheBusted('settings-mcp');
    await loadMCPServers();
    showIntegMsg('Disconnected from ' + id, '#475569', '#f8fafc');
  } catch(e) { showIntegMsg('Disconnect error: ' + e.message, '#991b1b', '#fef2f2'); }
}

// --- Shared helper ------------------------------------------------------------

function showIntegMsg(msg, color, bg) {
  let el = document.getElementById('integ-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'integ-toast';
    el.style.cssText = 'position:fixed;bottom:80px;right:24px;z-index:9999;padding:10px 16px;border-radius:10px;font-size:12px;font-weight:600;max-width:320px;box-shadow:0 4px 16px rgba(0,0,0,0.12);transition:opacity .3s';
    document.body.appendChild(el);
  }
  el.style.background = bg || '#f0fdf4';
  el.style.color = color || '#166534';
  el.style.border = `1px solid ${color || '#166534'}33`;
  el.style.opacity = '1';
  el.textContent = msg;
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 4000);
}

// ─── Expose on window for HTML onclick handlers ────────────────
window._updateHeartbeatMdPreview = _updateHeartbeatMdPreview;
window.addSiteShortcut = addSiteShortcut;
window.agentFormNew = agentFormNew;
window.applyHeartbeatSettingsToForm = applyHeartbeatSettingsToForm;
window.buildProviderPayload = buildProviderPayload;
window.closeSettings = closeSettings;
window.confirmMemory = confirmMemory;
window.connectMCPServer = connectMCPServer;
window.copyWebhookCurl = copyWebhookCurl;
window.deleteMCPServer = deleteMCPServer;
window.deleteSelectedAgent = deleteSelectedAgent;
window.deleteSiteShortcutUI = deleteSiteShortcutUI;
window.connectAnthropic = connectAnthropic;
window.disconnectAnthropic = disconnectAnthropic;
window.onAnthropicUsageTrackingToggle = onAnthropicUsageTrackingToggle;
window.completeAnthropicUsageTracking = completeAnthropicUsageTracking;
window.cancelAnthropicUsageTracking = cancelAnthropicUsageTracking;
window.onAnthropicThinkingToggle = onAnthropicThinkingToggle;
window.onAnthropicModelChange = onAnthropicModelChange;
window.syncAnthropicReasoningControls = syncAnthropicReasoningControls;
window.disconnectCodex = disconnectCodex;
window.disconnectMCPServer = disconnectMCPServer;
window.editMCPServer = editMCPServer;
window.ensureAgentHbEditor = ensureAgentHbEditor;
window.ensureAgentMdEditor = ensureAgentMdEditor;
window.ensureHeartbeatEditor = ensureHeartbeatEditor;
window.findSelectedAgent = findSelectedAgent;
window.generateWebhookToken = generateWebhookToken;
window.getAgentFromForm = getAgentFromForm;
window.syncAgentReasoningControl = syncAgentReasoningControl;
window.getSelectedChannelType = getSelectedChannelType;
window.hideMCPAddForm = hideMCPAddForm;
window.isSelectedAgentTeamMember = isSelectedAgentTeamMember;

// --- Agent Model Defaults --------------------------------------------------

const AMD_SLOTS = {
  'main-chat':       'main_chat',
  'proposal-high':   'proposal_executor_high_risk',
  'proposal-low':    'proposal_executor_low_risk',
  'coordinator':     'coordinator',
  'manager':         'manager',
  'background-spawn': 'background_spawn',
  // Per-role-type subagent defaults
  'subagent-planner':       'subagent_planner',
  'subagent-orchestrator':  'subagent_orchestrator',
  'subagent-researcher':    'subagent_researcher',
  'subagent-analyst':       'subagent_analyst',
  'subagent-builder':       'subagent_builder',
  'subagent-operator':      'subagent_operator',
  'subagent-verifier':      'subagent_verifier',
  // Switch model tiers
  'switch-model-low':       'switch_model_low',
  'switch-model-medium':    'switch_model_medium',
};

const AMD_STATIC_MODELS = {
  openai:       ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4-pro', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5-pro', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5-chat-latest', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o4-mini', 'o3', 'o1'],
  openai_codex: ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4-codex', 'gpt-5.4-codex-mini', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.3', 'gpt-5.2-codex', 'gpt-5.2', 'gpt-5.1-codex-max', 'gpt-5.1-codex-mini', 'gpt-5.1-codex', 'gpt-5.1'],
  anthropic:    ['claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  perplexity:   ['sonar-pro', 'sonar', 'sonar-reasoning-pro', 'sonar-reasoning', 'sonar-deep-research'],
  gemini:       ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
};

const AMD_TEMPLATE_CACHE_KEY = 'prometheus_agent_model_default_templates_v1';
let amdTemplatesCache = [];
let amdActiveTemplateId = '';
let amdDefaultTemplateId = '';

function providerAccountsForDefault(providerId) {
  const accounts = normalizeProviderAccountsForUI(providerId, getProviderConfigFromCache(providerId));
  return accounts.filter((account) => account?.id && account.status !== 'disconnected');
}

function syncAutoSettleDateVisibility() {
  const select = document.getElementById('settings-auto-settle-after');
  const wrap = document.getElementById('settings-auto-settle-custom-wrap');
  const extra = document.getElementById('settings-auto-settle-extra');
  const date = document.getElementById('settings-auto-settle-custom-date');
  const custom = select?.value === 'custom';
  if (extra) extra.style.display = custom ? 'block' : 'none';
  if (wrap) wrap.style.display = custom ? 'grid' : 'none';
  if (date) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    date.max = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  }
}

function renderAutoSettleLastRun(lastRun) {
  const status = document.getElementById('settings-auto-settle-status');
  if (!status) return;
  if (!lastRun) {
    status.textContent = 'Automatic settling is off until you choose a period and save.';
    return;
  }
  const when = Number(lastRun.completedAt) > 0 ? new Date(Number(lastRun.completedAt)).toLocaleString() : 'not yet';
  const action = lastRun.dryRun ? `${Number(lastRun.wouldSettle || 0)} eligible in preview` : `${Number(lastRun.settled || 0)} settled`;
  status.textContent = `Last check: ${when} · ${action} · ${Number(lastRun.scanned || 0)} scanned${lastRun.truncated ? ' · more remain for the next bounded batch' : ''}.`;
}

async function loadAutoSettleSettings() {
  try {
    const data = await api('/api/settings/session');
    const settings = data?.session?.autoSettle || {};
    const select = document.getElementById('settings-auto-settle-after');
    const date = document.getElementById('settings-auto-settle-custom-date');
    if (select) {
      const value = settings.mode === 'custom' ? 'custom' : String(Number(settings.afterDays) || 0);
      select.value = ['0', '7', '14', '30', '90', 'custom'].includes(value) ? value : '0';
    }
    if (date) date.value = String(settings.customDate || '');
    syncAutoSettleDateVisibility();
    renderAutoSettleLastRun(data?.session?.autoSettleLastRun || data?.autoSettleLastRun || null);
  } catch (error) {
    const status = document.getElementById('settings-auto-settle-status');
    if (status) status.textContent = `Could not load auto-settle settings: ${error.message}`;
  }
}

function buildAutoSettlePayloadFromUI() {
  const selected = document.getElementById('settings-auto-settle-after')?.value || '0';
  if (selected !== 'custom') return { afterDays: Number(selected) || 0, activationMode: 'start_now' };
  const customDate = String(document.getElementById('settings-auto-settle-custom-date')?.value || '').trim();
  if (!customDate) throw new Error('Choose a Custom cutoff date first.');
  const localDate = new Date(`${customDate}T00:00:00`);
  return {
    afterDays: 'custom',
    customDate,
    customDateOffsetMinutes: Number.isFinite(localDate.getTime()) ? localDate.getTimezoneOffset() : new Date().getTimezoneOffset(),
    activationMode: 'start_now',
  };
}

function askAutoSettleActivationMode() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;padding:18px';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:22px;max-width:560px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,0.18);font-family:var(--font);color:var(--text)';
    box.innerHTML = `
      <div style="font-size:15px;font-weight:800;margin-bottom:9px">When should auto-settle begin?</div>
      <div style="font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:17px">You chose a past date. Include chats that are already older than that date, or start the inactivity clock from now for existing chats.</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
        <button data-auto-settle-choice="cancel" type="button" style="border:1px solid var(--line);background:var(--panel-2);color:var(--muted);border-radius:8px;padding:8px 13px;font:inherit;font-size:12px;font-weight:700;cursor:pointer">Cancel</button>
        <button data-auto-settle-choice="start_now" type="button" style="border:1px solid var(--line);background:var(--panel-2);color:var(--text);border-radius:8px;padding:8px 13px;font:inherit;font-size:12px;font-weight:700;cursor:pointer">Start from now</button>
        <button data-auto-settle-choice="apply_existing" type="button" style="border:none;background:var(--brand);color:#fff;border-radius:8px;padding:8px 13px;font:inherit;font-size:12px;font-weight:700;cursor:pointer">Apply to eligible chats</button>
      </div>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    const finish = (value) => { overlay.remove(); resolve(value); };
    box.querySelectorAll('[data-auto-settle-choice]').forEach((button) => {
      button.addEventListener('click', () => finish(button.getAttribute('data-auto-settle-choice') === 'cancel' ? null : button.getAttribute('data-auto-settle-choice')));
    });
    overlay.addEventListener('click', (event) => { if (event.target === overlay) finish(null); });
  });
}

async function previewAutoSettleSettings() {
  const status = document.getElementById('settings-auto-settle-status');
  const button = document.getElementById('settings-auto-settle-preview');
  if (button) button.disabled = true;
  if (status) status.textContent = 'Previewing protected-state checks…';
  try {
    const data = await api('/api/settings/auto-settle/preview', { method: 'POST', body: JSON.stringify({}) });
    const summary = data?.summary || {};
    if (status) status.textContent = `${Number(summary.wouldSettle || 0)} eligible · ${Number(summary.scanned || 0)} scanned · ${Object.keys(summary.skipped || {}).length} protected reason(s).`;
    renderAutoSettleLastRun(summary);
  } catch (error) {
    if (status) status.textContent = `Preview failed: ${error.message}`;
  } finally {
    if (button) button.disabled = false;
  }
}

function wireAutoSettleControls() {
  const select = document.getElementById('settings-auto-settle-after');
  if (!select || select.dataset.autoSettleWired === 'true') return;
  select.dataset.autoSettleWired = 'true';
  select.addEventListener('change', syncAutoSettleDateVisibility);
  document.getElementById('settings-auto-settle-preview')?.addEventListener('click', previewAutoSettleSettings);
  syncAutoSettleDateVisibility();
}

function ensureModelsSections() {
  const column = document.getElementById('agent-model-defaults-col');
  if (!column || column.dataset.modelsSectionsReady === 'true') return;

  const sectionOrder = {
    'Switch Models': 30,
    'Teams & Agents': 40,
    'Subagent Role Defaults': 50,
    'Proposal Executors': 60,
    'Summary Compactor': 70,
    'Brain System': 80,
  };
  const sectionHelp = {
    'Switch Models': 'Models used when a turn needs a faster or more deliberate route.',
    'Teams & Agents': 'Defaults for the coordinator and manager roles used by team runs.',
    'Subagent Role Defaults': 'Per-role defaults for planner, research, build, and verification work.',
    'Proposal Executors': 'Defaults for high-risk and low-risk proposal execution.',
    'Summary Compactor': 'The route used to compact autonomous goal progress.',
    'Brain System': 'Routes used by autonomous Thought and Dream runs.',
  };
  const directChildren = Array.from(column.children);
  const legacyTitles = directChildren.filter((node) => node.classList.contains('model-default-section-title'));
  const sectionByLabel = new Map();

  for (const title of legacyTitles) {
    const label = String(title.textContent || '').trim();
    const section = document.createElement('section');
    section.className = 'settings-models-subsection settings-models-legacy-section';
    section.dataset.modelsSection = label;
    section.style.order = String(sectionOrder[label] || 60);

    const heading = document.createElement('div');
    heading.className = 'settings-section-heading';
    heading.innerHTML = escHtml(label === 'Switch Models' ? 'Switch Model' : label)
      + ' <span class="settings-help" tabindex="0" data-settings-help="'
      + escHtml(sectionHelp[label] || ('About ' + label))
      + '" aria-label="About ' + escHtml(label) + '">?</span>';
    section.appendChild(heading);

    const panel = document.createElement('div');
    panel.className = 'settings-section-panel';
    section.appendChild(panel);
    title.parentElement.insertBefore(section, title);

    let cursor = title.nextElementSibling;
    while (cursor && !cursor.classList.contains('model-default-section-title') && cursor.id !== 'amd-status' && cursor.id !== 'brain-model-status') {
      const next = cursor.nextElementSibling;
      panel.appendChild(cursor);
      cursor = next;
    }
    title.remove();
    sectionByLabel.set(label, { section, panel });
  }

  const background = column.querySelector('#amd-background-spawn-prov')?.closest('div[style*="order:30"]');
  const switchSection = sectionByLabel.get('Switch Models');
  if (background && switchSection?.panel) {
    background.classList.add('settings-models-background-row');
    switchSection.panel.appendChild(background);
  }

  column.querySelector('.settings-model-defaults-intro')?.style?.setProperty('order', '0');
  column.querySelector('.settings-models-main-section')?.style?.setProperty('order', '10');
  column.querySelector('.settings-models-template-section')?.style?.setProperty('order', '20');
  column.dataset.modelsSectionsReady = 'true';
}

function ensureAmdAccountControls() {
  for (const slotId of Object.keys(AMD_SLOTS)) {
    const providerSelect = document.getElementById(`amd-${slotId}-prov`);
    if (!providerSelect || document.getElementById(`amd-${slotId}-account`)) continue;
    const wrapper = document.createElement('div');
    wrapper.id = `amd-${slotId}-account-wrap`;
    wrapper.style.marginBottom = '4px';
    wrapper.style.display = 'none';
    wrapper.innerHTML = `<select id="amd-${escHtml(slotId)}-account" class="settings-input" style="width:100%" aria-label="Provider account"></select>`;
    providerSelect.insertAdjacentElement('beforebegin', wrapper);
  }
  decorateModelRoutingRows();
}

function decorateModelRoutingRows() {
  const column = document.getElementById('agent-model-defaults-col');
  if (!column) return;
  for (const slotId of Object.keys(AMD_SLOTS)) {
    const providerSelect = document.getElementById('amd-' + slotId + '-prov');
    const row = providerSelect?.closest('div');
    if (row && row !== column) row.classList.add('settings-model-slot-row');
  }
  const background = column.querySelector('.settings-models-background-row');
  if (background) background.classList.add('settings-model-slot-row');
}

function syncAmdAccount(slotId, selectedValue) {
  ensureAmdAccountControls();
  const provider = String(document.getElementById(`amd-${slotId}-prov`)?.value || '').trim();
  const wrapper = document.getElementById(`amd-${slotId}-account-wrap`);
  const select = document.getElementById(`amd-${slotId}-account`);
  if (!wrapper || !select) return;
  const accounts = provider ? providerAccountsForDefault(provider) : [];
  wrapper.style.display = accounts.length > 1 ? '' : 'none';
  if (accounts.length <= 1) {
    select.innerHTML = '';
    select.value = '';
    return;
  }
  const current = String(selectedValue !== undefined ? selectedValue : select.value || '').trim();
  select.innerHTML = accounts.map((account) => `<option value="${escHtml(account.id)}">${escHtml(account.label || account.id)}</option>`).join('');
  select.value = accounts.some((account) => account.id === current)
    ? current
    : String(getProviderConfigFromCache(provider)?.defaultAccountId || accounts[0].id);
}

function getVoiceAgentDefaultFromForm() {
  return {
    provider: String(document.getElementById('amd-voice-agent-provider')?.value || '').trim(),
    voice: String(document.getElementById('amd-voice-agent-voice')?.value || '').trim(),
  };
}

async function loadVoiceAgentDefaultOptions(preserveSelected = false) {
  const providerEl = document.getElementById('amd-voice-agent-provider');
  const voiceEl = document.getElementById('amd-voice-agent-voice');
  if (!providerEl || !voiceEl) return;
  const provider = String(providerEl.value || '').trim();
  const selected = preserveSelected ? String(voiceEl.value || voiceEl.dataset.current || '').trim() : '';
  let voices = {
    openai_realtime: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'],
    xai: ['eve', 'ara', 'rex', 'sal', 'leo'],
  }[provider] || [];
  if (provider === 'openai_codex') {
    // Codex Voice/Live advertises the available AVAS voices at runtime. Keep a
    // safe fallback so the saved default remains editable while offline.
    voices = ['juniper', 'maple', 'spruce', 'ember', 'vale', 'breeze', 'arbor', 'sol', 'cove'];
    try {
      const status = await api('/api/realtime/status', { timeoutMs: 5000 });
      const liveVoices = Array.isArray(status?.codexBridgeActiveVoices)
        ? status.codexBridgeActiveVoices.map((voice) => String(voice || '').trim()).filter(Boolean)
        : [];
      if (status?.codexBridgeAvailable === true
        && status?.transport === 'codex_app_server'
        && liveVoices.length) {
        voices = Array.from(new Set(liveVoices));
      }
    } catch {}
  }
  voiceEl.disabled = !provider;
  voiceEl.innerHTML = `<option value="">use provider default</option>${Array.from(new Set([...voices, selected].filter(Boolean))).map((voice) => `<option value="${escHtml(voice)}">${escHtml(voice)}</option>`).join('')}`;
  voiceEl.value = selected && Array.from(voiceEl.options).some((option) => option.value === selected) ? selected : '';
}

function ensureAmdReasoningControls() {
  for (const slotId of Object.keys(AMD_SLOTS)) {
    const modelSel = document.getElementById('amd-' + slotId + '-model');
    if (!modelSel) continue;
    let select = document.getElementById('amd-' + slotId + '-reasoning');
    if (!select) {
      const wrapper = document.createElement('div');
      wrapper.style.marginTop = '4px';
      wrapper.innerHTML = `<div style="font-size:10px;color:var(--muted);margin-bottom:3px">Reasoning</div><select id="amd-${escHtml(slotId)}-reasoning" class="settings-input" style="width:100%"><option value="">provider default</option></select>`;
      modelSel.insertAdjacentElement('afterend', wrapper);
      select = wrapper.querySelector('select');
    }
    if (!modelSel.dataset.reasoningBound) {
      modelSel.addEventListener('change', () => syncAmdReasoning(slotId));
      modelSel.dataset.reasoningBound = '1';
    }
  }
  ensureAmdSpeedControls();
}

function ensureAmdSpeedControls() {
  for (const slotId of Object.keys(AMD_SLOTS)) {
    const modelSel = document.getElementById('amd-' + slotId + '-model');
    const reasoningSel = document.getElementById('amd-' + slotId + '-reasoning');
    if (!modelSel || !reasoningSel || document.getElementById('amd-' + slotId + '-speed')) continue;
    const anchor = reasoningSel.closest('div') || reasoningSel;
    const wrapper = document.createElement('div');
    wrapper.id = 'amd-' + slotId + '-speed-wrap';
    wrapper.className = 'settings-model-speed-wrap';
    wrapper.innerHTML = '<div class="settings-model-inline-label">Speed</div>'
      + '<select id="amd-' + escHtml(slotId) + '-speed" class="settings-input" style="width:100%">'
      + '<option value="standard">Standard</option><option value="fast">Fast</option></select>';
    wrapper.style.display = 'none';
    anchor.insertAdjacentElement('afterend', wrapper);
  }
}

function syncAmdReasoning(slotId, selectedValue) {
  ensureAmdReasoningControls();
  const prov = document.getElementById('amd-' + slotId + '-prov')?.value?.trim() || '';
  const model = document.getElementById('amd-' + slotId + '-model')?.value?.trim() || '';
  const select = document.getElementById('amd-' + slotId + '-reasoning');
  if (!select) return;
  const current = selectedValue !== undefined ? String(selectedValue || '') : String(select.value || '');
  const options = prov && model ? effortOptions(prov, model, true) : [''];
  select.innerHTML = options.map((effort) => `<option value="${escHtml(effort)}">${escHtml(effort || 'provider default')}</option>`).join('');
  select.disabled = !prov || !model || options.length <= 1;
  if (current && validEffort(prov, model, current)) select.value = current;
  else select.value = '';
  select.title = select.disabled ? 'This provider/model does not expose selectable reasoning effort.' : 'Reasoning effort for this agent default.';
  syncAmdSpeed(slotId);
}

function syncAmdSpeed(slotId, selectedValue) {
  ensureAmdSpeedControls();
  const provider = String(document.getElementById('amd-' + slotId + '-prov')?.value || '').trim();
  const model = String(document.getElementById('amd-' + slotId + '-model')?.value || '').trim();
  const wrapper = document.getElementById('amd-' + slotId + '-speed-wrap');
  const select = document.getElementById('amd-' + slotId + '-speed');
  if (!wrapper || !select) return;
  const providerSupportsSpeed = ['openai', 'openai_codex', 'anthropic'].includes(provider) && !!model;
  const supportsFast = providerSupportsSpeed && supportsFastSpeed(provider, model);
  wrapper.style.display = providerSupportsSpeed ? '' : 'none';
  const fastOption = select.querySelector('option[value="fast"]');
  if (fastOption) {
    fastOption.disabled = !supportsFast;
    fastOption.hidden = !supportsFast;
  }
  const current = selectedValue !== undefined ? String(selectedValue || '') : String(select.value || 'standard');
  select.value = supportsFast && current === 'fast' ? 'fast' : 'standard';
  select.disabled = !providerSupportsSpeed;
}

async function amdProviderChange(slotId) {
  ensureAmdReasoningControls();
  ensureAmdAccountControls();
  const provSel  = document.getElementById('amd-' + slotId + '-prov');
  const modelSel = document.getElementById('amd-' + slotId + '-model');
  if (!provSel || !modelSel) return;
  const prov = provSel.value;
  syncAmdAccount(slotId);
  if (typeof renderModelsUsage === 'function') renderModelsUsage();
  if (!prov) {
    modelSel.innerHTML = '<option value="">— same as main agent —</option>';
    syncAmdReasoning(slotId);
    return;
  }
  modelSel.innerHTML = '<option value="">Loading…</option>';
  try {
    await ensureProviderCatalogUIReady();
    await fetchCredentialedModelProviderIds();
    if (!isCredentialedModelProviderId(prov)) {
      modelSel.innerHTML = '<option value="">— provider not connected —</option>';
      syncAmdSpeed(slotId);
      return;
    }
    const models = await fetchProviderModelsForPicker(prov, { refreshOpenAI: prov === 'openai', includeLive: prov !== 'openai_codex' });
    if (!models.length) {
      modelSel.innerHTML = '<option value="">— no models found —</option>';
      syncAmdSpeed(slotId);
      return;
    }
    modelSel.innerHTML = models.map(m => `<option value="${escHtml(m)}">${escHtml(m)}</option>`).join('');
    syncAmdReasoning(slotId);
  } catch (e) {
    modelSel.innerHTML = '<option value="">— fetch failed —</option>';
    syncAmdReasoning(slotId);
    console.warn('amdProviderChange error:', e);
  }
}

function getAgentModelDefaultsFromForm() {
  const payload = {};
  for (const [slotId, field] of Object.entries(AMD_SLOTS)) {
    const prov  = document.getElementById('amd-' + slotId + '-prov')?.value?.trim()  || '';
    const model = document.getElementById('amd-' + slotId + '-model')?.value?.trim() || '';
    payload[field] = (prov && model) ? `${prov}/${model}` : '';
  }
  return payload;
}

function getAgentAccountDefaultsFromForm() {
  const payload = {};
  for (const [slotId, field] of Object.entries(AMD_SLOTS)) {
    const provider = String(document.getElementById(`amd-${slotId}-prov`)?.value || '').trim();
    const accounts = provider ? providerAccountsForDefault(provider) : [];
    const accountId = String(document.getElementById(`amd-${slotId}-account`)?.value || '').trim();
    if (accounts.length > 1 && accountId) payload[field] = accountId;
  }
  return payload;
}

function getAgentReasoningDefaultsFromForm() {
  const payload = {};
  for (const [slotId, field] of Object.entries(AMD_SLOTS)) {
    const value = document.getElementById('amd-' + slotId + '-reasoning')?.value?.trim() || '';
    payload[field] = value;
  }
  return payload;
}

function getAgentSpeedDefaultsFromForm() {
  const payload = {};
  for (const [slotId, field] of Object.entries(AMD_SLOTS)) {
    const value = document.getElementById('amd-' + slotId + '-speed')?.value?.trim() || '';
    payload[field] = value === 'fast' ? 'fast' : '';
  }
  return payload;
}

async function applyAgentModelDefaultsToForm(defaults = {}, reasoning = {}, accounts = {}, speed = {}, voiceAgent = {}) {
  ensureAmdReasoningControls();
  ensureAmdAccountControls();
  ensureAmdSpeedControls();
  await ensureProviderCatalogUIReady();
  await fetchCredentialedModelProviderIds();
  renderProviderSelectors();
  const d = defaults || {};
  for (const slotId of Object.keys(AMD_SLOTS)) {
    const provSel  = document.getElementById('amd-' + slotId + '-prov');
    const modelSel = document.getElementById('amd-' + slotId + '-model');
    if (provSel) provSel.value = '';
    if (modelSel) modelSel.innerHTML = '<option value="">select provider first</option>';
    syncAmdReasoning(slotId);
    syncAmdSpeed(slotId);
    syncAmdAccount(slotId);
  }
  for (const [slotId, field] of Object.entries(AMD_SLOTS)) {
    const val = d[field] || '';
    if (!val) continue;
    const slashIdx = String(val).indexOf('/');
    const hasProvider = slashIdx > 0;
    const prov = hasProvider ? String(val).slice(0, slashIdx) : '';
    const model = hasProvider ? String(val).slice(slashIdx + 1) : String(val);
    const provSel  = document.getElementById('amd-' + slotId + '-prov');
    const modelSel = document.getElementById('amd-' + slotId + '-model');
    if (provSel && prov) {
      // Always populate the configured value even if the provider is not currently credentialed.
      // Skipping here leaves the select empty, and a subsequent save would send an empty string
      // which causes the server to delete the key from agent_model_defaults.
      if (!Array.from(provSel.options).some(o => o.value === prov)) {
        const opt = document.createElement('option');
        opt.value = prov;
        opt.textContent = prov;
        provSel.appendChild(opt);
      }
      provSel.value = prov;
    }
    syncAmdAccount(slotId, accounts?.[field] || '');
    if (prov && modelSel) {
      await amdProviderChange(slotId);
    }
    if (modelSel && model) {
      if (!Array.from(modelSel.options).find(o => o.value === model)) {
        modelSel.innerHTML += `<option value="${escHtml(model)}">${escHtml(model)}</option>`;
      }
      modelSel.value = model;
    }
    syncAmdReasoning(slotId, reasoning?.[field] || '');
    syncAmdSpeed(slotId, speed?.[field] || 'standard');
  }
  const voiceProvider = document.getElementById('amd-voice-agent-provider');
  const voiceVoice = document.getElementById('amd-voice-agent-voice');
  if (voiceProvider) voiceProvider.value = String(voiceAgent?.provider || '').trim();
  if (voiceVoice) voiceVoice.dataset.current = String(voiceAgent?.voice || '').trim();
  await loadVoiceAgentDefaultOptions(true);
}

function renderAgentModelDefaultTemplates() {
  const select = document.getElementById('amd-template-select');
  const nameInput = document.getElementById('amd-template-name');
  if (!select) return;
  const current = select.value || amdActiveTemplateId || '';
  select.innerHTML = `<option value="">Select template...</option>${amdTemplatesCache.map((template) => (
    `<option value="${escHtml(template.id)}" ${template.id === current ? 'selected' : ''}>${escHtml(template.name)}</option>`
  )).join('')}`;
  if (current && amdTemplatesCache.some((template) => template.id === current)) select.value = current;
  const selected = amdTemplatesCache.find((template) => template.id === select.value);
  if (nameInput && selected && !nameInput.value.trim()) nameInput.value = selected.name;
}

function rememberAgentModelDefaultTemplates() {
  try {
    localStorage.setItem(AMD_TEMPLATE_CACHE_KEY, JSON.stringify({
      activeTemplateId: amdActiveTemplateId,
      defaultTemplateId: amdDefaultTemplateId,
      templates: amdTemplatesCache,
    }));
  } catch {}
}

function setAgentModelTemplateStatus(type, text) {
  const status = document.getElementById('amd-template-status');
  if (!status) return;
  setSettingsStatus(status, type, text || '');
}

function updateAgentModelTemplateCache(data) {
  amdTemplatesCache = Array.isArray(data?.templates) ? data.templates : [];
  amdActiveTemplateId = String(data?.activeTemplateId || '');
  if ('defaultTemplateId' in (data || {})) amdDefaultTemplateId = String(data.defaultTemplateId || '');
  rememberAgentModelDefaultTemplates();
  renderAgentModelDefaultTemplates();
  updateApplyAsDefaultButtonState();
}

async function loadAgentModelDefaultTemplates() {
  try {
    const data = await api('/api/settings/agent-model-default-templates');
    updateAgentModelTemplateCache(data);
  } catch (e) {
    try {
      const cached = JSON.parse(localStorage.getItem(AMD_TEMPLATE_CACHE_KEY) || '{}');
      amdTemplatesCache = Array.isArray(cached.templates) ? cached.templates : [];
      amdActiveTemplateId = String(cached.activeTemplateId || '');
      amdDefaultTemplateId = String(cached.defaultTemplateId || '');
      renderAgentModelDefaultTemplates();
      updateApplyAsDefaultButtonState();
    } catch {}
    console.warn('loadAgentModelDefaultTemplates error:', e);
  }
}

function onAgentModelTemplateSelect() {
  const select = document.getElementById('amd-template-select');
  const nameInput = document.getElementById('amd-template-name');
  const selected = amdTemplatesCache.find((template) => template.id === select?.value);
  if (nameInput) nameInput.value = selected?.name || '';
  updateApplyAsDefaultButtonState(select?.value || '');
}

async function loadAgentModelDefaults() {
  try {
    const data = await api('/api/settings/agent-model-defaults');
    await applyAgentModelDefaultsToForm(data?.defaults || {}, data?.reasoning || {}, data?.accounts || {}, data?.speed || {}, data?.voiceAgent || {});
    if (data?.defaultTemplateId !== undefined) amdDefaultTemplateId = String(data.defaultTemplateId || '');
    updateAgentModelTemplateCache(data);
    window._agentModelDefaultsLoadedToUI = true;
  } catch (e) { console.warn('loadAgentModelDefaults error:', e); }
}

async function persistAgentModelDefaultsFromForm({ showStatus = true } = {}) {
  const payload = getAgentModelDefaultsFromForm();
  const reasoning = getAgentReasoningDefaultsFromForm();
  const accounts = getAgentAccountDefaultsFromForm();
  const speed = getAgentSpeedDefaultsFromForm();
  const voiceAgent = getVoiceAgentDefaultFromForm();
  const status = document.getElementById('amd-status');
  try {
    const data = await api('/api/settings/agent-model-defaults', { method: 'POST', body: JSON.stringify({ ...payload, reasoning, accounts, speed, voiceAgent }) });
    if (showStatus && status) {
      status.style.color = 'var(--ok)';
      setSettingsStatus(status, 'success', 'Saved');
      setTimeout(() => { setSettingsStatus(status, 'info', ''); }, 2500);
    }
    if (payload.main_chat) {
      showToast('Main model changed', payload.main_chat, 'success', 5000);
      // Force the next Settings open to read the authoritative live route.
      _markSettingsCacheBusted('settings-models');
    }
    return data;
  } catch(e) {
    if (showStatus && status) {
      status.style.color = 'var(--err)';
      setSettingsStatus(status, 'error', e.message);
    }
    throw e;
  }
}

async function saveAgentModelDefaults() {
  return persistAgentModelDefaultsFromForm({ showStatus: true });
}

async function saveAgentModelDefaultTemplate() {
  const select = document.getElementById('amd-template-select');
  const nameInput = document.getElementById('amd-template-name');
  const status = document.getElementById('amd-template-status');
  const name = String(nameInput?.value || '').trim();
  if (!name) {
    setAgentModelTemplateStatus('error', 'Name the template first.');
    return;
  }
  if (status) status.textContent = 'Saving template...';
  try {
    const selectedId = String(select?.value || '').trim();
    const data = await api('/api/settings/agent-model-default-templates', {
      method: 'POST',
      body: JSON.stringify({
        id: selectedId || undefined,
        name,
        defaults: getAgentModelDefaultsFromForm(),
        reasoning: getAgentReasoningDefaultsFromForm(),
        accounts: getAgentAccountDefaultsFromForm(),
        speed: getAgentSpeedDefaultsFromForm(),
      }),
    });
    updateAgentModelTemplateCache(data);
    const savedId = data?.template?.id;
    if (select && savedId) select.value = savedId;
    // Also pin as startup default so this template survives gateway restarts.
    // Without this, clicking Save only snapshots the template blob but never sets
    // default_agent_model_template, so applyDefaultModelTemplate() on startup skips it.
    if (savedId) {
      try {
        const defData = await api(`/api/settings/agent-model-default-templates/${encodeURIComponent(savedId)}/set-default`, {
          method: 'POST',
        });
        updateAgentModelTemplateCache(defData);
        amdDefaultTemplateId = savedId;
        updateApplyAsDefaultButtonState(savedId);
      } catch (defErr) {
        console.warn('Could not pin template as startup default:', defErr);
      }
    }
    setAgentModelTemplateStatus('success', `Saved "${data?.template?.name || name}" and set as default.`);
    showToast('Model template saved & set as default', data?.template?.name || name, 'success', 3500);
  } catch (e) {
    setAgentModelTemplateStatus('error', e.message || String(e));
  }
}

async function applyAgentModelDefaultTemplate() {
  const select = document.getElementById('amd-template-select');
  const id = String(select?.value || '').trim();
  if (!id) {
    setAgentModelTemplateStatus('error', 'Choose a template to apply.');
    return;
  }
  setAgentModelTemplateStatus('info', 'Applying template...');
  try {
    const data = await api(`/api/settings/agent-model-default-templates/${encodeURIComponent(id)}/apply`, {
      method: 'POST',
    });
    await applyAgentModelDefaultsToForm(data?.defaults || data?.template?.defaults || {}, data?.reasoning || data?.template?.reasoning || {}, data?.accounts || data?.template?.accounts || {}, data?.speed || data?.template?.speed || {}, data?.voiceAgent || {});
    await loadAgentModelDefaultTemplates();
    setAgentModelTemplateStatus('success', `Applied "${data?.template?.name || id}".`);
    showToast('Model template applied', data?.template?.name || id, 'success', 4000);
  } catch (e) {
    setAgentModelTemplateStatus('error', e.message || String(e));
  }
}

function updateApplyAsDefaultButtonState(selectedId) {
  const btn = document.getElementById('amd-set-default-btn');
  if (!btn) return;
  const sel = selectedId !== undefined ? selectedId : document.getElementById('amd-template-select')?.value || '';
  const isDefault = sel && sel === amdDefaultTemplateId;
  if (isDefault) {
    btn.textContent = 'Saved as Default ✓';
    btn.style.background = 'var(--ok, #16a34a)';
    btn.style.color = '#fff';
    btn.style.border = '1px solid var(--ok, #16a34a)';
  } else {
    btn.textContent = 'Apply as Default';
    btn.style.background = '#fff';
    btn.style.color = 'var(--text)';
    btn.style.border = '1px solid var(--line)';
  }
}

async function applyAsDefaultTemplate() {
  const select = document.getElementById('amd-template-select');
  const id = String(select?.value || '').trim();
  if (!id) {
    setAgentModelTemplateStatus('error', 'Choose a template to set as default.');
    return;
  }
  setAgentModelTemplateStatus('info', 'Setting as default...');
  try {
    const data = await api(`/api/settings/agent-model-default-templates/${encodeURIComponent(id)}/set-default`, {
      method: 'POST',
    });
    amdDefaultTemplateId = String(data?.defaultTemplateId || data?.template?.id || id);
    await applyAgentModelDefaultsToForm(data?.defaults || data?.template?.defaults || {}, data?.reasoning || data?.template?.reasoning || {}, data?.accounts || data?.template?.accounts || {}, data?.speed || data?.template?.speed || {}, data?.voiceAgent || {});
    await loadAgentModelDefaultTemplates();
    updateApplyAsDefaultButtonState(id);
    setAgentModelTemplateStatus('success', `"${data?.template?.name || id}" set as startup default.`);
    showToast('Default template set', data?.template?.name || id, 'success', 4000);
  } catch (e) {
    setAgentModelTemplateStatus('error', e.message || String(e));
  }
}

function deleteAgentModelDefaultTemplate() {
  const select = document.getElementById('amd-template-select');
  const id = String(select?.value || '').trim();
  const template = amdTemplatesCache.find((item) => item.id === id);
  if (!id || !template) {
    setAgentModelTemplateStatus('error', 'Choose a template to delete.');
    return;
  }
  showConfirm(
    `Delete model template "${template.name}"?`,
    async () => {
      try {
        await api(`/api/settings/agent-model-default-templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
        const nameInput = document.getElementById('amd-template-name');
        if (nameInput) nameInput.value = '';
        await loadAgentModelDefaultTemplates();
        setAgentModelTemplateStatus('success', `Deleted "${template.name}".`);
      } catch (e) {
        setAgentModelTemplateStatus('error', e.message || String(e));
      }
    },
    null,
    { title: 'Delete Template', confirmText: 'Delete', danger: true }
  );
}

function syncGoalRoutingReasoning(type, selectedValue) {
  const provider = getSettingsValue(`goal-${type}-prov`).trim();
  const model = getSettingsValue(`goal-${type}-model`).trim();
  const select = document.getElementById(`goal-${type}-reasoning`);
  if (!select) return;
  const current = selectedValue !== undefined ? String(selectedValue || '') : String(select.value || '');
  const options = provider && model ? effortOptions(provider, model, true) : [''];
  select.innerHTML = options.map((effort) => `<option value="${escHtml(effort)}">${escHtml(effort || 'provider default')}</option>`).join('');
  select.disabled = !provider || !model || options.length <= 1;
  select.value = current && validEffort(provider, model, current) ? current : '';
}

async function goalRoutingProviderChange(type) {
  const providerSelect = document.getElementById(`goal-${type}-prov`);
  const modelSelect = document.getElementById(`goal-${type}-model`);
  if (!providerSelect || !modelSelect) return;
  const provider = String(providerSelect.value || '').trim();
  if (!provider) {
    modelSelect.innerHTML = '<option value="">uses current main-chat model</option>';
    syncGoalRoutingReasoning(type);
    return;
  }
  modelSelect.innerHTML = '<option value="">Loading...</option>';
  try {
    const models = await fetchProviderModelsForPicker(provider, {
      refreshOpenAI: provider === 'openai',
      includeLive: provider !== 'openai_codex',
    });
    modelSelect.innerHTML = models.length
      ? models.map((model) => `<option value="${escHtml(model)}">${escHtml(model)}</option>`).join('')
      : '<option value="">no models found</option>';
  } catch (err) {
    modelSelect.innerHTML = '<option value="">fetch failed</option>';
    console.warn('goalRoutingProviderChange error:', err);
  }
  syncGoalRoutingReasoning(type);
}

async function applyGoalRoutingToForm(type, modelRef, reasoning) {
  await ensureProviderCatalogUIReady();
  await fetchCredentialedModelProviderIds();
  renderProviderSelectors();
  const raw = String(modelRef || '').trim();
  const slash = raw.indexOf('/');
  const provider = slash > 0 ? raw.slice(0, slash) : '';
  const model = slash > 0 ? raw.slice(slash + 1) : raw;
  const providerSelect = document.getElementById(`goal-${type}-prov`);
  const modelSelect = document.getElementById(`goal-${type}-model`);
  if (!providerSelect || !modelSelect) return;
  if (!provider || !model) {
    providerSelect.value = '';
    modelSelect.innerHTML = '<option value="">uses current main-chat model</option>';
    syncGoalRoutingReasoning(type);
    return;
  }
  if (!Array.from(providerSelect.options).some((option) => option.value === provider)) {
    const option = document.createElement('option');
    option.value = provider;
    option.textContent = `${provider} (not currently connected)`;
    providerSelect.appendChild(option);
  }
  providerSelect.value = provider;
  await goalRoutingProviderChange(type);
  if (!Array.from(modelSelect.options).some((option) => option.value === model)) {
    const option = document.createElement('option');
    option.value = model;
    option.textContent = model;
    modelSelect.appendChild(option);
  }
  modelSelect.value = model;
  syncGoalRoutingReasoning(type, reasoning);
}


// --- Brain System Model Config --------------------------------------------

async function brainProviderChange(type) {
  const provSel  = document.getElementById(`brain-${type}-prov`);
  const modelSel = document.getElementById(`brain-${type}-model`);
  if (!provSel || !modelSel) return;
  const prov = provSel.value;
  if (!prov) {
    modelSel.innerHTML = '<option value="">— use primary model —</option>';
    syncBrainReasoning(type);
    return;
  }
  modelSel.innerHTML = '<option value="">Loading…</option>';
  try {
    await ensureProviderCatalogUIReady();
    const models = await fetchProviderModelsForPicker(prov, {
      refreshOpenAI: prov === 'openai',
      includeLive: prov !== 'openai_codex',
    });
    if (!models.length) { modelSel.innerHTML = '<option value="">— no models found —</option>'; syncBrainReasoning(type); return; }
    modelSel.innerHTML = models.map(m => `<option value="${m}">${m}</option>`).join('');
  } catch (e) {
    modelSel.innerHTML = '<option value="">— fetch failed —</option>';
  }
  syncBrainReasoning(type);
}

function syncBrainReasoning(type, selectedValue) {
  const provider = String(document.getElementById(`brain-${type}-prov`)?.value || '').trim();
  const model = String(document.getElementById(`brain-${type}-model`)?.value || '').trim();
  const select = document.getElementById(`brain-${type}-reasoning`);
  if (!select) return;
  const current = selectedValue !== undefined ? String(selectedValue || '') : String(select.value || '');
  const options = provider && model ? effortOptions(provider, model, true) : [''];
  select.innerHTML = options.map((effort) => `<option value="${escHtml(effort)}">${escHtml(effort || 'provider default')}</option>`).join('');
  select.disabled = !provider || !model || options.length <= 1;
  select.value = current && validEffort(provider, model, current) ? current : '';
  select.title = select.disabled ? 'This provider/model does not expose selectable reasoning effort.' : 'Reasoning effort for this Brain run.';
}

async function loadBrainModelConfig() {
  try {
    const data = await api('/api/brain/status');
    for (const type of ['thought', 'dream']) {
      const raw = type === 'thought'
        ? (data?.thoughtModel || data?.thought?.model || data?.thought?.thoughtModel || '')
        : (data?.dreamModel || data?.dream?.model || data?.dream?.dreamModel || '');
      const slashIdx = raw.indexOf('/');
      const prov  = slashIdx > 0 ? raw.slice(0, slashIdx) : '';
      const model = slashIdx > 0 ? raw.slice(slashIdx + 1) : raw;
      const provSel  = document.getElementById(`brain-${type}-prov`);
      const modelSel = document.getElementById(`brain-${type}-model`);
      if (provSel) provSel.value = prov;
      if (prov && modelSel) await brainProviderChange(type);
      if (modelSel && model) {
        if (!Array.from(modelSel.options).find(o => o.value === model)) {
          modelSel.innerHTML += `<option value="${model}">${model}</option>`;
        }
        modelSel.value = model;
      }
      const reasoning = type === 'thought'
        ? (data?.thoughtReasoning || data?.thought?.reasoning || '')
        : (data?.dreamReasoning || data?.dream?.reasoning || '');
      syncBrainReasoning(type, reasoning);
    }
    window._brainModelConfigLoadedToUI = true;
  } catch (e) { console.warn('loadBrainModelConfig error:', e); }
}

function getBrainModelConfigFromForm() {
  const payload = {};
  for (const type of ['thought', 'dream']) {
    const prov  = document.getElementById(`brain-${type}-prov`)?.value?.trim()  || '';
    const model = document.getElementById(`brain-${type}-model`)?.value?.trim() || '';
    const reasoning = document.getElementById(`brain-${type}-reasoning`)?.value?.trim() || '';
    if (type === 'thought') payload.thoughtModel = prov && model ? `${prov}/${model}` : '';
    else payload.dreamModel = prov && model ? `${prov}/${model}` : '';
    if (type === 'thought') payload.thoughtReasoning = reasoning;
    else payload.dreamReasoning = reasoning;
  }
  return payload;
}

async function persistBrainModelConfigFromForm({ showStatus = true } = {}) {
  const payload = getBrainModelConfigFromForm();
  const status = document.getElementById('brain-model-status');
  try {
    const result = await api('/api/brain/config', { method: 'PATCH', body: JSON.stringify(payload) });
    if (result?.success === false) throw new Error(result.error || 'Failed to save brain models');
    if (showStatus && status) {
      status.style.color = 'var(--ok)';
      setSettingsStatus(status, 'success', 'Saved');
      setTimeout(() => { setSettingsStatus(status, 'info', ''); }, 2500);
    }
    return result;
  } catch (e) {
    if (showStatus && status) {
      status.style.color = 'var(--err)';
      setSettingsStatus(status, 'error', e.message);
    }
    throw e;
  }
}

async function saveBrainModelConfig() {
  return persistBrainModelConfigFromForm({ showStatus: true });
}

async function saveModelTabLiveSettings({ showStatus = false } = {}) {
  await persistAgentModelDefaultsFromForm({ showStatus });
  await persistBrainModelConfigFromForm({ showStatus });
}

window.amdProviderChange = amdProviderChange;
window.loadAgentModelDefaults = loadAgentModelDefaults;
window.brainProviderChange = brainProviderChange;
window.syncBrainReasoning = syncBrainReasoning;
window.goalRoutingProviderChange = goalRoutingProviderChange;
window.syncGoalRoutingReasoning = syncGoalRoutingReasoning;
window.loadBrainModelConfig = loadBrainModelConfig;
window.saveBrainModelConfig = saveBrainModelConfig;
window.loadAgentHeartbeat = loadAgentHeartbeat;
window.loadAgentModelDefaultTemplates = loadAgentModelDefaultTemplates;
window.loadAgentModelOptions = loadAgentModelOptions;
window.loadAgentVoiceOptions = loadAgentVoiceOptions;
window.loadVoiceAgentDefaultOptions = loadVoiceAgentDefaultOptions;
window.loadAgentRunHistory = loadAgentRunHistory;
window.loadAgentsTab = loadAgentsTab;
window.loadChannelsStatus = loadChannelsStatus;
window.loadCredFields = loadCredFields;
window.loadCredVaultLog = loadCredVaultLog;
window.loadCredVaultStatus = loadCredVaultStatus;
window.loadCredentialsTab = loadCredentialsTab;
window.loadHeartbeatSettings = loadHeartbeatSettings;
window.loadIntegrationsTab = loadIntegrationsTab;
window.loadExternalImportJobs = loadExternalImportJobs;
window.loadExternalImportDiscovery = loadExternalImportDiscovery;
window.loadMigrationPanel = loadMigrationPanel;
window.loadMCPServers = loadMCPServers;
window.loadModelSettings = loadModelSettings;
window.loadSearchSettingsSummary = loadSearchSettingsSummary;
window.loadChromeProfileSettings = loadChromeProfileSettings;
window.loadSelectedAgentMd = loadSelectedAgentMd;
window.loadSessionCompactionSettings = loadSessionCompactionSettings;
window.loadAutoSettleSettings = loadAutoSettleSettings;
window.loadDesktopUpdateSettings = loadDesktopUpdateSettings;
window.loadShortcutsPanel = loadShortcutsPanel;
window.loadSubagentHeartbeatList = loadSubagentHeartbeatList;
window.loadWebhookSettings = loadWebhookSettings;
window.onAgentProviderChange = onAgentProviderChange;
window.onChannelTypeChange = onChannelTypeChange;
window.onMCPTransportChange = onMCPTransportChange;
window.onProviderChange = onProviderChange;
window.openAgentSettings = openAgentSettings;
window.openSettings = openSettings;
window.previewCustomMigration = previewCustomMigration;
window.previewSelectedMigration = previewSelectedMigration;
window.previewExternalImportJob = previewExternalImportJob;
window.previewDiscoveredExternalImport = previewDiscoveredExternalImport;
window.previewDiscoveredExternalImportBatches = previewDiscoveredExternalImportBatches;
window.toggleExternalImportConversation = toggleExternalImportConversation;
window.toggleHeartbeatSetting = toggleHeartbeatSetting;
window.setExternalImportConversationSelection = setExternalImportConversationSelection;
window.confirmExternalImportJob = confirmExternalImportJob;
window.confirmExternalImportBatchJob = confirmExternalImportBatchJob;
window.retryExternalImportBatchJob = retryExternalImportBatchJob;
window.confirmExternalImportBatches = confirmExternalImportBatches;
window.retryExternalImportJob = retryExternalImportJob;
window.rollbackExternalImportJob = rollbackExternalImportJob;
window.rollbackExternalImportBatchJob = rollbackExternalImportBatchJob;
window.deleteExternalImportJob = deleteExternalImportJob;
window.prefillMCPServer = prefillMCPServer;
window.readChannelPayload = readChannelPayload;
window.refreshAnthropicStatus = refreshAnthropicStatus;
window.refreshCodexStatus = refreshCodexStatus;
window.refreshHeartbeatSummary = refreshHeartbeatSummary;
window.refreshOllamaModels = refreshOllamaModels;
window.refreshOpenAIModels = refreshOpenAIModels;
window.refreshProviderModels = refreshProviderModels;
window.refreshXaiStatus = refreshXaiStatus;
window.rejectMemory = rejectMemory;
window.renderAgentsList = renderAgentsList;
window.renderShortcutsList = renderShortcutsList;
window.runMission = runMission;
window.runSelectedAgentOnce = runSelectedAgentOnce;
window.executeSelectedMigration = executeSelectedMigration;
window.saveAgentFromForm = saveAgentFromForm;
window.saveAgentHeartbeatConfig = saveAgentHeartbeatConfig;
window.saveAgentHeartbeatMd = saveAgentHeartbeatMd;
window.saveChannelSettings = saveChannelSettings;
window.saveHeartbeatSettings = saveHeartbeatSettings;
window.saveMCPServer = saveMCPServer;
window.saveSelectedAgentMd = saveSelectedAgentMd;
window.saveSelectedChannelSettings = saveSelectedChannelSettings;
window.saveAgentModelDefaults = saveAgentModelDefaults;
window.saveAgentModelDefaultTemplate = saveAgentModelDefaultTemplate;
window.applyAgentModelDefaultTemplate = applyAgentModelDefaultTemplate;
window.applyAsDefaultTemplate = applyAsDefaultTemplate;
window.deleteAgentModelDefaultTemplate = deleteAgentModelDefaultTemplate;
window.onAgentModelTemplateSelect = onAgentModelTemplateSelect;
window.saveSettings = saveSettings;
window.saveWebhookSettings = saveWebhookSettings;
window.selectAgent = selectAgent;
window.sendChannelTest = sendChannelTest;
window.sendSelectedChannelTest = sendSelectedChannelTest;
window.setAgentForm = setAgentForm;
window.setButtonBusy = setButtonBusy;
window.toggleDesktopAutoUpdate = toggleDesktopAutoUpdate;
window.toggleChromeProfileImportPanel = toggleChromeProfileImportPanel;
window.selectInHouseBrowserProfile = selectInHouseBrowserProfile;
window.importSelectedChromeProfile = importSelectedChromeProfile;
window.checkDesktopForUpdates = checkDesktopForUpdates;
window.downloadDesktopUpdate = downloadDesktopUpdate;
window.installDesktopUpdate = installDesktopUpdate;
window.setChannelStatus = setChannelStatus;
window.setIntegTab = setIntegTab;
window.setQuickSearchRigor = setQuickSearchRigor;
window.setQuickThinkingEffort = setQuickThinkingEffort;
// ─── Pairing panel ──────────────────────────────────────────────────────────
// Owns the desktop side of the mobile pairing handshake. Visible under
// Settings → Pairing. While the panel is open it polls /api/pairing/pending
// every 3s as a fallback for the pairing_pending WS event so an approval
// prompt always appears, even if the WS dropped.

let _pairingPollTimer = null;
let _pairingCurrentChallenge = null;
let _pairingBrowserAdminToken = '';

async function pairingAdminApi(path, opts = {}) {
  const bridge = window.prometheusPairingAdmin;
  // Electron desktop app: trusted IPC bridge injects the pairing-admin token.
  // Browser / dev gateway UI: fall through to same-origin api(). This works
  // without a credential only for loopback-bound gateways; LAN/wildcard binds
  // require PROMETHEUS_PAIRING_ADMIN_TOKEN or another explicit authority.
  if (bridge && typeof bridge.request === 'function') {
    let body = opts.body;
    if (typeof body === 'string' && body.trim()) {
      try { body = JSON.parse(body); }
      catch { throw new Error('Invalid pairing administration request body.'); }
    }
    return bridge.request({
      path,
      method: String(opts.method || 'GET').toUpperCase(),
      body,
    });
  }

  try {
    const browserHeaders = _pairingBrowserAdminToken
      ? { 'X-Prometheus-Pairing-Admin': _pairingBrowserAdminToken }
      : {};
    return await api(path, {
      ...opts,
      headers: { ...(opts.headers || {}), ...browserHeaders },
    });
  } catch (err) {
    const raw = String(err?.message || err || '');
    if (/API 403|Trusted desktop pairing authority required/i.test(raw)) {
      throw new Error(
        'Pairing admin blocked on this browser session. A standalone browser may manage pairing without a credential only on a loopback-bound gateway. For a LAN/wildcard gateway, enter the configured PROMETHEUS_PAIRING_ADMIN_TOKEN in the Pairing panel or open the desktop app.'
      );
    }
    if (/API 404|Cannot GET|Cannot POST|<!DOCTYPE html>/i.test(raw)) {
      throw new Error(
        'Pairing API route missing or returned HTML instead of JSON. Confirm the running gateway includes pairing routes and you are on the local Settings UI, not a stale bundle.'
      );
    }
    throw err;
  }
}

async function loadPairingPanel() {
  const browserAdminPanel = document.getElementById('pairing-browser-admin');
  const browserAdminInput = document.getElementById('pairing-browser-admin-token');
  const browserAdminApply = document.getElementById('pairing-browser-admin-apply');
  const browserAdminStatus = document.getElementById('pairing-browser-admin-status');
  const electronBridge = window.prometheusPairingAdmin;
  if (browserAdminPanel) browserAdminPanel.style.display = electronBridge ? 'none' : '';
  if (browserAdminInput) browserAdminInput.value = '';
  if (browserAdminStatus && _pairingBrowserAdminToken) browserAdminStatus.textContent = 'Credential active for this tab only.';
  if (browserAdminApply && !browserAdminApply.__wired) {
    browserAdminApply.__wired = true;
    browserAdminApply.addEventListener('click', async () => {
      const enteredToken = String(browserAdminInput?.value || '').trim();
      if (enteredToken) _pairingBrowserAdminToken = enteredToken;
      if (!_pairingBrowserAdminToken) {
        if (browserAdminStatus) browserAdminStatus.textContent = 'Enter the configured credential to continue.';
        return;
      }
      if (browserAdminInput) browserAdminInput.value = '';
      browserAdminApply.disabled = true;
      if (browserAdminStatus) browserAdminStatus.textContent = 'Applying for this tab…';
      try {
        await Promise.all([
          loadRemoteAccessSettings(),
          refreshPairingQR(),
          refreshPairingPending(),
          refreshPairedDevices(),
        ]);
        if (browserAdminStatus) browserAdminStatus.textContent = 'Credential active for this tab only.';
      } finally {
        browserAdminApply.disabled = false;
      }
    });
  }
  await loadRemoteAccessSettings();
  await refreshPairingQR();
  await refreshPairingPending();
  await refreshPairedDevices();
  _startPairingPolling();

  _wireRemoteAccessHandlers();

  const regen = document.getElementById('pairing-regen-btn');
  if (regen && !regen.__wired) { regen.__wired = true; regen.addEventListener('click', refreshPairingQR); }

  const copyLink = document.getElementById('pairing-copy-link-btn');
  if (copyLink && !copyLink.__wired) {
    copyLink.__wired = true;
    copyLink.addEventListener('click', async () => {
      if (!_pairingCurrentChallenge?.pairUrl) return;
      try { await navigator.clipboard.writeText(_pairingCurrentChallenge.pairUrl); showToast?.('Link copied', '', 'success'); }
      catch { showToast?.('Copy failed', '', 'error'); }
    });
  }

  const copyCode = document.getElementById('pairing-copy-code-btn');
  if (copyCode && !copyCode.__wired) {
    copyCode.__wired = true;
    copyCode.addEventListener('click', async () => {
      if (!_pairingCurrentChallenge?.pairCode) return;
      try { await navigator.clipboard.writeText(_pairingCurrentChallenge.pairCode); showToast?.('Pair code copied', '', 'success'); }
      catch { showToast?.('Copy failed', '', 'error'); }
    });
  }
}

// ─── Remote access (Tailscale Funnel) ──────────────────────────────────────
// Optional layer on top of local pairing — encodes a public HTTPS URL in the
// QR so phones can pair off-LAN. Local Wi-Fi pairing still works the same.

let _remoteAccessLoaded = false;
let _funnelStatusPollTimer = null;

// Updates BOTH the top header pill (Funnel live/offline) and the right-panel
// mini-pill, and shows/hides the Enable/Disable buttons based on real funnel state.
function _applyFunnelLiveStatus(funnelActive) {
  // Top header pill
  const pill = document.getElementById('pairing-remote-status-pill');
  if (pill) {
    if (funnelActive) {
      pill.textContent = 'Funnel live';
      pill.style.background = '#dcfce7';
      pill.style.color = '#15803d';
    } else {
      pill.textContent = 'Funnel offline';
      pill.style.background = '#fff7ed';
      pill.style.color = '#b45309';
    }
  }
  // Right-panel mini-pill
  const livePill = document.getElementById('pairing-funnel-live-pill');
  if (livePill) {
    if (funnelActive) {
      livePill.textContent = 'Live';
      livePill.style.background = '#dcfce7';
      livePill.style.color = '#15803d';
    } else {
      livePill.textContent = 'Offline';
      livePill.style.background = '#fff7ed';
      livePill.style.color = '#b45309';
    }
  }
  // Show/hide action buttons
  const enableBtn  = document.getElementById('pairing-funnel-enable-btn');
  const disableBtn = document.getElementById('pairing-funnel-disable-btn');
  if (enableBtn)  enableBtn.style.display  = funnelActive ? 'none' : '';
  if (disableBtn) disableBtn.style.display = funnelActive ? '' : 'none';
}

// Poll actual funnel status from the server (fast endpoint, no full detect).
async function _refreshFunnelLiveStatus() {
  try {
    const r = await pairingAdminApi('/api/pairing/tailscale/funnel/status');
    if (r?.success != null) _applyFunnelLiveStatus(!!r.funnelActive);
  } catch {}
}

function _startFunnelStatusPoll() {
  _stopFunnelStatusPoll();
  _refreshFunnelLiveStatus();
  _funnelStatusPollTimer = setInterval(() => {
    if (window.settingsTab !== 'pairing') { _stopFunnelStatusPoll(); return; }
    _refreshFunnelLiveStatus();
  }, 30_000);
}
function _stopFunnelStatusPoll() {
  if (_funnelStatusPollTimer) { clearInterval(_funnelStatusPollTimer); _funnelStatusPollTimer = null; }
}

async function loadRemoteAccessSettings() {
  try {
    const r = await pairingAdminApi('/api/pairing/remote-access');
    const ra = (r && r.remoteAccess) || { enabled: false, mode: 'tailscale-funnel', publicUrl: '' };
    const enabledEl = document.getElementById('pairing-remote-enabled');
    const modeEl    = document.getElementById('pairing-remote-mode');
    const urlEl     = document.getElementById('pairing-remote-url');
    if (enabledEl) enabledEl.checked = !!ra.enabled;
    if (modeEl)    modeEl.value      = (ra.mode === 'custom') ? 'custom' : 'tailscale-funnel';
    if (urlEl)     urlEl.value       = String(ra.publicUrl || '');
    _remoteAccessLoaded = true;
  } catch (err) {
    const msg = document.getElementById('pairing-remote-msg');
    if (msg) msg.innerHTML = `<span style="color:#b91c1c">Failed to load remote access settings: ${escHtml(err.message || err)}</span>`;
  }
}

async function _saveRemoteAccess() {
  const enabledEl = document.getElementById('pairing-remote-enabled');
  const modeEl    = document.getElementById('pairing-remote-mode');
  const urlEl     = document.getElementById('pairing-remote-url');
  const msg       = document.getElementById('pairing-remote-msg');
  if (!enabledEl || !modeEl || !urlEl) return;
  const body = {
    enabled:   !!enabledEl.checked,
    mode:      modeEl.value,
    publicUrl: String(urlEl.value || '').trim(),
  };
  if (msg) msg.textContent = 'Saving…';
  try {
    const r = await pairingAdminApi('/api/pairing/remote-access', { method: 'PUT', body: JSON.stringify(body) });
    if (!r?.success) throw new Error(r?.error || 'Failed to save');
    if (msg) msg.innerHTML = `<span style="color:#15803d">Saved. Generate a new QR to use the ${r.remoteAccess?.enabled ? 'public' : 'local'} URL.</span>`;
    refreshPairingQR().catch(() => {});
    showToast?.('Remote access updated', '', 'success');
  } catch (err) {
    if (msg) msg.innerHTML = `<span style="color:#b91c1c">${escHtml(err.message || 'Save failed')}</span>`;
    showToast?.('Save failed', String(err.message || err), 'error');
  }
}

async function _enableFunnel() {
  const funnelMsg = document.getElementById('pairing-funnel-msg');
  const enableBtn = document.getElementById('pairing-funnel-enable-btn');
  if (enableBtn) { enableBtn.disabled = true; enableBtn.textContent = 'Enabling…'; }
  if (funnelMsg) funnelMsg.textContent = 'Running tailscale funnel command…';
  try {
    const r = await pairingAdminApi('/api/pairing/tailscale/funnel/enable', { method: 'POST', body: '{}' });
    if (!r?.success) throw new Error(r?.error || 'Failed to enable funnel');
    if (funnelMsg) funnelMsg.innerHTML = `<span style="color:#15803d">Funnel enabled on HTTPS ${r.httpsPort || 443} → local port ${r.port}. ✓</span>`;
    _applyFunnelLiveStatus(!!r.funnelActive);
    showToast?.('Tailscale funnel enabled', '', 'success');
  } catch (err) {
    if (funnelMsg) funnelMsg.innerHTML = `<span style="color:#b91c1c">${escHtml(err.message || 'Enable failed')}</span>`;
    showToast?.('Funnel enable failed', String(err.message || err), 'error');
  } finally {
    if (enableBtn) { enableBtn.disabled = false; enableBtn.textContent = 'Enable Funnel'; }
  }
}

async function _disableFunnel() {
  const funnelMsg = document.getElementById('pairing-funnel-msg');
  const disableBtn = document.getElementById('pairing-funnel-disable-btn');
  if (disableBtn) { disableBtn.disabled = true; disableBtn.textContent = 'Disabling…'; }
  if (funnelMsg) funnelMsg.textContent = 'Disabling this instance’s Tailscale Funnel listener…';
  try {
    const r = await pairingAdminApi('/api/pairing/tailscale/funnel/disable', { method: 'POST', body: '{}' });
    if (!r?.success) throw new Error(r?.error || 'Failed to disable funnel');
    if (funnelMsg) funnelMsg.innerHTML = `<span style="color:#b45309">Funnel listener on HTTPS ${r.httpsPort || 443} disabled.</span>`;
    _applyFunnelLiveStatus(false);
    showToast?.('Tailscale funnel disabled', '', 'success');
  } catch (err) {
    if (funnelMsg) funnelMsg.innerHTML = `<span style="color:#b91c1c">${escHtml(err.message || 'Disable failed')}</span>`;
  } finally {
    if (disableBtn) { disableBtn.disabled = false; disableBtn.textContent = 'Disable Funnel'; }
  }
}

async function _detectTailscale() {
  const out = document.getElementById('pairing-ts-status');
  const cmd = document.getElementById('pairing-ts-funnel-cmd');
  const urlEl = document.getElementById('pairing-remote-url');
  const modeEl = document.getElementById('pairing-remote-mode');
  if (out) out.textContent = 'Checking…';
  try {
    const r = await pairingAdminApi('/api/pairing/tailscale/status');
    if (!r?.installed) {
      if (out) out.innerHTML = `<span style="color:#b45309">${escHtml(r?.error || 'Tailscale CLI not found.')}</span><br><span style="font-size:11px">Install from <span style="font-family:ui-monospace">tailscale.com</span> and try again.</span>`;
      return;
    }
    const lines = [];
    lines.push(`<div><strong>Installed:</strong> <span style="color:#15803d">yes</span></div>`);
    lines.push(`<div><strong>Logged in:</strong> ${r.loggedIn ? '<span style="color:#15803d">yes</span>' : '<span style="color:#b45309">no — run <span style="font-family:ui-monospace">tailscale up</span></span>'}</div>`);
    if (r.hostname) lines.push(`<div><strong>Hostname:</strong> <span style="font-family:ui-monospace;word-break:break-all">${escHtml(r.hostname)}</span></div>`);
    if (r.suggestedUrl) lines.push(`<div><strong>Suggested URL:</strong> <span style="font-family:ui-monospace;word-break:break-all">${escHtml(r.suggestedUrl)}</span></div>`);
    lines.push(`<div><strong>Funnel:</strong> ${r.funnelActive ? `<span style="color:#15803d">active (HTTPS ${r.suggestedHttpsPort || 443} → local ${r.funnelPorts.join(', ')})</span>` : '<span style="color:#b45309">not active for this instance</span>'}</div>`);
    if (r.suggestedFunnelCommand) lines.push(`<div style="margin-top:4px;font-family:ui-monospace;word-break:break-all;font-size:11px">${escHtml(r.suggestedFunnelCommand)}</div>`);
    if (r.suggestedUrl) {
      lines.push(`<div style="margin-top:8px"><button class="btn btn-sm" id="pairing-ts-apply-btn" style="background:#eaf2ff;border:1px solid #bdd3f6;color:#0d4faf">Use this URL</button></div>`);
    }
    if (out) out.innerHTML = lines.join('');
    const port = (() => {
      try { return new URL(window.location.origin).port || '18789'; } catch { return '18789'; }
    })();
    if (cmd) cmd.textContent = r.suggestedFunnelCommand || `tailscale funnel --bg --https=443 ${port}`;
    _applyFunnelLiveStatus(!!r.funnelActive);
    const apply = document.getElementById('pairing-ts-apply-btn');
    if (apply && r.suggestedUrl) {
      apply.addEventListener('click', () => {
        if (urlEl) urlEl.value = r.suggestedUrl;
        if (modeEl) modeEl.value = 'tailscale-funnel';
        showToast?.('URL applied — click Save', '', 'success');
      });
    }
  } catch (err) {
    if (out) out.innerHTML = `<span style="color:#b91c1c">${escHtml(err.message || 'Detect failed')}</span>`;
  }
}

function _wireRemoteAccessHandlers() {
  const save        = document.getElementById('pairing-remote-save-btn');
  const detect      = document.getElementById('pairing-remote-detect-btn');
  const enableBtn   = document.getElementById('pairing-funnel-enable-btn');
  const disableBtn  = document.getElementById('pairing-funnel-disable-btn');
  if (save       && !save.__wired)       { save.__wired       = true; save.addEventListener('click', _saveRemoteAccess); }
  if (detect     && !detect.__wired)     { detect.__wired     = true; detect.addEventListener('click', _detectTailscale); }
  if (enableBtn  && !enableBtn.__wired)  { enableBtn.__wired  = true; enableBtn.addEventListener('click', _enableFunnel); }
  if (disableBtn && !disableBtn.__wired) { disableBtn.__wired = true; disableBtn.addEventListener('click', _disableFunnel); }
}

function _stopPairingPolling() {
  if (_pairingPollTimer) { clearInterval(_pairingPollTimer); _pairingPollTimer = null; }
}
function _startPairingPolling() {
  _stopPairingPolling();
  _pairingPollTimer = setInterval(() => {
    if (window.settingsTab !== 'pairing') { _stopPairingPolling(); return; }
    refreshPairingPending().catch(() => {});
  }, 3000);
}

async function refreshPairingQR() {
  const wrap = document.getElementById('pairing-qr-wrap');
  const meta = document.getElementById('pairing-qr-meta');
  if (wrap) wrap.innerHTML = '<div style="color:var(--muted);font-size:12px">Generating QR…</div>';
  try {
    const r = await pairingAdminApi('/api/pairing/qr', { method: 'POST', body: JSON.stringify({}) });
    if (!r?.success) throw new Error(r?.error || 'Failed to generate QR');
    _pairingCurrentChallenge = r;
    if (wrap) {
      const pairCode = String(r.pairCode || '').trim();
      let pairingOrigin = String(r.pairingOrigin || '').trim();
      if (!pairingOrigin) {
        try { pairingOrigin = new URL(String(r.pairUrl || '')).origin; } catch {}
      }
      wrap.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:18px;align-items:center;">
          <div style="display:flex;justify-content:center;max-width:288px;width:100%;margin:0 auto;">${r.qrSvg || ''}</div>
          <div style="display:flex;flex-direction:column;gap:10px;min-width:0;text-align:left;">
            <div style="font-size:12px;font-weight:800;color:var(--text);text-transform:uppercase;letter-spacing:.06em;">Pair code</div>
            <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:clamp(22px,4vw,34px);font-weight:900;letter-spacing:.08em;line-height:1.15;color:#221a14;background:#fff8ef;border:1px solid #f3d6b9;border-radius:10px;padding:14px 16px;text-align:center;word-break:break-word;">
              ${escHtml(pairCode || 'PAIR-....-....')}
            </div>
            <div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;">Gateway address</div>
            <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:var(--text);background:#f8fafc;border:1px solid var(--line);border-radius:8px;padding:8px 9px;word-break:break-all;">${escHtml(pairingOrigin || 'Unavailable')}</div>
            <div style="font-size:12px;color:var(--muted);line-height:1.45;">Scan the QR from Safari, or open this gateway address on the phone first and enter the pair code. You can also paste the full pairing link.</div>
            <button class="btn btn-sm" id="pairing-copy-code-btn" style="background:#fff;border:1px solid var(--line);color:var(--text);width:max-content">Copy code</button>
          </div>
        </div>`;
      const copyCode = document.getElementById('pairing-copy-code-btn');
      if (copyCode) {
        copyCode.__wired = true;
        copyCode.addEventListener('click', async () => {
          if (!_pairingCurrentChallenge?.pairCode) return;
          try { await navigator.clipboard.writeText(_pairingCurrentChallenge.pairCode); showToast?.('Pair code copied', '', 'success'); }
          catch { showToast?.('Copy failed', '', 'error'); }
        });
      }
    }
    if (meta) {
      const expires = new Date(r.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const warning = r.warning
        ? `<div style="margin-top:6px;color:#b45309;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:6px 8px">${escHtml(r.warning)}</div>`
        : '';
      const lan = Array.isArray(r.lanOrigins) && r.lanOrigins.length
        ? `<div style="margin-top:4px;color:var(--muted);font-size:11px">LAN: ${r.lanOrigins.map(x => `<span style="word-break:break-all">${escHtml(x)}</span>`).join(', ')}</div>`
        : '';
      const remoteBadge = r.remoteAccess && r.remoteAccess.active
        ? `<div style="margin-top:6px;color:#0d4faf;background:#eaf2ff;border:1px solid #bdd3f6;border-radius:8px;padding:6px 8px;font-size:11px">Remote access ON — QR uses public URL (${escHtml(String(r.remoteAccess.mode || 'custom'))})</div>`
        : '';
      meta.innerHTML = `Expires at <strong>${escHtml(expires)}</strong> · <span style="word-break:break-all">${escHtml(r.pairUrl)}</span>${remoteBadge}${warning}${lan}`;
    }
  } catch (err) {
    if (wrap) wrap.innerHTML = `<div style="color:#b91c1c;font-size:12px">${escHtml(err.message || 'Failed to generate QR')}</div>`;
  }
}

async function refreshPairingPending() {
  const list = document.getElementById('pairing-pending-list');
  const count = document.getElementById('pairing-pending-count');
  const tabBadge = document.getElementById('settings-pairing-pending-badge');
  if (!list) return;
  try {
    const r = await pairingAdminApi('/api/pairing/pending');
    const reqs = Array.isArray(r?.requests) ? r.requests : [];
    if (count) count.textContent = String(reqs.length);
    if (tabBadge) {
      tabBadge.textContent = String(reqs.length);
      tabBadge.style.display = reqs.length > 0 ? 'inline-flex' : 'none';
    }
    if (!reqs.length) {
      list.innerHTML = '<div style="color:var(--muted);font-size:12px;font-style:italic">No incoming pairing requests.</div>';
      return;
    }
    list.innerHTML = reqs.map(req => `
      <div style="border:1px solid #f3d6b9;background:#fff8ef;border-radius:10px;padding:10px 12px" data-pairing-req="${escHtml(req.id)}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <strong style="flex:1;font-size:13px">${escHtml(req.deviceName || 'Mobile device')}</strong>
          <span style="font-size:10px;font-weight:800;color:#c0541a;background:#ffe8d2;padding:2px 7px;border-radius:6px">pending</span>
        </div>
        <div style="font-size:11px;color:var(--muted);line-height:1.5;margin-bottom:8px">
          ${escHtml(_summarizeUA(req.userAgent))} · ${escHtml(req.ipHint || 'unknown ip')}
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-sm" style="flex:1;background:#16a34a;color:#fff;border:none" data-pairing-action="approve" data-id="${escHtml(req.id)}">✓ Allow</button>
          <button class="btn btn-sm" style="flex:1;background:#fff;color:#b91c1c;border:1px solid #fecaca" data-pairing-action="deny" data-id="${escHtml(req.id)}">✕ Deny</button>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('[data-pairing-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const act = btn.getAttribute('data-pairing-action');
        btn.disabled = true; btn.style.opacity = '0.6';
        try {
          if (act === 'approve') {
            const ok = await pairingAdminApi('/api/pairing/approve', { method: 'POST', body: JSON.stringify({ requestId: id }) });
            if (!ok?.success) throw new Error(ok?.error || 'Approve failed');
            showToast?.('Device paired', '', 'success');
          } else {
            const ok = await pairingAdminApi('/api/pairing/deny', { method: 'POST', body: JSON.stringify({ requestId: id }) });
            if (!ok?.success) throw new Error(ok?.error || 'Deny failed');
            showToast?.('Pairing denied', '', 'success');
          }
          await refreshPairingPending();
          await refreshPairedDevices();
        } catch (err) {
          showToast?.('Pairing action failed', err.message, 'error');
          btn.disabled = false; btn.style.opacity = '';
        }
      });
    });
  } catch (err) {
    list.innerHTML = `<div style="color:#b91c1c;font-size:12px">${escHtml(err.message || 'Failed to load pending requests')}</div>`;
  }
}

async function refreshPairedDevices() {
  const list  = document.getElementById('pairing-device-list');
  const count = document.getElementById('pairing-device-count');
  if (!list) return;
  try {
    const r = await pairingAdminApi('/api/pairing/devices');
    const devices = Array.isArray(r?.devices) ? r.devices : [];
    if (count) count.textContent = String(devices.length);
    if (!devices.length) {
      list.innerHTML = '<div style="color:var(--muted);font-size:12px;font-style:italic">No devices paired yet.</div>';
      return;
    }
    list.innerHTML = devices.map(d => {
      const lastSeen = d.lastSeenAt ? `last seen ${_pairingTimeAgo(d.lastSeenAt)}` : 'never';
      const enabled = d.enabled !== false;
      return `
        <div style="border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:#fff" data-pairing-device="${escHtml(d.id)}">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <strong style="flex:1;font-size:13px">📱 ${escHtml(d.name || 'Device')}</strong>
            <span style="font-size:10px;font-weight:800;padding:2px 8px;border-radius:6px;background:${enabled ? '#d9f7ed' : '#ffe0e0'};color:${enabled ? '#066046' : '#8b0000'}">${enabled ? 'enabled' : 'disabled'}</span>
          </div>
          <div style="font-size:11px;color:var(--muted);line-height:1.5;margin-bottom:8px">
            ${escHtml(_summarizeUA(d.lastUserAgent))} · ${escHtml(d.lastIpHint || 'unknown ip')} · ${escHtml(lastSeen)}
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn btn-sm" style="flex:1;background:${enabled ? '#fff' : '#16a34a'};color:${enabled ? 'var(--muted)' : '#fff'};border:1px solid ${enabled ? 'var(--line)' : '#16a34a'}" data-device-action="toggle" data-id="${escHtml(d.id)}" data-next="${enabled ? 'false' : 'true'}">${enabled ? 'Disable' : 'Enable'}</button>
            <button class="btn btn-sm" style="flex:1;background:#fff;color:#b91c1c;border:1px solid #fecaca" data-device-action="remove" data-id="${escHtml(d.id)}">Remove</button>
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('[data-device-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const act = btn.getAttribute('data-device-action');
        btn.disabled = true; btn.style.opacity = '0.6';
        try {
          if (act === 'toggle') {
            const next = btn.getAttribute('data-next') === 'true';
            const ok = await pairingAdminApi(`/api/pairing/devices/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ enabled: next }) });
            if (!ok?.success) throw new Error(ok?.error || 'Update failed');
            showToast?.(next ? 'Device enabled' : 'Device disabled', '', 'success');
          } else if (act === 'remove') {
            if (!confirm('Remove this device? The user will need to scan a new QR to pair again.')) { btn.disabled = false; btn.style.opacity = ''; return; }
            const ok = await pairingAdminApi(`/api/pairing/devices/${encodeURIComponent(id)}`, { method: 'DELETE' });
            if (!ok?.success) throw new Error(ok?.error || 'Remove failed');
            showToast?.('Device removed', '', 'success');
          }
          await refreshPairedDevices();
        } catch (err) {
          showToast?.('Action failed', err.message, 'error');
          btn.disabled = false; btn.style.opacity = '';
        }
      });
    });
  } catch (err) {
    list.innerHTML = `<div style="color:#b91c1c;font-size:12px">${escHtml(err.message || 'Failed to load devices')}</div>`;
  }
}

function _summarizeUA(ua) {
  if (!ua) return 'unknown device';
  const s = String(ua);
  if (/iPhone/i.test(s))  return 'iPhone';
  if (/iPad/i.test(s))    return 'iPad';
  if (/Android/i.test(s)) return /Mobile/i.test(s) ? 'Android phone' : 'Android tablet';
  if (/Macintosh/i.test(s)) return 'Mac';
  if (/Windows/i.test(s)) return 'Windows';
  return s.slice(0, 60);
}
function _pairingTimeAgo(ms) {
  const delta = Date.now() - ms;
  if (delta < 60000)        return 'just now';
  if (delta < 3600000)      return `${Math.floor(delta / 60000)}m ago`;
  if (delta < 86400000)     return `${Math.floor(delta / 3600000)}h ago`;
  return `${Math.floor(delta / 86400000)}d ago`;
}

// WS listener: when a phone claims a QR, refresh the pending list immediately
// (3s polling is fallback). Imported lazily via window.wsEventBus which is
// already wired in the main shell.
if (typeof window !== 'undefined') {
  const _hookWs = () => {
    if (!window.wsEventBus || window.__pairingWsHooked) return;
    window.__pairingWsHooked = true;
    window.wsEventBus.on('pairing_pending',        () => { if (window.settingsTab === 'pairing') refreshPairingPending(); else _bumpPairingBadge(); });
    window.wsEventBus.on('pairing_approved',       () => { refreshPairedDevices().catch(() => {}); refreshPairingPending().catch(() => {}); });
    window.wsEventBus.on('pairing_denied',         () => { if (window.settingsTab === 'pairing') refreshPairingPending(); });
    window.wsEventBus.on('pairing_device_removed', () => { if (window.settingsTab === 'pairing') refreshPairedDevices(); });
    window.wsEventBus.on('pairing_device_changed', () => { if (window.settingsTab === 'pairing') refreshPairedDevices(); });
  };
  _hookWs();
  // Re-try once after a tick — wsEventBus may not be loaded yet at module init time.
  setTimeout(_hookWs, 500);
}

function _bumpPairingBadge() {
  // Fire-and-forget refresh so the tab badge updates even when the user is
  // looking at a different settings tab.
  pairingAdminApi('/api/pairing/pending').then(r => {
    const count = (r?.requests || []).length;
    const tabBadge = document.getElementById('settings-pairing-pending-badge');
    if (tabBadge) {
      tabBadge.textContent = String(count);
      tabBadge.style.display = count > 0 ? 'inline-flex' : 'none';
    }
  }).catch(() => {});
}

window.loadPairingPanel = loadPairingPanel;
  window.loadSecuritySettings = loadSecuritySettings;
window.toggleCommandPermissionList = toggleCommandPermissionList;
window.revokeCommandPermission = revokeCommandPermission;
window.redoOnboardingFromSettings = redoOnboardingFromSettings;
window.replayOnboardingTutorial = replayOnboardingTutorial;
window.runOnboardingDevTest = runOnboardingDevTest;
window.saveSecuritySettings = saveSecuritySettings;
window.setSettingsTab = setSettingsTab;
window.previewAutoSettleSettings = previewAutoSettleSettings;
window.showIntegMsg = showIntegMsg;
window.showMCPAddForm = showMCPAddForm;
window.startCodexOAuth = startCodexOAuth;
window.startXaiOAuth = startXaiOAuth;
window.submitXaiOAuthCode = submitXaiOAuthCode;
window.addProviderAccount = addProviderAccount;
window.onProviderAccountChange = onProviderAccountChange;
window.syncXaiAuthModeVisibility = syncXaiAuthModeVisibility;
window.saveXApiCredentials = saveXApiCredentials;
window.startXApiOAuth = startXApiOAuth;
window.submitXApiOAuthCode = submitXApiOAuthCode;
window.disconnectXApiOAuth = disconnectXApiOAuth;
window.submitManualCodexUrl = submitManualCodexUrl;
window.testChannel = testChannel;
window.testAnthropicConnection = testAnthropicConnection;
window.testProviderConnection = testProviderConnection;
window.testSelectedChannel = testSelectedChannel;
window.testWebhookEndpoint = testWebhookEndpoint;
window.disconnectXaiOAuth = disconnectXaiOAuth;
window.tickAgentHeartbeat = tickAgentHeartbeat;
window.tickSubagentHb = tickSubagentHb;
window.toggleCredVis = toggleCredVis;
window.toggleQuickModePopover = toggleQuickModePopover;
window.updateBgtHeartbeatLabel = updateBgtHeartbeatLabel;
window.updateOpenAIModelDropdown = updateOpenAIModelDropdown;
window.updateQuickModeUI = updateQuickModeUI;
window.updateSubagentHb = updateSubagentHb;
window.updateWebhookStatus = updateWebhookStatus;
window.updateWebhookUrlDisplay = updateWebhookUrlDisplay;

initSettingsStaticIcons();
