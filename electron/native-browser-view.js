'use strict';

const { createNativeBrowserNavigationController } = require('./native-browser-navigation');

function prepareNativeBrowserWebContents(webContents) {
  if (!webContents || webContents.__prometheusNavigationPrepared === true) return webContents?.__prometheusNavigationController || null;
  if (typeof webContents.loadURL !== 'function') return null;

  const rawLoadURL = webContents.loadURL.bind(webContents);
  const rawStop = typeof webContents.stop === 'function' ? webContents.stop.bind(webContents) : null;
  const rawOn = typeof webContents.on === 'function' ? webContents.on.bind(webContents) : null;
  const rawOnce = typeof webContents.once === 'function' ? webContents.once.bind(webContents) : null;
  const rawAddListener = typeof webContents.addListener === 'function'
    ? webContents.addListener.bind(webContents)
    : rawOn;
  const rawRemoveListener = typeof webContents.removeListener === 'function'
    ? webContents.removeListener.bind(webContents)
    : null;
  const wrappedFailureListeners = new WeakMap();
  const controller = createNativeBrowserNavigationController({
    loadURL: rawLoadURL,
    stop: rawStop,
  });

  webContents.loadURL = (url, ...args) => controller.load(url, ...args);

  const trackFailureListener = (listener, wrapped) => {
    const registrations = wrappedFailureListeners.get(listener) || [];
    registrations.push(wrapped);
    wrappedFailureListeners.set(listener, registrations);
  };

  const forgetFailureListener = (listener, wrapped) => {
    const registrations = wrappedFailureListeners.get(listener);
    if (!registrations?.length) return;
    const index = registrations.lastIndexOf(wrapped);
    if (index >= 0) registrations.splice(index, 1);
    if (registrations.length) wrappedFailureListeners.set(listener, registrations);
    else wrappedFailureListeners.delete(listener);
  };

  const wrapFailureListener = (listener, once = false) => {
    if (typeof listener !== 'function') return listener;
    const wrapped = (event, errorCode, description, validatedURL, ...rest) => {
      if (once) {
        rawRemoveListener?.('did-fail-load', wrapped);
        forgetFailureListener(listener, wrapped);
      }
      const decision = controller.classifyFailure({ errorCode, validatedURL });
      if (!decision.authoritative) return undefined;
      return listener(event, errorCode, description, validatedURL, ...rest);
    };
    trackFailureListener(listener, wrapped);
    return wrapped;
  };

  const registerListener = (eventName, listener, once = false) => {
    if (eventName !== 'did-fail-load') {
      return once && rawOnce ? rawOnce(eventName, listener) : rawOn?.(eventName, listener);
    }
    const wrapped = wrapFailureListener(listener, once);
    // Register the explicit once wrapper with rawOn rather than rawOnce. The
    // original EventEmitter.once() delegates through this.on(), which would
    // otherwise pass through our override again and double-wrap the listener.
    return rawOn?.(eventName, wrapped);
  };

  if (rawOn) webContents.on = (eventName, listener) => registerListener(eventName, listener, false);
  if (rawAddListener) webContents.addListener = (eventName, listener) => registerListener(eventName, listener, false);
  if (rawOnce) webContents.once = (eventName, listener) => registerListener(eventName, listener, true);
  if (rawRemoveListener) {
    webContents.removeListener = (eventName, listener) => {
      if (eventName !== 'did-fail-load') return rawRemoveListener(eventName, listener);
      const registrations = wrappedFailureListeners.get(listener);
      const target = registrations?.length ? registrations[registrations.length - 1] : listener;
      if (registrations?.length) forgetFailureListener(listener, target);
      return rawRemoveListener(eventName, target);
    };
    // EventEmitter.prototype.off is an alias to the original prototype method,
    // so overriding removeListener on this instance does not make off() route
    // through the wrapped-listener lookup automatically.
    if (typeof webContents.off === 'function') {
      webContents.off = (eventName, listener) => webContents.removeListener(eventName, listener);
    }
  }

  Object.defineProperty(webContents, '__prometheusNavigationPrepared', {
    configurable: true,
    enumerable: false,
    value: true,
  });
  Object.defineProperty(webContents, '__prometheusNavigationController', {
    configurable: true,
    enumerable: false,
    value: controller,
  });
  return controller;
}

function navigationAwareConstructor(Constructor) {
  return new Proxy(Constructor, {
    construct(Target, args) {
      const view = Reflect.construct(Target, args);
      prepareNativeBrowserWebContents(view?.webContents);
      return view;
    },
  });
}

// WebContentsView is the preferred implementation. BrowserView remains a
// compatibility fallback for Electron runtimes where the newer View API is
// not usable on the host window. Both constructors are wrapped narrowly so
// every native-tab loadURL path shares the same latest-navigation authority.
function getNativeBrowserViewImplementations({ mainWindow, WebContentsView, BrowserView } = {}) {
  if (!mainWindow || (typeof mainWindow.isDestroyed === 'function' && mainWindow.isDestroyed())) {
    return [];
  }

  const implementations = [];
  if (
    typeof WebContentsView === 'function'
    && mainWindow.contentView
    && typeof mainWindow.contentView.addChildView === 'function'
    && typeof mainWindow.contentView.removeChildView === 'function'
  ) {
    implementations.push({ kind: 'web-contents', Constructor: navigationAwareConstructor(WebContentsView) });
  }

  if (
    typeof BrowserView === 'function'
    && (
      typeof mainWindow.addBrowserView === 'function'
      || typeof mainWindow.setBrowserView === 'function'
    )
  ) {
    implementations.push({ kind: 'browser', Constructor: navigationAwareConstructor(BrowserView) });
  }

  return implementations;
}

module.exports = {
  getNativeBrowserViewImplementations,
  prepareNativeBrowserWebContents,
};
