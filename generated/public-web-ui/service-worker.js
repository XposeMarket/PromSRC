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
const VERSION = 'pm-v70-2026-06-19-subagent-voice';
const STATIC_CACHE  = `prometheus-static-${VERSION}`;
const RUNTIME_CACHE = `prometheus-runtime-${VERSION}`;

// Files needed for the mobile shell to render offline.
const PRECACHE = [
  '/',
  '/mobile/chat',
  '/mobile/voice',
  '/mobile/tasks',
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

function offlineShellResponse() {
  return caches.match('/?source=pwa#mobile/chat')
    .then((cached) => cached || caches.match('/') || caches.match('/index.html'))
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

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname.startsWith('/src/')) {
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
      url: payload.url || '/?source=pwa#mobile/chat',
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
  const rawUrl = event.notification?.data?.url || '/?source=pwa#mobile/chat';
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
