/* Prometheus Mobile service worker.
 *
 * Strategy:
 *   - install: pre-cache the mobile shell so first-launch offline works.
 *   - fetch:
 *       /api/*        → network only (no caching of API calls).
 *       /assets/*     → stale-while-revalidate (icons / brand art).
 *       same-origin static (HTML/JS/CSS) → network-first with cache fallback.
 *       cross-origin → passthrough.
 *   - activate: drop old cache versions.
 *
 * Do not cache /api/chat or any SSE/WS traffic. The fetch handler bails out
 * for anything under /api so streaming + auth state never get stale.
 */

// IMPORTANT: bump this on every meaningful frontend change. The version is the
// only signal browsers use to decide whether to re-install the SW and purge
// the old cache. If you forget to bump it, devices keep serving stale assets
// even after `npm run build` + gateway restart.
const VERSION = 'pm-v53-2026-06-14-lens-edge-exact';
const STATIC_CACHE  = `prometheus-static-${VERSION}`;
const RUNTIME_CACHE = `prometheus-runtime-${VERSION}`;

// Files needed for the mobile shell to render offline.
const PRECACHE = [
  '/',
  '/?source=pwa#mobile/chat',
  '/src/styles/mobile.css',
  '/src/styles/base.css',
  '/src/mobile/mobile-router.js',
  '/src/mobile/mobile-shell.js',
  '/src/mobile/mobile-pages.js',
  '/src/mobile/mobile-data.js',
  '/src/mobile/mobile-api.js',
  '/src/api.js',
  '/src/state.js',
  '/src/utils.js',
  '/assets/Prometheus.png',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      Promise.allSettled(PRECACHE.map((url) => cache.add(url).catch(() => null)))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith('prometheus-') && !k.endsWith(VERSION))
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

function isBypass(url) {
  if (url.pathname.startsWith('/api/'))   return true;   // never cache API
  if (url.pathname.startsWith('/ws'))     return true;   // websocket upgrade
  if (url.pathname.startsWith('/events')) return true;   // SSE
  return false;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res && res.ok && (request.method === 'GET')) {
      cache.put(request, res.clone()).catch(() => {});
    }
    return res;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then((res) => {
    if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
    return res;
  }).catch(() => cached);
  return cached || fetchPromise;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch { return; }
  if (url.origin !== self.location.origin) return;
  if (isBypass(url)) return;

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname.startsWith('/src/')) {
    event.respondWith(networkFirst(request, STATIC_CACHE));
    return;
  }
});

// Allow the page to force-update the SW from the in-app menu later.
self.addEventListener('message', (event) => {
  if (event.data === 'pm-skip-waiting') self.skipWaiting();
  if (event.data === 'pm-purge-caches') {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k.startsWith('prometheus-')).map(k => caches.delete(k)));
      const clients = await self.clients.matchAll();
      for (const c of clients) c.postMessage('pm-caches-purged');
    })());
  }
});
