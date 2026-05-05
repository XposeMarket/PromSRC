---
name: x-browser-automation-playbook
description: Use this skill for interactive work on X.com — posting, replying, liking, searching, collecting tweets, and other live browser actions. For plain X status URLs that the user wants fetched or read, default to `web_fetch` first and answer from that result without extra steps unless the user explicitly asks for more.
emoji: "🧩"
version: 2.5.0
triggers: post on x, tweet this, reply to this tweet, like tweets, search x, collect tweets, fetch this x post, read this tweet url, pull this x thread, webfetch this x url, web fetch this x url, get this tweet
---

# X (Twitter) Browser Automation Playbook

Use this file before doing work on X.com.

This skill covers the tested browser flows for interaction on X **and** the routing rule that plain X status URL retrieval should begin with `web_fetch`.

---

## Core Rules

- Chrome profile is persistent and is often already logged in, but do not assume auth. If X redirects to login, complete login first before any posting flow.
- `browser_open`, `browser_fill`, `browser_wait`, and `browser_click` all return a fresh snapshot automatically. Do **not** call `browser_snapshot` immediately after any of them.
- **Posting guardrail:** only use a posting path (`x_post`, `x_post_with_image`, `x_post_with_images`, manual composer fill, or submit-button click) when the user explicitly asked/confirmed that a real post should be published. If the user wants a draft only, do not use live-composer fill paths.
- **Preferred posting path:** use the saved composite tools first — `x_post` for text-only posts, `x_post_with_image` for a single image, and `x_post_with_images` for multiple images. Only fall back to the manual browser path when the relevant composite is unavailable, incompatible with the requested flow, or the user explicitly wants direct browser control.
- Never use `browser_navigate` — it does not exist. Use `browser_open`.
- `browser_type` exists and is used for contenteditable/rich-text areas. For standard inputs, use `browser_fill`.
- **For X post or thread URLs that the user wants to read/fetch, start with `web_fetch` and stop there unless the user explicitly asks for more.** Browser is for interaction; `web_fetch` is the default retrieval path for X URL content.
- **For X posts with image attachment during posting, prefer clipboard-image paste on Windows:** `desktop_set_clipboard({ file_path: "<absolute-path>", mode: "image" })`, focus the composer, then `desktop_press_key("Ctrl+V")`.
- **Speed rule:** prefer bulk or keyboard workflows over repeated click/snapshot loops.
- **Snapshot rule:** only call `browser_snapshot()` when you need new @refs after text-only tools or when state is unclear.
- **Composer warning:** on live X reply/post composers, `browser_fill` can act as a side-effectful post path rather than a safe draft step. Treat it as publish-capable. Use it only when posting is authorized.
- **Scroll guard warning:** the automation layer can block repeated blind `browser_scroll(...)` calls until you interact with the page first. Do one real grounding action — for example click a tweet/composer/search box or focus a meaningful element — before manual scrolling. If the goal is collection rather than direct interaction, prefer `browser_scroll_collect(...)` over repeated single scroll calls.

---

## Fast Defaults (Use These First)

- **Read/fetch an X post URL:** `web_fetch({ url: "<x post url>" })`
- **If `web_fetch` returned the content cleanly:** answer from it and stop
- **Collection on X.com:** `browser_scroll_collect({ scrolls: 8-15, multiplier: 1.75, delay_ms: 1200-2000 })`
- **Liking:** keyboard flow = `j` navigation + `browser_get_focused_item()` verification + `l` like
- **Posting:** prefer `x_post` for text-only, `x_post_with_image` for one image, and `x_post_with_images` for multi-image posts; otherwise use the manual browser fallback below
- **Avoid waste:** no redundant snapshots between tools that already return one

---

## Routing Boundaries & Precedence

Use these routing rules to avoid overlap and mis-selection:

- **X-specific interactive/social actions → this skill.**
  - Examples: compose/post tweets, like/reply/retweet/quote workflows, X feed interaction loops, X-specific keyboard shortcuts.
- **Plain X status URL retrieval → start with `web_fetch`.**
  - If `web_fetch` already returned the text/thread content, do not escalate further by default.
- **Local or already-downloaded video understanding → `video-analysis-and-transcription`.**
  - Examples: watch this saved clip, transcribe this downloaded MP4, summarize what happens in this X video after download.
- **General browser workflows across non-X sites → `browser-automation-playbook`.**
- **Static extraction/crawl/data collection tasks outside X → `web-scraper`.**

**Precedence order for ambiguous prompts:**
1. If the target is X.com user interaction (post/like/reply/retweet/quote), use this skill.
2. If the target is an X post/thread URL and the user wants it fetched/read, run `web_fetch` first.
3. If the target file is already local and the real job is watch/transcribe/summarize, route to `video-analysis-and-transcription`.
4. If the task is generic browser automation on any site, use `browser-automation-playbook`.
5. If the task is extraction-first on non-X sites, use `web-scraper` unless explicit X interaction actions are requested.

---

## Playbook 1: Fetch an X Post or Thread via `web_fetch`

Use this when the user says things like **webfetch this**, **fetch this tweet**, **read this X post**, or **pull this thread**.

1. Run `web_fetch({ url: "https://x.com/<user>/status/<id>" })`
2. Read the returned X-aware payload
3. Inspect fields like:
   - `count`
   - `tweets`
   - post text
   - author / handle / timestamps
   - metrics if present
   - media hints if present
4. If the returned payload already gives the text needed, answer from that directly without opening the browser
5. Stop there unless the user explicitly asks for download, analysis, or interaction

### Default rule

For a normal X URL fetch request, **`web_fetch` is the complete path**.

Do not turn it into a browser flow unless:
- `web_fetch` failed or returned unusable output, or
- the user asked for something beyond simple retrieval

---

## Playbook 2: Compose & Post a Tweet

### Preferred composite-first path

Choose the posting tool by payload before reaching for manual browser automation:

1. **Text-only post:** run `x_post({ post_text: "your tweet text" })`
2. **Single-image post:** run `x_post_with_image({ post_text: "your tweet text", image_path: "<workspace path>" })`
3. **Multi-image post:** run `x_post_with_images({ post_text: "your tweet text", image_paths: "[\"path1\",\"path2\"]" })`
4. Confirm the composite completed without auth, upload, or element-ref errors
5. If needed, verify the posted state afterward

**Why this is preferred:** these saved X composites are the default stable path for posting and should be used before opening X manually. They already encode the verified posting workflow and reduce unnecessary browser steering.

### Manual browser path when the relevant composite is unavailable or the user wants direct browser control

1. `browser_open("https://x.com/home")`
2. Find the inline composer textbox (preferred) or use `n` only if the user specifically wants modal composer
3. Only target an element explicitly marked `[INPUT]` for `browser_fill`. Ignore nearby decorative `div`s such as visible “What’s happening?” prompt text.
4. If the composer is a standard `[INPUT]`, use `browser_fill(<composer_ref>, "your tweet text")`; if it is contenteditable, click it first then use `browser_type("your tweet text")`
5. If a submit button is still present in the refreshed snapshot, click it immediately
6. `browser_wait(1500-2500)` and confirm posted state

**Important:** on some live X composer states, `browser_fill` can itself complete the publish flow. Do **not** use this path for drafts. Use it only when the user explicitly wants to post.

### Image attachment guidance

- For **one image**, prefer `x_post_with_image`
- For **multiple images**, prefer `x_post_with_images`
- Use the manual clipboard/upload/browser flow only as a fallback when the composite path cannot satisfy the request

Fallback-only manual image path:
1. Ensure the target image already exists locally
2. `desktop_set_clipboard({ file_path: "<absolute-path>", mode: "image" })`
3. Open/focus the X composer
4. `desktop_press_key("Ctrl+V")`
5. Wait for the attachment preview to appear before submitting
6. Then post normally

Do not assume generic file-drop clipboard payloads work on X. Native image clipboard data is the intended fallback path.

**Char limit:** Keep tweets under 280 characters. Count before filling.

---

## Playbook 3: Search & Collect Tweets (Bulk Fast Mode)

Use `browser_scroll_collect` for bulk tweet collection — one call replaces many scroll/snapshot round-trips.

1. `browser_open("https://x.com/search?q=<encoded_query>&f=live")`
2. Optional quick read of initial visible tweets
3. `browser_scroll_collect({ scrolls: 10, direction: "down", multiplier: 1.75, delay_ms: 1500, max_chars: 50000 })`
4. Parse returned text for tweet content, authors, timestamps, engagement counts

**Tuning guidance:**
- Need speed: reduce to `scrolls: 8`, `delay_ms: 1200`
- Need depth: increase to `scrolls: 15`, `delay_ms: 2000`

**Key points:**
- `browser_scroll_collect` returns raw text, **not** a DOM snapshot. If you need to interact afterward, call `browser_snapshot()` once to restore @refs.
- If manual `browser_scroll(...)` is blocked before any page interaction, click or focus a meaningful X surface first (tweet card, search box, composer, or another real element), then retry. Do not sit in a blind-scroll loop.
- If per-scroll new chars trend to 0, the feed segment is exhausted.

**Good search query patterns:**
- `(<brand keyword> OR <competitor keyword>) -from:<your_handle>`
- `("<brand phrase>" OR "<category phrase>") -from:<your_handle>`
- `"<category keyword>" automation -from:<your_handle>`

---

## Playbook 4: Like Tweets from Search Results (Keyboard Fast Mode)

Use this mode when liking multiple tweets quickly and safely.

1. `browser_open("https://x.com/search?q=<encoded_query>&f=live")`
2. Press `j` to move focus to next tweet candidate
3. Call `browser_get_focused_item()` to verify author/text relevance and avoid ads or pinned noise
4. Press `l` via `browser_press_key("l")` to like focused tweet
5. Repeat steps 2–4 until target count reached (typically 5–10/run)
6. Every few likes, or if unsure, call `browser_get_focused_item()` again for validation

**Notes:**
- This is faster and more stable than hunting Like buttons with repeated @ref click cycles.
- Skip duplicates/non-target tweets by pressing `j` again without liking.
- Keep likes per run moderate (5–10) to reduce rate-limit risk.

---

### Live-tested caution

- In live smoke testing on 2026-04-22, `browser_fill` on the reply composer posted immediately after fill.
- Because of that, treat reply-composer fill the same way as post-composer fill: **publish-capable, not draft-safe**.
- If the user wants a draft or review-before-send flow, do not fill a live reply composer unless they explicitly confirm posting is okay.

## Playbook 5: Reply to a Tweet

1. `browser_open("https://x.com/<username>/status/<tweet_id>")`
2. Find reply button in snapshot and `browser_click(<reply_ref>)`
3. When the reply compose area appears, use `browser_fill(<textarea_ref>, "reply text")` or `browser_type` if contenteditable
4. Look for the composer submit button and click it immediately
5. `browser_wait(1500-2500)` and verify reply posted

---

## Recovery / Fallback Mode (Only If Fast Mode Fails)

Use this only when keyboard focus fails, `web_fetch` for a read request fails, or shortcuts are blocked.

- For reading X URLs: retry with `web_fetch` once if the first result is malformed
- For browser interaction failures: take one fresh `browser_snapshot()`
- Use direct `browser_click(@ref)` on visible controls
- Do **not** treat multi-key shortcut hints shown by X (for example `g h`) as automatically executable through `browser_press_key`. Tool support for chord/sequence shortcuts may differ from what X advertises in the UI.
- If still unstable, `browser_wait(2000)` then retry once
- Do not loop endlessly; stop and report the blocker after one retry path

---

## Anti-Patterns / What Not to Do

- Do **not** open the browser first when the user only wants text from an X post URL. Start with `web_fetch`.
- Do **not** manually open X for a normal posting request before checking whether `x_post`, `x_post_with_image`, or `x_post_with_images` already fits the request.
- Do **not** use browser automation for static X post reading when `web_fetch` already returned the payload cleanly.
- Do **not** turn a plain fetch request into download/analysis work unless the user asked for that.
- Do **not** use `browser_run_js` as the first move on X. Use visual/browser tools or `web_fetch` first.
- Do **not** spam redundant snapshots after tools that already return one.
- Do **not** invent unsupported X flows when the playbook already has a narrower stable path.

---

## Changelog

| Date | Change |
| 2026-04-25 | v2.5.0: Updated posting guidance to prefer the saved composites `x_post`, `x_post_with_image`, and `x_post_with_images` before any manual browser composer flow. Manual X opening is now explicitly fallback-only for posting when the relevant composite is unavailable or the user wants direct browser control. |
|------|--------|
| 2026-04-23 | v2.4.0: Added explicit automation-layer scroll-guard guidance for X. Documented that repeated blind `browser_scroll(...)` calls can be blocked until a real page interaction anchors the session, and that `browser_scroll_collect(...)` is the preferred path when the goal is collection rather than manual feed steering. |
| 2026-04-22 | v2.3.0: Simplified X URL retrieval guidance so plain status-link requests now default to a straight `web_fetch` read path with no automatic extra download/analysis work. Cleaned the skill back toward interaction-first scope while preserving the fetch-first routing rule. |
| 2026-04-22 | v2.2.0: Updated posting guidance after live smoke testing. `x_post_text` is now framed as the preferred path only when surfaced in the active toolset, with manual browser posting documented as the direct fallback. Added explicit posting guardrails, warned that `browser_fill` on live X composers can immediately publish, clarified that drafts should not use live composer fill, added the inline-composer `[INPUT]` targeting warning, and documented shortcut-execution limitations for sequences like `g h`. |
| 2026-04-22 | v2.1.0: Expanded the skill so X video/media requests now explicitly route into `video-analysis-and-transcription` after download when the user wants watch/transcribe/summarize output rather than just file acquisition. Strengthened frontmatter trigger phrases for X clip analysis/transcription. |
| 2026-04-21 | v2.0.0: Expanded skill scope so it also covers `web_fetch` retrieval of X post/thread URLs plus media-handoff rules. Added explicit fetch-first guidance, media decision table, anti-patterns, and stronger frontmatter triggers to avoid mis-routing when the ask is about reading or extracting X posts rather than interacting on X.com. |
| 2026-04-11 | v1.6.1: Clarified that `browser_type` exists for contenteditable composers; corrected outdated statement saying it does not exist. Updated fallback composer flow to distinguish between `browser_fill` (standard input) and `browser_type` (contenteditable). |
| 2026-04-10 | v1.6.0: Updated posting guidance so standard X posts should use the verified `x_post_text` composite by default; manual composer flow is now fallback-only. |
| 2026-03-25 | v1.3.0: Made fast mode default. Added keyboard like workflow (`j` + focused-item check + `l`), bulk collection defaults, posting speed path, snapshot minimization rules, and explicit fallback mode. |
| 2026-03-20 | Added Playbook 2 (Search & Collect) using `browser_scroll_collect` for bulk tweet collection. Renumbered playbooks. |
| 2026-03-19 | Generalized account-specific search examples into reusable query patterns. |
| 2026-03-13 | Fixed tool names (`browser_open` not `browser_navigate`, `browser_fill` not `browser_type`). Added keyboard shortcut for composer. |
| 2026-03-08 | Initial playbook from weekly performance review. |
