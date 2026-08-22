# Watch Prometheus — computer-use live view

## Goal

Provide one shared live viewer for real Prometheus browser/desktop work across desktop web and the mobile PWA.

The viewer is triggered by **actual computer-use activity**, not by tool-category activation. Merely making browser/desktop tools available must never show `Watch Prometheus`.

## Product contract

### Watch Prometheus pill

- Appears only after a visible browser/desktop operation actually begins.
- Remains available while the owning turn is still working, with a small settle grace to prevent click/screenshot chains from flickering.
- Disappears after the turn settles.
- Tapping opens the shared floating viewer.

### Viewer

- Browser and Desktop are separate sources.
- Browser is preferred when only browser automation has been used.
- Desktop becomes available after desktop computer use is observed.
- Desktop web restores a `Computer Use` entry to the Sources tab strip; it opens the same viewer rather than a second implementation.
- Mobile uses a floating in-app PiP-style viewer rather than relying on native video PiP APIs.
- The viewer is view-only. It does not become another remote-control surface.

### Cursor

The viewer owns an **agent cursor** rather than trusting the physical OS pointer. The cursor remains at its last known agent interaction coordinate until another pointer action occurs. This is required for background/co-work input where the real cursor may not move at all.

## Transport

The current implementation uses an authenticated frame endpoint on the gateway:

`GET /api/computer-use/frame/:sessionId?source=browser|desktop`

This route is mounted behind the gateway's existing authentication + account-access middleware. Mobile requests use the active gateway origin and target-scoped pairing token.

- Browser frames use the existing browser vision screenshot path.
- Desktop frames use the existing desktop screenshot/advisor packet path with OCR disabled for viewer refreshes.
- Responses are explicitly `no-store`.
- The UI polls only while the viewer is open (roughly action/live-view cadence rather than a permanent video stream).

This intentionally starts with the simplest transport that matches Prometheus' existing screenshot/action/screenshot architecture. WebRTC/video should only be added after measurement shows the authenticated frame transport is insufficient.

## State contract

`src/gateway/computer-use-view-state.ts` owns the platform-neutral classification model:

- browser vs desktop
- host vs sandbox desktop
- host-control vs read-only/view activity
- pointer action extraction
- persistent cursor state
- overlapping relevant call lifecycle

This is intentionally separate from whether a tool category is activated.

## Desktop co-work boundary

`desktopMode` and input delivery mode are different concepts:

- `desktopMode=host` — action targets the user's normal logged-in desktop.
- `desktopMode=sandbox` — isolated/background execution such as `desktop_background`.
- future `delivery_mode=background` — Hermes-like host co-work: exact app/window is driven without moving the real cursor or stealing focus.
- future `delivery_mode=foreground` — compatibility fallback that can visibly take focus and should trigger the prominent native desktop-control indicator.

See `docs/HERMES_VS_PROMETHEUS_DESKTOP_COWORK.md` for the Windows/macOS investigation.

## Security / privacy

- Viewer routes inherit gateway auth and account-access requirements.
- Pairing credentials remain target-scoped on mobile.
- No unauthenticated image URL is created.
- Frames are `no-store` and are not persisted as a second mobile history/context store.
- The viewer is observation-only.
- A future sensitive-surface policy can suppress/redact frames for password/secure-input/UAC/OS-auth surfaces without changing the UI contract.

## Current implementation status

Implemented in this branch:

- browser/desktop state contract and regressions
- real Watch Prometheus pill lifecycle from actual rendered computer-use operations
- shared desktop/mobile floating viewer
- Browser/Desktop source switching
- desktop agent-cursor persistence from known pointer coordinates
- authenticated browser/desktop frame route
- target-aware mobile gateway authentication
- desktop Sources -> Computer Use entry, reusing the same viewer
- source/generated UI parity
- static contract regression for the production wiring

Still separate follow-up work:

1. Improve browser cursor coordinates for semantic ref clicks by emitting the resolved DOM bounding-box point as structured activity metadata rather than inferring from presentation text.
2. Add the Hermes-like background/co-work host-input lane on Windows/macOS.
3. Add a native foreground-control banner only for the disruptive foreground lane.
4. Add sensitive-frame suppression/redaction rules.
5. Device/e2e latency measurement; switch to WebRTC only if needed.
