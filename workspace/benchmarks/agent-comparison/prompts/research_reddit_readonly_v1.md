# Read-only Reddit research (research_reddit_readonly_v1)

Use your actual browser or web research capability to visit the public page `https://www.reddit.com/r/AskReddit/`. Read only. Do not log in, vote, comment, post, message, or modify anything.

Write `benchmarks/agent-comparison/fixtures/research_reddit_readonly_v1/report.md` with the exact source URL, observed page title or subreddit heading, the date/time of observation, and two concise factual observations from the page. State explicitly that the task was read-only and required no login. If Reddit is unavailable or requires login, do not guess: write the limitation and end with the blocked token.

On success, end exactly:

`RESEARCH_REDDIT_READONLY_V1_PASS: completed=true`

If unavailable, end exactly:

`RESEARCH_REDDIT_READONLY_V1_BLOCKED: <brief reason>`
