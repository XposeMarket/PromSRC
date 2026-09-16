let markdownReadyPromise = null;

function scriptReady(src, globalName) {
  if (typeof window !== 'undefined' && window[globalName]) return Promise.resolve(true);
  return new Promise((resolve) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (window[globalName]) { resolve(true); return; }
      existing.addEventListener('load', () => resolve(Boolean(window[globalName])), { once: true });
      existing.addEventListener('error', () => resolve(false), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.mobileV2Vendor = globalName;
    script.addEventListener('load', () => resolve(Boolean(window[globalName])), { once: true });
    script.addEventListener('error', () => resolve(false), { once: true });
    document.head.appendChild(script);
  });
}

export function ensureMobileV2Markdown() {
  if (!markdownReadyPromise) {
    markdownReadyPromise = scriptReady('/vendor/dompurify/purify.min.js', 'DOMPurify')
      .then(() => scriptReady('/vendor/marked/marked.min.js', 'marked'))
      .then(() => Boolean(window.DOMPurify && window.marked))
      .catch(() => false);
  }
  return markdownReadyPromise;
}
