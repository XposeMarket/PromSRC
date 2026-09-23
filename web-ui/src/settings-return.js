const MOBILE_SETTINGS_RETURN_PARAM = 'settingsReturn';
const MOBILE_SETTINGS_SOURCE_PARAM = 'settingsSource';

function locationUrl(locationLike) {
  if (locationLike instanceof URL) return new URL(locationLike.href);
  const href = String(locationLike?.href || 'http://localhost/');
  return new URL(href, 'http://localhost/');
}

export function normalizeMobileSettingsReturnRoute(value) {
  let route = String(value || '').trim();
  if (!route) return '';
  try { route = decodeURIComponent(route); } catch {}
  if (/^#mobile(?:\/|$)/.test(route)) return route;
  if (/^\/mobile(?:\/|$)/.test(route)) return `#${route.replace(/^\/+/, '')}`;
  return '';
}

export function mobileSettingsReturnRoute(locationLike = globalThis.location) {
  const url = locationUrl(locationLike);
  const hashRoute = normalizeMobileSettingsReturnRoute(url.hash);
  const pathRoute = normalizeMobileSettingsReturnRoute(url.pathname);
  const route = hashRoute || pathRoute || '#mobile/more';
  // Returning to the Settings route would immediately reopen the desktop
  // handoff. The mobile More page is the canonical parent for Settings.
  return /^#mobile\/settings(?:\/|$)/.test(route) ? '#mobile/more' : route;
}

export function buildMobileSettingsHandoffUrl(locationLike = globalThis.location, tab = '') {
  const url = locationUrl(locationLike);
  const query = new URLSearchParams({
    desktop: '1',
    settings: '1',
    [MOBILE_SETTINGS_RETURN_PARAM]: mobileSettingsReturnRoute(url),
  });
  const requestedTab = String(tab || '').trim();
  if (requestedTab) query.set('settingsTab', requestedTab);
  if (url.searchParams.get('source') === 'pwa') query.set(MOBILE_SETTINGS_SOURCE_PARAM, 'pwa');
  return `/?${query.toString()}`;
}

const RETURN_STORAGE_KEY = 'pm_mobile_settings_return_url';

function sessionStore(windowRef) {
  try { return windowRef?.sessionStorage || globalThis.sessionStorage || null; } catch { return null; }
}

export function resolveMobileSettingsReturnUrl(locationLike = globalThis.location) {
  const url = locationUrl(locationLike);
  const route = normalizeMobileSettingsReturnRoute(url.searchParams.get(MOBILE_SETTINGS_RETURN_PARAM));
  if (!route) return '';
  if (url.searchParams.get(MOBILE_SETTINGS_SOURCE_PARAM) === 'pwa') {
    return `/?source=pwa${route}`;
  }
  return `/${route.slice(1)}`;
}

function isSafeStoredReturnUrl(value) {
  const target = String(value || '');
  return /^\/\?source=pwa#mobile(?:\/|$)/.test(target) || /^\/mobile(?:\/|$)/.test(target);
}

export function returnFromMobileSettings(locationLike = globalThis.location, windowRef = globalThis.window) {
  const store = sessionStore(windowRef);
  let target = resolveMobileSettingsReturnUrl(locationLike);
  if (!target) {
    // The handoff query can be lost (reload/rewrite). The handoff page recorded
    // where it came from; never strand a mobile user on the desktop app.
    try {
      const stored = store?.getItem(RETURN_STORAGE_KEY) || '';
      if (isSafeStoredReturnUrl(stored)) target = stored;
    } catch {}
  }
  if (!target) return false;
  try { store?.removeItem(RETURN_STORAGE_KEY); } catch {}
  // replace (not assign): the desktop handoff document must leave history.
  // With assign, an iOS swipe-back or bfcache restore reopened that document
  // with Settings already closed, i.e. the full desktop UI on a phone.
  if (typeof locationLike.replace === 'function') locationLike.replace(target);
  else locationLike.assign(target);
  return true;
}

export function installMobileSettingsReturnBridge(windowRef = globalThis.window) {
  if (!windowRef) return;
  const initialTarget = resolveMobileSettingsReturnUrl(windowRef.location);
  if (initialTarget) {
    try { sessionStore(windowRef)?.setItem(RETURN_STORAGE_KEY, initialTarget); } catch {}
    // bfcache restore of a handoff page whose Settings surface was already
    // closed would show the desktop app. Send it straight back to mobile.
    try {
      windowRef.addEventListener?.('pageshow', (event) => {
        if (!event?.persisted) return;
        const modal = windowRef.document?.getElementById?.('settings-modal');
        if (!modal || modal.style?.display === 'none') {
          const target = resolveMobileSettingsReturnUrl(windowRef.location) || initialTarget;
          if (typeof windowRef.location.replace === 'function') windowRef.location.replace(target);
          else windowRef.location.assign(target);
        }
      });
    } catch {}
  }
  windowRef.__PROM_RETURN_FROM_MOBILE_SETTINGS = () => returnFromMobileSettings(windowRef.location, windowRef);
  const closeSettings = windowRef.closeSettings;
  if (typeof closeSettings !== 'function' || closeSettings.__promMobileSettingsReturnBridge) return;
  const closeSettingsWithMobileReturn = (...args) => {
    const result = closeSettings.apply(windowRef, args);
    windowRef.document?.body?.classList?.remove('pm-mobile-overlay-open');
    windowRef.__PROM_RETURN_FROM_MOBILE_SETTINGS();
    return result;
  };
  closeSettingsWithMobileReturn.__promMobileSettingsReturnBridge = true;
  windowRef.closeSettings = closeSettingsWithMobileReturn;
}
