# Computer-use live view / Watch Prometheus

Status: implementation design + shared lifecycle foundation for a follow-up UI/transport PR.

## Goal

Let a user supervise Prometheus while it is *actually* using a browser or computer, from desktop web or the mobile PWA, without turning tool availability into a false "computer is active" signal.

The intended experience is:

- A small **Watch Prometheus** pill appears at the bottom of the active tool stream only after the first real browser/desktop tool call starts.
- The pill stays present while relevant work is active, with a short anti-flicker grace period between sequential calls, and disappears after the browser/desktop work/turn settles.
- Opening it shows an in-app floating live view that can expand and collapse back to a PiP-style mini viewer.
- If both browser and desktop frames exist, the viewer offers **Browser / Desktop** source switching.
- The browser and desktop previews draw a software cursor at Prometheus' last pointer interaction and leave it there until the next pointer interaction.
- Host desktop control can additionally show a native always-on-top **Prometheus is using the Desktop** banner. Sandboxed/background desktop automation must never light that host-control banner.
- The desktop web Sources surface may restore **Computer Use** as a viewer entry once it is backed by this shared live-view state instead of a dead/static panel.

## Existing Prometheus primitives we should reuse

This does not require inventing a second computer-use stack.

### Browser

`src/gateway/browser-tools.ts` already owns the in-house Electron browser, Prometheus-owned Playwright/CDP browser, user-Chrome lane, browser screenshots, and `browserPreviewScreenshot`.

`src/gateway/chat/chat-helpers.ts` already imports the browser screenshot/preview helpers and keeps the last browser vision screenshot with dimensions/viewport scaling metadata.

That makes browser-only viewing the easiest/lowest-exposure source: capture the active browser surface, not the entire desktop.

### Desktop

`src/gateway/desktop-tools.ts` already produces screenshots and screenshot packets with image data, dimensions, capture region, active window, open windows, and monitor metadata. The current Windows persistent helper should remain the preferred fast capture path.

`src/gateway/desktop-wrappers.ts` already distinguishes normal host desktop wrappers from `desktop_background`, which is the isolated/background worker path. The viewer must preserve that distinction as `desktopMode: host | sandbox`.

### Tool lifecycle

`web-ui/src/tool-activity.js` already classifies `browser_*` and `desktop_*` operations and receives real tool-call/result activity. `src/gateway/chat/chat-helpers.ts` separately auto-activates tool categories before execution.

Therefore **tool-category activation is explicitly the wrong trigger**. Live-view activation must be sourced from actual tool execution (`call`), not intent matching/tool exposure.

### Remote/mobile auth

The mobile PWA already routes HTTP and WebSocket traffic to the selected paired gateway with target-scoped credentials in `web-ui/src/mobile/mobile-api.js`. New state/frame endpoints must use those existing authenticated paths rather than introducing public image URLs.

## External product research

### OpenAI / Codex / ChatGPT

OpenAI's May 2026 Codex/ChatGPT releases are direct product precedent for this architecture:

- Codex Remote in the ChatGPT mobile app can stay connected to work running on a host Mac and load live machine context including screenshots, terminal output, diffs, approvals, and test results.
- Codex Computer Use on Windows can see/click/type in Windows applications while a user continues the workflow from ChatGPT on iOS/Android or Codex on Mac; the Windows machine remains the host for files, shell, app server, and local context.
- The ChatGPT desktop built-in browser is explicitly a shared surface where the user can follow/inspect the page while ChatGPT works.
- OpenAI's older agent/computer-use design also uses screenshot-driven GUI interaction and suppresses screenshot capture during sensitive user takeover.

References:
- https://help.openai.com/en/articles/6825453-chatgpt-apps-on-ios-and-android
- https://help.openai.com/en/articles/11391654
- https://help.openai.com/en/articles/20001275/
- https://help.openai.com/en/articles/20001277-using-the-built-in-browser-in-the-chatgpt-desktop-app
- https://openai.com/index/computer-using-agent/

Public documentation confirms remote supervision and screenshot/live context, but it does **not** document every exact cursor/PiP visual treatment seen in product screenshots. We should borrow the interaction model, not claim undocumented UI behavior.

### Anthropic / Claude

Anthropic's official Computer Use tool is the relevant technical reference. It is a screenshot/mouse/keyboard client tool: the application captures the desktop, executes mouse/keyboard actions, and returns results in an agent loop. Anthropic recommends a dedicated VM/container for safer deployments and explicitly treats computer-use data as application-controlled.

References:
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference

I did not find official Claude Code documentation for the exact mobile PiP interface shown in the supplied screenshot. We should treat that screenshot as UX inspiration rather than an API/product contract.

### Hermes Agent

Hermes' current `computer_use` architecture is especially relevant to cursor rendering. Its background desktop control intentionally does not move the user's real cursor or steal keyboard focus. That means a remote viewer cannot rely on the OS cursor being visible where the agent acted; it needs its own cursor metadata/overlay.

References:
- https://hermes-agent.nousresearch.com/docs/user-guide/features/computer-use
- https://hermes-agent.nousresearch.com/docs/reference/tools-reference

## Architecture

### 1. Shared live-view state

One state registry should be authoritative for browser/desktop viewer lifecycle. The first foundation is `src/gateway/computer-use-view-state.ts` in this PR.

Proposed wire shape:

```ts
interface ComputerUseViewState {
  sessionId: string;
  active: boolean;
  preferredSource?: 'browser' | 'desktop';
  browser?: {
    active: boolean;
    frameSeq?: number;
    frameCapturedAt?: number;
    width?: number;
    height?: number;
    mimeType?: string;
    cursor?: { x: number; y: number; updatedAt: number };
  };
  desktop?: {
    active: boolean;
    desktopMode: 'host' | 'sandbox';
    hostControl: boolean;
    frameSeq?: number;
    frameCapturedAt?: number;
    width?: number;
    height?: number;
    mimeType?: string;
    cursor?: { x: number; y: number; updatedAt: number };
  };
}
```

The state registry must be session-scoped. A phone connected to gateway A must never receive gateway B's frame/state.

### 2. Activation semantics

**Show** on the first actual relevant tool call:

- browser: supported `browser_*` execution begins
- desktop: supported `desktop_*` execution begins

**Do not show** merely because:

- the user prompt matched browser/desktop intent
- a tool category was activated
- a model received browser/desktop tool definitions

**Hide** when:

- the final active browser/desktop call completes and the short UI grace timer expires, or
- the turn explicitly settles/cancels/errors, or
- the user switches/reset sessions and no matching work remains.

The UI should use about 750-1000 ms of grace after the last result so sequential click/snapshot/click chains do not make the pill flicker. The authoritative backend state can become inactive immediately; grace is presentation behavior.

### 3. Frame transport: start with event-driven frames, not video

Do not begin with an always-on 30/60 fps WebRTC screen stream. Prometheus' execution model is already screenshot/action/screenshot oriented.

First production transport should be:

1. backend captures a frame when a relevant action begins/finishes or when a visual tool already captured one;
2. state broadcasts a small WebSocket event containing source + sequence + metadata, not base64 image data;
3. only clients with the viewer open fetch the latest authenticated frame by session/source/sequence;
4. while a call is active, optionally refresh at a low adaptive rate (roughly 1-2 fps) when no action-created frame has arrived;
5. immediately burst a fresh frame after pointer/type/navigation actions;
6. stop capture polling when no viewer is subscribed.

Recommended initial encoding: WebP/JPEG around 70-80 quality with a bounded long edge (for example 1280px), preserving the existing full-resolution screenshot path separately for model reasoning when required.

This gives a convincing live view with far less bandwidth, CPU, and privacy exposure. A future WebRTC/video transport can replace the frame provider without changing the Watch Prometheus state/UI contract.

### 4. Cursor contract

The cursor shown to the user is **viewer metadata**, not a screen artifact.

Rules:

- Coordinate browser/desktop actions update the cursor immediately.
- DOM/ref-based browser clicks should update it after the browser layer resolves the target's bounding box/center.
- Drag actions end at the drag destination.
- Keyboard-only, scroll-only, wait, screenshot, and navigation actions leave the previous cursor untouched.
- Cursor remains visible at its last point until another pointer action or the viewed surface/session is reset.
- The frame renderer draws the cursor client-side so it works even for background automation where the real OS cursor never moved.

`computer-use-view-state.ts` establishes the coordinate/persistence part of that contract. Ref/element-center resolution belongs in the browser/desktop executors because only they know resolved bounds.

### 5. Browser vs Desktop source selection

Browser and desktop are separate privacy/scoping choices, not just different zoom levels.

- **Browser**: current browser tab/window only. Prefer this whenever the active work is browser-only.
- **Desktop / Host**: whole monitor/window capture from the real machine.
- **Desktop / Sandbox**: background/isolated worker. Label it clearly as Sandbox so the user never mistakes it for their visible host desktop.

If browser and desktop both have recent frames, the viewer exposes a two-option source switch. Default to the most recently active source; if only browser is active, do not unnecessarily capture the whole host desktop.

### 6. Mobile/web UI

#### Tool stream

Render a small `Watch Prometheus` pill after the current tool stream content. It should not become another permanent toolbar item.

Suggested states:

- `Watch Prometheus · Browser`
- `Watch Prometheus · Desktop`
- `Watch Prometheus · Sandbox`

Opening it expands a live-view sheet/card. Minimize returns to a small floating preview over chat. Closing the preview does not cancel Prometheus; it only unsubscribes from frames.

#### Desktop Sources panel

Restore `Computer Use` as a Sources-panel section only when the shared viewer has a valid current/recent surface. Reuse the same viewer component; do not implement a second frame stack inside Sources.

#### PiP terminology

For the mobile PWA, the first implementation should be an **in-app PiP-style floating view**, not depend on OS-native Picture-in-Picture. Arbitrary DOM/canvas PiP support is inconsistent across mobile browsers/iOS. If a later frame transport exposes a real video stream, standards-based video PiP can be added behind capability detection.

### 7. Host desktop control overlay

This should be a separate follow-up PR because it is OS/Electron lifecycle code, not web UI.

When a real host-control action is active, create a small native/Electron always-on-top, click-through banner on each relevant display:

> Prometheus is using the Desktop

Properties:

- host desktop only;
- never for `desktop_background` / sandbox mode;
- never merely because desktop tools were activated;
- read-only screenshot/inspection alone should not claim Prometheus is controlling the desktop;
- pointer/key/window/app-control calls turn it on;
- short anti-flicker grace across sequential host actions;
- guaranteed cleanup on turn settle, cancellation, renderer/gateway disconnect, and app exit;
- multi-monitor aware;
- should not steal focus or intercept clicks.

Before shipping, verify whether the Windows capture helper can exclude the indicator window from captures. If not, position it so the banner's presence in remote previews is acceptable and does not cover likely click targets.

### 8. Privacy and security

- All frame/state routes require the same paired-device authorization already used by mobile gateway traffic.
- Never publish stable/public frame URLs.
- Frames are memory-only by default; no history/persistence unless a separate user-visible feature requests it.
- Viewer is read-only. Remote steering/input remains behind the existing tool/approval model.
- Prefer browser-only capture whenever it is sufficient.
- Add a sensitive/takeover state that suppresses frame capture while the user enters credentials or other protected input.
- Do not include frame bytes in normal WebSocket JSON events/logging/telemetry.
- Distinguish `host` from `sandbox` in every state payload and UI label.

## PR decomposition

### PR A — live-view transport + UI

Wire this shared state into the real execution path and add:

- browser/desktop begin/result/settle hooks;
- authenticated state/latest-frame endpoints;
- frame sequence WebSocket events;
- browser/desktop capture providers using existing screenshot helpers;
- browser resolved-element cursor coordinates;
- persistent client cursor renderer;
- Watch Prometheus pill on desktop + mobile tool streams;
- expandable/floating viewer;
- Browser/Desktop source switch;
- restored Sources > Computer Use entry;
- source/generated web parity and mobile service-worker revision;
- regression coverage for activation-not-toolset, cursor persistence, auth, source isolation, and hide-on-settle.

### PR B — native host-control indicator

Add the Windows/Electron always-on-top indicator and lifecycle bridge, with explicit host-vs-sandbox tests and crash cleanup. macOS can follow when Prometheus desktop computer-use is enabled there.

### Optional PR C — adaptive/video transport

Only after measuring frame transport on real devices. Consider WebRTC/video PiP if 1-2 fps + action bursts do not feel sufficiently live.

## Acceptance criteria

- Browser/desktop **tool activation alone never shows Watch Prometheus**.
- First actual browser/desktop tool call shows it during the same turn.
- Ordinary tools (files, shell, connectors, search) do not show it.
- Pill disappears after relevant work finishes, without flickering between sequential calls.
- Browser view can be watched without exposing the whole desktop.
- Desktop view supports host and sandbox labels.
- Last agent pointer location remains visible through typing/waits/screenshots until the next pointer action.
- If real host control is occurring, the native host banner is visible; sandbox activity never triggers it.
- Closing/minimizing the viewer does not interrupt the agent.
- Paired mobile devices can view only the active gateway/session they are authorized for.
- Sensitive takeover suppresses capture.

## Foundation included in this PR

`src/gateway/computer-use-view-state.ts` adds a side-effect-free classifier/tracker so the eventual transport and UI have one lifecycle contract. It intentionally is not wired to production execution in this draft: no live frame capture or UI behavior changes yet.

`src/gateway/computer-use-view-state.regression.ts` locks the key semantics:

- ordinary tools do not activate live view;
- actual browser/desktop calls do;
- sandbox desktop never counts as host control;
- screenshots are viewing, not host control;
- cursor stays at its last pointer position across keyboard-only actions;
- overlapping calls keep viewer state active until the final relevant call completes;
- turn settle clears active state.
