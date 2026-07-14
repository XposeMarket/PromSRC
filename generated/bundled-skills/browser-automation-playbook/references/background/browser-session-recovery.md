# Browser Session Recovery Guardrail — 2026-05-22

Use this when a browser workflow hits no-session, user-Chrome debugger, `about:blank`, or screenshot-before-open errors.

## Observed failure patterns

- `browser_list_tabs` before any active browser session returns: `ERROR: No browser session. Use browser_open first.`
- `browser_open(... target:"user_chrome" ...)` can fail when normal Chrome is already open without the debugger port: `Chrome launched but did not respond on port 9223`.
- Opening `about:blank` through the Prometheus browser target can be normalized incorrectly as `https://about:blank` and fail navigation.
- Screenshot/send flows can fail if `browser_vision_screenshot` or delivery runs before a browser session exists.

## Guardrail

1. For browser-tab cleanup or browser screenshot requests, establish/verify a session first with `browser_open` to a real URL, not `about:blank`.
2. If `target:"user_chrome"` fails because the user's normal Chrome is already open, switch to the Prometheus browser target unless the user specifically needs user-Chrome profile state.
3. Only call `browser_list_tabs`, `browser_vision_screenshot`, or screenshot delivery after `browser_open` succeeds or an existing session is confirmed.
4. For “open X/browser then screenshot” flows, use this order: relevant skill → `browser_open(real URL)` → inspect returned state/screenshot → `browser_vision_screenshot` or delivery.
5. Do not keep retrying the same failed `about:blank` or user-Chrome debugger launch. Change target/URL and report the exact blocker if profile continuity is required.

## Evidence

- `Brain/skill-gardener/2026-05-22/workflow-episodes.jsonl:11` — browser tab cleanup recovered after no-session, user-Chrome debugger, and `about:blank` failures.
- `Brain/skill-gardener/2026-05-22/workflow-episodes.jsonl:18` — X/browser screenshot flow attempted screenshot before a browser session existed.
- `audit/chats/transcripts/telegram_1799053599_1779461849625.md:137-144` — user correction after screenshot flow attempted send/open in the wrong order.
