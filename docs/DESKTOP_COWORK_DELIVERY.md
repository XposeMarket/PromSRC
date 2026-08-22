# Desktop co-work delivery

Prometheus host desktop automation has an explicit delivery policy separate from the existing sandbox/background worker feature.

## Concepts

There are two independent axes:

- `desktopMode=host|sandbox` answers **where** the work runs.
- `delivery_mode=background|foreground` answers **how host input is delivered**.

They must not be conflated. `desktop_background` remains the sandbox/VM lane; host background co-work still targets a real application on the user's normal desktop.

## Background delivery (default)

Background delivery is the Hermes-style same-PC co-work lane. Prometheus targets a specific HWND/PID and must not move the human's real pointer or raise/steal focus from the user's active application.

The common policy lives in `src/gateway/desktop-cowork-delivery.ts`:

1. background is the default for host input actions;
2. a positive exact HWND or PID is required before background delivery is attempted;
3. a background transport returning without error is **not** considered success — the action must be positively verified;
4. only `unsupported` or verified-no-op outcomes are eligible for automatic foreground fallback;
5. arbitrary exceptions are not silently retried through the disruptive foreground lane;
6. result metadata tells the caller whether the real cursor/focus may have been disturbed.

The model-facing `desktop_window` and `desktop_input` schemas expose `delivery_mode=background|foreground` and `allow_foreground_fallback`. Normalization defaults host input to background and prevents the previous pointer fast-path from disabling verification for background actions.

## Foreground delivery

Foreground delivery is the compatibility lane. It may use the real cursor, global keyboard injection, and foreground window activation. This is the lane that should light the native `Prometheus is using the Desktop` indicator once the foreground lifecycle bridge is connected.

## macOS implementation

The native Swift helper uses pid-targeted `CGEvent.postToPid` for background delivery. This PR exposes targeted primitives from `DarwinBackend` for:

- click at explicit coordinates;
- scroll;
- drag;
- text input;
- key presses.

When a pid is supplied, pointer actions do not warp the real mouse cursor and keyboard events are posted directly to the target pid instead of the global HID event tap. The old methods remain as the explicit foreground compatibility lane.

## Windows implementation

Windows already has UI Automation semantic actions in the desktop stack. Those remain the preferred no-focus path for controls supporting `Invoke`, `Value`, `Toggle`, `SelectionItem`, and related patterns.

This PR additionally adds `src/gateway/desktop-cowork-win32.ts` for coordinate/text/key compatibility delivery to one exact HWND without using `SetCursorPos` or `SendInput`. It:

- validates that the HWND still exists;
- optionally verifies that the HWND still belongs to the expected PID before every action;
- converts screen coordinates to client coordinates for window mouse messages;
- posts click/drag/scroll messages to the target HWND;
- posts `WM_CHAR` text and supported key messages to the target HWND;
- rejects Alt/Cmd-style chords and unsupported key mappings so they can use the explicit foreground compatibility path instead of pretending background delivery succeeded.

`Win32Backend` now exposes these as targeted co-work primitives while preserving all existing real-cursor/SendInput methods as foreground primitives.

Target-window message delivery is inherently application-dependent. Electron/custom-rendered apps may ignore it. Therefore transport success alone is never sufficient: the caller must verify the target changed before accepting background delivery.

## Safety rules

- Never background-target an ambiguous title-only selector.
- Reject zero/negative/stale HWND/PID identities.
- When both HWND and PID are available on Windows, verify ownership before posting input.
- Never send one action to multiple matching processes.
- Never fall back to foreground after an arbitrary error; only unsupported/background-no-op outcomes may escalate automatically.
- Preserve exact target identity across observe/action/verify.
- Do not report `background` delivery if the implementation moved the system cursor or changed foreground focus.
- Sandbox execution remains isolated and does not imply host background delivery.

## Validation

PR CI directly runs:

- `desktop-cowork-delivery.regression.ts` for strict target/verification/fallback semantics;
- `desktop-cowork-wrapper.regression.ts` for model-facing default delivery, verification preservation, and sandbox separation;
- the normal backend TypeScript type-check and repository PR regression suite.

Real Windows/macOS device validation is still required before marking the PR ready because Linux CI can validate contracts and compilation but cannot prove native OS behavior.

## Remaining integration before ready-for-review

The public wrapper contract and both OS targeted transports now exist. The remaining production seam is the granular host-action execution layer: `desktop_window` / `desktop_input` actions must route their normalized delivery request through the targeted primitive, run the existing exact-window verification, attach delivery metadata, and invoke the old foreground implementation only through the common fallback policy. Until that execution seam and real-device verification are complete, this PR should remain draft.
