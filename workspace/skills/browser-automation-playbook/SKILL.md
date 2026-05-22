---
name: Browser Automation Playbook
description: Current operating guide for Prometheus browser automation. Covers visual-first execution, DOM refs, vision fallback, keyboard flows, uploads/downloads, media capture, structured extraction, network interception, and when to use browser tools versus web_search/web_fetch/download tools.
emoji: 🌐
version: 4.2.0
triggers: browser, browser_open, browser_click, browser_fill, browser_type, browser_snapshot, browser_snapshot_delta, browser_scroll, browser_scroll_collect, browser_scroll_collect_v2, browser_drag, browser_press_key, browser_key, browser_wait, browser_close, browser_upload_file, browser_click_and_download, browser_send_to_telegram, browser_vision, browser_run_js, browser_intercept_network, browser_element_watch, browser_extract_structured, browser_get_page_text, browser_get_focused_item, browser_teach_verify, save_site_shortcut, observe, browser observation modes, navigate, web page, click button, fill form, login, submit form, upload file, download image, download video, media download, scrape page, automate website, browser automation
---

# Browser Automation Playbook

Read this before any browser automation task.

This skill is for **interactive website work**: navigating pages, clicking controls, filling forms, handling JS-heavy UIs, uploading files, downloading assets, collecting text from dynamic pages, and completing browser-side workflows.

**Do not use browser tools for normal web research by default.**
- Research / reading docs / articles / static pages → `web_search` then `web_fetch`
- Interactive site use / logged-in flows / clicking / typing / scrolling / JS apps → `browser_*`
- Direct asset download from a known file URL → `download_url`
- Media extraction from a supported media page (X, YouTube, Instagram, TikTok, etc.) → `download_media`

---

## Core operating rules

### 1) Visual-first, always
Ground decisions in the latest page state.

Preferred order:
1. `browser_open()` or another browser action that already returns a snapshot
2. Read the snapshot carefully
3. If the DOM is sparse, unclear, or contradicted by behavior, take a **fresh** `browser_vision_screenshot()`
4. Use `browser_vision_click` / `browser_vision_type` only when DOM refs are insufficient
5. Use `browser_run_js` as a fallback inspection tool, not as your default navigation method

**Trust fresh snapshot / vision evidence over assumptions.**

### 2) Control observation deliberately
Most browser tools support an `observe` option. Use it intentionally instead of assuming every action should return a full snapshot.

Observation modes:
- `observe:"none"` — cheapest; use for deterministic actions where you do not need immediate state, especially keypresses or waits used only for timing.
- `observe:"compact"` — low-token orientation; good after navigation or routine clicks when you only need a short confirmation.
- `observe:"delta"` — shows what changed since the last snapshot; good after SPA clicks, modal opens/closes, or incremental UI changes.
- `observe:"snapshot"` — full DOM refs; use when the next action needs clickable/fillable refs.
- `observe:"screenshot"` — visual truth; use when layout, media, canvas, styling, or ambiguous UI state matters.

Default pattern:
- Need refs immediately → `browser_open(url, observe:"snapshot")`, `browser_click(ref, observe:"snapshot")`, or `browser_wait(ms, observe:"snapshot")`
- Need a quick low-token check → `observe:"compact"`
- Need visual confidence → `observe:"screenshot"` or `browser_vision_screenshot()`
- Need no inspection → `observe:"none"`

Do not call `browser_snapshot()` just because an action finished. First read what the action already returned. Call `browser_snapshot()` only when:
- the last observation did not include refs and you now need refs
- your last snapshot is stale
- state changed in the background
- you used a non-ref collection/read tool such as `browser_scroll_collect`, `browser_scroll_collect_v2`, or `browser_get_page_text`

Use `browser_snapshot_delta()` when you already have a recent snapshot and only want changes.

### 2.5) Scroll guard awareness — do not trigger blind-scroll blocks
Some browser sessions enforce an automation-layer guard against repeated blind scrolling before any real page interaction. In practice, this means `browser_scroll(...)` can be blocked until you first anchor the session with a meaningful interaction such as:
- `browser_click(...)` on a real page element
- `browser_fill(...)` into a real input
- a validated keyboard interaction that clearly targets the page state

Treat this as a **cross-site browser automation rule**, not an X-only quirk.

Use this prevention pattern:
1. Open page and inspect the returned state
2. Perform one real grounding interaction when possible
3. Then scroll
4. If the goal is bulk collection rather than stepwise interaction, prefer `browser_scroll_collect(...)` instead of manual repeated scroll loops

If a scroll is blocked, do **not** keep retrying blind scrolls. Re-anchor with a real interaction or switch to a collection/extraction path.

### 3) Pick the right input tool
- `browser_fill(ref, text)` → standard `[INPUT]` elements from snapshot
- `browser_type(text)` → currently focused contenteditable / rich-text area
- `browser_press_key("Enter")` / `browser_key("Enter")` → submit, navigate, shortcuts
- `browser_upload_file(...)` → real file upload into a page file input

`browser_type` should be used when `browser_fill` is the wrong fit.
`browser_upload_file` should be used when the site expects an actual local file, not pasted text.

### 4) Browser is for interaction, not generic reading
If the user wants information from the web and no interaction is required:
- first use `web_search`
- then `web_fetch`

Open a browser only when interaction or live UI state matters.

### 5) Prefer the most direct download path
When the goal is to get a file, image, audio clip, or video into the workspace:
- direct file URL known → `download_url`
- supported media page URL → `download_media`
- visible browser download button/link that triggers download → `browser_click_and_download`
- hidden/JS-driven asset where you must interact first → browser workflow, then one of the above if a direct URL becomes clear

Do not overuse browser clicking for media when a direct download tool is cleaner and more reliable.

---

## Tool map


### Core browser flow
- `browser_open(url, observe?)` — start browser session on a URL; choose `snapshot` when refs are needed immediately, `compact` for cheap orientation, `screenshot` for visual truth
- `browser_click(ref|element|selector, observe?)` — click an element from the latest snapshot or a saved/taught element
- `browser_fill(ref|element|selector, text, observe?)` — fill a normal input from the latest snapshot or saved/taught element
- `browser_press_key(key, observe?)` / `browser_key(key, observe?)` — press a key on the focused element
- `browser_type(text)` — type raw text into the focused rich-text/contenteditable area
- `browser_wait(ms, observe?)` — wait for dynamic content; request `snapshot` only when you need refs afterward
- `browser_close()` — close tab when done

### Reading and orientation
- `browser_snapshot(observe?)` — full current interactive snapshot
- `browser_snapshot_delta()` — changes since last snapshot
- `browser_get_page_text(element?, observe?)` — all visible text, including iframes, or details for a saved element
- `browser_get_focused_item(observe?)` — identify current keyboard-focused item

### Vision fallback
- `browser_vision_screenshot(observe?)` — viewport image for visual grounding
- `browser_vision_click(x, y, observe?)` — coordinate click
- `browser_vision_type(x, y, text, observe?)` — coordinate click + type

### Uploads / downloads / sharing
- `browser_upload_file(ref|selector, file_path|file_paths, observe?)` — upload one or more local files into a page file input
- `browser_click_and_download(ref, ...)` — click a visible download trigger and save the resulting file into the workspace
- `browser_send_to_telegram(caption)` — send the current browser viewport screenshot to Telegram

### Scraping / extraction / dynamic data
- `browser_scroll(direction, multiplier, observe?)` — one interactive scroll
- `browser_scroll_collect(...)` — repeated scrolling + deduplicated visible text collection
- `browser_scroll_collect_v2(...)` — structured infinite-scroll collection using a saved item root or extraction schema
- `browser_extract_structured(schema)` — CSS/schema extraction into JSON; can save reusable schemas
- `browser_intercept_network(start/read/stop/clear)` — inspect XHR/fetch responses
- `browser_element_watch(selector, ...)` — wait for selector appear/disappear/text

### Advanced interaction and workflow reuse
- `browser_drag(from_ref|coords, to_ref|coords, observe?)` — drag sliders, handles, map/canvas areas, or drag/drop items
- `save_site_shortcut(hostname, key, action, ...)` — persist a verified keyboard shortcut for future sessions
- `browser_teach_verify(mode, stop_before_step?)` — safely replay a taught workflow in a verifier tab after explicit user approval

### Fallback inspection
- `browser_run_js(code)` — inspect page state when snapshot/vision is insufficient

### Adjacent media tools often paired with browser work
These are not `browser_*` tools, but they belong in the practical browser/media workflow:
- `download_url(url, filename?, output_dir?)` — direct download of a known asset URL into the workspace
- `download_media(url, output_dir?, audio_only?)` — extract media from supported pages using yt-dlp
- `analyze_image(file_path, prompt?)` — inspect a downloaded image with vision
- `analyze_video(file_path, prompt?, sample_count?, output_dir?, extract_audio?, transcribe?)` — inspect a local video with sampled frames and optional audio/transcript extraction

---

## Standard workflows

### A. Normal interactive flow
1. `browser_open(url)`
2. Read snapshot
3. `browser_click` / `browser_fill` / `browser_press_key`
4. Read returned state
5. Repeat until done

### B. DOM unclear or sparse
1. `browser_open(url)`
2. If snapshot is too sparse or misleading, call `browser_vision_screenshot()`
3. Use the image to choose the next action
4. If possible, return to DOM-based actions when refs become available again

### C. JS-heavy page with delayed loading
1. `browser_open(url)`
2. If expected element is missing, prefer `browser_element_watch(...)`
3. Otherwise `browser_wait(1500-3000)`
4. Re-read returned snapshot or use `browser_snapshot_delta()`

### D. File upload flow
1. `browser_open(url)`
2. Find the upload control in snapshot, or identify the hidden file input selector if needed
3. Use `browser_upload_file(...)`
4. Confirm the upload result with returned state or `browser_vision_screenshot()`
5. Continue with form submission if needed

### E. Download flow from a page button
1. `browser_open(url)`
2. Inspect snapshot for the actual download/export/save trigger
3. Use `browser_click_and_download(ref, ...)`
4. Confirm the saved file path and continue with analysis or delivery

### F. Media acquisition flow
1. If you already have a direct asset URL, use `download_url`
2. If you have a supported social/video page URL, use `download_media`
3. If you first need to locate or verify the correct media on-page, use browser tools to inspect the page visually
4. Once the asset is local, use `analyze_image` or `analyze_video` if interpretation is needed

---

## When to use each tool

### `browser_fill`
Use when the snapshot shows `[INPUT]`.

Examples:
- search bars
- login inputs
- email / password / text inputs
- normal textareas exposed in snapshot

### `browser_type`
Use when text entry target is **not** a standard `[INPUT]` and instead is:
- a contenteditable composer
- rich text editor
- inline social composer
- custom editor where `browser_fill` does not work

Pattern:
1. click the editor to focus it
2. `browser_type("...")`
3. submit with button click or keypress

### `browser_upload_file`
Use when the page expects a real uploaded file.

Use `ref` when:
- the file input or upload control is visible in snapshot

Use `selector` when:
- the site hides the true `<input type="file">`
- you know the exact CSS selector for the upload target

Good for:
- attaching images to a form
- uploading PDFs/docs
- sending media in social/web apps
- multi-file uploads with `file_paths`

### `browser_click_and_download`
Use when there is a visible download/export/save button or link and clicking it triggers a real browser download.

Good for:
- export buttons
- download image/file links
- generated report downloads
- attachments served through a click-triggered response

Avoid it when:
- you already have the direct file URL → use `download_url`
- the URL is a supported media page → use `download_media`

### `browser_get_page_text`
Use when:
- snapshot shows very few elements
- page likely contains iframe-rendered content
- you need full readable visible text more than clickable refs

### `browser_extract_structured`
Use for repeated containers such as:
- search results
- product cards
- article lists
- tables
- feed items

Prefer it over ad hoc parsing when the DOM structure is consistent.

Modern schema options:
- `container_selector` — direct CSS selector for repeated items
- `item_root` — saved named item root for the current site
- `schema_name` — reuse a previously saved extraction schema
- `fields` — per-field CSS selectors and extraction types (`text`, `href`, `src`, `attr`, `html`)
- `dedupe_key` — field used to deduplicate later scroll collection
- `save_as` — persist the schema for future extraction and `browser_scroll_collect_v2`

Pattern:
1. Use `browser_snapshot()` or visual inspection to identify repeated item structure
2. Run `browser_extract_structured({ schema: { container_selector, fields, dedupe_key, save_as } })`
3. Confirm JSON quality
4. Reuse with `schema_name` or `browser_scroll_collect_v2(...)` for larger collection

### `browser_scroll_collect`
Use when the task is broad text/data collection across multiple scrolls and exact per-card structure is not required.

Best for:
- infinite feeds where a text dump is enough
- social search result reconnaissance
- product/listing pages where the DOM is unstable
- long result sets where deduped visible text is sufficient

Remember: it returns collected text, **not** clickable refs. If interaction is needed afterward, call `browser_snapshot()`.

### `browser_scroll_collect_v2`
Use when the task needs structured JSON items across infinite scroll.

Best for:
- collecting repeated result cards with fields like title, price, URL, author, date, description
- preserving item boundaries instead of flattening everything into text
- deduplicating by URL/id/name
- reusing a saved extraction schema or saved item root

Pattern:
1. Define or reuse structure with `browser_extract_structured(... save_as: "schema name")`, `schema_name`, or `item_root`
2. Run `browser_scroll_collect_v2({ schema_name, dedupe_key, limit, max_scrolls, multiplier, delay_ms })`
3. Check returned quality metadata and stop reason
4. If you need to click an item afterward, call `browser_snapshot()` to regain refs

Choose:
- `browser_scroll_collect` → deduped raw visible text
- `browser_scroll_collect_v2` → structured JSON records

### `browser_drag`
Use for interactions that require dragging rather than clicking.

Good uses:
- sliders and range controls
- drag-and-drop lists/cards
- map or canvas panning
- split-pane resizers
- timeline/scrubber handles

Use `from_ref` / `to_ref` when draggable elements appear in the latest snapshot. Use viewport coordinates only when working from a fresh `browser_vision_screenshot()` and refs are insufficient. After a drag, request `observe:"snapshot"` if the next step needs refs, or `observe:"screenshot"` if the visual result matters.

### `save_site_shortcut`
Use when you discover and verify a keyboard shortcut that will help future sessions.

Pattern:
1. Try the shortcut with `browser_press_key(...)` / keyboard flow
2. Confirm it did the intended thing with snapshot or vision
3. Save it with `save_site_shortcut({ hostname, key, action, context, preferred_for_compose, notes })`

Only save shortcuts that actually worked. Mark `preferred_for_compose:true` when it is the best way to start creating content on that site.

### `browser_teach_verify`
Use only after the user explicitly approves verification of a taught workflow. It replays the current Teach-mode workflow in a detached verifier browser tab that shares login/session state without disturbing the visible browser canvas.

Use `mode:"safe"` to stop before the final risky step, `mode:"step"` to stop before a specific step, and `mode:"full"` only when replaying the entire workflow is safe and approved.

### `browser_intercept_network`
Use when the UI is rendering data from APIs and you want the payload directly.

Pattern:
1. `browser_intercept_network({ action: "start", url_filter: "/api/" })`
2. navigate or click
3. `browser_intercept_network({ action: "read" })`
4. inspect captured responses
5. `browser_intercept_network({ action: "stop" })`

### `browser_element_watch`
Prefer this over blind waiting when you know what should happen.

Examples:
- wait for results list to appear
- wait for spinner to disappear
- wait for success toast text
- wait for a modal to close after submit

### `browser_run_js`
Use only when snapshot + vision still do not reveal what you need.

Good uses:
- inspect hidden state
- read framework globals
- extract data not surfaced in DOM text
- inspect values that are present in JS but not rendered visibly

Bad default behavior:
- navigating a page by JS because you did not inspect the snapshot first
- relying on JS guesses instead of fresh visual evidence

- using it as your first resort for things the snapshot already tells you
### `download_url`
Use when you know the actual file URL.

Best for:
- direct image URLs
- PDFs
- downloadable assets
- static file links from docs/articles/CDNs

This is usually the cleanest path when no browser interaction is needed.

### `download_media`
Use when you have a media page URL on a supported platform and want the actual media file saved locally.

Best for:
- X/Twitter videos
- YouTube videos
- Instagram posts/reels
- TikTok videos
- audio extraction from a supported video page via `audio_only: true`

This is the preferred workflow for supported social/video sources instead of trying to manually scrape media files in-browser.

### `analyze_image`
Use after downloading or creating an image when the user wants interpretation.

Best for:
- describing what is visible
- checking whether the correct image was downloaded
- extracting insight from screenshots or assets

### `analyze_video`
Use after downloading a local video when the user wants a summary of what happens in it.

Best for:
- summarizing scenes
- checking whether audio/transcript is present
- understanding what a social clip contains before reporting back

---

## Snapshot rules, ref handling, and observation

- Use refs from the **latest relevant snapshot**
- Refs can go stale after navigation, modal changes, virtualized list changes, form submission, or SPA route changes
- If the next action needs refs, ask the preceding action for `observe:"snapshot"` instead of reflexively calling `browser_snapshot()` afterward
- If the next decision is visual/layout based, prefer `observe:"screenshot"` or `browser_vision_screenshot()`
- If the page is a SPA and you already have a baseline snapshot, use `browser_snapshot_delta()` to reduce token cost
- If a click seems to do nothing, inspect the returned state/delta before assuming failure
- If a page action is ambiguous, re-anchor with `browser_vision_screenshot()` before continuing
- Collection/read tools such as `browser_scroll_collect`, `browser_scroll_collect_v2`, and `browser_get_page_text` do not give normal clickable refs; call `browser_snapshot()` afterward if interaction is needed

---

## Practical patterns

### Login flow
1. `browser_open(login_url)`
2. `browser_fill(email_ref, "...")`
3. `browser_fill(password_ref, "...")`
4. submit with click or Enter
5. `browser_element_watch(...)` for dashboard or success state

### Search flow
1. `browser_open(site_or_search_url)`
2. `browser_fill(search_ref, query)`
3. `browser_press_key("Enter")`
4. inspect results snapshot

### Rich text / composer flow
1. open page
2. click composer/editor
3. `browser_type(text)`
4. inspect for submit control
5. click submit

### Infinite scroll collection
1. `browser_open(url, observe:"snapshot")`
2. Optionally inspect first visible batch
3. If raw text is enough: `browser_scroll_collect({ scrolls: 8-15, multiplier: 1.5-1.75, delay_ms: 1200-2000 })`
4. If structured records are needed: create/reuse a schema, then `browser_scroll_collect_v2({ schema_name, dedupe_key, limit, max_scrolls })`
5. If later interaction is needed, `browser_snapshot()`

### Structured extraction + reusable schema flow
1. Open the page and identify a repeated item/card/table row
2. Run `browser_extract_structured({ schema: { container_selector, fields, dedupe_key, save_as } })`
3. Verify returned items have the fields you need
4. Reuse later with `browser_extract_structured({ schema: { schema_name } })` or `browser_scroll_collect_v2({ schema_name, dedupe_key })`

### Drag interaction flow
1. Use the latest snapshot refs when the draggable handle/source/target is visible
2. If refs are unavailable, take `browser_vision_screenshot()` and drag by viewport coordinates
3. `browser_drag({ from_ref, to_ref, observe:"snapshot" })` or `browser_drag({ from_x, from_y, to_x, to_y, observe:"screenshot" })`
4. Verify the visual or DOM result before continuing

### Site shortcut discovery flow
1. Try the keyboard shortcut on the focused page
2. Confirm with snapshot/vision that it worked
3. Save with `save_site_shortcut({ hostname, key, action, context, preferred_for_compose, notes })`
4. Use saved shortcuts in future sessions when they are the cleanest route

### Uploading an image/file to a site
1. open page
2. identify upload control
3. `browser_upload_file(...)`
4. verify preview / attachment appeared
5. continue submit flow

### Downloading a report/image from a site
1. open page
2. identify download trigger in snapshot
3. `browser_click_and_download(...)`
4. verify saved path
5. inspect/analyze/share the file if needed

### Supported social/video media download
1. take the media page URL
2. `download_media(url, ...)`
3. inspect returned saved file paths
4. if user wants interpretation, run `analyze_video` or `analyze_image`

### Direct asset retrieval
1. identify the actual asset URL
2. `download_url(url, filename?, output_dir?)`
3. verify saved file
4. continue with analysis or upload elsewhere

### Ambiguous UI
1. take `browser_vision_screenshot()`
2. choose coordinates from current image
3. click/type visually
4. if refs recover, switch back to DOM workflow

---

## Media handling rules

### Choosing the right media path
- Need to interact with a website UI to reach the media → browser workflow first
- Already have direct file URL → `download_url`
- Have a supported media page URL → `download_media`
- Need to upload local media into a browser page → `browser_upload_file`
- Need to inspect what a local image/video contains → `analyze_image` / `analyze_video`

### Verifying the right media
Before downloading the wrong thing on media-heavy pages:
1. use snapshot or structured extraction to enumerate candidates
2. use nearby text, alt text, username, timestamp, href, or src to rank likely matches
3. if still ambiguous, use `browser_vision_screenshot()` to visually confirm
4. only then download

### Sharing browser state
If the user needs to see what the browser currently shows, use `browser_send_to_telegram(caption)` after orienting the page correctly.

---

## Common mistakes to avoid

- Using browser tools for simple reading that `web_fetch` could do faster
- Calling `browser_snapshot()` immediately after tools that already returned sufficient state
- Forgetting to request `observe:"snapshot"` when the next step needs refs
- Over-requesting full snapshots/screenshots when `observe:"compact"`, `observe:"delta"`, or `observe:"none"` would be enough
- Using `browser_fill` on contenteditable editors that require `browser_type`
- Using `browser_run_js` first instead of checking current visual state
- Clicking around to download media when `download_url` or `download_media` would be cleaner
- Forgetting that `browser_scroll_collect` returns text, not refs
- Using raw text collection when `browser_scroll_collect_v2` would preserve structured records
- Rebuilding extraction schemas repeatedly instead of saving/reusing them with `save_as` and `schema_name`
- Uploading by paste/typing when the page expects a real file input
- Failing to visually confirm the correct media before downloading on crowded pages
- Saving a site shortcut before verifying it actually worked

---

## Quick decision table

| Situation | Best tool / workflow |
|---|---|
| Read article/doc page | `web_search` → `web_fetch` |
| Click through a live website | `browser_open(..., observe:"snapshot")` + snapshot-driven actions |
| Need cheap orientation after navigation/click | `observe:"compact"` |
| Need only SPA changes | `browser_snapshot_delta()` or action `observe:"delta"` |
| Need clickable refs next | action with `observe:"snapshot"` |
| Need visual/layout truth | `observe:"screenshot"` or `browser_vision_screenshot` |
| Sparse/canvas/ambiguous UI | `browser_vision_screenshot` |
| Standard input field | `browser_fill` |
| Rich text / contenteditable | click to focus → `browser_type` |
| Drag slider/map/handle/item | `browser_drag` using refs or screenshot coordinates |
| Upload a local file into a website | `browser_upload_file` |
| Trigger a page download button | `browser_click_and_download` |
| Wait for known UI state | `browser_element_watch` |
| Collect raw text across many scrolls | `browser_scroll_collect` |
| Collect structured records across many scrolls | `browser_scroll_collect_v2` |
| Extract repeated structured cards | `browser_extract_structured` |
| Reuse extraction schema | `browser_extract_structured({ schema: { schema_name } })` |
| Need underlying API payload | `browser_intercept_network` |
| Verified useful keyboard shortcut | `save_site_shortcut` |
| Snapshot/vision insufficient | `browser_run_js` fallback |
| Known direct asset URL | `download_url` |
| Supported media page URL | `download_media` |
| Understand a local image/video | `analyze_image` / `analyze_video` |


---

## Changelog

| Date | Change |
|------|--------|
| 2026-04-23 | v4.1.0: Added cross-site scroll-guard guidance after live testing showed the automation layer can block repeated blind `browser_scroll(...)` calls until a real interaction anchors the page. Documented the prevention pattern: inspect state, interact meaningfully once, then scroll; otherwise prefer `browser_scroll_collect(...)` for bulk collection. |
| 2026-04-28 | v4.2.0: Live-schema modernization after activating the browser tool category. Added observation-mode guidance (`none`, `compact`, `delta`, `snapshot`, `screenshot`), updated browser-open/action return-state rules, added `browser_drag`, `browser_scroll_collect_v2`, `save_site_shortcut`, and `browser_teach_verify`, and documented reusable extraction schemas with `schema_name`, `item_root`, `dedupe_key`, and `save_as`. |
---

## Bottom line

Use browser tools to **interact**.
Use web tools to **research**.
Use download/media tools to **acquire assets directly when possible**.
Use fresh snapshot or screenshot evidence to guide every action.
Prefer DOM refs when available, vision when necessary, and JS only as a fallback.