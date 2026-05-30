# Example: AI Smoke Test — 2026-05-22

Use this as the compact reference example when Raul says “run the AI smoke test” or asks to test browser/desktop AI research surfaces.

## Successful request shape

Raul said: `Run the ai smoke test`.

## Tool choreography that worked

1. `skill_list`
2. `skill_read("ai-surface-smoke-research")`
3. `skill_read("desktop-automation-playbook")`
4. `skill_read("browser-automation-playbook")`
5. `skill_read("x-browser-automation-playbook")`
6. Activate browser + desktop tool categories.
7. `desktop_find_window` / `desktop_focus_window` for Codex.
8. Use exact window handles or screenshots for Claude because browser/X page titles may include “Claude” and cause name collisions.
9. `browser_open` Reddit search for the default query.
10. `browser_scroll_collect` Reddit results.
11. `browser_open` X live search for the default query.
12. `browser_scroll_collect` X results.
13. `write_note` with concrete collected signal.
14. Final response only after tool-backed collection completes.

## Good final summary pattern

- Desktop: say whether Codex/Claude focus worked; call out ambiguity honestly.
- Reddit: summarize repeated themes from collected results.
- X: summarize repeated themes from collected results and item count when known.
- Overall: one product-positioning read, not a giant report.
- Tool check: list what worked and any partial/ambiguous surface.

## Observed 2026-05-22 output signal

- Codex focus worked.
- Claude focus was ambiguous because a Chrome/X window title contained “Claude”; future runs should verify the actual app by handle/screenshot.
- Reddit results centered on Hermes vs OpenClaw, migration questions, and whether these harnesses are necessary.
- X collection returned 22 items; dominant theme was “agent OS / command center,” with memory/context graphs recurring.
- Product read: the chatter is moving from “which chatbot wins” toward reliable daily workflow stacks, aligning with Prometheus positioning.

## Evidence

- `audit/chats/transcripts/f2db1dc8-84c4-4034-9501-12f3fb3f812e.md:10-21`
- `Brain/skill-gardener/2026-05-22/workflow-episodes.jsonl:10`
