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

const { contextBridge, ipcRenderer } = require('electron');

// ─── Auto-Updater Bridge ────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('prometheusUpdater', {
  /** Returns the current updater state. */
  getState: () => ipcRenderer.invoke('updater:get-state'),
  /** Force a web update check now. */
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
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
  /** Quit and install the downloaded update. */
  installUpdate: () => ipcRenderer.invoke('updater:install'),
});

// ─── App Metadata ───────────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('prometheusApp', {
  getVersion: () => ipcRenderer.invoke('get-app-version'),
});

// ─── Local File Selection Bridge ────────────────────────────────────────────
contextBridge.exposeInMainWorld('prometheusFiles', {
  selectCanvasFiles: () => ipcRenderer.invoke('select-canvas-paths', { mode: 'files' }),
  selectCanvasFolder: () => ipcRenderer.invoke('select-canvas-paths', { mode: 'folder' }),
});

// ─── Native In-App Browser Bridge ───────────────────────────────────────────
contextBridge.exposeInMainWorld('prometheusBrowserSurface', {
  available: () => ipcRenderer.invoke('native-browser:available'),
  attach: (options = {}) => ipcRenderer.invoke('native-browser:attach', options),
  detach: () => ipcRenderer.invoke('native-browser:detach'),
  setBounds: (bounds = {}) => ipcRenderer.invoke('native-browser:set-bounds', bounds),
  navigate: (payload = {}) => ipcRenderer.invoke('native-browser:navigate', payload),
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
});
