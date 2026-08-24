import { DEFAULT_SPEC, renderLiquidGlass } from '../vendor/liquid-glass.js';

// This bridge does not implement or approximate Liquid Glass. The optical pass
// comes directly from XposeMarket/liquid-glass. The only Prometheus-specific
// work here is supplying that exact compositor with a canvas snapshot of the DOM
// pixels that are physically behind the mobile hamburger button.
const DEMO_SPEC = Object.freeze({ ...DEFAULT_SPEC, blur: 0, fill: 0.65 });
const TARGET_SELECTOR = [
  '.pm-header > .pm-icon-btn[data-action="menu"]',
  '.pm-header .pm-icon-btn[aria-label="Menu"]',
  '.pm-header .pm-icon-btn[aria-label="Open menu"]',
].join(', ');
const CANVAS_CLASS = 'pm-hamburger-liquid-glass-canvas';
const STYLE_ID = 'pm-mobile-hamburger-liquid-glass-style';
const STYLE_VERSION = 'pm-v301-2026-08-22-cropped-hamburger';
const MIN_RENDER_INTERVAL_MS = 70;

let html2CanvasPromise = null;

const state = {
  observer: null,
  raf: 0,
  timer: 0,
  rendering: false,
  rerender: false,
  lastStartedAt: 0,
  lastCompletedAt: 0,
  lastDurationMs: 0,
  lastReason: 'init',
  renderCount: 0,
  failureCount: 0,
  lastError: '',
};

function loadHtml2Canvas() {
  if (!html2CanvasPromise) {
    html2CanvasPromise = import('/vendor/html2canvas/html2canvas.esm.js')
      .then((module) => module.default || module)
      .catch((error) => {
        html2CanvasPromise = null;
        throw error;
      });
  }
  return html2CanvasPromise;
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  const styleUrl = new URL(`../styles/mobile-hamburger-liquid-glass.css?v=${STYLE_VERSION}`, import.meta.url);
  if (styleUrl.pathname.includes('/build/')) styleUrl.pathname = '/static/styles/mobile-hamburger-liquid-glass.css';
  link.href = styleUrl.href;
  link.dataset.promMobileHamburgerLiquidGlass = '1';
  document.head.appendChild(link);
}

function currentTarget() {
  if (!document.body?.classList?.contains('pm-mobile-active')) return null;
  return document.querySelector(TARGET_SELECTOR);
}

function ensureCanvas(button) {
  let canvas = button.querySelector(`:scope > .${CANVAS_CLASS}`);
  if (canvas) return canvas;
  canvas = document.createElement('canvas');
  canvas.className = CANVAS_CLASS;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.setAttribute('data-html2canvas-ignore', 'true');
  button.prepend(canvas);
  return canvas;
}

function rendererPadDevicePixels() {
  return Math.ceil(DEMO_SPEC.strength + DEMO_SPEC.blur * 2 + 10);
}

function markFailure(button, error) {
  state.failureCount += 1;
  state.lastError = String(error?.message || error || 'unknown capture failure');
  button?.removeAttribute('data-pm-liquid-glass-ready');
  button?.setAttribute('data-pm-liquid-glass-error', '1');
}

function schedule(reason = 'update') {
  state.lastReason = reason;
  if (state.rendering) {
    state.rerender = true;
    return;
  }
  if (state.raf || state.timer) return;

  const elapsed = performance.now() - state.lastStartedAt;
  const wait = Math.max(0, MIN_RENDER_INTERVAL_MS - elapsed);
  const queue = () => {
    state.timer = 0;
    state.raf = requestAnimationFrame(() => {
      state.raf = 0;
      renderHamburgerGlass().catch(() => {});
    });
  };
  if (wait > 1) state.timer = window.setTimeout(queue, wait);
  else queue();
}

async function renderHamburgerGlass() {
  const button = currentTarget();
  if (!button || document.body.classList.contains('pm-mobile-drawer-open')) return;

  const rect = button.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;

  const app = document.querySelector('.pm-app');
  if (!app) return;
  const appRect = app.getBoundingClientRect();
  if (appRect.width < 2 || appRect.height < 2) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const padDevice = rendererPadDevicePixels();
  const padCss = padDevice / dpr;
  const viewportWidth = window.visualViewport?.width || window.innerWidth || document.documentElement.clientWidth || appRect.width;
  const viewportHeight = window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || appRect.height;

  const left = Math.max(0, rect.left - padCss);
  const top = Math.max(0, rect.top - padCss);
  const right = Math.min(viewportWidth, rect.right + padCss);
  const bottom = Math.min(viewportHeight, rect.bottom + padCss);
  const captureWidth = Math.max(2, right - left);
  const captureHeight = Math.max(2, bottom - top);

  state.rendering = true;
  state.rerender = false;
  state.lastStartedAt = performance.now();
  const canvas = ensureCanvas(button);
  button.setAttribute('data-pm-liquid-glass-rendering', '1');

  try {
    const html2canvas = await loadHtml2Canvas();
    const scene = await html2canvas(app, {
      backgroundColor: null,
      logging: false,
      useCORS: true,
      allowTaint: false,
      removeContainer: true,
      scale: dpr,
      x: left - appRect.left,
      y: top - appRect.top,
      width: captureWidth,
      height: captureHeight,
      scrollX: 0,
      scrollY: 0,
      windowWidth: Math.max(1, Math.round(window.innerWidth || viewportWidth)),
      windowHeight: Math.max(1, Math.round(window.innerHeight || viewportHeight)),
      ignoreElements: (element) => {
        if (!(element instanceof Element)) return false;
        return element.matches(TARGET_SELECTOR)
          || element.classList.contains(CANVAS_CLASS)
          || element.id === 'pm-liquid-glass-defs';
      },
      onclone: (clonedDocument) => {
        // Header chrome is foreground, not backdrop. Removing it from only the
        // capture clone exposes the same DOM content that is physically beneath
        // the live hamburger without touching the live app or its interactions.
        clonedDocument.querySelectorAll('.pm-header').forEach((node) => node.remove());
        clonedDocument.querySelectorAll(`.${CANVAS_CLASS}`).forEach((node) => node.remove());
      },
    });

    const sceneCtx = scene.getContext('2d', { willReadFrequently: true });
    if (!sceneCtx) throw new Error('2D scene context unavailable');

    // The canonical compositor needs padding around the button so its inward
    // sampling has real pixels to pull from. Keep that padded output OFFSCREEN,
    // then crop only the physical button rectangle into the visible child canvas.
    // This prevents any optical pixels from leaking into the status/safe-area strip.
    const rendered = document.createElement('canvas');
    rendered.width = Math.max(2, scene.width);
    rendered.height = Math.max(2, scene.height);
    const renderedCtx = rendered.getContext('2d');
    if (!renderedCtx) throw new Error('2D compositor output context unavailable');

    const centerX = (rect.left - left + rect.width / 2) * dpr;
    const centerY = (rect.top - top + rect.height / 2) * dpr;

    renderLiquidGlass({
      sceneCtx,
      glassCtx: renderedCtx,
      x: centerX,
      y: centerY,
      width: rect.width * dpr,
      height: rect.height * dpr,
      spec: DEMO_SPEC,
    });

    const buttonWidth = Math.max(2, Math.round(rect.width * dpr));
    const buttonHeight = Math.max(2, Math.round(rect.height * dpr));
    const cropX = Math.max(0, Math.round((rect.left - left) * dpr));
    const cropY = Math.max(0, Math.round((rect.top - top) * dpr));

    if (canvas.width !== buttonWidth) canvas.width = buttonWidth;
    if (canvas.height !== buttonHeight) canvas.height = buttonHeight;
    const visibleCtx = canvas.getContext('2d');
    if (!visibleCtx) throw new Error('2D visible output context unavailable');
    visibleCtx.clearRect(0, 0, buttonWidth, buttonHeight);
    visibleCtx.drawImage(
      rendered,
      cropX,
      cropY,
      buttonWidth,
      buttonHeight,
      0,
      0,
      buttonWidth,
      buttonHeight,
    );

    state.renderCount += 1;
    state.lastCompletedAt = performance.now();
    state.lastDurationMs = state.lastCompletedAt - state.lastStartedAt;
    state.lastError = '';
    button.removeAttribute('data-pm-liquid-glass-error');
    button.setAttribute('data-pm-liquid-glass-ready', '1');
  } catch (error) {
    markFailure(button, error);
    if (state.failureCount <= 3) {
      console.warn('[mobile-liquid-glass] hamburger DOM capture failed', error);
    }
  } finally {
    button.removeAttribute('data-pm-liquid-glass-rendering');
    state.rendering = false;
    if (state.rerender) schedule('coalesced');
  }
}

function wireInvalidationEvents() {
  document.addEventListener('scroll', () => schedule('scroll'), { capture: true, passive: true });
  document.addEventListener('prom-theme-change', () => schedule('theme'));
  document.addEventListener('pm-drawer-closed', () => schedule('drawer-closed'));
  window.addEventListener('resize', () => schedule('resize'), { passive: true });
  window.addEventListener('orientationchange', () => schedule('orientation'), { passive: true });
  window.visualViewport?.addEventListener('resize', () => schedule('visual-viewport-resize'), { passive: true });
  window.visualViewport?.addEventListener('scroll', () => schedule('visual-viewport-scroll'), { passive: true });
}

function installObserver() {
  if (state.observer) return;
  const root = document.getElementById('mobile-root');
  if (!root) return;
  state.observer = new MutationObserver((mutations) => {
    let relevant = false;
    for (const mutation of mutations) {
      const target = mutation.target;
      if (target instanceof Element && target.closest?.(`.${CANVAS_CLASS}`)) continue;
      relevant = true;
      break;
    }
    if (relevant) schedule('dom-mutation');
  });
  state.observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'src'],
  });
}

export function initMobileHamburgerLiquidGlass() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__pmHamburgerLiquidGlass?.initialized) return;

  ensureStyles();
  wireInvalidationEvents();
  installObserver();
  schedule('init');

  window.__pmHamburgerLiquidGlass = {
    initialized: true,
    refresh: () => schedule('manual'),
    getStatus: () => ({
      renderCount: state.renderCount,
      failureCount: state.failureCount,
      lastDurationMs: Math.round(state.lastDurationMs * 10) / 10,
      lastReason: state.lastReason,
      lastError: state.lastError,
      ready: currentTarget()?.getAttribute('data-pm-liquid-glass-ready') === '1',
      renderer: 'XposeMarket/liquid-glass',
      spec: { ...DEMO_SPEC },
    }),
  };
}
