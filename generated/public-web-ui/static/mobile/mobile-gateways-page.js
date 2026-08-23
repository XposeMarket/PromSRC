// Mobile Gateway Connections page. A gateway is an independent Prometheus
// installation; this view never merges or writes gateway-owned state.

import {
  escapeHtml,
  renderMobileHeader,
  wireHeaderActions,
} from './mobile-shell.js';
import {
  gatewayStatusLabel,
  getGatewayFilter,
  loadGatewayCatalog,
  refreshGatewayStatuses,
  onGatewayCatalogChanged,
  setGatewayFilter,
  forgetGateway,
  getGatewayDeviceId,
  probeGateway,
  isMobileGatewayCatalogEnabled,
} from './mobile-gateway-catalog.js';

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

function _openPairingScanner(navigate) {
  try { sessionStorage.setItem('pm_open_pairing_scanner', '1'); } catch {}
  if (typeof window.__pmMobilePairingScanner === 'function') {
    window.__pmMobilePairingScanner();
    return;
  }
  navigate?.('#mobile/chat');
}

function _gatewayCard(entry) {
  const deviceId = getGatewayDeviceId(entry.gatewayId);
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
        <div><dt>Last contact</dt><dd>${escapeHtml(_timeAgo(entry.lastContactAt))}</dd></div>
        <div><dt>Target origin</dt><dd>${escapeHtml(entry.origin)}</dd></div>
        ${entry.workspaceName ? `<div><dt>Workspace</dt><dd>${escapeHtml(entry.workspaceName)}</dd></div>` : ''}
        ${deviceId ? `<div><dt>Phone grant</dt><dd><code>${escapeHtml(deviceId)}</code></dd></div>` : ''}
      </dl>
      ${entry.lastError ? `<p class="pm-gateway-error">${escapeHtml(entry.lastError)}</p>` : ''}
      <div class="pm-gateway-card-actions">
        <button type="button" class="pm-btn ghost" data-gateway-action="reconnect" data-gateway-id="${escapeHtml(entry.gatewayId)}">Reconnect</button>
        <button type="button" class="pm-btn ghost" data-gateway-action="repair" data-gateway-id="${escapeHtml(entry.gatewayId)}">Repair</button>
        <button type="button" class="pm-btn ghost danger" data-gateway-action="forget" data-gateway-id="${escapeHtml(entry.gatewayId)}">Forget</button>
      </div>
    </article>`;
}

export async function renderMobileGatewaysPage(page, { navigate }) {
  if (!isMobileGatewayCatalogEnabled()) {
    page.innerHTML = `${renderMobileHeader({ title: 'Gateway Connections', online: true, leftIcon: 'back', hideTitle: false })}<main class="pm-body pm-gateways-page"><section class="pm-gateway-card"><h2>Gateway Connections unavailable</h2><p class="pm-gateway-empty">This phone-side multi-gateway slice is disabled. Existing single-gateway mobile chat remains available.</p></section></main>`;
    wireHeaderActions(page, { onLeft: () => navigate?.('#mobile/chat') });
    return page;
  }
  try {
    window.__pmMobileActiveGatewayOrigin = '';
    window.__pmMobileActiveGatewayId = '';
    window.__pmMobileActiveGatewayToken = '';
    window.__pmMobileActiveGatewayExecutionEnabled = false;
  } catch {}
  page.innerHTML = `
    ${renderMobileHeader({ title: 'Gateway Connections', online: true, leftIcon: 'back', hideTitle: false })}
    <main class="pm-body pm-gateways-page" id="pm-gateways-page">
      <section class="pm-gateway-scan-fallback" aria-label="Pair a gateway">
        <div><strong>Pair from a computer</strong><p>Scan the QR in that computer’s Settings → Pairing. The phone confirms the target before saving its grant.</p></div>
        <button type="button" class="pm-btn ghost" id="pm-gateway-scan">Open camera scanner</button>
      </section>
      <section class="pm-gateway-filter" aria-labelledby="pm-gateway-devices-title">
        <div class="pm-gateway-section-head"><h2 id="pm-gateway-devices-title">Devices</h2><button type="button" class="pm-btn ghost" id="pm-gateway-device-add" aria-label="Add device" title="Add device">+</button></div>
        <div class="pm-gateway-filter-actions"><button type="button" class="pm-btn ghost" id="pm-gateway-filter-all" aria-pressed="true">All</button><div id="pm-gateway-filter-options" class="pm-gateway-filter-options"></div></div>
      </section>
      <section aria-labelledby="pm-gateway-list-title"><div class="pm-gateway-section-head"><h2 id="pm-gateway-list-title">Connected gateways</h2><button type="button" class="pm-btn ghost" id="pm-gateway-refresh">Refresh</button></div><div id="pm-gateway-list" class="pm-gateway-list"><div class="pm-gateway-empty">Loading gateway status…</div></div></section>
    </main>`;
  wireHeaderActions(page, { onLeft: () => navigate?.('#mobile/chat') });

  const list = page.querySelector('#pm-gateway-list');
  const optionsEl = page.querySelector('#pm-gateway-filter-options');
  const filterAll = page.querySelector('#pm-gateway-filter-all');
  let entries = loadGatewayCatalog();

  // The legacy View filter surface is now the compact Devices row; keep the
  // stored all/selected filter behavior because the drawer uses the same state.
  function renderFilter() {
    const filter = getGatewayFilter();
    const selected = new Set(filter.gatewayIds || []);
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
    list.innerHTML = entries.length ? entries.map((entry) => _gatewayCard(entry)).join('') : '<div class="pm-gateway-empty">No gateways are paired on this phone.</div>';
    list.querySelectorAll('[data-gateway-action]').forEach((button) => button.addEventListener('click', async () => {
      const id = button.getAttribute('data-gateway-id') || '';
      const action = button.getAttribute('data-gateway-action') || '';
      try {
        button.disabled = true;
        if (action === 'reconnect') {
          const next = await probeGateway(id);
          renderList();
          if (next?.status === 'online') window.pmToast?.(`${next.name || 'Gateway'} reconnected.`, 'success');
          else window.pmToast?.(next?.lastError || `${next?.name || 'Gateway'} is ${gatewayStatusLabel(next?.status)}.`, 'error');
          return;
        }
        if (action === 'forget') {
          if (!window.confirm('Forget this gateway from the phone? Its computer data is not deleted.')) return;
          forgetGateway(id);
        }
        if (action === 'repair') {
          _openPairingScanner(navigate);
          return;
        }
        renderList();
      } catch (error) {
        window.pmToast?.(error?.message || 'Gateway action failed.', 'error');
      } finally { button.disabled = false; }
    }));
  }

  page.querySelector('#pm-gateway-device-add')?.addEventListener('click', () => navigate?.('#mobile/pair/add'));
  page.querySelector('#pm-gateway-scan')?.addEventListener('click', () => _openPairingScanner(navigate));
  page.querySelector('#pm-gateway-refresh')?.addEventListener('click', async () => { await refreshGatewayStatuses(); renderList(); });
  filterAll?.addEventListener('click', () => { setGatewayFilter(entries.map((entry) => entry.gatewayId)); renderFilter(); renderList(); });
  const unsubscribe = onGatewayCatalogChanged(() => { renderFilter(); renderList(); });
  page._pmCleanup = () => unsubscribe();
  renderFilter();
  renderList();
  refreshGatewayStatuses().then(() => { renderList(); }).catch(() => { renderList(); });
  return page;
}
