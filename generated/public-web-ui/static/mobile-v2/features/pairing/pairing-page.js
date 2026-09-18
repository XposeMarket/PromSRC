import { GatewayClient } from '../../core/gateway-client.js';
import { normalizeOrigin } from '../../core/gateway-manager.js';
import { escapeHtml, loading } from '../../ui/page-kit.js';

const FP_KEY = 'pm_device_fp';

function fingerprint() {
  try {
    let value = localStorage.getItem(FP_KEY) || '';
    if (!value) {
      value = `phone_${crypto.randomUUID?.() || `${Date.now()}_${Math.random()}`}`;
      localStorage.setItem(FP_KEY, value);
    }
    return value;
  } catch { return `phone_${Date.now()}`; }
}

function deviceName() {
  const platform = navigator.userAgentData?.platform || navigator.platform || 'Phone';
  return `Prometheus Mobile · ${platform}`.slice(0, 80);
}

function tokenFrom(result) {
  return String(result?.token || result?.deviceToken || result?.pairingToken || result?.grant?.token || '');
}

function decodePayloadText(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return null;
  try {
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
}

function pairingPayload(value, qrDocumentOrigin = '') {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let pairValue = raw;
  let qrOrigin = '';
  try {
    const url = new URL(raw);
    if (['http:', 'https:'].includes(url.protocol)) {
      pairValue = String(url.searchParams.get('pair') || '');
      qrOrigin = url.origin;
    }
  } catch { /* A raw pairing envelope can be pasted directly. */ }
  if (!pairValue) return null;
  let payload = decodePayloadText(pairValue);
  if (!payload) {
    try { payload = decodePayloadText(decodeURIComponent(pairValue)); } catch {}
  }
  if (payload?.audience !== 'prometheus-mobile-pairing'
      || !payload.challenge || !payload.gatewayId || !payload.origin
      || Number(payload.expiresAt || 0) < Date.now()) return null;
  const origin = normalizeOrigin(payload.origin);
  if (!origin || (qrOrigin && qrOrigin !== origin) || (qrDocumentOrigin && qrDocumentOrigin !== origin)) return null;
  return {
    gatewayId: String(payload.gatewayId),
    origin,
    challenge: String(payload.challenge),
    name: String(payload.name || ''),
    platform: String(payload.platform || ''),
    version: String(payload.gatewayVersion || payload.version || ''),
  };
}

function descriptorFrom(result, origin) {
  const raw = result?.gateway || result?.gatewayIdentity || result?.identity || result?.descriptor || {};
  return {
    ...raw,
    id: String(raw.gatewayId || raw.id || result?.gatewayId || ''),
    gatewayId: String(raw.gatewayId || raw.id || result?.gatewayId || ''),
    name: raw.name || raw.label || result?.gatewayName || 'Prometheus gateway',
    origin: normalizeOrigin(raw.origin || result?.origin || origin),
    platform: String(raw.platform || result?.platform || ''),
    version: String(raw.version || raw.gatewayVersion || result?.gatewayVersion || ''),
    execution: raw.execution || { enabled: true },
  };
}

function pairOrb() {
  return `<div class="pm-voice-orb" style="width:min(60vw,200px);margin:14px auto 24px" aria-hidden="true"><svg viewBox="0 0 200 200" style="width:100%;height:100%"><defs><radialGradient id="pm-v2-pair-core" cx="35%" cy="32%" r="70%"><stop offset="0%" stop-color="#fff6e6" stop-opacity=".95"/><stop offset="40%" stop-color="#ffd9a8" stop-opacity=".55"/><stop offset="100%" stop-color="var(--pm-orange)" stop-opacity=".25"/></radialGradient></defs><circle cx="100" cy="100" r="92" fill="url(#pm-v2-pair-core)"/><text x="100" y="118" text-anchor="middle" font-size="64" font-family="system-ui">🔗</text></svg></div>`;
}

export function mountPairingPage({ shell, gateways, route }) {
  shell.setActiveTab('chat');
  const existing = route?.id && route.id !== 'add' ? gateways.get(route.id) : null;
  const reconnect = Boolean(route?.id && route.id !== 'add');
  const label = existing ? 'Reconnect gateway' : route?.id === 'add' ? 'Add gateway' : 'Pair phone';
  shell.setTitle(label);
  shell.renderHeader?.({ leftIcon: reconnect ? 'back' : 'menu', backRoute: 'gateways', showStatus: false });
  const page = shell.page;
  let disposed = false;
  let cameraStream = null;
  let scanFrame = 0;
  let scanner = null;
  let scanBusy = false;
  let targetHint = null;
  let identityResolve = null;
  const intro = existing
    ? `Reconnect ${existing.name} to this phone. Enter a fresh code from its Prometheus settings.`
    : route?.id === 'add'
      ? 'Scan the target computer’s pairing QR, or enter its short-lived code and gateway address.'
      : 'On the target computer, open Settings → Pairing. Scan its QR or enter the short-lived code here.';

  page.innerHTML = `<div class="pm-pair-route" style="display:flex;flex-direction:column;align-items:center;text-align:center;padding:8px 0 32px">
    <div id="pm-pair-stage" style="max-width:360px;width:100%">
      ${pairOrb()}
      <h2 id="pm-pair-title" style="margin:0 0 6px;font-size:22px;font-weight:800;letter-spacing:-.3px">${escapeHtml(existing ? 'Reconnect gateway' : route?.id === 'add' ? 'Add a gateway' : 'Pair this phone')}</h2>
      <p id="pm-pair-sub" style="margin:0 0 18px;color:var(--pm-muted);font-size:14px;line-height:1.5">${escapeHtml(intro)}</p>
      <div id="pm-pair-status" style="font-size:13px;color:var(--pm-text-soft)"></div>
      <form id="pm-pair-form" style="display:flex;flex-direction:column;gap:10px;text-align:left">
        <label class="pm-settings-field"><span>Pair code or pairing link</span><input class="pm-input" name="code" inputmode="text" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" placeholder="PAIR-ABCD-1234" required style="text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:18px;font-weight:800;letter-spacing:.04em"/></label>
        <label class="pm-settings-field"><span>Gateway address</span><input class="pm-input" name="origin" type="url" inputmode="url" autocomplete="url" spellcheck="false" placeholder="https://computer.example" value="${escapeHtml(existing?.origin || window.location.origin)}" required style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px"/></label>
        <button class="pm-btn primary" type="submit">${escapeHtml(existing ? 'Reconnect phone' : 'Pair phone')}</button>
        <button class="pm-btn ghost" type="button" data-pair-scan>Scan pairing QR</button>
        <p class="pm-v2-muted" style="text-align:center">The computer must approve this phone. Confirm the gateway identity before its grant is saved.</p>
      </form>
      <div id="pm-pair-progress" hidden style="margin-top:16px"></div>
    </div>
  </div>
  <div data-pair-camera hidden style="position:fixed;inset:0;z-index:10030;background:#000;display:none;align-items:center;justify-content:center;flex-direction:column">
    <video data-pair-camera-video autoplay muted playsinline style="width:100%;height:100%;object-fit:cover"></video>
    <div data-pair-camera-status style="position:absolute;top:max(18px,env(safe-area-inset-top));color:white;text-shadow:0 1px 3px #000">Point at a Prometheus QR</div>
    <button type="button" class="pm-btn ghost" data-pair-camera-close style="position:absolute;bottom:max(24px,env(safe-area-inset-bottom))">Cancel scan</button>
  </div>`;

  const formElement = page.querySelector('#pm-pair-form');
  const codeInput = formElement.elements.code;
  const originInput = formElement.elements.origin;
  const progress = page.querySelector('#pm-pair-progress');
  const cameraOverlay = page.querySelector('[data-pair-camera]');
  const cameraVideo = page.querySelector('[data-pair-camera-video]');
  const cameraStatus = page.querySelector('[data-pair-camera-status]');

  function stopScanner() {
    if (scanFrame) cancelAnimationFrame(scanFrame);
    scanFrame = 0;
    cameraStream?.getTracks?.().forEach((track) => track.stop());
    cameraStream = null;
    scanner = null;
    if (cameraVideo) cameraVideo.srcObject = null;
    if (cameraOverlay) { cameraOverlay.hidden = true; cameraOverlay.style.display = 'none'; }
  }

  function applyScannedValue(raw) {
    const payload = pairingPayload(raw);
    if (!payload) {
      cameraStatus.textContent = 'That is not a valid Prometheus pairing QR.';
      return false;
    }
    targetHint = payload;
    codeInput.value = payload.challenge;
    originInput.value = payload.origin;
    page.querySelector('#pm-pair-sub').textContent = `QR ready for ${payload.name || 'the target gateway'}. Review the address, then request approval.`;
    stopScanner();
    shell.showNotice('Pairing QR recognized. Review the target and continue.');
    return true;
  }

  async function startScanner() {
    if (!navigator.mediaDevices?.getUserMedia) {
      shell.showNotice('Camera is unavailable here. Paste the pairing link or enter the code instead.');
      return;
    }
    const hasNative = typeof window.BarcodeDetector === 'function';
    const hasFallback = typeof window.jsQR === 'function';
    if (!hasNative && !hasFallback) {
      shell.showNotice('QR scanning is unavailable in this browser. Paste the pairing link or enter the short-lived code.');
      return;
    }
    // This function is called only from the Scan pairing QR button.
    try {
      if (hasNative) {
        try { scanner = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch { scanner = null; }
      }
      if (!scanner && !hasFallback) throw new Error('This camera does not expose a QR decoder.');
      cameraOverlay.hidden = false;
      cameraOverlay.style.display = 'flex';
      cameraStatus.textContent = 'Opening camera…';
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (disposed) { stopScanner(); return; }
      cameraVideo.srcObject = cameraStream;
      await cameraVideo.play();
      cameraStatus.textContent = 'Point at a Prometheus pairing QR';
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const scan = async () => {
        if (disposed || !cameraStream || cameraOverlay.hidden) return;
        if (!scanBusy && cameraVideo.videoWidth && cameraVideo.videoHeight) {
          scanBusy = true;
          try {
            let raw = '';
            if (scanner) raw = String((await scanner.detect(cameraVideo))?.[0]?.rawValue || '').trim();
            else if (ctx) {
              const scale = Math.min(1, 960 / Math.max(cameraVideo.videoWidth, cameraVideo.videoHeight));
              canvas.width = Math.max(1, Math.round(cameraVideo.videoWidth * scale));
              canvas.height = Math.max(1, Math.round(cameraVideo.videoHeight * scale));
              ctx.drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);
              const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
              raw = String(window.jsQR(frame.data, canvas.width, canvas.height, { inversionAttempts: 'attemptBoth' })?.data || '').trim();
            }
            if (raw) applyScannedValue(raw);
          } catch { /* Continue scanning frames until a valid QR appears. */ }
          scanBusy = false;
        }
        if (cameraStream && !cameraOverlay.hidden) scanFrame = requestAnimationFrame(scan);
      };
      scanFrame = requestAnimationFrame(scan);
    } catch (error) {
      stopScanner();
      shell.showNotice(error?.message || 'Could not open the camera.');
    }
  }

  function confirmIdentity(gateway) {
    progress.innerHTML = `<section class="pm-gateway-card"><h3>Confirm this gateway</h3><p>The target computer approved the request. Check its identity before saving the phone grant.</p><div style="display:grid;gap:4px;text-align:left;border:1px solid var(--pm-border);border-radius:12px;padding:12px 14px;background:var(--pm-bg-soft);margin:10px 0"><strong>${escapeHtml(gateway.name)}</strong><span>${escapeHtml(gateway.platform || 'Unknown platform')} · ${escapeHtml(gateway.version || 'version unavailable')}</span><small>${escapeHtml(gateway.origin)}</small><small>Gateway ID: ${escapeHtml(gateway.gatewayId)}</small></div><div class="pm-row-buttons"><button type="button" class="pm-btn primary" data-confirm-gateway>Confirm gateway</button><button type="button" class="pm-btn ghost" data-cancel-gateway>Cancel</button></div></section>`;
    return new Promise((resolve) => {
      identityResolve = (confirmed) => {
        identityResolve = null;
        resolve(confirmed);
      };
      progress.querySelector('[data-confirm-gateway]')?.addEventListener('click', () => identityResolve?.(true), { once: true });
      progress.querySelector('[data-cancel-gateway]')?.addEventListener('click', () => identityResolve?.(false), { once: true });
    });
  }

  async function requestPairing(code, origin, hint) {
    const submittedForm = formElement;
    submittedForm.hidden = true;
    progress.hidden = false;
    progress.innerHTML = loading('Sending pairing request…');
    const fp = fingerprint();
    const client = new GatewayClient({ id: 'pending', origin, tokenProvider: () => '' });
    try {
      const claim = await client.claimPairing({ code, deviceName: deviceName(), deviceFingerprint: fp });
      let approved = null;
      const requestId = String(claim?.requestId || claim?.id || claim?.pairingRequestId || '');
      if (!requestId && tokenFrom(claim)) approved = claim;
      else if (!requestId) throw new Error(claim?.error || 'Pairing request did not return an id.');
      if (!approved) {
        progress.innerHTML = loading('Waiting for approval on the computer…');
        for (let attempt = 0; attempt < 90 && !disposed; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          if (disposed) return;
          const result = await client.request(`/api/pairing/poll/${encodeURIComponent(requestId)}`, { headers: { 'X-Pairing-Device-Fingerprint': fp } });
          const state = String(result?.status || result?.state || '').toLowerCase();
          if (['denied', 'rejected', 'expired', 'failed', 'approved_already_collected'].includes(state)) throw new Error(result?.error || `Pairing ${state.replaceAll('_', ' ')}.`);
          if (tokenFrom(result) || ['approved', 'paired', 'complete', 'completed'].includes(state)) { approved = result; break; }
        }
      }
      if (!approved) throw new Error('Pairing approval timed out.');
      const token = tokenFrom(approved);
      if (!token) throw new Error('Pairing was approved but no device grant was returned.');
      const descriptor = descriptorFrom(approved, origin);
      if (!descriptor.gatewayId || !descriptor.origin) throw new Error('The approved response did not include a stable gateway identity. Nothing was saved.');
      if (descriptor.origin !== origin || (hint?.gatewayId && descriptor.gatewayId !== hint.gatewayId)
          || (existing?.gatewayId && descriptor.gatewayId !== existing.gatewayId)) {
        throw new Error('The approved gateway identity did not match the address or QR target. Nothing was saved.');
      }
      const confirmed = await confirmIdentity(descriptor);
      if (disposed) return;
      if (!confirmed) {
        progress.innerHTML = `<div class="pm-empty"><h2>Pairing cancelled</h2><p>No device grant was saved.</p><button type="button" class="pm-btn ghost" data-pair-return>Back to gateways</button></div>`;
        progress.querySelector('[data-pair-return]')?.addEventListener('click', () => shell.navigate?.('gateways'));
        return;
      }
      const entry = gateways.upsert(descriptor, { token, deviceId: approved?.deviceId || approved?.grant?.deviceId || '' });
      gateways.select(entry.id);
      shell.showNotice(`${entry.name} connected.`);
      shell.navigate?.('gateways');
    } catch (error) {
      if (disposed) return;
      submittedForm.hidden = false;
      progress.innerHTML = `<div class="pm-gateway-card"><div class="pm-gateway-card-head"><strong>Couldn’t pair</strong></div><p class="pm-gateway-error">${escapeHtml(error?.message || error)}</p></div>`;
    }
  }

  formElement.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(formElement);
    const rawCode = String(form.get('code') || '').trim();
    const parsed = pairingPayload(rawCode);
    const code = parsed?.challenge || rawCode;
    const origin = normalizeOrigin(parsed?.origin || form.get('origin'));
    const hint = parsed || targetHint;
    if (parsed) {
      targetHint = parsed;
      originInput.value = parsed.origin;
    }
    if (!origin || !code) return;
    if (hint?.origin && normalizeOrigin(hint.origin) !== origin) {
      shell.showNotice('The pairing link target and gateway address do not match.');
      return;
    }
    void requestPairing(code, origin, hint);
  });

  page.querySelector('[data-pair-scan]')?.addEventListener('click', () => { void startScanner(); });
  page.querySelector('[data-pair-camera-close]')?.addEventListener('click', stopScanner);
  codeInput.addEventListener('input', () => {
    const parsed = pairingPayload(codeInput.value);
    if (!parsed) return;
    targetHint = parsed;
    originInput.value = parsed.origin;
    page.querySelector('#pm-pair-sub').textContent = `Pairing link for ${parsed.name || 'the target gateway'} recognized. Review the address and continue.`;
  });

  // Support desktop pairing links that open the V2 route directly.
  const queryPair = new URLSearchParams(window.location.search).get('pair');
  const deepLink = pairingPayload(queryPair || route?.sub || '');
  if (deepLink) {
    targetHint = deepLink;
    codeInput.value = deepLink.challenge;
    originInput.value = deepLink.origin;
    page.querySelector('#pm-pair-sub').textContent = `Pairing link for ${deepLink.name || 'the target gateway'} recognized. Review the address and continue.`;
  }

  return () => {
    disposed = true;
    identityResolve?.(false);
    stopScanner();
  };
}
