## 7) Browser Interaction Modes and Browser State

Prometheus now has a real browser interaction mode system in `browser-tools.ts`.
Current backend modes:

- `agent`
- `copilot`
- `teach`

Important distinctions:

- These are browser interaction modes, not chat execution modes
- They live in browser interaction state, not in session JSON like `creativeMode`
- `copilot` and `teach` can capture browser control for the user
- Agent browser actions wait for control release in `copilot` and `teach`
- `agent` releases captured control immediately back to Prometheus logic
- current backend normalization maps unknown values, including legacy `review`, back to `agent`
- Browser interaction context is injected into prompt assembly through `[BROWSER CONTROL]`

Tracked browser state includes:

- current interaction mode
- whether control is captured
- control owner (`agent` or `user`)
- recent user browser actions
- last actor summary
- live stream status

## 8) Browser Teach/Copilot UI State

The frontend also has an explicit browser interaction UI surface in `web-ui/src/pages/ChatPage.js`.
Current interaction labels in UI are:

- Agent
- Co-pilot
- Teach

The UI also normalizes legacy `review` back to `agent`.

Teach-specific UI state currently tracks:

- `idle`
- `recording`
- `approval_pending`
- `verifying`
- `verified`

Meaning:

- `copilot` is a shared-control/handoff lane
- `teach` is where guided browser learning, staged step approval, and reusable action capture are being implemented
- Teach verification is backed by `browser_teach_verify` and can run `full`, `safe`, or single-step verification

This means "copilot mode" is real, but it belongs to browser interaction control, not to the main execution-mode enum.

## 9) Browser Observation, Vision, and Fetching

Prometheus now has separate browser observation modes in `browser-tools.ts`:

- `none`
- `compact`
- `delta`
- `snapshot`
- `screenshot`

Important runtime facts:

- tool-specific defaults choose the observe mode after each browser action
- vision screenshots are injected when DOM quality drops or vision mode is active
- browser live stream status tracks transport and focus
- live stream transport is `cdp` or `snapshot`
- live stream focus is `passive` or `interactive`
- `browser_send_to_telegram` exists and is treated as a core browser-adjacent tool
- persistent browser session records are stored at `<configDir>/browser-sessions.json`
- restorable sessions exclude internal preview sessions, task sessions, and compound session IDs

Current browser tool surface also includes:

- model-facing wrappers: `browser_session`, `browser_observe`, `browser_act`, and `browser_extract`
- hidden compatibility handlers: `browser_type`, `browser_scroll_collect_v2`, `browser_intercept_network`, `browser_element_watch`, `browser_snapshot_delta`, `browser_extract_structured`, `browser_teach_verify`, and the other granular browser tools

Browser site knowledge now includes named elements, item roots, and extraction schemas via `src/gateway/browser-site-knowledge.ts`. `browser_extract_structured` can use an inline schema or a saved schema name.

Browser performance telemetry:

- every browser tool result inherits universal tool stopwatch telemetry from `src/gateway/routes/chat.router.ts`
- streamed `tool_result` events expose `durationMs`, `elapsedMs`, and `elapsed_ms`; the model-facing tool message also gets `[TOOL_STOPWATCH] elapsed_ms=...`
- desktop and mobile context-window rows show live/last-turn elapsed timing per browser tool, which is the preferred way to find slow/heavy browser operations
- observation mode is the main speed lever: `none` and `compact` are cheapest, `delta` is middle, `snapshot` is heavier, and `screenshot`/vision/scroll collection are the heaviest but highest-confidence
- cheap browser actions now default to the fast `observe:"none"` ack path (`browser_click`, `browser_fill`, `browser_type`, `browser_drag`, `browser_click_and_download`, `browser_scroll_collect`, and `browser_vision_type`); request `capture_after:true`, `observe:"snapshot"`, or `observe:"screenshot"` only when the next step needs fresh refs or visual proof
- `browser_act(action:"click"|"key"|"scroll", observe:"none")` is intentionally a true fast path: click/key helpers skip the old 1500ms settle wait, and status broadcasts do not block the tool result on fast ack. Retest on 2026-06-29 showed click ~79ms, key ~6ms, and scroll ~7ms on the simple benchmark page.
- browser status broadcasts only attach frames for visual/status-critical tools. `browser_snapshot` and `browser_vision_screenshot` attach frames by default; `browser_open` only attaches a frame when `observe:"screenshot"` is explicitly requested, so `observe:"compact"`/`observe:"none"` opens do not pay screenshot cost just to update live UI state
- `browser_open` uses observation-aware settling: `snapshot`/`screenshot` waits remain safer for SPA hydration, while `compact`/`none` skip long network-idle/hydration waits for fast navigation acks
- desktop click/scroll/drag verification is opt-in by default for speed; use `verify:"auto"`, `verify:"strict"`, or `verify:true` when before/after probe confirmation is worth the extra screenshot/OCR cost
- Windows desktop click/scroll verify-off paths combine pointer move plus click/scroll into one PowerShell invocation, avoiding the old two-process move-then-action cost for routine mouse control
- desktop wrapper schemas expose `modifier:"none"` as the default path. Runtime strips `none`; only preserve `shift|ctrl|alt` when the user explicitly asked for a modified click.
- `desktop_window` exact-handle actions normalize `window_id`, `window_handle`, and `handle`, then use a fast HWND/bounds path for simple window-coordinate click/scroll instead of doing duplicate full window scans.
- benchmark real sites by recording each browser tool's elapsed timing plus result size/tokens, then optimize by lowering observation mode, batching scroll/extraction, avoiding duplicate snapshots, and using web_fetch for non-interactive reading


Browser-vs-web routing after the 2026-06-05 batch research update:

- normal research, article/doc reading, static source verification, and multi-source reading should start with `web_search({ fetch_top_k })`, `web_fetch({ urls: [...] })`, or one `web_fetch({ url })`
- browser automation is for interaction, logged-in state, live UI state, JS-heavy pages, screenshots/visual QA, structured DOM extraction, and workflows that require clicking/typing/scrolling
- if the task is several known URLs with no interaction requirement, use `web_fetch({ urls: [...] })` before opening browser tabs
- if the task is one X/Twitter status URL, use `web_fetch({ url })` first; if it is several X/Twitter status URLs, use `web_fetch({ urls: [...] })` first
- escalate from web fetch tools to browser tools only when output is empty, blocked, noisy/nav-only, JS-rendered, auth-specific, or the user explicitly asked to operate the website
