/**
 * ConnectionsPage.js
 *
 * Connections panel powered by the extension catalog API.
 */

import { api, ENDPOINTS } from '../api.js';
import { escHtml, showToast } from '../utils.js';

let CONNECTORS = [];
let connectionsState = {};
let connectorStatuses = {};
let activeConnectorId = null;
let obsidianConnectorState = { bridge: { vaults: [] }, loading: false, syncing: false };
const oauthPollIntervals = new Map();

function buildConnectorMonogram(name) {
  const tokens = String(name || '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) return '?';
  if (tokens.length === 1) return tokens[0].slice(0, 2).toUpperCase();
  return `${tokens[0][0]}${tokens[1][0]}`.toUpperCase();
}

function buildConnectorLogoMarkup(connector, size = 24, radius = 8) {
  const color = connector.color || '#4F46E5';
  const fontSize = Math.max(11, Math.floor(size * 0.45));
  return `
    <div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;border-radius:${radius}px;background:${color}18;color:${color};font-size:${fontSize}px;font-weight:700;letter-spacing:.04em">
      ${escHtml(buildConnectorMonogram(connector.name))}
    </div>
  `;
}

function normalizeCredentialInfo(item) {
  const authType = item?.setup?.authType || item?.state?.authType || 'none';
  if (authType !== 'oauth' && authType !== 'api_key') return null;

  return {
    type: authType === 'api_key' ? 'apikey' : 'oauth',
    fields: Array.isArray(item?.setup?.fields)
      ? item.setup.fields.map((field) => ({
          key: field.key,
          label: field.label,
          placeholder: field.placeholder || '',
          secret: !!field.secret,
        }))
      : [],
    docsUrl: item?.setup?.docsUrl || item?.docsUrl || '',
    docsHint: item?.setup?.docsHint || '',
  };
}

function normalizeConnectorCatalogItem(item) {
  const authType = item?.setup?.authType || item?.state?.authType || 'none';
  return {
    id: item.id,
    name: item.name,
    category: item.category || 'General',
    authType,
    color: item?.ui?.color || '#4F46E5',
    desc: item.description || '',
    permissions: Array.isArray(item?.ui?.permissions) ? item.ui.permissions : [],
    browserUrl: item?.setup?.browserLogin?.url || null,
    browserCheck: item?.setup?.browserLogin?.checkUrl || null,
    aiTools: Array.isArray(item?.ownership?.tools) ? item.ownership.tools : [],
    credInfo: normalizeCredentialInfo(item),
    state: item?.state || {},
  };
}

function setConnectorCatalog(items) {
  CONNECTORS = Array.isArray(items)
    ? items.map(normalizeConnectorCatalogItem).sort((a, b) => a.name.localeCompare(b.name))
    : [];
  window.CONNECTORS = CONNECTORS;
}

function syncConnectionMapsFromCatalog() {
  connectionsState = {};
  connectorStatuses = {};

  CONNECTORS.forEach((connector) => {
    const state = connector.state || {};
    if (state.connected) {
      connectionsState[connector.id] = {
        connected: true,
        connectedAt: state.connectedAt,
        authType: state.authType || connector.authType,
      };
    }

    connectorStatuses[connector.id] = {
      connected: !!state.connected,
      hasCredentials: !!state.hasCredentials,
      authType: state.authType || connector.authType,
    };
  });
}

function getConnectorById(id) {
  return CONNECTORS.find((connector) => connector.id === id) || null;
}

async function loadConnectionsState() {
  try {
    const data = await api(`${ENDPOINTS.EXTENSIONS_CATALOG}?kind=connector`);
    setConnectorCatalog(data?.items || []);
    syncConnectionMapsFromCatalog();
  } catch (e) {
    setConnectorCatalog([]);
    connectionsState = {};
    connectorStatuses = {};
    console.warn('[connections] Could not load catalog:', e?.message || e);
  }

  renderConnectionsGrid();
  updateConnectionsBadge();

  const connectorView = document.getElementById('connector-view');
  if (
    activeConnectorId &&
    connectorView &&
    connectorView.style.display !== 'none' &&
    getConnectorById(activeConnectorId)
  ) {
    openConnectorView(activeConnectorId);
  }
}

function updateConnectionsBadge() {
  const count = Object.values(connectionsState).filter((connection) => connection.connected).length;
  const badge = document.getElementById('connections-count-badge');
  if (badge) badge.textContent = count > 0 ? `${count} connected` : '';
}

function filterConnectors(query) {
  const q = String(query || '').toLowerCase().trim();
  const grid = document.getElementById('connections-grid');
  if (!grid) return;
  grid.querySelectorAll('.conn-card').forEach((card) => {
    const name = String(card.title || '').toLowerCase();
    card.style.display = !q || name.includes(q) ? '' : 'none';
  });
}

function renderConnectionsGrid() {
  const grid = document.getElementById('connections-grid');
  if (!grid) return;

  grid.innerHTML = '';
  const q = String(document.getElementById('connections-search')?.value || '')
    .toLowerCase()
    .trim();

  CONNECTORS.forEach((connector) => {
    const isConnected = !!connectionsState[connector.id]?.connected;
    const hasCreds = !!connectorStatuses[connector.id]?.hasCredentials;
    const needsCreds =
      connector.authType === 'oauth' && !isConnected && !hasCreds && !!connector.credInfo;

    const card = document.createElement('div');
    card.className = 'conn-card' + (isConnected ? ' connected' : '');
    card.title =
      connector.name +
      (isConnected ? ' - Connected' : needsCreds ? ' - Credentials needed' : '');
    card.style.position = 'relative';
    card.style.display =
      !q ||
      connector.name.toLowerCase().includes(q) ||
      connector.category.toLowerCase().includes(q)
        ? ''
        : 'none';
    card.innerHTML = `
      <div class="conn-card-logo">${buildConnectorLogoMarkup(connector, 24, 8)}</div>
      <div class="conn-card-name">${escHtml(connector.name)}</div>
      ${isConnected ? '<div style="width:7px;height:7px;border-radius:50%;background:var(--ok);position:absolute;top:8px;right:8px"></div>' : ''}
    `;
    card.onclick = () => openConnectorView(connector.id);
    grid.appendChild(card);
  });
}

function openConnectorView(id) {
  const connector = getConnectorById(id);
  if (!connector) return;

  activeConnectorId = id;
  const isConnected = !!connectionsState[id]?.connected;

  document.getElementById('cv-logo').innerHTML = buildConnectorLogoMarkup(connector, 36, 9);
  document.getElementById('cv-name').textContent = connector.name;
  document.getElementById('cv-category').textContent = connector.category;
  document.getElementById('cv-desc').textContent = connector.desc;

  const badge = document.getElementById('cv-status-badge');
  if (badge) badge.style.display = isConnected ? '' : 'none';

  const permsEl = document.getElementById('cv-permissions');
  if (permsEl) {
    permsEl.innerHTML = connector.permissions
      .map(
        (permission) => `
          <div class="cv-perm-row">
            <div class="cv-perm-icon" style="background:${connector.color}18;color:${connector.color}">${escHtml(permission.icon)}</div>
            <span>${escHtml(permission.label)}</span>
          </div>
        `,
      )
      .join('');
  }

  const aiToolsEl = document.getElementById('cv-ai-tools');
  if (aiToolsEl) {
    const tools = connector.aiTools || [];
    if (tools.length && isConnected) {
      aiToolsEl.style.display = '';
      aiToolsEl.innerHTML = `
        <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">AI Tools Unlocked</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px">
          ${tools.map((tool) => `<code style="font-size:10.5px;background:var(--panel-2);border:1px solid var(--line);border-radius:5px;padding:2px 7px;color:var(--text-2)">${escHtml(tool)}</code>`).join('')}
        </div>
        <div style="font-size:11px;color:var(--muted);margin-top:8px">Activate with <code style="font-size:10.5px">request_tool_category({"category":"external_apps"})</code></div>
      `;
    } else if (tools.length) {
      aiToolsEl.style.display = '';
      aiToolsEl.innerHTML = `
        <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">AI Tools (connect to unlock)</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px;opacity:0.45">
          ${tools.map((tool) => `<code style="font-size:10.5px;background:var(--panel-2);border:1px solid var(--line);border-radius:5px;padding:2px 7px;color:var(--text-2)">${escHtml(tool)}</code>`).join('')}
        </div>
      `;
    } else {
      aiToolsEl.style.display = 'none';
      aiToolsEl.innerHTML = '';
    }
  }

  renderConnectorActions(connector, isConnected);
  loadConnectorActivity(id, isConnected);

  const view = document.getElementById('connector-view');
  if (view) view.style.display = 'flex';
  const chatView = document.getElementById('chat-view');
  if (chatView) chatView.style.display = 'none';
  const topbar = document.getElementById('right-panel-topbar');
  if (topbar) topbar.style.visibility = 'hidden';
}

function closeConnectorView() {
  const connectorView = document.getElementById('connector-view');
  if (connectorView) connectorView.style.display = 'none';
  const chatView = document.getElementById('chat-view');
  if (chatView) chatView.style.display = 'flex';
  const topbar = document.getElementById('right-panel-topbar');
  if (topbar) topbar.style.visibility = '';
  activeConnectorId = null;
}

function renderObsidianVaultList() {
  const vaults = obsidianConnectorState.bridge?.vaults || [];
  if (obsidianConnectorState.loading) {
    return '<div style="font-size:12px;color:var(--muted);padding:8px 0">Loading vaults...</div>';
  }
  if (!vaults.length) {
    return '<div style="font-size:12px;color:var(--muted);padding:8px 0;line-height:1.5">No vaults connected. Paste a local vault path to enable the Obsidian connector.</div>';
  }
  return vaults
    .map((vault) => {
      const lastSync = vault.lastSyncedAt ? new Date(vault.lastSyncedAt).toLocaleString() : 'Never synced';
      return `
        <div style="border:1px solid var(--line);border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:8px;background:var(--panel-2)">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
            <div style="min-width:0">
              <div style="font-size:13px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(vault.name || 'Obsidian Vault')}</div>
              <div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(vault.path || '')}</div>
            </div>
            <span style="font-size:10.5px;color:${vault.enabled === false ? 'var(--muted)' : 'var(--ok)'};font-weight:700">${vault.enabled === false ? 'Paused' : 'Active'}</span>
          </div>
          <div style="font-size:11px;color:var(--muted)">Mode: ${escHtml(vault.mode || 'read_only')} - ${escHtml(lastSync)}</div>
          <div style="display:flex;gap:7px;flex-wrap:wrap">
            <button class="cv-btn-connect" style="padding:7px 10px;font-size:11.5px" onclick="syncObsidianConnectorVault('${escHtml(vault.id)}')">Sync</button>
            <button class="cv-btn-disconnect" style="padding:7px 10px;font-size:11.5px" onclick="removeObsidianConnectorVault('${escHtml(vault.id)}')">Remove</button>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderObsidianConnectorActions(connector, isConnected) {
  const el = document.getElementById('cv-actions');
  if (!el) return;
  const disableText = obsidianConnectorState.syncing ? 'Syncing...' : 'Sync All Vaults';
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;flex-direction:column;gap:9px">
        <label style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Vault path</label>
        <input id="obsidian-connector-path" type="text" placeholder="C:\\Users\\you\\Documents\\Obsidian Vault" style="width:100%;box-sizing:border-box;padding:9px 11px;border-radius:7px;border:1px solid var(--line);background:var(--panel);color:var(--text);font-size:13px;outline:none" />
        <div style="display:grid;grid-template-columns:1fr 120px;gap:8px">
          <input id="obsidian-connector-name" type="text" placeholder="Display name" style="min-width:0;padding:9px 11px;border-radius:7px;border:1px solid var(--line);background:var(--panel);color:var(--text);font-size:13px;outline:none" />
          <select id="obsidian-connector-mode" style="min-width:0;padding:9px 8px;border-radius:7px;border:1px solid var(--line);background:var(--panel);color:var(--text);font-size:12px;outline:none">
            <option value="read_only">Read-only</option>
            <option value="assisted">Assisted</option>
            <option value="full">Full</option>
          </select>
        </div>
        <button class="cv-btn-connect" onclick="connectObsidianConnectorVault()">
          Connect Vault
        </button>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">Vaults</div>
        <button class="cv-btn-connect" style="padding:7px 10px;font-size:11.5px" onclick="syncObsidianConnectorVault('')" ${obsidianConnectorState.syncing ? 'disabled' : ''}>${disableText}</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">${renderObsidianVaultList()}</div>
      ${isConnected ? `<button class="cv-btn-disconnect" onclick="disconnectConnector('${connector.id}')">Disconnect Obsidian</button>` : ''}
    </div>
  `;
}

async function loadObsidianConnectorState() {
  obsidianConnectorState.loading = true;
  if (activeConnectorId === 'obsidian') renderObsidianConnectorActions(getConnectorById('obsidian'), !!connectionsState.obsidian?.connected);
  try {
    const data = await api(ENDPOINTS.OBSIDIAN_STATUS);
    obsidianConnectorState.bridge = data?.bridge || { vaults: [] };
  } catch (e) {
    showToast('Obsidian unavailable', e.message || 'Could not load vault status.', 'error');
  } finally {
    obsidianConnectorState.loading = false;
    if (activeConnectorId === 'obsidian') renderObsidianConnectorActions(getConnectorById('obsidian'), !!connectionsState.obsidian?.connected);
  }
}

async function connectObsidianConnectorVault() {
  const vaultPath = String(document.getElementById('obsidian-connector-path')?.value || '').trim();
  const name = String(document.getElementById('obsidian-connector-name')?.value || '').trim();
  const mode = String(document.getElementById('obsidian-connector-mode')?.value || 'read_only');
  if (!vaultPath) {
    showToast('Vault path required', 'Paste the absolute path to a local Obsidian vault.', 'warning');
    return;
  }
  try {
    const data = await api(ENDPOINTS.OBSIDIAN_VAULTS, {
      method: 'POST',
      timeoutMs: 120000,
      body: JSON.stringify({ path: vaultPath, name, mode, syncNow: true }),
    });
    obsidianConnectorState.bridge = data?.bridge || { vaults: [] };
    await loadConnectionsState();
    openConnectorView('obsidian');
    showToast('Obsidian connected', 'Vault notes are now available through the Obsidian connector.', 'success');
  } catch (e) {
    showToast('Connect failed', e.message || 'Could not connect vault.', 'error');
  }
}

async function syncObsidianConnectorVault(vaultId = '') {
  obsidianConnectorState.syncing = true;
  renderObsidianConnectorActions(getConnectorById('obsidian'), !!connectionsState.obsidian?.connected);
  try {
    const data = await api(ENDPOINTS.OBSIDIAN_SYNC, {
      method: 'POST',
      timeoutMs: 180000,
      body: JSON.stringify({ vaultId, force: true }),
    });
    obsidianConnectorState.bridge = data?.bridge || { vaults: [] };
    const sync = data?.sync || {};
    showToast('Obsidian synced', `${sync.indexed || 0} indexed, ${sync.removed || 0} removed.`, 'success');
  } catch (e) {
    showToast('Sync failed', e.message || 'Could not sync Obsidian.', 'error');
  } finally {
    obsidianConnectorState.syncing = false;
    await loadConnectionsState();
    if (activeConnectorId === 'obsidian') openConnectorView('obsidian');
  }
}

async function removeObsidianConnectorVault(vaultId) {
  if (!confirm('Remove this vault from the Obsidian connector? Indexed mirror notes will be removed from Prometheus memory.')) return;
  try {
    const data = await api(ENDPOINTS.obsidianVault(vaultId), { method: 'DELETE' });
    obsidianConnectorState.bridge = data?.bridge || { vaults: [] };
    await loadConnectionsState();
    openConnectorView('obsidian');
    showToast('Vault removed', 'The vault was disconnected.', 'success');
  } catch (e) {
    showToast('Remove failed', e.message || 'Could not remove vault.', 'error');
  }
}

function renderConnectorActions(connector, isConnected) {
  const el = document.getElementById('cv-actions');
  if (!el) return;

  if (connector.id === 'obsidian') {
    renderObsidianConnectorActions(connector, isConnected);
    if (!obsidianConnectorState.loading) loadObsidianConnectorState().catch(() => {});
    return;
  }

  if (isConnected) {
    const connectedAt = connectionsState[connector.id]?.connectedAt;
    const whenStr = connectedAt
      ? new Date(connectedAt).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : '';

    el.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px">
        ${whenStr ? `<div style="font-size:11.5px;color:var(--muted)">Connected ${escHtml(whenStr)}</div>` : ''}
        <button class="cv-btn-disconnect" onclick="disconnectConnector('${connector.id}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          Disconnect ${escHtml(connector.name)}
        </button>
      </div>
    `;
    return;
  }

  const hasCreds = !!connectorStatuses[connector.id]?.hasCredentials;

  if (connector.authType === 'oauth') {
    if (hasCreds) {
      el.innerHTML = `
        <button class="cv-btn-connect" onclick="startOAuthFlow('${connector.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
          Authorize ${escHtml(connector.name)}
        </button>
        <div style="font-size:11px;color:var(--muted);text-align:center">Opens a popup to authorize Prometheus in your ${escHtml(connector.name)} account.</div>
        <div style="font-size:11px;color:var(--muted);text-align:center;cursor:pointer;text-decoration:underline" onclick="renderCredentialForm('${connector.id}')">Update credentials</div>
      `;
    } else {
      renderCredentialForm(connector.id);
    }
    return;
  }

  if (connector.authType === 'api_key') {
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:10px">
        <button class="cv-btn-connect" onclick="renderCredentialForm('${connector.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 2l-2 2"/><path d="M7.5 20.5l-5-5 12-12 5 5z"/><path d="M16 5l3 3"/></svg>
          ${hasCreds ? `Update ${escHtml(connector.name)} Credentials` : `Add ${escHtml(connector.name)} Credentials`}
        </button>
        <div style="font-size:11px;color:var(--muted);text-align:center">
          ${hasCreds ? 'Secure credentials are saved. Update them here if needed.' : 'Save an API key or token to connect this integration.'}
        </div>
      </div>
    `;
    return;
  }

  if (connector.authType === 'browser_session') {
    el.innerHTML = `
      <div id="browser-login-wrap-${connector.id}" style="display:flex;flex-direction:column;gap:10px">
        <button class="cv-btn-connect" id="btn-browser-open-${connector.id}" onclick="startBrowserLogin('${connector.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          Open ${escHtml(connector.name)} Login
        </button>
        <div id="browser-login-instructions-${connector.id}" style="display:none;background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:14px;font-size:12.5px;color:var(--text);line-height:1.7">
          <div style="font-weight:700;margin-bottom:6px">Log in to ${escHtml(connector.name)} in the Prometheus browser window.</div>
          <ol style="margin:0;padding-left:18px;color:var(--muted)">
            <li>Enter your ${escHtml(connector.name)} credentials in the browser</li>
            <li>Complete any 2FA steps</li>
            <li>Once you are fully logged in, close the tab</li>
            <li>Come back here and click Verify Login</li>
          </ol>
        </div>
        <button class="cv-btn-connect" id="btn-verify-login-${connector.id}" style="display:none;background:var(--ok)" onclick="verifyBrowserLogin('${connector.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          Verify Login
        </button>
        <div id="verify-status-${connector.id}" style="font-size:11px;color:var(--muted);text-align:center;display:none"></div>
      </div>
    `;
    return;
  }

  el.innerHTML = '<div style="font-size:12px;color:var(--muted)">No setup flow is available for this connector yet.</div>';
}

async function startOAuthFlow(id) {
  const connector = getConnectorById(id);
  if (!connector || connector.authType !== 'oauth') return;

  const btn = document.querySelector('#cv-actions .cv-btn-connect');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Opening...';
  }

  try {
    const res = await api(ENDPOINTS.CONNECTIONS_OAUTH_START, {
      method: 'POST',
      body: JSON.stringify({ id }),
    });

    if (res?.needsCredentials || res?.needsSetup) {
      renderCredentialForm(id, null, res?.message || 'Credentials are required before authorization.');
      return;
    }

    if (res?.url) {
      window.open(res.url, '_blank', 'width=600,height=700');
      renderOAuthWaiting(id);
      pollOAuthCompletion(id);
      return;
    }

    renderCredentialForm(id, null, res?.error || 'OAuth failed to start.');
  } catch (e) {
    renderCredentialForm(id, null, e.message);
    console.warn('[oauth]', e.message);
  }
}

function renderOAuthWaiting(id) {
  const connector = getConnectorById(id);
  const el = document.getElementById('cv-actions');
  if (!el || !connector) return;

  el.innerHTML = `
    <div style="background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:12px;height:12px;border-radius:50%;background:var(--brand);animation:pulse 1.2s infinite"></div>
        <div style="font-size:13px;font-weight:700;color:var(--text)">Waiting for authorization...</div>
      </div>
      <div style="font-size:12px;color:var(--muted);line-height:1.6">
        Complete the ${escHtml(connector.name)} login in the popup window. This panel will refresh automatically when it finishes.
      </div>
      <button class="cv-btn-disconnect" onclick="cancelOAuthPolling('${id}')" style="width:fit-content">Cancel</button>
    </div>
  `;
}

function renderOAuthManualFallback(id, connectorOverride = null, errorMsg = '') {
  const connector = connectorOverride || getConnectorById(id);
  const el = document.getElementById('cv-actions');
  if (!el || !connector) return;

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px;background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:14px">
      <div style="font-size:13px;font-weight:700;color:var(--text)">Authorization still pending</div>
      <div style="font-size:11.5px;color:var(--muted);line-height:1.6">
        We did not detect the OAuth completion automatically. If you already approved access, try again or refresh the connector status.
      </div>
      ${errorMsg ? `<div style="font-size:11.5px;color:var(--err)">${escHtml(errorMsg)}</div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="cv-btn-connect" onclick="startOAuthFlow('${connector.id}')">Retry Authorization</button>
        <button class="cv-btn-disconnect" onclick="renderCredentialForm('${connector.id}')">Update Credentials</button>
      </div>
    </div>
  `;
}

function renderCredentialForm(id, connectorOverride = null, errorMsg = '') {
  const connector = connectorOverride || getConnectorById(id);
  const el = document.getElementById('cv-actions');
  if (!el || !connector) return;

  const info = connector.credInfo;
  if (!info) {
    el.innerHTML = `<div style="font-size:12px;color:var(--err)">No credential configuration found for ${escHtml(connector.name)}.</div>`;
    return;
  }

  const isApiKey = info.type === 'apikey';
  const inputsHtml = info.fields
    .map(
      (field) => `
        <div style="display:flex;flex-direction:column;gap:5px">
          <label style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">${escHtml(field.label)}</label>
          <input
            id="cred-input-${id}-${field.key}"
            type="${field.secret ? 'password' : 'text'}"
            placeholder="${escHtml(field.placeholder || '')}"
            autocomplete="off"
            style="width:100%;box-sizing:border-box;padding:9px 11px;border-radius:7px;border:1px solid var(--line);background:var(--panel);color:var(--text);font-size:13px;outline:none;transition:border .15s"
            onfocus="this.style.borderColor='var(--brand)'"
            onblur="this.style.borderColor='var(--line)'"
            onkeydown="if(event.key==='Enter')saveConnectorCredentials('${id}')"
          />
        </div>
      `,
    )
    .join('');

  const primaryLabel = isApiKey ? `Save ${connector.name} Credentials` : 'Save and Authorize';
  const docsLink = info.docsUrl
    ? `
        <a href="${info.docsUrl}" target="_blank" rel="noopener" style="font-size:11.5px;color:var(--brand);text-decoration:none;display:inline-flex;align-items:center;gap:4px">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          Get credentials ->
        </a>
      `
    : '';

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;flex-direction:column;gap:4px">
        <div style="font-size:13px;font-weight:700;color:var(--text)">Enter ${escHtml(connector.name)} credentials</div>
        ${info.docsHint ? `<div style="font-size:11.5px;color:var(--muted);line-height:1.6">${escHtml(info.docsHint)}</div>` : ''}
        ${docsLink}
      </div>
      ${errorMsg ? `<div style="font-size:12px;color:var(--err);background:rgba(224,109,109,.1);border:1px solid rgba(224,109,109,.25);border-radius:7px;padding:9px 12px">${escHtml(errorMsg)}</div>` : ''}
      ${inputsHtml}
      <div style="display:flex;gap:8px">
        <button id="cred-save-btn-${id}" class="cv-btn-connect" onclick="saveConnectorCredentials('${id}')" style="flex:1">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          ${escHtml(primaryLabel)}
        </button>
        <button onclick="openConnectorView('${id}')" style="padding:0 14px;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--muted);font-size:12px;cursor:pointer">Cancel</button>
      </div>
      <div id="cred-status-${id}" style="display:none;font-size:11.5px;text-align:center;color:var(--muted)"></div>
    </div>
  `;
}

async function saveConnectorCredentials(id) {
  const connector = getConnectorById(id);
  const info = connector?.credInfo;
  if (!connector || !info) return;

  const btn = document.getElementById(`cred-save-btn-${id}`);
  const statusEl = document.getElementById(`cred-status-${id}`);

  const body = { id };
  let valid = true;
  info.fields.forEach((field) => {
    const inputEl = document.getElementById(`cred-input-${id}-${field.key}`);
    const value = inputEl?.value?.trim() || '';
    if (!value) {
      if (inputEl) inputEl.style.borderColor = 'var(--err)';
      valid = false;
      return;
    }

    if (inputEl) inputEl.style.borderColor = 'var(--line)';
    body[field.key] = value;
  });

  if (!valid) return;

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }
  if (statusEl) {
    statusEl.style.display = '';
    statusEl.textContent = 'Saving credentials...';
    statusEl.style.color = 'var(--muted)';
  }

  try {
    await api(ENDPOINTS.CONNECTIONS_CREDENTIALS, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = connector.authType === 'api_key' ? 'Save Credentials' : 'Save and Authorize';
    }
    if (statusEl) {
      statusEl.textContent = 'Failed to save: ' + e.message;
      statusEl.style.color = 'var(--err)';
    }
    return;
  }

  if (info.type === 'apikey') {
    if (statusEl) statusEl.textContent = 'Credentials saved. Finalizing connection...';
    try {
      await api(ENDPOINTS.CONNECTIONS_SAVE, {
        method: 'POST',
        body: JSON.stringify({ id, authType: 'api_key', verified: true }),
      });
      await loadConnectionsState();
      openConnectorView(id);
      showToast('Connected!', `${connector.name} connected successfully.`, 'success');
    } catch (e) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save Credentials';
      }
      if (statusEl) {
        statusEl.textContent = 'Error: ' + e.message;
        statusEl.style.color = 'var(--err)';
      }
    }
    return;
  }

  if (statusEl) statusEl.textContent = 'Credentials saved. Opening authorization...';
  try {
    const res = await api(ENDPOINTS.CONNECTIONS_OAUTH_START, {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
    if (res?.url) {
      window.open(res.url, '_blank', 'width=600,height=700');
      renderOAuthWaiting(id);
      pollOAuthCompletion(id);
      return;
    }

    renderCredentialForm(id, null, res?.error || 'OAuth failed to start. Check your credentials and try again.');
  } catch (e) {
    renderCredentialForm(id, null, 'OAuth error: ' + e.message);
  }
}

function pollOAuthCompletion(id) {
  stopOAuthPolling(id);
  let attempts = 0;
  const interval = setInterval(async () => {
    attempts += 1;
    if (attempts > 120) {
      clearInterval(interval);
      oauthPollIntervals.delete(id);
      renderOAuthManualFallback(id);
      return;
    }

    try {
      const data = await api(
        `${ENDPOINTS.CONNECTIONS_OAUTH_POLL}?id=${encodeURIComponent(id)}`,
      );
      if (data?.pending !== false) return;

      clearInterval(interval);
      oauthPollIntervals.delete(id);
      if (data.success) {
        await loadConnectionsState();
        openConnectorView(id);
        showToast('Connected!', `${getConnectorById(id)?.name || id} connected successfully.`, 'success');
      } else {
        renderOAuthManualFallback(id, null, data.error || 'OAuth did not complete.');
        showToast('Connection failed', data.error || 'OAuth did not complete.', 'error');
      }
    } catch {
      // keep polling quietly
    }
  }, 2000);
  oauthPollIntervals.set(id, interval);
}

function stopOAuthPolling(id) {
  const interval = oauthPollIntervals.get(id);
  if (interval) clearInterval(interval);
  oauthPollIntervals.delete(id);
}

function cancelOAuthPolling(id) {
  stopOAuthPolling(id);
  openConnectorView(id);
}

async function startBrowserLogin(id) {
  const connector = getConnectorById(id);
  if (!connector?.browserUrl) return;

  try {
    await api(ENDPOINTS.CONNECTIONS_BROWSER_OPEN, {
      method: 'POST',
      body: JSON.stringify({ id, url: connector.browserUrl }),
    });
  } catch {
    // best effort; the instructions are still useful even if opening fails
  }

  const instructions = document.getElementById(`browser-login-instructions-${id}`);
  const verifyBtn = document.getElementById(`btn-verify-login-${id}`);
  const openBtn = document.getElementById(`btn-browser-open-${id}`);
  if (instructions) instructions.style.display = '';
  if (verifyBtn) verifyBtn.style.display = 'flex';
  if (openBtn) openBtn.textContent = 'Re-open Login Page';
}

async function verifyBrowserLogin(id) {
  const connector = getConnectorById(id);
  if (!connector) return;

  const statusEl = document.getElementById(`verify-status-${id}`);
  const btn = document.getElementById(`btn-verify-login-${id}`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Verifying...';
  }
  if (statusEl) {
    statusEl.style.display = '';
    statusEl.textContent = 'Checking browser session...';
  }

  try {
    const res = await api(ENDPOINTS.CONNECTIONS_BROWSER_VERIFY, {
      method: 'POST',
      body: JSON.stringify({ id, checkUrl: connector.browserCheck }),
    });

    if (res?.verified) {
      await api(ENDPOINTS.CONNECTIONS_SAVE, {
        method: 'POST',
        body: JSON.stringify({ id, authType: 'browser_session', verified: true }),
      });
      await loadConnectionsState();
      openConnectorView(id);
      showToast('Connected!', `${connector.name} connected via browser session.`, 'success');
      return;
    }

    if (statusEl) {
      statusEl.style.color = 'var(--err)';
      statusEl.textContent =
        res?.message || 'Login not detected. Please finish the login and try again.';
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Verify Login';
    }
  } catch (e) {
    if (statusEl) {
      statusEl.style.color = 'var(--err)';
      statusEl.textContent = 'Verification failed: ' + e.message;
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Verify Login';
    }
  }
}

async function disconnectConnector(id) {
  if (!confirm('Disconnect this connector? Prometheus will lose access until you reconnect.')) return;

  try {
    await api(ENDPOINTS.CONNECTIONS_DISCONNECT, {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
    await loadConnectionsState();
    openConnectorView(id);
    showToast('Disconnected', 'Connector removed successfully.', 'success');
  } catch (e) {
    showToast('Error', 'Could not disconnect: ' + e.message, 'error');
  }
}

async function loadConnectorActivity(id, isConnected) {
  const wrap = document.getElementById('cv-activity-wrap');
  const list = document.getElementById('cv-activity-list');
  const empty = document.getElementById('cv-activity-empty');
  const countEl = document.getElementById('cv-activity-count');

  if (!wrap || !list || !empty || !countEl) return;

  if (!isConnected) {
    wrap.style.display = 'none';
    return;
  }

  wrap.style.display = '';
  list.innerHTML =
    '<div style="font-size:11px;color:var(--muted);padding:4px 0">Loading activity...</div>';
  empty.style.display = 'none';

  try {
    const data = await api(
      `${ENDPOINTS.CONNECTIONS_ACTIVITY}?id=${encodeURIComponent(id)}&limit=50`,
    );
    const entries = data?.entries || [];
    countEl.textContent = entries.length ? `${entries.length} events` : '';

    if (entries.length === 0) {
      list.innerHTML = '';
      empty.style.display = '';
      return;
    }

    list.innerHTML = entries
      .map((entry) => {
        const dir = entry.direction === 'in' ? 'IN' : 'OUT';
        const dirClass = entry.direction === 'in' ? 'in' : 'out';
        const time = new Date(entry.timestamp).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
        return `
          <div class="cv-activity-row">
            <span class="cv-activity-dir ${dirClass}">${dir}</span>
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(entry.title || entry.action || '')}</div>
              <div style="color:var(--muted);font-size:10.5px;margin-top:1px">${escHtml(time)}${entry.summary ? ' - ' + escHtml(String(entry.summary).slice(0, 80)) : ''}</div>
            </div>
          </div>
        `;
      })
      .join('');
    empty.style.display = 'none';
  } catch {
    list.innerHTML = '';
    empty.style.display = '';
    empty.textContent = 'Could not load activity log.';
  }
}

const escapeHtml = escHtml;

loadConnectionsState();

window.loadConnectionsState = loadConnectionsState;
window.updateConnectionsBadge = updateConnectionsBadge;
window.filterConnectors = filterConnectors;
window.renderConnectionsGrid = renderConnectionsGrid;
window.openConnectorView = openConnectorView;
window.closeConnectorView = closeConnectorView;
window.renderConnectorActions = renderConnectorActions;
window.renderCredentialForm = renderCredentialForm;
window.saveConnectorCredentials = saveConnectorCredentials;
window.startOAuthFlow = startOAuthFlow;
window.renderOAuthWaiting = renderOAuthWaiting;
window.renderOAuthManualFallback = renderOAuthManualFallback;
window.pollOAuthCompletion = pollOAuthCompletion;
window.cancelOAuthPolling = cancelOAuthPolling;
window.startBrowserLogin = startBrowserLogin;
window.verifyBrowserLogin = verifyBrowserLogin;
window.disconnectConnector = disconnectConnector;
window.loadConnectorActivity = loadConnectorActivity;
window.loadObsidianConnectorState = loadObsidianConnectorState;
window.connectObsidianConnectorVault = connectObsidianConnectorVault;
window.syncObsidianConnectorVault = syncObsidianConnectorVault;
window.removeObsidianConnectorVault = removeObsidianConnectorVault;
window.escapeHtml = escapeHtml;
window.CONNECTORS = CONNECTORS;
