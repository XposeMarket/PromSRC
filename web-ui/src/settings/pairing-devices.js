/**
 * pairing-devices.js — Settings > Pairing: the pairing-admin API, the pairing
 * QR, phones waiting for approval, paired devices, and live pairing events.
 * Moved out of SettingsPage.js unchanged (file-size budget); SettingsPage keeps
 * the panel loader and the remote-access (Tailscale Funnel) controls.
 */
import { api } from '../api.js';
import { escHtml, showToast } from '../utils.js';
import { openSheet, skIcon } from './settings-kit.js';

let _pairingPollTimer = null;
let _pairingCurrentChallenge = null;
let _pairingBrowserAdminToken = '';

export async function pairingAdminApi(path, opts = {}) {
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
      // The credential row is folded under Advanced; open it when it is needed.
      const fold = document.querySelector('#settings-panel-pairing [data-fold="pairing-admin"]');
      if (fold && fold.getAttribute('aria-expanded') !== 'true') fold.click();
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

/** The current pairing challenge (QR link and pair code), or null. */
export function pairingChallenge() { return _pairingCurrentChallenge; }
/** Pairing-admin credential typed in this browser tab (never stored). */
export function pairingBrowserAdminToken() { return _pairingBrowserAdminToken; }
export function setPairingBrowserAdminToken(value) { _pairingBrowserAdminToken = String(value || ''); }

export function _stopPairingPolling() {
  if (_pairingPollTimer) { clearInterval(_pairingPollTimer); _pairingPollTimer = null; }
}
export function _startPairingPolling() {
  _stopPairingPolling();
  _pairingPollTimer = setInterval(() => {
    if (window.settingsTab !== 'pairing') { _stopPairingPolling(); return; }
    refreshPairingPending().catch(() => {});
  }, 3000);
}

export async function refreshPairingQR() {
  const wrap = document.getElementById('pairing-qr-wrap');
  const meta = document.getElementById('pairing-qr-meta');
  if (wrap) wrap.innerHTML = '<div style="color:var(--muted);font-size:12px">Generating QR…</div>';
  try {
    const r = await pairingAdminApi('/api/pairing/qr', { method: 'POST', body: JSON.stringify({}) });
    if (r?.code === 'lan_access_off') {
      if (wrap) wrap.style.display = 'none';
      const disabled = document.getElementById('pairing-lan-disabled');
      if (disabled) { disabled.textContent = r.error || 'Local network pairing is off. Enable LAN access above, then restart Prometheus.'; disabled.style.display = ''; }
      return;
    }
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
            <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:clamp(22px,4vw,34px);font-weight:900;letter-spacing:.08em;line-height:1.15;color:var(--text);background:color-mix(in srgb, var(--text) 6%, transparent);border:1px solid color-mix(in srgb, var(--text) 8%, transparent);border-radius:10px;padding:14px 16px;text-align:center;word-break:break-word;">
              ${escHtml(pairCode || 'PAIR-....-....')}
            </div>
            <div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;">Gateway address</div>
            <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:var(--text);background:color-mix(in srgb, var(--text) 4%, transparent);border:1px solid color-mix(in srgb, var(--text) 8%, transparent);border-radius:8px;padding:8px 9px;word-break:break-all;">${escHtml(pairingOrigin || 'Unavailable')}</div>
            <div style="font-size:12px;color:var(--muted);line-height:1.45;">Scan the QR from Safari, or open this gateway address on the phone first and enter the pair code. You can also paste the full pairing link.</div>
            <button type="button" class="sk-btn sk-copy-code" id="pairing-copy-code-btn">Copy code</button>
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
        ? `<div style="margin-top:6px;color:#f5c46b;background:color-mix(in srgb, #f5b544 12%, transparent);border:none;border-radius:8px;padding:6px 8px">${escHtml(r.warning)}</div>`
        : '';
      const lan = Array.isArray(r.lanOrigins) && r.lanOrigins.length
        ? `<div style="margin-top:4px;color:var(--muted);font-size:11px">LAN: ${r.lanOrigins.map(x => `<span style="word-break:break-all">${escHtml(x)}</span>`).join(', ')}</div>`
        : '';
      const remoteBadge = r.remoteAccess && r.remoteAccess.active
        ? `<div style="margin-top:6px;color:var(--brand);background:color-mix(in srgb, var(--brand) 14%, transparent);border:1px solid color-mix(in srgb, var(--brand) 30%, transparent);border-radius:8px;padding:6px 8px;font-size:11px">Remote access ON — QR uses public URL (${escHtml(String(r.remoteAccess.mode || 'custom'))})</div>`
        : '';
      meta.innerHTML = `Expires at <strong>${escHtml(expires)}</strong> · <span style="word-break:break-all">${escHtml(r.pairUrl)}</span>${remoteBadge}${warning}${lan}`;
    }
  } catch (err) {
    if (wrap) wrap.innerHTML = `<div style="color:#f87171;font-size:12px">${escHtml(err.message || 'Failed to generate QR')}</div>`;
  }
}

export async function refreshPairingPending() {
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
    list.closest('.sk-card')?.classList.toggle('sk-card-attn', reqs.length > 0);
    if (!reqs.length) {
      list.innerHTML = '<div class="sk-empty-row">No phones are waiting.</div>';
      return;
    }
    list.innerHTML = reqs.map(req => `
      <div class="sk-row" data-pairing-req="${escHtml(req.id)}">
        <div class="sk-who"><span class="sk-tile" aria-hidden="true">${skIcon('device')}</span><div class="sk-copy">
          <div class="sk-name">${escHtml(req.deviceName || 'Phone')}</div>
          <div class="sk-desc">${escHtml(_summarizeUA(req.userAgent))}${req.ipHint ? ` · ${escHtml(req.ipHint)}` : ''} · wants to pair</div>
        </div></div>
        <div class="sk-ctl">
          <button type="button" class="sk-btn ghost" data-pairing-action="deny" data-id="${escHtml(req.id)}">Deny</button>
          <button type="button" class="sk-btn primary" data-pairing-action="approve" data-id="${escHtml(req.id)}">Allow</button>
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
    list.innerHTML = `<div style="color:#f87171;font-size:12px">${escHtml(err.message || 'Failed to load pending requests')}</div>`;
  }
}

export async function refreshPairedDevices() {
  const list  = document.getElementById('pairing-device-list');
  const count = document.getElementById('pairing-device-count');
  if (!list) return;
  try {
    const r = await pairingAdminApi('/api/pairing/devices');
    const devices = Array.isArray(r?.devices) ? r.devices : [];
    if (count) count.textContent = String(devices.length);
    if (!devices.length) {
      list.innerHTML = '<div class="sk-empty-row">No devices paired yet.</div>';
      return;
    }
    const byId = new Map(devices.map((d) => [String(d.id), d]));
    // One quiet "Manage" per row; the actions (turn off/on, owner approvals,
    // remove) live in a small sheet instead of a row of loud buttons per device.
    list.innerHTML = devices.map(d => {
      const enabled = d.enabled !== false;
      const seen = d.lastSeenAt ? `Last seen ${_pairingTimeAgo(d.lastSeenAt)}` : 'Not used yet';
      return `
        <div class="sk-row${enabled ? '' : ' sk-row-off'}" data-pairing-device="${escHtml(d.id)}">
          <div class="sk-who"><span class="sk-tile" aria-hidden="true">${skIcon('device')}</span><div class="sk-copy">
            <div class="sk-name">${escHtml(d.name || 'Device')}${enabled ? '' : ' <span class="sk-pill" data-state="off">Turned off</span>'}${d.ownerApproval ? ' <span class="sk-pill">Can approve</span>' : ''}</div>
            <div class="sk-desc">${escHtml(_summarizeUA(d.lastUserAgent))} · ${escHtml(seen)}</div>
          </div></div>
          <div class="sk-ctl"><button type="button" class="sk-btn ghost" data-device-menu="${escHtml(d.id)}" aria-label="Manage ${escHtml(d.name || 'device')}">Manage</button></div>
        </div>
      `;
    }).join('');

    const runDeviceAction = async (btn) => {
      const id = btn.getAttribute('data-id');
      const act = btn.getAttribute('data-device-action');
      btn.disabled = true; btn.style.opacity = '0.6';
      try {
        if (act === 'toggle') {
          const next = btn.getAttribute('data-next') === 'true';
          const ok = await pairingAdminApi(`/api/pairing/devices/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ enabled: next }) });
          if (!ok?.success) throw new Error(ok?.error || 'Update failed');
          showToast?.(next ? 'Device enabled' : 'Device disabled', '', 'success');
        } else if (act === 'owner') {
          // PR821 I2: granting opens the native owner-approval window (code typed by the owner).
          const next = btn.getAttribute('data-next') === 'true';
          const ok = await pairingAdminApi(`/api/pairing/devices/${encodeURIComponent(id)}/owner-approval`, { method: next ? 'POST' : 'DELETE', body: next ? JSON.stringify({}) : undefined });
          if (!ok?.success) throw new Error(ok?.error || 'Update failed');
          showToast?.(next ? 'Phone can approve protected access' : 'Phone owner approvals stopped', '', 'success');
        } else if (act === 'remove') {
          if (!confirm('Remove this device? The user will need to scan a new QR to pair again.')) { btn.disabled = false; btn.style.opacity = ''; return false; }
          const ok = await pairingAdminApi(`/api/pairing/devices/${encodeURIComponent(id)}`, { method: 'DELETE' });
          if (!ok?.success) throw new Error(ok?.error || 'Remove failed');
          showToast?.('Device removed', '', 'success');
        }
        await refreshPairedDevices();
        return true;
      } catch (err) {
        showToast?.('Action failed', err.message, 'error');
        btn.disabled = false; btn.style.opacity = '';
        return false;
      }
    };

    list.querySelectorAll('[data-device-menu]').forEach(menuBtn => {
      menuBtn.addEventListener('click', () => {
        const d = byId.get(menuBtn.getAttribute('data-device-menu'));
        if (!d) return;
        const enabled = d.enabled !== false;
        const id = escHtml(d.id);
        const seen = d.lastSeenAt ? `last seen ${_pairingTimeAgo(d.lastSeenAt)}` : 'not used yet';
        const owner = enabled && window.prometheusOwnerConsent
          ? `<div class="sk-row"><div class="sk-who"><div class="sk-copy"><div class="sk-name">Owner approvals</div><div class="sk-desc">${d.ownerApproval ? 'This phone can save and approve protected access.' : 'Let this phone save and approve protected access. Asks for a code on this computer.'}</div></div></div><div class="sk-ctl"><button type="button" class="sk-btn" data-device-action="owner" data-id="${id}" data-next="${d.ownerApproval ? 'false' : 'true'}">${d.ownerApproval ? 'Stop' : 'Allow'}</button></div></div>`
          : '';
        const sheet = openSheet({
          title: d.name || 'Device',
          sub: `${_summarizeUA(d.lastUserAgent)} · ${seen}${d.lastIpHint ? ` · ${d.lastIpHint}` : ''}`,
          body: `<div class="sk-card">
            <div class="sk-row"><div class="sk-who"><div class="sk-copy"><div class="sk-name">Access</div><div class="sk-desc">${enabled ? 'This device can use Prometheus.' : 'Turned off. This device is blocked until you turn it back on.'}</div></div></div>
              <div class="sk-ctl"><button type="button" class="sk-btn" data-device-action="toggle" data-id="${id}" data-next="${enabled ? 'false' : 'true'}">${enabled ? 'Turn off' : 'Turn on'}</button></div></div>
            ${owner}
            <div class="sk-row"><div class="sk-who"><div class="sk-copy"><div class="sk-name">Remove device</div><div class="sk-desc">Forget this device. It has to pair again with a new QR.</div></div></div>
              <div class="sk-ctl"><button type="button" class="sk-btn danger" data-device-action="remove" data-id="${id}">Remove</button></div></div>
          </div>`,
          cls: 'sk-sheet-device',
        });
        sheet.body.addEventListener('click', async (event) => {
          const btn = event.target.closest('[data-device-action]');
          if (btn && await runDeviceAction(btn)) sheet.close();
        });
      });
    });
  } catch (err) {
    list.innerHTML = `<div style="color:#f87171;font-size:12px">${escHtml(err.message || 'Failed to load devices')}</div>`;
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
