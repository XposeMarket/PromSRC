## 6) Creative Modes

Creative mode is a persisted per-session field in `session.ts`.
Current supported values:

- `design`
- `image`
- `canvas`
- `video`

How it behaves now:

- entered with `enter_creative_mode` / `switch_creative_mode`
- exited with `exit_creative_mode`
- inspected with `get_creative_mode`
- stored on the session as `creativeMode`
- broadcast to the UI when changed
- shortens the history window for API calls; isolated Creative Runtime uses a compact creative handoff instead of normal chat history
- suppresses recent tool-log injection
- keeps a separate recent creative tool-log/reference image context for image/canvas/video work
- suppresses normal plan-first behavior unless the user explicitly asks for a plan
- makes canvas/creative output the primary workspace in the system prompt

This is real session state, not just UI chrome.

Creative prompt profiles exist in `src/gateway/prompt-context.ts` for:

- `creative_design`
- `creative_image`
- `creative_canvas`
- `creative_video`

Creative Runtime isolated mode in `chat.router.ts` is active for `image`, `canvas`, and `video`. `canvas` is treated as a legacy alias for the image/canvas lane. The runtime exposes a narrowed allowlist of creative tools plus skill tools so creative turns stay focused on scene creation, visual QA, asset handling, and export rather than general tool noise.
