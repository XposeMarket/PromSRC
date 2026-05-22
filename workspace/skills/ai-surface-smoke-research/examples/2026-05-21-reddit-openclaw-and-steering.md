# Example: Reddit OpenClaw scan + live steering signal (2026-05-21)

Observed in `mobile_mpf4q1qd_lt5e5y` and nearby voice/steering tests.

## Request shape

Raul asked: "Can you go ahead and please open up Reddit and then look for OpenClaw?"

This is a lightweight browser-backed AI surface scan, not a deep competitive-intelligence report.

## Tool choreography that worked

1. `skill_list`
2. `skill_read("ai-surface-smoke-research")`
3. `skill_read("browser-automation-playbook")`
4. `browser_open` to Reddit search for the requested term.
5. `browser_scroll_collect` to collect visible results.
6. `write_note` with the concrete collected signal.
7. Final response only after collection, with active communities, repeated themes, notable posts, and one short synthesis.

## Good final-response shape

- Confirm the browser/search action completed.
- Name the main community and visible activity metrics when present.
- List related subreddits or adjacent communities.
- Summarize top themes without overstating certainty.
- Include notable posts with rough recency/votes/comments.
- End with one grounded read on what the chatter implies.

## Guardrails

- Stay read-only: no voting, commenting, joining, following, or messaging.
- If the user is testing voice/interruption/steering, treat mid-run corrections as authoritative and re-anchor from current UI state rather than forcing the original script.
- If a browser target hits a human gate or verification wall, report it and continue with any requested or available read-only surface instead of fighting the gate.
