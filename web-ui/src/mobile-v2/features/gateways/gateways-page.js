import { escapeHtml, loading, emptyState } from '../../ui/page-kit.js';

function statusName(value) {
  const status = String(value || 'unknown').toLowerCase();
  return status === 'online' ? 'Online' : status === 'revoked' ? 'Needs approval' : status === 'offline' ? 'Offline' : 'Checking';
}

function statusClass(value) {
  const status = String(value || 'unknown').toLowerCase();
  return ['online', 'offline', 'revoked', 'suspect'].includes(status) ? `is-${status}` : 'is-unknown';
}

function timeAgo(value) {
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

function gatewayCard(entry, selected) {
  return `<article class="pm-gateway-card ${statusClass(entry.status)}" data-gateway-card="${escapeHtml(entry.id)}">
    <div class="pm-gateway-card-head">
      <div class="pm-gateway-card-title-wrap"><span class="pm-gateway-status-dot" aria-hidden="true"></span><div>
        <h2>${escapeHtml(entry.name)}</h2>
        <p>${escapeHtml(entry.platform || 'Prometheus')} · ${escapeHtml(entry.version || 'version unavailable')}</p>
      </div></div>
      <span class="pm-gateway-status-label">${escapeHtml(statusName(entry.status))}</span>
    </div>
    <dl class="pm-gateway-meta">
      <div><dt>Last contact</dt><dd>${escapeHtml(timeAgo(entry.lastSeenAt))}</dd></div>
      <div><dt>Gateway address</dt><dd>${escapeHtml(entry.origin)}</dd></div>
      ${entry.workspaceLabel ? `<div><dt>Workspace</dt><dd>${escapeHtml(entry.workspaceLabel)}</dd></div>` : ''}
      ${entry.protocolVersion ? `<div><dt>Protocol</dt><dd>${escapeHtml(entry.protocolVersion)}</dd></div>` : ''}
    </dl>
    ${entry.lastError || entry.error ? `<p class="pm-gateway-error">${escapeHtml(entry.lastError || entry.error?.message || 'Gateway is unavailable.')}</p>` : ''}
    <div class="pm-gateway-card-actions">
      <button type="button" class="pm-btn ${selected ? 'primary' : 'ghost'}" data-gateway-action="select" data-gateway-id="${escapeHtml(entry.id)}" ${selected ? 'aria-pressed="true"' : ''}>${selected ? 'Selected' : 'Use gateway'}</button>
      <button type="button" class="pm-btn ghost" data-gateway-action="reconnect" data-gateway-id="${escapeHtml(entry.id)}">Reconnect</button>
      <button type="button" class="pm-btn ghost" data-gateway-action="repair" data-gateway-id="${escapeHtml(entry.id)}">Repair</button>
      <button type="button" class="pm-btn ghost danger" data-gateway-action="forget" data-gateway-id="${escapeHtml(entry.id)}">Forget</button>
    </div>
  </article>`;
}

export async function mountGatewaysPage({ shell, gateways }) {
  shell.setActiveTab('chat');
  shell.setTitle('Gateway Connections');
  shell.renderHeader?.({ leftIcon: 'back' });
  const page = shell.page;
  let disposed = false;
  let entries = gateways.list();
  let visibleIds = new Set(entries.map((entry) => entry.id));

  page.innerHTML = `<div class="pm-gateways-page" style="overflow:visible;padding:14px 0 24px">
    <section class="pm-gateway-scan-fallback" aria-label="Pair a gateway">
      <div><strong>Pair from a computer</strong><p>Scan the QR in the target computer’s Settings → Pairing, or enter its short-lived code.</p></div>
      <button type="button" class="pm-btn ghost" id="pm-gateway-add">Add gateway</button>
    </section>
    <section class="pm-gateway-filter" aria-labelledby="pm-gateway-devices-title">
      <div class="pm-gateway-section-head"><h2 id="pm-gateway-devices-title">Devices</h2><button type="button" class="pm-btn ghost" id="pm-gateway-device-add" aria-label="Add device" title="Add device">+</button></div>
      <div class="pm-gateway-filter-actions"><button type="button" class="pm-btn ghost" id="pm-gateway-filter-all" aria-pressed="true">All</button><div id="pm-gateway-filter-options" class="pm-gateway-filter-options"></div></div>
    </section>
    <section aria-labelledby="pm-gateway-list-title"><div class="pm-gateway-section-head"><h2 id="pm-gateway-list-title">Connected gateways</h2><button type="button" class="pm-btn ghost" id="pm-gateway-refresh">Refresh</button></div><div id="pm-gateway-list" class="pm-gateway-list">${loading('Checking gateway status…')}</div></section>
  </div>`;

  const list = page.querySelector('#pm-gateway-list');
  const options = page.querySelector('#pm-gateway-filter-options');
  const allButton = page.querySelector('#pm-gateway-filter-all');
  const add = () => shell.navigate?.('pair/add');
  page.querySelector('#pm-gateway-add')?.addEventListener('click', add);
  page.querySelector('#pm-gateway-device-add')?.addEventListener('click', add);
  page.querySelector('#pm-gateway-refresh')?.addEventListener('click', () => refresh(true));
  allButton?.addEventListener('click', () => { visibleIds = new Set(entries.map((entry) => entry.id)); renderFilter(); renderList(); });

  function renderFilter() {
    const all = visibleIds.size === entries.length;
    allButton?.setAttribute('aria-pressed', String(all));
    options.innerHTML = entries.map((entry) => `<label class="pm-gateway-filter-option"><input type="checkbox" data-gateway-filter-id="${escapeHtml(entry.id)}" ${visibleIds.has(entry.id) ? 'checked' : ''}><span>${escapeHtml(entry.name)}</span></label>`).join('');
    options.querySelectorAll('[data-gateway-filter-id]').forEach((input) => input.addEventListener('change', () => {
      const id = input.dataset.gatewayFilterId;
      if (input.checked) visibleIds.add(id); else visibleIds.delete(id);
      renderFilter();
      renderList();
    }));
  }

  function renderList() {
    entries = gateways.list();
    for (const id of [...visibleIds]) if (!entries.some((entry) => entry.id === id)) visibleIds.delete(id);
    if (visibleIds.size === 0 && entries.length) {
      list.innerHTML = emptyState('No devices selected', 'Choose a device above to show its gateway card.');
    } else {
      const shown = entries.filter((entry) => visibleIds.has(entry.id));
      list.innerHTML = shown.length ? shown.map((entry) => gatewayCard(entry, entry.id === gateways.activeId)).join('') : `<div class="pm-gateway-empty">${escapeHtml('No gateways are paired on this phone.')}</div>`;
    }
    list.querySelectorAll('[data-gateway-action]').forEach((button) => button.addEventListener('click', () => handleAction(button)));
  }

  async function handleAction(button) {
    const id = button.dataset.gatewayId || '';
    const action = button.dataset.gatewayAction || '';
    if (!gateways.get(id)) return;
    try {
      button.disabled = true;
      if (action === 'select') {
        const entry = gateways.select(id);
        shell.showNotice(`Using ${entry?.name || 'gateway'}.`);
      } else if (action === 'repair') {
        shell.navigate?.(`pair/${encodeURIComponent(id)}`);
        return;
      } else if (action === 'reconnect') {
        const result = await gateways.probe(id);
        if (disposed) return;
        shell.showNotice(result?.status === 'online' ? `${result.name} reconnected.` : `${result?.name || 'Gateway'} is ${statusName(result?.status).toLowerCase()}.`);
      } else if (action === 'forget') {
        if (!window.confirm('Forget this gateway from this phone? Its computer data is not deleted.')) return;
        gateways.forget(id);
        visibleIds.delete(id);
      }
      if (!disposed) { entries = gateways.list(); renderFilter(); renderList(); }
    } catch (error) {
      shell.showNotice(error?.message || 'Gateway action failed.');
    } finally {
      button.disabled = false;
    }
  }

  async function refresh(showNotice = false) {
    list.innerHTML = loading('Checking gateway status…');
    try {
      await gateways.probeAll();
    } catch (error) {
      if (!disposed) shell.showNotice(error?.message || 'Could not refresh gateways.');
    }
    if (disposed) return;
    entries = gateways.list();
    visibleIds = new Set([...visibleIds].filter((id) => entries.some((entry) => entry.id === id)));
    if (entries.length && visibleIds.size === 0) visibleIds = new Set(entries.map((entry) => entry.id));
    renderFilter();
    renderList();
    if (showNotice) shell.showNotice('Gateway status refreshed.');
  }

  const onChange = () => { if (!disposed) { entries = gateways.list(); visibleIds = new Set(entries.map((entry) => entry.id)); renderFilter(); renderList(); } };
  gateways.addEventListener('change', onChange);
  renderFilter();
  refresh();
  return () => { disposed = true; gateways.removeEventListener('change', onChange); };
}
