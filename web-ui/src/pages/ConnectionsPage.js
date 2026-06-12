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
          required: field.required !== false,
          help: field.help || '',
        }))
      : [],
    docsUrl: item?.setup?.docsUrl || item?.docsUrl || '',
    docsHint: item?.setup?.docsHint || '',
  };
}

function normalizeConnectorCatalogItem(item) {
  const authType = item?.setup?.authType || item?.state?.authType || 'none';
  const trustLevel = item?.trustLevel || 'bundled';
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
    trustLevel,
    isUserPlugin: trustLevel === 'third_party' || trustLevel === 'local' || trustLevel === 'marketplace',
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
  loadMcpServers();

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
      ${connector.isUserPlugin ? '<div title="Custom plugin" style="position:absolute;top:6px;left:6px;font-size:8px;font-weight:800;color:var(--brand);background:var(--panel-2);border:1px solid var(--line);border-radius:4px;padding:1px 4px;letter-spacing:.04em">CUSTOM</div>' : ''}
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
  if (connector.isUserPlugin) {
    const actionsEl = document.getElementById('cv-actions');
    if (actionsEl) {
      actionsEl.insertAdjacentHTML(
        'beforeend',
        `<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line)">
          <div style="font-size:11px;color:var(--muted);margin-bottom:8px">This is a custom plugin you (or Prometheus) added.</div>
          <button class="cv-btn-disconnect" onclick="removeUserPlugin('${escHtml(id)}')">Remove plugin</button>
        </div>`,
      );
    }
  }
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

  if (connector.id === 'x') {
    renderXConnectorActions(connector, isConnected);
    return;
  }

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

function renderXConnectorActions(connector, isConnected) {
  const el = document.getElementById('cv-actions');
  if (!el) return;
  const tokenSource = connector.state?.tokenSource || connectorStatuses.x?.tokenSource || connectionsState.x?.authType || '';
  const hasAppCredentials = !!connector.state?.hasCredentials || !!connectorStatuses.x?.hasCredentials;
  const sourceLabel = tokenSource === 'x_api_oauth'
    ? (connector.state?.username ? `X OAuth @${connector.state.username}` : 'X OAuth user context')
    : tokenSource === 'xurl'
      ? (connector.state?.username ? `xurl @${connector.state.username}` : 'xurl OAuth user context')
    : tokenSource === 'browser_session'
      ? 'Browser session'
      : hasAppCredentials
        ? 'App credentials saved'
        : 'Not connected';

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div style="background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:7px">
        <div style="font-size:12px;font-weight:700;color:var(--text)">X API credentials</div>
        <div style="font-size:11.5px;color:var(--muted);line-height:1.55">
          Status: <strong style="color:${isConnected ? 'var(--ok)' : 'var(--muted)'}">${escHtml(sourceLabel)}</strong>.
          X API tools require X OAuth 2.0 user context. xAI/Grok Settings remain separate for models, x_search, TTS, and STT.
        </div>
        ${connector.state?.redirectUri ? `<div style="font-size:11px;color:var(--muted);line-height:1.5">Redirect URI: <code style="font-size:10.5px">${escHtml(connector.state.redirectUri)}</code></div>` : ''}
      </div>
      <button class="cv-btn-connect" onclick="startOAuthFlow('x')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
        Connect with X OAuth
      </button>
      <button class="cv-btn-connect" onclick="startXurlSetup('x')" style="background:var(--panel-2);color:var(--text);border:1px solid var(--line)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M4 17l6-6-6-6"/><path d="M12 19h8"/></svg>
        Advanced: xurl Setup
      </button>
      <button class="cv-btn-connect" onclick="renderCredentialForm('x')" style="background:#111827">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 2l-2 2"/><path d="M7.5 20.5l-5-5 12-12 5 5z"/><path d="M16 5l3 3"/></svg>
        ${hasAppCredentials ? 'Update X App Credentials' : 'Add X App Credentials'}
      </button>
      ${connector.browserUrl ? `<button class="cv-btn-connect" onclick="startBrowserLogin('x')" style="background:var(--panel-2);color:var(--text);border:1px solid var(--line)">
        Open X Browser Login
      </button>` : ''}
      ${(isConnected || hasAppCredentials) ? `<button class="cv-btn-disconnect" onclick="disconnectConnector('x')">Disconnect X API</button>` : ''}
      <div id="browser-login-instructions-x" style="display:none;background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:14px;font-size:12.5px;color:var(--text);line-height:1.7">
        Log in to X in the Prometheus browser window, then come back and verify the browser session.
      </div>
      <button class="cv-btn-connect" id="btn-verify-login-x" style="display:none;background:var(--ok)" onclick="verifyBrowserLogin('x')">Verify Browser Login</button>
      <div id="verify-status-x" style="font-size:11px;color:var(--muted);text-align:center;display:none"></div>
    </div>
  `;
}

async function startXurlSetup(id) {
  const connector = getConnectorById(id);
  if (!connector || id !== 'x') return;
  const hasAppCredentials = !!connector.state?.hasCredentials || !!connectorStatuses.x?.hasCredentials;
  if (!hasAppCredentials) {
    renderCredentialForm('x', null, 'Save the X OAuth 2.0 Client ID/Secret first, then Prometheus can run xurl setup.');
    return;
  }

  const el = document.getElementById('cv-actions');
  if (el) {
    el.innerHTML = `
      <div style="background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:10px">
        <div style="font-size:13px;font-weight:700;color:var(--text)">Running xurl setup...</div>
        <div id="xurl-setup-status" style="font-size:11.5px;color:var(--muted);line-height:1.6">Starting xurl commands. Approve the browser login when it opens.</div>
        <pre id="xurl-setup-output" style="margin:0;white-space:pre-wrap;font-size:10.5px;line-height:1.45;color:var(--muted);background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px;max-height:180px;overflow:auto"></pre>
      </div>
    `;
  }

  try {
    const res = await api(ENDPOINTS.CONNECTIONS_XURL_SETUP, {
      method: 'POST',
      body: JSON.stringify({ id: 'x', appName: 'prometheus' }),
    });
    renderXurlSetupState(res?.state || res);
    pollXurlSetup();
  } catch (e) {
    renderCredentialForm('x', null, e.message);
  }
}

function renderXurlSetupState(state) {
  const status = document.getElementById('xurl-setup-status');
  const output = document.getElementById('xurl-setup-output');
  if (status) {
    status.style.color = state?.success === false ? 'var(--err)' : state?.success ? 'var(--ok)' : 'var(--muted)';
    status.textContent = state?.pending
      ? (state.step || 'Running xurl setup...')
      : state?.success
        ? `xurl connected${state.username ? ` as @${state.username}` : ''}.`
        : (state?.error || 'xurl setup failed.');
  }
  if (output) {
    output.textContent = Array.isArray(state?.output) ? state.output.join('\n\n') : '';
  }
}

async function pollXurlSetup() {
  try {
    const state = await api(ENDPOINTS.CONNECTIONS_XURL_POLL);
    renderXurlSetupState(state);
    if (state?.pending) {
      setTimeout(pollXurlSetup, 2000);
      return;
    }
    if (state?.success) {
      await loadConnectionsState();
      openConnectorView('x');
      showToast('X connected', 'xurl authenticated and verified the X account.', 'success');
    }
  } catch (e) {
    renderXurlSetupState({ pending: false, success: false, error: e.message, output: [] });
  }
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
          ${field.help ? `<div style="font-size:10.8px;color:var(--muted);line-height:1.45">${escHtml(field.help)}</div>` : ''}
        </div>
      `,
    )
    .join('');

  const primaryLabel = connector.id === 'x'
    ? 'Save X App and Authorize'
    : isApiKey ? `Save ${connector.name} Credentials` : 'Save and Authorize';
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
        ${connector.id === 'x' ? `<div style="font-size:11.5px;color:var(--muted);line-height:1.6;background:rgba(255,106,0,.08);border:1px solid rgba(255,106,0,.18);border-radius:8px;padding:9px 11px">Use the OAuth 2.0 Client ID from X Developer Portal, not the API Key / Consumer Key. Add <code style="font-size:10.5px">http://localhost:8080/callback</code> to the app callback URLs, or enter the exact callback you configured below.</div>` : ''}
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
    const optional = field.required === false || (id === 'x' && field.key === 'bearerToken');
    if (!value) {
      if (optional) {
        body[field.key] = '';
        return;
      }
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

  if (id === 'x') {
    if (statusEl) statusEl.textContent = 'Credentials saved. Running xurl setup...';
    await loadConnectionsState();
    startXurlSetup('x');
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

// ──────────────────────────────────────────────────────────────────────────
// MCP Servers section — lists servers from /api/mcp/servers (the same store
// `mcp_server_manage` writes to), so MCP servers Prometheus adds show up here in
// the Connections panel, not just buried in Settings.
// ──────────────────────────────────────────────────────────────────────────

let mcpServers = [];

async function loadMcpServers() {
  try {
    const data = await api('/api/mcp/servers');
    mcpServers = Array.isArray(data?.servers) ? data.servers : [];
  } catch {
    mcpServers = [];
  }
  renderMcpServers();
}

function mcpServerById(id) {
  return mcpServers.find((s) => s.id === id);
}

function mcpStatusMeta(s) {
  const color = s.status === 'connected' ? 'var(--ok)' : s.status === 'error' ? '#ef4444' : s.status === 'connecting' ? '#f59e0b' : 'var(--muted)';
  const label = s.status === 'connected' ? `Connected · ${s.toolCount || 0} tool${s.toolCount === 1 ? '' : 's'}`
    : s.status === 'error' ? 'Error' : s.status === 'connecting' ? 'Connecting…' : 'Disconnected';
  const needsAuth = s.status === 'error' && /401|403|unauthor|forbidden/i.test(String(s.error || ''));
  return { color, label, needsAuth };
}

function renderMcpServers() {
  const section = document.getElementById('mcp-servers-section');
  const list = document.getElementById('mcp-servers-list');
  const count = document.getElementById('mcp-servers-count');
  if (!section || !list) return;
  if (!mcpServers.length) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  if (count) count.textContent = `${mcpServers.length}`;
  // Cards mirror connector cards: click opens the full detail view (instructions,
  // auth form, quick buttons). No inline prompt.
  list.innerHTML = mcpServers.map((s) => {
    const { color, label } = mcpStatusMeta(s);
    return `<div onclick="openMcpServerView('${escHtml(s.id)}')" style="display:flex;align-items:center;gap:9px;padding:9px 10px;border:1px solid var(--line);border-radius:9px;margin-bottom:6px;background:var(--panel-2);cursor:pointer;transition:border-color .12s" onmouseover="this.style.borderColor='var(--brand)'" onmouseout="this.style.borderColor='var(--line)'">
      <div style="width:9px;height:9px;border-radius:50%;background:${color};flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(s.name || s.id)}</div>
        <div style="font-size:10.5px;color:${color};margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${label}</div>
      </div>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
    </div>`;
  }).join('');
}

// Full detail view for an MCP server — reuses the connector detail panel so it
// looks and behaves like every other connection (header, "what it accesses",
// tools, actions). Replaces the old browser prompt().
function openMcpServerView(id) {
  const s = mcpServerById(id);
  if (!s) return;
  activeConnectorId = `mcp:${id}`;
  const { color, label, needsAuth } = mcpStatusMeta(s);
  const connected = s.status === 'connected';
  const initials = String(s.name || s.id).replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'MC';

  const logo = document.getElementById('cv-logo');
  if (logo) logo.innerHTML = `<div style="width:36px;height:36px;border-radius:9px;background:#6d4aff22;color:#8b6dff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px">${escHtml(initials)}</div>`;
  document.getElementById('cv-name').textContent = s.name || s.id;
  document.getElementById('cv-category').textContent = 'MCP Server';
  document.getElementById('cv-desc').innerHTML =
    `Model Context Protocol server${s.url ? ` at <code style="font-size:12px">${escHtml(s.url)}</code>` : ''} (${escHtml(s.transport || 'stdio')}).`
    + (s.error ? `<div style="margin-top:8px;color:#ef4444;font-size:12.5px">⚠ ${escHtml(String(s.error))}</div>` : '');

  const badge = document.getElementById('cv-status-badge');
  if (badge) { badge.style.display = ''; badge.textContent = connected ? '● Connected' : (s.status === 'error' ? '● Error' : '● Disconnected'); badge.style.color = color; badge.style.background = `${color}22`; }

  // "What Prom can access" → the tools, or a hint to connect.
  const permsEl = document.getElementById('cv-permissions');
  if (permsEl) {
    permsEl.innerHTML = connected
      ? `<div class="cv-perm-row"><div class="cv-perm-icon" style="background:#6d4aff18;color:#8b6dff">⚡</div><span>${s.toolCount || 0} MCP tool${s.toolCount === 1 ? '' : 's'} available once activated</span></div>`
      : `<div class="cv-perm-row"><div class="cv-perm-icon" style="background:#6d4aff18;color:#8b6dff">⚡</div><span>Connect to discover the tools this server exposes</span></div>`;
  }

  const aiToolsEl = document.getElementById('cv-ai-tools');
  if (aiToolsEl) {
    const tools = Array.isArray(s.toolNames) ? s.toolNames : [];
    if (connected && tools.length) {
      aiToolsEl.style.display = '';
      aiToolsEl.innerHTML = `<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">AI Tools Unlocked</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px">${tools.map((t) => `<code style="font-size:10.5px;background:var(--panel-2);border:1px solid var(--line);border-radius:5px;padding:2px 7px;color:var(--text-2)">mcp__${escHtml(s.id)}__${escHtml(t)}</code>`).join('')}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:8px">Activate with <code style="font-size:10.5px">request_tool_category({"category":"mcp_server_tools"})</code></div>`;
    } else {
      aiToolsEl.style.display = 'none';
      aiToolsEl.innerHTML = '';
    }
  }

  renderMcpServerActions(s, { needsAuth, connected });

  const activityWrap = document.getElementById('cv-activity-wrap');
  if (activityWrap) activityWrap.style.display = 'none';

  const view = document.getElementById('connector-view');
  if (view) view.style.display = 'flex';
  const chatView = document.getElementById('chat-view');
  if (chatView) chatView.style.display = 'none';
  const topbar = document.getElementById('right-panel-topbar');
  if (topbar) topbar.style.visibility = 'hidden';
}

function renderMcpServerActions(s, { needsAuth, connected }) {
  const el = document.getElementById('cv-actions');
  if (!el) return;
  const id = s.id;
  const remote = s.transport === 'sse' || s.transport === 'http' || !!s.url;
  const oauthConnected = !!s.oauthConnected;
  const existingHeaders = Object.entries(s.headers || {}).map(([k, v]) => `${k}: ${v}`).join('\n');

  el.innerHTML = `
    ${connected
      ? `<button class="cv-btn-disconnect" onclick="mcpServerDisconnect('${escHtml(id)}')">Disconnect</button>`
      : `<button class="cv-btn-connect" onclick="mcpServerConnect('${escHtml(id)}')" style="background:var(--brand);color:#fff;border:none;border-radius:9px;padding:11px;font-weight:700;cursor:pointer;font-family:inherit;font-size:13px">Connect</button>`}

    ${remote ? `
    <div style="margin-top:6px;background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:12px">
      <div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Authentication${needsAuth && !oauthConnected ? ' <span style="color:#ef4444">— required</span>' : ''}</div>

      <!-- Primary: browser OAuth (works with login + 2FA servers like Robinhood) -->
      <div>
        <div style="font-size:12px;color:var(--text);font-weight:600;margin-bottom:4px">Sign in with the provider</div>
        <div style="font-size:11.5px;color:var(--muted);line-height:1.5;margin-bottom:8px">Opens the provider's login in your browser (handles username/password, 2FA, and OAuth automatically). Recommended for most remote servers.</div>
        ${oauthConnected
          ? `<div style="display:flex;gap:6px"><button class="pam-btn" onclick="startMcpOAuth('${escHtml(id)}')" style="flex:1">Re-authorize</button><button onclick="clearMcpOAuth('${escHtml(id)}')" style="border:1px solid var(--line);background:none;color:var(--muted);border-radius:8px;padding:0 12px;font-size:12px;cursor:pointer">Sign out</button></div>
             <div style="font-size:11px;color:var(--ok);margin-top:6px">✓ Authorized via OAuth</div>`
          : `<button class="pam-btn" onclick="startMcpOAuth('${escHtml(id)}')" style="width:100%">🔓 Authorize with browser</button>`}
        <div id="mcp-oauth-status" class="pam-hint"></div>
      </div>

      <!-- Fallback: static token / headers -->
      <details ${needsAuth && !oauthConnected ? '' : ''}>
        <summary style="font-size:11.5px;color:var(--muted);cursor:pointer">Have a static API token or custom headers instead?</summary>
        <div style="margin-top:8px;display:flex;flex-direction:column;gap:8px">
          <div>
            <label class="pam-label">Bearer token</label>
            <input id="mcp-auth-token" class="pam-input" type="password" placeholder="sent as Authorization: Bearer …"/>
          </div>
          <div>
            <label class="pam-label">Custom headers (one per line)</label>
            <textarea id="mcp-auth-headers" class="pam-input" rows="3" placeholder="Authorization: Bearer XYZ\nX-Account-Id: 123">${escHtml(existingHeaders)}</textarea>
          </div>
          <button class="pam-btn" onclick="saveMcpServerAuth('${escHtml(id)}')">Save &amp; connect</button>
        </div>
      </details>

      <div style="border-top:1px solid var(--line);padding-top:10px">
        <button onclick="askPrometheusToSetupMcp('${escHtml(id)}')" style="width:100%;background:#6d4aff;color:#fff;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;font-family:inherit;font-size:12.5px">✨ Let Prometheus set it up</button>
        <div style="font-size:11px;color:var(--muted);margin-top:6px;line-height:1.5">Not sure how this server authenticates? Prometheus researches it and configures it for you.</div>
      </div>
    </div>
    ` : `
    <div style="margin-top:6px;background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:14px 16px;font-size:12px;color:var(--muted);line-height:1.55">This is a local (stdio) MCP server. It authenticates via environment variables on the server config (edit it in Settings → MCP servers).</div>
    `}

    <div id="mcp-action-status" class="pam-hint"></div>
    <button onclick="mcpServerRemove('${escHtml(id)}')" style="background:none;border:1px solid var(--line);color:#ef4444;border-radius:9px;padding:9px;font-weight:600;cursor:pointer;font-family:inherit;font-size:12.5px">Remove server</button>
  `;
}

// Browser OAuth flow: start → gateway opens the provider login → poll until the
// callback completes → connect the server so its tools load.
let _mcpOAuthPoll = null;
async function startMcpOAuth(id) {
  const statusEl = document.getElementById('mcp-oauth-status');
  if (_mcpOAuthPoll) { clearInterval(_mcpOAuthPoll); _mcpOAuthPoll = null; }
  if (statusEl) statusEl.textContent = 'Opening provider login in your browser…';
  try {
    const r = await api(`/api/mcp/servers/${encodeURIComponent(id)}/oauth/start`, { method: 'POST', body: JSON.stringify({}) });
    if (r?.success === false) throw new Error(r.error || 'Could not start authorization');
    if (r?.authorizeUrl) { try { window.open(r.authorizeUrl, '_blank', 'noopener'); } catch {} }
    if (statusEl) statusEl.innerHTML = `Waiting for you to finish signing in… ${r?.authorizeUrl ? `<a href="${escHtml(r.authorizeUrl)}" target="_blank" style="color:var(--brand)">reopen login</a>` : ''}`;
    let waited = 0;
    _mcpOAuthPoll = setInterval(async () => {
      waited += 2;
      let st;
      try { st = await api(`/api/mcp/servers/${encodeURIComponent(id)}/oauth/status`); } catch { return; }
      if (st?.status === 'connected') {
        clearInterval(_mcpOAuthPoll); _mcpOAuthPoll = null;
        if (statusEl) statusEl.textContent = 'Authorized — connecting…';
        await mcpServerConnect(id);
        const cur = mcpServerById(id); if (cur) openMcpServerView(id);
        showToast('MCP authorized', s_safeName(id), 'success');
      } else if (st?.status === 'error') {
        clearInterval(_mcpOAuthPoll); _mcpOAuthPoll = null;
        if (statusEl) statusEl.textContent = 'Authorization failed: ' + (st.error || 'unknown error');
      } else if (waited > 300) {
        clearInterval(_mcpOAuthPoll); _mcpOAuthPoll = null;
        if (statusEl) statusEl.textContent = 'Authorization timed out. Try again.';
      }
    }, 2000);
  } catch (e) {
    if (statusEl) statusEl.textContent = 'Failed: ' + (e?.message || String(e));
  }
}

function s_safeName(id) {
  const s = mcpServerById(id);
  return s?.name || id;
}

async function clearMcpOAuth(id) {
  if (!confirm('Sign out of this MCP server? You will need to re-authorize to use it.')) return;
  try { await api(`/api/mcp/servers/${encodeURIComponent(id)}/oauth/clear`, { method: 'POST', body: JSON.stringify({}) }); } catch {}
  try { await api(`/api/mcp/servers/${encodeURIComponent(id)}/disconnect`, { method: 'POST' }); } catch {}
  await loadMcpServers();
  const cur = mcpServerById(id); if (cur) openMcpServerView(id);
}

async function saveMcpServerAuth(id) {
  const s = mcpServerById(id);
  if (!s) return;
  const statusEl = document.getElementById('mcp-action-status');
  const token = String(document.getElementById('mcp-auth-token')?.value || '').trim();
  const rawHeaders = String(document.getElementById('mcp-auth-headers')?.value || '').trim();
  const headers = {};
  if (rawHeaders) {
    for (const line of rawHeaders.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9-]+)\s*:\s*(.+?)\s*$/);
      if (m) headers[m[1]] = m[2];
    }
  }
  if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`;
  if (!Object.keys(headers).length) { if (statusEl) statusEl.textContent = 'Enter a token or at least one header.'; return; }
  if (statusEl) statusEl.textContent = 'Saving & connecting…';
  try {
    const cfg = { ...s, headers };
    delete cfg.status; delete cfg.toolCount; delete cfg.toolNames; delete cfg.error;
    const r = await api('/api/mcp/servers', { method: 'POST', body: JSON.stringify(cfg) });
    if (r?.success === false) throw new Error(r.error || 'Save failed');
    const c = await api(`/api/mcp/servers/${encodeURIComponent(id)}/connect`, { method: 'POST' });
    if (c?.success === false) throw new Error(c.error || 'Connect failed');
    showToast('MCP connected', s.name || id, 'success');
  } catch (e) {
    if (statusEl) statusEl.textContent = 'Failed: ' + (e?.message || String(e));
    showToast('MCP setup failed', e?.message || String(e), 'error');
  }
  await loadMcpServers();
  const cur = mcpServerById(id);
  if (cur) openMcpServerView(id); // re-render detail with fresh status
}

function askPrometheusToSetupMcp(id) {
  const s = mcpServerById(id);
  if (!s) return;
  const prompt = `Set up authentication for the MCP server "${s.name || id}" (${s.url || s.transport}). Research what auth it requires (bearer token, OAuth, API key, custom header, etc.), tell me exactly where to get the credential, and configure it via mcp_server_manage (set the right headers/env), then connect it and confirm its tools are available.`;
  closeConnectorView();
  if (typeof window.sendChat === 'function') window.sendChat(prompt);
  else { const inp = document.getElementById('chat-input'); if (inp) { inp.value = prompt; inp.focus(); } }
}

async function mcpServerConnect(id) {
  try {
    showToast('Connecting…', id, 'info');
    const r = await api(`/api/mcp/servers/${encodeURIComponent(id)}/connect`, { method: 'POST' });
    if (r?.success === false) throw new Error(r.error || 'Connect failed');
    showToast('MCP connected', id, 'success');
  } catch (e) {
    showToast('Connect failed', e?.message || String(e), 'error');
  }
  await loadMcpServers();
}

async function mcpServerDisconnect(id) {
  try { await api(`/api/mcp/servers/${encodeURIComponent(id)}/disconnect`, { method: 'POST' }); } catch {}
  await loadMcpServers();
}

async function mcpServerRemove(id) {
  if (!confirm(`Remove MCP server "${id}"?`)) return;
  try { await api(`/api/mcp/servers/${encodeURIComponent(id)}`, { method: 'DELETE' }); showToast('MCP server removed', id, 'success'); } catch (e) { showToast('Remove failed', e?.message || String(e), 'error'); }
  await loadMcpServers();
}


// ──────────────────────────────────────────────────────────────────────────
// Add-plugin modal: Build with Prometheus / REST wizard / MCP / From URL
// ──────────────────────────────────────────────────────────────────────────

// Lives on window so inline oninput handlers in the rendered rows mutate the
// same array the build step reads.
window.pamRestTools = window.pamRestTools || [];

function openAddPluginModal() {
  const modal = document.getElementById('plugin-add-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  switchAddTab('ai');
}

function closeAddPluginModal() {
  const modal = document.getElementById('plugin-add-modal');
  if (modal) modal.style.display = 'none';
}

function switchAddTab(tab) {
  document.querySelectorAll('.pam-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  const body = document.getElementById('pam-body');
  if (!body) return;
  if (tab === 'ai') body.innerHTML = renderAiTab();
  else if (tab === 'rest') { window.pamRestTools = [{ name: '', method: 'GET', pathTpl: '' }]; body.innerHTML = renderRestTab(); pamRenderToolRows(); }
  else if (tab === 'mcp') body.innerHTML = renderMcpTab();
  else if (tab === 'url') body.innerHTML = renderUrlTab();
}

function renderAiTab() {
  return `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div class="pam-hint">Describe the service you want to connect. Prometheus will research the API, build the connector, and install it — then you just enter your credentials here.</div>
      <textarea id="pam-ai-prompt" class="pam-input" rows="3" placeholder="e.g. Connect to my Airtable account so you can read and create records"></textarea>
      <button class="pam-btn" onclick="buildWithPrometheus()">Ask Prometheus to build it</button>
    </div>
  `;
}

function buildWithPrometheus() {
  const val = String(document.getElementById('pam-ai-prompt')?.value || '').trim();
  if (!val) { showToast('Describe it first', 'Tell Prometheus what to connect to.', 'warning'); return; }
  const prompt = `Use the connector-builder skill to add a new connector/plugin: ${val}. Research the API, write the manifest and index.js, install it via the extensions API, and verify with connector_list. Then tell me what credential to enter in the Connections panel.`;
  closeAddPluginModal();
  if (typeof window.sendChat === 'function') {
    window.sendChat(prompt);
  } else {
    const input = document.getElementById('chat-input');
    if (input) { input.value = prompt; input.focus(); }
  }
}

function renderRestTab() {
  return `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div class="pam-hint">For any service with a REST API and an API key. Define the endpoints you want as tools.</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div><label class="pam-label">Connector name</label><input id="pam-rest-name" class="pam-input" placeholder="Airtable"/></div>
        <div><label class="pam-label">Category</label><input id="pam-rest-category" class="pam-input" placeholder="Database"/></div>
      </div>
      <div><label class="pam-label">Base URL</label><input id="pam-rest-base" class="pam-input" placeholder="https://api.airtable.com/v0"/></div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
        <div><label class="pam-label">Auth header</label><input id="pam-rest-header" class="pam-input" value="Authorization"/></div>
        <div><label class="pam-label">Value prefix</label><input id="pam-rest-prefix" class="pam-input" value="Bearer "/></div>
        <div><label class="pam-label">Key field label</label><input id="pam-rest-keylabel" class="pam-input" value="API Key"/></div>
      </div>
      <div>
        <label class="pam-label">Tools (one per endpoint)</label>
        <div id="pam-rest-tools"></div>
        <button onclick="pamAddToolRow()" style="margin-top:6px;background:var(--panel-2);border:1px solid var(--line);color:var(--text);border-radius:7px;padding:6px 10px;font-size:12px;cursor:pointer;font-family:inherit">+ Add tool</button>
      </div>
      <button class="pam-btn" onclick="buildRestConnector()">Install connector</button>
      <div id="pam-rest-status" class="pam-hint"></div>
    </div>
  `;
}

function pamRenderToolRows() {
  const wrap = document.getElementById('pam-rest-tools');
  if (!wrap) return;
  wrap.innerHTML = window.pamRestTools.map((t, i) => `
    <div style="display:grid;grid-template-columns:1.2fr 0.7fr 1.4fr auto;gap:6px;margin-bottom:6px">
      <input class="pam-input" placeholder="tool name" value="${escHtml(t.name)}" oninput="window.pamRestTools[${i}].name=this.value"/>
      <select class="pam-input" onchange="window.pamRestTools[${i}].method=this.value">
        ${['GET', 'POST', 'PUT', 'DELETE'].map((m) => `<option ${t.method === m ? 'selected' : ''}>${m}</option>`).join('')}
      </select>
      <input class="pam-input" placeholder="/path/{id}" value="${escHtml(t.pathTpl)}" oninput="window.pamRestTools[${i}].pathTpl=this.value"/>
      <button onclick="pamRemoveToolRow(${i})" style="background:none;border:1px solid var(--line);border-radius:6px;color:var(--muted);cursor:pointer;padding:0 8px">×</button>
    </div>
  `).join('');
}

function pamAddToolRow() {
  window.pamRestTools.push({ name: '', method: 'GET', pathTpl: '' });
  pamRenderToolRows();
}

function pamRemoveToolRow(i) {
  window.pamRestTools.splice(i, 1);
  if (window.pamRestTools.length === 0) window.pamRestTools.push({ name: '', method: 'GET', pathTpl: '' });
  pamRenderToolRows();
}

function pamSlug(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
}

function buildRestConnector() {
  const name = String(document.getElementById('pam-rest-name')?.value || '').trim();
  const base = String(document.getElementById('pam-rest-base')?.value || '').trim().replace(/\/+$/, '');
  const category = String(document.getElementById('pam-rest-category')?.value || 'General').trim();
  const header = String(document.getElementById('pam-rest-header')?.value || 'Authorization').trim();
  const prefix = String(document.getElementById('pam-rest-prefix')?.value || '').replace(/"/g, '');
  const keyLabel = String(document.getElementById('pam-rest-keylabel')?.value || 'API Key').trim();
  const statusEl = document.getElementById('pam-rest-status');

  const id = pamSlug(name);
  if (!id || !base) { if (statusEl) statusEl.textContent = 'Name and Base URL are required.'; return; }
  const tools = window.pamRestTools.filter((t) => pamSlug(t.name) && t.pathTpl);
  if (tools.length === 0) { if (statusEl) statusEl.textContent = 'Add at least one tool with a name and path.'; return; }

  const toolNames = tools.map((t) => `${id}_${pamSlug(t.name)}`);
  const manifest = {
    id,
    kind: 'connector',
    name,
    description: `${name} REST connector (custom).`,
    category,
    runtime: { binding: `user/${id}`, entrypoint: './index.js' },
    ui: { color: '#4F46E5' },
    ownership: { tools: toolNames },
    contracts: { tools: toolNames },
    setup: {
      authType: 'api_key',
      fields: [{ key: 'apiKey', label: keyLabel, input: 'password', secret: true, required: true }],
    },
  };

  // Build index.js: one fetch-based tool per endpoint. Path templates use {param}
  // which become required string params and are substituted at call time.
  const toolDefs = tools.map((t, idx) => {
    const tname = toolNames[idx];
    const params = (t.pathTpl.match(/\{(\w+)\}/g) || []).map((m) => m.slice(1, -1));
    const propsObj = {};
    params.forEach((p) => { propsObj[p] = { type: 'string', description: p }; });
    const hasBody = t.method === 'POST' || t.method === 'PUT';
    if (hasBody) propsObj.body = { type: 'object', description: 'Request body' };
    const required = JSON.stringify(params);
    const properties = JSON.stringify(propsObj);
    let pathExpr = JSON.stringify(t.pathTpl);
    params.forEach((p) => {
      pathExpr = pathExpr.replace(`{${p}}`, '" + encodeURIComponent(args["' + p + '"]) + "');
    });
    return `
    api.registerTool({
      name: ${JSON.stringify(tname)},
      description: ${JSON.stringify(`[${name}] ${t.method} ${t.pathTpl}`)},
      parameters: { type: 'object', required: ${required}, properties: ${properties} },
      connectorId: ${JSON.stringify(id)},
      execute: async (args, ctx) => {
        const key = ctx.getCredential('apiKey');
        if (!key) return { result: ${JSON.stringify(`${name} not connected. Enter your ${keyLabel} in Connections.`)}, error: true };
        const url = ${JSON.stringify(base)} + (${pathExpr});
        const init = { method: ${JSON.stringify(t.method)}, headers: { ${JSON.stringify(header)}: ${JSON.stringify(prefix)} + key, 'Content-Type': 'application/json' } };
        ${hasBody ? "if (args.body) init.body = JSON.stringify(args.body);" : ''}
        const res = await fetch(url, init);
        const text = await res.text();
        if (!res.ok) return { result: ${JSON.stringify(name)} + ' ' + res.status + ': ' + text.slice(0, 400), error: true };
        return { result: text.slice(0, 8000), error: false };
      },
    });`;
  }).join('\n');

  const indexJs = `module.exports = {
  id: ${JSON.stringify(id)},
  register(api) {${toolDefs}
  },
};
`;

  if (statusEl) statusEl.textContent = 'Installing...';
  installUserPluginManifest(manifest, indexJs, statusEl);
}

function renderMcpTab() {
  return `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div class="pam-hint">For services with a published MCP server. The server's tools appear automatically once connected.</div>
      <div><label class="pam-label">Display name</label><input id="pam-mcp-name" class="pam-input" placeholder="Airtable (MCP)"/></div>
      <div><label class="pam-label">Launch command</label><input id="pam-mcp-cmd" class="pam-input" placeholder="npx -y airtable-mcp-server"/></div>
      <div>
        <label class="pam-label">Credential env var (optional)</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <input id="pam-mcp-envname" class="pam-input" placeholder="AIRTABLE_API_KEY"/>
          <input id="pam-mcp-keylabel" class="pam-input" placeholder="API Key label"/>
        </div>
      </div>
      <button class="pam-btn" onclick="buildMcpConnector()">Install MCP server</button>
      <div id="pam-mcp-status" class="pam-hint"></div>
    </div>
  `;
}

function buildMcpConnector() {
  const name = String(document.getElementById('pam-mcp-name')?.value || '').trim();
  const cmd = String(document.getElementById('pam-mcp-cmd')?.value || '').trim();
  const envName = String(document.getElementById('pam-mcp-envname')?.value || '').trim();
  const keyLabel = String(document.getElementById('pam-mcp-keylabel')?.value || 'API Key').trim();
  const statusEl = document.getElementById('pam-mcp-status');

  const id = pamSlug(name);
  if (!id || !cmd) { if (statusEl) statusEl.textContent = 'Name and launch command are required.'; return; }
  const parts = cmd.split(/\s+/);
  const manifest = {
    id,
    kind: 'mcp_preset',
    name,
    description: `${name} via MCP (custom).`,
    category: 'MCP',
    runtime: { binding: 'mcp' },
    mcpPreset: {
      transport: 'stdio',
      command: parts[0],
      args: parts.slice(1),
    },
  };
  if (envName) {
    manifest.setup = { authType: 'api_key', fields: [{ key: 'apiKey', label: keyLabel, input: 'password', secret: true, required: true }] };
    manifest.mcpPreset.envTemplate = { [envName]: `{{credential:${id}:apiKey}}` };
  } else {
    manifest.setup = { authType: 'none' };
  }

  if (statusEl) statusEl.textContent = 'Installing...';
  installUserPluginManifest(manifest, null, statusEl);
}

function renderUrlTab() {
  return `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div class="pam-hint">Paste a URL to a prometheus.extension.json manifest (raw file). Prometheus validates it before installing.</div>
      <input id="pam-url-input" class="pam-input" placeholder="https://raw.githubusercontent.com/user/repo/main/prometheus.extension.json"/>
      <button class="pam-btn" onclick="installFromUrl()">Fetch & install</button>
      <div id="pam-url-status" class="pam-hint"></div>
    </div>
  `;
}

async function installFromUrl() {
  const url = String(document.getElementById('pam-url-input')?.value || '').trim();
  const statusEl = document.getElementById('pam-url-status');
  if (!url) { if (statusEl) statusEl.textContent = 'Paste a manifest URL first.'; return; }
  if (statusEl) statusEl.textContent = 'Fetching...';
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const manifest = await res.json();
    let indexJs = null;
    if (manifest?.runtime?.entrypoint) {
      const base = url.replace(/[^/]*$/, '');
      const entryUrl = base + String(manifest.runtime.entrypoint).replace(/^\.\//, '');
      try { const r = await fetch(entryUrl); if (r.ok) indexJs = await r.text(); } catch { /* optional */ }
    }
    installUserPluginManifest(manifest, indexJs, statusEl);
  } catch (e) {
    if (statusEl) statusEl.textContent = 'Failed: ' + (e?.message || e);
  }
}

async function installUserPluginManifest(manifest, indexJs, statusEl) {
  try {
    const body = { manifest };
    if (indexJs) body.indexJs = indexJs;
    const res = await api('/api/extensions/install', { method: 'POST', body: JSON.stringify(body) });
    if (res?.success === false) throw new Error(res.error || 'Install failed');
    if (statusEl) statusEl.textContent = `Installed. ${res?.reload?.tools || 0} tools registered.`;
    showToast('Plugin installed', `${manifest.name} is ready. Enter credentials to activate it.`, 'success');
    closeAddPluginModal();
    await loadConnectionsState();
    if (getConnectorById(manifest.id)) openConnectorView(manifest.id);
  } catch (e) {
    if (statusEl) statusEl.textContent = 'Failed: ' + (e?.message || e);
    showToast('Install failed', e?.message || String(e), 'error');
  }
}

async function removeUserPlugin(id) {
  if (!confirm('Remove this custom plugin? Its tools will be unloaded.')) return;
  try {
    await api('/api/extensions/remove', { method: 'POST', body: JSON.stringify({ id }) });
    showToast('Plugin removed', 'The custom plugin was uninstalled.', 'success');
    closeConnectorView();
    await loadConnectionsState();
  } catch (e) {
    showToast('Remove failed', e?.message || String(e), 'error');
  }
}

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
window.startXurlSetup = startXurlSetup;
window.renderXurlSetupState = renderXurlSetupState;
window.pollXurlSetup = pollXurlSetup;
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
window.openAddPluginModal = openAddPluginModal;
window.closeAddPluginModal = closeAddPluginModal;
window.switchAddTab = switchAddTab;
window.buildWithPrometheus = buildWithPrometheus;
window.pamAddToolRow = pamAddToolRow;
window.pamRemoveToolRow = pamRemoveToolRow;
window.buildRestConnector = buildRestConnector;
window.buildMcpConnector = buildMcpConnector;
window.installFromUrl = installFromUrl;
window.removeUserPlugin = removeUserPlugin;
window.loadMcpServers = loadMcpServers;
window.mcpServerConnect = mcpServerConnect;
window.mcpServerDisconnect = mcpServerDisconnect;
window.mcpServerRemove = mcpServerRemove;
window.openMcpServerView = openMcpServerView;
window.saveMcpServerAuth = saveMcpServerAuth;
window.askPrometheusToSetupMcp = askPrometheusToSetupMcp;
window.startMcpOAuth = startMcpOAuth;
window.clearMcpOAuth = clearMcpOAuth;
