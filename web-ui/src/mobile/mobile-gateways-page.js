// Mobile Gateway Connections page. A gateway is an independent Prometheus
// installation; this view never merges or writes gateway-owned state.

import {
  ICONS,
  escapeHtml,
  renderMobileHeader,
  wireHeaderActions,
} from './mobile-shell.js?v=pm-v256-2026-08-09-keyboard-bottom-anchor';
import {
  gatewayStatusLabel,
  getGatewayFilter,
  loadGatewayCatalog,
  refreshGatewayStatuses,
  onGatewayCatalogChanged,
  setGatewayFilter,
  setActiveGatewayId,
  getActiveGatewayId,
  forgetGateway,
  getGatewayToken,
  getGatewayDeviceId,
  probeGateway,
  revokeGateway,
  isMobileGatewayCatalogEnabled,
} from './mobile-gateway-catalog.js';
import { getDeviceToken } from './mobile-api.js';

function _timeAgo(value) {
  const stamp = Number(value || 0);
  if (!stamp) return 'Never contacted';
  const seconds = Math.max(0, Math.floor((Date.now() - stamp) / 1000));
  if (seconds < 10) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function _statusClass(status) {
  return `is-${String(status || 'unknown').replace(/[^a-z]/g, '') || 'unknown'}`;
}

function _gatewayCard(entry, activeId) {
  const token = getGatewayToken(entry.gatewayId) || (entry.legacy ? getDeviceToken() : '');
  const deviceId = getGatewayDeviceId(entry.gatewayId);
  const capabilities = entry.capabilities?.length ? entry.capabilities.slice(0, 7).join(' · ') : 'Status metadata only';
  return `
    <article class="pm-gateway-card ${_statusClass(entry.status)}" data-gateway-id="${escapeHtml(entry.gatewayId)}">
      <div class="pm-gateway-card-head">
        <div class="pm-gateway-card-title-wrap">
          <span class="pm-gateway-status-dot" aria-hidden="true"></span>
          <div><h2>${escapeHtml(entry.name)}</h2><p>${escapeHtml(entry.platform || 'unknown')} · ${escapeHtml(entry.version || 'unknown')}</p></div>
        </div>
        <span class="pm-gateway-status-label">${escapeHtml(gatewayStatusLabel(entry.status))}</span>
      </div>
      <dl class="pm-gateway-meta">
        <div><dt>Gateway identity</dt><dd><code>${escapeHtml(entry.gatewayId)}</code></dd></div>
        <div><dt>Last contact</dt><dd>${escapeHtml(_timeAgo(entry.lastContactAt))}</dd></div>
        <div><dt>Target origin</dt><dd>${escapeHtml(entry.origin)}</dd></div>
        <div><dt>Capabilities</dt><dd>${escapeHtml(capabilities)}</dd></div>
        ${entry.workspaceName ? `<div><dt>Workspace</dt><dd>${escapeHtml(entry.workspaceName)}</dd></div>` : ''}
        ${deviceId ? `<div><dt>Phone grant</dt><dd><code>${escapeHtml(deviceId)}</code></dd></div>` : ''}
      </dl>
      ${entry.lastError ? `<p class="pm-gateway-error">${escapeHtml(entry.lastError)}</p>` : ''}
      <div class="pm-gateway-card-actions">
        <button type="button" class="pm-btn ghost" data-gateway-action="active" data-gateway-id="${escapeHtml(entry.gatewayId)}" aria-pressed="${String(entry.gatewayId === activeId)}">${entry.gatewayId === activeId ? 'Active target' : 'Make active'}</button>
        <button type="button" class="pm-btn ghost" data-gateway-action="reconnect" data-gateway-id="${escapeHtml(entry.gatewayId)}">Reconnect</button>
        <button type="button" class="pm-btn ghost" data-gateway-action="repair" data-gateway-id="${escapeHtml(entry.gatewayId)}">Repair</button>
        <button type="button" class="pm-btn ghost danger" data-gateway-action="forget" data-gateway-id="${escapeHtml(entry.gatewayId)}">Forget</button>
        ${token ? `<button type="button" class="pm-btn ghost danger" data-gateway-action="revoke" data-gateway-id="${escapeHtml(entry.gatewayId)}">Revoke phone</button>` : ''}
      </div>
    </article>`;
}

export async function renderMobileGatewaysPage(page, { navigate }) {
  if (!isMobileGatewayCatalogEnabled()) {
    page.innerHTML = `${renderMobileHeader({ title: 'Gateway Connections', online: true, leftIcon: 'back', hideTitle: false })}<main class="pm-body pm-gateways-page"><section class="pm-gateway-card"><h2>Gateway Connections unavailable</h2><p class="pm-gateway-empty">This phone-side multi-gateway slice is disabled. Existing single-gateway mobile chat remains available.</p></section></main>`;
    wireHeaderActions(page, { onLeft: () => navigate?.('#mobile/chat') });
    return page;
  }
  try { window.__pmMobileActiveGatewayOrigin = ''; window.__pmMobileActiveGatewayId = ''; } catch {}
  page.innerHTML = `
    ${renderMobileHeader({ title: 'Gateway Connections', online: true, leftIcon: 'back', hideTitle: false })}
    <main class="pm-body pm-gateways-page" id="pm-gateways-page">
      <section class="pm-gateways-intro">
        <div><strong>Independent Prometheus computers</strong><p>Choose a target without syncing its chats, workspace, browser, tasks, or secrets with another computer.</p></div>
        <button type="button" class="pm-btn primary" id="pm-gateway-add">Add gateway</button>
      </section>
      <section class="pm-gateway-scan-fallback" aria-label="Pair a gateway">
        <div><strong>Pair from a computer</strong><p>Scan the QR in that computer’s Settings → Pairing. The phone confirms the target before saving its grant.</p></div>
        <button type="button" class="pm-btn ghost" id="pm-gateway-scan">Open camera scanner</button>
      </section>
      <section class="pm-gateway-filter" aria-labelledby="pm-gateway-filter-title">
        <div class="pm-gateway-section-head"><h2 id="pm-gateway-filter-title">View filter</h2><span id="pm-gateway-filter-label">All gateways</span></div>
        <div class="pm-gateway-filter-actions"><button type="button" class="pm-btn ghost" id="pm-gateway-filter-all" aria-pressed="true">All</button><div id="pm-gateway-filter-options" class="pm-gateway-filter-options"></div></div>
      </section>
      <section aria-labelledby="pm-gateway-list-title"><div class="pm-gateway-section-head"><h2 id="pm-gateway-list-title">Connected gateways</h2><button type="button" class="pm-btn ghost" id="pm-gateway-refresh">Refresh</button></div><div id="pm-gateway-list" class="pm-gateway-list"><div class="pm-gateway-empty">Loading gateway status…</div></div></section>
    </main>`;
  wireHeaderActions(page, { onLeft: () => navigate?.('#mobile/chat') });

  const list = page.querySelector('#pm-gateway-list');
  const optionsEl = page.querySelector('#pm-gateway-filter-options');
  const filterLabel = page.querySelector('#pm-gateway-filter-label');
  const filterAll = page.querySelector('#pm-gateway-filter-all');
  let entries = loadGatewayCatalog();
  let activeId = getActiveGatewayId() || entries[0]?.gatewayId || '';

  function renderFilter() {
    const filter = getGatewayFilter();
    const selected = new Set(filter.gatewayIds || []);
    filterLabel.textContent = filter.mode === 'all' ? 'All gateways' : `${selected.size} gateway${selected.size === 1 ? '' : 's'} selected`;
    filterAll.setAttribute('aria-pressed', String(filter.mode === 'all'));
    optionsEl.innerHTML = entries.map((entry) => `<label class="pm-gateway-filter-option"><input type="checkbox" data-gateway-filter-id="${escapeHtml(entry.gatewayId)}" ${selected.has(entry.gatewayId) ? 'checked' : ''}><span>${escapeHtml(entry.name)}</span></label>`).join('');
    optionsEl.querySelectorAll('[data-gateway-filter-id]').forEach((input) => input.addEventListener('change', () => {
      const next = [...optionsEl.querySelectorAll('input:checked')].map((item) => item.getAttribute('data-gateway-filter-id'));
      setGatewayFilter(next);
      renderFilter();
      renderList();
    }));
  }

  function renderList() {
    entries = loadGatewayCatalog();
    activeId = entries.find((entry) => entry.gatewayId === activeId)?.gatewayId || entries[0]?.gatewayId || '';
    list.innerHTML = entries.length ? entries.map((entry) => _gatewayCard(entry, activeId)).join('') : '<div class="pm-gateway-empty">No gateways are paired on this phone.</div>';
    list.querySelectorAll('[data-gateway-action]').forEach((button) => button.addEventListener('click', async () => {
      const id = button.getAttribute('data-gateway-id') || '';
      const action = button.getAttribute('data-gateway-action') || '';
      try {
        button.disabled = true;
        if (action === 'active') { activeId = setActiveGatewayId(id) || activeId; renderList(); return; }
        if (action === 'reconnect') { await probeGateway(id); }
        if (action === 'forget') { if (!window.confirm('Forget this gateway from the phone? Its computer data is not deleted.')) return; forgetGateway(id); }
        if (action === 'revoke') { if (!window.confirm('Revoke this phone’s grant on the selected gateway?')) return; await revokeGateway(id); }
        if (action === 'repair') { navigate?.('#mobile/pair/add'); return; }
        renderList();
      } catch (error) {
        window.pmToast?.(error?.message || 'Gateway action failed.', 'error');
      } finally { button.disabled = false; }
    }));
  }

  page.querySelector('#pm-gateway-add')?.addEventListener('click', () => navigate?.('#mobile/pair/add'));
  page.querySelector('#pm-gateway-scan')?.addEventListener('click', () => {
    try { sessionStorage.setItem('pm_open_pairing_scanner', '1'); } catch {}
    if (typeof window.__pmMobilePairingScanner === 'function') window.__pmMobilePairingScanner();
    else navigate?.('#mobile/chat');
  });
  page.querySelector('#pm-gateway-refresh')?.addEventListener('click', async () => { await refreshGatewayStatuses(); renderList(); });
  filterAll?.addEventListener('click', () => { setGatewayFilter(entries.map((entry) => entry.gatewayId)); renderFilter(); renderList(); });
  const unsubscribe = onGatewayCatalogChanged(() => { renderFilter(); renderList(); });
  page._pmCleanup = () => unsubscribe();
  renderFilter();
  renderList();
  refreshGatewayStatuses().then(() => { renderList(); }).catch(() => { renderList(); });
  return page;
}
