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
  initSettingsIconLabels();
  setCredentialToggleIcon(document.getElementById('cred-tavily-visibility-toggle'), false);
  setCredentialToggleIcon(document.getElementById('cred-tinyfish-visibility-toggle'), false);
  setCredentialToggleIcon(document.getElementById('cred-google-visibility-toggle'), false);
  setCredentialToggleIcon(document.getElementById('cred-brave-visibility-toggle'), false);
}

async function loadSearchSettingsSummary() {
  try {
    const s = await api('/api/settings/search');
    const el = document.getElementById('r-failed');
    if (el) el.textContent = s.preferred_provider || 'tavily';
    quickSearchRigor = s.search_rigor || 'verified';
    updateQuickModeUI();
  } catch {}
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

function setSettingsTab(tab) {
  window.settingsTab = tab;
  const tabs = ['system', 'heartbeat', 'search', 'credentials', 'security', 'migration', 'models', 'agents', 'channels', 'integrations', 'shortcuts'];

  tabs.forEach(t => {
    const btn = document.getElementById(`settings-tab-${t}`);
    const panel = document.getElementById(`settings-panel-${t}`);
    if (btn) {
      btn.style.background = (t === tab) ? '#eaf2ff' : '#fff';
      btn.style.borderColor = (t === tab) ? '#bdd3f6' : 'var(--line)';
      btn.style.color = (t === tab) ? '#0d4faf' : 'var(--muted)';
    }
    if (panel) {
      if (t === tab) {
        const gridTabs = ['system', 'search', 'models'];
        panel.style.display = gridTabs.includes(t) ? 'block' : 'block';
        if (t === 'heartbeat') {
          if (!window.heartbeatSettingsLoaded) loadHeartbeatSettings().catch(() => {});
          else if (window.heartbeatEditor) window.heartbeatEditor.refresh();
        }
        if (t === 'channels') loadChannelsStatus();
        if (t === 'models') loadModelSettings();
        if (t === 'agents') loadAgentsTab().then(() => {
          if (window.agentMdEditor) window.agentMdEditor.refresh();
        });
        if (t === 'integrations') loadIntegrationsTab();
        if (t === 'credentials') loadCredentialsTab();
        if (t === 'migration') loadMigrationPanel();
        if (t === 'shortcuts') loadShortcutsPanel();
      } else {
        panel.style.display = 'none';
      }
    }
  });
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

function applyHeartbeatSettingsToForm(heartbeat) {
  const hb = heartbeat || {};
  const enabledEl = document.getElementById('settings-hb-enabled');
  const intervalEl = document.getElementById('settings-hb-interval');
  const modelEl = document.getElementById('settings-hb-model');
  const reviewEl = document.getElementById('settings-hb-review-teams');
  const pathEl = document.getElementById('settings-hb-path');

  if (enabledEl) enabledEl.checked = hb.enabled !== false;
  if (intervalEl) intervalEl.value = String(Math.max(1, Math.min(1440, Number(hb.interval_minutes) || 30)));
  if (modelEl) modelEl.value = String(hb.model || '');
  if (reviewEl) reviewEl.checked = hb.review_teams_after_run === true;
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
    enabled: !!enabledEl?.checked,
    interval_minutes: Math.max(1, Math.min(1440, Number(intervalEl?.value) || 30)),
    model: String(modelEl?.value || '').trim(),
    review_teams_after_run: !!reviewEl?.checked,
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
  } catch (err) {
    addProcessEntry('error', `Heartbeat update failed: ${err.message}`);
  }
}

async function tickSubagentHb(agentId) {
  try {
    await api(`/api/heartbeat/agents/${encodeURIComponent(agentId)}/tick`, { method: 'POST' });
    addProcessEntry('info', `Heartbeat tick triggered for "${agentId}".`);
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

async function loadCredentialsTab() {
  await Promise.all([loadCredFields(), loadCredVaultStatus(), loadCredVaultLog()]);
}

async function loadCredFields() {
  try {
    const s = await api('/api/settings/search');
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
      const labelEl = cxEl.previousElementSibling;
      if (labelEl?.tagName === 'LABEL') {
        labelEl.innerHTML = 'Google CSE ID <span style="font-weight:400;color:var(--muted)">(stored in vault for persistence)</span>';
      }
    }
  } catch(e) {
    console.warn('loadCredFields:', e);
  }
}

async function loadCredVaultStatus() {
  const el = document.getElementById('cred-vault-status');
  if (!el) return;
  try {
    const data = await api('/api/credentials/status');
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
  } catch(e) {
    el.innerHTML = `<span style="color:var(--err);font-size:12px">Could not load vault status: ${e.message}</span>`;
  }
}

async function loadCredVaultLog() {
  const el = document.getElementById('cred-vault-log');
  if (!el) return;
  try {
    const data = await api('/api/credentials/audit');
    const lines = (data.lines || []).slice(-18).reverse();
    if (!lines.length) { el.textContent = 'No audit entries yet.'; return; }
    el.innerHTML = lines.map(l => {
      const safe = l.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const color = l.includes('SET') ? 'var(--ok)' : l.includes('GET') ? 'var(--brand)' : l.includes('DEL') ? 'var(--err)' : 'var(--muted)';
      return `<div style="color:${color};white-space:nowrap">${safe}</div>`;
    }).join('');
  } catch(e) {
    el.textContent = 'Could not load audit log.';
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
const BUILTIN_STATIC_MODEL_FALLBACKS = {
  openai: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o4-mini', 'o3', 'o1'],
  openai_codex: ['gpt-5.5', 'gpt-5.4-codex', 'gpt-5.4-codex-mini', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.3', 'gpt-5.2-codex', 'gpt-5.2', 'gpt-5.1-codex-max', 'gpt-5.1-codex-mini', 'gpt-5.1-codex', 'gpt-5.1'],
  anthropic: ['claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
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
  option.textContent = normalized;
  select.appendChild(option);
}

function getProviderSelectPlaceholder(selectId) {
  if (selectId === 'agent-edit-provider') return 'use effective default';
  if (selectId === 'amd-background-agent-prov') return 'inherit from Background Task';
  if (selectId === 'amd-switch-model-low-prov' || selectId === 'amd-switch-model-medium-prov') return 'disabled';
  if (/^amd-subagent-.*-prov$/.test(selectId)) return 'inherit';
  if (/^amd-.*-prov$/.test(selectId) || /^brain-.*-prov$/.test(selectId)) return 'use primary';
  return 'inherit / use primary';
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
  for (const field of fields) {
    const control = document.getElementById(getProviderSettingsFieldId(providerId, field.key));
    if (!control) continue;
    if (field.key === 'model' && control.tagName === 'SELECT') ensureSelectOption(control, merged[field.key]);
    writeProviderFieldElementValue(providerId, field.key, merged[field.key]);
  }
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

  if (includeLive) {
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
    control.innerHTML = unique.map(m => `<option value="${escHtml(m)}">${escHtml(m)}</option>`).join('');
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
    return `<label style="display:block;font-size:12px;color:var(--muted);margin:10px 0 6px">${label}</label><select id="${fieldId}" class="settings-input" style="font-size:13px">${staticModels.map(model => `<option value="${escHtml(model)}">${escHtml(model)}</option>`).join('')}</select>${helpHtml}`;
  }
  if (field.input === 'textarea') {
    return `<label style="display:block;font-size:12px;color:var(--muted);margin:10px 0 6px">${label}</label><textarea id="${fieldId}" style="width:100%;min-height:90px;border:1px solid var(--line);border-radius:10px;padding:8px;font-size:12px;font-family:'IBM Plex Mono',monospace"></textarea>${helpHtml}`;
  }
  if (field.input === 'checkbox') {
    return `<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text);margin-top:10px;cursor:pointer"><input id="${fieldId}" type="checkbox" /><span>${label}</span></label>${helpHtml}`;
  }
  if (field.input === 'select' && Array.isArray(field.options) && field.options.length) {
    return `<label style="display:block;font-size:12px;color:var(--muted);margin:10px 0 6px">${label}</label><select id="${fieldId}" class="settings-input" style="font-size:13px">${field.options.map(option => `<option value="${escHtml(option)}">${escHtml(option)}</option>`).join('')}</select>${helpHtml}`;
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
  return `<div id="${panelId}" style="display:none"><div class="right-section-title" style="margin-bottom:8px">${escHtml(provider.name)}</div>${description}${fields.map(field => renderProviderField(provider, field)).join('')}<div style="display:flex;gap:8px;margin-top:10px">${refreshButton}<button class="btn btn-sm" onclick="testProviderConnection('${provider.id}')" style="background:#fff;border:1px solid var(--line);color:var(--text)">Test Connection</button></div><div id="${statusId}" style="font-size:11px;color:var(--muted);margin-top:6px"></div></div>`;
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
        return items;
      })
      .catch((err) => {
        console.warn('Failed to load provider catalog:', err);
        providerCatalogCache = BUILTIN_PROVIDER_IDS.map(id => ({ id, name: id, setup: {}, runtime: {}, config: {} }));
        renderProviderSelectors();
        renderDynamicProviderPanels();
        return providerCatalogCache;
      });
  }
  return providerCatalogPromise;
}

function onProviderChange() {
  const provider = document.getElementById('settings-llm-provider').value;
  getKnownProviderIds().forEach(id => {
    const el = document.getElementById(getProviderPanelId(id));
    if (el) el.style.display = id === provider ? 'block' : 'none';
  });
  if (provider === 'openai') {
    refreshOpenAIModels(true).catch(() => {});
  } else if (provider === 'anthropic') {
    refreshAnthropicStatus().catch(() => {});
  } else if (provider !== 'openai_codex') {
    refreshProviderModels(provider).catch(() => {});
  }
}

async function loadModelSettings() {
  try {
    await ensureProviderCatalogUIReady();
    await fetchCredentialedModelProviderIds(true);
    const data = await api('/api/settings/provider', { timeoutMs: 8000 });
    const llm = data?.llm || { provider: 'ollama', providers: {} };
    const prov = llm.provider || 'ollama';
    window._llmSettingsCache = llm;
    window._llmSettingsLoadedToUI = true;
    renderProviderSelectors();
    const provSel = document.getElementById('settings-llm-provider');
    if (provSel) provSel.value = prov;

    const pc = llm.providers || {};

    // Populate each provider's fields from saved config
    const v = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
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
    if (pc.openai?.model) { const s = document.getElementById('settings-openai-model'); if (s) s.value = pc.openai.model; }
    { const s = document.getElementById('settings-openai-effort'); if (s) s.value = pc.openai?.reasoning_effort || ''; }
    if (pc.openai_codex?.model) { const s = document.getElementById('settings-codex-model'); if (s) s.value = pc.openai_codex.model; }
    { const s = document.getElementById('settings-codex-effort'); if (s) s.value = pc.openai_codex?.reasoning_effort || ''; }
    if (pc.anthropic?.model) { const s = document.getElementById('settings-anthropic-model'); if (s) s.value = pc.anthropic.model; }
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
    }

    getProviderCatalogItems()
      .filter(item => !BUILTIN_PROVIDER_IDS.includes(item.id))
      .forEach(item => applyDynamicProviderConfig(item.id, pc[item.id]));

    // Auth/model probes can be slow on cold startup. Populate saved settings first,
    // then let live status/model lists settle without blocking the Settings modal.
    Promise.allSettled([
      refreshCodexStatus(),
      refreshAnthropicStatus(),
      prov === 'openai' ? refreshOpenAIModels(true) : Promise.resolve(),
    ]).catch(() => {});

    // Auto-load model list for list-capable providers in the background.
    setTimeout(() => onProviderChange(), 0);
    if (typeof window.applyReasoningPrefsFromProviderConfig === 'function') {
      window.applyReasoningPrefsFromProviderConfig(llm, prov);
    }
    Promise.allSettled([
      loadAgentModelDefaults(),
      loadBrainModelConfig(),
      loadSessionCompactionSettings(),
    ]).catch(() => {});
  } catch (e) {
    console.warn('loadModelSettings error:', e);
  }
}

async function loadSessionCompactionSettings() {
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
    if (wordsEl) wordsEl.value = String(Number(s.rollingCompactionSummaryMaxWords) || 220);
    if (modelEl) modelEl.value = String(s.rollingCompactionModel || '');
  } catch (e) {
    console.warn('loadSessionCompactionSettings error:', e);
  }
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
    let models = (data?.models || []).map(m => typeof m === 'string' ? m : (m.name || String(m))).filter(Boolean);
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
  sel.innerHTML = unique.slice(0, 500).map(m => `<option value="${escHtml(m)}">${escHtml(m)}</option>`).join('');
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
  const provider = providerOverride || document.getElementById('settings-llm-provider')?.value || 'ollama';
  const providers = {};
  providers.ollama    = { endpoint: document.getElementById('settings-ollama-endpoint')?.value  || 'http://localhost:11434', model: document.getElementById('settings-primary-model')?.value || 'qwen3:4b' };
  providers.llama_cpp = { endpoint: document.getElementById('settings-llamacpp-endpoint')?.value || 'http://localhost:8080',  model: document.getElementById('settings-llamacpp-model')?.value  || '' };
  providers.lm_studio = { endpoint: document.getElementById('settings-lmstudio-endpoint')?.value || 'http://localhost:1234',  model: document.getElementById('settings-lmstudio-model')?.value   || '' };
  const openaiEffort = document.getElementById('settings-openai-effort')?.value || '';
  providers.openai    = { api_key:  document.getElementById('settings-openai-key')?.value         || '',                       model: document.getElementById('settings-openai-model')?.value      || 'gpt-4o' };
  if (openaiEffort) providers.openai.reasoning_effort = openaiEffort;
  const codexEffort = document.getElementById('settings-codex-effort')?.value || '';
  providers.openai_codex = { model: document.getElementById('settings-codex-model')?.value         || 'gpt-5.4-codex' };
  if (codexEffort) providers.openai_codex.reasoning_effort = codexEffort;
  const anthropicExtThinking = document.getElementById('settings-anthropic-extended-thinking')?.checked || false;
  const anthropicBudget = parseInt(document.getElementById('settings-anthropic-thinking-budget')?.value || '10000', 10);
  providers.anthropic = {
    model: document.getElementById('settings-anthropic-model')?.value || 'claude-sonnet-4-6',
    extended_thinking: anthropicExtThinking,
    thinking_budget: anthropicBudget,
  };
  const perplexityEffort = document.getElementById('settings-perplexity-effort')?.value || '';
  providers.perplexity = {
    api_key: document.getElementById('settings-perplexity-key')?.value || '',
    model: document.getElementById('settings-perplexity-model')?.value || 'sonar-pro',
  };
  if (perplexityEffort) providers.perplexity.reasoning_effort = perplexityEffort;
  providers.gemini = {
    api_key: document.getElementById('settings-gemini-key')?.value || '',
    model: document.getElementById('settings-gemini-model')?.value || 'gemini-2.5-pro',
  };
  for (const item of getProviderCatalogItems()) {
    if (BUILTIN_PROVIDER_IDS.includes(item.id)) continue;
    const config = collectDynamicProviderConfig(item.id, provider);
    if (config) providers[item.id] = config;
  }
  return { provider, providers };
}

// --- Codex OAuth UI ------------------------------------------------

async function refreshCodexStatus() {
  try {
    const data = await api('/api/auth/openai/status');
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
    const data = await api('/api/auth/openai/start', { method: 'POST', body: '{}' });
    if (data?.error) {
      setSettingsStatus(statusEl, 'error', data.error);
      return;
    }
    if (data?.authUrl) {
      // Open in system browser — Electron routes window.open via shell.openExternal
      window.open(data.authUrl, '_blank');
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
    const data = await api('/api/auth/openai/manual', { method: 'POST', body: JSON.stringify({ url }) });
    if (data?.success) {
      setSettingsStatus(statusEl, 'info', '');
      await refreshCodexStatus();
    } else {
      setSettingsStatus(statusEl, 'error', data?.error || 'Failed');
    }
  } catch (e) {
    setSettingsStatus(statusEl, 'error', e.message);
  }
}

async function disconnectCodex() {
  await api('/api/auth/openai/disconnect', { method: 'POST', body: '{}' });
  await refreshCodexStatus();
}

// --- Anthropic Auth UI ------------------------------------------------

async function refreshAnthropicStatus() {
  try {
    const data = await api('/api/auth/anthropic/status');
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
  } catch {}
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
      body: JSON.stringify({ token }),
    });
    if (data?.success) {
      setSettingsStatus(statusEl, 'info', '');
      if (tokenInput) tokenInput.value = '';
      await refreshAnthropicStatus();
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
    const data = await api('/api/auth/anthropic/test', { method: 'POST', body: '{}' });
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
  await api('/api/auth/anthropic/disconnect', { method: 'POST', body: '{}' });
  await refreshAnthropicStatus();
  addProcessEntry('info', 'Anthropic disconnected.');
}

function onAnthropicThinkingToggle(checked) {
  const row = document.getElementById('anthropic-thinking-budget-row');
  if (row) row.style.display = checked ? 'block' : 'none';
}

// Legacy alias so any old references still work
async function refreshOllamaModels() { await refreshProviderModels(); }

async function openSettings(tab) {
  document.getElementById('settings-modal').style.display = 'flex';
  const saveBtn = document.getElementById('settings-save-btn');
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
  }
  setSettingsTab(tab || window.settingsTab || 'system');
  try {
    const status = await api('/api/status', { timeoutMs: 5000 });
    document.getElementById('settings-runtime-model').textContent = status.currentModel || '-';
    document.getElementById('settings-runtime-gateway').textContent = status.gateway || '-';
    document.getElementById('settings-runtime-ollama').textContent = status.ollama ? 'Online' : 'Offline';
  } catch {}
  try {
    const paths = await api('/api/settings/paths', { timeoutMs: 5000 });
    document.getElementById('settings-workspace-path').value = paths.workspace_path || '';
    document.getElementById('settings-allowed-paths').value = (paths.allowed_paths || []).join('\n');
    document.getElementById('settings-blocked-paths').value = (paths.blocked_paths || []).join('\n');
  } catch {}
  try {
    const s = await api('/api/settings/search', { timeoutMs: 5000 });
    document.getElementById('settings-provider').value = s.preferred_provider || 'tavily';
    document.getElementById('settings-search-rigor').value = s.search_rigor || 'verified';
    // Keys are loaded via the Credentials tab — not here
  } catch {}
  try { await loadSessionCompactionSettings(); } catch {}
}

function closeSettings() {
  const saveBtn = document.getElementById('settings-save-btn');
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
  }
  document.getElementById('settings-modal').style.display = 'none';
  channelsStatusLoaded = false;
}

// -- Migration panel -------------------------------------------------------------------------------------------------------------
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
    el.innerHTML = '<div style="border:1px dashed var(--line);border-radius:10px;padding:10px;color:var(--muted);font-size:12px">No Hermes, OpenClaw, or LocalClaw folders found automatically. Use a custom source folder below.</div>';
    return;
  }
  if (!selectedMigrationSourceId) selectedMigrationSourceId = migrationSources[0].id;
  el.innerHTML = migrationSources.map((source) => {
    const selected = source.id === selectedMigrationSourceId;
    const kind = source.kind === 'hermes' ? 'Hermes' : source.kind === 'openclaw' ? 'OpenClaw' : source.kind === 'localclaw' ? 'LocalClaw' : 'Custom';
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
    default: document.getElementById('agent-edit-id').value.trim() === 'main',
  };
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
    const selectedProv = canUseProvider ? prov : '';
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
  })();
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
  if (!window.agentsConfigList.length) {
    el.innerHTML = '<div style="color:var(--muted)">No agents found.</div>';
    return;
  }

  // -- Categorise agents ------------------------------------------------------
  const mainAgent = window.agentsConfigList.find(a => a.id === 'main') || window.agentsConfigList[0];

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
    const managerId = t.managerId ||
      window.agentsConfigList.find(a => a.isTeamManager && a.teamId === t.id)?.id ||
      window.agentsConfigList.find(a => a.isTeamManager && a.id.endsWith('_manager') && a.id.includes(teamKeyword))?.id ||
      window.agentsConfigList.find(a => a.id === `${teamKeyword}_manager`)?.id ||
      null;

    const allIds = [...memberIds];
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

  // 1. Main agent — always pinned at top
  if (mainAgent) {
    html += sectionLabel('Main');
    html += renderCard(mainAgent);
  }

  // 2. Team sections — one block per team
  for (const [, g] of teamGroups) {
    const count = g.members.length;
    if (count === 0) continue;
    html += sectionLabel(`${g.teamEmoji} ${escHtml(g.teamName)} &nbsp;<span style="font-weight:400;font-size:9px">${count} member${count !== 1 ? 's' : ''}</span>`);
    html += g.members.map(a => renderCard(a)).join('');
  }

  // 3. Solo agents — any agent not main and not in a team
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
  if (mdPath) mdPath.textContent = 'Select or save an agent to load AGENTS.md';
  const resultEl = document.getElementById('agent-spawn-result');
  if (resultEl) resultEl.textContent = '';
  renderAgentsList();
}

async function selectAgent(id) {
  window.selectedAgentId = id;
  const selected = findSelectedAgent();
  setAgentForm(selected);
  // Show/hide Delete button — main agent is protected
  const deleteBtn = document.getElementById('agent-delete-btn');
  if (deleteBtn) {
    const isProtected = isMainAgentEntry(selected);
    deleteBtn.disabled = isProtected;
    deleteBtn.title = isProtected ? 'Cannot delete the main agent' : '';
    deleteBtn.style.opacity = isProtected ? '0.4' : '1';
    deleteBtn.style.cursor = isProtected ? 'not-allowed' : 'pointer';
  }
  renderAgentsList();
  // Force CodeMirror refresh on every agent switch — fixes blank editor for sub-agents
  ensureAgentMdEditor();
  if (window.agentMdEditor) {
    window.agentMdEditor.setValue('');
    window.agentMdEditor.refresh();
  }
  // Populate model dropdown for this agent's provider
  const provEl = document.getElementById('agent-edit-provider');
  if (provEl && provEl.value) {
    await loadAgentModelOptions(true); // true = preserve current selection
  }
	  await loadSelectedAgentMd();
  await loadAgentHeartbeat();
	  await loadAgentRunHistory();
	}

// --- Agent model picker ------------------------------------------------------

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
    openai: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o4-mini', 'o3', 'o1'],
    openai_codex: ['gpt-5.5', 'gpt-5.4-codex', 'gpt-5.4-codex-mini', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.3', 'gpt-5.2-codex', 'gpt-5.2', 'gpt-5.1-codex-max', 'gpt-5.1-codex-mini', 'gpt-5.1-codex', 'gpt-5.1'],
    anthropic: ['claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
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
  } catch (err) {
    mdlSel.innerHTML = '<option value="">— fetch failed —</option>';
    if (status) status.textContent = `Error: ${err.message}`;
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
    window.selectedAgentId = agentId;
    renderAgentsList();
    const agent = window.agentsConfigList.find(a => a.id === agentId);
    if (agent) setAgentForm(agent);
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
  if (!agentId) {
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
  try {
    const data = await api('/api/agents', { timeoutMs: 8000 });
    window.agentsConfigList = Array.isArray(data?.agents) ? data.agents : [];
    // Prefer selecting main agent so newly-created subagents do not steal focus
    const defaultAgentId = window.agentsConfigList.find(a => a.id === 'main')?.id
      || data?.defaultAgentId
      || window.agentsConfigList.find(a => a.default === true)?.id
      || window.agentsConfigList[0]?.id || '';
    if (!window.selectedAgentId || !window.agentsConfigList.some(a => a.id === window.selectedAgentId)) {
      window.selectedAgentId = defaultAgentId;
    }
    renderAgentsList();
    const selected = findSelectedAgent();
    setAgentForm(selected);
    // Sync delete button protection state
    const deleteBtn = document.getElementById('agent-delete-btn');
    if (deleteBtn) {
      const isProtected = isMainAgentEntry(selected);
      deleteBtn.disabled = isProtected;
      deleteBtn.title = isProtected ? 'Cannot delete the main agent' : '';
      deleteBtn.style.opacity = isProtected ? '0.4' : '1';
      deleteBtn.style.cursor = isProtected ? 'not-allowed' : 'pointer';
    }
    if (selected) {
    // Refresh CodeMirror so it doesn't show blank on tab re-open
    if (window.agentMdEditor) { window.agentMdEditor.setValue(''); window.agentMdEditor.refresh(); }
    // Load model options for the selected agent's provider
    const provEl = document.getElementById('agent-edit-provider');
    if (provEl && provEl.value) loadAgentModelOptions(true).catch(() => {});
    loadSelectedAgentMd().catch(() => {});
    loadAgentRunHistory().catch(() => {});
    if (!isSelectedMainAgent()) loadAgentHeartbeat().catch(() => {});
    } else {
      agentFormNew();
    }
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
    if (titleEl) titleEl.textContent = 'System Prompt (CodeMirror)';
    if (saveBtn) saveBtn.textContent = 'Save system_prompt.md';
    if (noteEl) noteEl.style.display = 'none';
    if (badgeEl) badgeEl.style.display = 'none';
  } else {
    if (promptCard) promptCard.style.display = '';
    if (titleEl) titleEl.textContent = 'System Prompt (CodeMirror)';
    if (saveBtn) saveBtn.textContent = 'Save system_prompt.md';
    if (noteEl) {
      noteEl.style.display = 'block';
      noteEl.innerHTML = 'This subagent prompt comes from <strong>system_prompt.md</strong>. Recurring work is configured from Scheduled Tasks by assigning this subagent.';
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

  const endpoint = 'system-prompt-md';
  const label = 'System Prompt (CodeMirror)';
  const saveLabel = 'Save system_prompt.md';

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
  const endpoint = 'system-prompt-md';
  const label = 'system_prompt.md';
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
  if (channel === 'telegram') {
    const userIdStr = (document.getElementById('settings-tg-userid')?.value || '').trim();
    const allowedUserIds = userIdStr ? userIdStr.split(/[,\s]+/).map(Number).filter(n => !isNaN(n) && n > 0) : [];
    return {
      enabled: !!document.getElementById('settings-tg-enabled')?.checked,
      botToken: (document.getElementById('settings-tg-token')?.value || '').trim(),
      allowedUserIds,
      streamMode: 'full',
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
  };
}

function setButtonBusy(id, busy, busyLabel, normalLabel) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled = !!busy;
  btn.textContent = busy ? busyLabel : normalLabel;
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
  try {
    const data = await api('/api/channels/status');
    if (!data?.success) return;
    const tg = data.telegram || {};
    const dc = data.discord || {};
    const wa = data.whatsapp || {};

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
  } catch (err) {
    console.error('[Channels] Status load failed:', err);
  }
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

async function saveSettings() {
  const btn = document.getElementById('settings-save-btn');
  if (btn?.disabled) return; // prevent double-submit
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  const resetBtn = () => { if (btn) { btn.disabled = false; btn.textContent = 'Save'; } };
  // Safety valve — re-enable button after 15s no matter what
  const safetyTimer = setTimeout(resetBtn, 15000);
  try {
    const workspace_path = document.getElementById('settings-workspace-path').value.trim();
    const allowed_paths = document.getElementById('settings-allowed-paths').value.split('\n').map(s => s.trim()).filter(Boolean);
    const blocked_paths = document.getElementById('settings-blocked-paths').value.split('\n').map(s => s.trim()).filter(Boolean);
    const payload = {
      preferred_provider: document.getElementById('settings-provider')?.value || '',
      search_rigor: document.getElementById('settings-search-rigor')?.value || 'verified',
      tinyfish_api_key: document.getElementById('cred-tinyfish-key')?.value.trim() || '',
      tavily_api_key: document.getElementById('cred-tavily-key')?.value.trim() || '',
      google_api_key: document.getElementById('cred-google-key')?.value.trim() || '',
      google_cx: document.getElementById('cred-google-cx')?.value.trim() || '',
      brave_api_key: document.getElementById('cred-brave-key')?.value.trim() || '',
    };
    const primaryModel = (document.getElementById('settings-primary-model') || {}).value || '';
    const modelPayload = {
      ollama_endpoint: (document.getElementById('settings-ollama-endpoint') || {}).value || 'http://localhost:11434',
      primary: primaryModel,
      roles: {
        manager: primaryModel,
        executor: primaryModel,
        verifier: primaryModel,
      }
    };
    const providerPayload = buildProviderPayload();
    const sessionPayload = {
      rollingCompactionEnabled: document.getElementById('settings-rolling-compaction-enabled')?.checked !== false,
      rollingCompactionMessageCount: Number(document.getElementById('settings-rolling-compaction-count')?.value || 20),
      rollingCompactionToolTurns: Number(document.getElementById('settings-rolling-compaction-tools')?.value || 5),
      rollingCompactionSummaryMaxWords: Number(document.getElementById('settings-rolling-compaction-words')?.value || 220),
      rollingCompactionModel: (document.getElementById('settings-rolling-compaction-model')?.value || '').trim(),
    };
    await api('/api/settings/bulk', {
      method: 'POST',
      body: JSON.stringify({
        paths: { workspace_path, allowed_paths, blocked_paths },
        search: payload,
        model: modelPayload,
        llm: providerPayload,
        session: sessionPayload,
      }),
    });
    if (typeof window.applyReasoningPrefsFromProviderConfig === 'function') {
      window.applyReasoningPrefsFromProviderConfig(providerPayload, providerPayload.provider);
    }
    loadSearchSettingsSummary().catch(() => {});
    loadCredFields().catch(() => {});
    quickSearchRigor = payload.search_rigor || quickSearchRigor;
    updateQuickModeUI();
    addProcessEntry('final', 'Settings saved.');
    resetBtn();
    closeSettings();
  } catch (err) {
    addProcessEntry('error', `Failed to save settings: ${err.message}`);
    resetBtn();
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
  await loadWebhookSettings();
  await loadMCPServers();
}

// --- Webhooks -----------------------------------------------------------------

async function loadWebhookSettings() {
  try {
    const data = await api('/api/settings/hooks');
    const h = data.hooks || {};
    const cb = document.getElementById('wh-enabled');
    const inp = document.getElementById('wh-token');
    const pathInp = document.getElementById('wh-path');
    if (cb) cb.checked = h.enabled === true;
    if (inp) inp.value = h.tokenSet ? '••••••••' : '';
    if (pathInp) pathInp.value = h.path || '/hooks';
    updateWebhookStatus(h.enabled, h.tokenSet);
    updateWebhookUrlDisplay(h.enabled, h.tokenSet, h.path || '/hooks');
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

const MCP_PRESETS = {
  filesystem: { name: 'Filesystem', transport: 'stdio', command: 'npx', args: '-y\n@modelcontextprotocol/server-filesystem\nC:\\Users', env: '', description: 'Read/write local files' },
  github:     { name: 'GitHub', transport: 'stdio', command: 'npx', args: '-y\n@modelcontextprotocol/server-github', env: 'GITHUB_PERSONAL_ACCESS_TOKEN=', description: 'Repos, PRs, issues' },
  windows:    { name: 'Windows MCP', transport: 'stdio', command: 'uvx', args: 'windows-mcp', env: '', description: 'Native Windows desktop automation' },
  postgres:   { name: 'PostgreSQL', transport: 'stdio', command: 'npx', args: '-y\n@modelcontextprotocol/server-postgres\npostgresql://localhost/mydb', env: '', description: 'Query PostgreSQL' },
  sqlite:     { name: 'SQLite', transport: 'stdio', command: 'npx', args: '-y\n@modelcontextprotocol/server-sqlite\n--db-path\nC:\\path\\to\\db.sqlite', env: '', description: 'Local database' },
  brave:      { name: 'Brave Search', transport: 'stdio', command: 'npx', args: '-y\n@modelcontextprotocol/server-brave-search', env: 'BRAVE_API_KEY=', description: 'Web search' },
  memory:     { name: 'Memory', transport: 'stdio', command: 'npx', args: '-y\n@modelcontextprotocol/server-memory', env: '', description: 'Persistent knowledge store' },
};

async function loadMCPServers() {
  const el = document.getElementById('mcp-server-list');
  if (!el) return;
  try {
    const data = await api('/api/mcp/servers');
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
  } catch(e) {
    el.innerHTML = `<div style="color:#ef4444">Failed to load: ${escHtml(e.message)}</div>`;
  }
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

function prefillMCPServer(presetKey) {
  const p = MCP_PRESETS[presetKey];
  if (!p) return;
  showMCPAddForm();
  const v = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  v('mcp-f-id', presetKey);
  v('mcp-f-name', p.name);
  document.getElementById('mcp-f-transport').value = p.transport;
  onMCPTransportChange();
  v('mcp-f-command', p.command || '');
  v('mcp-f-args', p.args || '');
  v('mcp-f-env', p.env || '');
  v('mcp-f-url', p.url || '');
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
    await loadMCPServers();
  } catch(e) { showIntegMsg('Delete failed: ' + e.message, '#991b1b', '#fef2f2'); }
}

async function connectMCPServer(id) {
  showIntegMsg('Connecting to ' + id + '…', '#1e40af', '#eff6ff');
  try {
    const r = await api(`/api/mcp/servers/${id}/connect`, { method: 'POST' });
    if (r.success) {
      showIntegMsg(`? Connected — ${(r.tools||[]).length} tool(s) available`, '#166534', '#f0fdf4');
    } else {
      showIntegMsg('? Connection failed: ' + (r.error || 'Unknown'), '#991b1b', '#fef2f2');
    }
    await loadMCPServers();
  } catch(e) {
    showIntegMsg('Connect error: ' + e.message, '#991b1b', '#fef2f2');
    await loadMCPServers();
  }
}

async function disconnectMCPServer(id) {
  try {
    await api(`/api/mcp/servers/${id}/disconnect`, { method: 'POST' });
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
window.onAnthropicThinkingToggle = onAnthropicThinkingToggle;
window.disconnectCodex = disconnectCodex;
window.disconnectMCPServer = disconnectMCPServer;
window.editMCPServer = editMCPServer;
window.ensureAgentHbEditor = ensureAgentHbEditor;
window.ensureAgentMdEditor = ensureAgentMdEditor;
window.ensureHeartbeatEditor = ensureHeartbeatEditor;
window.findSelectedAgent = findSelectedAgent;
window.generateWebhookToken = generateWebhookToken;
window.getAgentFromForm = getAgentFromForm;
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
  'background-task': 'background_task',
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
  // Background spawn agents (background_spawn tool)
  'background-agent':       'background_agent',
};

const AMD_STATIC_MODELS = {
  openai:       ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o4-mini', 'o3', 'o1'],
  openai_codex: ['gpt-5.5', 'gpt-5.4-codex', 'gpt-5.4-codex-mini', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.3', 'gpt-5.2-codex', 'gpt-5.2', 'gpt-5.1-codex-max', 'gpt-5.1-codex-mini', 'gpt-5.1-codex', 'gpt-5.1'],
  anthropic:    ['claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  perplexity:   ['sonar-pro', 'sonar', 'sonar-reasoning-pro', 'sonar-reasoning', 'sonar-deep-research'],
  gemini:       ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
};

const AMD_TEMPLATE_CACHE_KEY = 'prometheus_agent_model_default_templates_v1';
let amdTemplatesCache = [];
let amdActiveTemplateId = '';

async function amdProviderChange(slotId) {
  const provSel  = document.getElementById('amd-' + slotId + '-prov');
  const modelSel = document.getElementById('amd-' + slotId + '-model');
  if (!provSel || !modelSel) return;
  const prov = provSel.value;
  if (!prov) {
    modelSel.innerHTML = '<option value="">— use primary model —</option>';
    return;
  }
  modelSel.innerHTML = '<option value="">Loading…</option>';
  try {
    await ensureProviderCatalogUIReady();
    await fetchCredentialedModelProviderIds();
    if (!isCredentialedModelProviderId(prov)) {
      modelSel.innerHTML = '<option value="">— provider not connected —</option>';
      return;
    }
    const models = await fetchProviderModelsForPicker(prov, { refreshOpenAI: prov === 'openai', includeLive: true });
    if (!models.length) { modelSel.innerHTML = '<option value="">— no models found —</option>'; return; }
    modelSel.innerHTML = models.map(m => `<option value="${escHtml(m)}">${escHtml(m)}</option>`).join('');
  } catch (e) {
    modelSel.innerHTML = '<option value="">— fetch failed —</option>';
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

async function applyAgentModelDefaultsToForm(defaults = {}) {
  await ensureProviderCatalogUIReady();
  await fetchCredentialedModelProviderIds();
  renderProviderSelectors();
  const d = defaults || {};
  for (const slotId of Object.keys(AMD_SLOTS)) {
    const provSel  = document.getElementById('amd-' + slotId + '-prov');
    const modelSel = document.getElementById('amd-' + slotId + '-model');
    if (provSel) provSel.value = '';
    if (modelSel) modelSel.innerHTML = '<option value="">select provider first</option>';
  }
  for (const [slotId, field] of Object.entries(AMD_SLOTS)) {
    const val = d[field] || '';
    if (!val) continue;
    const slashIdx = String(val).indexOf('/');
    const hasProvider = slashIdx > 0;
    const prov = hasProvider ? String(val).slice(0, slashIdx) : '';
    const model = hasProvider ? String(val).slice(slashIdx + 1) : String(val);
    if (prov && !isCredentialedModelProviderId(prov)) continue;
    const provSel  = document.getElementById('amd-' + slotId + '-prov');
    const modelSel = document.getElementById('amd-' + slotId + '-model');
    if (provSel) provSel.value = prov;
    if (prov && modelSel) {
      await amdProviderChange(slotId);
    }
    if (modelSel && model) {
      if (!Array.from(modelSel.options).find(o => o.value === model)) {
        modelSel.innerHTML += `<option value="${escHtml(model)}">${escHtml(model)}</option>`;
      }
      modelSel.value = model;
    }
  }
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
  rememberAgentModelDefaultTemplates();
  renderAgentModelDefaultTemplates();
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
      renderAgentModelDefaultTemplates();
    } catch {}
    console.warn('loadAgentModelDefaultTemplates error:', e);
  }
}

function onAgentModelTemplateSelect() {
  const select = document.getElementById('amd-template-select');
  const nameInput = document.getElementById('amd-template-name');
  const selected = amdTemplatesCache.find((template) => template.id === select?.value);
  if (nameInput) nameInput.value = selected?.name || '';
}

async function loadAgentModelDefaults() {
  try {
    const data = await api('/api/settings/agent-model-defaults');
    await applyAgentModelDefaultsToForm(data?.defaults || {});
    updateAgentModelTemplateCache(data);
  } catch (e) { console.warn('loadAgentModelDefaults error:', e); }
}

async function saveAgentModelDefaults() {
  const payload = getAgentModelDefaultsFromForm();
  const status = document.getElementById('amd-status');
  const btn = document.querySelector('[onclick="saveAgentModelDefaults()"]');
  if (btn?.disabled) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  const resetBtn = () => { if (btn) { btn.disabled = false; btn.textContent = 'Save Agent Model Defaults'; } };
  const safetyTimer = setTimeout(resetBtn, 15000);
  try {
    await api('/api/settings/agent-model-defaults', { method: 'POST', body: JSON.stringify(payload) });
    if (status) {
      status.style.color = 'var(--ok)';
      setSettingsStatus(status, 'success', 'Saved');
      setTimeout(() => { setSettingsStatus(status, 'info', ''); }, 2500);
    }
    if (payload.main_chat) {
      showToast('Main model changed', payload.main_chat, 'success', 5000);
    }
    resetBtn();
  } catch(e) {
    if (status) {
      status.style.color = 'var(--err)';
      setSettingsStatus(status, 'error', e.message);
    }
    resetBtn();
  } finally {
    clearTimeout(safetyTimer);
  }
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
      }),
    });
    updateAgentModelTemplateCache(data);
    if (select && data?.template?.id) select.value = data.template.id;
    setAgentModelTemplateStatus('success', `Saved "${data?.template?.name || name}".`);
    showToast('Model template saved', data?.template?.name || name, 'success', 3500);
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
    await applyAgentModelDefaultsToForm(data?.defaults || data?.template?.defaults || {});
    await loadAgentModelDefaultTemplates();
    setAgentModelTemplateStatus('success', `Applied "${data?.template?.name || id}".`);
    showToast('Model template applied', data?.template?.name || id, 'success', 4000);
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

// --- Brain System Model Config --------------------------------------------

async function brainProviderChange(type) {
  const provSel  = document.getElementById(`brain-${type}-prov`);
  const modelSel = document.getElementById(`brain-${type}-model`);
  if (!provSel || !modelSel) return;
  const prov = provSel.value;
  if (!prov) { modelSel.innerHTML = '<option value="">— use primary model —</option>'; return; }
  modelSel.innerHTML = '<option value="">Loading…</option>';
  try {
    let models = [];
    if (prov === 'anthropic') {
      models = ['claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-sonnet-4-5-20250514', 'claude-haiku-4-5-20251001'];
    } else if (prov === 'openai') {
      models = Array.from(document.getElementById('settings-openai-model')?.options || []).map(o => o.value).filter(Boolean);
      if (!models.length) models = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'];
    } else if (prov === 'openai_codex') {
      models = ['gpt-5.5', 'gpt-5.4-codex', 'gpt-5.4-codex-mini', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.3', 'gpt-5.2-codex', 'gpt-5.2', 'gpt-5.1-codex-max', 'gpt-5.1-codex-mini', 'gpt-5.1-codex', 'gpt-5.1'];
    } else if (prov === 'perplexity') {
      models = ['sonar-pro', 'sonar', 'sonar-reasoning-pro', 'sonar-reasoning', 'sonar-deep-research'];
    } else if (prov === 'gemini') {
      models = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'];
    } else {
      const llm = typeof buildProviderPayload === 'function' ? buildProviderPayload() : {};
      llm.provider = prov;
      const data = await api('/api/models/test', { method: 'POST', body: JSON.stringify({ llm }) });
      models = (data?.models || []).map(m => typeof m === 'string' ? m : (m.name || String(m)));
    }
    if (!models.length) { modelSel.innerHTML = '<option value="">— no models found —</option>'; return; }
    modelSel.innerHTML = models.map(m => `<option value="${m}">${m}</option>`).join('');
  } catch (e) {
    modelSel.innerHTML = '<option value="">— fetch failed —</option>';
  }
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
    }
  } catch (e) { console.warn('loadBrainModelConfig error:', e); }
}

async function saveBrainModelConfig() {
  const payload = {};
  for (const type of ['thought', 'dream']) {
    const prov  = document.getElementById(`brain-${type}-prov`)?.value?.trim()  || '';
    const model = document.getElementById(`brain-${type}-model`)?.value?.trim() || '';
    if (type === 'thought') payload.thoughtModel = prov && model ? `${prov}/${model}` : '';
    else payload.dreamModel = prov && model ? `${prov}/${model}` : '';
  }
  const status = document.getElementById('brain-model-status');
  const btn = document.querySelector('[onclick="saveBrainModelConfig()"]');
  if (btn?.disabled) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  const resetBtn = () => { if (btn) { btn.disabled = false; btn.textContent = 'Save Brain Models'; } };
  const safetyTimer = setTimeout(resetBtn, 15000);
  try {
    const result = await api('/api/brain/config', { method: 'PATCH', body: JSON.stringify(payload) });
    if (result?.success === false) throw new Error(result.error || 'Failed to save brain models');
    if (status) {
      status.style.color = 'var(--ok)';
      setSettingsStatus(status, 'success', 'Saved');
      setTimeout(() => { setSettingsStatus(status, 'info', ''); }, 2500);
    }
    resetBtn();
  } catch (e) {
    if (status) {
      status.style.color = 'var(--err)';
      setSettingsStatus(status, 'error', e.message);
    }
    resetBtn();
  } finally {
    clearTimeout(safetyTimer);
  }
}

window.amdProviderChange = amdProviderChange;
window.loadAgentModelDefaults = loadAgentModelDefaults;
window.brainProviderChange = brainProviderChange;
window.loadBrainModelConfig = loadBrainModelConfig;
window.saveBrainModelConfig = saveBrainModelConfig;
window.loadAgentHeartbeat = loadAgentHeartbeat;
window.loadAgentModelDefaultTemplates = loadAgentModelDefaultTemplates;
window.loadAgentModelOptions = loadAgentModelOptions;
window.loadAgentRunHistory = loadAgentRunHistory;
window.loadAgentsTab = loadAgentsTab;
window.loadChannelsStatus = loadChannelsStatus;
window.loadCredFields = loadCredFields;
window.loadCredVaultLog = loadCredVaultLog;
window.loadCredVaultStatus = loadCredVaultStatus;
window.loadCredentialsTab = loadCredentialsTab;
window.loadHeartbeatSettings = loadHeartbeatSettings;
window.loadIntegrationsTab = loadIntegrationsTab;
window.loadMigrationPanel = loadMigrationPanel;
window.loadMCPServers = loadMCPServers;
window.loadModelSettings = loadModelSettings;
window.loadSearchSettingsSummary = loadSearchSettingsSummary;
window.loadSelectedAgentMd = loadSelectedAgentMd;
window.loadSessionCompactionSettings = loadSessionCompactionSettings;
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
window.prefillMCPServer = prefillMCPServer;
window.readChannelPayload = readChannelPayload;
window.refreshAnthropicStatus = refreshAnthropicStatus;
window.refreshCodexStatus = refreshCodexStatus;
window.refreshHeartbeatSummary = refreshHeartbeatSummary;
window.refreshOllamaModels = refreshOllamaModels;
window.refreshOpenAIModels = refreshOpenAIModels;
window.refreshProviderModels = refreshProviderModels;
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
window.deleteAgentModelDefaultTemplate = deleteAgentModelDefaultTemplate;
window.onAgentModelTemplateSelect = onAgentModelTemplateSelect;
window.saveSettings = saveSettings;
window.saveWebhookSettings = saveWebhookSettings;
window.selectAgent = selectAgent;
window.sendChannelTest = sendChannelTest;
window.sendSelectedChannelTest = sendSelectedChannelTest;
window.setAgentForm = setAgentForm;
window.setButtonBusy = setButtonBusy;
window.setChannelStatus = setChannelStatus;
window.setIntegTab = setIntegTab;
window.setQuickSearchRigor = setQuickSearchRigor;
window.setQuickThinkingEffort = setQuickThinkingEffort;
window.setSettingsTab = setSettingsTab;
window.showIntegMsg = showIntegMsg;
window.showMCPAddForm = showMCPAddForm;
window.startCodexOAuth = startCodexOAuth;
window.submitManualCodexUrl = submitManualCodexUrl;
window.testChannel = testChannel;
window.testAnthropicConnection = testAnthropicConnection;
window.testProviderConnection = testProviderConnection;
window.testSelectedChannel = testSelectedChannel;
window.testWebhookEndpoint = testWebhookEndpoint;
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
