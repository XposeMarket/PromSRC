# Desktop co-work delivery

Prometheus host desktop automation now has an explicit delivery policy separate from the existing sandbox/background worker feature.

## Concepts

There are two independent axes:

- `desktopMode=host|sandbox` answers **where** the work runs.
- `delivery_mode=background|foreground` answers **how host input is delivered**.

They must not be conflated.

### Background delivery (default)

Background delivery is the Hermes-style same-PC co-work lane. Prometheus targets a specific HWND/PID and should not move the human's real pointer or raise/steal focus from the user's active application.

The common policy lives in `src/gateway/desktop-cowork-delivery.ts`:

1. background is the default;
2. an exact HWND or PID is required before background delivery is attempted;
3. the background action must be verified;
4. only `unsupported` or verified-no-op outcomes are eligible for automatic foreground fallback;
5. arbitrary exceptions are not silently retried through the disruptive foreground lane;
6. result metadata tells the caller whether the real cursor/focus may have been disturbed.

### Foreground delivery

Foreground delivery is the compatibility lane. It may use the real cursor, global keyboard injection, and foreground window activation. This is the lane that should eventually light the native `Prometheus is using the Desktop` indicator from the Watch Prometheus work.

## macOS implementation

The native Swift helper already had pid-targeted `CGEvent.postToPid` support for click, scroll, and drag. This PR completes the keyboard side and exposes targeted primitives from `DarwinBackend`:

- `clickTargeted(pid, x, y, ...)`
- `scrollTargeted(pid, ...)`
- `dragTargeted(pid, ...)`
- `typeTextTargeted(pid, text)`
- `pressKeyTargeted(pid, key)`

When a pid is supplied, pointer actions do not warp the real mouse cursor. Keyboard events are also posted directly to the target pid rather than the global HID event tap.

The old methods remain unchanged as the foreground compatibility lane.

## Windows implementation direction

Windows still needs the platform-specific executor wiring. The intended order is:

1. resolve a strong target identity (HWND + PID + process start time when available);
2. prefer UI Automation semantic patterns (`Invoke`, `Value`, `Toggle`, `SelectionItem`, etc.);
3. for coordinate-only actions, use target-window/background mechanisms that do not move the real pointer when the application supports them;
4. verify the target changed;
5. only then escalate to the existing foreground `SendInput`/focus path.

The shared policy in this PR prevents Windows and macOS from inventing incompatible fallback semantics.

## Safety rules

- Never background-target an ambiguous title-only selector.
- Never send one action to multiple matching processes.
- Never fall back to foreground after an arbitrary error; only unsupported/background-no-op outcomes may escalate automatically.
- Preserve the exact target identity across observe/action/verify.
- Do not report `background` delivery if the implementation moved the system cursor or changed foreground focus.
- Sandbox execution remains isolated and does not imply host background delivery.

## Remaining wiring

This PR intentionally establishes the common policy and macOS native path first. Follow-up work in the granular desktop handlers/wrappers must thread `delivery_mode`, the resolved target identity, and delivery metadata through the public `desktop_window` / `desktop_input` workflow. Windows UIA/background execution also needs to be connected to the common policy before the feature should leave draft.
