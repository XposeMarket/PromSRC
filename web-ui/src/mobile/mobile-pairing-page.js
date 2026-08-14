// Pairing-only mobile route. Keep this out of the normal mobile page bundle.
import {
  renderMobileHeader,
  wireHeaderActions,
} from './mobile-shell.js?v=pm-v291-2026-08-13-mobile-syntax-recovery';
import {
  claimPairing,
  pollPairing,
  verifyPairingMe,
  getDeviceToken,
  setDeviceToken,
  clearDeviceToken,
} from './mobile-api.js';
import {
  getPairingPayload,
  pairingGatewayFetchJson,
  upsertGateway,
  setActiveGatewayId,
  normalizeGatewayOrigin,
  clearPendingGatewayPair,
} from './mobile-gateway-catalog.js';
import { checkSessionDetailed, getAccount, mountLoginScreen } from '../auth/account.js';

function _deviceFingerprint() {
  try {
    let fp = localStorage.getItem('pm_device_fp');
    if (!fp) {
      fp = (crypto?.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2)));
      localStorage.setItem('pm_device_fp', fp);
    }
    return fp;
  } catch { return 'unknown'; }
}

function _pairRequestCacheKey(code) {
  return `pm_pair_request_${encodeURIComponent(String(code || '').trim()).slice(0, 180)}`;
}

function _loadPairRequestCache(code) {
  try {
    const key = _pairRequestCacheKey(code);
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached?.requestId) return null;
    const expiresAt = Number(cached.expiresAt || 0);
    if (expiresAt && expiresAt < Date.now() - 30_000) {
      sessionStorage.removeItem(key);
      return null;
    }
    return cached;
  } catch { return null; }
}

function _storePairRequestCache(code, request) {
  try {
    if (!request?.requestId) return;
    sessionStorage.setItem(_pairRequestCacheKey(code), JSON.stringify({
      requestId: request.requestId,
      expiresAt: request.expiresAt || (Date.now() + 10 * 60 * 1000),
    }));
  } catch {}
}

function _clearPairRequestCache(code) {
  try { sessionStorage.removeItem(_pairRequestCacheKey(code)); } catch {}
}

function _suggestedDeviceName() {
  const ua = navigator.userAgent || '';
  if (/iPhone/i.test(ua))  return 'iPhone';
  if (/iPad/i.test(ua))    return 'iPad';
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Android phone' : 'Android tablet';
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua))   return 'Windows';
  return 'Mobile device';
}

function _parsePairingEntry(value) {
  const raw = String(value || '').trim();
  if (!raw) return { code: '', origin: normalizeGatewayOrigin(window.location.origin), fullLink: '' };
  try {
    const url = new URL(raw);
    if (['http:', 'https:'].includes(url.protocol)) {
      const embeddedCode = String(url.searchParams.get('pair') || '').trim();
      if (embeddedCode) {
        return {
          code: embeddedCode,
          origin: normalizeGatewayOrigin(url.origin),
          fullLink: url.href,
        };
      }
    }
  } catch {}
  return { code: raw, origin: normalizeGatewayOrigin(window.location.origin), fullLink: '' };
}

async function _ensureAccountBeforePairing(setStage) {
  const current = getAccount();
  if (current?.accessActive || current?.purchaseActive || current?.subscriptionActive || current?.isAdmin) return true;
  const result = await checkSessionDetailed({ timeoutMs: 3000 }).catch(() => null);
  const account = result?.account || getAccount();
  if (result?.authenticated && (account?.accessActive || account?.purchaseActive || account?.subscriptionActive || account?.isAdmin)) return true;

  setStage({
    title: 'Sign in to pair',
    sub: 'Use your Prometheus account first. After login, this phone will ask the desktop for approval.',
    status: '',
    actions: '',
  });

  await new Promise((resolve) => {
    mountLoginScreen(() => resolve(true));
  });
  return true;
}

export async function renderPairPage(page, { code, navigate, addMode = false }) {
  const pairRoute = addMode ? '#mobile/pair/add' : '#mobile/pair';
  const pairingPayload = getPairingPayload(code);
  const pairingCode = pairingPayload?.challenge || String(code || '').trim();
  const looksLikeEncodedQrPayload = !pairingPayload
    && String(code || '').trim().length >= 80
    && !/^PAIR(?:-[A-Z0-9]{4}){2}$/i.test(String(code || '').trim());
  const targetOrigin = pairingPayload?.origin || normalizeGatewayOrigin(window.location.origin);
  const targetHint = pairingPayload?.gatewayId ? {
    gatewayId: pairingPayload.gatewayId,
    name: pairingPayload.name,
    platform: pairingPayload.platform,
    version: pairingPayload.gatewayVersion,
    origin: targetOrigin,
  } : null;
  page.innerHTML = `
    ${renderMobileHeader({ title: addMode ? 'Add gateway' : 'Pair phone', online: false, leftIcon: 'menu' })}
    <div class="pm-body" style="display:flex;flex-direction:column;align-items:center;text-align:center;padding-top:8px;">
      <div id="pm-pair-stage" style="max-width:360px;width:100%;">
        <div class="pm-voice-orb" style="width:min(60vw,200px);margin:14px auto 24px;" aria-hidden="true">
          <svg viewBox="0 0 200 200" style="width:100%;height:100%;">
            <defs>
              <radialGradient id="pm-pair-core" cx="35%" cy="32%" r="70%">
                <stop offset="0%" stop-color="#fff6e6" stop-opacity="0.95"/>
                <stop offset="40%" stop-color="#ffd9a8" stop-opacity="0.55"/>
                <stop offset="100%" stop-color="var(--pm-orange)" stop-opacity="0.25"/>
              </radialGradient>
            </defs>
            <circle cx="100" cy="100" r="92" fill="url(#pm-pair-core)"/>
            <text x="100" y="118" text-anchor="middle" font-size="64" font-family="system-ui">🔗</text>
          </svg>
        </div>
        <h2 id="pm-pair-title" style="margin:0 0 6px;font-size:22px;font-weight:800;letter-spacing:-.3px;">Connecting to Prometheus…</h2>
        <p id="pm-pair-sub" style="margin:0 0 18px;color:var(--pm-muted);font-size:14px;line-height:1.5;">${addMode ? 'Adding a second Prometheus gateway to this app.' : 'Waiting for approval on your desktop.'}</p>
        <div id="pm-pair-status" style="font-size:13px;color:var(--pm-text-soft);"></div>
        <div id="pm-pair-actions" style="margin-top:24px;display:flex;flex-direction:column;gap:8px;"></div>
      </div>
    </div>
  `;
  wireHeaderActions(page, {});

  const titleEl  = page.querySelector('#pm-pair-title');
  const subEl    = page.querySelector('#pm-pair-sub');
  const statusEl = page.querySelector('#pm-pair-status');
  const actions  = page.querySelector('#pm-pair-actions');

  function setStage({ title, sub, status, actions: acts }) {
    if (title != null)  titleEl.textContent = title;
    if (sub != null)    subEl.textContent   = sub;
    if (status != null) statusEl.innerHTML  = status;
    if (acts != null)   actions.innerHTML   = acts;
  }

  if (looksLikeEncodedQrPayload) {
    if (addMode) clearPendingGatewayPair();
    setStage({
      title: 'Invalid or expired QR',
      sub: 'This pairing QR is not valid for Prometheus, or it has already expired. Generate a fresh QR on the target computer.',
      status: '',
      actions: `<button class="pm-btn primary" id="pm-pair-newqr">Try again</button><button class="pm-btn ghost" id="pm-pair-back">Gateway Connections</button>`,
    });
    page.querySelector('#pm-pair-newqr')?.addEventListener('click', () => { window.location.href = window.location.origin + `/${pairRoute}`; });
    page.querySelector('#pm-pair-back')?.addEventListener('click', () => navigate('#mobile/gateways'));
    return;
  }

  if (pairingCode) {
    await _ensureAccountBeforePairing(setStage);
  }

  // 0. Already paired? Skip the dance and just go home.
  if (getDeviceToken() && !pairingCode && !addMode) {
    const me = await verifyPairingMe();
    if (me?.success) {
      setStage({ title: 'Already paired', sub: `Welcome back, ${me.device?.name || 'device'}.`, status: '', actions: `<button class="pm-btn primary" id="pm-pair-go">Continue</button>` });
      page.querySelector('#pm-pair-go').addEventListener('click', () => navigate('#mobile/chat'));
      setTimeout(() => navigate('#mobile/chat'), 800);
      return;
    }
    clearDeviceToken();
  }

  if (!pairingCode) {
    setStage({
      title: addMode ? 'Add a gateway' : 'Pair this phone',
      sub: 'On the target computer, open Settings → Pairing and scan its QR. If camera scanning is unavailable, enter the short-lived pair code here.',
      status: '',
      actions: `
        <form id="pm-pair-code-form" style="display:flex;flex-direction:column;gap:10px;">
          <input id="pm-pair-code-input" inputmode="text" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" placeholder="PAIR-ABCD-1234 or paste link" style="width:100%;box-sizing:border-box;border:1px solid var(--pm-border);border-radius:12px;background:var(--pm-bg-soft);color:var(--pm-text);padding:14px 16px;text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:18px;font-weight:800;letter-spacing:.08em;" />
          <input id="pm-pair-origin-input" type="url" inputmode="url" autocomplete="url" spellcheck="false" value="${_escapeHtml(window.location.origin)}" placeholder="https://your-machine.ts.net" style="width:100%;box-sizing:border-box;border:1px solid var(--pm-border);border-radius:12px;background:var(--pm-bg-soft);color:var(--pm-text);padding:11px 13px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;" />
          <div style="font-size:12px;color:var(--pm-muted);line-height:1.45;">Use the Gateway address shown on the desktop. If you paste the full pairing link above, this address is ignored.</div>
          <button class="pm-btn primary" type="submit">Pair with code</button>
          <button class="pm-btn ghost" type="button" id="pm-pair-retry">I scanned the QR</button>
        </form>`,
    });
    const form = page.querySelector('#pm-pair-code-form');
    const input = page.querySelector('#pm-pair-code-input');
    const originInput = page.querySelector('#pm-pair-origin-input');
    input?.focus?.();
    input?.addEventListener('input', () => {
      const raw = String(input.value || '');
      // Pair codes are case-insensitive; base64url pairing links are not.
      input.value = /^https?:\/\//i.test(raw.trim()) ? raw : raw.toUpperCase();
    });
    form?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const typed = String(input?.value || '').trim();
      const parsed = _parsePairingEntry(typed);
      if (!parsed.code) {
        statusEl.innerHTML = '<span style="color:var(--pm-red);">Enter the pair code from desktop Settings.</span>';
        return;
      }
      if (parsed.fullLink) {
        window.location.href = parsed.fullLink;
        return;
      }
      const targetOrigin = normalizeGatewayOrigin(originInput?.value || parsed.origin || window.location.origin);
      if (!targetOrigin) {
        statusEl.innerHTML = '<span style="color:var(--pm-red);">Enter a valid gateway address, such as https://your-machine.ts.net.</span>';
        return;
      }
      window.location.href = `${targetOrigin}/?pair=${encodeURIComponent(parsed.code)}${pairRoute}`;
    });
    page.querySelector('#pm-pair-retry')?.addEventListener('click', () => location.reload());
    return;
  }

  if (!pairingCode) {
    setStage({
      title: 'Pair this phone',
      sub: 'Open Prometheus on your desktop, go to Settings → Pairing, and scan the QR code that appears.',
      status: '',
      actions: `<button class="pm-btn ghost" id="pm-pair-retry">I’ve already scanned</button>`,
    });
    page.querySelector('#pm-pair-retry').addEventListener('click', () => location.reload());
    return;
  }

  // 1. Claim the QR challenge.
  let requestId;
  try {
    const cachedRequest = _loadPairRequestCache(pairingCode);
    if (cachedRequest?.requestId) {
      requestId = cachedRequest.requestId;
      setStage({ status: 'Rejoining pairing request…' });
    } else {
      setStage({ status: 'Sending pairing request…' });
      const r = pairingPayload
        ? await pairingGatewayFetchJson(targetOrigin, '/api/pairing/claim', {
          method: 'POST',
          body: JSON.stringify({ code: pairingCode, deviceName: _suggestedDeviceName(), deviceFingerprint: _deviceFingerprint() }),
        })
        : await claimPairing({ code: pairingCode, deviceName: _suggestedDeviceName(), deviceFingerprint: _deviceFingerprint() });
      if (!r?.success || !r.requestId) throw new Error(r?.error || 'Failed to claim');
      requestId = r.requestId;
      _storePairRequestCache(pairingCode, r);
    }
  } catch (err) {
    setStage({
      title: 'Couldn’t reach Prometheus',
      sub: err?.body?.error || err.message || 'Failed to claim QR code. It may have expired.',
      status: '',
      actions: `<button class="pm-btn primary" id="pm-pair-newqr">Try a new QR</button>`,
    });
    if (addMode) clearPendingGatewayPair();
    page.querySelector('#pm-pair-newqr').addEventListener('click', () => {
      window.location.href = window.location.origin + `/${pairRoute}`;
    });
    return;
  }

  // 2. Poll for approval.
  setStage({
    title: 'Waiting for approval',
    sub: addMode ? 'Approve this gateway on its desktop to add it here.' : 'Tap Allow on your desktop to connect this phone.',
    status: '<span style="display:inline-flex;align-items:center;gap:8px;"><span class="pm-pair-spinner" style="display:inline-block;width:14px;height:14px;border:2px solid var(--pm-orange);border-right-color:transparent;border-radius:50%;animation:pm-spin 1s linear infinite;"></span> Listening…</span>',
    actions: `<button class="pm-btn ghost" id="pm-pair-cancel">Cancel</button>`,
  });

  // Inject keyframes for the spinner if not present.
  if (!document.getElementById('pm-pair-anim')) {
    const s = document.createElement('style');
    s.id = 'pm-pair-anim';
    s.textContent = '@keyframes pm-spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(s);
  }

  let cancelled = false;
  page.querySelector('#pm-pair-cancel').addEventListener('click', () => {
    cancelled = true;
    _clearPairRequestCache(pairingCode);
    if (addMode) clearPendingGatewayPair();
    navigate('#mobile/gateways');
  });

  const startedAt = Date.now();
  const POLL_MS = 1500;
  while (!cancelled) {
    if (Date.now() - startedAt > 10 * 60 * 1000) {
      _clearPairRequestCache(pairingCode);
      if (addMode) clearPendingGatewayPair();
      setStage({ title: 'Pairing timed out', sub: 'The request expired. Please ask the desktop for a new QR.', status: '', actions: `<button class="pm-btn primary" id="pm-pair-newqr">Try again</button>` });
      page.querySelector('#pm-pair-newqr').addEventListener('click', () => { window.location.href = window.location.origin + `/${pairRoute}`; });
      return;
    }
    try {
      const r = pairingPayload
        ? await pairingGatewayFetchJson(targetOrigin, `/api/pairing/poll/${encodeURIComponent(requestId)}`, {
          headers: { 'X-Pairing-Device-Fingerprint': _deviceFingerprint() },
        })
        : await pollPairing(requestId, _deviceFingerprint());
      if (r.status === 'approved' && r.deviceToken) {
        _clearPairRequestCache(pairingCode);
        const gateway = {
          ...(targetHint || {}),
          ...(r.gateway || {}),
          origin: normalizeGatewayOrigin(r.gateway?.origin || targetOrigin),
          gatewayId: String(r.gateway?.gatewayId || targetHint?.gatewayId || '').trim(),
        };
        if (!gateway.gatewayId || !gateway.origin) {
          if (addMode) clearPendingGatewayPair();
          setStage({ title: 'Target identity unavailable', sub: 'The computer approved pairing but did not return a stable gateway identity. Nothing was saved.', status: '', actions: `<button class="pm-btn primary" id="pm-pair-newqr">Try again</button>` });
          page.querySelector('#pm-pair-newqr')?.addEventListener('click', () => { window.location.href = window.location.origin + `/${pairRoute}`; });
          return;
        }
        if ((targetHint?.gatewayId && gateway.gatewayId !== targetHint.gatewayId)
            || (targetOrigin && gateway.origin !== targetOrigin)) {
          if (addMode) clearPendingGatewayPair();
          setStage({ title: 'Wrong gateway identity', sub: 'The approved response did not match the computer represented by this QR. Nothing was saved.', status: '', actions: `<button class="pm-btn primary" id="pm-pair-newqr">Start again</button>` });
          page.querySelector('#pm-pair-newqr')?.addEventListener('click', () => { window.location.href = window.location.origin + `/${pairRoute}`; });
          return;
        }
        const displayName = String(gateway.name || 'Prometheus gateway');

        // A normal QR/deep-link pairing is always a primary connection to the
        // gateway that owns the URL. If an embedded browser kept the old hub
        // document instead of following the link, move it to the target before
        // saving the target's primary device token. The in-app scanner never
        // enters this branch because it passes addMode=true.
        if (!addMode && normalizeGatewayOrigin(targetOrigin) !== normalizeGatewayOrigin(window.location.origin)) {
          setStage({ title: 'Opening target gateway…', sub: `Connecting to ${displayName}.`, status: '', actions: '' });
          window.location.href = `${targetOrigin}/?pair=${encodeURIComponent(String(code || pairingCode))}#mobile/pair`;
          return;
        }

        if (!addMode) {
          setDeviceToken(r.deviceToken, r.deviceId);
          clearPendingGatewayPair();
          try { localStorage.setItem('pm_force_mobile', '1'); } catch {}
          setStage({
            title: 'Phone connected',
            sub: `${displayName} approved this phone. Opening your chats…`,
            status: '✅',
            actions: `<button class="pm-btn primary" id="pm-pair-open-chat">Open chat</button>`,
          });
          page.querySelector('#pm-pair-open-chat')?.addEventListener('click', () => navigate('#mobile/chat'));
          setTimeout(() => { if (!cancelled) navigate('#mobile/chat'); }, 450);
          return;
        }

        setStage({
          title: 'Confirm this gateway',
          sub: `Pair this phone with ${displayName}? The target computer approved the request.`,
          status: `<div style="display:grid;gap:4px;text-align:left;border:1px solid var(--pm-border);border-radius:12px;padding:12px 14px;background:var(--pm-bg-soft);"><strong>${_escapeHtml(displayName)}</strong><span>${_escapeHtml(String(gateway.platform || 'unknown'))} · ${_escapeHtml(String(gateway.version || 'unknown'))}</span><small>${_escapeHtml(String(gateway.origin || targetOrigin))}</small></div>`,
          actions: `<button class="pm-btn primary" id="pm-pair-confirm">Confirm gateway</button><button class="pm-btn ghost" id="pm-pair-reject">Cancel</button>`,
        });
        const confirmed = await new Promise((resolve) => {
          page.querySelector('#pm-pair-confirm')?.addEventListener('click', () => resolve(true), { once: true });
          page.querySelector('#pm-pair-reject')?.addEventListener('click', () => resolve(false), { once: true });
        });
        if (!confirmed) {
          clearPendingGatewayPair();
          setStage({ title: 'Pairing cancelled', sub: 'No credential was saved on this phone.', status: '', actions: `<button class="pm-btn ghost" id="pm-pair-back">Back to gateways</button>` });
          page.querySelector('#pm-pair-back')?.addEventListener('click', () => navigate('#mobile/gateways'));
          return;
        }
        upsertGateway(gateway, { token: r.deviceToken, deviceId: r.deviceId });
        setActiveGatewayId(gateway.gatewayId);
        // Preserve the old one-gateway token only for the original same-origin
        // target. Every other gateway gets its own credential slot.
        if (!getDeviceToken() && normalizeGatewayOrigin(targetOrigin) === normalizeGatewayOrigin(window.location.origin)) {
          setDeviceToken(r.deviceToken, r.deviceId);
        }
        clearPendingGatewayPair();
        try { localStorage.setItem('pm_force_mobile', '1'); } catch {}
        setStage({ title: 'Gateway connected', sub: `${displayName} is now available as an independent target.`, status: '✅', actions: `<button class="pm-btn primary" id="pm-pair-done">View gateway connections</button>` });
        page.querySelector('#pm-pair-done')?.addEventListener('click', () => navigate('#mobile/gateways'));
        return;
      }
      if (r.status === 'approved_already_collected') {
        _clearPairRequestCache(pairingCode);
        if (addMode) clearPendingGatewayPair();
        setStage({
          title: 'Approval already completed',
          sub: 'This one-time pairing approval was already collected. Generate a fresh QR and start again.',
          status: '',
          actions: `<button class="pm-btn primary" id="pm-pair-newqr">Start a fresh pairing</button><button class="pm-btn ghost" id="pm-pair-back">Gateway Connections</button>`,
        });
        page.querySelector('#pm-pair-newqr')?.addEventListener('click', () => { window.location.href = window.location.origin + `/${pairRoute}`; });
        page.querySelector('#pm-pair-back')?.addEventListener('click', () => navigate('#mobile/gateways'));
        return;
      }
      if (r.status === 'denied') {
        _clearPairRequestCache(pairingCode);
        if (addMode) clearPendingGatewayPair();
        setStage({ title: 'Pairing denied', sub: 'Your desktop user denied this request. You can try again with a new QR.', status: '', actions: `<button class="pm-btn primary" id="pm-pair-newqr">Try again</button>` });
        page.querySelector('#pm-pair-newqr').addEventListener('click', () => { window.location.href = window.location.origin + `/${pairRoute}`; });
        return;
      }
      if (r.status === 'expired' || r.status === 'not_found') {
        _clearPairRequestCache(pairingCode);
        if (addMode) clearPendingGatewayPair();
        setStage({ title: 'QR expired', sub: 'Please generate a fresh QR on your desktop and scan again.', status: '', actions: `<button class="pm-btn primary" id="pm-pair-newqr">Reload</button>` });
        page.querySelector('#pm-pair-newqr').addEventListener('click', () => { window.location.href = window.location.origin + `/${pairRoute}`; });
        return;
      }
    } catch (err) {
      // Network blip — keep trying.
    }
    await new Promise(res => setTimeout(res, POLL_MS));
  }
}

function _escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
