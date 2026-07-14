# Prometheus Desktop Automation Architecture

Prometheus exposes six model-facing wrappers:

- `desktop_screen`
- `desktop_apps`
- `desktop_window`
- `desktop_input`
- `desktop_macro`
- `desktop_background`

The granular `desktop_*` functions remain registered as compatibility/internal
handlers. The main gateway and Reactor both present the same six wrappers; run
`npm run test:desktop` to detect surface or dispatch drift.

## Host window workflow

1. `desktop_apps({ action: "list_windows" })`
2. Choose the returned `window_token` (preferred) or compatibility `window_id`.
3. `desktop_window({ action: "state", window_token })`
4. Act with `desktop_window` and the same token.

`window_id` is still `win_<HWND>`. `window_token` also binds PID and process
creation time, so Prometheus rejects an HWND that Windows has recycled for a
different process/window.

Window-state failures use a typed JSON envelope after the legacy `ERROR:`
prefix. Important codes are `WINDOW_NOT_FOUND`, `STALE_WINDOW`, `FOCUS_FAILED`,
`STATE_STALE`, `ACTION_UNSUPPORTED`, `CAPTURE_FAILED`, and
`DESKTOP_CANCELLED`.

## Capture backend

`resolveDesktopCaptureBackend()` selects the per-window capture path:

- `graphics_capture` — persistent native helper using
  `Windows.Graphics.Capture`; captures occluded windows without focusing them.
- `window_crop` / `copy_from_screen` — compatibility fallback; captures visible
  desktop pixels and may include covering windows.

Build/rebuild the helper with `npm run build:desktop-helper:win`. It is discovered in
`bin/`, an Electron resources directory, or through
`PROMETHEUS_DESKTOP_WINDOWS_HELPER_PATH`. If helper capture fails at runtime,
Prometheus reports the fallback and uses the visible crop path.

The source and build instructions live in `native/desktop-helper-windows/`.
Public Electron packaging stages the binary into `resources/` when it exists.

## Structured UI Automation

`desktop_window({ action: "accessibility_state", window_token })` returns a
flat node list with a point-in-time `state_id`, snapshot-scoped `element_id`,
roles, names, automation IDs, bounds, and supported UIA patterns.

Semantic actions include `invoke`, `set_value`, `select`, `toggle`, `expand`,
`collapse`, `focus_element`, and `secondary_action`. An action invalidates the
state so callers re-observe instead of reusing stale element identities.

## Interruption

Interactive runtime abort signals flow into desktop waits, change/pixel polling,
macro replay, native capture, structured UIA calls, window-scoped input, and
background bridge polling. An interrupted operation returns
`DESKTOP_CANCELLED`; background commands that have not been claimed are removed
from the inbox best-effort.

## Background desktop target

Host input shares the user's active Windows input desktop. Non-interrupting
native automation therefore uses an isolated Windows Sandbox/VM worker through
the file bridge.

Supported worker commands:

- `screenshot`
- `list_windows`
- `get_window_state`
- `accessibility_tree`
- `click` / `window_click`
- `type` / `window_type`
- `key` / `window_key`
- `run`
- `wait`

Example:

```text
desktop_background({ action: "prepare_sandbox", launch: true })
desktop_background({ action: "command", command_action: "list_windows" })
desktop_background({ action: "command", command_action: "get_window_state", window_id: "..." })
desktop_background({ action: "command", command_action: "window_type", window_id: "...", text: "Hello" })
```

Host and worker window IDs, screenshots, coordinates, focus, apps, and login
state are separate and must never be mixed.

## Remaining work

- Sign and reproduce the native helper in the release toolchain, then extend
  testing across mixed-DPI, minimized, occluded, and protected-content windows.
- Add a persistent Hyper-V/remote worker profile for saved applications/logins.
- Replace the file-polling bridge with an authenticated streaming transport if
  remote workers are introduced.
- Safety-policy enforcement changes are intentionally not part of this desktop
  runtime upgrade and should be designed/reviewed separately.
