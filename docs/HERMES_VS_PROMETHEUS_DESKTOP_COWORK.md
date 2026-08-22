# Hermes vs Prometheus desktop co-work

## Executive conclusion

Hermes and Prometheus currently make different tradeoffs for host desktop input.

Hermes' `computer_use` stack is designed around a **no-foreground co-work contract**: target a specific app/window, deliver input to that target, leave the human's real cursor/focus/Space alone, and use an independent agent cursor only as a visual cue.

Prometheus' current host desktop lane is still primarily a **foreground/global-input lane**. On Windows it moves the real pointer and uses Win32/SendInput-style primitives; several operations explicitly focus the target window. On macOS the shipping TypeScript backend also calls global pointer/keyboard operations. That means a human using the same desktop at the same time can interfere with Prometheus, and Prometheus can interfere with the human.

Prometheus does already have two important building blocks for a Hermes-style lane:

1. Windows has UI Automation and an occlusion-safe Windows.Graphics.Capture helper.
2. The macOS Swift helper already contains pid-scoped event posting for click/scroll/drag (`CGEvent.postToPid`) and explicitly describes that path as the Hermes/cua-driver background model; the TypeScript backend simply does not route normal host actions through it yet, and keyboard delivery is still global.

## Windows today

`Win32Backend` routes ordinary host control through the existing desktop primitives:

- `movePointer` -> `desktopMovePointer`
- `click` -> `desktopPerformClickAtCurrent`
- `drag` -> `desktopPerformDragInternal`
- `typeText` -> `typeTextInternal`
- `pressKey` -> `pressSendKeysSpecInternal`
- `focusWindow` -> `focusWindowHandle`

The backend's own status comment describes the native lane as `WGC capture + SendInput focus/input`.

This is good for compatibility but it is not safe parallel co-work. A foreground click or type can race with the user's mouse/keyboard and can change which app receives input.

### Recommended Windows co-work lane

Add an explicit host-input delivery mode:

- `background` — default when Prometheus has a strong HWND/PID/window token.
- `foreground` — compatibility fallback, visibly indicated and separately approved when it will interrupt the user.

Background dispatch should prefer semantic UIA actions over pixels:

1. UIA `InvokePattern`, `SelectionItemPattern`, `TogglePattern`, `ValuePattern`, etc.
2. HWND-scoped `PostMessage`/window-message delivery where the target supports it.
3. Only fall back to global `SendInput` after a structured background attempt reports a suspected no-op/unsupported target.

The real cursor should never be moved in background mode. The Watch Prometheus overlay cursor should represent the agent's target independently.

## macOS today

`DarwinBackend` talks to the Swift `prometheus-desktop-helper` and currently sends ordinary pointer/keyboard calls without a target pid. `movePointer` therefore warps the real cursor; clicks/scroll/drag are delivered globally; typing and named keys are posted to the global HID event tap; and `focusWindow` explicitly focuses the target.

However, `Input.swift` already has an alternate pid-scoped path:

- `postEvent(event, pid:)` uses `CGEvent.postToPid` when a pid is supplied.
- click can carry target coordinates and pid without raising the app.
- scroll can carry a pid.
- drag avoids `CGWarpMouseCursorPosition` when pid is present.

The missing integration is mostly above that capability: normal `DarwinBackend` calls do not pass target pid/coordinates, and `typeText` / `pressKey` still always use the global HID tap.

### Recommended macOS co-work lane

1. Extend desktop action requests to carry the exact target window token + pid.
2. Route exact-window click/scroll/drag to the existing pid-scoped Swift path.
3. Extend `typeText` and `pressKey` to accept pid and post keyboard events to the target process where macOS permits it.
4. Prefer AX semantic actions/value setting for controls when available.
5. Never call `CGWarpMouseCursorPosition` in background mode.
6. Fall back to an explicit foreground lane only when the target cannot accept background input.

## Four concepts Prometheus should keep separate

### 1. Browser automation

The in-app browser/CDP lane is already naturally parallel with the user's desktop. It does not need to commandeer the host OS cursor to click DOM elements. Watch Prometheus should display an agent cursor over the browser frame.

### 2. Host background/co-work desktop control

This is the Hermes-like mode. Prometheus targets an app/window while the human continues using another app on the same logged-in desktop.

### 3. Host foreground/exclusive desktop control

Compatibility mode for apps that reject semantic/background delivery. This is the mode that should show the prominent native `Prometheus is using the Desktop` indicator because it can move/focus/type on the user's foreground desktop.

### 4. `desktop_background` sandbox

This is already a different Prometheus concept: isolated/background execution. It should not be conflated with background input delivery to an ordinary host app.

## Product behavior

The desktop tool contract should expose/record `delivery_mode` (`background` or `foreground`) separately from `desktopMode` (`host` or `sandbox`).

Recommended default:

- Exact browser target -> browser automation.
- Exact host app/window target -> background co-work first.
- Background unsupported/no-op -> request/perform foreground fallback according to policy.
- Separate VM/sandbox -> sandbox lane.

The UI can then communicate the real impact:

- `Prometheus is working in Chrome` — background co-work, non-disruptive.
- `Prometheus needs foreground control` — compatibility fallback that can interrupt the user's mouse/focus.
- `Prometheus is using the Desktop` — active foreground control.

This is also the right boundary for the Watch Prometheus live viewer: its software cursor represents agent intent regardless of whether the physical cursor moves.

## Compatibility caveat

Background computer control is not universally reliable. Native apps, games, secure fields, elevated/UAC surfaces, custom renderers, and some Electron/Chromium interactions may reject semantic or process-targeted input. Prometheus should therefore keep the foreground lane as an explicit fallback instead of pretending every app can be driven invisibly.

Hermes itself documents background as the default but also exposes a foreground delivery mode. Recent upstream bug reports show that implementations can still accidentally steal focus, so Prometheus should add OS-level before/after focus assertions to regression/e2e tests for its future co-work lane.
