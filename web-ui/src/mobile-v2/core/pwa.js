const V2_PWA_VERSION = 'pm-v2-2026-09-15-installable-v2';
const V2_SW_URL = `/service-worker-v2.js?v=${encodeURIComponent(V2_PWA_VERSION)}`;
const listeners = new Set();
let deferredInstallPrompt = null;
let registration = null;
let reloadGuard = false;

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent || '')
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isMobileV2Standalone() {
  return window.matchMedia?.('(display-mode: standalone)')?.matches === true
    || window.navigator.standalone === true;
}

export function getMobileV2InstallState() {
  const secure = window.isSecureContext
    || ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname);
  return {
    secure,
    standalone: isMobileV2Standalone(),
    installPromptAvailable: !!deferredInstallPrompt,
    ios: isIos(),
    serviceWorkerSupported: 'serviceWorker' in navigator,
    serviceWorkerReady: !!registration?.active,
  };
}

function emit() {
  const state = getMobileV2InstallState();
  for (const listener of listeners) {
    try { listener(state); } catch {}
  }
  window.dispatchEvent(new CustomEvent('pm-v2-pwa-state', { detail: state }));
}

export function onMobileV2InstallState(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  try { listener(getMobileV2InstallState()); } catch {}
  return () => listeners.delete(listener);
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  emit();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  emit();
});

export async function requestMobileV2Install() {
  if (isMobileV2Standalone()) return { status: 'installed' };
  if (!deferredInstallPrompt) {
    return { status: isIos() ? 'ios-manual' : 'unavailable' };
  }
  const prompt = deferredInstallPrompt;
  deferredInstallPrompt = null;
  await prompt.prompt();
  const choice = await prompt.userChoice.catch(() => null);
  emit();
  return { status: choice?.outcome || 'dismissed' };
}

export async function registerMobileV2ServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  const secure = window.isSecureContext
    || ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname);
  if (!secure || /Electron/i.test(navigator.userAgent || '')) return null;

  try {
    registration = await navigator.serviceWorker.register(V2_SW_URL, {
      scope: '/mobile-v2/',
      updateViaCache: 'none',
    });
    if (registration.waiting) registration.waiting.postMessage('pm-v2-skip-waiting');
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          worker.postMessage('pm-v2-skip-waiting');
        }
      });
    });
    registration.update().catch(() => {});
    window.addEventListener('pageshow', () => registration?.update().catch(() => {}));
    emit();
    return registration;
  } catch (error) {
    console.warn('[mobile-v2 pwa] service worker registration failed:', error);
    emit();
    return null;
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadGuard || !window.location.pathname.startsWith('/mobile-v2')) return;
    reloadGuard = true;
    try { window.location.reload(); } catch {}
  });
}

if (document.readyState === 'complete') queueMicrotask(registerMobileV2ServiceWorker);
else window.addEventListener('load', registerMobileV2ServiceWorker, { once: true });
