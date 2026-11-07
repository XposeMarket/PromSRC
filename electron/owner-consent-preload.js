'use strict';
// Preload for the native owner-approval window only (PR821 I1). Two calls, no data out.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('promOwnerConsent', {
  submit: (code) => ipcRenderer.invoke('owner-consent:submit', String(code || '').slice(0, 12)),
  cancel: () => ipcRenderer.invoke('owner-consent:cancel'),
});
