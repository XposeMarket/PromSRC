# Desktop scroll stale-screenshot recovery (2026-05-19)

Observed during a Codex desktop scroll flow: after `desktop_scroll(..., capture_after:true)` returned a full-desktop screenshot, a follow-up `desktop_scroll` reused that returned screenshot id with `coordinate_space:"window"`. The tool rejected it as stale because desktop state had changed and instructed a fresh capture. Recovery worked by using a fresh/current screenshot id with `coordinate_space:"capture"` for screenshot-selected points, or by dropping the screenshot id for app-local `coordinate_space:"window"` scrolling.

Guardrail for future desktop scrolling:

- Treat every `capture_after` screenshot as a new visual anchor for **capture-space** actions only.
- Do not mix a full-desktop `desktop_screenshot` id with `coordinate_space:"window"`; either recapture the target window with `desktop_window_screenshot` and use that window/capture anchor, or use `coordinate_space:"window"` with `window_name`/`window_handle` and no stale screenshot id.
- If a stale screenshot error appears, stop the repeated action loop, recapture (`desktop_window_screenshot` for one app or `desktop_screenshot` for full desktop), then retry with the coordinate space that matches the new capture.
- Watch verification: repeated `likely_noop` scrolls mean the pointer may be over the wrong pane, the pane reached the end, or focus/scroll target is wrong. Re-ground visually instead of continuing blind scrolls.

Evidence: `audit/chats/transcripts/mobile_mpc2ajse_k6gsfj.md:52-124` (stale screenshot error) and `:260-370` (later repeated likely_noop scrolls).
