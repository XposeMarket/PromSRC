---
name: X Browser Automation Playbook
description: Tested, stable patterns for X.com (Twitter) browser automation — posting, liking, searching, replying. Read this before any X task.
emoji: "🐦"
version: 1.6.1
triggers: x.com, twitter.com, x app, twitter app, x.com/home, Home / X, tweet, post tweet, compose tweet, publish tweet, send tweet, reply on x, like tweets, unlike tweet, retweet, repost, quote tweet, x search, twitter search, browse x feed, engage on x, x automation, twitter automation, x keyboard shortcuts, j k l x shortcut, focused tweet
---
# X (Twitter) Browser Automation Playbook

Read this file before doing ANY work on X.com. These are the tested, stable patterns. Follow them exactly — do not invent new flows.

---

## Core Rules

- Chrome profile is persistent and is often already logged in, but do not assume auth. If X redirects to login, complete login first before any posting flow.
- `browser_open`, `browser_fill`, `browser_wait`, and `browser_click` ALL return a fresh snapshot automatically. Do NOT call `browser_snapshot` immediately after any of them.
- **For standard posting on X, use the `x_post_text` composite tool by default instead of manually opening the composer.** This is the preferred path whenever the goal is simply to publish a normal post from Home. Only fall back to manual composer steps if the composite fails or the user explicitly wants a different flow.
- Never use `browser_navigate` — it does not exist. Use `browser_open`.
- `browser_type` exists and is used for contenteditable/rich-text areas (e.g., X composer when `browser_fill` does not work). For standard inputs, use `browser_fill`.
- **Speed rule:** prefer bulk/keyboard workflows over repeated click/snapshot loops.
- **Snapshot rule:** only call `browser_snapshot()` when you need new @refs after text-only tools (like `browser_scroll_collect`) or when state is unclear.

---

## Fast Defaults (Use These First)

- **Collection:** `browser_scroll_collect({ scrolls: 8-15, multiplier: 1.75, delay_ms: 1200-2000 })`
- **Liking:** keyboard flow = `j` navigation + `browser_get_focused_item()` verification + `l` like
- **Posting:** use `x_post_text({ post_text: "..." })` as the default path for normal posts from Home
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

## Playbook 1: Compose & Post a Tweet (Default Path)

1. Run `x_post_text({ post_text: "your tweet text" })`
2. Confirm the composite completed without auth or element-ref errors
3. If needed, `browser_wait(1500-2500)` and verify the posted state on Home

**Why this is the default:** the composite has been verified against the live inline Home composer flow and is the fastest stable path for a normal post.

**Fallback to manual flow only if needed:**
1. `browser_open("https://x.com/home")` — opens feed, returns snapshot
2. Find the inline composer textbox (preferred) or use `n` if the user specifically wants modal composer
3. If the composer is a standard `[INPUT]`, use `browser_fill(<composer_ref>, "your tweet text")`; if it's contenteditable, click it first then use `browser_type("your tweet text")`
4. Click the submit button shown in the refreshed snapshot
5. `browser_wait(1500-2500)` and confirm posted state


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
## Error Handling

| Situation | Action |
|-----------|--------|
| Login wall / redirected to /login | Stop. Log `auth_error`. Alert user. Do NOT retry. |
| Element ref not found | Take fresh snapshot, re-analyze. Try once. |
| Keyboard focus unclear during likes | Use `browser_get_focused_item()` before pressing `l`. |
| 429 Too Many Requests | Stop run. Log. Wait 15+ min before retry. |
| Compose box already has text | `browser_press_key("Control+a")` then `browser_press_key("Delete")` to clear |

## Changelog

| Date | Change |
|------|--------|
| 2026-04-11 | v1.6.1: Clarified that `browser_type` exists for contenteditable composers; corrected outdated statement saying it does not exist. Updated fallback composer flow to distinguish between `browser_fill` (standard input) and `browser_type` (contenteditable). |
| 2026-04-10 | v1.6.0: Updated posting guidance so standard X posts should use the verified `x_post_text` composite by default; manual composer flow is now fallback-only. |
| 2026-03-25 | v1.3.0: Made fast mode default. Added keyboard like workflow (`j` + focused-item check + `l`), bulk collection defaults, posting speed path, snapshot minimization rules, and explicit fallback mode. |
| 2026-03-20 | Added Playbook 2 (Search & Collect) using browser_scroll_collect for bulk tweet collection. Renumbered playbooks. |
| 2026-03-19 | Updated account from @Small_Claw_ to @PrometheusAI_X. Updated search queries for Prometheus branding. |
| 2026-03-13 | Fixed tool names (browser_open not browser_navigate, browser_fill not browser_type). Added keyboard shortcut for composer. |
| 2026-03-08 | Initial playbook from weekly performance review |

| 2026-03-08 | Initial playbook from weekly performance review |