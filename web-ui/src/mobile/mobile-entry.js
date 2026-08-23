import './mobile-pwa.js';

document.body.classList.add('pm-mobile-active', 'pm-mobile-document-scroll');
document.body.classList.remove('auth-pending');
window.__PROM_SHOULD_BOOT_MOBILE = () => true;

let markdownLibrariesPromise = null;

function loadExternalScript(src) {
  return new Promise((resolve) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.promLoaded === '1') resolve({ src, ok: true });
      else {
        existing.addEventListener('load', () => resolve({ src, ok: true }), { once: true });
        existing.addEventListener('error', () => resolve({ src, ok: false }), { once: true });
      }
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.promLoaded = '1';
      resolve({ src, ok: true });
    };
    script.onerror = () => resolve({ src, ok: false });
    document.head.appendChild(script);
  });
}

// Pairing and secondary routes do not need the markdown vendor payload. Chat
// starts it in parallel with its owner chunk and rerenders when it is ready.
window.__PROM_ENSURE_MARKDOWN_LIBS = () => {
  if (!markdownLibrariesPromise) {
    const purifierReady = loadExternalScript('/vendor/dompurify/purify.min.js');
    const markedReady = purifierReady
      .then(() => loadExternalScript('/vendor/marked/marked.min.js'))
      .then((result) => {
        try { window.dispatchEvent(new CustomEvent('prometheus:markdown-ready', { detail: result })); } catch {}
        return result;
      });
    markdownLibrariesPromise = Promise.allSettled([purifierReady, markedReady]);
  }
  return markdownLibrariesPromise;
};

function renderOfflineBootstrapFallback() {
  const root = document.getElementById('mobile-root');
  if (!root) return;
  root.innerHTML = `
    <main role="status" style="box-sizing:border-box;display:grid;min-height:100dvh;place-items:center;padding:2rem;background:#101112;color:#f5efe7;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif">
      <section style="max-width:28rem">
        <h1 style="margin:0 0 .75rem;font-size:1.4rem">Prometheus is offline</h1>
        <p style="margin:0;line-height:1.5;color:#c9b8a7">The saved mobile entry is available, but the rest of this route has not been cached yet. Prometheus will reconnect when the gateway is reachable.</p>
      </section>
    </main>`;
  window.addEventListener('online', () => window.location.reload(), { once: true });
}

window.__PROM_MOBILE_ROUTER_READY = import('./mobile-router.js').catch((error) => {
  console.error('[mobile] router import failed:', error);
  renderOfflineBootstrapFallback();
  return null;
});
