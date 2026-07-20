# Prometheus Personal Chrome extension

Load this folder with **Chrome → Extensions → Developer mode → Load unpacked**.
Then open **Extension options**, paste the local pairing code from Prometheus's
`user-chrome-extension-pairing.json`, and grant the Chrome debugger prompt.

The extension can only connect to `ws://127.0.0.1:9234/prometheus-user-chrome`.
It does not start Chrome, read profile files, decrypt cookies, or expose a CDP
port. Chrome's normal debugger warning and any DevTools attach/detach behavior
still apply. Enable "Allow in incognito" manually if that is intended.
