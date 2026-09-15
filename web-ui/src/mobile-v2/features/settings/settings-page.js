import { escapeHtml, pageHeading, card, loading } from '../../ui/page-kit.js';
import { MOBILE_V2_THEMES, currentMobileV2Theme, applyMobileV2Theme } from '../../core/theme.js';
import { getMobileV2InstallState, onMobileV2InstallState, requestMobileV2Install } from '../../core/pwa.js';

function installLabel(state) {
  if (state.standalone) return 'Installed';
  if (state.installPromptAvailable) return 'Install Prometheus V2';
  if (state.ios) return 'iPhone install instructions';
  return 'Install from browser';
}

function installStatus(state) {
  if (state.standalone) return 'Running as an installed V2 app.';
  if (!state.secure) return 'PWA install requires HTTPS or localhost.';
  if (state.installPromptAvailable) return 'V2 is ready to install as a separate app.';
  if (state.ios) return 'In Safari, tap Share, then Add to Home Screen.';
  return 'Use your browser’s Install app / Add to Home Screen command when available.';
}

export async function mountSettingsPage({ shell, features, gateways }) {
  shell.setActiveTab('chat');
  shell.setTitle('Settings');
  const page = shell.page;
  let disposed = false;
  let disposeInstallState = () => {};

  page.innerHTML = `${pageHeading('Settings', 'Mobile V2')}${loading('Loading settings…')}`;
  const [heartbeat, status, voice] = await Promise.all([
    features.heartbeat(),
    features.status(),
    features.voiceStatus().catch(() => null),
  ]);
  if (disposed) return () => {};
  const hb = heartbeat?.heartbeat || heartbeat?.config || heartbeat || {};
  const install = getMobileV2InstallState();
  const theme = currentMobileV2Theme();

  page.innerHTML = `${pageHeading('Settings', 'Mobile V2')}
    ${card('Appearance', `<label class="pm-v2-field"><span>Theme</span><select class="pm-select" data-theme>${MOBILE_V2_THEMES.map((item) => `<option value="${item.id}" ${theme.id === item.id ? 'selected' : ''}>${item.label}</option>`).join('')}</select></label>`)}
    ${card('Install V2', `<div class="pm-v2-event-list"><div><strong>App</strong><span data-pwa-install-status>${escapeHtml(installStatus(install))}</span></div><div><strong>Service worker</strong><span data-pwa-worker-status>${install.serviceWorkerReady ? 'Active' : (install.serviceWorkerSupported ? 'Registering' : 'Unavailable')}</span></div></div><div class="pm-v2-actions"><button class="pm-btn primary" data-install-v2 ${install.standalone ? 'disabled' : ''}>${escapeHtml(installLabel(install))}</button></div><p class="pm-v2-muted">This V2 PWA has its own manifest identity, /mobile-v2/ scope, service worker and cache namespace, so it can be tested beside the existing Prometheus mobile app.</p>`)}
    ${card('Gateway', `<div class="pm-v2-event-list"><div><strong>${escapeHtml(gateways.activeEntry?.name || 'This gateway')}</strong><span>${escapeHtml(gateways.activeEntry?.origin || '')}</span></div><div><strong>Model</strong><span>${escapeHtml(status?.actualModel || status?.currentModel || status?.configuredModel || 'Default')}</span></div></div><div class="pm-v2-actions"><button class="pm-btn ghost" data-open-gateways>Gateway Connections</button></div>`)}
    ${card('Heartbeat', `<form class="pm-v2-form" data-heartbeat-form><label class="pm-v2-check"><input type="checkbox" name="enabled" ${hb.enabled !== false ? 'checked' : ''}/><span>Enabled</span></label><label class="pm-v2-field"><span>Interval minutes</span><input type="number" min="1" max="1440" name="interval_minutes" value="${escapeHtml(hb.interval_minutes ?? hb.intervalMinutes ?? 60)}"/></label><label class="pm-v2-field"><span>Model</span><input name="model" value="${escapeHtml(hb.model || '')}" placeholder="Default model"/></label><label class="pm-v2-field"><span>Instructions</span><textarea name="instructions" rows="7">${escapeHtml(hb.instructions || '')}</textarea></label><button class="pm-btn primary">Save heartbeat</button></form>`)}
    ${card('Voice', `<div class="pm-v2-event-list"><div><strong>Speech</strong><span>${escapeHtml(voice?.voice?.configured === false ? 'Needs setup' : 'Ready')}</span></div><div><strong>Realtime</strong><span>${escapeHtml(voice?.realtime?.configured ? 'Available' : 'Fallback mode')}</span></div></div><button class="pm-btn ghost" data-open-voice>Open Voice</button>`)}
    ${card('Maintenance', `<div class="pm-v2-actions"><button class="pm-btn ghost" data-clear-v2-cache>Clear V2 local UI state</button></div><p class="pm-v2-muted">This does not delete chats or gateway-owned data.</p>`)}`;

  const paintInstallState = (state) => {
    const button = page.querySelector('[data-install-v2]');
    const statusNode = page.querySelector('[data-pwa-install-status]');
    const workerNode = page.querySelector('[data-pwa-worker-status]');
    if (button) {
      button.textContent = installLabel(state);
      button.disabled = state.standalone;
    }
    if (statusNode) statusNode.textContent = installStatus(state);
    if (workerNode) workerNode.textContent = state.serviceWorkerReady ? 'Active' : (state.serviceWorkerSupported ? 'Registering' : 'Unavailable');
  };
  disposeInstallState = onMobileV2InstallState(paintInstallState);

  page.querySelector('[data-theme]')?.addEventListener('change', (event) => applyMobileV2Theme(event.target.value));
  page.querySelector('[data-install-v2]')?.addEventListener('click', async () => {
    const result = await requestMobileV2Install();
    if (result.status === 'ios-manual') shell.showNotice('Safari: tap Share, then Add to Home Screen.');
    else if (result.status === 'unavailable') shell.showNotice('Use your browser menu and choose Install app or Add to Home Screen.');
    else if (result.status === 'accepted') shell.showNotice('Prometheus V2 installation accepted.');
  });
  page.querySelector('[data-open-gateways]')?.addEventListener('click', () => shell.navigate?.('gateways'));
  page.querySelector('[data-open-voice]')?.addEventListener('click', () => shell.navigate?.('voice'));
  page.querySelector('[data-heartbeat-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await features.saveHeartbeat({
        enabled: form.get('enabled') === 'on',
        interval_minutes: Number(form.get('interval_minutes') || 60),
        model: String(form.get('model') || ''),
        instructions: String(form.get('instructions') || ''),
      });
      shell.showNotice('Heartbeat settings saved.');
    } catch (error) {
      shell.showNotice(error?.message || 'Could not save heartbeat.');
    }
  });
  page.querySelector('[data-clear-v2-cache]')?.addEventListener('click', () => {
    try { Object.keys(localStorage).filter((key) => key.startsWith('pm_mobile_v2_')).forEach((key) => localStorage.removeItem(key)); } catch {}
    shell.showNotice('V2 local UI state cleared.');
  });

  return () => {
    disposed = true;
    disposeInstallState();
  };
}
