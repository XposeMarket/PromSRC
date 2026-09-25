// Mobile Plugins page (replaces the old "More" landing on mobile only).
//
// One alphabetical list of everything the gateway can plug into the model:
// bundled connectors, MCP servers, and plugins imported from Claude Code /
// Codex / Hermes / OpenClaw. Installed items also show as a compact icon row
// at the top. Connecting is delegated to Prom in chat: OAuth callbacks land on
// the PC's loopback listener, so a consent page opened on the phone itself
// cannot complete. Prom opens consent on the PC (system Chrome) instead.
import {
  ICONS,
  escapeHtml,
  pmToast,
  renderMobileHeader,
  wireHeaderActions,
} from './mobile-pages.js';
import { mobileGatewayFetch } from './mobile-api.js';
import { ensureMobileStyleOwner } from './mobile-style-owners.js';
import { getConnectorLogoUrl, resolveConnectorLogoId } from '../features/connectors/connector-logo-runtime.js';

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
const INSTALLED_ICON_LIMIT = 6;

const FORMAT_LABELS = Object.freeze({
  claude: 'Claude Code',
  codex: 'Codex',
  hermes: 'Hermes',
  openclaw: 'OpenClaw',
});

function monogram(name) {
  const tokens = String(name || '').replace(/[^a-z0-9]+/gi, ' ').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return '?';
  if (tokens.length === 1) return tokens[0].slice(0, 2).toUpperCase();
  return `${tokens[0][0]}${tokens[1][0]}`.toUpperCase();
}

function safeColor(value, fallback = '#8a8f98') {
  const color = String(value || '').trim();
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : fallback;
}

/** Normalize the three gateway sources into one row shape. Exported for tests. */
export function buildPluginRows({ connectors = [], mcpServers = [], imported = [], hosted = [] } = {}) {
  const rows = [];
  const hostedServerIds = new Set();
  const connectorIds = new Set((Array.isArray(connectors) ? connectors : []).map((c) => String(c?.id || '')));
  for (const entry of Array.isArray(hosted) ? hosted : []) {
    if (!entry?.id || entry.dcr === false) continue;
    const serverId = String(entry.serverId || `hosted-${entry.id}`);
    hostedServerIds.add(serverId);
    // A bundled connector with the same id (e.g. vercel) is already connected
    // through its own route; still offer the hosted MCP, but name it clearly.
    const clash = connectorIds.has(String(entry.id));
    rows.push({
      key: `hosted:${entry.id}`,
      kind: 'hosted',
      id: String(entry.id),
      serverId,
      name: clash ? `${entry.name} MCP` : String(entry.name || entry.id),
      desc: String(entry.description || 'Hosted MCP server'),
      category: String(entry.category || ''),
      color: '#8a8f98',
      connected: entry.connected === true || entry.oauthConnected === true,
      installed: entry.installed === true,
      needsAttention: entry.installed === true && entry.connected !== true && entry.oauthConnected === true,
      toolCount: Number(entry.toolCount || 0),
      permissions: [],
      oneTap: true,
    });
  }
  for (const item of Array.isArray(connectors) ? connectors : []) {
    if (!item?.id) continue;
    const state = item.state || {};
    const connected = state.connected === true || state.authenticated === true;
    rows.push({
      key: `connector:${item.id}`,
      kind: 'connector',
      id: String(item.id),
      name: String(item.name || item.id),
      desc: String(item.description || ''),
      category: String(item.category || ''),
      color: safeColor(item?.ui?.color),
      connected,
      needsAttention: !connected && (state.hasCredentials === true || state.configured === true),
      account: String(state.account?.email || state.account?.displayName || ''),
      connectionId: String(state.connectionId || ''),
      authType: String(state.authType || item?.setup?.authType || ''),
      permissions: (Array.isArray(item?.ui?.permissions) ? item.ui.permissions : [])
        .map((p) => String(p?.label || '')).filter(Boolean),
      toolCount: Array.isArray(item?.ownership?.tools) ? item.ownership.tools.length : 0,
    });
  }
  const importedMcpIds = new Set();
  for (const plugin of Array.isArray(imported) ? imported : []) {
    if (!plugin?.id) continue;
    for (const server of plugin.mcpServers || []) if (server?.id) importedMcpIds.add(String(server.id));
    const skills = Array.isArray(plugin.skills) ? plugin.skills.length : 0;
    const mcpEnabled = (plugin.mcpServers || []).some((s) => s?.enabled);
    const needsSecret = Array.isArray(plugin.requiredEnv) && plugin.requiredEnv.length > 0 && !mcpEnabled
      && (plugin.mcpServers || []).length > 0;
    const parts = [];
    if (skills) parts.push(`${skills} skill${skills === 1 ? '' : 's'}`);
    if ((plugin.mcpServers || []).length) parts.push(needsSecret ? 'MCP needs a token' : 'MCP server');
    if ((plugin.hooks || []).length) parts.push(plugin.hooksApproved ? 'hooks on' : 'hooks off');
    rows.push({
      key: `imported:${plugin.id}`,
      kind: 'imported',
      id: String(plugin.id),
      name: String(plugin.name || plugin.id),
      desc: `Imported from ${FORMAT_LABELS[plugin.format] || plugin.format || 'plugin'}${parts.length ? ` · ${parts.join(' · ')}` : ''}`,
      color: '#8a8f98',
      connected: true,
      needsAttention: needsSecret,
      requiredEnv: Array.isArray(plugin.requiredEnv) ? plugin.requiredEnv.map(String) : [],
      toolCount: 0,
      permissions: [],
    });
  }
  for (const server of Array.isArray(mcpServers) ? mcpServers : []) {
    if (!server?.id || importedMcpIds.has(String(server.id)) || hostedServerIds.has(String(server.id))) continue;
    const status = String(server.status || 'disconnected');
    rows.push({
      key: `mcp:${server.id}`,
      kind: 'mcp',
      id: String(server.id),
      name: String(server.name || server.id),
      desc: String(server.description || (status === 'connected'
        ? `MCP server · ${Number(server.toolCount || 0)} tools`
        : `MCP server · ${status}${server.needsOAuth ? ' · sign-in needed' : ''}`)),
      color: '#8a8f98',
      connected: status === 'connected',
      needsAttention: status === 'error' || !!server.needsOAuth,
      toolCount: Number(server.toolCount || 0),
      error: String(server.error || ''),
      permissions: [],
    });
  }
  rows.sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.key, b.key));
  return rows;
}

const LETTER_BUCKETS = Object.freeze(['A–C', 'D–F', 'G–I', 'J–L', 'M–O', 'P–R', 'S–U', 'V–X', 'Y–Z']);

/** A–C, D–F, … bucket for a name; '#' for names not starting with a letter. Exported for tests. */
export function letterBucket(name) {
  const first = String(name || '').trim().charAt(0).toUpperCase();
  const code = first.charCodeAt(0) - 65;
  if (!(code >= 0 && code < 26)) return '#';
  return LETTER_BUCKETS[Math.min(Math.floor(code / 3), LETTER_BUCKETS.length - 1)];
}

/** Split sorted rows into { installed, available } and bucket the available ones. Exported for tests. */
export function groupPluginRows(rows = []) {
  const installed = rows.filter((row) => row.connected);
  const groups = [];
  for (const row of rows) {
    if (row.connected) continue;
    const label = letterBucket(row.name);
    let group = groups[groups.length - 1];
    if (!group || group.label !== label) { group = { label, rows: [] }; groups.push(group); }
    group.rows.push(row);
  }
  // '#' sorts first by collation; show it last like a phone contact list.
  groups.sort((a, b) => (a.label === '#') - (b.label === '#'));
  return { installed, groups };
}

function logoMarkup(row, size = 44) {
  const logoId = row.kind === 'connector' ? resolveConnectorLogoId(row.id) : resolveConnectorLogoId(row.id);
  const url = logoId ? getConnectorLogoUrl(logoId) : '';
  const color = safeColor(row.color);
  const inner = url
    ? `<span class="pm-plugin-logo-mark" style="--pm-plugin-logo-url:url('${escapeHtml(url)}');--pm-plugin-logo-color:${color}"></span>`
    : `<span class="pm-plugin-logo-text" style="color:${color}">${escapeHtml(monogram(row.name))}</span>`;
  return `<span class="pm-plugin-logo" style="width:${size}px;height:${size}px">${inner}</span>`;
}

function trailingMarkup(row) {
  if (row.needsAttention) return `<span class="pm-plugin-trail warn" aria-label="Needs attention">!</span>`;
  if (row.connected) return `<span class="pm-plugin-trail" aria-label="Installed">${ICONS.dots}</span>`;
  return `<span class="pm-plugin-trail" aria-label="Connect">${ICONS.plus}</span>`;
}

function rowMarkup(row, index) {
  return `
    <button class="pm-plugin-row" type="button" data-plugin-index="${index}">
      ${logoMarkup(row)}
      <span class="pm-plugin-row-text">
        <strong>${escapeHtml(row.name)}</strong>
        <em>${escapeHtml(row.desc || '')}</em>
      </span>
      ${trailingMarkup(row)}
    </button>`;
}

function askPromInChat(navigate, message) {
  try { navigate?.('#mobile/chat'); } catch {}
  const started = Date.now();
  const trySend = () => {
    if (typeof window.__pmMobileSendMessage === 'function') {
      window.__pmMobileSendMessage(message);
      return;
    }
    if (Date.now() - started < 4000) setTimeout(trySend, 150);
    else pmToast('Open chat and ask Prom to connect it.', 'info');
  };
  setTimeout(trySend, 200);
}

function connectMessage(row) {
  if (row.kind === 'imported') {
    return row.requiredEnv?.length
      ? `Finish setting up the imported ${row.name} plugin: ask me for ${row.requiredEnv.join(', ')} through a secure field, then enable its MCP server and verify it.`
      : `Check the imported ${row.name} plugin and make sure everything in it is working.`;
  }
  if (row.kind === 'mcp') return `Connect the ${row.name} MCP server and verify its tools work.`;
  if (row.connected) return `Verify my ${row.name} connection and show me what it can do.`;
  return `Connect my ${row.name} plugin. Handle the sign-in on the PC and verify it works.`;
}

/**
 * One-tap connect for hosted MCP servers (OAuth + dynamic client
 * registration). The gateway returns the provider's consent URL; its redirect
 * lands on the gateway's public URL, so the phone can finish consent itself.
 */
async function startHostedConnect(row, onChanged) {
  // Open a window synchronously inside the tap so iOS does not block it, then
  // point it at the consent URL once the gateway answers.
  const popup = window.open('', '_blank');
  let result;
  try {
    result = await mobileGatewayFetch(`/api/mcp/hosted/${encodeURIComponent(row.id)}/connect`, {
      method: 'POST',
      body: JSON.stringify({ callback: 'public' }),
      timeoutMs: 20000,
    });
  } catch (err) {
    try { popup?.close(); } catch {}
    throw err;
  }
  if (!result?.success || !result.authorizeUrl) {
    try { popup?.close(); } catch {}
    throw new Error(result?.error || 'no consent URL returned');
  }
  if (result.callback === 'loopback') {
    // This provider only accepts a loopback callback, so consent opened in
    // the PC's browser; a phone tab could never complete it.
    try { popup?.close(); } catch {}
    pmToast(`${row.name} opened its sign-in on your PC. Tap Allow there.`, 'info');
  } else {
    if (popup && !popup.closed) popup.location.href = result.authorizeUrl;
    else window.location.href = result.authorizeUrl;
    pmToast(`Tap Allow on ${row.name}, then come back here.`, 'info');
  }
  const serverId = result.serverId || row.serverId;
  const started = Date.now();
  const poll = async () => {
    if (Date.now() - started > 5 * 60 * 1000) return;
    try {
      const status = await mobileGatewayFetch(`/api/mcp/servers/${encodeURIComponent(serverId)}/oauth/status`);
      if (status?.status === 'connected') { pmToast(`${row.name} connected`, 'success'); onChanged?.(); return; }
      if (status?.status === 'error') { pmToast(`${row.name}: ${status.error || 'sign-in failed'}`, 'error'); return; }
    } catch {}
    setTimeout(poll, 2000);
  };
  setTimeout(poll, 2000);
}

/**
 * Disconnect a plugin in place (no chat round-trip). Hosted MCP servers are
 * fully removed (OAuth grant + config) so they go back to Available and can be
 * re-connected with one tap.
 */
export async function disconnectPlugin(row) {
  const post = (url, body) => mobileGatewayFetch(url, { method: 'POST', body: JSON.stringify(body || {}), timeoutMs: 20000 });
  if (row.kind === 'hosted' || row.kind === 'mcp') {
    const serverId = row.kind === 'hosted' ? (row.serverId || `hosted-${row.id}`) : row.id;
    const enc = encodeURIComponent(serverId);
    await post(`/api/mcp/servers/${enc}/oauth/clear`).catch(() => null);
    await post(`/api/mcp/servers/${enc}/disconnect`).catch(() => null);
    if (row.kind === 'hosted') await mobileGatewayFetch(`/api/mcp/servers/${enc}`, { method: 'DELETE' }).catch(() => null);
    return;
  }
  if (row.kind === 'imported') {
    const out = await post('/api/plugins/import/uninstall', { id: row.id });
    if (out?.success === false) throw new Error(out.error || 'uninstall failed');
    return;
  }
  if (row.connectionId) {
    await post(`/api/connections-v2/${encodeURIComponent(row.connectionId)}/disconnect`).catch(() => null);
  }
  const out = await post('/api/connections/disconnect', { id: row.id });
  if (out?.success === false || out?.error) throw new Error(out.error || 'disconnect failed');
}

function openSheet(page, row, navigate, onChanged) {
  document.querySelectorAll('.pm-plugin-sheet-backdrop').forEach((el) => el.remove());
  const status = row.needsAttention
    ? (row.kind === 'imported' ? 'Needs setup' : 'Needs attention')
    : row.connected ? (row.kind === 'imported' ? 'Installed' : 'Connected') : 'Not connected';
  const details = [
    row.account ? `<div class="pm-plugin-sheet-meta"><span>Account</span><b>${escapeHtml(row.account)}</b></div>` : '',
    row.toolCount ? `<div class="pm-plugin-sheet-meta"><span>Tools</span><b>${row.toolCount}</b></div>` : '',
    row.error ? `<div class="pm-plugin-sheet-meta"><span>Error</span><b>${escapeHtml(row.error.slice(0, 160))}</b></div>` : '',
  ].join('');
  const perms = row.permissions?.length
    ? `<div class="pm-plugin-sheet-section">Can do</div><ul class="pm-plugin-sheet-perms">${row.permissions.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`
    : '';
  const isOn = row.connected && !row.needsAttention;
  const canDisconnect = row.connected || row.needsAttention || (row.kind === 'hosted' && row.installed);
  // Connected plugins get a real Disconnect instead of a chat hand-off.
  const primary = isOn
    ? (row.kind === 'imported' ? 'Uninstall' : 'Disconnect')
    : (row.kind === 'imported' ? 'Finish setup' : (row.oneTap ? `Connect ${row.name}` : `Ask Prom to connect ${row.name}`));
  const primaryIsDisconnect = isOn;
  const wrap = document.createElement('div');
  wrap.className = 'pm-plugin-sheet-backdrop';
  wrap.innerHTML = `
    <div class="pm-plugin-sheet" role="dialog" aria-modal="true" aria-label="${escapeHtml(row.name)}">
      <button class="pm-plugin-sheet-close" type="button" aria-label="Close">${ICONS.x}</button>
      <div class="pm-plugin-sheet-head">
        ${logoMarkup(row, 64)}
        <h2>${escapeHtml(row.name)}</h2>
        <span class="pm-plugin-status ${row.connected && !row.needsAttention ? 'ok' : row.needsAttention ? 'warn' : ''}">${escapeHtml(status)}</span>
      </div>
      ${row.desc ? `<p class="pm-plugin-sheet-desc">${escapeHtml(row.desc)}</p>` : ''}
      ${details}
      ${perms}
      <button class="${primaryIsDisconnect ? 'pm-plugin-sheet-danger' : 'pm-plugin-sheet-primary'}" type="button" data-plugin-primary>${escapeHtml(primary)}</button>
      ${!primaryIsDisconnect && canDisconnect ? `<button class="pm-plugin-sheet-danger" type="button" data-plugin-disconnect>${row.kind === 'imported' ? 'Uninstall' : 'Disconnect'}</button>` : ''}
      <p class="pm-plugin-sheet-note">${isOn
        ? (row.kind === 'imported' ? 'Removes the imported skills, MCP servers and hooks.' : `Removes Prometheus's access to ${escapeHtml(row.name)}. You can connect again any time.`)
        : row.oneTap
          ? `Opens ${escapeHtml(row.name)}'s sign-in page. Tap Allow and you're done. No tokens to paste.`
          : 'Prom handles this sign-in on your PC and asks before anything that writes or posts.'}</p>
    </div>`;
  const close = () => wrap.remove();
  wrap.addEventListener('click', (event) => { if (event.target === wrap) close(); });
  wrap.querySelector('.pm-plugin-sheet-close')?.addEventListener('click', close);
  const runDisconnect = async (button) => {
    const label = row.kind === 'imported' ? 'Uninstall' : 'Disconnect';
    if (!window.confirm(`${label} ${row.name}?`)) return;
    button.disabled = true;
    button.textContent = row.kind === 'imported' ? 'Uninstalling…' : 'Disconnecting…';
    try {
      await disconnectPlugin(row);
      pmToast(`${row.name} ${row.kind === 'imported' ? 'uninstalled' : 'disconnected'}`, 'success');
      close();
      onChanged?.();
    } catch (err) {
      button.disabled = false;
      button.textContent = label;
      pmToast(`${label} failed: ${err?.message || err}`, 'error');
    }
  };
  wrap.querySelector('[data-plugin-disconnect]')?.addEventListener('click', (event) => runDisconnect(event.currentTarget));
  wrap.querySelector('[data-plugin-primary]')?.addEventListener('click', async (event) => {
    if (primaryIsDisconnect) { await runDisconnect(event.currentTarget); return; }
    if (row.oneTap && !row.connected) {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = 'Opening sign-in…';
      try {
        await startHostedConnect(row, onChanged);
        close();
      } catch (err) {
        button.disabled = false;
        button.textContent = primary;
        pmToast(`Could not start sign-in: ${err?.message || err}`, 'error');
      }
      return;
    }
    close();
    askPromInChat(navigate, connectMessage(row));
  });
  // On <body>, not the page: a transformed page ancestor would pin a fixed
  // overlay to the page box instead of the viewport.
  document.body.appendChild(wrap);
  const onRoute = () => { close(); window.removeEventListener('hashchange', onRoute); window.removeEventListener('popstate', onRoute); };
  window.addEventListener('hashchange', onRoute);
  window.addEventListener('popstate', onRoute);
}

function footerMarkup() {
  return `
    <div class="pm-plugins-section-title">More</div>
    <div class="pm-plugins-footer">
      <button class="pm-plugin-row compact" type="button" data-route="#mobile/more/audit">
        <span class="pm-plugin-logo small">${ICONS.clipboard}</span>
        <span class="pm-plugin-row-text"><strong>Audit</strong></span><span class="pm-plugin-trail">${ICONS.chev}</span>
      </button>
      <button class="pm-plugin-row compact" type="button" data-route="#mobile/more/memory">
        <span class="pm-plugin-logo small">${ICONS.brain}</span>
        <span class="pm-plugin-row-text"><strong>Memory</strong></span><span class="pm-plugin-trail">${ICONS.chev}</span>
      </button>
      <button class="pm-plugin-row compact" type="button" data-plugins-reload>
        <span class="pm-plugin-logo small">${ICONS.refresh}</span>
        <span class="pm-plugin-row-text"><strong>Reload latest assets</strong></span>
      </button>
    </div>`;
}

export async function renderMobilePluginsPage(page, { navigate } = {}) {
  ensureMobileStyleOwner('plugins');
  page.innerHTML = `
    ${renderMobileHeader({ title: 'Plugins', online: true, showModelBadge: false })}
    <div class="pm-body pm-plugins-page" id="pm-plugins-body">
      <div class="pm-plugins-loading">Loading plugins…</div>
    </div>
    <div class="pm-plugins-search">
      <span class="pm-plugins-search-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.5" y2="16.5"/></svg></span>
      <input id="pm-plugins-search-input" type="search" placeholder="Search plugins" autocomplete="off" enterkeyhint="search" aria-label="Search plugins">
    </div>`;
  wireHeaderActions(page, {});
  const body = page.querySelector('#pm-plugins-body');
  const search = page.querySelector('#pm-plugins-search-input');
  let rows = [];
  let query = '';

  const paint = () => {
    const q = query.trim().toLowerCase();
    const visible = q
      ? rows.filter((row) => `${row.name} ${row.desc} ${row.category || ''} ${row.id}`.toLowerCase().includes(q))
      : rows;
    const installed = rows.filter((row) => row.connected);
    const installedIcons = installed.slice(0, INSTALLED_ICON_LIMIT).map((row) => `
      <button class="pm-plugin-installed-icon" type="button" data-plugin-index="${rows.indexOf(row)}" aria-label="${escapeHtml(row.name)}">${logoMarkup(row, 52)}</button>`).join('');
    const extra = installed.length - INSTALLED_ICON_LIMIT;
    const grouped = groupPluginRows(rows);
    const listHtml = q
      ? `<div class="pm-plugins-section-title">Results <span class="pm-plugins-count">${visible.length}</span></div>
        <div class="pm-plugins-list">${visible.length ? visible.map((row) => rowMarkup(row, rows.indexOf(row))).join('') : '<p class="pm-plugins-empty">No plugins match.</p>'}</div>`
      : `${grouped.installed.length ? `
        <div class="pm-plugins-section-title" id="pm-plugins-installed-list">Installed <span class="pm-plugins-count">${grouped.installed.length}</span></div>
        <div class="pm-plugins-list pm-plugins-group">${grouped.installed.map((row) => rowMarkup(row, rows.indexOf(row))).join('')}</div>` : ''}
        <div class="pm-plugins-section-title">Available <span class="pm-plugins-count">${rows.length - grouped.installed.length}</span></div>
        ${grouped.groups.map((group) => `
          <div class="pm-plugins-letter">${escapeHtml(group.label)}</div>
          <div class="pm-plugins-list pm-plugins-group">${group.rows.map((row) => rowMarkup(row, rows.indexOf(row))).join('')}</div>`).join('')}`;
    body.innerHTML = `
      ${!q && installed.length ? `
        <div class="pm-plugins-installed">${installedIcons}${extra > 0 ? `<button class="pm-plugin-installed-more" type="button" data-plugins-show-installed>+${extra}</button>` : ''}</div>` : ''}
      ${listHtml}
      ${q ? '' : footerMarkup()}
      <div class="pm-plugins-bottom-space"></div>`;
  };

  body.addEventListener('click', (event) => {
    const route = event.target?.closest?.('[data-route]');
    if (route) { navigate?.(route.getAttribute('data-route')); return; }
    if (event.target?.closest?.('[data-plugins-reload]')) {
      pmToast('Refreshing assets…', 'info');
      Promise.resolve(window.pmPurgeCaches?.()).catch(() => window.location.reload());
      return;
    }
    if (event.target?.closest?.('[data-plugins-show-installed]')) {
      query = '';
      if (search) search.value = '';
      body.querySelector('#pm-plugins-installed-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const hit = event.target?.closest?.('[data-plugin-index]');
    if (!hit) return;
    const row = rows[Number(hit.getAttribute('data-plugin-index'))];
    if (row) openSheet(page, row, navigate, load);
  });
  search?.addEventListener('input', () => { query = search.value || ''; paint(); });

  async function load() {
    const [catalog, mcp, imports, hosted] = await Promise.allSettled([
      mobileGatewayFetch('/api/extensions/catalog?kind=connector'),
      mobileGatewayFetch('/api/mcp/servers'),
      mobileGatewayFetch('/api/plugins/import/scan', { timeoutMs: 20000 }),
      mobileGatewayFetch('/api/mcp/hosted-catalog'),
    ]);
    if (!page.isConnected && page.parentNode === null) return;
    if (catalog.status === 'rejected' && mcp.status === 'rejected') {
      body.innerHTML = `<p class="pm-plugins-empty">Could not load plugins: ${escapeHtml(catalog.reason?.message || 'gateway unavailable')}</p>`;
      return;
    }
    rows = buildPluginRows({
      connectors: catalog.status === 'fulfilled' ? catalog.value?.items : [],
      mcpServers: mcp.status === 'fulfilled' ? mcp.value?.servers : [],
      imported: imports.status === 'fulfilled' ? imports.value?.imported : [],
      hosted: hosted.status === 'fulfilled' ? hosted.value?.items : [],
    });
    paint();
  }
  await load();
}
