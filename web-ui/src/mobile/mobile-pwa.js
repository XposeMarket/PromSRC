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

// When an UPDATED worker takes control (there was already a controller at boot),
// the page is still running the old module graph. Reload once so the new code
// actually runs. First installs (no prior controller) are left alone so pairing
// and first boot are never interrupted.
function installMobileUpdateReload() {
  if (!('serviceWorker' in navigator)) return;
  if (!navigator.serviceWorker.controller) return;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    try {
      const pendingUntil = Number(sessionStorage.getItem('pm_reload_pending_until') || 0);
      if (pendingUntil > Date.now()) return;
      sessionStorage.setItem('pm_reload_pending_until', String(Date.now() + 15000));
    } catch {}
    try { window.location.reload(); } catch {}
  });
}
installMobileUpdateReload();

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
    // iOS home-screen apps are usually resumed, not reloaded, so pageshow alone
    // misses most gateway updates. Re-check when the app comes back to the
    // foreground and periodically while it stays open.
    let lastCheck = Date.now();
    const checkForUpdate = () => {
      if (Date.now() - lastCheck < 10_000) return;
      lastCheck = Date.now();
      registration.update().catch(() => {});
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    });
    window.addEventListener('online', checkForUpdate);
    setInterval(() => { if (document.visibilityState === 'visible') checkForUpdate(); }, 120_000);
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
