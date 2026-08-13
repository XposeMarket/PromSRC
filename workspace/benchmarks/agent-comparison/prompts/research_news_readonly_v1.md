# Read-only news research (research_news_readonly_v1)

Use your actual browser or web research capability to visit the public news page `https://www.bbc.com/news`. Read only. Do not log in, subscribe, comment, share, or modify anything.

Write `benchmarks/agent-comparison/fixtures/research_news_readonly_v1/report.md` with the exact source URL, observed page title, the date/time of observation, and two concise, clearly attributed headline/topic observations. State explicitly that the task was read-only and required no login. If the page is unavailable, do not guess: write the limitation and end with the blocked token.

On success, end exactly:

`RESEARCH_NEWS_READONLY_V1_PASS: completed=true`

If unavailable, end exactly:

`RESEARCH_NEWS_READONLY_V1_BLOCKED: <brief reason>`
