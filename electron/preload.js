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
  installUpdate: () => {
    ipcRenderer.send('install-update');
  },
});

// ─── App Metadata ───────────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('prometheusApp', {
  getVersion: () => ipcRenderer.invoke('get-app-version'),
});
