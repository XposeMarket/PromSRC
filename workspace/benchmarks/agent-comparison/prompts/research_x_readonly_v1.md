# Read-only X research (research_x_readonly_v1)

Use your actual browser or web research capability to visit the public, non-login page `https://x.com/OpenAI`. Read only. Do not log in, follow, like, post, reply, message, or modify anything.

Write `benchmarks/agent-comparison/fixtures/research_x_readonly_v1/report.md` with the exact source URL, observed page title or profile heading, the date/time of observation, and two concise factual observations. State explicitly that the task was read-only and required no login. If X requires login or is unavailable, do not guess: write the limitation and end with the blocked token.

On success, end exactly:

`RESEARCH_X_READONLY_V1_PASS: completed=true`

If unavailable, end exactly:

`RESEARCH_X_READONLY_V1_BLOCKED: <brief reason>`
