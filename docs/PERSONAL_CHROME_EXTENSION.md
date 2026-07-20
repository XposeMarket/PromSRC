# Personal Chrome extension

`target="user_chrome"` controls the user's already-running Chrome through the
local **Prometheus Personal Chrome** Manifest V3 extension. It does not launch
Chrome with a remote debugging port, copy the profile, or decrypt session data.

1. Start Prometheus and select `user_chrome` (or run `browser_doctor`) once.
   This starts a relay bound to `127.0.0.1:9234` and creates
   `user-chrome-extension-pairing.json` in Prometheus's config directory.
2. In Chrome open `chrome://extensions`, enable Developer mode, select **Load
   unpacked**, and choose `extensions/prometheus-personal-chrome` from the
   Prometheus install. The packaged desktop app contains this folder too.
3. Open **Extension options**, paste the `secret` value from the pairing file,
   then grant the Chrome debugger permission when Chrome prompts.
4. Retry `browser_open` with `target="user_chrome"`. `browser_doctor` reports
   connected/disconnected extension state without probing port 9223.

Security boundaries:

- The relay only accepts WebSockets from loopback and requires a 256-bit pairing
  secret before it accepts extension messages or sends commands. Pairing uses
  fresh client/server nonces and domain-separated HMAC challenge/proof messages;
  the secret itself is never sent over the WebSocket.
- The extension has only `debugger`, tab/window, download, storage, and alarm
  permissions, with `http://127.0.0.1/*` host access solely for the relay.
- Main chat is the only owner allowed to select the shared personal-profile
  target; tasks and agents remain on isolated Prometheus profiles. Personal tab
  ids are locked to their browser session, so a second session cannot silently
  take over an already-controlled user tab.
- The MV3 worker reconnects after suspension. If DevTools or another debugger
  detaches it, retrying safely reattaches and doctor reports the failure.

Coverage includes navigation, DOM snapshots/refs, click/fill/type/key/scroll,
screenshots, supported page JavaScript evaluation, tab selection/creation/
closure, ordinary page CDP commands, console/response observation, and download
start/status inspection through Chrome's downloads API. Restricted/internal
Chrome pages, incognito (unless manually enabled in Extension details),
browser-wide CDP domains, download file copying/streaming, and programmatic
file-input upload are not equivalent to Playwright and return clear unsupported
results where applicable.
