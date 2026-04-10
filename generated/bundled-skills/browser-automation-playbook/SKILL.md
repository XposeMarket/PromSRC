---
name: Browser Automation Playbook
description: The definitive guide to all 18 browser automation tools — DOM snapshots, stable refs, vision fallback, keyboard navigation, infinite scroll, form filling, JS execution, network interception, structured extraction, and multi-step workflows. Read this before ANY browser automation task.
emoji: 🌐
version: 2.0.0
triggers: browser, browser_open, browser_click, browser_fill, browser_snapshot, browser_scroll, browser_press_key, browser_wait, browser_close, browser_vision, browser_run_js, browser_intercept_network, browser_element_watch, browser_snapshot_delta, browser_extract_structured, navigate, web page, open url, click button, fill form, login, submit form, scrape page, automate website, browser automation
---

# Browser Automation Playbook

Read this before any browser automation task. This covers every browser tool, when to use each, how they work under the hood, and tested patterns for common workflows.

---

## 1. Tool Reference — Quick Map

### Core Navigation & Interaction
| Tool | When to use | Returns |
|---|---|---|
| `browser_open(url)` | Start any browser task — navigate to URL | DOM snapshot with @refs |
| `browser_snapshot()` | Re-scan page when you DON'T have a recent snapshot | DOM snapshot with @refs |
| `browser_click(ref)` | Click any element by @ref number | Updated snapshot |
| `browser_fill(ref, text)` | Type into [INPUT] elements | Updated snapshot |
| `browser_press_key(key)` | Press keyboard keys (Enter, Tab, shortcuts) | Updated snapshot |
| `browser_scroll(direction)` | Scroll page up or down | Updated snapshot |
| `browser_scroll_collect(scrolls)` | Multi-scroll data collection (scraping) | Deduplicated text from all positions |
| `browser_wait(ms)` | Wait for slow-loading content | Updated snapshot |
| `browser_close()` | Close browser when done | Confirmation |
| `browser_get_focused_item()` | Check what element has keyboard focus | Focus info + content |
| `browser_get_page_text()` | Extract ALL visible text including iframes | Full page text |

### Vision Mode
| Tool | When to use | Returns |
|---|---|---|
| `browser_vision_screenshot()` | Capture viewport PNG (vision mode only) | Image injected for vision-capable models |
| `browser_vision_click(x, y)` | Click pixel coordinates (vision mode only) | Updated snapshot |
| `browser_vision_type(x, y, text)` | Type at pixel coordinates (vision mode only) | Updated snapshot |
| `browser_send_to_telegram(caption)` | Send viewport screenshot to Telegram | Confirmation |

### Power Tools (NEW)
| Tool | When to use | Returns |
|---|---|---|
| `browser_run_js(code)` | Execute arbitrary JS in page context | JSON-serialized result |
| `browser_intercept_network(action, url_filter?)` | Capture XHR/fetch responses | Logged entries or confirmation |
| `browser_element_watch(selector, wait_for, text?, timeout_ms?)` | Wait for DOM condition without polling | Element state or timeout |
| `browser_snapshot_delta()` | Only what changed since last snapshot | Added/removed elements, 60-80% fewer tokens |
| `browser_extract_structured(schema)` | CSS-schema structured JSON extraction | Typed array of extracted objects |

---

## 2. The Snapshot — What You See

Every action returns a **DOM snapshot** — a text representation of interactive elements on the page:

```
Page: GitHub — Dashboard
Elements (24):
URL: https://github.com/dashboard

[@1] link "Dashboard"
[@2] searchbox "Search or jump to…" [INPUT]
[@3] link "Pull requests"
[@4] link "Issues"
[@5] button "New" [INPUT]
[@6] link "prometheus/main — Updated 2 hours ago"
[@7] heading "Recent activity"
...
```

### Key snapshot concepts:

- **`@N` refs** — Every interactive element gets a stable `data-sc-ref` number written into the DOM. This number **survives React/Vue re-renders and DOM mutations** — you can safely use a ref captured 3 steps ago.
- **`[INPUT]` markers** — Elements you can type into. Only use `browser_fill` on these.
- **Roles** — `link`, `button`, `searchbox`, `textbox`, `heading`, `tab`, `combobox`, etc.
- **Names** — The visible text or aria-label of the element.
- **Modals** — When a modal/dialog is open, ONLY elements inside the modal appear. Background elements are hidden.
- **Frame elements** — Same-origin iframes are pierced automatically; their elements appear with a `[frame:hostname]` label. Cross-origin iframes are listed with a note to navigate directly.

### CRITICAL RULES about snapshots:

1. **`browser_open`, `browser_click`, `browser_fill`, `browser_scroll`, `browser_wait` ALL return a fresh snapshot.** Do NOT call `browser_snapshot` after these — you already have the latest state.
2. **Only call `browser_snapshot` when** you need a fresh scan and your last snapshot is stale (e.g., after a page has been loading in the background for a while).
3. **If an element you expect isn't in the snapshot**, the page may still be loading. Use `browser_wait(2000)` first, OR use `browser_element_watch` to wait exactly for that element.
4. **On SPAs (React/Vue apps):** Refs are stable — use `browser_snapshot_delta()` after actions to see only what changed, saving tokens.

---

## 3. Core Workflow Pattern

Every browser task follows **Navigate → Read → Act → Verify**:

```
1. browser_open(url)          → navigate, get snapshot
2. Read the snapshot          → find the @ref you need
3. browser_click/fill/press   → act on the element
4. Read the returned snapshot → verify the action worked
5. Repeat 3-4 until done
6. browser_close()            → clean up
```

**Example — Google Search:**
```
browser_open("https://google.com")
  → snapshot shows [@1] searchbox "Search" [INPUT]
browser_fill(1, "Prometheus AI framework")
  → snapshot shows search box filled
browser_press_key("Enter")
  → snapshot shows search results
  → read results from snapshot
browser_close()
```

---

## 4. Clicking — `browser_click(ref)`

```
browser_click({ ref: 5 })
```

- Always use the @ref number from the LATEST snapshot
- After clicking, you get a new snapshot — verify the click worked
- If the element disappears after click (e.g., dropdown closes), that's normal
- If a modal opens, the snapshot will only show modal elements
- **Refs are stable across re-renders** — a ref from 2 steps ago still works on SPAs

**Common click patterns:**
- Buttons: `browser_click(ref)` → verify action completed
- Links: `browser_click(ref)` → page navigates, new snapshot
- Dropdowns: `browser_click(ref)` → options appear in snapshot → `browser_click(option_ref)`
- Tabs: `browser_click(ref)` → content changes in snapshot
- Checkboxes: `browser_click(ref)` → check state updates

---

## 5. Typing — `browser_fill(ref, text)`

```
browser_fill({ ref: 2, text: "hello world" })
```

- **Only works on elements marked `[INPUT]`** in the snapshot
- Clears existing content before typing (select-all + type)
- After filling, the snapshot reflects the new value
- To submit after typing: `browser_press_key("Enter")`

**Common fill patterns:**
- Search box: `browser_fill(ref, query)` → `browser_press_key("Enter")`
- Login form: `browser_fill(username_ref, "user")` → `browser_fill(password_ref, "pass")` → `browser_click(submit_ref)`
- Tweet composer: `browser_fill(ref, "tweet text")` → look for submit button in snapshot → `browser_click(button_ref)`

**IMPORTANT:** `browser_fill` is NOT `browser_type`. There is no `browser_type` tool. Always use `browser_fill`.

---

## 6. Keyboard — `browser_press_key(key)`

```
browser_press_key({ key: "Enter" })
```

**Available keys:**
- Submit: `Enter`
- Navigation: `Tab`, `Escape`, `ArrowDown`, `ArrowUp`, `ArrowLeft`, `ArrowRight`
- Editing: `Backspace`, `Delete`, `Space`
- Combos: `Control+a`, `Control+c`, `Control+v`, `Shift+Tab`
- Site shortcuts: `n` (X.com: new tweet), `j`/`k` (X.com: navigate tweets), `l` (X.com: like)

**Site shortcuts** are auto-detected and shown in snapshots:
```
🔑 Site shortcuts for x.com:
  n → Open compose tweet dialog
  j → Move to next tweet
  k → Move to previous tweet
  l → Like current tweet
```

Use `browser_press_key("n")` to trigger these shortcuts directly.

---

## 7. Scrolling — `browser_scroll(direction, multiplier)`

```
browser_scroll({ direction: "down", multiplier: 1.0 })
```

- Scrolls by viewport height × multiplier
- Default multiplier: 1.0 (one full viewport)
- Returns a fresh snapshot after scrolling

**Multiplier guide:**
| Site type | Multiplier | Why |
|---|---|---|
| Standard websites | 1.0 | Normal scrolling |
| X/Twitter infinite feeds | 1.75 | Virtualized content needs larger scroll to load new items |
| Search results | 1.0 | Standard pagination |
| Long documents | 0.5 | Slower, more controlled reading |
| Quick skip-ahead | 3.0-4.0 | Fast navigation |

**Infinite scroll pattern:**
```
browser_open("https://x.com/search?q=topic")
  → read first batch of results
browser_scroll("down", 1.75)
  → new results load, read them
browser_scroll("down", 1.75)
  → more results, read them
... repeat until enough data collected
```

---

## 7b. Multi-Scroll Data Collection — `browser_scroll_collect`

The power tool for scraping infinite scroll pages in a single call. Scrolls N times inside Playwright with zero LLM round-trips between scrolls, collecting and deduplicating text at each position.

### When to Use
- Collecting tweets from X/Twitter search or timeline
- Scraping product listings, news feeds, search results
- Any page where content loads on scroll and you need ALL of it
- When you'd otherwise call `browser_scroll` 5+ times in a row

### Basic Usage
```
browser_scroll_collect({ scrolls: 10, multiplier: 1.75 })
```
Returns all deduplicated text from 10 scroll positions. No DOM snapshot — just raw text data.

### Parameters
| Param | Default | Description |
|---|---|---|
| `scrolls` | 5 | Number of scroll iterations (1–30) |
| `direction` | "down" | Scroll direction |
| `multiplier` | 1.5 | Viewport height multiplier per scroll (0.5–4.0) |
| `delay_ms` | 1500 | Wait between scrolls for content to load (500–5000) |
| `stop_text` | — | Stop early when this text appears (e.g. "No more results") |
| `max_chars` | 50000 | Cap total collected text to prevent token overflow |

### X/Twitter Pattern
```
browser_open("https://x.com/search?q=bitcoin&f=live")
  → read initial results from snapshot
browser_scroll_collect({ scrolls: 15, multiplier: 1.75, delay_ms: 2000 })
  → returns ~40-60 tweets worth of text, deduplicated
browser_close()
```

### Key Differences from `browser_scroll`
| | `browser_scroll` | `browser_scroll_collect` |
|---|---|---|
| Scrolls per call | 1 | 1–30 |
| Returns | DOM snapshot with @refs | Raw text (no @refs) |
| Use case | Navigate + interact | Collect data |
| LLM round-trips | 1 per scroll | 1 total |
| After use | Act on @refs immediately | Call `browser_snapshot()` if you need to interact |

### Early Stopping
The tool stops automatically when:
- Page bottom reached (scrollY didn't change)
- `stop_text` sentinel found on page
- `max_chars` limit reached
- All requested scrolls completed

---

## 8. Waiting — `browser_wait(ms)`

```
browser_wait({ ms: 3000 })
```

- Range: 500ms to 8000ms (default 2000)
- Returns a fresh snapshot after waiting
- Use when: page is loading, content hasn't appeared, dynamic UI updating

**When to wait:**
- After `browser_open` if the page is slow to load (SPA, heavy JS)
- After `browser_click` if the resulting action triggers a navigation or AJAX load
- When snapshot shows very few elements (page still rendering)

**Prefer `browser_element_watch` over `browser_wait`** when you're waiting for a specific element to appear — it returns as soon as the element is ready instead of sleeping for a fixed duration.

---

## 9. Vision Mode — When DOM Fails

Vision mode activates automatically when the page has **fewer than 10 DOM elements** (canvas-based UIs, heavy iframe apps, PDF viewers, etc.).

**How it works:**
1. System detects sparse DOM and turns on vision mode for the session.
2. `browser_vision_screenshot()` captures a viewport PNG. On **vision-capable primary models**, that image is injected into **your** context (same conversation as DOM snapshots).
3. **You** (the primary executor) read the image and/or sparse DOM hints, then call the next tool — usually `browser_vision_click` / `browser_vision_type` with **pixel coordinates** you choose from what you see.
4. There is **no separate "browser advisor" model** in the loop: planning and tool choice stay with you.

**Typical pattern:**

```
browser_vision_screenshot()
  → viewport image attached; pick (x, y) for the control you want
browser_vision_click({ x: 412, y: 256 })
  → or browser_vision_type({ x: 412, y: 256, text: "search query" })
```

**When the DOM recovers** (≥10 interactive elements), vision mode winds down and you return to @ref-based `browser_click` / `browser_fill` from `browser_snapshot`.

---

## 10. Extracting Page Content — `browser_get_page_text()`

```
browser_get_page_text()
```

- Extracts ALL visible text from the page, including iframe content
- Use when the snapshot shows very few elements but you know there's content (iframes, embedded viewers)
- Returns text + iframe URLs so you can navigate to them if needed
- Also useful for reading article content, scraping text from pages

---

## 11. Keyboard Navigation — `browser_get_focused_item()`

```
browser_get_focused_item()
```

- Shows which element currently has keyboard focus
- Essential for j/k navigation on X.com and similar sites
- Returns the focused element's content and position (e.g., "Tweet #3 of 12")
- Call after every `browser_press_key("j")` or `browser_press_key("k")` to track position

**X.com keyboard navigation pattern:**
```
browser_open("https://x.com/home")
browser_press_key("j")        → move to first tweet
browser_get_focused_item()     → "Tweet #1: @user said..."
browser_press_key("j")        → move to next tweet
browser_get_focused_item()     → "Tweet #2: @other said..."
browser_press_key("l")        → like current tweet
browser_press_key("j")        → move to next
```

---

## 12. Execute JavaScript — `browser_run_js(code)`

Run arbitrary JavaScript inside the page context. Top-level `await` is supported. Returns a JSON-serialized result.

```
browser_run_js({ code: "return document.title" })
browser_run_js({ code: "return window.__STORE__.getState()" })
browser_run_js({ code: "return Array.from(document.querySelectorAll('h2')).map(h => h.textContent)" })
```

### When to Use
- Read React/Vue internal state (`window.__redux_store__`, `window.__APP__`)
- Trigger custom events, call page APIs, inject data
- Extract information that's not surfaced in the DOM snapshot
- Count elements, check flags, inspect hidden variables
- Perform multi-step DOM operations in one round-trip

### Examples
```
// Read all tweet IDs on current page
browser_run_js({ code: `
  return Array.from(document.querySelectorAll('article[data-testid="tweet"]'))
    .map(a => a.querySelector('time')?.closest('a')?.href)
    .filter(Boolean)
` })

// Check if user is logged in (X.com)
browser_run_js({ code: "return !!window.__reactFiber || !!document.querySelector('[data-testid=\"SideNav_AccountSwitcher_Button\"]')" })

// Scroll to bottom programmatically
browser_run_js({ code: "window.scrollTo(0, document.body.scrollHeight); return document.body.scrollHeight" })
```

### Notes
- Result must be JSON-serializable (no DOM nodes, no functions)
- Errors are returned as `{ error: "..." }` strings
- Use `return` to send a value back — top-level expressions without `return` yield `null`

---

## 13. Network Interception — `browser_intercept_network(action, url_filter?)`

Hook into the browser's network layer and capture XHR/fetch response bodies as they arrive.

```
browser_intercept_network({ action: "start" })
browser_intercept_network({ action: "start", url_filter: "/api/graphql" })
browser_intercept_network({ action: "read" })
browser_intercept_network({ action: "stop" })
browser_intercept_network({ action: "clear" })
```

### Actions
| Action | What it does |
|---|---|
| `start` | Begin capturing responses. Optional `url_filter` to narrow to a URL substring. |
| `read` | Return all captured entries so far (without stopping). |
| `stop` | Stop capturing. |
| `clear` | Clear the log without stopping. |

### When to Use
- Capture API responses that aren't in the DOM (e.g., a feed of JSON objects)
- Inspect GraphQL queries/responses on SPAs
- Monitor what data loads as you interact with a page
- Verify that a form submission sent the right payload

### Pattern — Intercept a JSON Feed
```
browser_intercept_network({ action: "start", url_filter: "/api/timeline" })
browser_open("https://app.example.com/feed")
browser_scroll("down", 2.0)
browser_intercept_network({ action: "read" })
  → returns: [{ url: "...", method: "GET", status: 200, contentType: "application/json", body: "{...}" }]
browser_intercept_network({ action: "stop" })
```

### Notes
- JSON and text bodies are captured; binary/non-text responses get `body: null`
- `max_entries` parameter limits log size (default 100)
- Start interception BEFORE opening or navigating to the page, so you don't miss early requests

---

## 14. Wait for DOM Element — `browser_element_watch(selector, wait_for, text?, timeout_ms?)`

Wait for a CSS selector to match a DOM condition. Uses Playwright's native `waitForSelector` — no polling, no snapshots.

```
browser_element_watch({ selector: "#results", wait_for: "visible" })
browser_element_watch({ selector: ".spinner", wait_for: "hidden", timeout_ms: 10000 })
browser_element_watch({ selector: ".toast", wait_for: "contains_text", text: "Saved", timeout_ms: 5000 })
```

### wait_for Values
| Value | Meaning |
|---|---|
| `visible` | Element exists in DOM and is visible |
| `hidden` | Element is hidden or removed from DOM |
| `attached` | Element is attached to DOM (may be hidden) |
| `detached` | Element is removed from DOM entirely |
| `contains_text` | Element is visible AND contains the given `text` |

### When to Use
- Wait for a loading spinner to disappear: `wait_for: "hidden"` on `.spinner`
- Wait for a success toast: `wait_for: "contains_text", text: "Saved"`
- Wait for search results to appear: `wait_for: "visible"` on `#results`
- Confirm a modal closed: `wait_for: "detached"` on `[role="dialog"]`

**This is always preferable to `browser_wait(N)`** when waiting for a specific element — it returns immediately when the condition is met rather than sleeping.

### Pattern — Login + Wait for Dashboard
```
browser_open("https://app.example.com/login")
browser_fill(email_ref, "user@example.com")
browser_fill(pass_ref, "password")
browser_click(submit_ref)
browser_element_watch({ selector: ".dashboard-header", wait_for: "visible", timeout_ms: 8000 })
  → returns as soon as dashboard header appears
browser_snapshot()
  → now interact with dashboard
```

---

## 15. Snapshot Delta — `browser_snapshot_delta()`

Returns ONLY what changed since the last snapshot — added and removed elements, URL changes, title changes.

```
browser_snapshot_delta()
```

Returns something like:
```
URL: unchanged
Title: unchanged
Added (3):
  [@42] button "Submit"
  [@43] div "Success: Your order was placed"
  [@44] link "View order details"
Removed (1):
  [@18] button "Checkout"
```

### When to Use
- After actions on SPAs (React/Vue) where most of the DOM doesn't change
- After `browser_click` or `browser_fill` to see what the action produced
- Any time you don't need the full element list, just what changed

### Token Savings
On a typical SPA, a full snapshot might return 80+ elements. `browser_snapshot_delta` returns only the 3-10 elements that actually changed — typically 60-80% fewer tokens per step on interactive flows.

### Notes
- Requires at least one prior snapshot in the session to compute a diff
- Falls back to a full snapshot if no previous state exists
- Does NOT replace `browser_snapshot` — use it AFTER an action, not for the initial page load

---

## 16. Structured Extraction — `browser_extract_structured(schema)`

Extract typed JSON arrays from a page using a CSS-selector schema. One call replaces writing complex scraping JS.

```
browser_extract_structured({
  schema: {
    container_selector: "article.tweet",
    fields: [
      { name: "author", selector: "[data-testid='User-Name']", type: "text" },
      { name: "body", selector: "[data-testid='tweetText']", type: "text" },
      { name: "likes", selector: "[data-testid='like'] span", type: "text" },
      { name: "url", selector: "time", type: "attr", attr: "data-time" }
    ]
  }
})
```

Returns:
```json
[
  { "author": "@user1", "body": "Tweet content here", "likes": "124", "url": null },
  { "author": "@user2", "body": "Another tweet", "likes": "42", "url": "1234567890" }
]
```

### Field Types
| Type | What it extracts |
|---|---|
| `text` | `innerText` of the element |
| `html` | `innerHTML` of the element |
| `attr` | A specific attribute value (requires `attr` field in definition) |
| `href` | The `href` attribute |
| `src` | The `src` attribute |

### When to Use
- Scraping structured lists: tweets, product cards, search results, table rows
- Extracting data from repeated containers with known CSS structure
- Any time you'd write `document.querySelectorAll + .map(el => ...)` manually

### Pattern — Product Price Scraper
```
browser_open("https://shop.example.com/products")
browser_extract_structured({
  schema: {
    container_selector: ".product-card",
    fields: [
      { name: "name", selector: ".product-title", type: "text" },
      { name: "price", selector: ".price", type: "text" },
      { name: "link", selector: "a.product-link", type: "href" }
    ]
  }
})
  → returns array of { name, price, link } objects
```

---

## 17. Common Workflow Patterns

### Login Flow
```
browser_open("https://app.example.com/login")
  → snapshot: [@1] textbox "Email" [INPUT], [@2] textbox "Password" [INPUT], [@3] button "Sign in"
browser_fill(1, "user@example.com")
browser_fill(2, "password123")
browser_click(3)
browser_element_watch({ selector: ".dashboard", wait_for: "visible", timeout_ms: 8000 })
  → verify: dashboard appeared
```

### Form Submission
```
browser_open("https://app.example.com/form")
browser_fill(name_ref, "John Doe")
browser_fill(email_ref, "john@example.com")
  → if dropdown: browser_click(dropdown_ref) → browser_click(option_ref)
  → if checkbox: browser_click(checkbox_ref)
browser_click(submit_ref)
browser_element_watch({ selector: ".success-message", wait_for: "visible" })
```

### SPA — Token-Efficient Navigation
```
browser_open("https://spa.example.com")
  → full snapshot on first load
browser_click(nav_ref)
  → page re-renders
browser_snapshot_delta()
  → only the 5 elements that changed — 80% fewer tokens
browser_click(new_ref_from_delta)
  → act on the new element
```

### Intercept + Structured Extraction
```
browser_intercept_network({ action: "start", url_filter: "/api/products" })
browser_open("https://shop.example.com/catalog")
browser_intercept_network({ action: "read" })
  → JSON bodies of all product API calls, no scraping needed
```

### Data Extraction (Scraping)
```
browser_open("https://example.com/data-page")
  → read structured data from snapshot
  → structured list? browser_extract_structured(schema)
  → if pagination: browser_click(next_ref), repeat
  → if infinite scroll: browser_scroll_collect({ scrolls: 10 })
```

---

## 18. Error Handling

| Problem | Solution |
|---|---|
| Element not in snapshot | Page still loading → `browser_element_watch(selector, "visible")` instead of `browser_wait` |
| Click did nothing | Wrong @ref → re-read snapshot, find correct element |
| Page shows login wall | Session expired → fill login form again |
| Rate limited (429) | Wait longer → `browser_wait(5000)`, slow down |
| Modal blocking | Snapshot only shows modal elements → dismiss modal first |
| Very few elements (<10) | Vision mode activates automatically, OR try `browser_get_page_text()` |
| Same-origin iframe | Elements auto-appear in snapshot with `[frame:hostname]` label |
| Cross-origin iframe | Listed with note — navigate with `browser_open(iframe_url)` directly |
| Wrong page loaded | Check URL in snapshot header, re-navigate if needed |
| SPA ref seems stale | Refs are stable (`data-sc-ref`) — try the click; if still fails, `browser_snapshot()` |
| Need to wait for element | Use `browser_element_watch` not `browser_wait` — faster + exact |

---

## 19. Performance Tips

1. **Don't call `browser_snapshot()` after action tools** — they already return snapshots
2. **Use `browser_element_watch` instead of `browser_wait`** — returns the moment the condition is met
3. **Use `browser_snapshot_delta()` on SPAs** — 60-80% token savings on repeated interactions
4. **Use `browser_extract_structured` for lists** — one call instead of reading snapshot + parsing manually
5. **Use `browser_intercept_network` for JSON APIs** — skip the DOM entirely if data comes from XHR
6. **Use `browser_press_key("Enter")` to submit** — faster than finding and clicking a submit button
7. **Batch reads before acting** — read the full snapshot once, plan your actions, then execute
8. **Close the browser when done** — `browser_close()` frees resources
9. **Use site shortcuts when available** — faster than finding buttons (e.g., `n` to compose on X.com)

---

## 20. Tools That DON'T Exist (Common Mistakes)

| Wrong | Right |
|---|---|
| `browser_type` | `browser_fill` (for inputs) or `browser_press_key` (for shortcuts) |
| `browser_navigate` | `browser_open` |
| `browser_goto` | `browser_open` |
| `browser_find` | Read the snapshot — elements are listed there |
| `browser_select` | `browser_click` on the dropdown, then `browser_click` on the option |
| `browser_eval` | `browser_run_js` |
| Opening Chrome via `run_command` | `browser_open(url)` — NEVER use shell for browser |
