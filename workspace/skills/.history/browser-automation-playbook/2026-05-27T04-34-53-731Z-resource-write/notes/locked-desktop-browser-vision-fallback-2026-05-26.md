# Locked desktop browser/vision fallback note — 2026-05-26

Observed during a live mobile-requested smoke test while Raul's Windows desktop was locked.

## What worked
- `browser_doctor` confirmed Playwright availability.
- `browser_open` launched Chrome and loaded Google successfully.
- `browser_vision_screenshot` captured the viewport while the desktop capture itself was locked/black.
- `browser_get_page_text` extracted visible text.
- Keyboard submission with `browser_press_key("Enter")` worked.
- `browser_vision_click` successfully expanded a Google People Also Ask item.
- `browser_run_js` could set the Google search box as a fallback.

## Gotchas
- `browser_snapshot` returned 0 DOM elements even though the page was visibly loaded.
- `browser_fill` on Google search hit `TypeError: Illegal invocation`; `browser_run_js` + `browser_press_key("Enter")` worked around it.

## Next-time guardrail
When the Windows desktop is locked but browser automation is still available, treat DOM snapshots/refs as potentially weak. Start with doctor/open, use page text and fresh vision screenshots as truth, and be ready to fall back to keyboard or narrowly scoped JS for simple input when `browser_fill` fails on Google-like pages. Do not conclude the browser is unusable just because desktop screenshots are black or DOM snapshots are sparse.