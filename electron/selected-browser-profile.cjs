const { isTrustedRendererUrl } = require('./security.js');

// Read the same preference as Settings, in the app window, never a browsed page.
// There is no second copy to migrate, grant to an agent, or keep in sync.
async function readSelectedBrowserProfile(window, gatewayUrl, lookup) {
  const frame = window && !window.isDestroyed() && window.webContents.mainFrame;
  if (!frame || !isTrustedRendererUrl(frame.url, gatewayUrl)) {
    throw new Error('Browser settings are not ready. Open the Prometheus desktop window and retry.');
  }
  // Check origin inside the read as well, in case the renderer navigated.
  const origin = JSON.stringify(new URL(gatewayUrl).origin);
  const value = await frame.executeJavaScript(`location.origin === ${origin} ? (localStorage.getItem('prometheus.inhouse.profile') || 'main') : null`);
  if (value === 'main') return value;
  if (typeof value !== 'string' || !/^imported-[a-z0-9]+$/.test(value) || !lookup(value)) {
    throw new Error('The selected browser profile is unavailable. Choose a profile in Settings > Search > Browser.');
  }
  return value;
}
module.exports = { readSelectedBrowserProfile };
