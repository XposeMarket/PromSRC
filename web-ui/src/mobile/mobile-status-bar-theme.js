const STYLE_ID = 'pm-mobile-status-bar-theme-style';
const LAYER_ID = 'pm-mobile-status-edge-tint';
const STYLE_VERSION = 'pm-v302-2026-08-22-status-edge-theme-sync';

let rootObserver = null;
let bodyObserver = null;
let syncRaf = 0;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  link.href = new URL(`../styles/mobile-status-bar-theme.css?v=${STYLE_VERSION}`, import.meta.url).href;
  link.dataset.promMobileStatusBarTheme = '1';
  document.head.appendChild(link);
}

function ensureTintLayer() {
  const host = document.querySelector('#mobile-root .pm-app');
  if (!host) return null;

  let layer = document.getElementById(LAYER_ID);
  if (!layer) {
    layer = document.createElement('div');
    layer.id = LAYER_ID;
    layer.className = 'pm-mobile-status-edge-tint';
    layer.setAttribute('aria-hidden', 'true');
    layer.setAttribute('data-html2canvas-ignore', 'true');
  }
  if (layer.parentElement !== host) host.appendChild(layer);
  return layer;
}

function ensureThemeColorMeta() {
  let meta = document.querySelector('meta[name="theme-color"]');
  if (meta) return meta;
  meta = document.createElement('meta');
  meta.name = 'theme-color';
  document.head.appendChild(meta);
  return meta;
}

function readMobileBackground() {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--pm-bg').trim();
  return value || '#0b0b0d';
}

function syncStatusBarTheme(reason = 'sync') {
  if (!document.body?.classList?.contains('pm-mobile-active')) return;

  ensureStyles();
  const layer = ensureTintLayer();
  const background = readMobileBackground();
  const root = document.documentElement;

  // Keep the document-owned backdrop and Safari's theme-color hint on the same
  // live mobile palette. iOS can otherwise retain the color it saw when the PWA
  // first launched even after Prometheus switches from black to Blue/Violet.
  root.style.setProperty('--pm-mobile-native-chrome-color', background);
  ensureThemeColorMeta().setAttribute('content', background);

  if (layer) {
    layer.dataset.skin = root.getAttribute('data-skin') || '';
    layer.dataset.theme = root.getAttribute('data-theme') || '';
    layer.dataset.lastSync = reason;
  }
}

function queueSync(reason) {
  if (syncRaf) cancelAnimationFrame(syncRaf);
  syncRaf = requestAnimationFrame(() => {
    syncRaf = 0;
    syncStatusBarTheme(reason);
    // Re-read one frame later so computed --pm-bg has settled after a theme
    // attribute/custom-theme update before Safari samples the document edge.
    requestAnimationFrame(() => syncStatusBarTheme(`${reason}-settled`));
  });
}

function installObservers() {
  if (!rootObserver) {
    rootObserver = new MutationObserver(() => queueSync('root-theme-attribute'));
    rootObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-skin'],
    });
  }
  if (!bodyObserver && document.body) {
    bodyObserver = new MutationObserver(() => {
      if (document.body.classList.contains('pm-mobile-active')) queueSync('mobile-activation');
    });
    bodyObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }
}

export function initMobileStatusBarTheme() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__pmMobileStatusBarTheme?.initialized) return;

  ensureStyles();
  installObservers();

  document.addEventListener('prom-theme-change', () => queueSync('theme-change'));
  document.addEventListener('prom-appearance-change', () => queueSync('appearance-change'));
  window.addEventListener('pageshow', () => queueSync('pageshow'), { passive: true });
  window.addEventListener('focus', () => queueSync('focus'), { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) queueSync('visibility');
  });

  queueSync('init');

  window.__pmMobileStatusBarTheme = {
    initialized: true,
    refresh: () => queueSync('manual'),
    getStatus: () => ({
      background: readMobileBackground(),
      metaThemeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') || '',
      skin: document.documentElement.getAttribute('data-skin') || '',
      active: document.body.classList.contains('pm-mobile-active'),
    }),
  };
}
