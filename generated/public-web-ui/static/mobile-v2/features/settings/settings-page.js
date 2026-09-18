import { escapeHtml } from '../../ui/page-kit.js';
import { ICONS } from '../../ui/icons.js';
import { MOBILE_V2_THEMES, currentMobileV2Theme, applyMobileV2Theme } from '../../core/theme.js';
import { getMobileV2InstallState, onMobileV2InstallState, requestMobileV2Install } from '../../core/pwa.js';
import { renderMobileV2SettingsSurface } from './settings-surface.js';

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

function renderDeviceSettings({ gateway, theme, install }) {
  return `<article class="pm-card pm-settings-card pm-card-strong" id="pm-v2-device-settings">
    <div class="pm-card-head"><span class="pm-more-icon" aria-hidden="true">${ICONS.spark}</span><span>V2 on this phone</span></div>
    <div class="pm-card-body">Device-only preferences for this V2 install. Gateway settings below apply to the selected Prometheus computer.</div>
    <label class="pm-settings-field"><span>Appearance</span><select class="pm-input pm-select" data-v2-theme>${MOBILE_V2_THEMES.map((item) => `<option value="${escapeHtml(item.id)}" ${theme.id === item.id ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}</select></label>
    <div class="pm-card-body"><strong>Install</strong><br/><span data-pwa-install-status>${escapeHtml(installStatus(install))}</span><br/><small>Service worker: <span data-pwa-worker-status>${install.serviceWorkerReady ? 'Active' : (install.serviceWorkerSupported ? 'Registering' : 'Unavailable')}</span></small></div>
    <div class="pm-row-buttons"><button class="pm-btn primary" type="button" data-install-v2 ${install.standalone ? 'disabled' : ''}>${escapeHtml(installLabel(install))}</button></div>
    <div class="pm-card-body" data-v2-gateway-summary style="margin-top:12px"><strong>${escapeHtml(gateway?.name || 'This gateway')}</strong><br/><span>${escapeHtml(gateway?.origin || '')}</span></div>
    <div class="pm-row-buttons"><button class="pm-btn ghost" type="button" data-open-gateways>Gateway Connections</button><button class="pm-btn ghost" type="button" data-open-voice>Open Voice</button></div>
    <div class="pm-card-body" style="margin-top:12px">Clear the saved V2 theme and local screen preferences on this device. Chats and gateway data stay on the Prometheus computer.</div>
    <div class="pm-row-buttons"><button class="pm-btn ghost" type="button" data-clear-v2-cache>Clear V2 local UI state</button></div>
  </article>`;
}

export function mountSettingsPage({ shell, gateways, route }) {
  shell.setActiveTab('chat');
  shell.setTitle('Settings');
  const page = shell.page;
  const gateway = gateways.active;
  const section = route?.id || '';
  const install = getMobileV2InstallState();
  let disposed = false;
  let disposeSurface = () => {};

  disposeSurface = renderMobileV2SettingsSurface(page, {
    section,
    api: gateway,
    navigate: (nextRoute) => shell.navigate?.(nextRoute),
    overviewExtraHtml: renderDeviceSettings({
      gateway: gateways.get(gateway.id),
      theme: currentMobileV2Theme(),
      install,
    }),
  });

  const paintInstallState = (state) => {
    const button = page.querySelector('[data-install-v2]');
    const statusNode = page.querySelector('[data-pwa-install-status]');
    const workerNode = page.querySelector('[data-pwa-worker-status]');
    if (button) { button.textContent = installLabel(state); button.disabled = state.standalone; }
    if (statusNode) statusNode.textContent = installStatus(state);
    if (workerNode) workerNode.textContent = state.serviceWorkerReady ? 'Active' : (state.serviceWorkerSupported ? 'Registering' : 'Unavailable');
  };
  const disposeInstallState = onMobileV2InstallState(paintInstallState);

  page.querySelector('[data-v2-theme]')?.addEventListener('change', (event) => applyMobileV2Theme(event.target.value));
  page.querySelector('[data-install-v2]')?.addEventListener('click', async () => {
    const result = await requestMobileV2Install();
    if (result.status === 'ios-manual') shell.showNotice('Safari: tap Share, then Add to Home Screen.');
    else if (result.status === 'unavailable') shell.showNotice('Use your browser menu and choose Install app or Add to Home Screen.');
    else if (result.status === 'accepted') shell.showNotice('Prometheus V2 installation accepted.');
  });
  page.querySelector('[data-open-gateways]')?.addEventListener('click', () => shell.navigate?.('gateways'));
  page.querySelector('[data-open-voice]')?.addEventListener('click', () => shell.navigate?.('voice'));
  page.querySelector('[data-clear-v2-cache]')?.addEventListener('click', () => {
    try { Object.keys(localStorage).filter((key) => key.startsWith('pm_mobile_v2_')).forEach((key) => localStorage.removeItem(key)); } catch {}
    shell.showNotice('V2 local UI state cleared.');
  });

  // Keep the summary current without delaying the settings section controls.
  Promise.all([
    gateway.request('/api/status').catch(() => null),
    gateway.request('/api/realtime/status').catch(() => null),
  ]).then(([status, realtime]) => {
    if (disposed) return;
    const gatewayCard = page.querySelector('#pm-v2-device-settings');
    if (!gatewayCard) return;
    const model = status?.actualModel || status?.currentModel || status?.configuredModel;
    if (model) {
      const info = gatewayCard.querySelector('[data-v2-gateway-summary]');
      if (info) info.insertAdjacentHTML('afterend', `<br/><span>Model: ${escapeHtml(model)}</span>`);
    }
    const voiceButton = gatewayCard.querySelector('[data-open-voice]');
    if (voiceButton) voiceButton.title = realtime?.configured ? 'Realtime voice is available' : 'Open Voice settings';
  });

  return () => {
    disposed = true;
    disposeInstallState();
    disposeSurface?.();
  };
}
