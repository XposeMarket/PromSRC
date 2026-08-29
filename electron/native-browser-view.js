'use strict';

const { createNativeBrowserNavigationController } = require('./native-browser-navigation');

function prepareNativeBrowserWebContents(webContents) {
  if (!webContents || webContents.__prometheusNavigationPrepared === true) return webContents?.__prometheusNavigationController || null;
  if (typeof webContents.loadURL !== 'function') return null;

  const rawLoadURL = webContents.loadURL.bind(webContents);
  const rawStop = typeof webContents.stop === 'function' ? webContents.stop.bind(webContents) : null;
  const rawOn = typeof webContents.on === 'function' ? webContents.on.bind(webContents) : null;
  const rawOnce = typeof webContents.once === 'function' ? webContents.once.bind(webContents) : null;
  const rawRemoveListener = typeof webContents.removeListener === 'function'
    ? webContents.removeListener.bind(webContents)
    : null;
  const wrappedFailureListeners = new WeakMap();
  const controller = createNativeBrowserNavigationController({
    loadURL: rawLoadURL,
    stop: rawStop,
  });

  webContents.loadURL = (url, ...args) => controller.load(url, ...args);

  const wrapFailureListener = (listener) => {
    if (typeof listener !== 'function') return listener;
    const wrapped = (event, errorCode, description, validatedURL, ...rest) => {
      const decision = controller.classifyFailure({ errorCode, validatedURL });
      if (!decision.authoritative) return undefined;
      return listener(event, errorCode, description, validatedURL, ...rest);
    };
    wrappedFailureListeners.set(listener, wrapped);
    return wrapped;
  };

  if (rawOn) {
    webContents.on = (eventName, listener) => rawOn(
      eventName,
      eventName === 'did-fail-load' ? wrapFailureListener(listener) : listener,
    );
  }
  if (rawOnce) {
    webContents.once = (eventName, listener) => rawOnce(
      eventName,
      eventName === 'did-fail-load' ? wrapFailureListener(listener) : listener,
    );
  }
  if (rawRemoveListener) {
    webContents.removeListener = (eventName, listener) => {
      const target = eventName === 'did-fail-load'
        ? (wrappedFailureListeners.get(listener) || listener)
        : listener;
      wrappedFailureListeners.delete(listener);
      return rawRemoveListener(eventName, target);
    };
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
