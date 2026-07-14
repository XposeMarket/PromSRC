# Use the user's existing Chrome window for auth flows (2026-05-16)

Observed during an xAI/Grok OAuth troubleshooting session: when the user explicitly says to use their already-open Chrome window for an authenticated flow, do **not** switch to Prometheus browser automation / Playwright / debugger-profile browser tools. Those may use an isolated or unauthenticated profile and can invalidate the test.

## Guardrail

If the user says variants of:
- "use my actual open Chrome browser"
- "don't open your own browser"
- "not your personal chrome debugger port"
- "use desktop tools"
- "the OAuth/login should open in the same Chrome browser"

Then treat this as an OS-level desktop automation request:
1. Read this desktop playbook first.
2. Use `desktop_find_window` / `desktop_focus_window` for Chrome.
3. Capture a fresh `desktop_window_screenshot` or `desktop_screenshot`.
4. Interact with the visible Prometheus/Chrome UI using screenshot-anchored desktop actions.
5. Re-ground after each auth redirect/new-tab/modal step.

## Why

Auth flows can depend on the user's real browser profile, cookies, existing sessions, installed extensions, or the exact window where Prometheus Gateway is open. Browser automation profiles may appear logged out or hit the wrong localhost/debugger context, causing false blockers.

## Evidence

- `audit/chats/transcripts/telegram_1799053599_1778887762276.md:52-64` — the user asked Prometheus to control his open Chrome browser via desktop tools for xAI OAuth and corrected the assistant after it used the isolated browser/debugger path.
