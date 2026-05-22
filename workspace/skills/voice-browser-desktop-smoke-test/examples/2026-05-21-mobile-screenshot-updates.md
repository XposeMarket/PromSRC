# Mobile screenshot updates for voice desktop smoke tests

Date: 2026-05-21

## Trigger

Raul asked: “have the worker start sending me screenshots whenever it starts doing things like focusing and everything. Just have it send a screenshot to mobile for me, please.”

## Behavior to apply

For future voice-driven browser/desktop smoke-test style runs:

1. After meaningful visible browser/desktop actions, capture fresh visual proof.
2. When focusing Codex, Claude, or another desktop app, capture a fresh desktop/window screenshot after the focus action.
3. Send that screenshot to Raul’s origin/mobile surface when available, using `delivery_send_screenshot(target:"origin")` or the appropriate mobile/Telegram delivery tool.
4. Keep the text concise. The screenshot is the update.
5. Skip screenshot sending only if Raul explicitly says not to, or if the tool/surface is unavailable; then report the exact blocker briefly.

## Suggested workflow patch

- X open/search: browser_open with `observe:"screenshot"` is enough unless Raul asks for mobile proof of the browser page.
- X scroll: browser_scroll with `observe:"screenshot"`; optionally send screenshot if the run is being monitored live.
- Codex focus: `desktop_focus_window({ name:"Codex" })` → fresh `desktop_screenshot` or `desktop_window_screenshot(name:"Codex")` → `delivery_send_screenshot(target:"origin", caption:"Focused Codex")`.
- Claude focus: `desktop_focus_window({ name:"Claude" })` → fresh `desktop_screenshot` or `desktop_window_screenshot(name:"Claude")` → `delivery_send_screenshot(target:"origin", caption:"Focused Claude")`.

## Guardrail

Do not read or summarize Codex/Claude contents unless Raul explicitly asks. Screenshots are for visibility/proof during the test flow, not for content extraction.