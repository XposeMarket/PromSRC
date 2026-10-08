/**
 * Retired Mobile V2 service worker.
 *
 * Mobile V2 was removed (legacy cleanup PR-4). A phone that installed the V2
 * PWA still has this worker registered at /mobile-v2/. When the browser checks
 * for an update it gets this stub, which clears the V2 caches, unregisters
 * itself and sends any open V2 tab to /mobile. The gateway also redirects
 * /mobile-v2 to /mobile. Delete this file one release after PR-4.
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith('pm-mobile-v2-')).map((key) => caches.delete(key)));
    } catch {}
    try { await self.registration.unregister(); } catch {}
    try {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      await Promise.all(windows.map((client) => client.navigate('/mobile').catch(() => null)));
    } catch {}
  })());
});
