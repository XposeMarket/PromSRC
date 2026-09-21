const PM_PWA_VERSION = 'pm-v314-2026-09-20-mobile-reconnect';
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

// The shell and scripts were already fetched from the network on this load.
// Reloading during the initial worker claim can interrupt mobile boot (and on
// some browsers repeatedly navigate a newly paired device). Let the next
// normal navigation pick up the active worker and content-addressed assets.

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
