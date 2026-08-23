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

window.__PROM_MOBILE_ROUTER_READY = import('./mobile-router.js').catch((error) => {
  console.error('[mobile] router import failed:', error);
  throw error;
});
