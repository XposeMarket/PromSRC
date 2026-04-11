---
name: Browser Automation Playbook
description: Current operating guide for Prometheus browser automation. Covers visual-first execution, DOM refs, vision fallback, keyboard flows, structured extraction, network interception, and when to use browser tools versus web_search/web_fetch.
emoji: 🌐
version: 3.0.0
triggers: browser, browser_open, browser_click, browser_fill, browser_type, browser_snapshot, browser_scroll, browser_press_key, browser_wait, browser_close, browser_vision, browser_run_js, browser_intercept_network, browser_element_watch, browser_snapshot_delta, browser_extract_structured, browser_get_page_text, browser_scroll_collect, navigate, web page, click button, fill form, login, submit form, scrape page, automate website, browser automation
---

# Browser Automation Playbook

Read this before any browser automation task.

This skill is for **interactive website work**: navigating pages, clicking controls, filling forms, handling JS-heavy UIs, collecting text from dynamic pages, and completing browser-side workflows.

**Do not use browser tools for normal web research by default.**
- Research / reading docs / articles / static pages → `web_search` then `web_fetch`
- Interactive site use / logged-in flows / clicking / typing / scrolling / JS apps → `browser_*`

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

### 2) Do not re-snapshot unnecessarily
These already return updated state:
- `browser_open`
- `browser_click`
- `browser_fill`
- `browser_wait`

Usually act on that returned state immediately.

Use `browser_snapshot()` only when:
- your last snapshot is stale
- you used a tool that does **not** return refs (`browser_scroll_collect`, `browser_get_page_text`, some keypresses)
- state changed in the background and you need a fresh element map

Use `browser_snapshot_delta()` when you already have a recent snapshot and only want changes.

### 3) Pick the right input tool
- `browser_fill(ref, text)` → standard `[INPUT]` elements from snapshot
- `browser_type(text)` → currently focused contenteditable / rich-text area
- `browser_press_key("Enter")` etc. → submit, navigate, shortcuts

`browser_type` **does exist** and should be used when `browser_fill` is the wrong fit.

### 4) Browser is for interaction, not generic reading
If the user wants information from the web and no interaction is required:
- first use `web_search`
- then `web_fetch`

Open a browser only when interaction or live UI state matters.

---

## Tool map

### Core browser flow
- `browser_open(url)` — start browser session on a URL
- `browser_click(ref)` — click an element from the latest snapshot
- `browser_fill(ref, text)` — fill a normal input from the latest snapshot
- `browser_press_key(key)` / `browser_key(key)` — press a key on the focused element
- `browser_type(text)` — type raw text into the focused rich-text/contenteditable area
- `browser_wait(ms)` — wait for dynamic content, then inspect returned state
- `browser_close()` — close tab when done

### Reading and orientation
- `browser_snapshot()` — full current interactive snapshot
- `browser_snapshot_delta()` — changes since last snapshot
- `browser_get_page_text()` — all visible text, including iframes
- `browser_get_focused_item()` — identify current keyboard-focused item

### Vision fallback
- `browser_vision_screenshot()` — viewport image for visual grounding
- `browser_vision_click(x, y)` — coordinate click
- `browser_vision_type(x, y, text)` — click and type at coordinates

### Scraping / extraction / dynamic data
- `browser_scroll(direction, multiplier)` — one interactive scroll
- `browser_scroll_collect(...)` — repeated scrolling + deduplicated text collection
- `browser_extract_structured(schema)` — CSS-schema extraction into JSON
- `browser_intercept_network(start/read/stop/clear)` — inspect XHR/fetch responses
- `browser_element_watch(selector, ...)` — wait for selector appear/disappear/text

### Fallback inspection
- `browser_run_js(code)` — inspect page state when snapshot/vision is insufficient

---

## Standard workflow

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

### `browser_scroll_collect`
Use when the task is text/data collection across multiple scrolls.

Best for:
- infinite feeds
- social search results
- product listing pages
- long result sets

Remember: it returns collected text, **not** clickable refs. If interaction is needed afterward, call `browser_snapshot()`.

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

### `browser_run_js`
Use only when snapshot + vision still do not reveal what you need.

Good uses:
- inspect hidden state
- read framework globals
- extract data not surfaced in DOM text

Bad default behavior:
- navigating a page by JS because you did not inspect the snapshot first
- relying on JS guesses instead of fresh visual evidence

---

## Snapshot rules and ref handling

- Use refs from the **latest relevant snapshot**
- After `browser_open`, `browser_click`, `browser_fill`, and `browser_wait`, read the returned state before taking another action
- If the page is a SPA and you just need the changes, use `browser_snapshot_delta()`
- If a click seems to do nothing, inspect the new state instead of assuming failure immediately

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
1. `browser_open(url)`
2. optionally inspect first visible batch
3. `browser_scroll_collect({ scrolls: 8-15, multiplier: 1.5-1.75, delay_ms: 1200-2000 })`
4. if later interaction is needed, `browser_snapshot()`

### Ambiguous UI
1. take `browser_vision_screenshot()`
2. choose coordinates from current image
3. click/type visually
4. if refs recover, switch back to DOM workflow

---

## Common mistakes to avoid

- Using browser tools for simple reading that `web_fetch` could do faster
- Calling `browser_snapshot()` immediately after tools that already returned a snapshot
- Using `browser_fill` on contenteditable editors that require `browser_type`
- Using `browser_run_js` first instead of checking current visual state
- Continuing on stale assumptions after the page visibly changed
- Forgetting that `browser_scroll_collect` returns text, not refs

---

## Quick decision table

| Situation | Best tool / workflow |
|---|---|
| Read article/doc page | `web_search` → `web_fetch` |
| Click through a live website | `browser_open` + snapshot-driven actions |
| Sparse/canvas/ambiguous UI | `browser_vision_screenshot` |
| Standard input field | `browser_fill` |
| Rich text / contenteditable | click to focus → `browser_type` |
| Wait for known UI state | `browser_element_watch` |
| Collect text across many scrolls | `browser_scroll_collect` |
| Extract repeated structured cards | `browser_extract_structured` |
| Need underlying API payload | `browser_intercept_network` |
| Snapshot/vision insufficient | `browser_run_js` fallback |

---

## Bottom line

Use browser tools to **interact**.
Use web tools to **research**.
Use fresh snapshot or screenshot evidence to guide every action.
Prefer DOM refs when available, vision when necessary, and JS only as a fallback.
