'use strict';

function isNativeBrowserNavigationAbort(error) {
  const message = String(error?.message || error || '').toUpperCase();
  return message.includes('ERR_ABORTED') || Number(error?.errno) === -3 || Number(error?.code) === -3;
}

function applyNativeBrowserNavigationFailureState(meta, {
  errorCode,
  description,
  validatedURL,
  currentURL,
} = {}) {
  // Electron reports ERR_ABORTED when a navigation is superseded. The event
  // can arrive after the replacement navigation has already become current,
  // so it must not write any state from the obsolete request.
  if (Number(errorCode) === -3) {
    return { authoritative: false, ignored: true };
  }

  const lastError = description || 'Native browser load failed.';
  const url = validatedURL || currentURL || meta?.url;
  if (meta && typeof meta === 'object') {
    meta.lastError = lastError;
    if (url) meta.url = url;
  }
  return { authoritative: true, ignored: false, lastError, url };
}

function createNativeBrowserNavigationController() {
  const inFlight = new Map();

  async function load(view, partition, tabId, url) {
    const key = `${partition}::${String(tabId || '').trim()}`;
    const previous = inFlight.get(key);
    if (previous) {
      previous.superseded = true;
      try { view.webContents.stop?.(); } catch {}
    }
    const entry = { superseded: false, promise: null };
    const promise = Promise.resolve().then(() => view.webContents.loadURL(url));
    entry.promise = promise;
    inFlight.set(key, entry);
    try {
      return await promise;
    } catch (error) {
      if (entry.superseded && isNativeBrowserNavigationAbort(error)) return null;
      throw error;
    } finally {
      if (inFlight.get(key) === entry) inFlight.delete(key);
    }
  }

  return { load, inFlight };
}

module.exports = {
  applyNativeBrowserNavigationFailureState,
  createNativeBrowserNavigationController,
  isNativeBrowserNavigationAbort,
};
