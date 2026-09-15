/* Prometheus Mobile V2 service worker.
 * Scope: /mobile-v2/
 * Cache names intentionally do not begin with `prometheus-`, because the
 * legacy root-scoped worker owns that prefix and purges old matching caches.
 */
const VERSION = 'pm-v2-2026-09-15-installable-v2';
const CACHE_PREFIX = 'pm-mobile-v2-';
const STATIC_CACHE = `${CACHE_PREFIX}static-${VERSION}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}runtime-${VERSION}`;

const PRECACHE = [
  '/mobile-v2/chat',
  '/manifest-v2.webmanifest',
  '/assets/Prometheus.png',
  '/src/mobile-v2/mobile-v2-entry.js',
  '/src/mobile-v2/ui/drawer-bootstrap.js',
  '/src/mobile-v2/ui/drawer-parity.js',
  '/src/mobile-v2/mobile-v2.css',
  '/src/mobile-v2/mobile-v2-drawer.css',
  '/src/styles/mobile.css',
  '/static/mobile-v2/mobile-v2-entry.js',
  '/static/mobile-v2/ui/drawer-bootstrap.js',
  '/static/mobile-v2/ui/drawer-parity.js',
  '/static/mobile-v2/mobile-v2.css',
  '/static/mobile-v2/mobile-v2-drawer.css',
  '/static/styles/mobile.css'
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
        .filter((key) => key.startsWith(CACHE_PREFIX) && !key.endsWith(VERSION))
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

function bypass(url) {
  return url.pathname.startsWith('/api/')
    || url.pathname.startsWith('/ws')
    || url.pathname.startsWith('/events');
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request, { cache: 'no-cache' });
    if (response?.ok && request.method === 'GET') {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  const fresh = fetch(request).then((response) => {
    if (response?.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  }).catch(() => cached);
  return cached || fresh;
}

async function offlineShell() {
  const cache = await caches.open(STATIC_CACHE);
  return (await cache.match('/mobile-v2/chat', { ignoreSearch: true }))
    || new Response(
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prometheus V2 offline</title><body style="margin:0;background:#0b0b0d;color:#f7f7f8;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;display:grid;min-height:100vh;place-items:center"><main style="max-width:28rem;padding:2rem"><h1 style="font-size:1.4rem">Prometheus V2 is offline</h1><p style="line-height:1.5;color:#aaa">The V2 shell is installed, but the gateway is not reachable right now.</p></main></body>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  let url;
  try { url = new URL(request.url); } catch { return; }
  if (url.origin !== self.location.origin || bypass(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, STATIC_CACHE).catch(offlineShell));
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (
    url.pathname.startsWith('/src/mobile-v2/')
    || url.pathname.startsWith('/static/mobile-v2/')
    || url.pathname.startsWith('/src/styles/')
    || url.pathname.startsWith('/static/styles/')
    || url.pathname === '/manifest-v2.webmanifest'
  ) {
    event.respondWith(networkFirst(request, STATIC_CACHE));
  }
});

self.addEventListener('message', (event) => {
  if (event.data === 'pm-v2-skip-waiting') self.skipWaiting();
  if (event.data === 'pm-v2-purge-caches') {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX)).map((key) => caches.delete(key)));
    })());
  }
});
