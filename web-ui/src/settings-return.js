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

export function resolveMobileSettingsReturnUrl(locationLike = globalThis.location) {
  const url = locationUrl(locationLike);
  const route = normalizeMobileSettingsReturnRoute(url.searchParams.get(MOBILE_SETTINGS_RETURN_PARAM));
  if (!route) return '';
  if (url.searchParams.get(MOBILE_SETTINGS_SOURCE_PARAM) === 'pwa') {
    return `/?source=pwa${route}`;
  }
  return `/${route.slice(1)}`;
}

export function returnFromMobileSettings(locationLike = globalThis.location) {
  const target = resolveMobileSettingsReturnUrl(locationLike);
  if (!target) return false;
  locationLike.assign(target);
  return true;
}

export function installMobileSettingsReturnBridge(windowRef = globalThis.window) {
  if (!windowRef) return;
  windowRef.__PROM_RETURN_FROM_MOBILE_SETTINGS = () => returnFromMobileSettings(windowRef.location);
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
