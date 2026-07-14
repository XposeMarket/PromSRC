# Locked desktop browser/vision fallback — 2026-05-26

## Evidence
- the user asked Prometheus to test Chrome/browser tools while the Windows desktop was locked (`audit/chats/transcripts/mobile_mpmztala_z35di6.md:1-21`).
- The run showed browser automation remained usable under lock: `browser_doctor`, `browser_open`, page text extraction, browser vision screenshots, keyboard submit, JS fallback, and vision click worked.
- Weak spots: DOM snapshot returned `0` elements on Google despite a visible page, and `browser_fill` failed with a Google-specific `Illegal invocation`; `browser_run_js` plus `Enter` worked around it.

## Next-time guardrail
When the desktop/OS capture is black or locked but a browser task is requested, do not assume browser automation is dead. Run a small browser health path first:
1. `browser_doctor`
2. `browser_open(..., observe:"screenshot" or "compact")`
3. `browser_get_page_text` or `browser_vision_screenshot`
4. If DOM refs are weak or `browser_fill` fails, use keyboard submission, vision click, or narrowly scoped `browser_run_js` fallback.

## Reporting pattern
Report split state precisely: “browser/vision works under lock, DOM refs are weak on this page, and JS/keyboard/vision fallback succeeded.” Do not overgeneralize the test as full Locked Work Mode support; it proves a browser lane, not arbitrary native Windows GUI control.
