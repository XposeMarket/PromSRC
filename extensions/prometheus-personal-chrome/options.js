const secret = document.querySelector('#secret');
const status = document.querySelector('#status');
const existing = await chrome.storage.local.get('pairingSecret');
secret.value = existing.pairingSecret || '';
document.querySelector('#save').addEventListener('click', async () => {
  await chrome.storage.local.set({ pairingSecret: secret.value.trim() });
  chrome.runtime.sendMessage({ kind: 'reconnect' });
  status.textContent = 'Saved. The extension will reconnect to local Prometheus.';
});
