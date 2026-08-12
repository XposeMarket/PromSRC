'use strict';

// WebContentsView is the preferred implementation. BrowserView remains a
// compatibility fallback for Electron runtimes where the newer View API is
// not usable on the host window.
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
    implementations.push({ kind: 'web-contents', Constructor: WebContentsView });
  }

  if (
    typeof BrowserView === 'function'
    && (
      typeof mainWindow.addBrowserView === 'function'
      || typeof mainWindow.setBrowserView === 'function'
    )
  ) {
    implementations.push({ kind: 'browser', Constructor: BrowserView });
  }

  return implementations;
}

module.exports = { getNativeBrowserViewImplementations };
