# Migrated desktop-automation-playbook guidance

This reference preserves detailed guidance from the former `desktop-automation-playbook` entrypoint. Read it only for the matching operation.

## Contents

- [Public wrapper surface](#public-wrapper-surface)
- [Core doctrine](#core-doctrine)
- [Wrapper workflows](#wrapper-workflows)
- [Recovery rules](#recovery-rules)
- [Focused resource loading](#keep-resource-loading-focused)
- [Bottom line](#bottom-line)

# Desktop Automation Playbook

Read this before native desktop automation. Prometheus exposes six model-facing
desktop wrappers. Granular names such as `desktop_screenshot` and
`desktop_window_click` are internal compatibility handlers; do not call them
directly from the main model surface.

## Public wrapper surface

- `desktop_screen` — diagnostics, screenshots, monitor geometry, visual waits,
  screenshot diffs, and pixel watches.
- `desktop_apps` — installed/running app discovery, window listing, launch,
  close, and process inspection.
- `desktop_window` — preferred wrapper for exact-window state, screenshots,
  accessibility/text, window control, and window-scoped input.
- `desktop_input` — global/capture/monitor input, focused typing and keys,
  clipboard operations, and fixed waits.
- `desktop_macro` — record, stop, replay, and list stable desktop macros.
- `desktop_background` — isolated Windows Sandbox/VM worker operations.

## Core doctrine

### Prefer the canonical window path

For work inside one app:

1. Discover the target:

   ```text
   desktop_apps({ action: "list_windows" })
   ```

   Use `desktop_apps({ action:"list_apps" })` when installed/running app
   identity or launch information also matters.

2. Choose the exact window and observe it:

   ```text
   desktop_window({
     action: "state",
     window_token,
     include_screenshot: true,
     include_text: false
   })
   ```

   `list_windows` returns both a compatibility `window_id` and a stronger
   `window_token`. Prefer the token for state and actions: it binds HWND, PID,
   and process creation time so a recycled HWND is rejected as `STALE_WINDOW`.
   Set `include_text:true` only when a legacy text tree is needed.

3. Act through the same exact window:

   ```text
   desktop_window({ action:"click", window_token, x, y })
   desktop_window({ action:"type", window_token, text })
   desktop_window({ action:"key", window_token, key:"Return" })
   desktop_window({ action:"scroll", window_token, direction:"down", amount:3 })
   desktop_window({ action:"drag", window_token, from_x, from_y, to_x, to_y })
   ```

4. Re-observe when the result is ambiguous, the UI changed substantially, or
   the next action depends on fresh geometry.

The Windows runtime keeps the exact window, capture backend, DPI context, and
SendInput path in one persistent native helper. Do not repeatedly refocus or
rediscover the same unchanged window between related actions. Batch the short
sequence against the same token, then verify once.

An exact token prevents acting on a recycled window handle, but host input still
uses the active Windows input desktop. A user focus change can invalidate
assumptions; stop and re-ground after focus or stale-state errors.

### Observe → anchor → act → verify

- Use one exact window when possible.
- Use full desktop/monitor capture only when popups, multiple windows, or
  cross-monitor context matter.
- Choose points from the freshest relevant screenshot.
- Carry its `screenshot_id` when using capture-space coordinates.
- Treat state, accessibility indexes, and screenshot anchors as point-in-time
  observations.
- Prefer deterministic change waits over blind sleep loops.

### See small UI with native region recapture

Use a coarse-to-fine visual loop instead of trusting a scaled whole-screen
preview for tiny controls:

1. Capture the whole app window once for orientation.
2. If labels are unreadable, controls are dense, an icon/loading indicator is
   small, or the screenshot reports normalization/downscaling, recapture only
   the relevant panel from the native source:

   ```text
   desktop_window({
     action:"region_screenshot",
     window_token,
     region:[x1, y1, x2, y2]
   })
   ```

   These coordinates are logical pixels relative to the target window. The
   region is cropped from the native window capture before image normalization,
   so a PowerPoint ribbon, ChatGPT sidebar, tab strip, or settings panel retains
   much more real detail.

3. For a region spanning windows or monitors, use virtual-desktop coordinates:

   ```text
   desktop_screen({ action:"region_screenshot", region:[x1,y1,x2,y2] })
   ```

4. If needed, repeat with a tighter region. Do not upscale an already
   downscaled image and treat generated/interpolated pixels as visual evidence.
5. Click from the freshest crop using its `screenshot_id` and
   `coordinate_space:"capture"`. Recapture after layout changes.

When the target is identified by visible text but UI Automation exposes only
the app shell (common in Electron/custom-rendered interfaces), use the crop's
grounded text locator instead of estimating a row center:

```text
desktop_window({
  action:"locate_text",
  screenshot_id,
  query:"Hardening chat artifact extraction"
})
```

To locate and click atomically with low-confidence and ambiguous matches
rejected:

```text
desktop_window({
  action:"click_text",
  screenshot_id,
  query:"Hardening chat artifact extraction",
  min_confidence:0.72
})
```

`click_text` uses persistent OCR, clicks through the exact crop anchor, and
returns a fresh full-window image. Confirm the destination identity in that
post-action image before reporting completion. If it returns
`VISUAL_TARGET_NOT_FOUND` or `VISUAL_TARGET_AMBIGUOUS`, tighten or scroll the
crop; never substitute a neighboring coordinate.

Never pass screenshot pixel coordinates as `coordinate_space:"window"`.
Window space is only for independently known logical coordinates relative to
the live window top-left. When a `screenshot_id` is present and the coordinate
space is omitted, the wrapper defaults to capture space, but state it explicitly
in desktop workflows for clarity.

An unchanged visual verification is not permission to click nearby pixels.
Re-observe, tighten the native region, or use a semantic accessibility action;
do not retry at guessed offsets in dense toolbars, sidebars, or tab strips.

Screenshots are vision-first and skip OCR on the model-facing wrappers. Use
`text` or accessibility for structured reading. Do not request SOM when accessibility exposes only top-level window
chrome—recapture the actual sidebar, ribbon, or panel without SOM instead.

For navigation such as opening a chat, document, or settings page, a successful
mouse injection or generic pixel change does not prove the requested target
opened. Verify the exact requested identity in the resulting header or content.
If strict verification returns `ACTION_NOT_CONFIRMED`, or the post-action title
does not match, report failure and re-ground. Never state that it opened anyway.

Keep a simple visible-target workflow bounded: one whole-window orientation,
one focused native region capture, one click, and one post-action verification.
Do not insert accessibility, text extraction, keyboard shortcuts, search,
scrolling, or another whole-window capture unless the focused region proves the
target is not visible. If the user says the target is visibly present, do not
replace the requested visible click with Ctrl+K, Ctrl+P, search, or scrolling.
After one failed click, take at most one tighter recapture; then report the
specific blocker instead of entering an open-ended desktop loop.

When sending completion proof, capture the full exact window after the action.
Do not send the narrow targeting crop as proof that a chat, document, page, or
panel opened; the delivery layer will replace narrow completion-proof crops
with a fresh full-window capture when it can identify the target window.

Prefer semantic UI Automation when it exposes the control reliably; focused
native crops are the visual fallback and verification surface.

### Pick the right surface

- Normal website in Chrome/Edge: use browser wrappers.
- Native app, native modal, or OS UI: use desktop wrappers.
- Shell/build/git/script work: use workspace/terminal tools.
- Non-interrupting native automation: use `desktop_background`, not host input.

## Wrapper workflows

### Screen and monitor orientation

```text
desktop_screen({ action:"doctor" })
desktop_screen({ action:"monitors" })
desktop_screen({ action:"screenshot", capture:"all" })
desktop_screen({ action:"window_screenshot", name:"Calculator", focus_first:false })
```

When the state response reports `capture_backend:"graphics_capture"`, native
Windows.Graphics.Capture can inspect a covered window without stealing focus.
When it reports `copy_from_screen` or `window_crop`, a covered window crop may
contain the covering pixels; visually expose/focus it before trusting the image.
The runtime automatically falls back if the native helper is absent or fails.

For multi-monitor points selected from a screenshot:

```text
desktop_input({
  action:"click",
  coordinate_space:"capture",
  screenshot_id,
  x,
  y
})
```

Use `coordinate_space:"monitor"` plus `monitor_index` only for known monitor-
relative coordinates. Use raw virtual coordinates only when already verified.

### Accessibility and text

For machine-readable controls, use a fresh structured state and act through its
snapshot-scoped IDs:

```text
desktop_window({ action:"accessibility_state", window_token })
desktop_window({ action:"invoke", state_id, element_id })
desktop_window({ action:"set_value", state_id, element_id, value:"Hello" })
desktop_window({ action:"select", state_id, element_id })
desktop_window({ action:"toggle", state_id, element_id })
desktop_window({ action:"expand", state_id, element_id })
desktop_window({ action:"collapse", state_id, element_id })
desktop_window({ action:"focus_element", state_id, element_id })
desktop_window({ action:"secondary_action", state_id, element_id })
```

Each accessibility action consumes/invalidates its state; recapture before the
next semantic action. Use `accessibility_tree` or `text` for compact human-
readable inspection. If UIA is incomplete, use a fresh screenshot/SOM view and
keyboard navigation.

### Native window control

```text
desktop_window({ action:"control", window_token, control_action:"maximize" })
desktop_window({ action:"control", window_token, control_action:"restore" })
desktop_window({ action:"control", window_token, control_action:"minimize" })
```

Prefer native window control over clicking title-bar chrome.

### Global/focused input fallback

Use `desktop_input` only when work is intentionally global, is anchored to a
full-desktop screenshot, or the user explicitly relies on the current focus:

```text
desktop_input({ action:"type", text:"Hello" })
desktop_input({ action:"key", key:"Return" })
desktop_input({ action:"scroll", direction:"down", amount:3, x, y })
```

When the user explicitly says the correct composer is already active and asks
for a type-only path, do only the requested typing/key sequence. Do not insert
clicks or focus changes between those calls.

### Deterministic waiting

```text
desktop_screen({ action:"wait_for_change", timeout_ms:10000 })
desktop_screen({ action:"pixel_watch", x, y, timeout_ms:10000 })
desktop_screen({ action:"diff_screenshot" })
```

Use `desktop_input({ action:"wait", ms })` only when no observable signal is
available.

### Macros

```text
desktop_macro({ action:"record", name:"example" })
desktop_macro({ action:"stop" })
desktop_macro({ action:"list" })
desktop_macro({ action:"replay", name:"example", speed_multiplier:1 })
```

Macros are for stable repetitive flows. Re-ground after replay when results or
side effects matter.

### Background worker

```text
desktop_background({ action:"status" })
desktop_background({ action:"prepare_sandbox", launch:true })
desktop_background({ action:"command", command_action:"list_windows" })
desktop_background({ action:"command", command_action:"get_window_state", window_id:bg_window_id })
desktop_background({ action:"command", command_action:"accessibility_tree", window_id:bg_window_id })
desktop_background({ action:"command", command_action:"window_click", window_id:bg_window_id, x, y })
desktop_background({ action:"command", command_action:"window_type", window_id:bg_window_id, text })
```

The host and background worker are separate desktops. Never assume a host
`window_id`, token, coordinate, screenshot ID, focus, installed app, or login exists in
the sandbox worker.

## Recovery rules

- Stale screenshot/state: stop, capture fresh state, and recompute the target.
- `STALE_WINDOW`: list windows again and use the new `window_token`; never strip
  the token down to its HWND.
- `STATE_STALE`: recapture `accessibility_state`; element IDs are intentionally
  point-in-time references.
- `DESKTOP_CANCELLED`: the user/runtime interrupted the operation. Do not resume
  the input sequence automatically.
- Window missing: call `desktop_apps({action:"list_windows"})` again; do not
  reconstruct an HWND from memory.
- Focus failure: verify the window still exists and is not blocked by a modal.
- No accessibility data: use screenshot/SOM or keyboard fallback.
- Likely no-op/unchanged verification: do not repeat the same blind action;
  change observation or input strategy.
- Launch says no window appeared: wait briefly, list windows/processes, and
  verify before declaring failure.
- Background timeout: check `desktop_background({action:"status"})` and worker
  readiness instead of routing commands to the host unexpectedly.
- Desktop locked or unavailable: stop host input and report the condition.

## Keep resource loading focused

The bundled notes and examples contain historical recovery evidence. Read only
the resource relevant to the current failure or workflow; routine desktop work
should not load the entire history bundle.

## Bottom line

Use the six wrappers. Prefer `desktop_apps` → `desktop_window(state)` →
`desktop_window(action)` for one app. Keep observations fresh, treat visible
capture and accessibility as complementary evidence, and use
`desktop_background` when host focus must remain untouched.
