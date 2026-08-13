/**
 * Prometheus Desktop — Preload Script
 *
 * Runs in the renderer context (sandboxed) before the page loads.
 * Exposes a safe, narrow API to the web-ui via contextBridge.
 *
 * Only two surfaces are exposed:
 *   window.prometheusUpdater  — auto-update events + install trigger
 *   window.prometheusApp      — app metadata (version, platform)
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

// ─── Auto-Updater Bridge ────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('prometheusUpdater', {
  /** Returns the current updater state. */
  getState: () => ipcRenderer.invoke('updater:get-state'),
  /** Force a web update check now. */
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  /** Download an update found during a manual check. */
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  /** Enable/disable automatic release checks. Installation always needs confirmation. */
  setAutoUpdateEnabled: (enabled) => ipcRenderer.invoke('updater:set-auto-update', { enabled: enabled === true }),
  /** Called whenever updater state changes. */
  onState: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const handler = (_event, state) => cb(state);
    ipcRenderer.on('updater-state', handler);
    return () => ipcRenderer.removeListener('updater-state', handler);
  },
  /** Called when a new version is available and has finished downloading. */
  onUpdateReady: (cb) => {
    ipcRenderer.on('update-ready', (_event, info) => cb(info));
  },
  /** Called with download progress (0–100). */
  onDownloadProgress: (cb) => {
    ipcRenderer.on('update-download-progress', (_event, progress) => cb(progress));
  },
  /** Called if the update check errors out — not shown to user, just for logging. */
  onUpdateError: (cb) => {
    ipcRenderer.on('update-error', (_event, message) => cb(message));
  },
  /** Confirm and start the protected drain/backup/install flow. */
  installUpdate: (confirmed = false) => ipcRenderer.invoke('updater:install', { confirm: confirmed === true }),
});

// ─── App Metadata ───────────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('prometheusApp', {
  isElectron: true,
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke('get-app-version'),
  setTitleBarTheme: (theme = {}) => ipcRenderer.invoke('window:titlebar-theme', {
    color: String(theme?.color || ''),
    symbolColor: String(theme?.symbolColor || ''),
  }),
});

// External links are an explicit escape hatch. Ordinary HTTP/HTTPS links are
// routed by the renderer into the Prometheus Browser; this bridge is only for
// a user-selected "Open externally" action or an intentional external flow.
contextBridge.exposeInMainWorld('prometheusExternalLinks', {
  open: (url) => ipcRenderer.invoke('external-link:open', { url: String(url || '') }),
  onPrometheusNavigation: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on('prometheus-browser-navigation', handler);
    return () => ipcRenderer.removeListener('prometheus-browser-navigation', handler);
  },
});

// ─── Desktop-only Pairing Administration ──────────────────────────────────
// The gateway credential never enters renderer JavaScript. Main validates the
// sender, allowlists the route, and attaches a per-process authority token.
contextBridge.exposeInMainWorld('prometheusPairingAdmin', {
  request: (payload = {}) => ipcRenderer.invoke('pairing-admin:request', payload),
});

// ─── Local File Selection Bridge ────────────────────────────────────────────
contextBridge.exposeInMainWorld('prometheusFiles', {
  selectCanvasFiles: () => ipcRenderer.invoke('select-canvas-paths', { mode: 'files' }),
  selectCanvasFolder: () => ipcRenderer.invoke('select-canvas-paths', { mode: 'folder' }),
  selectProjectFolder: () => ipcRenderer.invoke('select-canvas-paths', {
    mode: 'folder',
    title: 'Choose Project Directory',
  }),
  selectProjectPath: () => ipcRenderer.invoke('select-canvas-paths', {
    mode: 'any',
    title: 'Choose Project File or Directory',
  }),
  // Electron deliberately stopped exposing File.path to renderer code. Keep
  // this narrow bridge so Canvas drag/drop and browser-file inputs can retain
  // the selected local file rather than uploading a workspace copy.
  getCanvasFilePath: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return ''; }
  },
});

// Chrome profile import is intentionally a desktop-only, explicit opt-in
// bridge. The renderer receives profile labels and IDs, never cookie/password
// contents; main performs the validated copy into Prometheus-owned storage.
contextBridge.exposeInMainWorld('prometheusChromeProfiles', {
  detect: () => ipcRenderer.invoke('chrome-profiles:detect'),
  import: (profileId, options = {}) => ipcRenderer.invoke('chrome-profiles:import', {
    profileId: String(profileId || ''),
    refresh: options?.refresh === true,
  }),
});

// ─── Native In-App Browser Bridge ───────────────────────────────────────────
contextBridge.exposeInMainWorld('prometheusBrowserSurface', {
  available: () => ipcRenderer.invoke('native-browser:available'),
  attach: (options = {}) => ipcRenderer.invoke('native-browser:attach', options),
  detach: () => ipcRenderer.invoke('native-browser:detach'),
  setBounds: (bounds = {}) => ipcRenderer.invoke('native-browser:set-bounds', bounds),
  navigate: (payload = {}) => ipcRenderer.invoke('native-browser:navigate', payload),
  listTabs: (options = {}) => ipcRenderer.invoke('native-browser:list-tabs', options),
  selectTab: (options = {}) => ipcRenderer.invoke('native-browser:select-tab', options),
  newTab: (options = {}) => ipcRenderer.invoke('native-browser:new-tab', options),
  closeTab: (options = {}) => ipcRenderer.invoke('native-browser:close-tab', options),
  focus: () => ipcRenderer.invoke('native-browser:focus'),
  state: () => ipcRenderer.invoke('native-browser:state'),
  onState: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const handler = (_event, state) => cb(state);
    ipcRenderer.on('native-browser-state', handler);
    return () => ipcRenderer.removeListener('native-browser-state', handler);
  },
  // Teach-mode capture in the in-house view.
  setTeachCapture: (options = {}) => ipcRenderer.invoke('native-browser:teach-capture', options),
  setDesignMode: (options = {}) => ipcRenderer.invoke('native-browser:design-mode', options),
  onTeachClick: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on('native-browser-teach-click', handler);
    return () => ipcRenderer.removeListener('native-browser-teach-click', handler);
  },
  onTeachHover: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on('native-browser-teach-hover', handler);
    return () => ipcRenderer.removeListener('native-browser-teach-hover', handler);
  },
  onTeachFill: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on('native-browser-teach-fill', handler);
    return () => ipcRenderer.removeListener('native-browser-teach-fill', handler);
  },
  onTeachKey: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on('native-browser-teach-key', handler);
    return () => ipcRenderer.removeListener('native-browser-teach-key', handler);
  },
  onTeachScroll: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on('native-browser-teach-scroll', handler);
    return () => ipcRenderer.removeListener('native-browser-teach-scroll', handler);
  },
  onDesignHover: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on('native-browser-design-hover', handler);
    return () => ipcRenderer.removeListener('native-browser-design-hover', handler);
  },
  onDesignSelect: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on('native-browser-design-select', handler);
    return () => ipcRenderer.removeListener('native-browser-design-select', handler);
  },
  onDesignAction: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on('native-browser-design-action', handler);
    return () => ipcRenderer.removeListener('native-browser-design-action', handler);
  },
  onDesignChat: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on('native-browser-design-chat', handler);
    return () => ipcRenderer.removeListener('native-browser-design-chat', handler);
  },
});
