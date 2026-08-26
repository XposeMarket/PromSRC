const PM_PWA_VERSION = 'pm-v309-2026-08-26-question-stepper';
const PM_SERVICE_WORKER_URL = `/service-worker.js?v=${PM_PWA_VERSION}`;

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  window.__pmDeferredInstall = event;
  window.dispatchEvent(new Event('pm-install-available'));
});

window.addEventListener('appinstalled', () => {
  window.__pmDeferredInstall = null;
});

async function registerMobileServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const isSecure = window.isSecureContext
    || ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname);
  if (!isSecure || window.navigator.userAgent.includes('Electron')) return;

  try {
    const registration = await navigator.serviceWorker.register(PM_SERVICE_WORKER_URL, {
      scope: '/',
      updateViaCache: 'none',
    });
    if (registration.waiting) registration.waiting.postMessage('pm-skip-waiting');
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          worker.postMessage('pm-skip-waiting');
        }
      });
    });
    registration.update().catch(() => {});
    window.addEventListener('pageshow', () => registration.update().catch(() => {}));
  } catch (error) {
    console.warn('[pm-pwa] service worker registration failed:', error);
  }
}

let serviceWorkerReloadGuard = false;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (serviceWorkerReloadGuard) return;
    serviceWorkerReloadGuard = true;
    try {
      const pendingUntil = Number(sessionStorage.getItem('pm_reload_pending_until') || 0);
      if (pendingUntil > Date.now()) return;
      sessionStorage.setItem('pm_reload_pending_until', String(Date.now() + 15_000));
    } catch {}
    try { window.location.reload(); } catch {}
  });
}

if (document.readyState === 'complete') queueMicrotask(registerMobileServiceWorker);
else window.addEventListener('load', registerMobileServiceWorker, { once: true });

window.pmPurgeCaches = async () => {
  try {
    const registration = await navigator.serviceWorker?.getRegistration('/');
    registration?.active?.postMessage('pm-purge-caches');
  } catch {}
  try { localStorage.removeItem('pm_force_mobile'); } catch {}
  setTimeout(() => window.location.reload(), 400);
};
