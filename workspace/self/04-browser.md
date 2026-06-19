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

- `browser_type`
- `browser_scroll_collect_v2`
- `browser_intercept_network`
- `browser_element_watch`
- `browser_snapshot_delta`
- `browser_extract_structured`
- `browser_teach_verify`

Browser site knowledge now includes named elements, item roots, and extraction schemas via `src/gateway/browser-site-knowledge.ts`. `browser_extract_structured` can use an inline schema or a saved schema name.

Browser-vs-web routing after the 2026-06-05 batch research update:

- normal research, article/doc reading, static source verification, and multi-source reading should start with `web_search({ fetch_top_k })`, `web_fetch({ urls: [...] })`, or one `web_fetch({ url })`
- browser automation is for interaction, logged-in state, live UI state, JS-heavy pages, screenshots/visual QA, structured DOM extraction, and workflows that require clicking/typing/scrolling
- if the task is several known URLs with no interaction requirement, use `web_fetch({ urls: [...] })` before opening browser tabs
- if the task is one X/Twitter status URL, use `web_fetch({ url })` first; if it is several X/Twitter status URLs, use `web_fetch({ urls: [...] })` first
- escalate from web fetch tools to browser tools only when output is empty, blocked, noisy/nav-only, JS-rendered, auth-specific, or the user explicitly asked to operate the website
