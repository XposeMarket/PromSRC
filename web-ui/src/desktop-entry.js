import { checkSessionDetailed, mountLoginScreen, getAccount, getPersistedAccount } from './auth/account.js';
import { installMobileSettingsReturnBridge } from './settings-return.js';

installMobileSettingsReturnBridge(window);

const ACCOUNT_MONITOR_INTERVAL_MS = 2 * 60 * 1000;
let accountMonitorId = null;

const mobileSurface = document.body.classList.contains('pm-mobile-active')
  && !window.__PROM_CREATIVE_RENDER_CONTEXT?.enabled;

if (mobileSurface) {
  // Mixed-version distribution fallback: PR 2's gateway normally serves the
  // lightweight mobile document, but an old package missing mobile.html can
  // still recover through index.html without eagerly evaluating desktop code.
  window.__PROM_DESKTOP_MODULES_READY = Promise.resolve([]);
  window.__PROM_MOBILE_ROUTER_READY = import('./mobile/mobile-router.js').catch((error) => {
    console.error('[mobile] router import failed:', error);
    throw error;
  });
} else {
  window.__PROM_MOBILE_ROUTER_READY = Promise.resolve(null);
  window.__PROM_DESKTOP_MODULES_READY = Promise.all([
    import('./state.js'),
    import('./api.js'),
    import('./utils.js'),
    import('./ws.js'),
    import('./app.js'),
  ]);
}

// Mobile Settings intentionally crosses into the canonical desktop document.
// Open the requested settings tab after the desktop modules have initialized.
try {
  const settingsParams = new URLSearchParams(window.location.search || '');
  if (!mobileSurface && settingsParams.get('settings') === '1') {
    const requestedSettingsTab = String(settingsParams.get('settingsTab') || '').trim();
    // The inline desktop shim is already available and reveals the canonical
    // settings surface before its lazy module finishes loading. Do not wait on
    // the unrelated desktop bundle: one failed import must not strand a mobile
    // settings handoff on the underlying chat page.
    if (typeof window.openSettings === 'function') {
      Promise.resolve(window.openSettings(requestedSettingsTab || undefined))
        .catch((error) => console.warn('[settings] desktop handoff failed:', error));
    }
  }
} catch {}

function unlockApp() {
  document.body.classList.remove('auth-pending');
  document.getElementById('prometheus-auth-gate')?.remove();
}

async function bootWithAuth() {
  if (window.__PROM_CREATIVE_RENDER_CONTEXT?.enabled) {
    document.body.classList.add('creative-render-worker');
    unlockApp();
    return;
  }
  if (document.body.classList.contains('pm-mobile-active')) {
    unlockApp();
    return;
  }
  const persistedAccount = getPersistedAccount();
  if (persistedAccount?.subscriptionActive || persistedAccount?.isAdmin) {
    finishAuthenticatedBoot(persistedAccount);
    verifyAccountStillActive().catch((error) => {
      console.warn('[prometheus auth] background verification error:', error);
    });
    return;
  }

  const result = await checkSessionDetailed({ timeoutMs: 3000 });
  const account = result.account || getAccount() || getPersistedAccount();

  if (result.authenticated && (account?.subscriptionActive || account?.isAdmin)) {
    finishAuthenticatedBoot(account);
    verifyAccountStillActive().catch((error) => {
      console.warn('[prometheus auth] background verification error:', error);
    });
    return;
  }

  mountLoginScreen((accountValue) => {
    finishAuthenticatedBoot(accountValue);
  });
}

function updateAccountDisplay(account) {
  const element = document.getElementById('account-email-display');
  if (element) element.textContent = account?.email || '';
}

function stopAccountMonitor() {
  if (accountMonitorId !== null) {
    clearInterval(accountMonitorId);
    accountMonitorId = null;
  }
}

async function verifyAccountStillActive() {
  const result = await checkSessionDetailed({ strict: true, timeoutMs: 15000 });
  if (!result.authenticated && result.definitive) {
    stopAccountMonitor();
    location.reload();
  }
}

function startAccountMonitor() {
  stopAccountMonitor();
  accountMonitorId = window.setInterval(() => {
    verifyAccountStillActive().catch((error) => {
      console.warn('[prometheus auth] account monitor error:', error);
    });
  }, ACCOUNT_MONITOR_INTERVAL_MS);
}

function finishAuthenticatedBoot(account) {
  updateAccountDisplay(account);
  unlockApp();
  if (window.__PROM_CREATIVE_RENDER_CONTEXT?.enabled) return;
  startAccountMonitor();
}

bootWithAuth().catch((error) => {
  console.error('[prometheus auth]', error);
  const fallbackAccount = getPersistedAccount();
  if (fallbackAccount?.subscriptionActive || fallbackAccount?.isAdmin) {
    finishAuthenticatedBoot(fallbackAccount);
    return;
  }
  mountLoginScreen((account) => {
    finishAuthenticatedBoot(account);
  });
});

window.addEventListener('beforeunload', stopAccountMonitor);

window.prometheusLogout = async function prometheusLogout() {
  try {
    const { logout } = await import('./auth/account.js');
    await logout();
  } catch (error) {
    console.warn('[prometheus] logout error:', error);
  }
  location.reload();
};

window.refreshAccountDisplay = function refreshAccountDisplay() {
  fetch('/api/account/status')
    .then((response) => response.json())
    .then((data) => {
      const element = document.getElementById('account-email-display');
      if (element && data.email) element.textContent = data.email;
    })
    .catch(() => {});
};

// Right panel resize handler (drag left edge to widen).
(() => {
  const handle = document.getElementById('rp-resize');
  const rightPanel = document.getElementById('right-panel');
  if (!handle || !rightPanel) return;

  let startX;
  let startWidth;
  let previousTransition;

  function onMove(event) {
    const delta = startX - event.clientX;
    const viewportWidth = Math.max(0, window.innerWidth || document.documentElement.clientWidth || 0);
    const canvasActive = rightPanel.classList.contains('canvas-open');
    const minimumWidth = canvasActive ? 620 : 280;
    const maximumRatio = canvasActive ? 0.68 : 0.52;
    const ratioMaximumWidth = viewportWidth ? Math.floor(viewportWidth * maximumRatio) : 900;
    const canvasMaximumWidth = canvasActive && typeof window.getCanvasPanelMaximumWidth === 'function'
      ? Number(window.getCanvasPanelMaximumWidth())
      : Number.POSITIVE_INFINITY;
    const maximumWidth = Math.max(minimumWidth, Math.min(ratioMaximumWidth, canvasMaximumWidth));
    const nextWidth = Math.max(minimumWidth, Math.min(maximumWidth, startWidth + delta));
    rightPanel.style.width = `${nextWidth}px`;
    rightPanel.style.minWidth = `${nextWidth}px`;
    rightPanel.style.removeProperty('max-width');
    window._syncPageViewPositions?.();
    window.queueNativeBrowserSurfaceSync?.({ force: true });
  }

  function onUp() {
    handle.classList.remove('dragging');
    if (previousTransition) rightPanel.style.transition = previousTransition;
    else rightPanel.style.removeProperty('transition');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }

  handle.addEventListener('mousedown', (event) => {
    const widthLockMessage = typeof window.getCanvasWidthLockMessage === 'function'
      ? window.getCanvasWidthLockMessage()
      : '';
    if (widthLockMessage) {
      window.showToast?.(widthLockMessage, 'info');
      event.preventDefault();
      return;
    }
    startX = event.clientX;
    startWidth = rightPanel.offsetWidth;
    previousTransition = rightPanel.style.transition;
    rightPanel.style.transition = 'none';
    handle.classList.add('dragging');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    event.preventDefault();
  });
})();
