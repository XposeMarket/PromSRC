# X (Twitter) Browser Automation Playbook

Use this file before doing work on X.com.

This skill covers tested browser flows for interaction on X, verified saved composite tools, and the routing rule that plain X status URL retrieval should begin with `web_fetch`.

---

## Core Rules

- Chrome profile is persistent and is often already logged in, but do not assume auth. If X redirects to login, complete login first before posting/interacting.
- `browser_open`, `browser_fill`, `browser_wait`, and `browser_click` often return observations. Do **not** call `browser_snapshot` immediately after tools that already returned fresh state.
- **External-action guardrail:** only post, reply, like, repost, bookmark, or otherwise mutate X when the user explicitly authorizes that action. When using manual final publish/send actions, use `request_final_action_approval` before the final browser click/key unless the action is inside a user-approved composite whose purpose is explicitly to publish/interact.
- **Composite-first rule:** prefer the saved verified X composites below before manual browser automation. Fall back manually only when the composite does not fit, is unavailable, errors, or the user explicitly asks for direct browser steering.
- Never use `browser_navigate` — it does not exist. Use `browser_open`.
- `browser_type` is correct for X contenteditable/rich-text composers. `browser_fill` is for standard inputs and can be side-effectful on some X composers.
- **For X post/thread URLs the user wants to read/fetch:** start with `web_fetch({ url })` and answer from that unless the user asks for browser interaction, download, or deeper analysis.
- **Speed rule:** prefer bulk/keyboard/composite workflows over repeated click/snapshot loops.
- **Snapshot rule:** only call `browser_snapshot()` when you need fresh refs or state is unclear.
- **Scroll guard warning:** repeated blind `browser_scroll(...)` calls can be blocked until a real page interaction anchors the page. For collection, prefer `browser_scroll_collect(...)` or `x_search_collect(...)`.

---

## Verified Saved X Composites — Use These First

These were live-tested on 2026-06-01 in the Prometheus browser profile.

### `x_post_text({ post_text })`

Use for explicit text-only posting requests.

Workflow encoded:
1. Open `https://x.com/home`.
2. Click the inline home composer selector `[data-testid='tweetTextarea_0']`.
3. Type `post_text` with `browser_type`.
4. Click `[data-testid='tweetButtonInline']` to publish.

Notes:
- Publishes immediately. Use only when the user explicitly asked to post.
- Avoid duplicate text; X rejects repeated identical posts.
- Keep under X character limits.

### `x_search_collect({ query, scrolls })`

Use for X search/research/collection.

Workflow encoded:
1. Open `https://x.com/search?q={{query}}&src=typed_query&f=live`.
2. Run `browser_scroll_collect` with down scrolling, multiplier around `1.75`, delay around `1200ms`, structured extraction enabled, and no-new-content stopping.

Typical output includes tweet IDs, authors, handles, timestamps, text, links, media hints, metrics, and snapshot deltas.

### `x_open_bookmarks()`

Use for “open/find my X bookmarks.”

Workflow encoded:
1. Open `https://x.com/i/bookmarks`.
2. Return a fresh X snapshot.

### `x_open_notifications()`

Use for opening notifications.

Workflow encoded:
1. Open `https://x.com/notifications`.
2. Return a fresh X snapshot.

### `x_open_profile()`

Use for opening the current known logged-in profile.

Workflow encoded:
1. Open `https://x.com/raulinvests`.
2. Return a fresh X snapshot.

Limitation: currently hardcoded to `raulinvests`. If account portability matters, create/update a parameterized version that accepts `handle` or detects the logged-in account.

### `x_open_grok()`

Use for opening Grok inside X.

Workflow encoded:
1. Open `https://x.com/i/grok`.
2. Return a fresh X snapshot.

### `x_like_focused_post()`

Use only after the intended post is already keyboard-focused and confirmed.

Workflow encoded:
1. Press X shortcut `l`.
2. Optionally call `browser_get_focused_item()` as non-blocking confirmation.

### `x_bookmark_focused_post()`

Use only after the intended post is already keyboard-focused and confirmed.

Workflow encoded:
1. Press X shortcut `b`.
2. Optionally call `browser_get_focused_item()` as non-blocking confirmation.

---

## Fast Defaults

- **Read/fetch an X post URL:** `web_fetch({ url: "<x post url>" })`
- **Explicit text-only post:** `x_post_text({ post_text: "..." })`
- **Search/collect tweets:** `x_search_collect({ query: "...", scrolls: 5-10 })`
- **Open bookmarks:** `x_open_bookmarks()`
- **Open notifications:** `x_open_notifications()`
- **Open profile:** `x_open_profile()` unless a different handle is requested
- **Open Grok:** `x_open_grok()`
- **Like a known focused post:** confirm focus with `browser_get_focused_item()` if unclear, then `x_like_focused_post()`
- **Bookmark a known focused post:** confirm focus with `browser_get_focused_item()` if unclear, then `x_bookmark_focused_post()`
- **Manual collection fallback:** `browser_scroll_collect({ scrolls: 8-15, multiplier: 1.75, delay_ms: 1200-2000 })`
- **Manual keyboard liking fallback:** `j` navigation + `browser_get_focused_item()` verification + `l` like

---

## Routing Boundaries & Precedence

1. If the target is X.com user interaction — post, like, reply, repost/quote, bookmark, open bookmarks/notifications/profile/Grok, search X — use this skill and prefer composites.
2. If the target is an X post/thread URL and the user wants it fetched/read, run `web_fetch` first.
3. If the target file is already local and the real job is watch/transcribe/summarize, route to `video-analysis-and-transcription`.
4. If the task is generic browser automation on another site, use `browser-automation-playbook`.
5. If the task is extraction-first outside X, use `web-scraper` unless explicit X interaction is requested.

---

## Playbook 1: Fetch an X Post or Thread via `web_fetch`

Use this when the user says **webfetch this**, **fetch this tweet**, **read this X post**, **pull this thread**, or sends an X status URL with read/analyze intent.

1. Run `web_fetch({ url: "https://x.com/<user>/status/<id>" })`.
2. Inspect returned fields: tweet text, author, handle, timestamp, metrics, thread/replies/media hints when present.
3. If content is clean, answer from it and stop.
4. Escalate to browser only if `web_fetch` fails/returns unusable content or the user asks for interaction/download/deeper analysis.

---

## Playbook 2: Compose & Post a Text Tweet

### Preferred path

1. Confirm the user explicitly asked to publish a real post.
2. Check text for duplicate risk and length.
3. Run `x_post_text({ post_text: "..." })`.
4. Verify composite result/visible profile state if needed.

### Manual fallback

Use only if the composite is unavailable/incompatible or the user asks for direct browser control.

1. `browser_open("https://x.com/home", observe: "snapshot")`
2. Click `[data-testid='tweetTextarea_0']` or the visible inline composer.
3. Use `browser_type("tweet text")` for the contenteditable composer.
4. Before a manual final publish click, call `request_final_action_approval` unless already clearly covered by the user’s immediate explicit posting authorization and local policy permits the direct final action.
5. Click `[data-testid='tweetButtonInline']`.
6. Wait briefly and verify posted state.

Warning: some X composer tool paths can publish as part of filling/submitting. Never use a live composer path for “draft only.”

---

## Playbook 3: Search & Collect Tweets

### Preferred path

1. Run `x_search_collect({ query: "<query>", scrolls: 5-10 })`.
2. Parse returned structured items for authors, handles, tweet IDs, text, links, timestamps, media hints, and metrics.
3. If you need to interact with a result afterward, call `browser_snapshot()` once to restore current refs/focus.

### Manual fallback

1. `browser_open("https://x.com/search?q=<encoded_query>&src=typed_query&f=live")`
2. `browser_scroll_collect({ scrolls: 10, direction: "down", multiplier: 1.75, delay_ms: 1500, max_chars: 50000, include_structured: true })`
3. Stop if new content trends to zero.

Good query patterns:
- `(<brand keyword> OR <competitor keyword>) -from:<your_handle>`
- `("<brand phrase>" OR "<category phrase>") -from:<your_handle>`
- `"<category keyword>" automation -from:<your_handle>`

---

## Playbook 4: Like or Bookmark Focused Tweets

Use this only when the target post is already focused or can be verified.

1. Navigate/focus with X keyboard navigation (`j`/`k`) or by clicking a tweet card.
2. Call `browser_get_focused_item()` if focus is unclear.
3. For like: `x_like_focused_post()`.
4. For bookmark: `x_bookmark_focused_post()`.
5. If the composite fails, fall back to `browser_press_key("l")` for like or `browser_press_key("b")` for bookmark, then verify.

Do not like/bookmark random posts without target relevance if the user requested a specific topic/person/post.

---

## Playbook 5: Open X Pages

Prefer composites:

- Bookmarks → `x_open_bookmarks()`
- Notifications → `x_open_notifications()`
- Profile → `x_open_profile()`
- Grok → `x_open_grok()`

Manual fallback routes:

- Bookmarks: `https://x.com/i/bookmarks`
- Notifications: `https://x.com/notifications`
- Grok: `https://x.com/i/grok`
- Current profile: `https://x.com/raulinvests`

Known blocker:
- Direct Messages / Chat route may redirect to `/i/chat` and show an encrypted-message recovery passcode screen. Treat that as a real blocker; do not bypass or guess passcodes.

---

## Playbook 6: Reply / Repost / Quote

No verified composite exists yet for reply/repost/quote. Use manual visual-first browser automation.

1. Open the target post URL.
2. Use snapshot/vision to identify the Reply/Repost/Quote control.
3. Prepare the composer or menu action.
4. For final publish/repost/quote, call `request_final_action_approval` and pass the returned approval ID to the exact next final click/key.
5. Inspect post-action evidence before reporting success.

---

## Recovery / Fallback Mode

Use this only when composite/keyboard/fast mode fails.

- For X URL reading: retry `web_fetch` once if malformed.
- For browser interaction failures: take one fresh `browser_snapshot()` or `browser_vision_screenshot()`.
- Prefer direct visible controls over `browser_run_js`.
- For known multi-key X shortcuts, send separate keypresses in order (for example `g` then `b`) instead of one combined chord string.
- If still unstable, `browser_wait(2000)` then retry once.
- Do not loop endlessly; report the exact blocker after one retry path.

---

## Anti-Patterns

- Do **not** open X manually for a normal text-only posting request when `x_post_text` fits.
- Do **not** use browser automation to read a static X post URL when `web_fetch` already returned the payload.
- Do **not** use `browser_run_js` as the first move on X.
- Do **not** spam snapshots after tools that already returned fresh observations.
- Do **not** use focused-post composites before confirming focus when the target matters.
- Do **not** bypass the Direct Messages encrypted passcode screen.
- Do **not** claim a post/interact action succeeded until the tool result or visual evidence supports it.

---

## Live-Tested Selectors and Routes

- Home composer: `[data-testid='tweetTextarea_0']`
- Inline post button: `[data-testid='tweetButtonInline']`
- File upload input: `[data-testid='fileInput']`
- Bookmarks: `https://x.com/i/bookmarks`
- Notifications: `https://x.com/notifications`
- Grok: `https://x.com/i/grok`
- Known profile route: `https://x.com/raulinvests`

---

## Changelog

| Date | Change |
|------|--------|
| 2026-06-01 | v2.7.0: Made the verified 2026-06-01 X composites the explicit default workflow: `x_post_text`, `x_search_collect`, `x_open_bookmarks`, `x_open_notifications`, `x_open_profile`, `x_open_grok`, `x_like_focused_post`, and `x_bookmark_focused_post`. Replaced outdated `x_post`-first wording with current live-tested composite names, added page routes/selectors, and documented the DM passcode blocker. |
| 2026-05-05 | v2.6.0: Added X Bookmarks guidance. |
| 2026-04-25 | v2.5.0: Updated posting guidance to prefer saved composites before manual browser composer flow. |
| 2026-04-23 | v2.4.0: Added automation-layer scroll-guard guidance for X. |
| 2026-04-22 | v2.3.0: Simplified X URL retrieval guidance to default to `web_fetch`. |
| 2026-04-22 | v2.2.0: Updated posting guidance after live smoke testing and added composer side-effect warnings. |
| 2026-04-22 | v2.1.0: Added media/video handoff routing. |
| 2026-04-21 | v2.0.0: Expanded skill scope to include `web_fetch` retrieval of X post/thread URLs. |
| 2026-04-11 | v1.6.1: Clarified `browser_type` for contenteditable composers. |
| 2026-04-10 | v1.6.0: Updated posting guidance for verified text posting composite. |
| 2026-03-25 | v1.3.0: Made fast mode default. |
| 2026-03-20 | Added Search & Collect using `browser_scroll_collect`. |
| 2026-03-13 | Fixed browser tool names and composer guidance. |
| 2026-03-08 | Initial playbook from weekly performance review. |
