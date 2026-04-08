---
name: X Browser Automation Playbook
description: Tested, stable patterns for X.com (Twitter) browser automation — posting, liking, searching, replying. Read this before any X task.
emoji: "🐦"
version: 1.5.0
triggers: x.com, twitter.com, x app, twitter app, x.com/home, Home / X, tweet, post tweet, compose tweet, publish tweet, send tweet, reply on x, like tweets, unlike tweet, retweet, repost, quote tweet, x search, twitter search, browse x feed, engage on x, x automation, twitter automation, x keyboard shortcuts, j k l x shortcut, focused tweet
---
# X (Twitter) Browser Automation Playbook

Read this file before doing ANY work on X.com. These are the tested, stable patterns. Follow them exactly — do not invent new flows.

---

## Core Rules

- Chrome profile is persistent and already logged into @PrometheusAI_X. Never log in manually.
- `browser_open`, `browser_fill`, `browser_wait`, and `browser_click` ALL return a fresh snapshot automatically. Do NOT call `browser_snapshot` immediately after any of them.
- After filling the tweet composer, look for `⚠️ COMPOSER SUBMIT BUTTON: @N` in the result — click that exact ref immediately as your next action.
- Never use `browser_navigate` or `browser_type` — they do not exist. Use `browser_open` and `browser_fill`.
- **Speed rule:** prefer bulk/keyboard workflows over repeated click/snapshot loops.
- **Snapshot rule:** only call `browser_snapshot()` when you need new @refs after text-only tools (like `browser_scroll_collect`) or when state is unclear.

---

## Fast Defaults (Use These First)

- **Collection:** `browser_scroll_collect({ scrolls: 8-15, multiplier: 1.75, delay_ms: 1200-2000 })`
- **Liking:** keyboard flow = `j` navigation + `browser_get_focused_item()` verification + `l` like
- **Posting:** `n` composer shortcut, then immediate submit ref click from composer output
- **Avoid waste:** no redundant snapshots between tools that already return one

---

## Skill Routing Boundaries & Precedence

Use these routing rules to avoid overlap and mis-selection:

- **X-specific interactive/social actions → `x-browser-automation-playbook` (this skill).**
  - Examples: compose/post tweets, like/reply/retweet/quote workflows, X feed interaction loops, X-specific keyboard shortcuts.
- **General browser workflows across non-X sites → `browser-automation-playbook`.**
  - Examples: generic form filling, account settings flows, navigation/testing patterns, non-X web task automation.
- **Static extraction/crawl/data collection tasks → `web-scraper`.**
  - Examples: structured extraction, multi-page crawling, parse-only collection where social interaction is not the goal.

When a task includes both scraping and X interaction, prioritize this skill for the X interaction steps and borrow extraction patterns only as needed.

**Precedence order for ambiguous prompts:**
1. If the target is X.com user interaction (post/like/reply/retweet/quote), select this skill first.
2. If the task is generic browser automation on any site (including X-adjacent admin pages), use `browser-automation-playbook`.
3. If the task is extraction-first (collect text/data at scale, crawl pages, return dataset), route to `web-scraper` unless explicit X interaction actions are requested.

---

## Playbook 1: Compose & Post a Tweet (Fast Path)

1. `browser_open("https://x.com/home")` — opens feed, returns snapshot
2. Press `n` via `browser_press_key("n")` — opens the tweet composer immediately (keyboard shortcut)
3. `browser_fill(<composer_ref>, "your tweet text")` — fill the textarea. The result will show `⚠️ COMPOSER SUBMIT BUTTON: @N`
4. `browser_click(<N from above>)` — click the submit button immediately, no other action first
5. `browser_wait(1500-2500)` and confirm posted state

**If `n` shortcut doesn't open composer:** click visible "Post" composer button from current snapshot.

**Char limit:** Keep tweets under 280 chars. Count before filling.

---

## Playbook 2: Search & Collect Tweets (Bulk Fast Mode)

Use `browser_scroll_collect` for bulk tweet collection — one call replaces many scroll/snapshot round-trips.

1. `browser_open("https://x.com/search?q=<encoded_query>&f=live")` — live results, returns snapshot
2. Optional quick read of initial visible tweets
3. `browser_scroll_collect({ scrolls: 10, direction: "down", multiplier: 1.75, delay_ms: 1500, max_chars: 50000 })`
4. Parse returned text for tweet content, authors, timestamps, engagement counts

**Tuning guidance:**
- Need speed: reduce to `scrolls: 8`, `delay_ms: 1200`
- Need depth: increase to `scrolls: 15`, `delay_ms: 2000`

**Key points:**
- `browser_scroll_collect` returns raw text, NOT a DOM snapshot. If you need to interact (like/reply) afterward, call `browser_snapshot()` once to restore @refs.
- If per-scroll new chars trend to 0, the feed segment is exhausted.

**Good search queries for @PrometheusAI_X:**
- `(openclaw OR claude) -from:PrometheusAI_X`
- `(Prometheus AI OR "autonomous AI agent") -from:PrometheusAI_X`
- `"AI agent" automation -from:PrometheusAI_X`

---

## Playbook 3: Like Tweets from Search Results (Keyboard Fast Mode)

Use this mode when liking multiple tweets quickly and safely.

1. `browser_open("https://x.com/search?q=<encoded_query>&f=live")`
2. Press `j` to move focus to next tweet candidate
3. Call `browser_get_focused_item()` to verify author/text relevance (and avoid ads/pinned noise)
4. Press `l` via `browser_press_key("l")` to like focused tweet
5. Repeat steps 2–4 until target count reached (typically 5–10/run)
6. Every few likes (or if unsure), call `browser_get_focused_item()` again for validation

**Notes:**
- This is faster and more stable than hunting Like buttons with repeated @ref click cycles.
- Skip duplicates/non-target tweets by pressing `j` again without liking.
- Keep likes per run moderate (5–10) to reduce rate-limit risk.

---

## Playbook 4: Reply to a Tweet

1. `browser_open("https://x.com/<username>/status/<tweet_id>")` — opens the tweet
2. Find reply button in snapshot, `browser_click(<reply_ref>)`
3. Reply compose area appears — `browser_fill(<textarea_ref>, "reply text")`
4. Look for `⚠️ COMPOSER SUBMIT BUTTON: @N`, click it immediately
5. `browser_wait(1500-2500)` and verify reply posted

---

## Recovery / Fallback Mode (Only If Fast Mode Fails)

Use this only when keyboard focus fails or shortcuts are blocked.

- Take one fresh `browser_snapshot()`
- Use direct `browser_click(@ref)` on visible controls
- If still unstable, `browser_wait(2000)` then retry once
- Do not loop endlessly; stop and report blocker after one retry path

---

## Error Handling

| Situation | Action |
|-----------|--------|
| Login wall / redirected to /login | Stop. Log `auth_error`. Alert user. Do NOT retry. |
| Element ref not found | Take fresh snapshot, re-analyze. Try once. |
| Keyboard focus unclear during likes | Use `browser_get_focused_item()` before pressing `l`. |
| 429 Too Many Requests | Stop run. Log. Wait 15+ min before retry. |
| Compose box already has text | `browser_press_key("Control+a")` then `browser_press_key("Delete")` to clear |
| Tweet over 280 chars | Shorten before filling. Never truncate mid-word. |

---

| 2026-03-26 | v1.5.0: Expanded trigger metadata for stronger auto-routing and added explicit precedence order + boundary rules versus browser-automation-playbook and web-scraper. |
## Changelog

| Date | Change |
|------|--------|
| 2026-03-25 | v1.3.0: Made fast mode default. Added keyboard like workflow (`j` + focused-item check + `l`), bulk collection defaults, posting speed path, snapshot minimization rules, and explicit fallback mode. |
| 2026-03-20 | Added Playbook 2 (Search & Collect) using browser_scroll_collect for bulk tweet collection. Renumbered playbooks. |
| 2026-03-19 | Updated account from @Small_Claw_ to @PrometheusAI_X. Updated search queries for Prometheus branding. |
| 2026-03-13 | Fixed tool names (browser_open not browser_navigate, browser_fill not browser_type). Added keyboard shortcut for composer. |
| 2026-03-08 | Initial playbook from weekly performance review |