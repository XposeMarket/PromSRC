/* Prometheus Mobile service worker.
 *
 * Strategy:
 *   - install: pre-cache the mobile shell so first-launch offline works.
 *   - fetch:
 *       /api/*        → network only (no caching of API calls).
 *       /assets/*     → stale-while-revalidate (icons / brand art).
 *       /src|/static|/build → cache-first + background revalidation (JS/CSS
 *                       modules; cache namespace is purged on version bump).
 *       HTML documents + asset manifest → network-first with cache fallback.
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
const RELEASE_VERSION = 'pm-v315-2026-09-20-mobile-load-speed';
// The production builder replaces this sentinel with the deterministic source
// digest. Raw-module development keeps its own cache namespace.
const ASSET_BUILD_ID = 'e079ebb2a3a85ad7';
const VERSION = `${RELEASE_VERSION}-${ASSET_BUILD_ID}`;
const STATIC_CACHE  = `prometheus-static-${VERSION}`;
const RUNTIME_CACHE = `prometheus-runtime-${VERSION}`;

// Files needed for raw-module development to render the mobile shell offline.
const SOURCE_PRECACHE = [
  '/mobile/chat',
  '/static/styles/mobile.css',
  '/static/mobile/mobile-entry.js',
  '/static/mobile/mobile-pwa.js',
  '/static/mobile/mobile-router.js',
  '/static/mobile/mobile-shell.js',
  '/assets/Prometheus.png',
  '/static/assets/prometheus-one/p1-mark-ring.png?v=pm-v260-2026-08-09-mobile-theme-palette',
];

// Public builds inject their content-addressed boot closure here. Keeping the
// arrays mutually exclusive prevents duplicate /static and /build identities.
const BUILD_PRECACHE = [
  "/asset-manifest.json",
  "/assets/Prometheus.png",
  "/build/chunks/chunk-5RLMNBA7.js",
  "/build/chunks/chunk-CP4XDM65.js",
  "/build/chunks/chunk-EPSJJCWL.js",
  "/build/chunks/chunk-FE2DGIO6.js",
  "/build/chunks/chunk-GRAK6S3F.js",
  "/build/chunks/chunk-JF4LWGNM.js",
  "/build/chunks/chunk-KJCBL7CI.js",
  "/build/chunks/chunk-LLABDDEK.js",
  "/build/chunks/chunk-M5JONE3D.js",
  "/build/chunks/chunk-MSYOJG2Q.js",
  "/build/chunks/chunk-NCUKRNUF.js",
  "/build/chunks/chunk-X4KG3ICV.js",
  "/build/chunks/chunk-YMT6MSCC.js",
  "/build/chunks/mobile-router-4YLAIO2D.js",
  "/build/entries/mobile-7P5EZHKX.js",
  "/build/inline/mobile-inline-01-0b108e28f4b7.js",
  "/build/inline/mobile-inline-02-0030786ff2fb.js",
  "/build/styles/mobile-ZQRCIKD5.css",
  "/mobile.html",
  "/mobile/chat",
];
const PRECACHE = BUILD_PRECACHE.length ? BUILD_PRECACHE : SOURCE_PRECACHE;

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
    // `no-cache` forces HTTP revalidation too. This matters after upgrading
    // from builds that served stable /static filenames with a 24-hour max-age.
    const res = await fetch(request, { cache: 'no-cache' });
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

// Static JS/CSS modules use cache-first-with-revalidation rather than
// network-first.
//
// Network-first meant every one of the ~48 modules on the mobile chat path
// paid a full round trip on every launch, even when an identical copy was
// already in the cache. Over Tailscale or a weak mobile link that latency was
// the dominant cost of a warm start, and it made the app feel slow even when
// nothing had changed.
//
// Serving the cached copy immediately and revalidating in the background keeps
// launches fast while still converging on the newest code:
//   - The revalidation fetch uses `cache: 'no-cache'`, so it always performs an
//     HTTP ETag/Last-Modified revalidation. Unchanged files cost a cheap 304.
//   - A meaningful release bumps RELEASE_VERSION, which changes the cache
//     namespace; `activate` purges the old namespace, so a new release never
//     serves yesterday's modules from a stale cache.
//   - When a background revalidation replaces a cached module, clients are
//     notified so the shell can surface an update instead of silently drifting.
async function cacheFirstRevalidate(request, cacheName, event) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const revalidate = fetch(request, { cache: 'no-cache' }).then(async (res) => {
    if (!res || !res.ok) return res;
    let changed = false;
    if (cached) {
      const prevTag = cached.headers.get('ETag') || cached.headers.get('Last-Modified') || '';
      const nextTag = res.headers.get('ETag') || res.headers.get('Last-Modified') || '';
      changed = !!nextTag && prevTag !== nextTag;
    }
    await cache.put(request, res.clone()).catch(() => {});
    if (changed) notifyClientsOfAssetUpdate(request.url);
    return res;
  });

  if (cached) {
    // The cached response settles respondWith() immediately, so without
    // waitUntil() the browser is free to terminate this worker before the
    // refresh finishes writing. Mobile browsers are especially aggressive about
    // reclaiming idle workers, which is exactly where this path runs.
    // Do not let an offline/failed revalidation reject as an unhandled error.
    const settled = revalidate.catch(() => {});
    if (event && typeof event.waitUntil === 'function') event.waitUntil(settled);
    return cached;
  }
  return revalidate;
}


function notifyClientsOfAssetUpdate(url) {
  self.clients.matchAll({ type: 'window' }).then((clients) => {
    for (const client of clients) {
      try { client.postMessage({ type: 'prometheus:asset-updated', url }); } catch {}
    }
  }).catch(() => {});
}

function offlineShellResponse() {
  const candidates = [
    '/mobile/chat',
  ];
  return caches.open(STATIC_CACHE)
    .then(async (cache) => {
      for (const url of candidates) {
        const cached = await cache.match(url, { ignoreSearch: true });
        if (cached) return cached;
      }
      for (const url of candidates) {
        const cached = await caches.match(url, { ignoreSearch: true });
        if (cached) return cached;
      }
      return null;
    })
    .then((cached) => cached || new Response(
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prometheus offline</title><body style="margin:0;background:#101112;color:#f5efe7;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;display:grid;min-height:100vh;place-items:center"><main style="max-width:28rem;padding:2rem"><h1 style="font-size:1.4rem">Prometheus is offline</h1><p style="line-height:1.5;color:#c9b8a7">The mobile shell is available, but the gateway could not be reached. Reopen when the connection returns to see live state.</p></main></body>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    ));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch { return; }
  if (url.origin !== self.location.origin) return;
  if (isBypass(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, STATIC_CACHE).catch(() => offlineShellResponse()));
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }
  // Content-hashed build output: cache-first with background revalidation.
  // The hash is IN THE FILENAME, so a given URL's bytes never change and a
  // cached copy can be trusted indefinitely. A rebuild produces new filenames,
  // which the network-first document/manifest fetches below discover.
  if (url.pathname.startsWith('/build/')) {
    event.respondWith(
      cacheFirstRevalidate(request, STATIC_CACHE, event).catch(() => {
        throw new Error('offline');
      }),
    );
    return;
  }
  // Raw module sources are MUTABLE at a stable URL: /src/mobile/mobile-shell.js
  // serves whatever that file currently contains. Cache-first would let each
  // module refresh independently, so one load could mix a new importer with an
  // old dependency - and a renamed export then fails the actual `import`, which
  // breaks startup rather than merely serving stale code. Bumping
  // RELEASE_VERSION does not help, because the skew happens WITHIN one cache
  // generation.
  //
  // Stale-while-revalidate keeps the same instant first byte from cache while
  // guaranteeing the refresh is driven by the navigation that requested it, so
  // the module graph advances together instead of per-file.
  if (url.pathname.startsWith('/src/') || url.pathname.startsWith('/static/')) {
    event.respondWith(
      staleWhileRevalidate(request, STATIC_CACHE).catch(() => {
        throw new Error('offline');
      }),
    );
    return;
  }


  if (
    url.pathname === '/'
    || url.pathname === '/index.html'
    || url.pathname === '/asset-manifest.json'
  ) {
    event.respondWith(networkFirst(request, STATIC_CACHE).catch(() => {
      if (request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
        return offlineShellResponse();
      }
      throw new Error('offline');
    }));
    return;
  }
});

function notificationPayload(event) {
  try {
    const parsed = event.data ? event.data.json() : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return { body: event.data ? event.data.text() : '' };
  }
}

async function getVisibleNotificationCount() {
  try {
    const list = await self.registration.getNotifications({ includeTriggered: true });
    return Array.isArray(list) ? list.length : 0;
  } catch {
    return 0;
  }
}

async function setBadge(count) {
  const safe = Math.max(0, Math.min(99, Number(count) || 0));
  try {
    if (safe > 0 && navigator.setAppBadge) {
      await navigator.setAppBadge(safe);
    } else if (navigator.clearAppBadge) {
      await navigator.clearAppBadge();
    }
  } catch {}
}

function notificationActions(payload) {
  if (Array.isArray(payload.actions)) {
    return payload.actions
      .map((a) => ({
        action: String(a?.action || '').slice(0, 40),
        title: String(a?.title || '').slice(0, 40),
      }))
      .filter((a) => a.action && a.title)
      .slice(0, 2);
  }
  return [
    { action: 'open', title: 'Open' },
    { action: 'clear', title: 'Clear' },
  ];
}

self.addEventListener('push', (event) => {
  const payload = notificationPayload(event);
  const title = payload.title || 'Prometheus';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/assets/Prometheus.png',
    badge: payload.badge || '/assets/Prometheus.png',
    tag: payload.tag || 'prometheus-chat-response',
    actions: notificationActions(payload),
    data: {
      url: payload.url || '/mobile/chat',
      ...(payload.data || {}),
    },
  };
  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    await setBadge((await getVisibleNotificationCount()) || 1);
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'clear') {
    event.waitUntil(setBadge(getVisibleNotificationCount()));
    return;
  }
  const rawUrl = event.notification?.data?.url || '/mobile/chat';
  event.waitUntil((async () => {
    await setBadge(0);
    const targetUrl = new URL(rawUrl, self.location.origin).href;
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if ('focus' in client) {
        try {
          if ('navigate' in client) await client.navigate(targetUrl);
          await client.focus();
          return;
        } catch {}
      }
    }
    await clients.openWindow(targetUrl);
  })());
});

// Allow the page to force-update the SW from the in-app menu later.
self.addEventListener('message', (event) => {
  if (event.data === 'pm-skip-waiting') self.skipWaiting();
  if (event.data === 'pm-clear-badge') {
    event.waitUntil(setBadge(0));
  }
  if (event.data && typeof event.data === 'object' && event.data.type === 'pm-set-badge') {
    event.waitUntil(setBadge(event.data.count));
  }
  if (event.data === 'pm-purge-caches') {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k.startsWith('prometheus-')).map(k => caches.delete(k)));
      const clients = await self.clients.matchAll();
      for (const c of clients) c.postMessage('pm-caches-purged');
    })());
  }
});
